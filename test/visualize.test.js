// P3/S-19, visualize: REQ-4.7 (one self-contained page with six views and a node detail, written to
// disk with the graph inlined or served from node:http on 127.0.0.1; no external resource, D-04).
// The graph is built once from graphRepo (test/helpers/graph-fixture.js) against the fixture host,
// then given, by writing graph.json directly, what the builder cannot make yet (a second repository,
// S-20's): repo:svc with a web address, P1/S-02 placed in it, and P1/S-02's commit touching src/a.js
// so one file has two slices. No browser is needed: the page's script runs under node:vm; a
// headless browser runs only when one is on the PATH. Nothing reaches the network.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { serializeGraph, validateGraph } from '../src/graph/schema.js';
import { which } from '../src/which.js';
import { cli } from './helpers/build-flow.js';
import { graphRepo, PR_URL } from './helpers/graph-fixture.js';
import { makeRepo } from './helpers/tmp-repo.js';
import { binPath } from './helpers/run-cli.js';

const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:";
const VIEWS = ['requirements', 'board', 'timeline', 'heat', 'contracts', 'releases'];
const EVIL = '</script><script>alert(1)</script><!--    &amp;';

const load = (rel) => import(new URL(`../src/${rel}`, import.meta.url).href);

// Every <script> of a page: [{attrs, body}].
function scripts(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map((m) => ({ attrs: m[1], body: m[2] }));
}

// The inlined graph block's text, parsed.
function inlinedGraph(html) {
  const block = scripts(html).find((s) => /type="application\/json"/.test(s.attrs) && /id="graph"/.test(s.attrs));
  assert.ok(block, 'no <script type="application/json" id="graph"> block');
  return JSON.parse(block.body);
}

// The page script (the <script> with no type) run under node:vm with no document -> slicekitViews.
function viewsOf(html) {
  const code = scripts(html).filter((s) => !/\btype=/.test(s.attrs) && !/\bsrc=/.test(s.attrs));
  assert.equal(code.length, 1, 'the page holds one inline page script');
  const views = vm.runInNewContext(`${code[0].body}\n;typeof slicekitViews === 'undefined' ? undefined : slicekitViews`, {}, { timeout: 2000 });
  assert.ok(views && typeof views === 'object', 'the page script defines no slicekitViews');
  return views;
}

