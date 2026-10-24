import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { init } from '../../src/init.js';
import { check } from '../../src/check/index.js';
import style from '../../src/check/rules/style.js';
import { makeRepo } from '../helpers/tmp-repo.js';

const MARKER = '<!-- slicekit:style-catalogue -->';
const SEED = ['minting at the gate', 'at the boundary of', "it's worth noting", 'robust', 'seamlessly', 'leverage', 'delve'];

// An init'd repo with the given files written on top, checked by the style rule alone.
function run(files, { banned } = {}) {
  const repo = makeRepo({ commits: 1 });
  try {
    init(repo.root, { name: 'demo', shape: 'backend', cli: 'node bin/slicekit.js' });
    if (banned) {
      const file = path.join(repo.root, '.slicekit', 'config.json');
      const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
      cfg.style.banned = [...cfg.style.banned, ...banned];
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
    'style docs/filler.md:0 catalogue missing "delve"',
    'check: 1 findings, 1 over baseline, 0 blocking, 1 rules',
  ]);
  assert.equal(r.findings[0].bucket, 'catalogue');
  assert.equal(r.exitCode, 1);
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
