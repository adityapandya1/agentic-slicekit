import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_RULES } from '../../src/check/index.js';
import { runCli } from '../helpers/run-cli.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// REQ-5.4, REQ-3.7: the kit's own repository passes its own gate with every baseline at zero.
// Counted against the registered rules, so a slice that adds a rule does not edit this test.
// core.hooksPath is a clone's setting, not the repository's content (git hooks do not survive a clone),
// so the check runs as in a clone where init has run; the hooks rule still judges the hook files.
const INITIALISED = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '.githooks' };

test("the kit's own repo is green", () => {
  const r = runCli(['check'], { cwd: repoRoot, env: { ...process.env, ...INITIALISED } });
  const last = r.stdout.trim().split(/\r?\n/).pop();
  const n = ALL_RULES.filter((rule) => !rule.synthetic).length;
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(last, `check: 0 findings, 0 over baseline, 0 blocking, ${n} rules`);
});
