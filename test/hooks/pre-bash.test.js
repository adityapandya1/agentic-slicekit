import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { handle, classifyGit, segments } from '../../src/hooks/pre-bash.js';
import { markerPath, enter, leave, subagentActive } from '../../src/hooks/subagent-marker.js';
import { runHook } from '../../src/hooks/io.js';
import { defaultConfig } from '../../src/config.js';
import { makeRepo, commit } from '../helpers/tmp-repo.js';

const SESSION = 'sess-1';
const cfgFor = (over = {}) => ({ ...defaultConfig({ name: 'demo', shape: 'backend' }), ...over });
const run = (root, args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });

function decide(root, command, { cfg = cfgFor(), cwd = root, session = SESSION } = {}) {
  return handle({ session_id: session, tool_name: 'Bash', tool_input: { command }, cwd }, { root, cfg, env: {} });
}
const reason = (r) => r.hookSpecificOutput?.permissionDecisionReason;
function assertDeny(r, text) {
  assert.equal(r.hookSpecificOutput?.permissionDecision, 'deny', `expected a deny, got ${JSON.stringify(r)}`);
  assert.equal(reason(r), text);
}
function assertAllow(r) {
  assert.deepEqual(r, {}, `expected allow, got ${JSON.stringify(r)}`);
}

// A repo on `branch` with one real commit, so HEAD exists.
function repoOn(branch, files = {}) {
  const repo = makeRepo({ branch, files });
  if (Object.keys(files).length) {
    run(repo.root, ['add', '-A']);
    commit(repo.root, 'seed', { allowEmpty: false });
  } else {
    commit(repo.root, 'seed');
  }
  return repo;
}

// ---- evaluation set ----

// REQ-3.2
test('denies commit on protected branch', () => {
  const { root, cleanup } = repoOn('main');
  try {
    assertDeny(decide(root, 'git commit -m "x"'), 'commit on protected branch main; create a slice branch');
    assertDeny(decide(root, 'npm test && git commit -am x'), 'commit on protected branch main; create a slice branch');
    assertDeny(decide(root, 'git -c user.name=a --no-pager commit -m x'), 'commit on protected branch main; create a slice branch');
    assertDeny(decide(root, 'git commit -m x', { cfg: cfgFor({ protectedBranches: ['main', 'release'] }) }),
      'commit on protected branch main; create a slice branch');
  } finally {
    cleanup();
  }
});

// REQ-3.2
test('denies force push and push to main', () => {
  const { root, cleanup } = repoOn('slice/P1-S-06-x');
  try {
    assertDeny(decide(root, 'git push origin main'), 'push to protected branch main');
    assertDeny(decide(root, 'git push origin HEAD:main'), 'push to protected branch main');
    assertDeny(decide(root, 'git push origin feature:refs/heads/main'), 'push to protected branch main');
    assertDeny(decide(root, 'git push --force origin main'), 'push to protected branch main');
    assertDeny(decide(root, 'git push --all origin'), 'push to protected branch main');
    assertDeny(decide(root, 'git push --mirror'), 'push to protected branch main');
    assertDeny(decide(root, 'git push origin --delete main'), 'push to protected branch main');
    assertDeny(decide(root, 'git push origin :main'), 'push to protected branch main');
    assertDeny(decide(root, 'git push -f origin slice/P1-S-06-x'), 'force push refused');
    assertDeny(decide(root, 'git push --force-with-lease'), 'force push refused');
    assertDeny(decide(root, 'git push --force-with-lease=slice/x:abc origin'), 'force push refused');
    assertDeny(decide(root, 'git push --force-if-includes origin slice/x'), 'force push refused');
    assertDeny(decide(root, 'git push -uf origin slice/x'), 'force push refused');
    assertDeny(decide(root, 'git push origin +slice/x'), 'force push refused');
  } finally {
    cleanup();
  }
  const onMain = repoOn('main');
  try {
    assertDeny(decide(onMain.root, 'git push'), 'push to protected branch main');
    assertDeny(decide(onMain.root, 'git push origin'), 'push to protected branch main');
    assertDeny(decide(onMain.root, 'git push -u origin HEAD'), 'push to protected branch main');
  } finally {
    onMain.cleanup();
  }
});

