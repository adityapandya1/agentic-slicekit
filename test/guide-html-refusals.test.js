// P6/S-54 (REQ-5.8, D-97): scripts/guide-html.js converts a closed set of Markdown constructs and
// refuses every other one. One test per refused construct: the script exits 1, names the file and the
// line, and writes no page, with and without --check. Then the same characters where they are text
// (a code span, a fenced block, an underscore inside a word), which the script converts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SCRIPT = path.join(ROOT, 'scripts', 'guide-html.js');
const PAGE = 'slicekit-guide.html';
const FENCE = '```';

const INDEX = ['# Guide', '', 'What the guide holds.', '', '## Pages', '', '### Commands', '', '| Page | What it does |', '|---|---|', '| [init](commands/init.md) | Adds the kit |', ''].join('\n');
const INIT = ['# slicekit init', '', 'Adds the kit to a repository.', ''].join('\n');
// The construct under test starts on this line of commands/init.md: after the page and one blank line.
const FIRST = INIT.split('\n').length + 1;

function run(args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(/\\/g, '/') };
}

// A guide of one index and one page in a private temporary directory, removed after the test. The
// page ends with `md`. The guide holds no web page, so a page found afterwards was written by the run.
function guideWith(t, md) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-guide-refusals-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'commands'));
  fs.writeFileSync(path.join(dir, 'README.md'), INDEX);
  fs.writeFileSync(path.join(dir, 'commands', 'init.md'), `${INIT}\n${md}\n`);
  return dir;
}

// [name, the Markdown, the line of it that is refused (0 is its first)]
const REFUSED = [
  ['an image', '![a diagram of the stages](stages.png)', 0],
  ['a block quote', '> a quoted line', 0],
  ['raw HTML', 'A <b>bold</b> word.', 0],
  ['an HTML element of any name', 'A <section>part</section> of the page.', 0],
  ['an HTML element with an attribute', '<font color="red">red</font>', 0],
  ['an HTML comment that does not end on its line', 'Before <!-- a comment\nthat ends here --> after.', 0],
  ['an indented code block', '    four spaces in', 0],
  ['a tab in the indentation', '\tone tab in', 0],
  ['an indented line that continues a paragraph', 'The first line\n  and the second, two spaces in.', 1],
  ['a rule line of dashes', '---', 0],
  ['a rule line of stars', '* * *', 0],
  ['a heading underlined with =', 'A title\n=======', 1],
  ['a heading underlined with one dash', 'A title\n-', 1],
  ['a heading with no space after its #', '#Title', 0],
  ['a heading closed by # marks', '## Title ##', 0],
  ['a link definition', '[check]: check.md', 0],
  ['a footnote', 'A claim.[^1]', 0],
  ['the text of a footnote', '[^1]: The note.', 0],
  ['a task item', '- [ ] not done', 0],
  ['a table row with the wrong number of cells', '| a | b |\n|---|---|\n| 1 |', 2],
  ['a table delimiter line with the wrong number of cells', '| a | b |\n|---|\n| 1 | 2 |', 1],
  ['a table whose rows have no leading bar', 'a | b\n---|---\n1 | 2', 1],
  ['a table row with no leading bar', '| a | b |\n|---|---|\n1 | 2', 2],
  ['a column alignment', '| a | b |\n|:--|--:|\n| 1 | 2 |', 1],
  ['an open code block', `${FENCE}text\nnever closed`, 0],
  ['a fence line with more than a language name', `${FENCE}js title=x\ncode\n${FENCE}`, 0],
  ['an indented fence line', `  ${FENCE}text\n  code\n  ${FENCE}`, 0],
  ['a link that leads nowhere', 'See [the page](no-such-page.md).', 0],
  ['emphasis written with underscores', 'An _emphasised_ word.', 0],
  ['strong written with underscores', 'A __strong__ word.', 0],
  ['strikethrough', 'A ~~struck~~ word.', 0],
  ['strikethrough with one tilde', 'A ~struck~ word.', 0],
  ['a reference-style link', 'See [the page][check].', 0],
  ['square brackets that are no link', 'See [the page].', 0],
  ['a closing square bracket', 'A stray ] bracket.', 0],
  ['a link with a title', 'See [the page](init.md "title").', 0],
  ['a link whose target holds a space', 'See [the page](init page.md).', 0],
  ['a link in angle brackets', 'See <https://example.com>.', 0],
  ['a web address written bare', 'See https://example.com for more.', 0],
  ['an e-mail address written bare', 'Write to someone@example.com.', 0],
  ['an HTML entity', 'Fish &amp; chips.', 0],
  ['a numbered HTML entity', 'A &#35; sign.', 0],
  ['three stars', 'A ***loud*** word.', 0],
  ['a star that pairs with none', 'A *lonely star.', 0],
  ['a code span that is not closed', 'A `lonely tick.', 0],
  ['a line break made by two trailing spaces', 'The first line  \nthe second line', 0],
  ['a line break made by a trailing backslash', 'The first line\\\nthe second line', 0],
  ['a second paragraph inside a list item', '- first\n\n  second', 2],
  ['a code block inside a list item', `- first\n  ${FENCE}text\n  code\n  ${FENCE}`, 1],
  ['a code block inside a list item after a blank line', `- first\n\n  ${FENCE}text\n  code\n  ${FENCE}`, 2],
  ['a heading inside a list item', '- first\n  ## inner', 1],
  ['a block quote inside a list item', '- first\n  > quoted', 1],
  ['a list item indented to no level', '- first\n - second', 1],
  ['a list item indented past its level', '- first\n      - second', 1],
  ['a list whose marker changes', '- first\n* second', 1],
  ['a numbered item in a bullet list', '- first\n1. second', 1],
  ['a numbered list that does not start at 1', '3. third', 0],
  ['an empty list item', '- first\n+', 1],
  ['a construct on the second line of a paragraph', 'The first line\nand an _emphasised_ word.', 1],
  ['a construct on the second line of a list item', '- first\n  and a ~~struck~~ word', 1],
  ['a construct in a table cell', '| a | b |\n|---|---|\n| 1 | __two__ |', 2],
  ['a construct in a heading', '## A <b>bold</b> title', 0],
  ['a construct inside a list', '- first\n  - an _emphasised_ word', 1],
];

