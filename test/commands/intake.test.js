import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { defaultConfig } from '../../src/config.js';
import { main } from '../../src/cli/index.js';
import { git } from '../../src/git.js';
import { MAX_BYTES, maskUrl, snapshot } from '../../src/intake.js';
import { intakePin } from '../../src/stage.js';
import { commit, makeRepo } from '../helpers/tmp-repo.js';

const baseCfg = defaultConfig({ name: 'demo', shape: 'backend' });
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
// A fixed instant, so the date in a snapshot's name does not depend on when the test runs.
const NOW = '2026-03-04T05:06:07.000Z';
const DATE = '2026-03-04';
const env = { ...process.env, SLICEKIT_NOW: NOW };

async function cli(root, args, { env: e = env } = {}) {
  let stdout = '';
  let stderr = '';
  const io = { cwd: root, env: e, stdout: (s) => { stdout += s; }, stderr: (s) => { stderr += s; } };
  const code = await main(args, io);
  return { code, stdout, stderr };
}

// A repository with a committed config on main, switched to `branch` unless it is main.
async function withRepo(fn, { branch = 'spec/demo', cfg = baseCfg, files = {} } = {}) {
  const repo = makeRepo({ files: { '.slicekit/config.json': `${JSON.stringify(cfg, null, 2)}\n`, ...files } });
  git(repo.root, ['add', '-A']);
  commit(repo.root, 'config');
  if (branch !== 'main') git(repo.root, ['switch', '-q', '-c', branch]);
  try {
    return await fn(repo.root, cfg);
  } finally {
    repo.cleanup();
  }
}

