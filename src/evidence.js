// The shapes of evidence the kit accepts from a person or a host, in one place: the git host
// adapter and the state machine read SHAs and dates through these.

const SHA = /^[0-9a-f]{7,40}$/;

export const isSha = (s) => typeof s === 'string' && SHA.test(s);

export const isDate = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s));

export function assertSha(sha) {
  if (!isSha(sha)) throw new Error(`commit sha must be 7 to 40 lowercase hex characters, got '${sha}'`);
  return sha;
}

export function assertDate(isoDate) {
  if (!isDate(isoDate)) throw new Error(`expected an ISO date, got '${isoDate}'`);
  return Date.parse(isoDate);
}

// Two SHAs name the same commit when equal, or, when either is abbreviated, when one is a prefix
// of the other. Two full SHAs are compared whole.
export function sameSha(a, b) {
  if (!isSha(a) || !isSha(b)) return false;
  if (a === b) return true;
  if (a.length === 40 && b.length === 40) return false;
  return a.startsWith(b) || b.startsWith(a);
}
