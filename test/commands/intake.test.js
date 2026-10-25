import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { defaultConfig } from '../../src/config.js';
import { main } from '../../src/cli/index.js';
import { git } from '../../src/git.js';
import { intakePin } from '../../src/stage.js';
import { commit, makeRepo } from '../helpers/tmp-repo.js';

const cfg = defaultConfig({ name: 'demo', shape: 'backend' });
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);

async function cli(root, args) {
  let stdout = '';
  let stderr = '';
  const io = { cwd: root, stdout: (s) => { stdout += s; }, stderr: (s) => { stderr += s; } };
  const code = await main(args, io);
  return { code, stdout, stderr };
}

// A repository with a committed config on main, switched to a work branch unless `branch` is main.
async function withRepo(fn, { branch = 'spec/demo' } = {}) {
  const repo = makeRepo({ files: { '.slicekit/config.json': `${JSON.stringify(cfg, null, 2)}\n` } });
  git(repo.root, ['add', '-A']);
  commit(repo.root, 'config');
  if (branch !== 'main') git(repo.root, ['switch', '-q', '-c', branch]);
  try {
    return await fn(repo.root);
  } finally {
    repo.cleanup();
  }
}

// A server on 127.0.0.1 that answers every request with `body` as `type`.
async function serve(body, type) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': type });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('a URL source is fetched and its origin recorded', async () => {
  const body = '# Requirements\n\nThe service stores orders.\n';
  const srv = await serve(body, 'text/markdown; charset=utf-8');
  try {
    await withRepo(async (root) => {
      const url = `${srv.base}/docs/orders`;
      const r = await cli(root, ['intake', 'snapshot', url]);
      assert.equal(r.code, 0, r.stderr);
      const rel = r.stdout.split('\n')[0];
      assert.equal(rel, `docs/intake/${today()}-orders.md`);
      const file = path.join(root, rel);
      assert.equal(fs.readFileSync(file, 'utf8'), body);
      const meta = JSON.parse(fs.readFileSync(`${file}.meta.json`, 'utf8'));
      assert.equal(meta.origin, url);
      assert.equal(meta.sha256, sha256(Buffer.from(body)));
      assert.equal(meta.by, 'Slicekit Test');
      assert.ok(!Number.isNaN(Date.parse(meta.at)));
      assert.equal(intakePin(file).status, 'frozen');
      assert.equal(git(root, ['log', '-1', '--format=%s']), `docs(intake): snapshot ${today()}-orders.md`);
      assert.equal(git(root, ['status', '--porcelain']), '');
    });
  } finally {
    await srv.close();
  }
});

test('a second snapshot of changed bytes is a new file', async () => {
  await withRepo(async (root) => {
    const src = path.join(root, 'req.md');
    fs.writeFileSync(src, 'first\n');
    const a = await cli(root, ['intake', 'snapshot', 'req.md', '--who', 'Ada']);
    assert.equal(a.code, 0, a.stderr);
    const first = `docs/intake/${today()}-req.md`;
    assert.equal(a.stdout.split('\n')[0], first);
    const meta = JSON.parse(fs.readFileSync(path.join(root, `${first}.meta.json`), 'utf8'));
    assert.equal(meta.origin, src.split(path.sep).join('/'));
    assert.equal(meta.by, 'Ada');

    fs.writeFileSync(src, 'second\n');
    const b = await cli(root, ['intake', 'snapshot', 'req.md']);
    assert.equal(b.code, 0, b.stderr);
    const second = `docs/intake/${today()}-req-2.md`;
    assert.equal(b.stdout.split('\n')[0], second);
    assert.equal(fs.readFileSync(path.join(root, first), 'utf8'), 'first\n');
    assert.equal(fs.readFileSync(path.join(root, second), 'utf8'), 'second\n');
    assert.equal(intakePin(path.join(root, first)).status, 'frozen');
    assert.equal(intakePin(path.join(root, second)).status, 'frozen');

    // Unchanged bytes again: the first snapshot holding them is named, and nothing is written.
    fs.writeFileSync(src, 'first\n');
    const head = git(root, ['rev-parse', 'HEAD']);
    const listed = fs.readdirSync(path.join(root, 'docs', 'intake')).sort();
    const c = await cli(root, ['intake', 'snapshot', 'req.md']);
    assert.equal(c.code, 0, c.stderr);
    assert.equal(c.stdout.split('\n')[0], first);
    assert.equal(git(root, ['rev-parse', 'HEAD']), head);
    assert.deepEqual(fs.readdirSync(path.join(root, 'docs', 'intake')).sort(), listed);

    // A missing source is a usage error.
    const d = await cli(root, ['intake', 'snapshot', 'nope.md']);
    assert.equal(d.code, 2);
    assert.match(d.stderr, /no such file nope\.md/);
  });

  // On the default branch the snapshot is refused and nothing is written.
  await withRepo(
    async (root) => {
      fs.writeFileSync(path.join(root, 'req.md'), 'first\n');
      const r = await cli(root, ['intake', 'snapshot', 'req.md']);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /snapshot on a work branch; run slicekit branch spec <slug>/);
      assert.equal(fs.existsSync(path.join(root, 'docs', 'intake')), false);
    },
    { branch: 'main' },
  );
});
