// P4/S-39 (REQ-3.13): the forms of naming a denied path that rule 0d judges beyond a plain argument.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { handle } from '../../src/hooks/pre-bash.js';
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
});
