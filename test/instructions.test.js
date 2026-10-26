// REQ-2.12: `slicekit instructions` is the one home of every agent brief and every command procedure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { defaultConfig } from '../src/config.js';
import { main } from '../src/cli/index.js';
import { InstructionsError, PROCEDURES, SUMMARY_MAX, briefSlice, renderBrief, renderProcedure, renderSummary } from '../src/instructions.js';
import { prose } from '../src/markdown.js';
import { reqBlocks } from '../src/stage.js';
import { makeRepo } from './helpers/tmp-repo.js';

const ROLES = ['developer', 'reviewer', 'fixer', 'auditor', 'ops', 'designer'];
const RULE = '- State the fact, the consequence, the check. Not the importance.';

const SLICE = `---
slice: P1/S-01
name: First
repo: .
group: A
runbook: no
requirements: [REQ-1.1, REQ-9.9]
decisions: [D-01, D-77]
---

## Done when

1. It works.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| \`a.test.js » works\` | happy | REQ-1.1 |

## Notes

A section the brief leaves out.

## Expected changes

\`src/a.js\`.

## Tasks

### Task 1: The first

\`\`\`
## not a heading
\`\`\`
`;

const SPEC = `# Spec

### REQ-1.1 The first requirement

The tool SHALL work.

### REQ-1.2 The second

Other text.
`;

const DECISIONS = `# Decisions

## Settled

| # | Type | Question | Answer | Who, when |
|---|------|----------|--------|-----------|
| D-01 | Decision | Which runtime? | Node | ann, 2026-01-01 |

## Open

| # | Type | Question | Why it matters | Recommendation |
|---|------|----------|----------------|----------------|
`;

// A temp repository with a config of the shape, one slice file, one spec file and one decisions file.
function project(shape = 'backend', { commands = { test: 'npm test' } } = {}) {
  const cfg = defaultConfig({ name: 'demo', shape, commands, cli: 'npx slicekit' });
  const repo = makeRepo({
    commits: 1,
    files: {
      '.slicekit/config.json': `${JSON.stringify(cfg, null, 2)}\n`,
      'docs/phases/P1-x/S-01-first.md': SLICE,
      'docs/spec/01-first.md': SPEC,
      'docs/decisions.md': DECISIONS,
    },
  });
  return { ...repo, cfg };
}

// A templates directory with a brief per role and the given procedures.
function templates({ commands = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-tpl-'));
  fs.mkdirSync(path.join(dir, 'agents'));
  fs.mkdirSync(path.join(dir, 'commands'));
  for (const r of ROLES) fs.writeFileSync(path.join(dir, 'agents', `${r}.md`), `# Brief: ${r}\n\nRun \`{{cli}} check\`.\n`);
  for (const [name, text] of Object.entries(commands)) fs.writeFileSync(path.join(dir, 'commands', `${name}.md`), text);
  return dir;
}

async function cli(root, args) {
  let stdout = '';
  let stderr = '';
  const code = await main(args, { cwd: root, stdout: (s) => { stdout += s; }, stderr: (s) => { stderr += s; } });
  return { code, stdout, stderr };
}

const codeOf = (fn) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof InstructionsError) return { code: e.code, message: e.message };
    throw e;
  }
  return null;
};

// ---- evaluation set ----

