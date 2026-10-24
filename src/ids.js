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
