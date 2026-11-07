// P4/S-39 (REQ-3.13): the forms of naming a denied path that rule 0d judges beyond a plain argument.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handle, expandBraces } from '../../src/hooks/pre-bash.js';
import { matchesDeny, denyDir } from '../../src/hooks/paths.js';
import { defaultConfig } from '../../src/config.js';
import { makeRepo, commit } from '../helpers/tmp-repo.js';

const cfg = { ...defaultConfig({ name: 'demo', shape: 'backend' }), agents: { denyPaths: ['data/**', '**/*.pem'] } };
const decide = (root, command) => handle({ session_id: 's', tool_name: 'Bash', tool_input: { command }, cwd: root }, { root, cfg, env: {} });
const decision = (r) => r.hookSpecificOutput?.permissionDecision ?? 'allow';

function repo() {
  const r = makeRepo({ branch: 'slice/P4-S-39-x', files: { 'data/x.xml': '<x/>', 'src/a.js': 'x', 'keys/prod.pem': 'k' } });
  execFileSync('git', ['add', '-A'], { cwd: r.root });
  commit(r.root, 'seed', { allowEmpty: false });
  return r;
}

test('deny » a glob, the denied directory, a rev:path word and an attached option value are judged', () => {
  const { root, cleanup } = repo();
  try {
    for (const command of [
      'cat d*/x.xml',
      'cat data/*',
      'cat keys/*',
      'ls data',
      'tar cf - data',
      'git show HEAD:data/x.xml',
      'git show HEAD:./data/x.xml',
      'grep -fdata/x.xml src/a.js',
    ]) {
      assert.equal(decision(decide(root, command)), 'deny', command);
    }
    for (const command of ['cat s*/a.js', 'ls src', 'ls', 'git show HEAD:src/a.js', 'grep -rn foo src', 'node --test test/']) {
      assert.equal(decision(decide(root, command)), 'allow', command);
    }
  } finally {
    cleanup();
  }
});

test('deny » the index form, a path git reads from the shell directory, a home path and a quoted glob', () => {
  const { root, cleanup } = repo();
  try {
    const src = path.join(root, 'src');
    const inSrc = (command) => handle({ session_id: 's', tool_name: 'Bash', tool_input: { command }, cwd: src }, { root, cfg, env: {} });
    for (const command of ['git show :data/x.xml', 'git show :0:data/x.xml', 'cd src && git show HEAD:../data/x.xml']) {
      assert.equal(decision(decide(root, command)), 'deny', command);
    }
    assert.equal(decision(inSrc('git show HEAD:data/x.xml')), 'deny');
    const home = path.relative(os.homedir(), root);
    if (home !== '' && !home.startsWith('..') && !path.isAbsolute(home)) {
      const tilde = `~/${home.split(path.sep).join('/')}/data/x.xml`;
      assert.equal(decision(decide(root, `cat ${tilde}`)), 'deny', tilde);
      assert.equal(decision(decide(root, `cat '${tilde}'`)), 'allow', 'a quoted ~ is not the home directory');
    }
    for (const command of ["grep 'd*' src/a.js", 'grep "da?a" src/a.js']) {
      assert.equal(decision(decide(root, command)), 'allow', command);
    }
    assert.equal(decision(decide(root, 'cat d*/x.xml')), 'deny');
    // A negated class expands as the shell expands it.
    const one = { ...cfg, agents: { denyPaths: ['data/x.xml'] } };
    const withOne = (command) => decision(handle({ session_id: 's', tool_name: 'Bash', tool_input: { command }, cwd: root }, { root, cfg: one, env: {} }));
    assert.equal(withOne('cat data/[!a].xml'), 'deny');
    assert.equal(withOne('cat data/[!x].xml'), 'allow');
    // H-11: `[^...]` is a negated class too.
    assert.equal(withOne('cat data/[^a].xml'), 'deny');
    assert.equal(withOne('cat [^s]ata/x.xml'), 'deny');
    assert.equal(withOne('cat data/[^x].xml'), 'allow');
  } finally {
    cleanup();
  }
});

