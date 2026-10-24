// managed (03 REQ-3.12): every file slicekit renders must still hold the block slicekit wrote.
// The plan is the one `slicekit update` makes at the kit's own version. `drifted`, `missing` and
// `unmanaged` are findings; `same` and `changed` are not: `changed` means the kit ships a newer
// template, which is update's business, not drift. A plan that cannot be made is one finding.
import { kitVersion } from '../../render/index.js';
import { planUpdate } from '../../render/update.js';

export const id = 'managed';
export const blocking = true;
export const ratchet = false;

const MESSAGE = {
  drifted: (dest) => `${dest}: managed block edited since slicekit wrote it; run slicekit update --force or revert`,
  missing: (dest) => `${dest}: managed file missing; run slicekit update`,
  unmanaged: (dest) => `${dest}: exists but is not managed by slicekit; move it or run slicekit update --force`,
};

export function run(ctx) {
  let items;
  try {
    items = planUpdate(ctx.root, ctx.cfg, { version: kitVersion() });
  } catch (e) {
    return [{ file: '-', line: 0, message: `managed: cannot plan an update: ${e?.message ?? e}` }];
  }
  return items.filter((i) => MESSAGE[i.status]).map((i) => ({ file: i.dest, line: 1, message: MESSAGE[i.status](i.dest) }));
}

export default { id, blocking, ratchet, run };
