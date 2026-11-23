// P6/S-54 (REQ-5.8, D-97): scripts/guide-html.js converts a closed set of Markdown constructs and
// refuses every other one. One test per refused construct: the script exits 1, names the file and the
// line, and writes no page, with and without --check. Then the same characters where they are text
// (a code span, a fenced block, an underscore inside a word), which the script converts. Last, the
// texts outside a page's body (a page's first heading, the index's title and headings, the link text
// of a Pages row), the order of headings and the ids of the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
  ['a second list inside one list item', '- first\n    - inner\n  - a second inner list', 2],
  ['text straight after a table', '| a | b |\n|---|---|\n| 1 | 2 |\ntext with no blank line before it', 3],
  ['a square bracket in an absolute link target', 'See [the page](https://example.com/a[1]).', 0],
  ['a square bracket in a relative link target', 'See [the page](init[1].md).', 0],
  ['a round bracket in a link target', 'See [the page](https://example.com/a(1)).', 0],
  ['an angle bracket in a link target', 'See [the page](<https://example.com/a>).', 0],
  ['an HTML entity in a link target', 'See [the page](https://example.com/?a=1&amp;b=2).', 0],
  ['a numbered HTML entity in a link target', 'See [the page](https://example.com/?a=1&#38;b=2).', 0],
  ['a backslash in a link target', 'See [the page](https://example.com/a\\_b).', 0],
  ['a backtick in a link target', 'See [the page](https://example.com/a`b) and `c`.', 0],
  ['a closing fence line indented two spaces', `${FENCE}text\na\n  ${FENCE}\nb\n${FENCE}`, 2],
  ['a code span that runs over two lines', 'A `span that opens here\nand closes` on the next line.', 0],
  ['an HTML comment on the second line of a code span', 'A `first\nsecond <!-- a comment --> third` span.', 0],
  ['a code span that runs over two lines of a list item', '- A `span that opens here\n  and closes` on the next line.', 0],
  ['a table inside a list item', '- first\n  | a | b |\n  |---|---|\n  | 1 | 2 |', 1],
  ['a heading whose text is a closing # mark', '# #', 0],
  // Straight after a line of a list item, with no blank line: Markdown reads the table as text of the item.
  ['a table straight after a list item', '- first\n| a | b |\n|---|---|\n| 1 | 2 |', 1],
  ['a table straight after an item of a list inside an item', '- first\n  - inner\n| a | b |\n|---|---|\n| 1 | 2 |', 2],
  ['a table straight after a later line of a list item', '- first\n  and more\n| a | b |\n|---|---|\n| 1 | 2 |', 2],
  ['a heading straight after a list item', '- first\n## Title', 1],
  ['a code block straight after a list item', `- first\n${FENCE}text\ncode\n${FENCE}`, 1],
  ['a comment line straight after a list item', '- first\n<!-- a comment -->', 1],
  ['a table straight after a line of a paragraph', 'Some text\n| a | b |\n|---|---|\n| 1 | 2 |', 1],
  // HTML comments where Markdown does not read a comment inside a text.
  ['a comment at the start of a line with text after it', '<!-- a comment --> **strong** and `code`', 0],
  ['a comment at the start of a later line of a paragraph', 'The first line\n<!-- a comment --> and **more**', 1],
  ['a comment that holds a bar in a table row', '| a | b |\n|---|---|\n| 1 <!-- x | y --> | 2 |', 2],
  ['a comment in a table row', '| a | b |\n|---|---|\n| 1 <!-- x --> | 2 |', 2],
  ['a comment in the header row of a table', '| a <!-- x --> | b |\n|---|---|\n| 1 | 2 |', 0],
  ['a comment straight after a list marker', '- <!-- a comment --> text', 0],
  ['a comment line inside a list item', '- first\n  <!-- a comment -->', 1],
  ['an indented comment line', '  <!-- a comment -->', 0],
  ['a comment that holds two dashes together', 'Some text <!-- a -- b --> and more.', 0],
  ['a comment that ends with a dash', 'Some text <!-- a ---> and more.', 0],
  // White space that is no space, tab or line feed.
  ['a no-break space after the # marks', '## Title', 0],
  ['a no-break space after a list marker', '- first', 0],
  ['a no-break space after a numbered list marker', '1. first', 0],
  ['a no-break space in a paragraph', 'Two words.', 0],
  ['an em space in a table cell', '| a | b |\n|---|---|\n| 1 x | 2 |', 2],
  ['an ideographic space in a list item', '- first　second', 0],
  ['a narrow no-break space in a heading', '## A title', 0],
  ['a form feed in a paragraph', 'Two\fwords.', 0],
  ['a no-break space on a fence line', `${FENCE} text\ncode\n${FENCE}`, 0],
  // An e-mail address whatever its name part ends in, and the other bare addresses.
  ['an e-mail address whose name ends in a dash', 'Write to someone-@example.com.', 0],
  ['an e-mail address whose name ends in a plus', 'Write to someone+@example.com.', 0],
  ['an e-mail address whose name ends in a dot', 'Write to someone.@example.com.', 0],
  ['an @ between two words', 'The package name@latest is installed.', 0],
  ['a web address written bare with ftp', 'See ftp://example.com/file for more.', 0],
  ['a mailto address written bare', 'Write to mailto:someone for more.', 0],
  // A heading that has no place or gives no id.
  ['a heading two levels below the one before it', '## Usage\n\n#### Deep', 2],
  ['a heading with no letter or digit', '## \\*\\*\\*', 0],
  // An emoji short code, judged by its shape alone (H-8).
  ['an emoji short code', 'A :tada: moment.', 0],
  ['an emoji short code with a plus', 'A :+1: vote.', 0],
  ['an emoji short code between a scope and a name', 'The name @scope:package:name is installed.', 0],
  ['a time of three parts, which has the shape of a short code', 'It ran at 10:30:00 today.', 0],
  ['an emoji short code in a list item', '- first\n- a :smile: here', 1],
  // A table whose header row or delimiter line is indented (H-9).
  ['a table delimiter line indented four spaces', '| a | b |\n    |---|---|\n| 1 | 2 |', 1],
  ['a table delimiter line indented one space', '| a | b |\n |---|---|\n| 1 | 2 |', 1],
  ['a table header row indented four spaces', '    | a | b |\n|---|---|\n| 1 | 2 |', 0],
  // A numbered marker of nine digits is a marker (H-9).
  ['a numbered list of nine digits that does not start at 1', '123456789. first', 0],
  // A comment inside a link target is no comment (H-9).
  ['a comment inside a link target', 'See [the page](init.md<!--x-->).', 0],
  ['a comment with spaces inside a link target', 'See [the page](init.md<!-- x -->).', 0],
];