// REQ-1.2
test('denies intake modification', () => {
  const snap = 'docs/intake/2026-01-01-a.md';
  const { root, cleanup } = repoOn('slice/P1-S-06-x', { [snap]: 'one\n' });
  const frozen = `intake snapshot ${snap} is frozen; add a new snapshot`;
  try {
    fs.writeFileSync(path.join(root, snap), 'two\n');
    // The command's own add targets.
    assertDeny(decide(root, `git add ${snap} && git commit -m x`), frozen);
    assertDeny(decide(root, 'git add -A && git commit -m x'), frozen);
    assertDeny(decide(root, 'git add docs && git commit -m x'), frozen);
    assertDeny(decide(root, 'git commit -am x'), frozen);
    assertDeny(decide(root, `git commit -m x ${snap}`), frozen);
    // From a subdirectory, the pathspec resolves against the shell's directory.
    assertDeny(decide(root, 'cd docs && git add intake && git commit -m x'), frozen);
    // Already staged.
    run(root, ['add', snap]);
    assertDeny(decide(root, 'git commit -m x'), frozen);
    // A deletion is a modification too.
    run(root, ['checkout', 'HEAD', '--', snap]);
    assertAllow(decide(root, 'git commit -m x'));
    assertDeny(decide(root, `git rm ${snap} && git commit -m x`), frozen);
    // A new snapshot is fine; adding without committing is fine.
    fs.writeFileSync(path.join(root, 'docs/intake/2026-02-02-b.md'), 'new\n');
    run(root, ['add', 'docs/intake/2026-02-02-b.md']);
    assertAllow(decide(root, 'git commit -m x'));
    fs.writeFileSync(path.join(root, snap), 'three\n');
    assertAllow(decide(root, `git add ${snap}`));
  } finally {
    cleanup();
  }
});

test('intake follows a configured docs root and is skipped with no HEAD', () => {
  const snap = 'kit-docs/intake/2026-01-01-a.md';
  const { root, cleanup } = repoOn('slice/x', { [snap]: 'one\n' });
  try {
    fs.writeFileSync(path.join(root, snap), 'two\n');
    const cfg = cfgFor({ docsRoot: 'kit-docs' });
    assertDeny(decide(root, 'git commit -am x', { cfg }), `intake snapshot ${snap} is frozen; add a new snapshot`);
    assertAllow(decide(root, 'git commit -am x'));
  } finally {
    cleanup();
  }
  const empty = makeRepo({ branch: 'slice/x', files: { 'docs/intake/a.md': 'x' } });
  try {
    run(empty.root, ['add', '-A']);
    assertAllow(decide(empty.root, 'git commit -m first'));
  } finally {
    empty.cleanup();
  }
});

// REQ-3.2
test('denies destructive pattern from config', () => {
  const { root, cleanup } = repoOn('slice/x');
  try {
    assertDeny(decide(root, 'rm -rf / --no-preserve-root'), 'destructive command refused by rule \\brm\\s+-rf\\s+(/|~|\\.\\.)');
    assertDeny(decide(root, 'psql -c "drop table users"'), 'destructive command refused by rule \\bDROP\\s+(TABLE|DATABASE|SCHEMA)\\b');
    const cfg = cfgFor({ destructive: ['\\bterraform\\s+destroy\\b'] });
    assertDeny(decide(root, 'cd infra && terraform destroy -auto-approve', { cfg }), 'destructive command refused by rule \\bterraform\\s+destroy\\b');
    assertAllow(decide(root, 'rm -rf /', { cfg }));
  } finally {
    cleanup();
  }
});

// REQ-2.1
test('denies git from a subagent', () => {
  const { root, cleanup } = repoOn('slice/P1-S-06-x');
  const msg = 'agents do not run git; report and let the command commit';
  try {
    enter(root, SESSION);
    assertDeny(decide(root, 'git commit -m x'), msg);
    assertDeny(decide(root, 'git push -u origin slice/P1-S-06-x'), msg);
    for (const sub of ['create', 'merge', 'edit', 'ready', 'close', 'comment']) {
      assertDeny(decide(root, `gh pr ${sub} --fill`), msg);
    }
    // Read-only git and gh stay available to the agent.
    assertAllow(decide(root, 'git status && git diff && gh pr view 3'));
    // Another session is not marked.
    assertAllow(decide(root, 'git commit -m x', { session: 'other' }));
    leave(root, SESSION);
    assertAllow(decide(root, 'git commit -m x'));
    assertAllow(decide(root, 'gh pr create --fill'));
  } finally {
    cleanup();
  }
});

