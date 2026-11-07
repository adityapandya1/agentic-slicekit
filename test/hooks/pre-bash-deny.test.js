// P4/S-39 (REQ-3.13): the forms of naming a denied path that rule 0d judges beyond a plain argument.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
