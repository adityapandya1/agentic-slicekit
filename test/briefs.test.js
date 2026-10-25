// REQ-2.1, REQ-2.12: the kit's agent briefs, its command pointers and the lint that holds every brief
// and procedure to the writing rules and to the git rule (commands own git; an agent never does).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultConfig } from '../src/config.js';
import { PROCEDURES, TEMPLATES, renderBrief } from '../src/instructions.js';
import { briefProblems } from './helpers/brief-lint.js';
import { shapeProblems } from '../src/hooks/shapes.js';
import { NO_GIT } from '../src/hooks/subagent-start.js';
import { parseVerdict, verdictProblems } from '../src/verdict.js';
import { makeRepo } from './helpers/tmp-repo.js';

const ROLES = ['developer', 'reviewer', 'fixer', 'auditor', 'ops', 'designer'];
const KIT = fileURLToPath(new URL('../templates/', import.meta.url));
const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const mdIn = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => path.join(dir, f)) : []);

// ---- evaluation set ----

// REQ-2.1
test('briefs.test.js » no brief tells an agent to run git', () => {
  const agents = mdIn(path.join(TEMPLATES, 'agents'));
  assert.deepEqual(agents.map((f) => path.basename(f, '.md')).sort(), [...ROLES].sort());
  for (const f of agents) assert.deepEqual(briefProblems(read(f), { kind: 'agent' }), [], f);
  for (const f of mdIn(path.join(TEMPLATES, 'commands'))) assert.deepEqual(briefProblems(read(f), { kind: 'command' }), [], f);
  // The rendered pointers are held to the same rules.
  for (const f of mdIn(path.join(KIT, 'claude-code', 'agents'))) assert.deepEqual(briefProblems(read(f), { kind: 'agent' }), [], f);
  for (const f of mdIn(path.join(KIT, 'claude-code', 'commands'))) assert.deepEqual(briefProblems(read(f), { kind: 'command' }), [], f);

  const footer = '\n\nEnd with a `Skipped:` line and a `Not checked:` line.\n';
  assert.deepEqual(briefProblems(`Run \`git commit -m x\`.${footer}`, { kind: 'agent' }), [
    'brief tells an agent to run git: Run `git commit -m x`.',
  ]);
  assert.deepEqual(briefProblems(`Run \`{{cli}} nosuch\`.${footer}`, { kind: 'agent' }), ['unknown command nosuch']);
  assert.deepEqual(briefProblems(`Read it with \`git diff main...HEAD\`.${footer}`, { kind: 'agent' }), []);
});

// ---- further cases ----

test('briefs » each pointer names its own command', () => {
  const dir = path.join(KIT, 'claude-code', 'commands');
  const names = mdIn(dir).map((f) => path.basename(f, '.md').replace(/^slicekit-/, '')).sort();
  assert.deepEqual(names, [...PROCEDURES].sort());
  for (const name of names) {
    const text = read(path.join(dir, `slicekit-${name}.md`));
    const body = text.replace(/^---\n[\s\S]*?\n---\n/, '');
    assert.ok(body.includes(`instructions --command ${name} $ARGUMENTS`), name);
    assert.equal(
      body.trim(),
      `Run \`{{cli}} instructions --command ${name} $ARGUMENTS\` and follow the procedure it prints. The procedure is the only source of this command's rules.\n\nWriting rules: \`.claude/skills/slicekit-writing/SKILL.md\`.`,
      name,
    );
  }
});

test("briefs » the kit's templates render every role", () => {
  for (const shape of ['backend', 'fullstack']) {
    const cfg = defaultConfig({ name: 'demo', shape, cli: 'npx slicekit' });
    const { root, cleanup } = makeRepo({ commits: 1, files: { '.slicekit/config.json': `${JSON.stringify(cfg, null, 2)}\n` } });
    try {
      for (const role of ROLES.filter((r) => shape === 'fullstack' || r !== 'designer')) {
        const t = renderBrief(root, cfg, role, null);
        assert.ok(t.startsWith(`# Brief: ${role}\n`), t);
        for (const h of ['## You write', '## You never', '## Your report']) assert.match(t, new RegExp(`^${h}$`, 'm'), `${role}: ${h}`);
        assert.doesNotMatch(t, /\{\{cli\}\}/, `${role}: {{cli}} replaced`);
      }
    } finally {
      cleanup();
    }
  }
});

