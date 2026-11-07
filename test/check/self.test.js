import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_RULES } from '../../src/check/index.js';
import { loadConfig } from '../../src/config.js';
import { requiredChecks } from '../../src/check/rules/host-rules.js';
import { runCli } from '../helpers/run-cli.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// REQ-5.4, REQ-3.7: the kit's own repository passes its own gate with every baseline at zero.
// Counted against the registered rules, so a slice that adds a rule does not edit this test.
// core.hooksPath is a clone's setting, not the repository's content (git hooks do not survive a clone),
// so the check runs as in a clone where init has run; the hooks rule still judges the hook files.
const INITIALISED = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '.githooks' };

// No test reaches the network: the git host is a fixture whose default branch holds every rule of
// REQ-3.14, so the host-rules rule judges the kit's own configuration, not the live host.
function hostWithEveryRule() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-self-host-'));
  const cfg = loadConfig(repoRoot);
  const rules = [
    { type: 'pull_request', parameters: { required_approving_review_count: 1, require_code_owner_review: true } },
    { type: 'required_status_checks', parameters: { required_status_checks: requiredChecks(cfg).map((context) => ({ context })) } },
    { type: 'non_fast_forward' },
  ];
  fs.writeFileSync(path.join(dir, `branch-rules-${cfg.defaultBranch}.json`), JSON.stringify(rules));
  return dir;
}

test("the kit's own repo is green", () => {
  const host = hostWithEveryRule();
  let r;
  try {
    r = runCli(['check'], { cwd: repoRoot, env: { ...process.env, ...INITIALISED, SLICEKIT_GITHOST_FIXTURE: host } });
  } finally {
    fs.rmSync(host, { recursive: true, force: true });
  }
  const last = r.stdout.trim().split(/\r?\n/).pop();
  const n = ALL_RULES.filter((rule) => !rule.synthetic).length;
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(last, `check: 0 findings, 0 over baseline, 0 blocking, ${n} rules`);
});