// What Markdown reads as the start of a block when it stands straight after a list marker:
// [name, the text after the marker, the later lines of the item, the line that is refused (0 is the
// item's own)]. Each is refused in an item of a bullet list, of a numbered list, of a list inside an
// item, and of a list two items deep.
const AFTER_A_MARKER = [
  ['a heading', '# Title', [], 0],
  ['a heading with no space after its #', '#Title', [], 0],
  ['a block quote', '> quoted', [], 0],
  ['a bullet item', '- nested', [], 0],
  ['a bullet item written with a star', '* nested', [], 0],
  ['a bullet item written with a plus', '+ nested', [], 0],
  ['a numbered item', '1. nested', [], 0],
  ['a numbered item written with a bracket', '1) nested', [], 0],
  ['a rule line of stars', '* * *', [], 0],
  ['a rule line of underscores', '___', [], 0],
  ['a rule line of dashes', '---', [], 0],
  ['a code fence of backticks', `${FENCE}text`, ['code', FENCE], 0],
  ['a code fence of tildes', '~~~', ['code', '~~~'], 0],
  ['a table', '| a | b |', ['|---|---|', '| 1 | 2 |'], 0],
  ['a table delimiter line', '|---|---|', [], 0],
  ['a link definition', '[check]: check.md', [], 0],
  ['the text of a footnote', '[^1]: The note.', [], 0],
  ['a task box', '[ ] not done', [], 0],
  ['a ticked task box', '[x] done', [], 0],
  ['a line of = marks', '===', [], 0],
  ['a heading underlined with = on the next line', 'A title', ['======='], 1],
  ['a heading underlined with - on the next line', 'A title', ['-------'], 1],
  ['an indented code block', '    four more spaces in', [], 0],
  ['a tab', '\tone tab in', [], 0],
];
const DEPTHS = [
  ['in a bullet item', [], '- ', '  '],
  ['in a numbered item', [], '1. ', '   '],
  ['in an item of a list inside an item', ['- first'], '  - ', '    '],
  ['in an item of a numbered list inside an item', ['1. first'], '   1. ', '      '],
  ['in an item two lists deep', ['- first', '  - second'], '    - ', '      '],
];
for (const [name, text, later, offset] of AFTER_A_MARKER) {
  for (const [where, before, marker, indent] of DEPTHS) {
    // A tab after the marker stands for the marker's own space.
    const item = text.startsWith('\t') ? `${marker.trimEnd()}${text}` : `${marker}${text}`;
    REFUSED.push([`${name} straight after a list marker, ${where}`, [...before, item, ...later.map((l) => `${indent}${l}`)].join('\n'), before.length + offset]);
  }
}

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
  ['two blank lines between two items, as one list', '- first\n\n\n- second', '<ul>\n      <li>first</li>\n      <li>second</li>\n    </ul>'],
  ['two blank lines between two items of a list inside an item, as one list', '- first\n  - inner one\n\n\n  - inner two', '<li>inner one</li>\n          <li>inner two</li>'],
  ['a fence-mark line four spaces in, as text of its code block', `${FENCE}\na\n    ${FENCE}\nb\n${FENCE}`, `<pre class="ex">a\n    ${FENCE}\nb</pre>`],
  ['an ampersand that begins no entity in a link target', 'See [the page](https://example.com/?a=1&b=2).', '<a href="https://example.com/?a=1&amp;b=2">the page</a>'],
  ['a block start inside a code span straight after a list marker', '- `# Title` and `> quoted` are text', '<li><code># Title</code> and <code>&gt; quoted</code> are text</li>'],
  ['a later line of a list item in the first column', '- first\ncontinued in the first column', '<li>first continued in the first column</li>'],
  ['a comment after the text of a paragraph line, left out', 'Reads one file. <!-- slicekit:example -->', '<p>Reads one file.</p>'],
  ['a comment between two words, left out with the spaces round it kept', 'Before <!-- a comment --> after.', '<p>Before  after.</p>'],
  ['a comment after the text of a list item, left out', '- first <!-- a comment -->\n- second', '<li>first</li>\n      <li>second</li>'],
  ['a comment line in the first column, left out', 'Before.\n\n<!-- a comment -->\n\nAfter.', '<p>Before.</p>\n    <p>After.</p>'],
  ['a comment line straight after a paragraph line, which ends the paragraph', 'Before.\n<!-- a comment -->\nAfter.', '<p>Before.</p>\n    <p>After.</p>'],
  ['a comment line between two numbered lists, which stay two lists', '1. one\n\n<!-- a comment -->\n\n1. two', '<li>one</li>\n    </ol>\n    <ol>\n      <li>two</li>'],
  ['a no-break space inside a code span', 'The span `a b` stays.', '<code>a b</code>'],
  ['a no-break space inside a fenced block', `${FENCE}text\na b\n${FENCE}`, 'a b'],
  ['a space at the end of a code span', 'A title that begins `[spec] ` is exempt.', '<code>[spec] </code>'],
  ['one space at each end of a code span, taken off', 'The span ` a ` stays.', '<code>a</code>'],
  ['an @ that stands alone or begins a word', 'Meet @ noon, and ask @someone.', '<p>Meet @ noon, and ask @someone.</p>'],
  ['a table after a list and a blank line', '- first\n\n| a | b |\n|---|---|\n| 1 | 2 |', '<td>1</td><td>2</td>'],
  // A number of ten digits with a dot is text, not a list marker (H-9).
  ['a ten-digit number with a dot after a numbered item, as text of the item', '1. first\n1234567890. more', '<li>first 1234567890. more</li>'],
  ['a ten-digit number with a dot at the start of a paragraph', '1234567890. text', '<p>1234567890. text</p>'],
  // Colons that make no short code (H-8).
  ['colons that hold no word between them', 'Note: a :: b and a : b.', '<p>Note: a :: b and a : b.</p>'],
  ['a short code inside a code span', 'Write `:tada:` for it.', '<code>:tada:</code>'],
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

