// P4/S-47 review H-1 (REQ-1.1): under an excluded parent such as a `.slicekit/` line the un-ignores
// cannot take effect, so init appends them once, reports the file skipped after that, and names the
// ignore-file line that still ignores the heads log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { init } from '../src/init.js';
import { makeRepo } from './helpers/tmp-repo.js';

const HEADS = '.slicekit/journal-heads.log';

test('init appends the un-ignores once under an excluded .slicekit/ folder and names the line', () => {
  const repo = makeRepo({ files: { '.gitignore': '.slicekit/\n' } });
  try {
    const runs = [1, 2, 3].map(() => init(repo.root, { name: 'demo', shape: 'backend' }));
    const text = fs.readFileSync(path.join(repo.root, '.gitignore'), 'utf8');
    for (const rule of ['!.slicekit/journal/', '!.slicekit/journal/*.log', '.slicekit/journal/*.lock', '!.slicekit/journal-heads.log']) {
      assert.equal(text.split(/\r?\n/).filter((l) => l === rule).length, 1, `one copy of ${rule}`);
    }
    assert.ok(runs[1].skipped.includes('.gitignore'), 'second run skips .gitignore');
    assert.ok(runs[2].skipped.includes('.gitignore'), 'third run skips .gitignore');
    for (const run of runs) {
      const notes = run.warnings.filter((w) => w.includes(HEADS));
      assert.equal(notes.length, 1, 'one note per run');
      assert.match(notes[0], /\.gitignore:1:\.slicekit\//, 'the note names the line that still ignores it');
    }
  } finally {
    repo.cleanup();
  }
});
