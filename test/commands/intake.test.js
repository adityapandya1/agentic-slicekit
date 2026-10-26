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
import { MAX_BYTES, answer as answerFn, maskUrl, snapshot } from '../../src/intake.js';
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

  // The rule already there is not a licence: another line beside it is still someone's edit.
  await withRepo(
    async (root) => {
      fs.writeFileSync(path.join(root, '.gitattributes'), '* text=auto\n*.png binary\ndocs/intake/** -text\n');
      fs.writeFileSync(path.join(root, 'req.md'), 'first\n');
      const r = await cli(root, ['intake', 'snapshot', 'req.md']);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /\.gitattributes has uncommitted changes/);
      assert.equal(git(root, ['show', 'HEAD:.gitattributes']), '* text=auto');
    },
    { files: { '.gitattributes': '* text=auto\n' } },
  );

  // Only the rule on top of the committed file (a refused commit's leftover) goes ahead.
  await withRepo(
    async (root) => {
      fs.writeFileSync(path.join(root, '.gitattributes'), '* text=auto\ndocs/intake/** -text\n');
      fs.writeFileSync(path.join(root, 'req.md'), 'first\n');
      const r = await cli(root, ['intake', 'snapshot', 'req.md']);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(git(root, ['status', '--porcelain']), '?? req.md');
    },
    { files: { '.gitattributes': '* text=auto\n' } },
  );
});

// ---- the interview (REQ-2.2) ----

const template = (name) => fs.readFileSync(new URL(`../../templates/docs/${name}`, import.meta.url), 'utf8');
const docs = () => ({
  'docs/decisions.md': template('decisions.md'),
  'docs/platform.md': template('platform.md'),
  'docs/observability.md': template('observability.md'),
  'docs/spec/stack.md': '# Stack\n',
});
const decisionsText = (root) => fs.readFileSync(path.join(root, 'docs', 'decisions.md'), 'utf8');
const sessionFile = (root) => path.join(git(root, ['rev-parse', '--path-format=absolute', '--git-dir']), 'slicekit', 'interview.json');
const specList = (root) => fs.readdirSync(path.join(root, 'docs', 'spec'), { recursive: true }).sort();
const ask = (root, pass, topic, question) => cli(root, ['intake', 'ask', '--pass', pass, '--topic', topic, '--question', question]);
const answer = (root, ...args) => cli(root, ['intake', 'answer', ...args]);

test('the snapshot and its sidecar are written and no spec file is created', async () => {
  await withRepo(
    async (root) => {
      const before = specList(root);
      fs.writeFileSync(path.join(root, 'req.md'), '# Orders\n\nThe service stores orders.\n');
      const s = await cli(root, ['intake', 'snapshot', 'req.md']);
      assert.equal(s.code, 0, s.stderr);
      const snap = first(s);

      const q1 = await ask(root, 'product', 'purpose', 'What is the service for?');
      assert.equal(q1.code, 0, q1.stderr);
      assert.equal(first(q1), 'question 1');
      const a1 = await answer(root, '--answer', 'Storing orders.', '--who', 'Ada');
      assert.equal(a1.code, 0, a1.stderr);
      assert.match(first(a1), /^D-\d+$/);

      const q2 = await ask(root, 'platform', 'hosting', 'Where does it run?');
      assert.equal(first(q2), 'question 2');
      const a2 = await answer(root, '--answer', 'One container on Fly.', '--type', 'Information', '--who', 'Ada');
      assert.equal(a2.code, 0, a2.stderr);
      // The platform pass writes its answer into platform.md; done commits it.
      fs.appendFileSync(path.join(root, 'docs', 'platform.md'), `\nHosting: one container on Fly (${first(a2)}).\n`);

      const d = await cli(root, ['intake', 'done']);
      assert.equal(d.code, 0, d.stderr);
      assert.equal(d.stdout, 'open: none\n');

      assert.ok(fs.existsSync(path.join(root, snap)));
      assert.ok(fs.existsSync(path.join(root, `${snap}.meta.json`)));
      const settled = decisionsText(root).split('\n').filter((l) => /^\| D-\d+ \|/.test(l));
      assert.deepEqual(settled, [
        `| ${first(a1)} | Decision | What is the service for? | Storing orders. | Ada, ${DATE} |`,
        `| ${first(a2)} | Information | Where does it run? | One container on Fly. | Ada, ${DATE} |`,
      ]);
      assert.deepEqual(specList(root), before);
      assert.equal(fs.existsSync(sessionFile(root)), false);
      assert.equal(git(root, ['log', '-1', '--format=%s']), 'docs(intake): interview answers');
      assert.equal(git(root, ['status', '--porcelain']), '?? req.md');
    },
    { files: docs() },
  );
});

test('the next question is refused while the last answer has no D row', async () => {
  await withRepo(
    async (root) => {
      const before = decisionsText(root);
      assert.equal((await ask(root, 'product', 'purpose', 'What is it for?')).code, 0);
      const r = await ask(root, 'product', 'users', 'Who uses it?');
      assert.equal(r.code, 1);
      assert.match(r.stderr, /answer the last question first: "What is it for\?" has no decision row/);
      assert.equal(decisionsText(root), before);
      const d = await cli(root, ['intake', 'done']);
      assert.equal(d.code, 1);
      assert.match(d.stderr, /answer the last question first/);
    },
    { files: docs() },
  );
});

