import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultConfig } from '../src/config.js';
import { git } from '../src/git.js';
import { STAGES, StageError, programStage, requireStage } from '../src/stage.js';
import { makeRepo } from './helpers/tmp-repo.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'stage');
const cfg = defaultConfig({ name: 'demo', shape: 'backend' });

// Copies the named fixture points, in order, into a temp repo; commits them unless `commit` is false.
function stageRepo(points, { commit = true } = {}) {
  const repo = makeRepo();
  for (const p of points) fs.cpSync(path.join(FIXTURES, p), repo.root, { recursive: true });
  if (commit) {
    git(repo.root, ['add', '-A']);
    git(repo.root, ['commit', '-m', 'fixture']);
  }
  return repo;
}

function withPoint(points, fn, opts) {
  const repo = stageRepo(points, opts);
  try {
    return fn(repo.root);
  } finally {
    repo.cleanup();
  }
}

const PLAN = ['after-intake', 'after-plan'];
const edit = (root, rel, fn) => {
  const f = path.join(root, rel);
  fs.writeFileSync(f, fn(fs.readFileSync(f, 'utf8')));
};

test('program stage derives from files', () => {
  withPoint(['after-intake'], (root) => {
    const r = programStage(root, cfg);
    assert.equal(r.stage, 'clarify');
    assert.equal(r.complete, false);
    assert.match(r.blockers[0], /decisions\.md/);
  });
  withPoint(PLAN, (root) => {
    const r = programStage(root, cfg);
    assert.deepEqual(r, { stage: 'build', complete: false, blockers: ['P1/S-01 is todo, not merged'] });
  });
  withPoint([...PLAN, 'all-merged'], (root) => {
    assert.deepEqual(programStage(root, cfg), { stage: 'release', complete: true, blockers: [] });
  });
  assert.deepEqual(STAGES, ['intake', 'clarify', 'specify', 'spec-review', 'gap-scan', 'stack', 'plan', 'build', 'release']);
});

test('an empty repository is at intake', () => {
  const repo = makeRepo();
  try {
    const r = programStage(repo.root, cfg);
    assert.equal(r.stage, 'intake');
    assert.equal(r.complete, false);
  } finally {
    repo.cleanup();
  }
});

test('intake needs a sidecar whose hash matches', () => {
  withPoint(['after-intake'], (root) => {
    edit(root, 'docs/intake/2026-01-01-brief.md', () => 'Changed.');
    const r = programStage(root, cfg);
    assert.equal(r.stage, 'intake');
    assert.match(r.blockers[0], /2026-01-01-brief\.md/);
  });
  withPoint(['after-intake'], (root) => {
    fs.rmSync(path.join(root, 'docs/intake/2026-01-01-brief.md.meta.json'));
    assert.equal(programStage(root, cfg).stage, 'intake');
  });
});

test('clarify blocks on an Open decision that the spec cites', () => {
  withPoint(PLAN, (root) => {
    edit(root, 'docs/decisions.md', (t) => `${t}| D-02 | Open | Which port? | matters | 80 |\n`);
    assert.equal(programStage(root, cfg).stage, 'build');
    edit(root, 'docs/spec/a.md', (t) => t.replace('D-01.', 'D-01, D-02.'));
    const r = programStage(root, cfg);
    assert.equal(r.stage, 'clarify');
    assert.deepEqual(r.blockers, ['D-02 is Open and cited by the spec']);
  });
});

test('specify names each REQ that lacks a part, and a spec with no REQ', () => {
  withPoint(PLAN, (root) => {
    edit(root, 'docs/spec/a.md', (t) => t.replace('Enforced by: advisory\n', ''));
    const r = programStage(root, cfg);
    assert.equal(r.stage, 'specify');
    assert.equal(r.blockers.length, 1);
    assert.match(r.blockers[0], /REQ-1\.1/);
    assert.match(r.blockers[0], /Enforced by/);
  });
  withPoint(PLAN, (root) => {
    edit(root, 'docs/spec/a.md', (t) => t.replace('SHALL', 'will'));
    assert.match(programStage(root, cfg).blockers[0], /SHALL/);
  });
  withPoint(PLAN, (root) => {
    fs.writeFileSync(path.join(root, 'docs/spec/a.md'), '# A\n\nNothing yet.\n');
    const r = programStage(root, cfg);
    assert.equal(r.stage, 'specify');
    assert.match(r.blockers[0], /no REQ/);
  });
});

test('spec-review blocks on an uncommitted spec change and on no git repository', () => {
  withPoint(PLAN, (root) => {
    edit(root, 'docs/spec/a.md', (t) => `${t}\nMore.\n`);
    const r = programStage(root, cfg);
    assert.equal(r.stage, 'spec-review');
    assert.match(r.blockers[0], /docs\/spec/);
  });
  withPoint(PLAN, (root) => {
    fs.writeFileSync(path.join(root, 'docs/spec/b.md'), '# B\n');
    assert.equal(programStage(root, cfg).stage, 'spec-review');
  });
  withPoint(PLAN, (root) => {
    const r = programStage(root, { ...cfg, defaultBranch: 'nope' });
    assert.equal(r.stage, 'spec-review');
    assert.match(r.blockers[0], /nope/);
  });
});

