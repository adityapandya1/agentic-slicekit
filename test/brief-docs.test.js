// P7/S-57 (REQ-5.8, REQ-5.7, D-99): the blank brief a person fills in by hand, and the brief of
// examples/backend. The section list is the one `slicekit stage require brief` checks, read from
// src/brief.js, so the blank brief cannot fall behind the stage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BRIEF_HEADINGS, missingHeadings, unlistedEmptySections } from '../src/brief.js';
import { binPath, runCli } from './helpers/run-cli.js';

const KIT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const BLANK = 'templates/brief/blank.md';
const EXAMPLE_BRIEF = 'examples/backend/docs/brief/greeting.md';
const OPEN = 'Open questions';

const readKit = (rel) => fs.readFileSync(path.join(KIT_ROOT, ...rel.split('/')), 'utf8').replace(/\r\n/g, '\n');

// The `## ` sections of a brief outside code blocks, in file order: [{heading, lines}], `lines` the
// non-blank lines under the heading up to the next heading of any level.
function briefSections(text) {
  const out = [];
  let open = false;
  let at = null;
  for (const raw of text.split('\n')) {
    if (/^\s*(`{3,}|~{3,})/.test(raw)) {
      open = !open;
      if (at) at.lines.push(raw.trim());
      continue;
    }
    if (!open && /^#{1,6}\s/.test(raw)) {
      at = /^##\s/.test(raw) ? { heading: raw.replace(/^##\s+/, '').trim(), lines: [] } : null;
      if (at) out.push(at);
      continue;
    }
    if (at && raw.trim() !== '') at.lines.push(raw.trim());
  }
  return out;
}

test('the blank brief holds the seven sections stage require brief checks', () => {
  assert.equal(BRIEF_HEADINGS.length, 7, `src/brief.js names ${BRIEF_HEADINGS.length} sections`);
  assert.ok(fs.existsSync(path.join(KIT_ROOT, ...BLANK.split('/'))), `${BLANK} is missing`);
  const text = readKit(BLANK);

  // Its `## ` headings are the section list, in its order, and nothing else.
  const sections = briefSections(text);
  assert.deepEqual(sections.map((s) => s.heading), BRIEF_HEADINGS, `the ## headings of ${BLANK}`);
  assert.deepEqual(missingHeadings(text), []);

  // One line under each heading, saying what goes there.
  for (const s of sections) {
    assert.equal(s.lines.length, 1, `## ${s.heading} in ${BLANK} holds ${s.lines.length} lines, not one: ${s.lines.join(' / ')}`);
    assert.ok(s.lines[0].length >= 10, `the line under ## ${s.heading} says nothing: ${s.lines[0]}`);
  }

  // A blank brief with any one heading taken out is short exactly that section.
  for (const heading of BRIEF_HEADINGS) {
    const without = text
      .split('\n')
      .filter((l) => l.trim() !== `## ${heading}`)
      .join('\n');
    assert.deepEqual(missingHeadings(without), [heading], `${BLANK} without ## ${heading}`);
  }

  // The slicekit brief page names the blank brief.
  assert.ok(readKit('docs/guide/commands/brief.md').includes(BLANK), `docs/guide/commands/brief.md does not name ${BLANK}`);
});

test("the example's brief passes stage require brief", () => {
  assert.ok(fs.existsSync(path.join(KIT_ROOT, ...EXAMPLE_BRIEF.split('/'))), `${EXAMPLE_BRIEF} is missing`);
  const text = readKit(EXAMPLE_BRIEF);

  // All seven sections, each topic answered, and one entry under ## Open questions.
  assert.deepEqual(missingHeadings(text), [], `${EXAMPLE_BRIEF} is missing sections`);
  assert.deepEqual(unlistedEmptySections(text), [], `${EXAMPLE_BRIEF} has empty sections not listed as open`);
  const sections = briefSections(text);
  const open = sections.find((s) => s.heading === OPEN);
  assert.equal(open.lines.length, 1, `## ${OPEN} in ${EXAMPLE_BRIEF} holds ${open.lines.length} entries: ${open.lines.join(' / ')}`);
  assert.ok(open.lines[0].length >= 10, `the open question says nothing: ${open.lines[0]}`);
  assert.match(text, /greet/i, `${EXAMPLE_BRIEF} does not mention the greeting service`);

  // examples/backend is kept before init, so the stage runs in a copy that init has added the kit to,
  // as the walkthrough does.
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-brief-docs-')));
  try {
    fs.cpSync(path.join(KIT_ROOT, 'examples', 'backend'), root, { recursive: true });
    const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.name', 'Slicekit Test']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'commit.gpgsign', 'false']);
    const cli = `node "${binPath.split(path.sep).join('/')}"`;
    const init = runCli(['init', '--shape', 'backend', '--cli', cli], { cwd: root });
    assert.equal(init.code, 0, `init in a copy of examples/backend: ${init.stdout}${init.stderr}`);
    // init leaves the example's brief as it was.
    assert.equal(fs.readFileSync(path.join(root, 'docs', 'brief', 'greeting.md'), 'utf8').replace(/\r\n/g, '\n'), text);

    const r = runCli(['stage', 'require', 'brief'], { cwd: root });
    assert.equal(r.code, 0, `stage require brief: ${r.stdout}${r.stderr}`);
    assert.equal(r.stdout.split(/\r?\n/)[0], 'ready: brief');
  } finally {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // Windows can hold handles briefly; the OS temp cleaner takes it.
    }
  }
});