// REQ-3.2
test('allows an ordinary command', () => {
  const { root, cleanup } = repoOn('slice/P1-S-06-x');
  try {
    assertAllow(decide(root, 'npm test'));
    assertAllow(decide(root, 'git status'));
    assertAllow(decide(root, 'git add -A && git commit -m "feat: x"'));
    assertAllow(decide(root, 'git push -u origin slice/P1-S-06-x'));
    assertAllow(decide(root, 'git push'));
    assertAllow(decide(root, 'echo "git push origin main" > notes.txt'));
    assertAllow(decide(root, 'git log --oneline main'));
  } finally {
    cleanup();
  }
});

// ---- tokenising ----

test('segments split on operators outside quotes', () => {
  assert.deepEqual(segments('a && b || c; d | e\nf'), [['a'], ['b'], ['c'], ['d'], ['e'], ['f']]);
  assert.deepEqual(segments(`echo "a && b" 'c; d'`), [['echo', 'a && b', 'c; d']]);
  assert.deepEqual(segments('(cd x && git status)'), [['cd', 'x'], ['git', 'status']]);
  assert.deepEqual(segments('echo a\\ b # tail'), [['echo', 'a b']]);
});

test('classifyGit recognises prefixes, global options and inner shells', () => {
  assert.equal(classifyGit('ls').kind, 'other');
  assert.equal(classifyGit('git status').kind, 'other');
  assert.equal(classifyGit('git commit -m x').kind, 'commit');
  assert.equal(classifyGit('FOO=bar git commit -m x').kind, 'commit');
  assert.equal(classifyGit('sudo git commit -m x').kind, 'commit');
  assert.equal(classifyGit('command git commit -m x').kind, 'commit');
  assert.equal(classifyGit('exec git commit -m x').kind, 'commit');
  assert.equal(classifyGit('(git commit -m x)').kind, 'commit');
  assert.equal(classifyGit('git -C sub commit -m x').kind, 'commit');
  assert.equal(classifyGit('git --no-pager -c a=b commit').kind, 'commit');
  assert.equal(classifyGit('/usr/bin/git commit').kind, 'commit');
  assert.equal(classifyGit('bash -c "git commit -m x"').kind, 'commit');
  assert.equal(classifyGit("sh -c 'npm test && git push origin main'").kind, 'push');
  assert.deepEqual(classifyGit('git push origin main'), { kind: 'push', branchArg: 'main' });
  assert.deepEqual(classifyGit('git push origin feature:main'), { kind: 'push', branchArg: 'main' });
  assert.deepEqual(classifyGit('git push origin +main'), { kind: 'force-push', branchArg: 'main' });
  assert.equal(classifyGit('git push -f').kind, 'force-push');
  assert.equal(classifyGit('gh pr create --fill').kind, 'pr');
  assert.equal(classifyGit('gh pr view').kind, 'other');
  assert.equal(classifyGit('echo "git commit"').kind, 'other');
});

test('git -C runs the branch test in that directory', () => {
  const main = repoOn('main');
  const slice = repoOn('slice/x');
  try {
    // The hook root is on a slice branch; the commit lands in the main-branch repository.
    assertDeny(decide(slice.root, `git -C "${main.root}" commit -m x`), 'commit on protected branch main; create a slice branch');
    assertAllow(decide(main.root, `git -C "${slice.root}" commit -m x`, { cwd: main.root }));
    assertDeny(decide(slice.root, `cd "${main.root}" && git commit -m x`), 'commit on protected branch main; create a slice branch');
    assertDeny(decide(slice.root, `bash -c "cd '${main.root}' && git push"`), 'push to protected branch main');
  } finally {
    main.cleanup();
    slice.cleanup();
  }
});

test('a directory that is not a repository has no branch to protect', () => {
  const repo = makeRepo();
  const plain = fs.mkdtempSync(path.join(path.dirname(repo.root), 'slicekit-plain-'));
  try {
    assertAllow(decide(plain, 'git commit -m x'));
    assertAllow(decide(plain, 'git push'));
    assertDeny(decide(plain, 'git push origin main'), 'push to protected branch main');
  } finally {
    repo.cleanup();
    fs.rmSync(plain, { recursive: true, force: true });
  }
});