// ---------------------------------------------------------------- the texts outside a page's body
// The first heading of a page, the title of the index, the link text of a Pages row and the headings
// of the index go through the same reader and writer as every other text. A guide of one index and
// the pages commands/init.md and commands/check.md, each file given as its lines.
const CHECK = ['# slicekit check', '', 'Runs every rule.'];
const ROWS = ['| [init](commands/init.md) | Adds the kit |', '| [check](commands/check.md) | Runs every rule |'];
const indexOf = ({ title = '# Guide', before = [], rows = ROWS, group = '### Commands' } = {}) => [
  title, '', 'What the guide holds.', '', ...before, '## Pages', '', group, '', '| Page | What it does |', '|---|---|', ...rows, ''];

function guideOf(t, { index = indexOf(), init = INIT.split('\n'), check = CHECK } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slicekit-guide-refusals-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'commands'));
  fs.writeFileSync(path.join(dir, 'README.md'), `${index.join('\n')}\n`);
  fs.writeFileSync(path.join(dir, 'commands', 'init.md'), `${init.join('\n')}\n`);
  fs.writeFileSync(path.join(dir, 'commands', 'check.md'), `${check.join('\n')}\n`);
  return dir;
}

// The script writes the page for the guide and the check passes; gives the page.
function written(t, files) {
  const guide = guideOf(t, files);
  const wrote = run(['--guide', guide]);
  assert.equal(wrote.code, 0, wrote.out);
  const check = run(['--check', '--guide', guide]);
  assert.equal(check.code, 0, check.out);
  return fs.readFileSync(path.join(guide, PAGE), 'utf8');
}

