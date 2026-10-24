import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { init } from '../../src/init.js';
import { check } from '../../src/check/index.js';
import style, { findStyle } from '../../src/check/rules/style.js';
import { makeRepo } from '../helpers/tmp-repo.js';

const MARKER = '<!-- slicekit:style-catalogue -->';
const SEED = ['minting at the gate', 'at the boundary of', "it's worth noting", 'robust', 'seamlessly', 'leverage', 'delve'];

// An init'd repo with the given files written on top, checked by the style rule alone.
function run(files, { banned, set } = {}) {
  const repo = makeRepo({ commits: 1 });
  try {
    init(repo.root, { name: 'demo', shape: 'backend', cli: 'node bin/slicekit.js' });
    if (banned || set) {
      const file = path.join(repo.root, '.slicekit', 'config.json');
      const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
      cfg.style.banned = set ?? [...cfg.style.banned, ...banned];
      fs.writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
    }
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(repo.root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    return check(repo.root, { rules: [style] });
  } finally {
    repo.cleanup();
  }
}

test('style is a blocking ratchet', () => {
  assert.equal(style.id, 'style');
  assert.equal(style.blocking, true);
  assert.equal(style.ratchet, true);
});

test('banned phrase is a finding, case-insensitive', () => {
  const r = run({
    'docs/notes.md': ['# Notes', '', 'The parser is Robust.', '', "IT'S WORTH NOTING that it is robust and robust."].join('\n'),
  });
  assert.deepEqual(r.lines, [
    'style docs/notes.md:3 banned phrase "robust"',
    'style docs/notes.md:5 banned phrase "it\'s worth noting"',
    'style docs/notes.md:5 banned phrase "robust"',
    'style docs/notes.md:5 banned phrase "robust"',
    'check: 4 findings, 4 over baseline, 0 blocking, 1 rules',
  ]);
  assert.equal(r.findings[0].bucket, 'docs/notes.md');
  assert.equal(r.exitCode, 1);
});

test('the catalogue files are exempt and must contain the list', () => {
  const catalogue = ['# Filler', '', MARKER, '', ...SEED.map((p) => `- ${p}`)];
  assert.deepEqual(run({ 'docs/filler.md': catalogue.join('\n') }).lines, [
    'check: 0 findings, 0 over baseline, 0 blocking, 1 rules',
  ]);
  const short = catalogue.filter((l) => l !== '- delve');
  const r = run({ 'docs/filler.md': short.join('\n') });
  assert.deepEqual(r.lines, [
    'style docs/filler.md:3 catalogue missing "delve"',
    'check: 1 findings, 1 over baseline, 0 blocking, 1 rules',
  ]);
  assert.equal(r.findings[0].bucket, 'catalogue:docs/filler.md');
  assert.equal(r.exitCode, 1);
});

test('the catalogue exemption covers only the marked section', () => {
  const doc = [
    '# Doc', // 1
    '', // 2
    'Robust intro.', // 3
    '', // 4
    '## Filler', // 5
    MARKER, // 6
    ...SEED.map((p) => `- ${p}`), // 7-13
    '### Sub', // 14
    'still delve, still listed', // 15
    '## Other', // 16
    '', // 17
    'This is robust.', // 18
  ];
  const r = run({ 'docs/mixed.md': doc.join('\n') });
  assert.deepEqual(r.lines, [
    'style docs/mixed.md:3 banned phrase "robust"',
    'style docs/mixed.md:18 banned phrase "robust"',
    'check: 2 findings, 2 over baseline, 0 blocking, 1 rules',
  ]);
  // The seed phrases must sit inside the section, not elsewhere in the file.
  const moved = [...doc.slice(0, 6), ...doc.slice(13, 15), '## Other', ...SEED.map((p) => `- ${p}`)];
  const m = run({ 'docs/moved.md': moved.join('\n') });
  assert.equal(m.findings.filter((f) => f.message.startsWith('catalogue missing')).length, SEED.length - 1);
});

test('an empty seed list is a finding', () => {
  assert.deepEqual(findStyle([], ['robust'], []), [
    { file: 'templates/style.json', line: 0, message: 'catalogue seed list is empty', bucket: 'catalogue' },
  ]);
});

test('a configured list missing a seed phrase is a catalogue finding', () => {
  assert.deepEqual(findStyle([], [], ['robust']), [
    { file: '.slicekit/config.json', line: 0, message: 'catalogue missing "robust"', bucket: 'catalogue:.slicekit/config.json' },
  ]);
  const r = run({ 'docs/notes.md': '# Notes\n\nWe delve into it.\n' }, { set: [] });
  assert.deepEqual(r.lines, [
    ...SEED.map((p) => `style .slicekit/config.json:0 catalogue missing "${p}"`),
    `check: ${SEED.length} findings, ${SEED.length} over baseline, 0 blocking, 1 rules`,
  ]);
  assert.equal(r.exitCode, 1);
  const kept = run({}, { set: SEED.filter((p) => p !== 'delve').map((p) => p.toUpperCase()) });
  assert.deepEqual(kept.lines, [
    'style .slicekit/config.json:0 catalogue missing "delve"',
    'check: 1 findings, 1 over baseline, 0 blocking, 1 rules',
  ]);
});

test('a phrase wrapped across a line break is one finding on its first line', () => {
  const r = run({
    'docs/wrap.md': ['# Wrap', '', 'We sit at the boundary', 'of the system.', '', 'Also at the boundary', '', 'of nothing.'].join('\n'),
  });
  assert.deepEqual(r.lines, [
    'style docs/wrap.md:3 banned phrase "at the boundary of"',
    'check: 1 findings, 1 over baseline, 0 blocking, 1 rules',
  ]);
});

test('an example line is not matched', () => {
  const r = run({
    'docs/ex.md': ['# Ex', '', 'The author wrote "minting at the gate". <!-- slicekit:example -->', 'Then robust.'].join('\n'),
  });
  assert.deepEqual(r.lines, [
    'style docs/ex.md:4 banned phrase "robust"',
    'check: 1 findings, 1 over baseline, 0 blocking, 1 rules',
  ]);
});

test('an example marker quoted in a code span does not exempt its line', () => {
  const r = run({ 'docs/ex.md': ['# Ex', '', 'Mark it `<!-- slicekit:example -->`; robust.'].join('\n') });
  assert.deepEqual(r.lines, [
    'style docs/ex.md:3 banned phrase "robust"',
    'check: 1 findings, 1 over baseline, 0 blocking, 1 rules',
  ]);
});

test('link targets and bare URLs are not matched', () => {
  const r = run({
    'docs/links.md': ['# Links', '', 'See [the guide](docs/robust-guide.md), https://x.io/leverage and <https://x.io/delve>.', '[robust](a.md)'].join('\n'),
  });
  assert.deepEqual(r.lines, [
    'style docs/links.md:4 banned phrase "robust"',
    'check: 1 findings, 1 over baseline, 0 blocking, 1 rules',
  ]);
});

test('config phrases are deduplicated and a curly apostrophe is normalised', () => {
  const r = run(
    { 'docs/dup.md': ['# Dup', '', 'It’s worth noting this is robust.'].join('\n') },
    { banned: [' Robust ', 'IT’S  worth noting'] },
  );
  assert.deepEqual(r.lines, [
    'style docs/dup.md:3 banned phrase "it\'s worth noting"',
    'style docs/dup.md:3 banned phrase "robust"',
    'check: 2 findings, 2 over baseline, 0 blocking, 1 rules',
  ]);
});

test('CRLF line endings give the same lines', () => {
  const r = run({ 'docs/crlf.md': ['# Notes', '', 'The parser is Robust.', '', 'at the boundary', 'of it'].join('\r\n') });
  assert.deepEqual(r.lines, [
    'style docs/crlf.md:3 banned phrase "robust"',
    'style docs/crlf.md:5 banned phrase "at the boundary of"',
    'check: 2 findings, 2 over baseline, 0 blocking, 1 rules',
  ]);
});

test('a marker quoted in a code span or fence does not make a catalogue', () => {
  const r = run({
    'docs/quote.md': ['# Quote', '', `Mark it with \`${MARKER}\`.`, '', '```', MARKER, '```', '', 'It is robust.'].join('\n'),
  });
  assert.deepEqual(r.lines, [
    'style docs/quote.md:9 banned phrase "robust"',
    'check: 1 findings, 1 over baseline, 0 blocking, 1 rules',
  ]);
});

test('code spans and fences are not matched', () => {
  const r = run({
    'docs/code.md': ['# Code', '', 'The word `robust` is quoted.', '', '```', 'delve into it', '```', '', '~~~', 'seamlessly', '~~~'].join('\n'),
  });
  assert.deepEqual(r.lines, ['check: 0 findings, 0 over baseline, 0 blocking, 1 rules']);
});

test('whole words only', () => {
  const r = run({ 'docs/words.md': ['# Words', '', 'Its robustness leverages nothing; unrobust is not a word.'].join('\n') });
  assert.deepEqual(r.lines, ['check: 0 findings, 0 over baseline, 0 blocking, 1 rules']);
});

test('a team phrase added in config is enforced', () => {
  const r = run({ 'docs/team.md': ['# Team', '', 'We go the extra mile.'].join('\n') }, { banned: ['extra mile'] });
  assert.deepEqual(r.lines, [
    'style docs/team.md:3 banned phrase "extra mile"',
    'check: 1 findings, 1 over baseline, 0 blocking, 1 rules',
  ]);
});

test('an intake file pinned by its sidecar is exempt; an unpinned one is matched', () => {
  const req = '# Req\n\nWe delve into it.\n';
  const r = run({
    'docs/intake/req.md': req,
    'docs/intake/req.md.meta.json': JSON.stringify({ sha256: crypto.createHash('sha256').update(req).digest('hex') }),
    'docs/intake/extra.md': '# Extra\n\nWe delve into it.\n',
    'docs/notes.md': '# Notes\n\nWe delve into it.\n',
  });
  assert.deepEqual(r.lines, [
    'style docs/intake/extra.md:3 banned phrase "delve"',
    'style docs/notes.md:3 banned phrase "delve"',
    'check: 2 findings, 2 over baseline, 0 blocking, 1 rules',
  ]);
});
