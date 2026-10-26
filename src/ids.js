export const ID = {
  req: 'REQ-\\d+\\.\\d+',
  decision: 'D-\\d+',
  gap: 'G-\\d+',
  contract: 'C-\\d+',
  phase: 'P\\d+',
  slice: 'S-\\d{2}',
  sliceAddr: 'P\\d+\\/S-\\d{2}',
};

// A fresh RegExp each call, so callers never share a stateful global regex.
export function re(name, flags = '') {
  return new RegExp(ID[name], flags);
}

export function parseSliceAddr(addr) {
  const m = /^P(\d+)\/S-(\d{2})$/.exec(addr);
  return m ? { phase: Number(m[1]), slice: Number(m[2]), id: addr } : null;
}

export function sliceFromBranch(branch) {
  const m = /^slice\/P(\d+)-S-(\d{2})(?:-|$)/.exec(branch);
  return m ? `P${m[1]}/S-${m[2]}` : null;
}

export function stateFileName(addr) {
  return `${addr.replace('/', '-')}.json`;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const verdictStem = (addr) => stateFileName(addr).replace(/\.json$/, '');

// A slice's verdict file name, `P<n>-S-<nn>[i]-r<k>.md`: `i` marks an independent review.
export function verdictFileName(addr, round, { independent = false } = {}) {
  return `${verdictStem(addr)}${independent ? 'i' : ''}-r${round}.md`;
}

// The verdict file names of a slice: group 1 is the `i` (or ''), group 2 the round. With
// `independent` given, only names of that kind match; left out, both do.
export function verdictFilePattern(addr, { independent } = {}) {
  const i = independent === undefined ? 'i?' : independent ? 'i' : '';
  return new RegExp(`^${escapeRe(verdictStem(addr))}(${i})-r([1-9]\\d*)\\.md$`);
}