// H-11: the frozen-test rule reads both negated forms through the same glob matcher.
test('deny » a negated class written either way reaches a frozen test', () => {
  const r = makeRepo({ branch: 'slice/P1-S-06-hooks', files: { 'test/a.test.js': 'x\n', 'src/a.js': 'a\n' } });
  try {
    const file = path.join(r.root, '.slicekit', 'state', 'P1-S-06.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ slice: 'P1/S-06', state: 'building', frozenTests: ['test/a.test.js'], unfrozen: [] }));
    const plain = defaultConfig({ name: 'demo', shape: 'backend' });
    const run = (command) => handle({ session_id: 's', tool_name: 'Bash', tool_input: { command }, cwd: r.root }, { root: r.root, cfg: plain, env: {} });
    for (const command of ['rm test/[!b].test.js', 'rm test/[^b].test.js']) {
      const out = run(command);
      assert.equal(decision(out), 'deny', command);
      assert.match(out.hookSpecificOutput.permissionDecisionReason, /frozen/, command);
    }
    assert.equal(decision(run('rm test/[^a].test.js')), 'allow');
  } finally {
    r.cleanup();
  }
});

// H-7: a brace expression is judged by each word it expands to.
test('deny » brace expansion is judged, quoted braces are not expanded, and a wide one is refused', () => {
  const { root, cleanup } = repo();
  try {
    for (const command of ['cat {data,src}/x.xml', 'cat {src,{keys,data}}/x.xml', 'cat data/x.{txt,xml}', 'cat {x..z}/../data/x.xml']) {
      assert.equal(decision(decide(root, command)), 'deny', command);
    }
    for (const command of ["cat '{data,src}/x.xml'", 'cat "{data,src}"/x.xml', 'cat {src,lib}/a.js', 'echo {}', 'cat src/{a}.js']) {
      assert.equal(decision(decide(root, command)), 'allow', command);
    }
    const wide = decide(root, 'touch f{1..2000}');
    assert.equal(decision(wide), 'deny');
    assert.match(wide.hookSpecificOutput.permissionDecisionReason, /too wide/);
    assert.equal(decision(handle({ session_id: 's', tool_name: 'Bash', tool_input: { command: 'touch f{1..2000}' }, cwd: root },
      { root, cfg: defaultConfig({ name: 'demo', shape: 'backend' }), env: {} })), 'allow', 'with no list nothing new is denied');
  } finally {
    cleanup();
  }
});

// H-9: cd and pushd are followed across the chain, a subshell's cd ends with it, and a cd the guard
// cannot resolve is refused while the list is set.
test('deny » cd is followed, its target and the working directory are judged, and an unknown cd is refused', () => {
  const { root, cleanup } = repo();
  try {
    for (const command of [
      'cd data && ls',
      'pushd data && ls',
      'cd data',
      'cd src; cd ../data; ls',
      'cd src || cd ../data',
      'cd src\ncat ../data/x.xml',
      'cd data/new-dir',
      'cd $DIR && ls',
      'cd - && ls',
      'cd "$(pwd)" && ls',
      'popd && ls',
    ]) {
      assert.equal(decision(decide(root, command)), 'deny', command);
    }
    for (const command of ['cd src && ls', '(cd src) && cat src/a.js', '(cd data/..) && ls', 'cd src && cat ../src/a.js', 'pushd src && popd && ls']) {
      assert.equal(decision(decide(root, command)), 'allow', command);
    }
    // A subshell's cd does not carry past it: `x.xml` after it is read from the root, not data.
    assert.equal(decision(decide(root, '(cd src) && cat a.js')), 'allow');
    const plain = defaultConfig({ name: 'demo', shape: 'backend' });
    const run = (command) => handle({ session_id: 's', tool_name: 'Bash', tool_input: { command }, cwd: root }, { root, cfg: plain, env: {} });
    for (const command of ['cd $DIR && ls', 'cd - && ls', 'cd data && ls']) assert.equal(decision(run(command)), 'allow', `${command} with no list`);
  } finally {
    cleanup();
  }
});

// H-13: braces expand before quotes and backslashes are removed, so a quoted or escaped brace or
// comma is text inside the expression, and an unclosed brace does not hide a later expression.
test('deny » a quoted or escaped brace or comma inside a brace expression is text', () => {
  const { root, cleanup } = repo();
  try {
    for (const command of [
      "cat {data,'}'}/x.xml",
      'cat {data,\\}}/x.xml',
      "cat {'{',data}/x.xml",
      'cat {data,"a,b"}/x.xml',
      'cat \\{x {data,src}/x.xml',
    ]) {
      assert.equal(decision(decide(root, command)), 'deny', command);
    }
    // An unclosed `{` stays text and a later expression still expands, as Bash prints `{a {b`.
    assert.deepEqual(expandBraces('{{a,b}'), ['{a', '{b']);
    assert.deepEqual(expandBraces('{x,{a,b}'), ['{x,a', '{x,b']);
    for (const command of ["cat {src,'data'x}/a.js", 'cat {src\\,data}/x.xml', "cat '{data,src}'/x.xml"]) {
      assert.equal(decision(decide(root, command)), 'allow', command);
    }
  } finally {
    cleanup();
  }
});

// H-15: a case pattern's `)` closes the pattern, not the subshell around it.
test("deny » a case pattern's parenthesis does not end the subshell's cd", () => {
  const { root, cleanup } = repo();
  try {
    for (const command of [
      '(cd src; case a in a) cat ../data/x.xml;; esac)',
      '(cd src; case a in (a) cat ../data/x.xml;; esac)',
      '(cd src; case a in b) ls;; a) cat ../data/x.xml;; esac)',
      '(cd src\ncase a in\n  a) cat ../data/x.xml ;;\nesac\n)',
    ]) {
      assert.equal(decision(decide(root, command)), 'deny', command);
    }
    // The subshell still ends at its own `)` after esac.
    assert.equal(decision(decide(root, '(cd src; case a in a) ls;; esac); cat src/a.js')), 'allow');
  } finally {
    cleanup();
  }
});

// H-16 and H-17: a case after a reserved word starts a command too, and a cd whose target is an
// unquoted backtick substitution cannot be resolved; both judged under the list, unchanged without it.
test('deny » a case after then, else, do, { or ! keeps the subshell, and a backtick cd target is refused', () => {
  const { root, cleanup } = repo();
  try {
    const forms = [
      '(cd src; if true; then case a in a) cat ../data/x.xml;; esac; fi)',
      '(cd src; if false; then :; else case a in a) cat ../data/x.xml;; esac; fi)',
      '(cd src; if false; then :; elif true; then case a in a) cat ../data/x.xml;; esac; fi)',
      '(cd src; { case a in a) cat ../data/x.xml;; esac; })',
      '(cd src; while true; do case a in a) cat ../data/x.xml; break;; esac; done)',
      '(cd src; ! case a in a) cat ../data/x.xml;; esac)',
      '(cd src; if case a in a) cat ../data/x.xml;; esac; then :; fi)',
      'cd `echo data` && cat x.xml',
      'cd `pwd` && ls',
      'pushd `echo data` && ls',
    ];
    for (const command of forms) assert.equal(decision(decide(root, command)), 'deny', command);
    // The subshell still ends at its own `)`, and a word that only looks like a keyword does not open a case.
    assert.equal(decision(decide(root, '(cd src; if true; then case a in a) ls;; esac; fi); cat src/a.js')), 'allow');
    assert.equal(decision(decide(root, '(cd src; echo then case a in a); cat src/a.js')), 'allow');
    const plain = defaultConfig({ name: 'demo', shape: 'backend' });
    const run = (command) => handle({ session_id: 's', tool_name: 'Bash', tool_input: { command }, cwd: root }, { root, cfg: plain, env: {} });
    for (const command of forms) assert.equal(decision(run(command)), 'allow', `${command} with no list`);
  } finally {
    cleanup();
  }
});

test('deny » matchesDeny and denyDir read gitignore-style patterns', () => {
  assert.equal(matchesDeny('data/x.xml', ['data/**']), 'data/**');
  assert.equal(matchesDeny('a/data/x.xml', ['data/**']), null);
  assert.equal(matchesDeny('a/b.pem', ['*.pem']), '*.pem');
  assert.equal(matchesDeny('a/secrets/t', ['secrets/']), 'secrets/');
  assert.equal(matchesDeny('database/a', ['data/**']), null);
  assert.equal(matchesDeny('data/x', []), null);
  assert.equal(denyDir('data', ['data/**']), 'data/**');
  assert.equal(denyDir('data', ['data/*.xml']), 'data/*.xml');
  assert.equal(denyDir('src', ['src/secrets/**']), null);
  assert.equal(denyDir('keys', ['*.pem']), null);
  assert.equal(matchesDeny('data/b.xml', ['data/[^a].xml']), 'data/[^a].xml');
  assert.equal(matchesDeny('data/b.xml', ['data/[!a].xml']), 'data/[!a].xml');
  assert.equal(matchesDeny('data/a.xml', ['data/[^a].xml']), null);
});

// Codex review of d8f9a89: a symlink out of the repository is judged by the name it is listed under,
// a bundled short option's value is judged after every option letter, and `**` reaches any depth.
const withList = (root, list, command) =>
  decision(handle({ session_id: 's', tool_name: 'Bash', tool_input: { command }, cwd: root }, { root, cfg: { ...cfg, agents: { denyPaths: list } }, env: {} }));

test('deny » a listed symlink that points out of the repository is still listed', (t) => {
  const { root, cleanup } = repo();
  const outside = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-out-')));
  try {
    fs.writeFileSync(path.join(outside, 'secret.txt'), 's');
    // A file symlink needs a privilege on Windows; a directory junction does not. Each form is tested
    // where its link could be made.
    const commands = [];
    const link = (target, at, type, forms) => {
      try {
        fs.symlinkSync(target, path.join(root, 'data', at), type);
        commands.push(...forms);
      } catch {
        // no right to make this link here
      }
    };
    link(path.join(outside, 'secret.txt'), 'link.txt', 'file', ['cat data/link.txt', '(cd src; cat ../data/link.txt)']);
    link(outside, 'out', process.platform === 'win32' ? 'junction' : 'dir', ['cat data/out/secret.txt', 'cat src/../data/out/secret.txt']);
    if (!commands.length) {
      t.skip('no symlink right on this machine');
      return;
    }
    for (const command of commands) {
      assert.equal(decision(decide(root, command)), 'deny', command);
      assert.equal(withList(root, [], command), 'allow', `${command} with no list`);
    }
  } finally {
    cleanup();
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('deny » a bundled short option carries its value after any option letter', () => {
  const { root, cleanup } = repo();
  try {
    const list = ['data/secret.tar'];
    for (const command of ['tar -tfdata/secret.tar', 'grep -rfdata/secret.tar src', 'tar -xvzfdata/secret.tar']) {
      assert.equal(withList(root, list, command), 'deny', command);
      assert.equal(withList(root, [], command), 'allow', `${command} with no list`);
    }
    for (const command of ['tar -tfsrc/a.tar', 'grep -rn x src', 'ls -la']) assert.equal(withList(root, list, command), 'allow', command);
  } finally {
    cleanup();
  }
});

test('deny » ** reaches files at any depth after shopt -s globstar, and one level without it', () => {
  const { root, cleanup } = repo();
  try {
    fs.mkdirSync(path.join(root, 'data', 'a', 'b'), { recursive: true });
    fs.writeFileSync(path.join(root, 'data', 'a', 'b', 'secret.txt'), 's');
    const list = ['data/a/b/secret.txt'];
    for (const command of [
      'shopt -s globstar; cat data/**/secret.txt',
      'shopt -s globstar && cat d*/**/secret.txt',
      'shopt -s globstar\nls data/a/**',
      'shopt -s extglob globstar; cat **/secret.txt',
      'shopt -u globstar; shopt -s globstar; cat **/secret.txt',
      '(shopt -s globstar; cat **/secret.txt)',
    ]) {
      assert.equal(withList(root, list, command), 'deny', command);
      assert.equal(withList(root, [], command), 'allow', `${command} with no list`);
    }
    // Without globstar, or after it is turned off or its subshell ends, `**` is `*`: one level.
    for (const command of [
      'cat **/secret.txt',
      'cat d*/**/secret.txt',
      'shopt -s globstar; shopt -u globstar; cat **/secret.txt',
      '(shopt -s globstar); cat **/secret.txt',
      'shopt -s globstar; cat src/**',
      'shopt -s globstar; cat data/**/other.txt',
    ]) {
      assert.equal(withList(root, list, command), 'allow', command);
    }
    // `**` as `*` still reaches the level below.
    fs.writeFileSync(path.join(root, 'src', 'secret.txt'), 's');
    assert.equal(withList(root, ['src/secret.txt'], 'cat **/secret.txt'), 'deny');
  } finally {
    cleanup();
  }
});

test('deny » ** over a tree wider than the cap is judged as * unless globstar is on', () => {
  const { root, cleanup } = repo();
  try {
    // 21 x 1000 files under node_modules: more than the glob cap of 20000, but 21 entries one level down.
    for (let d = 0; d < 21; d++) {
      const dir = path.join(root, 'node_modules', `p${d}`);
      fs.mkdirSync(dir, { recursive: true });
      for (let f = 0; f < 1000; f++) fs.writeFileSync(path.join(dir, `f${f}.md`), '');
    }
    assert.equal(decision(decide(root, 'ls **/*.md')), 'allow');
    assert.equal(decision(decide(root, 'shopt -s globstar; ls **/*.md')), 'deny');
  } finally {
    cleanup();
  }
});