// A server on 127.0.0.1; `routes` maps a path to {status, type, body, location}.
async function serve(routes) {
  const server = http.createServer((req, res) => {
    const r = routes[new URL(req.url, 'http://x').pathname] ?? { status: 404, type: 'text/plain', body: 'missing' };
    res.writeHead(r.status ?? 200, { 'content-type': r.type ?? 'text/plain', ...(r.location ? { location: r.location } : {}) });
    res.end(r.body ?? '');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { base: `http://127.0.0.1:${port}`, port, close: () => new Promise((resolve) => server.close(resolve)) };
}

const first = (r) => r.stdout.split('\n')[0];
const meta = (root, rel) => JSON.parse(fs.readFileSync(path.join(root, `${rel}.meta.json`), 'utf8'));

test('a URL source is fetched and its origin recorded', async () => {
  const body = '# Requirements\n\nThe service stores orders.\n';
  const srv = await serve({ '/docs/orders': { type: 'text/markdown; charset=utf-8', body } });
  try {
    await withRepo(async (root) => {
      const url = `${srv.base}/docs/orders`;
      const r = await cli(root, ['intake', 'snapshot', url]);
      assert.equal(r.code, 0, r.stderr);
      const rel = first(r);
      assert.equal(rel, `docs/intake/${DATE}-orders.md`);
      const file = path.join(root, rel);
      assert.equal(fs.readFileSync(file, 'utf8'), body);
      const m = meta(root, rel);
      assert.deepEqual(m, { origin: url, sha256: sha256(Buffer.from(body)), by: 'Slicekit Test', at: NOW });
      assert.equal(intakePin(file).status, 'frozen');
      assert.equal(git(root, ['log', '-1', '--format=%s']), `docs(intake): snapshot ${DATE}-orders.md`);
      assert.match(git(root, ['show', 'HEAD:.gitattributes']), /^docs\/intake\/\*\* -text$/m);
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
    const one = `docs/intake/${DATE}-req.md`;
    assert.equal(first(a), one);
    assert.equal(meta(root, one).origin, src.split(path.sep).join('/'));
    assert.equal(meta(root, one).by, 'Ada');

    fs.writeFileSync(src, 'second\n');
    const b = await cli(root, ['intake', 'snapshot', 'req.md', '--who', '']);
    assert.equal(b.code, 0, b.stderr);
    const two = `docs/intake/${DATE}-req-2.md`;
    assert.equal(first(b), two);
    assert.equal(meta(root, two).by, 'Slicekit Test', 'an empty --who falls back to the git user');
    assert.equal(fs.readFileSync(path.join(root, one), 'utf8'), 'first\n');
    assert.equal(fs.readFileSync(path.join(root, two), 'utf8'), 'second\n');
    assert.equal(intakePin(path.join(root, one)).status, 'frozen');
    assert.equal(intakePin(path.join(root, two)).status, 'frozen');

    // Unchanged bytes again: the first snapshot holding them is named, and nothing is written.
    fs.writeFileSync(src, 'first\n');
    const head = git(root, ['rev-parse', 'HEAD']);
    const listed = fs.readdirSync(path.join(root, 'docs', 'intake')).sort();
    const c = await cli(root, ['intake', 'snapshot', 'req.md']);
    assert.equal(c.code, 0, c.stderr);
    assert.equal(first(c), one);
    assert.equal(git(root, ['rev-parse', 'HEAD']), head);
    assert.deepEqual(fs.readdirSync(path.join(root, 'docs', 'intake')).sort(), listed);

    const d = await cli(root, ['intake', 'snapshot', 'nope.md']);
    assert.equal(d.code, 2);
    assert.match(d.stderr, /no such file nope\.md/);

    const bad = await cli(root, ['intake', 'snapshot', 'req.md', '--slug', '../x']);
    assert.equal(bad.code, 2);

    const clock = await cli(root, ['intake', 'snapshot', 'req.md'], { env: { ...process.env, SLICEKIT_NOW: 'yesterday' } });
    assert.equal(clock.code, 2);
    assert.match(clock.stderr, /SLICEKIT_NOW/);
  });

  // On the default branch, and on another protected branch, the snapshot is refused.
  const cfg = { ...baseCfg, protectedBranches: ['main', 'release'] };
  for (const branch of ['main', 'release']) {
    await withRepo(
      async (root) => {
        fs.writeFileSync(path.join(root, 'req.md'), 'first\n');
        const r = await cli(root, ['intake', 'snapshot', 'req.md']);
        assert.equal(r.code, 1, branch);
        assert.match(r.stderr, /snapshot on a work branch; run slicekit branch spec <slug>/);
        assert.equal(fs.existsSync(path.join(root, 'docs', 'intake')), false);
      },
      { branch, cfg },
    );
  }
});

test('a snapshot whose commit was refused is committed on the next run', async () => {
  await withRepo(async (root) => {
    const hooks = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-hooks-'));
    fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    git(root, ['config', 'core.hooksPath', hooks]);
    fs.writeFileSync(path.join(root, 'req.md'), 'first\n');
    const a = await cli(root, ['intake', 'snapshot', 'req.md']);
    assert.equal(a.code, 1);
    git(root, ['config', '--unset', 'core.hooksPath']);
    const b = await cli(root, ['intake', 'snapshot', 'req.md']);
    assert.equal(b.code, 0, b.stderr);
    assert.equal(first(b), `docs/intake/${DATE}-req.md`);
    assert.equal(git(root, ['log', '-1', '--format=%s']), `docs(intake): snapshot ${DATE}-req.md`);
    assert.equal(git(root, ['status', '--porcelain']), '?? req.md');
    fs.rmSync(hooks, { recursive: true, force: true });
  });
});

test('a CRLF snapshot stays byte for byte in a clone with core.autocrlf', async () => {
  await withRepo(
    async (root) => {
      fs.writeFileSync(path.join(root, 'req.md'), 'one\r\ntwo\r\n');
      const r = await cli(root, ['intake', 'snapshot', 'req.md']);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(git(root, ['status', '--porcelain']), '?? req.md');
      const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-clone-'));
      try {
        execFileSync('git', ['clone', '-q', '-b', 'spec/demo', '-c', 'core.autocrlf=true', root, clone], { stdio: 'pipe' });
        assert.equal(intakePin(path.join(clone, first(r))).status, 'frozen');
      } finally {
        fs.rmSync(clone, { recursive: true, force: true });
      }
    },
    { files: { '.gitattributes': '* text=auto eol=lf\n' } },
  );

  // A rule that turns text conversion back on for the target is refused, and nothing is left behind.
  await withRepo(
    async (root) => {
      fs.writeFileSync(path.join(root, 'req.md'), 'one\n');
      const r = await cli(root, ['intake', 'snapshot', 'req.md']);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /byte for byte/);
      assert.equal(git(root, ['status', '--porcelain']), '?? req.md');
    },
    { files: { 'docs/intake/.gitattributes': '* text\n' } },
  );
});

test('a URL keeps its secrets out of the sidecar and the messages', async () => {
  const srv = await serve({
    '/req.md': { type: 'text/plain', body: 'hello\n' },
    '/old': { status: 302, location: '/new/spec.txt?sig=SECRET3' },
    '/new/spec.txt': { type: 'application/octet-stream', body: 'moved\n' },
  });
  try {
    await withRepo(async (root) => {
      const url = `${srv.base}/req.md?token=SECRET1&X-Amz-Signature=SECRET2&page=2`;
      const r = await cli(root, ['intake', 'snapshot', url]);
      assert.equal(r.code, 0, r.stderr);
      const raw = fs.readFileSync(path.join(root, `${first(r)}.meta.json`), 'utf8');
      assert.equal(JSON.parse(raw).origin, `${srv.base}/req.md?token=***&X-Amz-Signature=***&page=2`);
      assert.doesNotMatch(raw, /SECRET/);

      // A redirect: the final URL is recorded, masked, and names the file.
      const moved = await cli(root, ['intake', 'snapshot', `${srv.base}/old`]);
      assert.equal(moved.code, 0, moved.stderr);
      assert.equal(first(moved), `docs/intake/${DATE}-spec.txt`);
      const m = meta(root, first(moved));
      assert.equal(m.origin, `${srv.base}/old`);
      assert.equal(m.finalUrl, `${srv.base}/new/spec.txt?sig=***`);

      const missing = await cli(root, ['intake', 'snapshot', `${srv.base}/gone?password=SECRET4`]);
      assert.equal(missing.code, 1);
      assert.match(missing.stderr, /could not fetch .*\/gone\?password=\*\*\*: 404/);
      assert.doesNotMatch(missing.stderr, /SECRET/);

      const userinfo = await cli(root, ['intake', 'snapshot', `http://ada:SECRET5@127.0.0.1:${srv.port}/req.md`]);
      assert.equal(userinfo.code, 2);
      assert.match(userinfo.stderr, /the URL carries a user name or password; remove it/);
      assert.doesNotMatch(userinfo.stderr, /SECRET/);
    });
  } finally {
    await srv.close();
  }
  assert.equal(maskUrl('https://h/p?code=a&key=b&Access_Token=c&q=d#x'), 'https://h/p?code=***&key=***&Access_Token=***&q=d#x');
});

test('the extension comes from the content type, and a fetch that fails is refused', async () => {
  const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const types = { a: ['text/plain', 'txt'], b: ['text/html', 'html'], c: ['application/pdf', 'pdf'], d: [docx, 'docx'], e: ['text/markdown', 'md'], f: ['application/octet-stream', 'bin'] };
  const srv = await serve(Object.fromEntries(Object.entries(types).map(([k, [type]]) => [`/${k}`, { type, body: `${k}\n` }])));
  try {
    await withRepo(async (root, cfg) => {
      for (const [k, [, ext]] of Object.entries(types)) {
        const { file } = await snapshot(root, cfg, `${srv.base}/${k}`, { now: new Date(NOW) });
        assert.equal(path.basename(file), `${DATE}-${k}.${ext}`);
      }
      await assert.rejects(snapshot(root, cfg, `${srv.base}/a`, { slug: 'Bad Slug', now: new Date(NOW) }), { code: 2 });
    });
  } finally {
    await srv.close();
  }

  // A closed port: the network error is refused with the URL named.
  const closed = await serve({});
  await closed.close();
  await withRepo(async (root) => {
    const r = await cli(root, ['intake', 'snapshot', `${closed.base}/x.md`]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /could not fetch http:\/\/127\.0\.0\.1:\d+\/x\.md: /);
  });
});

test('a source over the size cap is refused', async () => {
  await withRepo(async (root) => {
    const big = path.join(root, 'big.md');
    fs.writeFileSync(big, '');
    fs.truncateSync(big, MAX_BYTES + 1);
    const r = await cli(root, ['intake', 'snapshot', 'big.md']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /big\.md is larger than 50 MB/);
    assert.equal(fs.existsSync(path.join(root, 'docs', 'intake')), false);
  });
});

test('a snapshot never sweeps uncommitted .gitattributes edits into its commit', async () => {
  await withRepo(
    async (root) => {
      const attrs = path.join(root, '.gitattributes');
      fs.writeFileSync(attrs, '* text=auto eol=lf\n*.png binary\n');
      fs.writeFileSync(path.join(root, 'req.md'), 'first\n');
      const r = await cli(root, ['intake', 'snapshot', 'req.md']);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /\.gitattributes has uncommitted changes; commit or stash them first/);
      assert.equal(fs.readFileSync(attrs, 'utf8'), '* text=auto eol=lf\n*.png binary\n');
      assert.equal(fs.existsSync(path.join(root, 'docs', 'intake')), false);
    },
    { files: { '.gitattributes': '* text=auto eol=lf\n' } },
  );

  // An untracked .gitattributes without the rule is someone's edit too.
  await withRepo(async (root) => {
    fs.writeFileSync(path.join(root, '.gitattributes'), '*.png binary\n');
    fs.writeFileSync(path.join(root, 'req.md'), 'first\n');
    const r = await cli(root, ['intake', 'snapshot', 'req.md']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /\.gitattributes has uncommitted changes/);
  });
});
