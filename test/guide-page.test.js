// P6/S-54 (REQ-5.8, D-97, D-61): docs/guide/slicekit-guide.html is written by scripts/guide-html.js
// from docs/guide/README.md and the pages that index links. The pages are the one source: a page that
// changes without the web page being written again fails here, with the command that writes it.
//
// What these tests fix about the script:
//   - it exports `guidePage(guideDir)`, the text of the web page for a guide folder;
//   - `node scripts/guide-html.js` writes the page, `--check` compares and writes nothing;
//   - `--guide <dir>` names another guide folder than the repository's docs/guide;
//   - the section of the page `<folder>/<name>.md` has the id `<folder>-<name>`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const GUIDE = path.join(ROOT, 'docs', 'guide');
const SCRIPT = path.join(ROOT, 'scripts', 'guide-html.js');
const PAGE = 'slicekit-guide.html';
const FOLDERS = ['commands', 'slash', 'rules'];
// The command that writes the web page again, as a message names it.
const REGENERATE = 'node scripts/guide-html.js';

const lf = (text) => text.replace(/\r\n/g, '\n');
const slashes = (text) => text.replace(/\\/g, '/');

// The script's function, loaded when a test runs so that a missing script fails the test by name.
async function loadGuidePage() {
  assert.ok(fs.existsSync(SCRIPT), 'scripts/guide-html.js is missing');
  const mod = await import(pathToFileURL(SCRIPT).href);
  assert.equal(typeof mod.guidePage, 'function', 'scripts/guide-html.js exports no function guidePage');
  return mod.guidePage;
}

// `node scripts/guide-html.js <args>`, run from the repository root.
function run(args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// Every page file of the guide, as `<folder>/<name>.md`, sorted.
function pageFiles(guide = GUIDE) {
  const out = [];
  for (const folder of FOLDERS) {
    for (const name of fs.readdirSync(path.join(guide, folder)).sort()) {
      if (name.endsWith('.md')) out.push(`${folder}/${name}`);
    }
  }
  return out;
}

const sectionId = (file) => file.replace(/\.md$/, '').replace('/', '-');

// A copy of the guide's sources and its web page in a private temporary directory, removed after the
// test. The copy holds the index, the three folders of pages and the web page, and nothing else.
function copyGuide(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-guide-page-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const guide = path.join(dir, 'docs', 'guide');
  fs.mkdirSync(guide, { recursive: true });
  fs.copyFileSync(path.join(GUIDE, 'README.md'), path.join(guide, 'README.md'));
  if (fs.existsSync(path.join(GUIDE, PAGE))) fs.copyFileSync(path.join(GUIDE, PAGE), path.join(guide, PAGE));
  for (const folder of FOLDERS) fs.cpSync(path.join(GUIDE, folder), path.join(guide, folder), { recursive: true });
  return guide;
}

// The first line at which two texts differ, for a message a person can act on.
function firstDifference(a, b) {
  const x = a.split('\n');
  const y = b.split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] !== y[i]) return `line ${i + 1}: the file has ${JSON.stringify(x[i] ?? null)}, the script writes ${JSON.stringify(y[i] ?? null)}`;
  }
  return 'no difference';
}

test('the web page equals what the script writes from the pages', async () => {
  const guidePage = await loadGuidePage();
  const expected = guidePage(GUIDE);
  assert.equal(typeof expected, 'string');
  assert.ok(!expected.includes('\r'), 'the script writes a line ending in CRLF');
  assert.ok(expected.endsWith('\n'), 'the page does not end in a line feed');

  // The file on disk, with CRLF read as LF: a checkout that converts line endings is not a difference.
  const onDisk = lf(fs.readFileSync(path.join(GUIDE, PAGE), 'utf8'));
  assert.ok(
    onDisk === expected,
    `docs/guide/${PAGE} differs from what the script writes; run \`${REGENERATE}\` to regenerate it (${firstDifference(onDisk, expected)})`,
  );

  // The same answer from the command line, which writes nothing.
  const before = fs.readFileSync(path.join(GUIDE, PAGE));
  const r = run(['--check']);
  assert.equal(r.code, 0, r.out);
  assert.ok(before.equals(fs.readFileSync(path.join(GUIDE, PAGE))), '--check wrote the page');
});

