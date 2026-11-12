// REQ-5.5, D-62, D-91 (P5/S-48): the kit's publish workflow. It runs on a push to the default branch
// and on workflow_dispatch; a step with `id: new` decides whether package.json's version is new (not on
// npm, no tag v<version>) and writes `publish=true` or `publish=false` to $GITHUB_OUTPUT; the job that
// publishes runs in the environment `npm` with provenance and no token, then pushes the tag. The tests
// read the workflow as text and run the `id: new` step's script with a stubbed `npm view` and
// `git ls-remote`; nothing publishes, pushes or reaches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveBash } from './helpers/walkthrough.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'publish.yml');
const PINS = path.join(ROOT, 'templates', 'workflow', 'pins.json');
const HEX40 = /^[0-9a-f]{40}$/;

// ---- helpers of this evaluation set ----

const readWorkflow = () => {
  assert.ok(fs.existsSync(WORKFLOW), `${WORKFLOW} is missing`);
  return fs.readFileSync(WORKFLOW, 'utf8').replace(/\r\n/g, '\n');
};
const indentOf = (line) => line.match(/^ */)[0].length;

// The top-level block `key:` of the workflow, up to the next top-level key.
function topBlock(yml, key) {
  const lines = yml.split('\n');
  const start = lines.findIndex((l) => l === `${key}:` || l.startsWith(`${key}: `) || l === `'${key}':` || l === `"${key}":`);
  assert.ok(start >= 0, `no top-level ${key}:`);
  let end = start + 1;
  while (end < lines.length && (lines[end] === '' || /^\s/.test(lines[end]) || lines[end].startsWith('#'))) end++;
  return lines.slice(start, end).join('\n');
}

// Each job under `jobs:` as { id, text }.
function jobs(yml) {
  const lines = topBlock(yml, 'jobs').split('\n').slice(1);
  const out = [];
  for (const line of lines) {
    const m = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (m) out.push({ id: m[1], lines: [line] });
    else if (out.length > 0) out.at(-1).lines.push(line);
  }
  return out.map(({ id, lines: l }) => ({ id, text: l.join('\n') }));
}

// The script of the step whose `id:` is `id`: its `run: |` block, dedented.
function stepScript(yml, id) {
  const lines = yml.split('\n');
  const at = lines.findIndex((l) => new RegExp(`^\\s*(- )?id: ${id}\\s*$`).test(l));
  assert.ok(at >= 0, `no step with id: ${id}`);
  let start = at;
  while (start >= 0 && !/^\s*- /.test(lines[start])) start--;
  assert.ok(start >= 0, `step ${id} has no list item`);
  const item = indentOf(lines[start]);
  let end = start + 1;
  while (end < lines.length && (lines[end].trim() === '' || indentOf(lines[end]) > item)) end++;
  const step = lines.slice(start, end);
  const run = step.findIndex((l) => /^\s*(- )?run: [|>][-+]?\s*$/.test(l));
  assert.ok(run >= 0, `step ${id} has no run: | block`);
  const key = indentOf(step[run].replace('- ', '  '));
  const body = [];
  for (const l of step.slice(run + 1)) {
    if (l.trim() !== '' && indentOf(l) <= key) break;
    body.push(l);
  }
  const strip = Math.min(...body.filter((l) => l.trim() !== '').map(indentOf));
  return `${body.map((l) => l.slice(strip)).join('\n').trimEnd()}\n`;
}