test('a platform question closes the product pass', async () => {
  await withRepo(
    async (root) => {
      await ask(root, 'product', 'purpose', 'What is it for?');
      await answer(root, '--answer', 'Orders.');
      await ask(root, 'platform', 'hosting', 'Where does it run?');
      await answer(root, '--answer', 'Fly.');
      const r = await ask(root, 'product', 'users', 'Who uses it?');
      assert.equal(r.code, 1);
      assert.match(r.stderr, /the product pass is closed; ask platform questions now/);
    },
    { files: docs() },
  );
});

test('done refuses when a spec file appeared during the interview', async () => {
  await withRepo(
    async (root) => {
      await ask(root, 'product', 'purpose', 'What is it for?');
      fs.writeFileSync(path.join(root, 'docs', 'spec', 'x.md'), '# X\n');
      await answer(root, '--answer', 'Orders.');
      await ask(root, 'platform', 'hosting', 'Where does it run?');
      await answer(root, '--answer', 'Fly.');
      const d = await cli(root, ['intake', 'done']);
      assert.equal(d.code, 1);
      assert.match(d.stderr, /intake writes no spec text; remove docs\/spec\/x\.md/);
      assert.ok(fs.existsSync(sessionFile(root)));
    },
    { files: docs() },
  );
});

test('an open answer is listed by done, and each pass must ask something', async () => {
  await withRepo(
    async (root) => {
      const none = await answer(root, '--answer', 'x');
      assert.equal(none.code, 1);
      assert.match(none.stderr, /no question is waiting for an answer/);
      assert.equal((await ask(root, 'design', 'x', 'y')).code, 2);

      await ask(root, 'product', 'constraints', 'What budget is there?');
      const a = await answer(root, '--open', '--why', 'It sets the hosting.', '--recommendation', 'Ask finance.');
      assert.equal(a.code, 0, a.stderr);
      const early = await cli(root, ['intake', 'done']);
      assert.equal(early.code, 1);
      assert.match(early.stderr, /the platform pass asked nothing/);

      await ask(root, 'platform', 'logs', 'Where do logs go?');
      await answer(root, '--answer', 'Grafana.');
      const d = await cli(root, ['intake', 'done']);
      assert.equal(d.code, 0, d.stderr);
      assert.equal(d.stdout, `open: ${first(a)} What budget is there?\n`);
      assert.ok(decisionsText(root).includes(`| ${first(a)} | Open | What budget is there? | It sets the hosting. | Ask finance. |`));
    },
    { files: docs() },
  );
});

test('an answer interrupted after its row is written is finished, not written twice', async () => {
  await withRepo(
    async (root, cfg) => {
      await ask(root, 'product', 'purpose', 'What is it for?');
      // The second session write is the one after the row: fail it, as a crash there would.
      const original = fs.writeFileSync;
      let writes = 0;
      fs.writeFileSync = function (file, ...rest) {
        if (String(file).endsWith('interview.json') && ++writes === 2) throw new Error('crash');
        return original.call(this, file, ...rest);
      };
      try {
        assert.throws(() => answerFn(root, cfg, { answer: 'Orders.', now: new Date(NOW) }), /crash/);
      } finally {
        fs.writeFileSync = original;
      }
      const rowsAfterCrash = decisionsText(root).split('\n').filter((l) => /^\| D-\d+ \|/.test(l));
      assert.equal(rowsAfterCrash.length, 1);
      const again = await answer(root, '--answer', 'Something else.');
      assert.equal(again.code, 0, again.stderr);
      assert.equal(first(again), rowsAfterCrash[0].split(' | ')[0].slice(2));
      assert.deepEqual(decisionsText(root).split('\n').filter((l) => /^\| D-\d+ \|/.test(l)), rowsAfterCrash);
      assert.equal(first(await ask(root, 'product', 'users', 'Who uses it?')), 'question 2');
    },
    { files: docs() },
  );
});

test('the interview lives in the git directory, one per worktree', async () => {
  await withRepo(
    async (root) => {
      await ask(root, 'product', 'purpose', 'What is it for?');
      assert.ok(fs.existsSync(sessionFile(root)));
      git(root, ['add', '-A']);
      assert.equal(git(root, ['diff', '--cached', '--name-only']), '');

      const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-wt-'));
      try {
        git(root, ['worktree', 'add', '-q', '-b', 'spec/other', wt]);
        const other = await ask(wt, 'product', 'purpose', 'A second interview?');
        assert.equal(other.code, 0, other.stderr);
        assert.equal(first(other), 'question 1');
        assert.notEqual(sessionFile(wt), sessionFile(root));
        assert.equal(JSON.parse(fs.readFileSync(sessionFile(root), 'utf8')).pending.question, 'What is it for?');
        git(root, ['worktree', 'remove', '--force', wt]);
      } finally {
        fs.rmSync(wt, { recursive: true, force: true });
      }
    },
    { files: docs() },
  );
});

