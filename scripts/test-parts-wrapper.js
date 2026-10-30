// `node:test` for one part of a split test file (D-49): every export is the real one except `test`,
// which registers top-level test i only when i mod parts is among the parts this shard keeps.
// Subtests (t.test) are the real ones. This module's own import of node:test is never redirected.
import * as real from 'node:test';

export * from 'node:test';

const file = new URL(import.meta.url).searchParams.get('file');
const { parts, keep } = JSON.parse(process.env.SLICEKIT_TEST_PARTS)[file];
let index = 0;

function test(...args) {
  const i = index++;
  return keep.includes(i % parts) ? real.test(...args) : Promise.resolve();
}
Object.assign(test, { skip: real.test.skip, todo: real.test.todo, only: real.test.only });

export { test };
export default test;