test('a changed page makes the check fail, naming the command that regenerates the web page', async (t) => {
  await loadGuidePage();
  const guide = copyGuide(t);
  const page = path.join(guide, PAGE);

  // The copy starts with its web page written by the script, so the check passes.
  const wrote = run(['--guide', guide]);
  assert.equal(wrote.code, 0, wrote.out);
  assert.ok(!fs.readFileSync(page, 'utf8').includes('\r'), 'the script wrote a line ending in CRLF');
  const clean = run(['--check', '--guide', guide]);
  assert.equal(clean.code, 0, clean.out);

  // One page changes; the web page does not.
  const marker = 'A sentence added to the init page after the web page was written.';
  fs.appendFileSync(path.join(guide, 'commands', 'init.md'), `\n${marker}\n`);
  const before = fs.readFileSync(page);
  const stale = run(['--check', '--guide', guide]);
  assert.equal(stale.code, 1, stale.out);
  const lines = stale.out.split(/\r?\n/).filter((l) => l.trim() !== '');
  assert.equal(lines.length, 1, `--check prints one line, got:\n${stale.out}`);
  assert.ok(lines[0].includes(PAGE), `the line does not name the page: ${lines[0]}`);
  assert.ok(lines[0].includes(REGENERATE), `the line does not name the command \`${REGENERATE}\`: ${lines[0]}`);
  assert.ok(before.equals(fs.readFileSync(page)), '--check wrote the page');

  // A stale page whose lines end in CRLF is still stale, and one that only differs by CRLF is not.
  const again = run(['--guide', guide]);
  assert.equal(again.code, 0, again.out);
  const fresh = fs.readFileSync(page, 'utf8');
  assert.ok(fresh.includes(marker), 'the page written again does not hold the changed page');
  fs.writeFileSync(page, fresh.replace(/\n/g, '\r\n'));
  const crlf = run(['--check', '--guide', guide]);
  assert.equal(crlf.code, 0, `a page that differs only by CRLF fails the check: ${crlf.out}`);
});

