import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lines, headings, frontMatter, tables, refs } from '../src/markdown.js';

const DOC = '---\nname: demo\ntags: [a, b, c]\nitems:\n- one\n- two\n---\n# Title\ntext\n```\n# not a heading\n```\n## Second\n';

test('markdown » parses CRLF', () => {
  const crlf = DOC.replace(/\n/g, '\r\n');
  assert.deepEqual(headings(crlf), headings(DOC));
  assert.deepEqual(frontMatter(crlf), frontMatter(DOC));
  assert.deepEqual(lines('a\r\nb'), ['a', 'b']);
  assert.ok(!frontMatter(crlf).body.includes('\r'));
  assert.deepEqual(frontMatter('# t\r\nx\r\n'), { data: {}, body: '# t\nx\n' });
});

test('markdown » a leading BOM is stripped', () => {
  assert.deepEqual(frontMatter('﻿---\nslice: x\n---\n'), { data: { slice: 'x' }, body: '' });
  assert.deepEqual(lines('﻿# t'), ['# t']);
});

test('markdown » tables ignores a table inside a code fence', () => {
  assert.deepEqual(tables('```\n| A | B |\n|---|---|\n| 1 | 2 |\n```\n'), []);
});

test('markdown » frontMatter parses lists', () => {
  const { data, body } = frontMatter(DOC);
  assert.deepEqual(data, { name: 'demo', tags: ['a', 'b', 'c'], items: ['one', 'two'] });
  assert.ok(body.startsWith('# Title'));
  assert.deepEqual(frontMatter('# plain'), { data: {}, body: '# plain' });
});

test('markdown » headings ignore fenced code', () => {
  assert.deepEqual(headings(DOC).map((h) => [h.level, h.text]), [[1, 'Title'], [2, 'Second']]);
});

test('markdown » tables', () => {
  const t = tables('x\n\n| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\nend');
  assert.deepEqual(t, [{ line: 3, header: ['A', 'B'], rows: [['1', '2'], ['3', '4']] }]);
});

test('markdown » refs handles titles, parentheses, URLs, placeholders and reference links', () => {
  const paths = (text) => refs(text).filter((r) => r.kind === 'path').map((r) => r.value);
  assert.deepEqual(paths('[t](x.md "title")'), ['x.md']);
  assert.deepEqual(paths("[t](x.md 'title')"), ['x.md']);
  assert.deepEqual(paths('[t](a(b).md)'), ['a(b).md']);
  assert.deepEqual(paths('`https://x.io/a.md`'), []);
  assert.deepEqual(paths('`src/cli/<cmd>.js`'), []);
  assert.deepEqual(paths('[t](src/cli/<cmd>.js)'), []);
  assert.deepEqual(paths('`docs/**/*.md` [g](docs/*.md)'), []);
  assert.deepEqual(paths('[t][ref] and [ref]: x/y.md'), []);
  assert.deepEqual(paths('`[t](inline/code.md)`'), [], 'a link written inside a code span is not a link');
  assert.deepEqual(paths('`src\\cli\\run.js`'), ['src\\cli\\run.js'], 'a backslash is a separator');
  assert.deepEqual(paths('`node_modules/.bin` `node_modules/x/y.js` `.git/hooks/` [n](node_modules/a.js)'), []);
  assert.deepEqual(paths('`1/2.5` `docs/.hidden`'), [], 'a fraction and a dotfile are not paths');
  assert.deepEqual(refs('[l](a/b.md) `c/d.md`').map((r) => r.via), ['link', 'code']);
  const anchor = refs('[t](a.md#sec "title")').find((r) => r.kind === 'anchor');
  assert.deepEqual(anchor, { kind: 'anchor', value: 'sec', file: 'a.md', line: 1 });
});

test('markdown » refs finds paths, ids and links', () => {
  const text = [
    'See [spec](docs/spec/01.md) and [part](02.md#intro).',
    'Also `docs/spec/03.md` and `src/cli/`, but not `foo`.',
    'Covers REQ-1.2, D-14, G-3, C-2, P1/S-03.',
    '[web](https://x.io/a.md)',
    '```',
    '`skip/this.md` REQ-9.9',
    '```',
  ].join('\n');
  const found = refs(text);
  const has = (kind, value, line) => found.some((r) => r.kind === kind && r.value === value && r.line === line);
  assert.ok(has('path', 'docs/spec/01.md', 1));
  assert.ok(has('path', '02.md', 1));
  assert.ok(has('anchor', 'intro', 1));
  assert.ok(has('path', 'docs/spec/03.md', 2));
  assert.ok(has('path', 'src/cli/', 2));
  for (const id of ['REQ-1.2', 'D-14', 'G-3', 'C-2', 'P1/S-03']) assert.ok(has('id', id, 3), id);
  assert.ok(!found.some((r) => r.value.includes('x.io') || r.value === 'foo'));
  assert.ok(!found.some((r) => r.line >= 5));
});