test('a platform question waits for the product pass, and the interview needs a work branch', async () => {
  await withRepo(
    async (root) => {
      const early = await ask(root, 'platform', 'hosting', 'Where does it run?');
      assert.equal(early.code, 1);
      assert.match(early.stderr, /ask the product questions first/);

      await ask(root, 'product', 'purpose', 'What is it for?');
      await answer(root, '--answer', 'Orders.');
      await ask(root, 'platform', 'hosting', 'Where does it run?');
      await answer(root, '--answer', 'Fly.');
      git(root, ['switch', '-q', 'main']);
      const d = await cli(root, ['intake', 'done']);
      assert.equal(d.code, 1);
      assert.match(d.stderr, /on a work branch; run slicekit branch spec <slug>/);
    },
    { files: docs() },
  );
  await withRepo(
    async (root) => {
      const r = await ask(root, 'product', 'purpose', 'What is it for?');
      assert.equal(r.code, 1);
      assert.match(r.stderr, /the interview on a work branch; run slicekit branch spec <slug>/);
      assert.equal(fs.existsSync(sessionFile(root)), false);
    },
    { branch: 'main', files: docs() },
  );
});

test('a spec file changed during the interview is refused', async () => {
  await withRepo(
    async (root) => {
      await ask(root, 'product', 'purpose', 'What is it for?');
      fs.appendFileSync(path.join(root, 'docs', 'spec', 'stack.md'), '\nNode.\n');
      await answer(root, '--answer', 'Orders.');
      await ask(root, 'platform', 'hosting', 'Where does it run?');
      await answer(root, '--answer', 'Fly.');
      const d = await cli(root, ['intake', 'done']);
      assert.equal(d.code, 1);
      assert.match(d.stderr, /intake writes no spec text; docs\/spec\/stack\.md changed during the interview/);
    },
    { files: docs() },
  );
});

test('done commits only the files that exist, and interface and open rows keep their shape', async () => {
  await withRepo(
    async (root) => {
      fs.writeFileSync(path.join(root, 'req.md'), '# Orders\n');
      assert.equal((await cli(root, ['intake', 'snapshot', 'req.md'])).code, 0);
      await ask(root, 'product', 'interfaces', 'What does billing call?');
      const misuse = await answer(root, '--answer', 'REST.', '--why', 'stray');
      assert.equal(misuse.code, 2);
      const a = await answer(root, '--answer', 'REST.', '--who', 'Ada', '--interface', 'Billing API', '--source', 'docs/intake/x.md:3');
      assert.equal(a.code, 0, a.stderr);
      await ask(root, 'platform', 'ledger', 'Where is the ledger kept?');
      const b = await answer(root, '--open', '--why', 'It sets the store.', '--recommendation', 'Ask finance.', '--interface', 'Ledger');
      assert.equal(b.code, 0, b.stderr);
      const d = await cli(root, ['intake', 'done']);
      assert.equal(d.code, 0, d.stderr);
      assert.equal(d.stdout, `open: ${first(b)} Where is the ledger kept?\n`);
      const text = decisionsText(root);
      assert.ok(text.includes(`| ${first(a)} | Decision | Interface: Billing API. What does billing call? | REST. Named at docs/intake/x.md:3. | Ada, ${DATE} |`), text);
      assert.ok(text.includes(`| ${first(b)} | Open | Interface: Ledger. Where is the ledger kept? | It sets the store. | Ask finance. |`), text);
      assert.equal(git(root, ['show', '--name-only', '--format=', 'HEAD']), 'docs/decisions.md');
      assert.equal(git(root, ['status', '--porcelain']), '?? req.md');
      const stage = await cli(root, ['stage', 'require', 'clarify']);
      assert.equal(stage.code, 0, stage.stderr);
      assert.match(stage.stdout, /^ready: clarify/);
    },
    { files: { 'docs/decisions.md': template('decisions.md'), 'docs/spec/stack.md': '# Stack\n' } },
  );
});

// ---- the procedure (REQ-2.2) ----

test('the procedure passes the brief lint', async () => {
  const { briefProblems } = await import('../helpers/brief-lint.js');
  const text = fs.readFileSync(new URL('../../templates/instructions/commands/intake.md', import.meta.url), 'utf8');
  assert.deepEqual(briefProblems(text, { kind: 'command' }), []);
  for (const want of ['intake ask', 'intake answer', 'intake done', '--interface', '--answer=', '{{cli}} branch spec', '{{cli}} intake snapshot {{args}}']) {
    assert.ok(text.includes(want), `the procedure names ${want}`);
  }
  assert.match(text, /writes no file under `<docsRoot>\/spec\/`/);
  // The steps come in the order the slice gives them.
  const order = ['branch spec', 'intake snapshot', 'intake ask --pass product', 'intake ask --pass platform', 'intake done'].map((s) => text.indexOf(s));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(!order.includes(-1));
});