test('the page has a section for every command, slash command and rule page, and no version or date', async (t) => {
  const guidePage = await loadGuidePage();
  const html = guidePage(GUIDE);
  const index = lf(fs.readFileSync(path.join(GUIDE, 'README.md'), 'utf8'));
  const files = pageFiles();
  assert.ok(files.length >= 60, `docs/guide holds ${files.length} pages`);

  // One section per page file; a page file with no section is named.
  const without = files.filter((file) => !html.includes(`<section id="${sectionId(file)}"`));
  assert.deepEqual(without, [], `docs/guide/${PAGE} has no section for these page files`);
  for (const file of files) {
    const count = html.split(`<section id="${sectionId(file)}"`).length - 1;
    assert.equal(count, 1, `${file} has ${count} sections`);
  }

  // The sections follow the order in which the index links the pages.
  const linked = [];
  for (const m of index.matchAll(/\]\((?:\.\/)?((?:commands|slash|rules)\/[a-z0-9-]+\.md)\)/g)) {
    if (!linked.includes(m[1])) linked.push(m[1]);
  }
  assert.deepEqual([...linked].sort(), files, 'the index links every page file, and no page that is not a file');
  const positions = linked.map((file) => html.indexOf(`<section id="${sectionId(file)}"`));
  for (let i = 1; i < positions.length; i++) {
    assert.ok(positions[i - 1] < positions[i], `the section of ${linked[i]} comes before the section of ${linked[i - 1]}`);
  }

  // A contents list links every section.
  const nav = /<nav[\s>][\s\S]*?<\/nav>/.exec(html);
  assert.ok(nav, 'the page has no <nav> contents list');
  const unlisted = files.filter((file) => !nav[0].includes(`href="#${sectionId(file)}"`));
  assert.deepEqual(unlisted, [], 'the contents list links no section for these page files');

  // A link from one page to another is a link inside the page: no href names a Markdown file by a
  // relative path, and every href that starts with # has its target in the page.
  const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
  const toFiles = hrefs.filter((h) => !/^[a-z][a-z0-9+.-]*:/i.test(h) && /\.md(#.*)?$/.test(h));
  assert.deepEqual([...new Set(toFiles)], [], 'these links still point at a Markdown file');
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const dangling = hrefs.filter((h) => h.startsWith('#') && h.length > 1 && !ids.has(h.slice(1)));
  assert.deepEqual([...new Set(dangling)], [], 'these links point at no id of the page');
  assert.ok(hrefs.includes('#commands-init'), 'no link of the page points at the init section');

  // The init section is written from the init page, so its usage line carries --default-branch.
  const start = html.indexOf('<section id="commands-init"');
  const init = html.slice(start, html.indexOf('</section>', start));
  assert.ok(init.includes('--default-branch'), 'the init section does not carry --default-branch');

  // No version and no date of the script's own: each one in the page is in the Markdown it was
  // written from. The title carries none at all.
  const sources = [index, ...files.map((file) => lf(fs.readFileSync(path.join(GUIDE, file), 'utf8')))].join('\n');
  const stamps = [...html.matchAll(/\b\d+\.\d+\.\d+\b|\b\d{4}-\d{2}-\d{2}\b/g)].map((m) => m[0]);
  const added = [...new Set(stamps)].filter((s) => !sources.includes(s));
  assert.deepEqual(added, [], 'the page holds a version or a date that no page of the guide holds');
  const title = /<title>([^<]*)<\/title>/.exec(html);
  assert.ok(title, 'the page has no <title>');
  assert.doesNotMatch(title[1], /\d/, 'the title carries a number');

  // No absolute path: the same pages in another folder give the same bytes.
  const copy = copyGuide(t);
  assert.ok(guidePage(copy) === html, 'the page differs when the guide sits in another folder');
  for (const place of [ROOT, os.homedir(), os.tmpdir()]) {
    const trimmed = place.replace(/[\\/]+$/, '');
    assert.ok(!slashes(html).includes(slashes(trimmed)), `the page holds the path ${trimmed}`);
  }
});

test('a Markdown construct the script does not convert fails, naming the file and line', async (t) => {
  const guidePage = await loadGuidePage();
  const guide = copyGuide(t);
  const page = path.join(guide, PAGE);
  const wrote = run(['--guide', guide]);
  assert.equal(wrote.code, 0, wrote.out);
  const before = fs.readFileSync(page);

  // An image is no construct of the pages: headings, paragraphs, lists, tables, fenced code, code
  // spans, links and emphasis are. It is added after a blank line, on a line the test counts.
  const file = path.join(guide, 'commands', 'init.md');
  const text = lf(fs.readFileSync(file, 'utf8')).replace(/\n*$/, '\n');
  const line = text.split('\n').length + 1;
  fs.writeFileSync(file, `${text}\n![a diagram of the stages](stages.png)\n`);
  const named = new RegExp(`commands/init\\.md:${line}\\b`);

  for (const args of [['--guide', guide], ['--check', '--guide', guide]]) {
    const r = run(args);
    assert.equal(r.code, 1, `${args.join(' ')}: ${r.out}`);
    assert.match(slashes(r.out), named, `${args.join(' ')} does not name commands/init.md:${line}`);
    assert.ok(before.equals(fs.readFileSync(page)), `${args.join(' ')} wrote the page`);
  }

  // The function refuses it the same way, so the comparing test cannot pass over it.
  assert.throws(() => guidePage(guide), (err) => named.test(slashes(String(err.message))));

  // The same construct inside a code block is text, not a construct, and converts.
  fs.writeFileSync(file, `${text}\n\`\`\`text\n![a diagram of the stages](stages.png)\n\`\`\`\n`);
  const fenced = run(['--guide', guide]);
  assert.equal(fenced.code, 0, fenced.out);
});
