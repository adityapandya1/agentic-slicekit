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