// The script exits 1 naming `file` and the line that holds `mark` (the first line of `lines` that
// includes it), and writes no page, with and without --check.
function refusedAt(t, files, file, lines, mark) {
  const guide = guideOf(t, files);
  const line = lines.findIndex((l) => l.includes(mark)) + 1;
  assert.ok(line > 0, `no line holds ${mark}`);
  const named = new RegExp(`${file.replace('.', '\\.')}:${line}\\b`);
  for (const args of [['--guide', guide], ['--check', '--guide', guide]]) {
    const r = run(args);
    assert.equal(r.code, 1, `${args[0]}: exit ${r.code}: ${r.out}`);
    assert.match(r.out, named, `${args[0]} does not name ${file}:${line}: ${r.out}`);
    assert.ok(!fs.existsSync(path.join(guide, PAGE)), `${args[0]} wrote the page`);
  }
  return guide;
}

test('converted: emphasis, a link and an escaped character in the first heading of a page', (t) => {
  const html = written(t, { init: ['# The *init* page, see [check](check.md) and \\*stars\\*', '', 'Adds the kit.'] });
  assert.ok(html.includes('<h4><code>The <em>init</em> page, see <a href="#commands-check">check</a> and *stars*</code></h4>'), html.slice(html.indexOf('<section id="commands-init"'), html.indexOf('<section id="commands-init"') + 400));
});

