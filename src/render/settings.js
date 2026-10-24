import path from 'node:path';
import { ConfigError } from '../config.js';
import { exists, readText } from '../fs.js';

const LEGACY = 'slicekit hook ';
export const SETTINGS_PATH = '.claude/settings.json';

// The parsed settings object, undefined when the file is absent; ConfigError when it is unusable.
export function readSettings(root) {
  const file = path.join(root, SETTINGS_PATH);
  if (!exists(file)) return undefined;
  try {
    const obj = JSON.parse(readText(file));
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('not an object');
    return obj;
  } catch {
    throw new ConfigError(['.claude/settings.json is not valid JSON; fix it or remove it']);
  }
}

function isOurs(hook, prefixes) {
  return typeof hook?.command === 'string' && prefixes.some((p) => hook.command.startsWith(p));
}

// Drops only our commands; an entry survives with the team's commands, or goes when nothing is left.
function withoutOurs(entry, prefixes) {
  if (!entry || !Array.isArray(entry.hooks)) return [entry];
  if (!entry.hooks.some((h) => isOurs(h, prefixes))) return [entry];
  const rest = entry.hooks.filter((h) => !isOurs(h, prefixes));
  return rest.length === 0 ? [] : [{ ...entry, hooks: rest }];
}

// Every command prefix that marks a hook entry as slicekit's: the legacy one, the current cli, the recorded cli.
export function ourPrefixes(existing, cli) {
  const prefixes = [LEGACY];
  if (cli) prefixes.push(`${cli} hook `);
  const recorded = existing?._slicekit?.cli;
  if (typeof recorded === 'string' && recorded !== '') prefixes.push(`${recorded} hook `);
  return prefixes;
}

const canon = (v) =>
  Array.isArray(v)
    ? `[${v.map(canon).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
      : JSON.stringify(v);

// { event: [canonical entry] } of the entries that are ours, whole (matcher, timeout, every field),
// each cut down to its slicekit hooks so a team hook sharing the entry does not count. Order-independent.
export function ourEntries(settings, prefixes) {
  const out = {};
  const hooks = settings && typeof settings.hooks === 'object' && settings.hooks !== null ? settings.hooks : {};
  for (const event of Object.keys(hooks).sort()) {
    const entries = Array.isArray(hooks[event]) ? hooks[event] : [];
    const ours = entries
      .filter((e) => Array.isArray(e?.hooks) && e.hooks.some((h) => isOurs(h, prefixes)))
      .map((e) => canon({ ...e, hooks: e.hooks.filter((h) => isOurs(h, prefixes)) }))
      .sort();
    if (ours.length > 0) out[event] = ours;
  }
  return out;
}

export function mergeSettings(existing, hooks, { version, cli } = {}) {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  const prefixes = ourPrefixes(base, cli);
  const merged = { ...(base.hooks ?? {}) };
  for (const [event, entries] of Object.entries(hooks)) {
    const kept = Array.isArray(merged[event]) ? merged[event].flatMap((e) => withoutOurs(e, prefixes)) : [];
    merged[event] = [...kept, ...entries];
  }
  const meta = { managed: true, version };
  if (cli) meta.cli = cli;
  return { ...base, hooks: merged, _slicekit: meta };
}
