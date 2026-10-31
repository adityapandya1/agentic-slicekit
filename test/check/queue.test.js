// REQ-1.6, REQ-3.7: the queue rule fails a BUILD.md that disagrees with the state files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { init } from '../../src/init.js';
import { loadConfig } from '../../src/config.js';
import { setState } from '../../src/state/index.js';
import { renderBuild, MARKER } from '../../src/state/build.js';
import { buildContext } from '../../src/check/context.js';
import { check } from '../../src/check/index.js';
import queue from '../../src/check/rules/queue.js';
import { makeRepo } from '../helpers/tmp-repo.js';
import { writeSliceFixtures } from '../helpers/slice-fixture.js';

const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PR = { number: 14, url: 'http://x/14', headSha: 'abc1234', title: '[P1/S-02] x' };

// An initialised repo with `slices` slice files and a BUILD.md written from them; `fn` gets the
// root, the config, the slice ids and a function that runs the rule.
function withKit(fn, { slices = 3 } = {}) {
  const repo = makeRepo();
  try {
    init(repo.root, { name: 'demo', shape: 'backend' });
    const ids = slices > 0 ? writeSliceFixtures(repo.root, slices) : [];
    const cfg = loadConfig(repo.root);
    const build = path.join(repo.root, 'BUILD.md');
    if (slices > 0) fs.writeFileSync(build, renderBuild(repo.root, cfg, fs.existsSync(build) ? fs.readFileSync(build, 'utf8') : ''));
    const run = () => queue.run(buildContext(repo.root, cfg));
    return fn({ root: repo.root, cfg, ids, build, run });
  } finally {
    repo.cleanup();
  }
}

const lineOf = (file, needle) => fs.readFileSync(file, 'utf8').split('\n').findIndex((l) => l.includes(needle)) + 1;

test('the rule is blocking and not a ratchet', () => {
  assert.equal(queue.id, 'queue');
  assert.equal(queue.blocking, true);
  assert.equal(queue.ratchet, false);
});

test('BUILD.md differing from state is a finding naming the slice', () => {
  withKit(({ root, cfg, ids, build, run }) => {
    assert.deepEqual(run(), []);
    setState(root, cfg, ids[1], 'draft-pr', { backfill: true, testExit: 0, checkExit: 0, pr: PR });
    assert.deepEqual(run(), [
      { file: 'BUILD.md', line: lineOf(build, '| S-02 |'), message: 'BUILD.md row for P1/S-02 says "Todo", state says "PR #14"' },
    ]);
    fs.writeFileSync(build, fs.readFileSync(build, 'utf8').replace('| S-03 | Fixture 3 |', '| S-03 | Fixture three |'));
    assert.deepEqual(run(), [
      { file: 'BUILD.md', line: lineOf(build, '| S-02 |'), message: 'BUILD.md row for P1/S-02 says "Todo", state says "PR #14"' },
      { file: 'BUILD.md', line: lineOf(build, '| S-03 |'), message: 'BUILD.md row for P1/S-03 is stale; run slicekit status --write' },
    ]);
  });
});

test('a row with a different number of cells is stale, not a status difference', () => {
  withKit(({ build, run }) => {
    fs.writeFileSync(build, fs.readFileSync(build, 'utf8').replace(/^(\| S-02 \|.*)$/m, '$1 extra |'));
    assert.deepEqual(run(), [
      { file: 'BUILD.md', line: lineOf(build, '| S-02 |'), message: 'BUILD.md row for P1/S-02 is stale; run slicekit status --write' },
    ]);
  });
});

test('a reordered table is a finding', () => {
  withKit(({ build, run }) => {
    const text = fs.readFileSync(build, 'utf8');
    const row = (n) => new RegExp(`^\\| S-0${n} \\|.*$`, 'm').exec(text)[0];
    const [one, two] = [row(1), row(2)];
    fs.writeFileSync(build, text.replace(one, '\u0001').replace(two, one).replace('\u0001', two));
    assert.deepEqual(run(), [{ file: 'BUILD.md', line: 1, message: 'BUILD.md is stale; run slicekit status --write' }]);
  });
});