// What the stubbed `npm` and `git` answer. npm: `npm view <name>@<v> [field]` prints <v> when it is
// published and nothing (exit 0) when it is not, as npm does for a published package; `npm view <name>
// versions [--json]` lists them. git: `git ls-remote [--tags] <remote> [patterns]` lists the tags
// matching a pattern by its last path segments, as git does. Anything else fails, so the script asks
// nothing else of either. Every call is logged.
const STUB = `
const fs = require('node:fs');
const [tool, ...args] = process.argv.slice(2);
fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ tool, args }) + '\\n');
const list = (v) => (v || '').split(' ').filter(Boolean);
const words = args.filter((a) => !a.startsWith('-'));
if (tool === 'npm') {
  if (!['view', 'info', 'show', 'v'].includes(words[0])) { console.error('stub npm: only npm view'); process.exit(2); }
  const published = list(process.env.STUB_NPM_VERSIONS);
  const json = args.includes('--json');
  const spec = words[1] || '';
  const field = words[2];
  const at = spec.lastIndexOf('@');
  const version = at > 0 ? spec.slice(at + 1) : null;
  if (version !== null) {
    if (published.includes(version)) process.stdout.write((json ? JSON.stringify(version) : version) + '\\n');
  } else if (field === 'versions') {
    process.stdout.write(json ? JSON.stringify(published) + '\\n' : published.map((v) => "'" + v + "'").join('\\n') + '\\n');
  } else if (field === 'version' || field === undefined) {
    if (published.length) process.stdout.write(published.at(-1) + '\\n');
  }
  process.exit(0);
}
if (tool === 'git') {
  if (words[0] !== 'ls-remote') { console.error('stub git: only git ls-remote'); process.exit(2); }
  const patterns = words.slice(2);
  for (const tag of list(process.env.STUB_TAGS)) {
    const ref = 'refs/tags/' + tag;
    const hit = patterns.length === 0 || patterns.some((p) => ref === p || ref.endsWith('/' + p));
    if (hit) process.stdout.write('0123456789abcdef0123456789abcdef01234567\\t' + ref + '\\n');
  }
  process.exit(0);
}
process.exit(2);
`;

const posix = (p) => p.split(path.sep).join('/');

