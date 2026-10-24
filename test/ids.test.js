import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ID, re, parseSliceAddr, sliceFromBranch, stateFileName } from '../src/ids.js';

test('ids » sliceFromBranch', () => {
  assert.equal(sliceFromBranch('slice/P1-S-03-anything'), 'P1/S-03');
  assert.equal(sliceFromBranch('main'), null);
  assert.equal(sliceFromBranch('plan/x'), null);
  assert.equal(sliceFromBranch('slice/P1-S-3-x'), null);
});

test('ids » patterns and helpers', () => {
  assert.equal(re('req', 'g').flags, 'g');
  assert.notEqual(re('req', 'g'), re('req', 'g'));
  assert.deepEqual('see REQ-1.2 and D-14, G-3'.match(re('req', 'g')), ['REQ-1.2']);
  assert.ok(new RegExp(`^${ID.sliceAddr}$`).test('P12/S-03'));
  assert.deepEqual(parseSliceAddr('P1/S-03'), { phase: 1, slice: 3, id: 'P1/S-03' });
  assert.equal(parseSliceAddr('nope'), null);
  assert.equal(stateFileName('P1/S-03'), 'P1-S-03.json');
});