// The real CLI as a child process, killed after `ms`; resolves {code, stdout, stderr, timedOut}.
// `onStdout(text, child)` sees stdout as it arrives.
function runBin(args, cwd, { ms = 5000, onStdout } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [binPath, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, ms);
    child.stdout.on('data', (d) => {
      stdout += d;
      onStdout?.(stdout, child);
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

// Resolves true when a TCP connection to host:port opens within a second, false otherwise.
function connects(host, port) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (ok) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(1000, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

let shared;
let graph;
let tmp;
before(async () => {
  shared = graphRepo();
  const r = await cli(shared.root, ['graph'], { ...process.env, SLICEKIT_GITHOST_FIXTURE: shared.fixture });
  assert.equal(r.code, 0, `graph failed: ${r.stderr}`);
  const file = path.join(shared.root, '.slicekit', 'graph', 'graph.json');
  const g = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { sliceB } = shared.shas;
  g.repos.push({ name: 'svc', sha: sliceB });
  g.nodes.push({ id: 'repo:svc', kind: 'repo', label: 'svc', from: 'svc', web: 'https://github.com/acme/svc' });
  g.nodes.find((n) => n.id === 'slice:P1/S-02').repo = 'svc';
  g.edges.push({ kind: 'touched', from: `commit:${sliceB}`, to: 'file:src/a.js', at: sliceB });
  assert.deepEqual(validateGraph(g), []);
  fs.writeFileSync(file, serializeGraph(g));
  graph = JSON.parse(fs.readFileSync(file, 'utf8'));
  tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-visualize-')));
});
after(() => {
  shared?.cleanup();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

test('the page written to disk carries the graph inlined and renders the six views', async () => {
  const file = path.join(tmp, 'page.html');
  const r = await cli(shared.root, ['visualize', '--write', file]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(path.resolve(shared.root, r.stdout.split('\n')[0]), file, `the first stdout line is the file's path:\n${r.stdout}`);
  const html = fs.readFileSync(file, 'utf8');

  const { renderPage } = await load('visualize/page.js');
  assert.equal(html, renderPage(graph), 'the file is renderPage of the graph on disk');
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<meta charset="utf-8">/i);
  assert.match(html, /<aside id="detail"/);
  assert.match(html, /prefers-color-scheme/);
  const nav = /<nav\b[^>]*>([\s\S]*?)<\/nav>/.exec(html);
  assert.ok(nav, 'no <nav>');
  assert.equal((nav[1].match(/<button\b/g) ?? []).length, 6, 'six nav buttons');
  for (const v of VIEWS) assert.match(html, new RegExp(`<section[^>]*data-view="${v}"`), `no section for ${v}`);

  assert.deepEqual(inlinedGraph(html), graph);

  const views = viewsOf(html);
  for (const v of [...VIEWS, 'detail']) assert.equal(typeof views[v], 'function', `slicekitViews.${v}`);
  const out = Object.fromEntries(VIEWS.map((v) => [v, views[v](graph)]));
  for (const v of VIEWS) assert.equal(typeof out[v], 'string', `${v} returns a string`);

  assert.match(out.requirements, /data-id="requirement:REQ-1\.3"/);
  assert.ok(out.requirements.includes('REQ-1.3'), out.requirements);

  // REQ-1.8's order: building before merged.
  const b2 = out.board.indexOf('data-id="slice:P1/S-02"');
  const b1 = out.board.indexOf('data-id="slice:P1/S-01"');
  assert.ok(b2 !== -1 && b1 !== -1, out.board);
  assert.ok(b2 < b1, `building (P1/S-02) comes before merged (P1/S-01):\n${out.board}`);
  assert.ok(out.board.indexOf('building') < out.board.indexOf('merged'), out.board);

  // P1/S-01: its first commit on 2026-09-21, merged 2026-10-02.
  assert.match(out.timeline, /data-id="slice:P1\/S-01"/);
  assert.ok(out.timeline.includes('2026-09-21') && out.timeline.includes('2026-10-02'), out.timeline);

  // src/a.js has two slices, every other file one: it comes first, ahead of src/Billing.java, which
  // sorts before it by name.
  const heatA = out.heat.indexOf('data-id="file:src/a.js"');
  assert.ok(heatA !== -1, out.heat);
  for (const other of ['file:src/b.js', 'file:src/Billing.java']) {
    const at = out.heat.indexOf(`data-id="${other}"`);
    assert.ok(at !== -1 && heatA < at, `src/a.js (2 slices) before ${other}:\n${out.heat}`);
  }

  assert.match(out.contracts, /data-id="contract:C-1"/);
  for (const s of ['P1/S-01', 'P1/S-02', 'svc']) assert.ok(out.contracts.includes(s), `contracts names ${s}:\n${out.contracts}`);

  assert.match(out.releases, /data-id="release:P1"/);
  for (const s of ['#1', 'REQ-1.1']) assert.ok(out.releases.includes(s), `releases names ${s}:\n${out.releases}`);
});

test('clicking a node shows its files, commits and pull requests with links to the git host', async () => {
  const { renderPage } = await load('visualize/page.js');
  const views = viewsOf(renderPage(graph));
  const html = views.detail(graph, 'slice:P1/S-01');
  assert.equal(typeof html, 'string');
  const { sliceA } = shared.shas;
  assert.ok(html.includes('src/a.js'), html);
  assert.ok(html.includes(`href="https://github.com/acme/demo/commit/${sliceA}"`), `a commit links to <web>/commit/<sha>:\n${html}`);
  assert.ok(html.includes(`href="${PR_URL}"`), `the pull request links to its url:\n${html}`);
  const anchors = html.match(/<a\b[^>]*>/g) ?? [];
  assert.ok(anchors.length >= 2, html);
  for (const a of anchors) {
    assert.match(a, /target="_blank"/, a);
    assert.match(a, /rel="[^"]*\bnoopener\b[^"]*"/, a);
  }
  // Nothing in the detail loads by itself.
  assert.doesNotMatch(html, /<(img|iframe|script|link|object|embed)\b/i, html);
});

test('the page loads no external resource', async () => {
  const { CSP: exported, renderPage } = await load('visualize/page.js');
  assert.equal(exported, CSP);
  const html = renderPage(graph);

  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  const csp = metas.find((m) => /http-equiv="Content-Security-Policy"/i.test(m));
  assert.ok(csp, 'no Content-Security-Policy meta');
  assert.ok(csp.includes(`content="${CSP}"`), csp);

  assert.doesNotMatch(html, /<link\b/i);
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc\s*=/i);
  assert.doesNotMatch(html, /<(iframe|object|embed|base)\b/i);
  assert.doesNotMatch(html, /@import/i);
  for (const m of html.matchAll(/url\(\s*['"]?([^'")\s]*)/gi)) assert.ok(m[1].startsWith('data:'), `url(${m[1]}`);

  // Outside the inlined graph (data, not a reference) and outside href attributes: no http:, https:
  // or protocol-relative URL.
  const outside = html
    .replace(/(<script\b[^>]*type="application\/json"[^>]*>)[\s\S]*?(<\/script>)/i, '$1$2')
    .replace(/\bhref\s*=\s*"[^"]*"/gi, 'href=""');
  assert.doesNotMatch(outside, /https?:/i);
  assert.doesNotMatch(outside, /["'(=\s]\/\/[\w.-]+\.[a-z]/i);

  // The page script asks for nothing over the network either.
  const code = scripts(html).filter((s) => !/\btype=/.test(s.attrs)).map((s) => s.body).join('\n');
  assert.doesNotMatch(code, /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|\bimport\s*\(|importScripts|new\s+Worker/);
});

test('a label holding a closing script tag stays inside the inlined graph', async () => {
  const { inlineJson, renderPage } = await load('visualize/page.js');
  const text = inlineJson({ s: EVIL });
  for (const ch of ['<', '>', '&', ' ', ' ']) assert.ok(!text.includes(ch), `inlineJson leaves ${JSON.stringify(ch)} raw: ${text}`);
  assert.deepEqual(JSON.parse(text), { s: EVIL });

  const g = structuredClone(graph);
  const slice = g.nodes.find((n) => n.id === 'slice:P1/S-01');
  slice.label = EVIL;
  slice.name = EVIL;
  const html = renderPage(g);
  assert.equal((html.match(/<script\b/gi) ?? []).length, 2, 'exactly two <script openings');
  assert.equal((html.match(/<\/script/gi) ?? []).length, 2, 'exactly two </script closings');
  const parsed = inlinedGraph(html);
  const back = parsed.nodes.find((n) => n.id === 'slice:P1/S-01');
  assert.equal(back.label, EVIL);
  assert.equal(back.name, EVIL);

  // The views write the label as text, never as markup.
  const views = viewsOf(html);
  for (const out of [views.board(g), views.timeline(g), views.contracts(g), views.detail(g, 'slice:P1/S-01')]) {
    assert.doesNotMatch(out, /<\/?script/i, out);
  }
});

test('the server listens on 127.0.0.1 and serves the page and graph.json, and nothing else', async () => {
  const { startServer } = await load('visualize/server.js');
  const html = '<!doctype html><p>page</p>';
  const graphJson = '{"schemaVersion":1}\n';
  const s = await startServer({ html, graphJson, port: 0 });
  let closed = false;
  try {
    assert.ok(Number.isInteger(s.port) && s.port > 0, `port ${s.port}`);
    assert.equal(s.url, `http://127.0.0.1:${s.port}/`);

    const page = await fetch(s.url);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(await page.text(), html);

    const data = await fetch(`${s.url}graph.json`);
    assert.equal(data.status, 200);
    assert.match(data.headers.get('content-type') ?? '', /^application\/json/);
    assert.equal(await data.text(), graphJson);

    for (const p of ['x', 'graph.json/x', 'index.html']) {
      const res = await fetch(`${s.url}${p}`);
      await res.arrayBuffer();
      assert.equal(res.status, 404, p);
    }
    // A raw path that climbs with `..`: fetch would normalise it to /graph.json before sending, so
    // it is sent as it is with node:http, and the server must not resolve it.
    const raw = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: s.port, path: '/../graph.json', method: 'GET' }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(raw, 404, '/../graph.json sent raw');

    // Bound to 127.0.0.1 alone: not reachable on the IPv6 loopback or any other local address.
    assert.equal(await connects('::1', s.port), false, 'reachable on ::1');
    for (const list of Object.values(os.networkInterfaces())) {
      for (const a of list ?? []) {
        if (a.family === 'IPv4' && !a.internal) assert.equal(await connects(a.address, s.port), false, `reachable on ${a.address}`);
      }
    }

    await s.close();
    closed = true;
    await assert.rejects(fetch(s.url), 'a fetch after close fails');
  } finally {
    if (!closed) await s.close();
  }

  // The CLI serves the page with the graph inlined, prints the URL as its first line and opens nothing.
  let url = null;
  const r = await runBin(['visualize', '--port', '0'], shared.root, {
    ms: 10000,
    onStdout(text, child) {
      const m = /^(http:\/\/127\.0\.0\.1:\d+\/)$/m.exec(text);
      if (!m || url) return;
      url = m[1];
      fetch(url)
        .then((res) => res.text())
        .then((body) => {
          url = { url, body };
        })
        .catch((e) => {
          url = { url, error: String(e) };
        })
        .finally(() => child.kill('SIGINT'));
    },
  });
  assert.ok(url && typeof url === 'object', `no URL printed: ${r.stdout} ${r.stderr}`);
  assert.equal(r.stdout.split('\n')[0], url.url);
  assert.ok(url.body?.includes('id="graph"'), url.error ?? url.body);
  assert.equal(r.timedOut, false, 'the server did not stop');
  // A signal Ctrl-C sends exists on POSIX only; on win32 kill() ends the process outright.
  if (process.platform !== 'win32') assert.equal(r.code, 0, r.stderr);
});

test('with no graph built visualize says to run slicekit graph and starts nothing', async () => {
  const repo = makeRepo({ files: { '.slicekit/config.json': fs.readFileSync(path.join(shared.root, '.slicekit', 'config.json'), 'utf8') } });
  try {
    const r = await runBin(['visualize', '--port', '0'], repo.root, { ms: 5000 });
    assert.equal(r.timedOut, false, `still running after five seconds: ${r.stdout}`);
    assert.equal(r.code, 1, r.stderr);
    assert.ok(r.stderr.includes('no graph at .slicekit/graph/graph.json; run slicekit graph'), r.stderr);
    assert.doesNotMatch(r.stdout, /http:/);
  } finally {
    repo.cleanup();
  }
});

test('a port in use is refused', async () => {
  const { startServer } = await load('visualize/server.js');
  const first = await startServer({ html: '<p>a</p>', graphJson: '{}', port: 0 });
  try {
    const message = `port ${first.port} is in use; pass --port`;
    await assert.rejects(startServer({ html: '<p>b</p>', graphJson: '{}', port: first.port }), (e) => e.code === 1 && e.message === message);

    const r = await runBin(['visualize', '--port', String(first.port)], shared.root, { ms: 5000 });
    assert.equal(r.timedOut, false, `still running after five seconds: ${r.stdout}`);
    assert.equal(r.code, 1, r.stderr);
    assert.ok(r.stderr.includes(message), r.stderr);
    assert.doesNotMatch(r.stdout, /http:/);
  } finally {
    await first.close();
  }
});

test('a headless browser, when one is present, renders every view from the file on disk', async (t) => {
  const dir = fs.mkdtempSync(path.join(tmp, 'e2e-'));
  const file = path.join(dir, 'page.html');
  const r = await cli(shared.root, ['visualize', '--write', file]);
  assert.equal(r.code, 0, r.stderr);

  const browser = ['chrome', 'google-chrome', 'chromium', 'chromium-browser', 'msedge'].map((n) => which(n, process.env)).find(Boolean);
  if (!browser) {
    t.skip('no headless browser on the PATH');
    return;
  }
  const dom = await new Promise((resolve, reject) => {
    const child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${path.join(dir, 'profile')}`, '--dump-dom', pathToFileURL(file).href], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('the browser did not finish in 60 seconds'));
    }, 60_000);
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.on('error', reject);
    child.on('close', () => {
      clearTimeout(timer);
      resolve(out);
    });
  });
  const sections = [...dom.matchAll(/<section\b[^>]*data-view="([\w-]+)"[^>]*>([\s\S]*?)<\/section>/g)];
  assert.deepEqual(sections.map((m) => m[1]).sort(), [...VIEWS].sort(), dom.slice(0, 2000));
  for (const [, view, body] of sections) assert.match(body, /data-id="/, `view ${view} holds no node`);
});