test('a tree that is not a repository stops at spec-review, never complete', () => {
  const repo = stageRepo(PLAN, { commit: false });
  try {
    fs.rmSync(path.join(repo.root, '.git'), { recursive: true, force: true });
    const r = programStage(repo.root, cfg);
    assert.deepEqual(r, { stage: 'spec-review', complete: false, blockers: ['spec review needs a git repository'] });
  } finally {
    repo.cleanup();
  }
});

test('gap-scan blocks on an open gap row, by ID', () => {
  withPoint(PLAN, (root) => {
    edit(root, 'docs/spec/gaps.md', (t) => `${t}| G-02 | vague | REQ-1.1 | what | |\n`);
    git(root, ['add', '-A']);
    git(root, ['commit', '-m', 'gap']);
    const r = programStage(root, cfg);
    assert.equal(r.stage, 'gap-scan');
    assert.deepEqual(r.blockers, ['G-02 is not closed']);
  });
  withPoint(PLAN, (root) => {
    fs.rmSync(path.join(root, 'docs/spec/gaps.md'));
    git(root, ['add', '-A']);
    git(root, ['commit', '-m', 'no gaps']);
    const r = programStage(root, cfg);
    assert.equal(r.stage, 'gap-scan');
    assert.match(r.blockers[0], /gaps\.md/);
  });
});

test('stack blocks on a marker or on Not yet known', () => {
  for (const text of ['Node. [NEEDS CLARIFICATION: db?]\n', '# Stack\n\nNot yet known\n']) {
    withPoint(PLAN, (root) => {
      fs.writeFileSync(path.join(root, 'docs/spec/stack.md'), text);
      git(root, ['add', '-A']);
      git(root, ['commit', '-m', 'stack']);
      const r = programStage(root, cfg);
      assert.equal(r.stage, 'stack');
      assert.equal(r.complete, false);
    });
  }
});

test('plan blocks on an uncovered REQ and on an unmerged plan', () => {
  withPoint(PLAN, (root) => {
    edit(root, 'docs/spec/a.md', (t) => `${t}\n### REQ-1.2 Another\n\nIt SHALL also work.\n\nScenario: GIVEN a WHEN b THEN c.\n\nCites: D-01.\n\nEnforced by: advisory\n`);
    git(root, ['add', '-A']);
    git(root, ['commit', '-m', 'req']);
    const r = programStage(root, cfg);
    assert.equal(r.stage, 'plan');
    assert.deepEqual(r.blockers, ['REQ-1.2 is named by no slice file']);
  });
  withPoint(PLAN, (root) => {
    edit(root, 'docs/phases/P1-x/S-01-a.md', (t) => `${t}\nMore.\n`);
    const r = programStage(root, cfg);
    assert.equal(r.stage, 'plan');
    assert.match(r.blockers[0], /docs\/phases/);
  });
});

test('release blocks on a phase with no release record', () => {
  withPoint([...PLAN, 'all-merged'], (root) => {
    fs.rmSync(path.join(root, 'docs/releases/P1.md'));
    const r = programStage(root, cfg);
    assert.equal(r.stage, 'release');
    assert.equal(r.complete, false);
    assert.deepEqual(r.blockers, ['P1 has no releases/P1.md']);
  });
});

test('requireStage names the command that does it', () => {
  withPoint(['after-intake'], (root) => {
    assert.doesNotThrow(() => requireStage(root, cfg, 'intake'));
    assert.throws(
      () => requireStage(root, cfg, 'specify'),
      (e) => {
        assert.ok(e instanceof StageError);
        assert.equal(e.stage, 'clarify');
        assert.match(e.message, /^clarify not done: .*decisions\.md.*; run \/slicekit intake \(clarify\)$/);
        return true;
      },
    );
  });
  withPoint(PLAN, (root) => {
    fs.rmSync(path.join(root, 'docs/spec/gaps.md'));
    git(root, ['add', '-A']);
    git(root, ['commit', '-m', 'no gaps']);
    assert.throws(() => requireStage(root, cfg, 'stack'), /^StageError: gap-scan not done: .*; run \/slicekit gaps$/);
  });
  withPoint(PLAN, (root) => {
    assert.doesNotThrow(() => requireStage(root, cfg, 'plan'));
    assert.throws(() => requireStage(root, cfg, 'build'), /build not done: P1\/S-01 is todo, not merged; run \/slicekit build/);
    assert.throws(() => requireStage(root, cfg, 'nonsense'), /unknown stage/);
  });
});
