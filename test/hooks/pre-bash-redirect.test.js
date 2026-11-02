import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { handle } from '../../src/hooks/pre-bash.js';
import { defaultConfig } from '../../src/config.js';
import { makeRepo } from '../helpers/tmp-repo.js';

const SLICE = 'P1/S-06';
const FROZEN = 'test/a.test.js';

function decide(root, command, agent) {
  const input = { session_id: 'sess-1', tool_name: 'Bash', tool_input: { command }, cwd: root };
  if (agent !== undefined) input.agent_id = agent;
  return handle(input, { root, cfg: defaultConfig({ name: 'demo', shape: 'backend' }), env: {} });
}

function frozenSliceRepo() {
  const repo = makeRepo({ branch: 'slice/P1-S-06-hooks', files: { [FROZEN]: 'x\n', 'test/other.js': 'y\n' } });
  const file = path.join(repo.root, '.slicekit', 'state', 'P1-S-06.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ slice: SLICE, state: 'building', frozenTests: [FROZEN], unfrozen: [] }));
  return repo;
}

// REQ-3.2: review P4-S-37-r1 B-1
test('a redirection written against the preceding word to a frozen test is denied', () => {
  const { root, cleanup } = frozenSliceRepo();
  try {
    const writes = [`echo x>${FROZEN}`, `echo x>>${FROZEN}`, `printf x>"${FROZEN}"`, `echo "x">${FROZEN}`, `echo x2>${FROZEN}`];
    for (const cmd of writes) {
      for (const agent of [undefined, 'a1']) {
        const r = decide(root, cmd, agent);
        assert.equal(r.hookSpecificOutput?.permissionDecision, 'deny', `${cmd}: expected a deny, got ${JSON.stringify(r)}`);
        const text = r.hookSpecificOutput.permissionDecisionReason;
        assert.ok(text.includes(FROZEN) && text.includes(SLICE), `${cmd}: ${text}`);
      }
    }
    for (const cmd of ['echo x>test/other.js', `cat ${FROZEN}>test/copy.js`, 'echo x 2>&1']) {
      assert.deepEqual(decide(root, cmd), {}, cmd);
      assert.deepEqual(decide(root, cmd, 'a1'), {}, cmd);
    }
  } finally {
    cleanup();
  }
});