// Runs the `id: new` step's script in a directory holding package.json at `version`, with `npm` and
// `git` stubbed; returns the outputs it wrote and the stub calls.
function runNewVersionStep(script, { version, published = [], tags = [] }) {
  assert.doesNotMatch(script, /\$\{\{/, 'the script reads no ${{ }} expression, so it runs as written');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-publish-'));
  try {
    const work = path.join(dir, 'work');
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(work);
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(work, 'package.json'), `${JSON.stringify({ name: 'slicekit', version, type: 'module' }, null, 2)}\n`);
    const stub = path.join(dir, 'stub.cjs');
    fs.writeFileSync(stub, STUB);
    for (const tool of ['npm', 'git']) {
      fs.writeFileSync(path.join(bin, tool), `#!/bin/sh\nexec "${posix(process.execPath)}" "${posix(stub)}" ${tool} "$@"\n`, { mode: 0o755 });
    }
    const output = path.join(dir, 'github-output');
    fs.writeFileSync(output, '');
    const log = path.join(dir, 'calls.jsonl');
    fs.writeFileSync(log, '');
    const file = path.join(dir, 'step.sh');
    fs.writeFileSync(file, script);
    const env = { ...process.env };
    const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
    env[key] = [bin, env[key]].filter(Boolean).join(path.delimiter);
    Object.assign(env, { GITHUB_OUTPUT: output, STUB_LOG: log, STUB_NPM_VERSIONS: published.join(' '), STUB_TAGS: tags.join(' ') });
    const r = spawnSync(resolveBash({ env }), ['--noprofile', '--norc', '-eo', 'pipefail', posix(file)], { cwd: work, env, encoding: 'utf8' });
    assert.equal(r.status, 0, `the step failed: ${r.stderr}${r.stdout}${r.error?.message ?? ''}`);
    const outputs = Object.fromEntries(
      fs.readFileSync(output, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
    );
    const calls = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    return { outputs, calls };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// The one job that runs `npm publish`.
function publishJob(yml) {
  const found = jobs(yml).filter((j) => /\bnpm publish\b/.test(j.text));
  assert.equal(found.length, 1, `jobs that run npm publish: ${found.map((j) => j.id).join(', ')}`);
  return found[0];
}

// ---- the evaluation set ----

test('the publish workflow pins every action by SHA and publishes with provenance when the version is new', () => {
  const yml = readWorkflow();
  const pins = JSON.parse(fs.readFileSync(PINS, 'utf8'));

  // A push to the default branch and workflow_dispatch; no tag trigger (D-91).
  const on = topBlock(yml, 'on');
  assert.match(on, /^\s+push:/m, on);
  assert.match(on, /branches:\s*(\[\s*['"]?main['"]?\s*\]|\n\s+-\s*['"]?main['"]?)/, on);
  assert.match(on, /^\s+workflow_dispatch:?/m, on);
  assert.doesNotMatch(on, /\btags:/, on);

  // Every action is pinned by a 40-hex SHA from templates/workflow/pins.json, with its tag beside it.
  const uses = [...yml.matchAll(/^\s*(?:- )?uses: (\S+)@(\S+)(?: # (\S+))?\s*$/gm)];
  assert.ok(uses.length > 0, 'no action used');
  for (const [, action, sha, tag] of uses) {
    assert.ok(pins[action], `${action} is not in pins.json`);
    assert.match(sha, HEX40, action);
    assert.equal(sha, pins[action].sha, action);
    assert.equal(tag, pins[action].tag, action);
  }
  assert.equal(uses.length, [...yml.matchAll(/\buses:/g)].length, 'every uses: line names action@sha');

  // The publishing job: ubuntu-latest, the environment npm, id-token and contents write.
  const job = publishJob(yml).text;
  assert.match(job, /^\s+runs-on: ubuntu-latest\s*$/m, job);
  assert.match(job, /^\s+environment:\s*(npm|\n\s+name:\s*npm)\s*$/m, job);
  assert.match(job, /^\s+id-token: write\s*$/m, job);
  assert.match(job, /^\s+contents: write\s*$/m, job);
  // It runs only when the version is new.
  assert.match(job, /outputs\.publish == 'true'/, job);

  // npm ci, npm test, npm 11.5.1 or later, the publish with provenance, then the tag.
  const at = (re) => {
    const m = job.match(re);
    assert.ok(m, `${re} in\n${job}`);
    return m.index;
  };
  const ci = at(/\bnpm ci\b/);
  const runTests = at(/\bnpm test\b/);
  const npmInstall = job.match(/\bnpm (?:install|i) (?:-g|--global) npm@(\S+)/);
  assert.ok(npmInstall, `no npm install -g npm@<version> in\n${job}`);
  const wanted = npmInstall[1].replace(/['"]/g, '');
  if (wanted !== 'latest') {
    const [maj, min, pat] = wanted.split('.').map(Number);
    assert.ok(maj > 11 || (maj === 11 && (min > 5 || (min === 5 && pat >= 1))), `npm@${wanted} is older than 11.5.1`);
  }
  const publish = at(/\bnpm publish --provenance --access public\b/);
  const tag = at(/\bgit push\b[^\n]*\bv\$|\bgit push\b[^\n]*refs\/tags\/v|\bgit push\b[^\n]*"v\$/);
  assert.ok(ci < runTests && runTests < publish && npmInstall.index < publish && publish < tag, job);

  // No token: trusted publishing (D-62).
  assert.doesNotMatch(yml, /NPM_TOKEN|NODE_AUTH_TOKEN|_authToken|secrets\.NPM/i);

  // A new version (not on npm, no tag v<version>), with neighbours on npm and in the tags: publish.
  const { outputs, calls } = runNewVersionStep(stepScript(yml, 'new'), { version: '0.4.0', published: ['0.3.0', '0.4.01', '10.4.0'], tags: ['v0.3.0', 'v0.4.01', 'v0.4.0-rc'] });
  assert.equal(outputs.publish, 'true', JSON.stringify(outputs));
  assert.ok(calls.some((c) => c.tool === 'npm'), 'the step asks npm');
  assert.ok(calls.some((c) => c.tool === 'git'), 'the step asks git ls-remote');
});

test('the publish workflow publishes nothing when the version is already on npm or tagged', () => {
  const yml = readWorkflow();
  const script = stepScript(yml, 'new');
  for (const [label, given] of [
    ['on npm', { published: ['0.3.0', '0.4.0'], tags: ['v0.3.0'] }],
    ['tagged', { published: ['0.3.0'], tags: ['v0.3.0', 'v0.4.0'] }],
    ['on npm and tagged', { published: ['0.4.0'], tags: ['v0.4.0'] }],
  ]) {
    const { outputs } = runNewVersionStep(script, { version: '0.4.0', ...given });
    assert.equal(outputs.publish, 'false', `${label}: ${JSON.stringify(outputs)}`);
  }
  // Every step that publishes or tags is behind the decision.
  const job = publishJob(yml).text;
  const gatedJob = /^ {4}if:[^\n]*outputs\.publish == 'true'/m.test(job);
  if (!gatedJob) {
    const steps = job.split(/\n(?=\s+- )/);
    for (const s of steps.filter((t) => /\bnpm publish\b|\bgit push\b|\bgit tag\b/.test(t))) assert.match(s, /if:[^\n]*outputs\.publish == 'true'/, s);
  }
});