// Each brief states the shape subagent-stop checks for its role (src/hooks/shapes.js, src/verdict.js).
test('briefs » each brief states the reply shape its role is checked for', () => {
  const brief = (r) => read(path.join(TEMPLATES, 'agents', `${r}.md`));
  for (const r of ROLES) {
    assert.match(brief(r), /`Skipped:`/, r);
    assert.match(brief(r), /`Not checked:`/, r);
  }
  assert.match(brief('developer'), /`ran: <command> → exit <code>`/);
  assert.match(brief('fixer'), /`B-<n>`/);
  assert.match(brief('fixer'), /`H-<n>`/);
  const rv = brief('reviewer');
  for (const s of [
    '`.slicekit/reviews/P<n>-S-<nn>[i]-r<k>.md`',
    '`Verdict: BLOCK`',
    '`Verdict: CHANGES`',
    '`Verdict: APPROVE`',
    '| ID | File:line | What is wrong | Why it matters | How verified |',
    '## Checklists run',
    '## Not checked',
  ]) assert.ok(rv.includes(s), s);
  assert.match(brief('ops'), /who may take/);
  assert.match(brief('designer'), /no code/i);
});

test('briefs » the lint names each problem', () => {
  const footer = '\n\nEnd with a `Skipped:` line and a `Not checked:` line.\n';
  const agent = (t) => briefProblems(`${t}${footer}`, { kind: 'agent' });
  const command = (t) => briefProblems(t, { kind: 'command' });
  // A subcommand is checked against the command object's list.
  assert.deepEqual(agent('Run `{{cli}} decide add --type Decision`.'), []);
  assert.deepEqual(agent('Run `{{cli}} decide remove D-01`.'), ['unknown subcommand decide remove']);
  assert.deepEqual(agent('Run `{{cli}} check`, then `{{cli}} instructions developer`.'), []);
  // A writing git command or any gh call; a line that forbids it is allowed.
  assert.deepEqual(agent('Run `git push`.'), ['brief tells an agent to run git: Run `git push`.']);
  assert.deepEqual(agent('Open it with `gh pr create`.'), ['brief tells an agent to run git: Open it with `gh pr create`.']);
  assert.deepEqual(agent('git checkout -b x'), ['brief tells an agent to run git: git checkout -b x']);
  assert.deepEqual(agent('You never run `git commit` or `gh pr create`.'), []);
  assert.deepEqual(agent('Read `git log -3`, `git show HEAD` and `git status --short`.'), []);
  assert.deepEqual(agent('Run `cd x && git commit -m y`.'), ['brief tells an agent to run git: Run `cd x && git commit -m y`.']);
  // A procedure runs no git at all, not even to read.
  assert.deepEqual(command('Read `git diff main...HEAD`.'), ['procedure runs git: Read `git diff main...HEAD`.']);
  assert.deepEqual(command('Never run `git push`.'), ['procedure runs git: Never run `git push`.']);
  assert.deepEqual(command('```\ngh pr view 3\n```'), ['procedure runs git: gh pr view 3']);
  assert.deepEqual(command('Git is the command\'s job; run `{{cli}} check`.'), []);
  // Filler, and the footer a brief must require.
  assert.deepEqual(agent('A robust design.'), ['banned phrase "robust"']);
  assert.deepEqual(agent('It is a `robust` word.'), [], 'code spans are not prose');
  assert.deepEqual(briefProblems('Write tests.\n', { kind: 'agent' }), [
    'brief does not require "Skipped:"',
    'brief does not require "Not checked:"',
  ]);
  assert.deepEqual(briefProblems('Write tests.\n', { kind: 'command' }), [], 'a procedure needs no footer');
  assert.deepEqual(briefProblems('Run `{{cli}} x`.', { kind: 'command', commands: { x: { run() {} } }, banned: [] }), []);
});