test('converted: a code span in the first heading of a page, and the words Check rule as a tag', (t) => {
  const html = written(t, { init: ['# Check rule: `layout` & more', '', 'Checks the layout.'] });
  assert.ok(html.includes('<h4><code>layout &amp; more</code></h4><span class="tag t-rare">Check rule</span>'));
});

test('converted: a first heading of a page written as one code span gives one code element', (t) => {
  const html = written(t, { init: ['# `slicekit init`', '', 'Adds the kit.'] });
  assert.ok(html.includes('<h4><code>slicekit init</code></h4>'));
  assert.doesNotMatch(html, /<code>[^<]*<code>/, 'a code element opens inside another');
});

test('refused: a link to a missing page in the first heading of a page', (t) => {
  const init = ['# The init page, see [the page](no-such-page.md)', '', 'Adds the kit.'];
  const guide = refusedAt(t, { init }, 'commands/init.md', init, 'no-such-page');
  assert.match(run(['--guide', guide]).out, /leads to nothing in the guide/);
});

test('refused: a construct the script does not convert in the first heading of a page', (t) => {
  const init = ['# The _init_ page', '', 'Adds the kit.'];
  refusedAt(t, { init }, 'commands/init.md', init, '_init_');
});

test('converted: strong, a link and an escaped character in the title of the index', (t) => {
  const html = written(t, { index: indexOf({ title: '# The **Guide**, from [init](commands/init.md) on, \\*starred\\*' }) });
  assert.ok(html.includes('<h1>The <b>Guide</b>, from <a href="#commands-init">init</a> on, *starred*</h1>'));
});

test('refused: a link to a missing page in the title of the index', (t) => {
  const index = indexOf({ title: '# The Guide of [a page](commands/none.md)' });
  refusedAt(t, { index }, 'README.md', index, 'commands/none.md');
});

test('converted: emphasis, a code span and an escaped character in the link text of a Pages row', (t) => {
  const rows = ['| [*init* `now` \\_x\\_](commands/init.md) | Adds the kit |', ROWS[1]];
  const html = written(t, { index: indexOf({ rows }) });
  assert.ok(html.includes('<li><a href="#commands-init"><em>init</em> <code>now</code> _x_</a></li>'));
  assert.ok(!html.includes('\\_x'), 'the page holds the backslash of the row');
});

test('refused: a first cell of a Pages row that holds more than one link', (t) => {
  const rows = ['| [init](commands/init.md) and *more* | Adds the kit |', ROWS[1]];
  const index = indexOf({ rows });
  refusedAt(t, { index }, 'README.md', index, 'and *more*');
});

test('refused: a first cell of a Pages row that links no page file', (t) => {
  const rows = ['| [init](commands/none.md) | Adds the kit |', ...ROWS];
  const index = indexOf({ rows });
  refusedAt(t, { index }, 'README.md', index, 'commands/none.md');
});

test('converted: a link in a section heading of the index is a link in the heading and text in the contents list', (t) => {
  const html = written(t, { index: indexOf({ before: ['## About [init](commands/init.md) and *more*', '', 'Text.', ''] }) });
  assert.ok(html.includes('<h2>About <a href="#commands-init">init</a> and <em>more</em></h2>'));
  assert.ok(html.includes('<li><a href="#about-init-and-more">About init and <em>more</em></a></li>'));
});

test('converted: emphasis in the heading of a group of pages', (t) => {
  const html = written(t, { index: indexOf({ group: '### The *commands*' }) });
  assert.ok(html.includes('<h2>The <em>commands</em></h2>'));
  assert.ok(html.includes('<a href="#the-commands">The <em>commands</em></a>'));
});