test('runs through the dispatcher and fails closed on a missing command', async () => {
  const { root, cleanup } = repoOn('main');
  try {
    const cfgFile = path.join(root, '.slicekit', 'config.json');
    fs.mkdirSync(path.dirname(cfgFile), { recursive: true });
    fs.writeFileSync(cfgFile, JSON.stringify(cfgFor()));
    const r = await runHook('pre-bash', { stdin: JSON.stringify({ session_id: SESSION, tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, cwd: root }) });
    assert.equal(reason(JSON.parse(r.stdout)), 'commit on protected branch main; create a slice branch');
    const bad = await runHook('pre-bash', { stdin: JSON.stringify({ session_id: SESSION, tool_name: 'Bash', tool_input: {}, cwd: root }) });
    assert.equal(JSON.parse(bad.stdout).hookSpecificOutput.permissionDecision, 'deny');
  } finally {
    cleanup();
  }
});

// ---- subagent marker ----

test('subagent marker counts nested entries and stays inside .slicekit', () => {
  const { root, cleanup } = makeRepo();
  try {
    assert.equal(subagentActive(root, SESSION), false);
    enter(root, SESSION);
    enter(root, SESSION);
    assert.equal(fs.readFileSync(markerPath(root, SESSION), 'utf8').trim(), '2');
    leave(root, SESSION);
    assert.equal(subagentActive(root, SESSION), true);
    leave(root, SESSION);
    assert.equal(subagentActive(root, SESSION), false);
    assert.equal(fs.existsSync(markerPath(root, SESSION)), false);
    leave(root, SESSION);
    assert.equal(subagentActive(root, SESSION), false);

    const evil = markerPath(root, '../../etc/passwd');
    assert.equal(path.dirname(evil), path.join(root, '.slicekit'));
    assert.match(path.basename(evil), /^\.subagent-[A-Za-z0-9_-]+$/);
    assert.throws(() => markerPath(root, ''));
    assert.throws(() => markerPath(root, undefined));
    assert.equal(subagentActive(root, undefined), false);
  } finally {
    cleanup();
  }
});

// ---- fix round 1: tokeniser and directories ----

const PROTECTED_COMMIT = 'commit on protected branch main; create a slice branch';
const PROTECTED_PUSH = 'push to protected branch main';
const cannotTell = (label) => `cannot tell which branch ${label} is on; run the command from inside the repository`;
const toMsys = (p) => p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);

function onMain(fn) {
  const repo = repoOn('main');
  try {
    fn(repo.root);
  } finally {
    repo.cleanup();
  }
}

// C1
test('shell keywords and grouping do not hide a commit or push on main', () => onMain((root) => {
  assertDeny(decide(root, 'if ! git diff --cached --quiet; then git commit -m x; fi'), PROTECTED_COMMIT);
  assertDeny(decide(root, 'if git push origin main; then :; fi'), PROTECTED_PUSH);
  assertDeny(decide(root, 'for f in a; do git push origin main; done'), PROTECTED_PUSH);
  assertDeny(decide(root, '{ git commit -m x; }'), PROTECTED_COMMIT);
  assertDeny(decide(root, '! git commit -m x'), PROTECTED_COMMIT);
  assertDeny(decide(root, 'while true; do git commit -m x; done'), PROTECTED_COMMIT);
}));

// C2
test('an msys drive path resolves to the repository it names', { skip: process.platform !== 'win32' }, () => {
  const main = repoOn('main');
  const slice = repoOn('slice/x');
  try {
    assertDeny(decide(slice.root, `cd ${toMsys(main.root)} && git commit -m x`), PROTECTED_COMMIT);
    assertDeny(decide(slice.root, `git -C ${toMsys(main.root)} commit -m x`), PROTECTED_COMMIT);
    assertAllow(decide(main.root, `cd ${toMsys(slice.root)} && git commit -m x`));
  } finally {
    main.cleanup();
    slice.cleanup();
  }
});