// The first fenced block of a text, without its fence lines.
const firstFence = (text) => {
  const m = /^```[^\n]*\n([\s\S]*?)\n```$/m.exec(text);
  assert.ok(m, 'a fenced example');
  return m[1];
};

// The examples a brief shows pass the checks the stop hook runs on what the agent writes.
test('briefs » each example in a brief passes the shape check it shows', () => {
  const brief = (r) => read(path.join(TEMPLATES, 'agents', `${r}.md`));
  assert.deepEqual(verdictProblems(parseVerdict(firstFence(brief('reviewer')), 'x.md')), []);
  for (const role of ['developer', 'fixer']) {
    assert.deepEqual(shapeProblems(role, firstFence(brief(role)), { root: '/nowhere' }), [], role);
  }
});

test('briefs » each brief says the checked lines carry no list marker, bold or backticks', () => {
  const sentence = 'Each of these lines starts at the beginning of its line, with no list marker, bold or backticks.';
  for (const r of ROLES) {
    const t = read(path.join(TEMPLATES, 'agents', `${r}.md`));
    assert.ok(t.includes(sentence), r);
    // The report section shows no checked line as a list item.
    const report = t.slice(t.indexOf('## Your report'));
    assert.doesNotMatch(report, /^\s*(?:[-*+]|\d+[.)])\s+.*(?:`ran:|`Skipped:`|`Not checked:`)/m, r);
  }
});

test('briefs » the auditor marks each claim holds, drifted or unverifiable', () => {
  const t = read(path.join(TEMPLATES, 'agents', 'auditor.md'));
  for (const w of ['`holds`', '`drifted`', '`unverifiable`']) assert.ok(t.includes(w), w);
});

test('briefs » the reviewer brief gives one verdict rule per sentence', () => {
  const t = read(path.join(TEMPLATES, 'agents', 'reviewer.md'));
  assert.match(t, /^- `Verdict: BLOCK` when any blocker is open\.$/m);
  assert.match(t, /^- `Verdict: CHANGES` when there is no blocker and at least one should-have\.$/m);
  assert.match(t, /^- `Verdict: APPROVE` when there is no blocker and no should-have you want fixed\.$/m);
});

// The agent definitions: the no-git sentence names the git a subagent may not run, and every role
// that writes a file holds the Write tool.
test('briefs » the agent definitions carry the no-git sentence and the tools their role needs', () => {
  assert.equal(NO_GIT, 'You never run a git command that commits, pushes or moves a branch; report and the command commits.');
  for (const r of ROLES) {
    const t = read(path.join(KIT, 'claude-code', 'agents', `${r}.md`));
    assert.ok(t.includes(NO_GIT), r);
    const tools = /^tools: (.*)$/m.exec(t)[1].split(',').map((s) => s.trim());
    assert.ok(tools.includes('Write'), `${r}: ${tools}`);
  }
});

test('briefs » the lint reads never per sentence and the footer from the report section', () => {
  const footer = '\n\n## Your report\n\nEnd with a `Skipped:` line and a `Not checked:` line.\n';
  const agent = (t) => briefProblems(`${t}${footer}`, { kind: 'agent' });
  assert.deepEqual(agent('Never guess. Run `git push` after.'), ['brief tells an agent to run git: Never guess. Run `git push` after.']);
  assert.deepEqual(agent('Run the tests. You never run `git push`.'), []);
  // A mention of the labels outside the report section does not count as requiring them.
  assert.deepEqual(briefProblems('Mention `Skipped:` and `Not checked:` here.\n\n## Your report\n\nA list.\n', { kind: 'agent' }), [
    'brief does not require "Skipped:"',
    'brief does not require "Not checked:"',
  ]);
});
