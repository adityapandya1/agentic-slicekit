// journal (03 REQ-3.7, REQ-3.8, D-34): every branch file under .slicekit/journal/ must verify as an
// unbroken hash chain from genesis. One finding per broken file, at its first broken line; silent when
// there is no journal. Never repairs: a broken chain stays a finding until a human restores the file.
import { brokenMessage, verifyJournal } from '../../journal.js';

export const id = 'journal';
export const blocking = true;
export const ratchet = false;

export function run(ctx) {
  const r = verifyJournal(ctx.root, ctx.cfg);
  return r.files
    .filter((f) => f.brokenAt !== null)
    .map((f) => ({ file: f.file, line: f.brokenAt, message: brokenMessage(f.file, f.brokenAt) }));
}

export default { id, blocking, ratchet, run };
