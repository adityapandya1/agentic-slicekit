// REQ-3.14, review H-3: init --protect names each required check of the slicekit ruleset that no job
// of the generated workflow reports any more and takes it out of that ruleset. A check another
// ruleset requires is the team's: it is not named and stays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeRepo } from './helpers/tmp-repo.js';
import { runCli } from './helpers/run-cli.js';

const checks = (id, contexts) => ({
  type: 'required_status_checks',
  parameters: { strict_required_status_checks_policy: false, required_status_checks: contexts.map((context) => ({ context })) },
  ruleset_id: id,
});

test('init --protect removes a stale check from the slicekit ruleset only and names it', () => {
  const repo = makeRepo({ commits: 1 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-host-'));
  const file = path.join(dir, 'branch-rules-main.json');
  try {
    const env = { ...process.env, SLICEKIT_GITHOST_FIXTURE: dir };
    fs.writeFileSync(file, JSON.stringify([
      { type: 'pull_request', parameters: { required_approving_review_count: 1 }, ruleset_id: 3 },
      { type: 'non_fast_forward', ruleset_id: 3 },
      checks(3, ['team-lint']),
      checks('slicekit', ['gate', 'checks', 'cmd-test (windows-latest, 3/3)']),
    ]));
    const r = runCli(['init', '--shape', 'backend', '--test', 'node --test', '--protect'], { cwd: repo.root, env });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(r.stdout.split('\n').filter((l) => l.startsWith('removed ') || l.startsWith('set ')), [
      'removed main: required check cmd-test (windows-latest, 3/3), which no job of the generated workflow reports',
    ]);
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    const contexts = (id) => after.filter((x) => x.ruleset_id === id && x.type === 'required_status_checks').flatMap((x) => x.parameters.required_status_checks.map((c) => c.context));
    assert.deepEqual(contexts('slicekit'), ['gate', 'checks']);
    assert.deepEqual(contexts(3), ['team-lint']);

    // Nothing stale and nothing missing: no write.
    const calls = fs.readFileSync(path.join(dir, 'ruleset-calls.jsonl'), 'utf8').split('\n').filter(Boolean).length;
    const again = runCli(['init', '--protect'], { cwd: repo.root, env });
    assert.equal(again.code, 0, again.stdout + again.stderr);
    assert.match(again.stdout, /main has every rule; nothing set/);
    assert.equal(fs.readFileSync(path.join(dir, 'ruleset-calls.jsonl'), 'utf8').split('\n').filter(Boolean).length, calls);
  } finally {
    repo.cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
