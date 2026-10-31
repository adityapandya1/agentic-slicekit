// REQ-4.7: S-19 review round 1, H-1 (the server answers only its own loopback names) and H-2 (a
// path that cannot be written is one line, not a stack).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../src/visualize/server.js';
import { cli } from './helpers/build-flow.js';
import { graphRepo } from './helpers/graph-fixture.js';

// One raw GET with the Host header given; resolves to the status code.
const get = (port, p, host) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers: { host } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });

test('the server answers only requests that name it by 127.0.0.1 or localhost', async () => {
  const s = await startServer({ html: '<!doctype html><title>t</title>', graphJson: '{}', port: 0 });
  try {
    assert.equal(await get(s.port, '/graph.json', `127.0.0.1:${s.port}`), 200);
    assert.equal(await get(s.port, '/graph.json', `localhost:${s.port}`), 200);
    assert.equal(await get(s.port, '/graph.json', `LOCALHOST:${s.port}`), 200);
    // DNS rebinding: another name pointed at 127.0.0.1 gets nothing.
    assert.equal(await get(s.port, '/graph.json', `evil.example:${s.port}`), 404);
    assert.equal(await get(s.port, '/', `evil.example:${s.port}`), 404);
    assert.equal(await get(s.port, '/graph.json', '127.0.0.1'), 404, 'no port');
    assert.equal(await get(s.port, '/graph.json', `127.0.0.1:${s.port + 1}`), 404, 'another port');
  } finally {
    await s.close();
  }
});

test('visualize --write to a path that cannot be written says so in one line', async () => {
  const repo = graphRepo();
  try {
    const built = await cli(repo.root, ['graph'], { ...process.env, SLICEKIT_GITHOST_FIXTURE: repo.fixture });
    assert.equal(built.code, 0, built.stderr);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-vis-'));
    try {
      // The target is an existing directory, which writeFileSync cannot replace.
      const r = await cli(repo.root, ['visualize', '--write', dir]);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /^slicekit: cannot write .+: E[A-Z]+\n$/);
      assert.doesNotMatch(r.stderr, /\n\s+at /, 'no stack trace');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } finally {
    repo.cleanup();
  }
});
