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

// REQ-3.13: each agents.denyPaths pattern as a Read and an Edit rule of permissions.deny. The rules
// slicekit wrote last time are recorded in `_slicekit.deny` and replaced; every other deny entry is
// the team's and stays, and a rule the team already holds is left the team's. -> {permissions, deny}:
// the permissions object to write (undefined when there is none) and the rules slicekit now owns.
function mergeDeny(base, denyPaths) {
  const permissions = base.permissions && typeof base.permissions === 'object' && !Array.isArray(base.permissions) ? base.permissions : undefined;
  const current = Array.isArray(permissions?.deny) ? permissions.deny : [];
  const recorded = Array.isArray(base._slicekit?.deny) ? base._slicekit.deny : [];
  const kept = current.filter((e) => !recorded.includes(e));
  const rules = denyPaths.flatMap((p) => [`Read(${p})`, `Edit(${p})`]);
  const ours = [...new Set(rules)].filter((e) => !kept.includes(e));
  const deny = [...kept, ...ours];
  if (deny.length === current.length && deny.every((e, i) => e === current[i])) return { permissions: base.permissions, deny: ours };
  const next = { ...permissions };
  if (deny.length > 0) next.deny = deny;
  else delete next.deny;
  return { permissions: Object.keys(next).length > 0 ? next : undefined, deny: ours };
}

export function mergeSettings(existing, hooks, { version, cli, denyPaths = [] } = {}) {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  const prefixes = ourPrefixes(base, cli);
  const merged = { ...(base.hooks ?? {}) };
  for (const [event, entries] of Object.entries(hooks)) {
    const kept = Array.isArray(merged[event]) ? merged[event].flatMap((e) => withoutOurs(e, prefixes)) : [];
    merged[event] = [...kept, ...entries];
  }
  const meta = { managed: true, version };
  if (cli) meta.cli = cli;
  const { permissions, deny } = mergeDeny(base, Array.isArray(denyPaths) ? denyPaths : []);
  if (deny.length > 0) meta.deny = deny;
  const out = { ...base, hooks: merged, _slicekit: meta };
  if (permissions === undefined) delete out.permissions;
  else out.permissions = permissions;
  return out;
}