for (const [name, md, offset] of REFUSED) {
  test(`refused: ${name}`, (t) => {
    const guide = guideWith(t, md);
    const page = path.join(guide, PAGE);
    const line = FIRST + offset;
    const named = new RegExp(`commands/init\\.md:${line}\\b`);
    for (const args of [['--guide', guide], ['--check', '--guide', guide]]) {
      const r = run(args);
      assert.equal(r.code, 1, `${args[0]}: exit ${r.code}: ${r.out}`);
      assert.match(r.out, named, `${args[0]} does not name commands/init.md:${line}: ${r.out}`);
      assert.ok(!fs.existsSync(page), `${args[0]} wrote the page`);
    }
  });
}

// [name, the Markdown, what the written page holds for it]
const CONVERTED = [
  ['an underscore inside a word', 'The snake_case name and another_long_name stay as written.', 'The snake_case name and another_long_name stay as written.'],
  ['the refused characters inside a code span',
    'A span: `_a_ __b__ ~~c~~ <section> [x][y] ![i](j) &amp; https://example.com *x ]`.',
    '<code>_a_ __b__ ~~c~~ &lt;section&gt; [x][y] ![i](j) &amp;amp; https://example.com *x ]</code>'],
  ['an HTML comment inside a code span', 'The mark `<!-- slicekit:mark -->` stays.', '<code>&lt;!-- slicekit:mark --&gt;</code>'],
  ['the refused constructs inside a fenced block',
    [`${FENCE}text`, '> quoted', '    four spaces in', '---', '[check]: check.md', '- [ ] not done', '<section>', '_a_ ~~b~~ ![i](j)',
      'a | b', '---|---', 'two trailing spaces  ', 'a trailing backslash\\', '~~~', '3. third', FENCE].join('\n'),
    '_a_ ~~b~~ ![i](j)'],
  ['a fence line with a language inside a longer fence', `${FENCE}${FENCE[0]}\n${FENCE}js\ncode\n${FENCE}\n${FENCE}${FENCE[0]}`, `${FENCE}js\ncode\n${FENCE}`],
  ['the refused characters after a backslash', 'Escaped: \\_a\\_ \\~\\~b\\~\\~ \\<b\\> \\[x\\] \\&amp; \\*y\\*', 'Escaped: _a_ ~~b~~ &lt;b&gt; [x] &amp;amp; *y*'],
  ['a star, an underscore, a less-than sign and an ampersand that stand alone', 'Take 2 * 3, a _ b, a < b and R&D.', 'Take 2 * 3, a _ b, a &lt; b and R&amp;D.'],
  ['two trailing spaces at the end of a paragraph', 'The last line  ', '<p>The last line</p>'],
  ['strong, emphasis, a code span and a link', 'A **strong *and emphasised* word**, `code` and [a link](init.md#usage-of-it).\n\n## Usage of it\n\nText.',
    '<b>strong <em>and emphasised</em> word</b>, <code>code</code> and <a href="#commands-init--usage-of-it">a link</a>.'],
  ['a list inside a list, with a blank line between items', '- first\n  - inner_one\n  - inner two\n\n- second\n  continued here', '<li>second continued here</li>'],
  ['a table with a bar and an underscore in a cell', '| a | b |\n|---|---|\n| `x \\| y` | snake_case |', '<td><code>x | y</code></td><td>snake_case</td>'],
];

for (const [name, md, holds] of CONVERTED) {
  test(`converted: ${name}`, (t) => {
    const guide = guideWith(t, md);
    const wrote = run(['--guide', guide]);
    assert.equal(wrote.code, 0, wrote.out);
    const html = fs.readFileSync(path.join(guide, PAGE), 'utf8');
    assert.ok(html.includes(holds), `the page does not hold ${JSON.stringify(holds)}`);
    const check = run(['--check', '--guide', guide]);
    assert.equal(check.code, 0, check.out);
  });
}
