const LEGACY = 'slicekit hook ';

function isOurs(entry, prefixes) {
  const hooks = entry && Array.isArray(entry.hooks) ? entry.hooks : [];
  return hooks.some((h) => typeof h?.command === 'string' && prefixes.some((p) => h.command.startsWith(p)));
}

export function mergeSettings(existing, hooks, { version, cli } = {}) {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  const prefixes = [LEGACY];
  if (cli) prefixes.push(`${cli} hook `);
  const merged = { ...(base.hooks ?? {}) };
  for (const [event, entries] of Object.entries(hooks)) {
    const kept = Array.isArray(merged[event]) ? merged[event].filter((e) => !isOurs(e, prefixes)) : [];
    merged[event] = [...kept, ...entries];
  }
  return { ...base, hooks: merged, _slicekit: { managed: true, version } };
}