test('a row moved out of the table is a finding', () => {
  withKit(({ build, run }) => {
    const text = fs.readFileSync(build, 'utf8');
    const two = /^\| S-02 \|.*\n/m.exec(text)[0];
    fs.writeFileSync(build, text.replace(two, '').replace(`\n${MARKER}`, `${two}\n${MARKER}`));
    assert.deepEqual(run(), [{ file: 'BUILD.md', line: 1, message: 'BUILD.md is stale; run slicekit status --write' }]);
  });
});

test('a state file that cannot be read is one finding, not a crash', () => {
  withKit(({ root, run }) => {
    fs.writeFileSync(path.join(root, '.slicekit', 'state', 'P1-S-01.json'), '{not json');
    const found = run();
    assert.equal(found.length, 1, JSON.stringify(found));
    assert.equal(found[0].file, 'BUILD.md');
    assert.equal(found[0].line, 1);
    assert.ok(found[0].message.startsWith('BUILD.md cannot be rendered'), found[0].message);
  });
});

test('a CRLF BUILD.md with trailing spaces is current', () => {
  withKit(({ build, run }) => {
    fs.writeFileSync(build, fs.readFileSync(build, 'utf8').replace(/\n/g, '  \r\n'));
    assert.deepEqual(run(), []);
  });
});

test('a tail edit is never a finding', () => {
  withKit(({ build, run }) => {
    fs.appendFileSync(build, '\n## Notes\n\nAnything the team writes.\n| S-07 | not a row we own | x | B | Todo |\n');
    assert.deepEqual(run(), []);
  });
});

test('a missing row is a finding', () => {
  withKit(({ build, run }) => {
    fs.writeFileSync(build, fs.readFileSync(build, 'utf8').replace(/^\| S-02 \|.*\n/m, ''));
    assert.deepEqual(run(), [
      { file: 'BUILD.md', line: lineOf(build, '## Phase 1'), message: 'BUILD.md lacks a row for P1/S-02; run slicekit status --write' },
    ]);
  });
});

test('a row without a slice file is a finding', () => {
  withKit(({ root, build, run }) => {
    fs.rmSync(path.join(root, 'docs', 'phases', 'P1-x', 'S-03-a.md'));
    assert.deepEqual(run(), [
      { file: 'BUILD.md', line: lineOf(build, '| S-03 |'), message: 'BUILD.md row for P1/S-03 has no slice file' },
    ]);
  });
});

test('a difference outside the rows is one finding at line 1', () => {
  withKit(({ build, run }) => {
    fs.writeFileSync(build, fs.readFileSync(build, 'utf8').replace('# BUILD — the queue', '# BUILD — our queue'));
    assert.deepEqual(run(), [{ file: 'BUILD.md', line: 1, message: 'BUILD.md is stale; run slicekit status --write' }]);
  });
});

test('a BUILD.md without the marker, or no BUILD.md, is a finding', () => {
  withKit(({ build, run }) => {
    fs.writeFileSync(build, fs.readFileSync(build, 'utf8').replace(MARKER, ''));
    assert.deepEqual(run(), [{ file: 'BUILD.md', line: 1, message: 'BUILD.md has no generated region marker; run slicekit status --write' }]);
    fs.rmSync(build);
    assert.deepEqual(run(), [{ file: 'BUILD.md', line: 0, message: 'BUILD.md is missing; run slicekit status --write' }]);
  });
});

test('a repository that has not planned is silent', () => {
  withKit(
    ({ build, run }) => {
      assert.deepEqual(run(), []);
      fs.rmSync(build, { force: true });
      assert.deepEqual(run(), []);
    },
    { slices: 0 },
  );
});

test("the kit's own queue is current", () => {
  const result = check(kitRoot, { rules: [queue] });
  assert.deepEqual(result.findings.filter((f) => f.rule === 'queue'), []);
});