// C2
test('a directory the hook cannot resolve refuses a commit or a bare push', () => {
  const { root, cleanup } = repoOn('slice/x');
  const missing = `~/slicekit-missing-${process.pid}-${Date.now()}`;
  try {
    assertDeny(decide(root, `cd ${missing} && git commit -m x`), cannotTell(missing));
    assertDeny(decide(root, 'cd $REPO && git commit -m x'), cannotTell('$REPO'));
    assertDeny(decide(root, 'cd "$(git rev-parse --show-toplevel)" && git push'), cannotTell('$(git rev-parse --show-toplevel)'));
    assertDeny(decide(root, 'git -C nonexistent commit -m x'), cannotTell('nonexistent'));
    assertDeny(decide(root, 'pushd nowhere && git commit -m x'), cannotTell('nowhere'));
    // An explicit refspec needs no branch lookup.
    assertDeny(decide(root, 'cd $REPO && git push origin main'), PROTECTED_PUSH);
    assertAllow(decide(root, 'cd $REPO && git push origin slice/x'));
    // Not a commit or push: nothing to tell.
    fs.mkdirSync(path.join(root, 'src'));
    assertAllow(decide(root, 'cd src && git status'));
    assertAllow(decide(root, 'cd src && git commit -m x'));
    assertAllow(decide(root, 'cd $REPO && npm test'));
    assertAllow(decide(root, 'pushd src && popd && git commit -m x'));
  } finally {
    cleanup();
  }
});

// I1
test('wrappers do not hide a commit or push on main', () => onMain((root) => {
  assertDeny(decide(root, 'timeout 60 git push origin main'), PROTECTED_PUSH);
  assertDeny(decide(root, 'timeout -k 5 60 git commit -m x'), PROTECTED_COMMIT);
  assertDeny(decide(root, 'timeout 60 git commit -m x'), PROTECTED_COMMIT);
  assertDeny(decide(root, 'nice git commit -m x'), PROTECTED_COMMIT);
  assertDeny(decide(root, 'nice -n 10 git commit -m x'), PROTECTED_COMMIT);
  assertDeny(decide(root, 'xargs git commit -m x </dev/null'), PROTECTED_COMMIT);
  assertDeny(decide(root, 'xargs -n 1 git commit -m x </dev/null'), PROTECTED_COMMIT);
  assertDeny(decide(root, 'nohup git push origin main'), PROTECTED_PUSH);
  assertDeny(decide(root, 'stdbuf -oL git commit -m x'), PROTECTED_COMMIT);
  assertDeny(decide(root, 'ionice -c 3 git commit -m x'), PROTECTED_COMMIT);
  assertDeny(decide(root, 'winpty git commit -m x'), PROTECTED_COMMIT);
  assertDeny(decide(root, 'time git commit -m x'), PROTECTED_COMMIT);
}));

// I2
test('a checkout earlier in the command decides the branch of a later commit', () => {
  const { root, cleanup } = repoOn('slice/P1-S-06-x');
  try {
    run(root, ['branch', 'main']);
    assertDeny(decide(root, 'git checkout main && git commit -m x'), PROTECTED_COMMIT);
    assertDeny(decide(root, 'git switch main; git commit -m x'), PROTECTED_COMMIT);
    assertDeny(decide(root, 'git checkout -b main && git commit -m x'), PROTECTED_COMMIT);
    assertDeny(decide(root, 'git switch -c main && git commit -m x'), PROTECTED_COMMIT);
    assertDeny(decide(root, 'git checkout main && git push'), PROTECTED_PUSH);
    assertAllow(decide(root, 'git checkout main && git pull'));
    assertAllow(decide(root, 'git checkout -b slice/P1-S-06-y && git commit -m x'));
    assertAllow(decide(root, 'git checkout main -- README.md && git commit -m x'));
    assertDeny(decide(root, 'git checkout - && git commit -m x'), cannotTell(root));
  } finally {
    cleanup();
  }
});

// I4
test('a here-document body is data, the line after its terminator is a command', () => onMain((root) => {
  const body = "cat > notes.md <<'EOF'\nTo ship: git push origin main\nEOF\n";
  assertAllow(decide(root, body));
  assertAllow(decide(root, 'cat <<-EOF > notes.md\n\tgit commit -m x\n\tEOF\n'));
  assertDeny(decide(root, `${body}git commit -m x`), PROTECTED_COMMIT);
  assertDeny(decide(root, 'bash <<EOF\ngit commit -m x\nEOF\n'), PROTECTED_COMMIT);
}));