// B-8: the one paragraph of the index left out is the one that links the web page itself.
for (const [name, target] of [['a source file two folders up', '../../src/cli.js'], ['a folder of the guide', 'commands/'],
  ['a file beside the index that is no page', 'notes.txt']]) {
  test(`refused: a paragraph of the index that links ${name}`, (t) => {
    const index = indexOf({ before: ['## Conventions', '', 'The first paragraph.', '', `See [the file](${target}) for more.`, '', 'The third paragraph.', ''] });
    const guide = refusedAt(t, { index }, 'README.md', index, target);
    assert.match(run(['--guide', guide]).out, /leads to nothing in the guide/);
  });
}

test('converted: the paragraph of the index that links the web page itself is left out, and only it', (t) => {
  const html = written(t, { index: indexOf({ before: ['## Conventions', '', 'The first paragraph.', '', 'Open [`slicekit-guide.html`](slicekit-guide.html) in a browser.', '', 'The third paragraph.', ''] }) });
  assert.ok(html.includes('<p>The first paragraph.</p>') && html.includes('<p>The third paragraph.</p>'));
  assert.ok(!html.includes('in a browser'), 'the paragraph that links the web page is in the page');
});

test('refused: a paragraph that links the web page itself and a file that is no page', (t) => {
  const index = indexOf({ before: ['## Conventions', '', 'Open [it](slicekit-guide.html) or [the source](../../src/cli.js).', ''] });
  refusedAt(t, { index }, 'README.md', index, '../../src/cli.js');
});

test('refused: a paragraph under the Contents section of the index', (t) => {
  const index = indexOf({ before: ['## Contents', '', '- [Pages](#pages)', '', 'A paragraph the page would leave out.', ''] });
  refusedAt(t, { index }, 'README.md', index, 'A paragraph the page');
});

test('refused: a list under the Pages section of the index', (t) => {
  const index = [...indexOf(), '- an item the page would leave out', ''];
  refusedAt(t, { index }, 'README.md', index, 'an item the page');
});

test('refused: a ### heading of the index before its first ## heading', (t) => {
  const index = indexOf({ before: ['### Early', '', 'Text.', ''] });
  const guide = refusedAt(t, { index }, 'README.md', index, '### Early');
  assert.doesNotMatch(run(['--guide', guide]).out, /undefined/);
});

test('refused: a heading of the index two levels below the one before it', (t) => {
  const index = indexOf({ before: ['## About', '', '#### Deep', '', 'Text.', ''] });
  refusedAt(t, { index }, 'README.md', index, '#### Deep');
});

test('refused: a heading of four # under the Pages section of the index', (t) => {
  const index = [...indexOf(), '#### Deeper', ''];
  refusedAt(t, { index }, 'README.md', index, '#### Deeper');
});

test('refused: a second # heading in the index', (t) => {
  const index = indexOf({ before: ['# Again', '', 'Text.', ''] });
  refusedAt(t, { index }, 'README.md', index, '# Again');
});

for (const [name, heading] of [['the theme button', '## Theme'], ['the contents list', '## Toc'], ['the top bar', '## Top'],
  ['the section of a page', '## Commands init'], ['a heading of a page', '## Commands init  usage']]) {
  test(`refused: an index heading whose id is the id of ${name}`, (t) => {
    const index = indexOf({ before: [heading, '', 'Text.', ''] });
    const guide = refusedAt(t, { index, init: [...INIT.split('\n'), '## Usage', '', 'Text.'] }, 'README.md', index, heading);
    assert.match(run(['--guide', guide]).out, /an id stands once in the web page/);
  });
}

test('refused: a group of pages whose id is the id of a section of the index', (t) => {
  const index = indexOf({ before: ['## Commands', '', 'Text.', ''] });
  refusedAt(t, { index }, 'README.md', index, '### Commands');
});

test('converted: two headings of the same words in one file get two ids', (t) => {
  const html = written(t, { init: [...INIT.split('\n'), '## Notes', '', 'One.', '', '## Notes', '', 'Two.'] });
  assert.ok(html.includes('id="commands-init--notes"') && html.includes('id="commands-init--notes-1"'));
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'an id stands twice in the page');
});