// REQ-2.12
test("instructions.test.js » each role's brief inlines the slice file, its REQ and D rows and the writing rules", () => {
  const dir = templates();
  for (const [shape, roles] of [['backend', ROLES.filter((r) => r !== 'designer')], ['fullstack', ['designer']]]) {
    const { root, cfg, cleanup } = project(shape);
    try {
      for (const role of roles) {
        const t = renderBrief(root, cfg, role, 'P1/S-01', { templatesDir: dir });
        assert.ok(t.startsWith(`# Brief: ${role}\n`), t);
        assert.match(t, /Run `npx slicekit check`\./, '{{cli}} replaced');
        assert.match(t, /^## Slice P1\/S-01$/m);
        assert.match(t, /^- name: First$/m, 'front matter summary');
        assert.match(t, /^### Done when$/m, 'slice headings demoted one level');
        assert.match(t, /^### Evaluation set$/m);
        assert.match(t, /^### Expected changes$/m);
        assert.doesNotMatch(t, /Notes|A section the brief leaves out/, 'other slice sections are left out');
        assert.match(t, /^#### Task 1: The first$/m);
        assert.match(t, /^## not a heading$/m, 'fenced text verbatim');
        assert.match(t, /^#### REQ-1\.1 The first requirement$/m, 'REQ heading demoted one level');
        assert.match(t, /The tool SHALL work\./);
        assert.doesNotMatch(t, /REQ-1\.2 The second/, 'only the named REQ');
        assert.match(t, /^REQ-9\.9: not found under docs\/spec\/$/m);
        assert.ok(t.includes('- D-01 (Decision): Which runtime? → Node'), t);
        assert.match(t, /^- D-77: not found in decisions\.md$/m);
        assert.match(t, /^- test: npm test$/m);
        assert.match(t, /^- lint: not declared$/m);
        assert.match(t, /^## Writing rules$/m);
        assert.ok(t.split('\n').includes(RULE), t);
        assert.doesNotMatch(t, /^# Writing rules$/m, 'the template heading is removed');
        assert.match(t, /^### Filler the check rejects$/m, 'rules headings demoted one level');
        assert.doesNotMatch(t, /^name: slicekit-writing/m, 'front matter removed');
        // The essentials first, the long Tasks section last; fenced lines are not headings.
        const tops = (s) => [...prose(s)].map(([l]) => l).filter((l) => /^## /.test(l));
        const base = ['## Writing rules', '## Requirements', '## Decisions', '## Slice P1/S-01', '## Team commands'];
        assert.deepEqual(tops(t), [...base, '## Tasks'], t);
        const w = renderBrief(root, cfg, role, 'P1/S-01', { templatesDir: dir, worktree: path.join(root, 'wt') });
        assert.deepEqual(tops(w), [...base, '## Where', '## Tasks'], w);
      }
    } finally {
      cleanup();
    }
  }
});

// REQ-2.12
test('instructions.test.js » an unknown role exits 2', async () => {
  const { root, cleanup } = project('backend');
  try {
    const r = await cli(root, ['instructions', 'tester']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /^slicekit: unknown role 'tester'; one of developer, reviewer, fixer, auditor, ops, designer\n$/);
    const d = await cli(root, ['instructions', 'designer']);
    assert.equal(d.code, 2);
    assert.match(d.stderr, /designer is not installed for shape backend/);
    assert.equal(d.stdout, '');
  } finally {
    cleanup();
  }
});

// REQ-2.12
test('instructions.test.js » the slice comes from the branch when no argument is given', () => {
  const { root, cfg, cleanup } = project('backend');
  const dir = templates();
  try {
    execFileSync('git', ['checkout', '-q', '-b', 'slice/P1-S-01-x'], { cwd: root });
    const id = briefSlice(root, undefined);
    assert.equal(id, 'P1/S-01');
    const t = renderBrief(root, cfg, 'developer', id, { templatesDir: dir });
    assert.match(t, /^## Slice P1\/S-01$/m);
    assert.doesNotMatch(t, /## Where/);
    const wt = path.join(root, '.worktrees', 'P1-S-01');
    const w = renderBrief(root, cfg, 'developer', id, { templatesDir: dir, worktree: wt });
    assert.ok(w.includes(`## Where\n\nWork only under ${wt.split(path.sep).join('/')}; use absolute paths.`), w);
    assert.ok(w.indexOf('## Where') < w.indexOf('\n## Tasks\n'), 'Where comes before the tasks');
    // M-3: a branch naming a slice with no slice file gives no active slice, not an error.
    execFileSync('git', ['checkout', '-q', '-b', 'slice/P1-S-07-y'], { cwd: root });
    const id7 = briefSlice(root, undefined);
    const n = renderBrief(root, cfg, 'developer', id7, { templatesDir: dir, fromBranch: true });
    assert.ok(n.includes('## Slice\n\nNo active slice. (branch names P1/S-07, which has no slice file)'), n);
  } finally {
    cleanup();
  }
});

// REQ-2.12
test('instructions.test.js » a command whose procedure is not built exits 1', () => {
  const { root, cfg, cleanup } = project('backend');
  try {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-tpl-'));
    assert.deepEqual(codeOf(() => renderProcedure(root, cfg, 'plan', [], { templatesDir: empty })), {
      code: 1,
      message: 'the /slicekit plan command is not built in this version',
    });
    assert.deepEqual(codeOf(() => renderProcedure(root, cfg, 'foo', [], { templatesDir: empty })), {
      code: 2,
      message: "unknown command 'foo'",
    });
  } finally {
    cleanup();
  }
});

// ---- further cases ----

test('instructions » PROCEDURES names the nine commands', () => {
  assert.deepEqual(PROCEDURES, ['intake', 'specify', 'gaps', 'plan', 'build', 'review', 'release', 'ops', 'audit']);
});

test('instructions » a procedure has {{cli}} and {{args}} replaced', () => {
  const { root, cfg, cleanup } = project('backend');
  const dir = templates({ commands: { build: 'Run `{{cli}} build next {{args}}`.\n' } });
  try {
    assert.equal(renderProcedure(root, cfg, 'build', ['--parallel', 'P2'], { templatesDir: dir }), 'Run `npx slicekit build next --parallel P2`.\n');
    assert.equal(renderProcedure(root, cfg, 'build', [], { templatesDir: dir }), 'Run `npx slicekit build next (none)`.\n');
  } finally {
    cleanup();
  }
});

test('instructions » --command passes everything after the name through unparsed', async () => {
  const { root, cleanup } = project('backend');
  try {
    // An unbuilt command (audit, a Phase 4 procedure) exits 1, even with options after it.
    const r = await cli(root, ['instructions', '--command', 'audit', '--parallel', 'P2']);
    assert.equal(r.code, 1);
    assert.equal(r.stderr, 'slicekit: the /slicekit audit command is not built in this version\n');
    const u = await cli(root, ['instructions', '--command', 'nosuch']);
    assert.equal(u.code, 2);
    assert.equal(u.stderr, "slicekit: unknown command 'nosuch'\n");
    assert.equal((await cli(root, ['instructions', '--command'])).code, 2);
    assert.equal((await cli(root, ['instructions'])).code, 2);
  } finally {
    cleanup();
  }
});

test('instructions » briefSlice: an address, a bad address, no branch, no repository', () => {
  const { root, cleanup } = project('backend');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-norepo-'));
  try {
    assert.equal(briefSlice(root, 'P2/S-09'), 'P2/S-09');
    assert.deepEqual(codeOf(() => briefSlice(root, 'S-09')), { code: 2, message: 'not a slice address: S-09' });
    assert.equal(briefSlice(root, undefined), null, 'main is not a slice branch');
    assert.equal(briefSlice(outside, undefined), null);
  } finally {
    cleanup();
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('instructions » no active slice, an unknown slice, the project writing rules', () => {
  const { root, cfg, cleanup } = project('backend');
  const dir = templates();
  try {
    const t = renderBrief(root, cfg, 'reviewer', null, { templatesDir: dir });
    assert.ok(t.includes('## Slice\n\nNo active slice.'), t);
    assert.deepEqual(codeOf(() => renderBrief(root, cfg, 'reviewer', 'P1/S-05', { templatesDir: dir })), { code: 2, message: 'unknown slice P1/S-05' });
    const skill = path.join(root, '.claude', 'skills', 'slicekit-writing', 'SKILL.md');
    fs.mkdirSync(path.dirname(skill), { recursive: true });
    fs.writeFileSync(skill, '---\nname: slicekit-writing\ndescription: x\n---\n# Writing rules\n\n- Project rule.\n');
    const p = renderBrief(root, cfg, 'reviewer', null, { templatesDir: dir });
    assert.ok(p.includes('## Writing rules\n\n- Project rule.\n\n## Requirements'), p);
  } finally {
    cleanup();
  }
});

test('instructions » the CLI prints a brief for a slice given as an argument', async () => {
  const { root, cleanup } = project('backend');
  try {
    const r = await cli(root, ['instructions', 'developer', 'P1/S-01', '--worktree', 'wt']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stderr, '');
    assert.ok(r.stdout.startsWith('# Brief: developer\n'), r.stdout);
    const tops = [...prose(r.stdout)].map(([l]) => l).filter((l) => /^## /.test(l));
    assert.deepEqual(tops, [
      '## You write',
      '## Tests first',
      '## Then code',
      '## You never',
      '## Your report',
      '## Writing rules',
      '## Requirements',
      '## Decisions',
      '## Slice P1/S-01',
      '## Team commands',
      '## Where',
      '## Tasks',
    ]);
    assert.ok(r.stdout.includes('- D-01 (Decision): Which runtime? → Node'), r.stdout);
    assert.match(r.stdout, /^#### REQ-1\.1 The first requirement$/m);
    assert.match(r.stdout, /^- test: npm test$/m);
    assert.ok(r.stdout.includes(`Work only under ${path.resolve(root, 'wt').split(path.sep).join('/')}; use absolute paths.`));
    assert.equal((await cli(root, ['instructions', 'developer', 'nope'])).code, 2);
  } finally {
    cleanup();
  }
});

test('stage » reqBlocks gives each REQ its file and the 1-based line of its heading', () => {
  const { root, cfg, cleanup } = project('backend');
  try {
    const blocks = reqBlocks(root, cfg);
    assert.deepEqual(blocks.map(({ id, file, line }) => ({ id, file, line })), [
      { id: 'REQ-1.1', file: 'docs/spec/01-first.md', line: 3 },
      { id: 'REQ-1.2', file: 'docs/spec/01-first.md', line: 7 },
    ]);
    assert.match(blocks[0].block, /The tool SHALL work\./);
  } finally {
    cleanup();
  }
});

test('instructions » usage errors name their reason; the role is checked before the slice', async () => {
  const { root, cleanup } = project('backend');
  try {
    const none = await cli(root, ['instructions']);
    assert.equal(none.code, 2);
    assert.match(none.stderr, /^slicekit: missing role\nusage: /);
    assert.match((await cli(root, ['instructions', '--command'])).stderr, /^slicekit: missing command name\nusage: /);
    const extra = await cli(root, ['instructions', 'developer', 'P1/S-01', 'more']);
    assert.equal(extra.code, 2);
    assert.match(extra.stderr, /^slicekit: unexpected argument more\nusage: /);
    const wt = await cli(root, ['instructions', 'developer', '--worktree', '']);
    assert.equal(wt.code, 2);
    assert.match(wt.stderr, /^slicekit: --worktree needs a path\n/);
    const bad = await cli(root, ['instructions', 'tester', 'nope']);
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /^slicekit: unknown role 'tester'/);
    // An explicit slice argument with no slice file is still exit 2.
    const missing = await cli(root, ['instructions', 'developer', 'P1/S-07']);
    assert.equal(missing.code, 2);
    assert.equal(missing.stderr, 'slicekit: unknown slice P1/S-07\n');
  } finally {
    cleanup();
  }
});

// The short form subagent-start injects: the role template, the rules, the slice's ids, and where the
// full brief is.
test('instructions » --summary prints the template, the rules, the slice ids and the full brief command', async () => {
  const { root, cfg, cleanup } = project('backend');
  const dir = templates();
  try {
    const t = renderSummary(root, cfg, 'reviewer', 'P1/S-01', { templatesDir: dir });
    assert.ok(t.startsWith('# Brief: reviewer\n'), t);
    assert.match(t, /Run `npx slicekit check`\./);
    assert.match(t, /^## Writing rules$/m);
    assert.equal(t.split('\n').filter((l) => l === RULE).length, 1, t);
    const tail = t.split('\n').slice(-3);
    assert.deepEqual(tail, ['Requirements: REQ-1.1, REQ-9.9', 'Decisions: D-01, D-77', 'Full brief: npx slicekit instructions reviewer P1/S-01']);
    assert.doesNotMatch(t, /The tool SHALL work|## Tasks|## Team commands/, 'the long parts stay in the full brief');
    const none = renderSummary(root, cfg, 'reviewer', null, { templatesDir: dir });
    assert.deepEqual(none.split('\n').slice(-2), ['No active slice.', 'Full brief: npx slicekit instructions reviewer']);
    assert.equal(codeOf(() => renderSummary(root, cfg, 'reviewer', 'P1/S-07', { templatesDir: dir })).code, 2);
    const fromBranch = renderSummary(root, cfg, 'reviewer', 'P1/S-07', { templatesDir: dir, fromBranch: true });
    assert.ok(fromBranch.endsWith('No active slice. (branch names P1/S-07, which has no slice file)\nFull brief: npx slicekit instructions reviewer'), fromBranch);
    // The CLI form.
    const r = await cli(root, ['instructions', 'developer', 'P1/S-01', '--summary']);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.stdout.startsWith('# Brief: developer\n'), r.stdout);
    assert.ok(r.stdout.endsWith('Full brief: npx slicekit instructions developer P1/S-01\n'), r.stdout);
    const both = await cli(root, ['instructions', 'developer', '--summary', '--worktree', 'wt']);
    assert.equal(both.code, 2);
    assert.match(both.stderr, /^slicekit: --summary takes no --worktree\n/);
  } finally {
    cleanup();
  }
});

test('instructions » a summary stays under its cap for a slice naming hundreds of ids', () => {
  const { root, cfg, cleanup } = project('backend');
  try {
    const reqs = Array.from({ length: 600 }, (_, i) => `REQ-1.${i + 1}`);
    const ds = Array.from({ length: 600 }, (_, i) => `D-${i + 1}`);
    const file = path.join(root, 'docs/phases/P1-x/S-01-first.md');
    fs.writeFileSync(file, SLICE.replace('[REQ-1.1, REQ-9.9]', `[${reqs.join(', ')}]`).replace('[D-01, D-77]', `[${ds.join(', ')}]`));
    assert.ok(SUMMARY_MAX <= 6000, String(SUMMARY_MAX));
    for (const role of ROLES.filter((r) => r !== 'designer')) {
      const t = renderSummary(root, cfg, role, 'P1/S-01');
      assert.ok(t.length <= SUMMARY_MAX, `${role}: ${t.length}`);
      assert.match(t, /^Requirements: REQ-1\.1, REQ-1\.2, .*, and \d+ more$/m);
      assert.match(t, /^Decisions: D-1, D-2, .*, and \d+ more$/m);
      assert.ok(t.endsWith(`Full brief: npx slicekit instructions ${role} P1/S-01`), t.slice(-100));
    }
  } finally {
    cleanup();
  }
});