test('refused: a heading of a page whose id is the numbered id of another', (t) => {
  const init = [...INIT.split('\n'), '## Notes', '', 'One.', '', '## Notes', '', 'Two.', '', '## Notes 1', '', 'Three.'];
  refusedAt(t, { init }, 'commands/init.md', init, '## Notes 1');
});

test('the last guard refuses a page that holds undefined as an element or an id twice', async () => {
  const { sound } = await import(pathToFileURL(SCRIPT).href);
  const ok = '<main id="a"><h2 id="b">undefined is a word here</h2></main>';
  assert.equal(sound(ok), ok);
  for (const [html, says] of [['<undefined id="a">x</undefined>', /undefined/], ['<p>x</p></undefined>', /undefined/], ['<h2 id="undefined">x</h2>', /undefined/],
    ['<a href="#undefined">x</a>', /undefined/], ['<h2 id="a">x</h2>\n<h3 id="a">y</h3>', /the id "a" twice/], ['<h2 id="">x</h2>', /the id ""/], ['<h2 id="a b">x</h2>', /the id "a b"/]]) {
    assert.throws(() => sound(html), says, html);
  }
});

// ---------------------------------------------------------------- P8/S-63 (REQ-5.8, D-97)

// Issue #188: the git host turns a short code into an emoji in the text it renders, after the
// backslash escapes are gone, so an escaped colon or underscore still leaves an emoji.
test('a word between colons that the host shows as an emoji is refused with its file and line', (t) => {
  const words = [
    'A :tada: moment.',
    'A \\:tada: moment.',
    'A :tada\\: moment.',
    'A :smile\\_cat: moment.',
    'A \\:+1: vote.',
    'The name @scope:package:name is installed.',
  ];
  for (const md of words) {
    const guide = guideWith(t, md);
    const named = new RegExp(`commands/init\\.md:${FIRST}\\b`);
    for (const args of [['--guide', guide], ['--check', '--guide', guide]]) {
      const r = run(args);
      assert.equal(r.code, 1, `${JSON.stringify(md)} ${args[0]}: exit ${r.code}: ${r.out}`);
      assert.match(r.out, named, `${JSON.stringify(md)} ${args[0]} does not name commands/init.md:${FIRST}: ${r.out}`);
      assert.ok(!fs.existsSync(path.join(guide, PAGE)), `${JSON.stringify(md)} ${args[0]} wrote the page`);
    }
  }
  // Inside a code span the same words are text.
  const html = written(t, { init: [...INIT.split('\n'), 'Write `:tada:` and `\\:tada:` for it.', ''] });
  assert.ok(html.includes('<code>:tada:</code>'), 'the code span is not in the page');
});

// Issue #189: only the introduction's paragraph that links the web page is left out.
test('a paragraph outside the introduction that links the web page is kept', (t) => {
  const index = [
    '# Guide', '', 'What the guide holds.', '', 'Open [the web page](slicekit-guide.html) in a browser.', '',
    '## Conventions', '', 'The first paragraph.', '',
    'Every page is also in [the web page](slicekit-guide.html), which holds them in one file.', '',
    'The third paragraph.', '',
    '## Pages', '', '### Commands', '', '| Page | What it does |', '|---|---|', ...ROWS, ''];
  const html = written(t, { index });
  assert.ok(!html.includes('in a browser'), "the introduction's paragraph that links the web page is in the page");
  assert.ok(html.includes('<p>The first paragraph.</p>') && html.includes('<p>The third paragraph.</p>'), 'a paragraph of Conventions is missing');
  assert.ok(html.includes('which holds them in one file.'), 'the paragraph of Conventions that links the web page is left out');
  assert.match(html, /<p>Every page is also in <a [^>]*>the web page<\/a>, which holds them in one file\.<\/p>/);
});
