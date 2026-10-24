import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  markerStyle,
  wrapManaged,
  extractManaged,
  replaceManaged,
} from '../../src/render/managed.js';

test('managed » markerStyle picks by extension', () => {
  assert.equal(markerStyle('a/b.md'), 'html');
  assert.equal(markerStyle('page.html'), 'html');
  assert.equal(markerStyle('settings.json'), 'json');
  assert.equal(markerStyle('ci.yml'), 'hash');
  assert.equal(markerStyle('ci.yaml'), 'hash');
  assert.equal(markerStyle('run.sh'), 'hash');
  assert.equal(markerStyle('Makefile'), 'hash');
  assert.equal(markerStyle('.gitignore'), 'hash');
});

test('managed » wraps with html markers', () => {
  assert.equal(
    wrapManaged('hello', { version: '1.2.3', style: 'html' }),
    '<!-- slicekit:managed:start v1.2.3 -->\nhello\n<!-- slicekit:managed:end -->\n',
  );
  assert.equal(
    wrapManaged('hello\n\n', { version: '1', style: 'html' }),
    '<!-- slicekit:managed:start v1 -->\nhello\n<!-- slicekit:managed:end -->\n',
  );
});

test('managed » wraps with hash markers', () => {
  assert.equal(
    wrapManaged('a: 1\n', { version: '0.1.0', style: 'hash' }),
    '# slicekit:managed:start v0.1.0\na: 1\n# slicekit:managed:end\n',
  );
});

test('managed » extract returns null when absent', () => {
  assert.equal(extractManaged('plain text\n', 'html'), null);
  assert.equal(extractManaged('# slicekit:managed:start v1\nx\n', 'hash'), null);
  assert.equal(
    extractManaged('# slicekit:managed:end\nx\n# slicekit:managed:start v1\n', 'hash'),
    null,
  );
  assert.equal(extractManaged('{"a":1}', 'json'), null);
  assert.equal(extractManaged('not json', 'json'), null);
});

test('managed » extract splits before, block, after', () => {
  const text = 'top\n# slicekit:managed:start v2\r\nbody\n# slicekit:managed:end\r\nbottom\n';
  const got = extractManaged(text, 'hash');
  assert.equal(got.before, 'top\n# slicekit:managed:start v2\r\n');
  assert.equal(got.block, 'body\n');
  assert.equal(got.after, '# slicekit:managed:end\r\nbottom\n');
  assert.equal(got.version, '2');
});

test('managed » replace keeps text outside markers', () => {
  const prefix = '# Title\n\nmine\n';
  const suffix = '\nmy footer\n';
  const original = prefix + wrapManaged('old', { version: '1', style: 'html' }) + suffix;
  const next = replaceManaged(original, 'new\nlines', { version: '2', style: 'html' });
  assert.ok(next.startsWith(prefix));
  assert.ok(next.endsWith(suffix));
  assert.equal(
    next,
    prefix +
      '<!-- slicekit:managed:start v2 -->\nnew\nlines\n<!-- slicekit:managed:end -->\n' +
      suffix,
  );
  assert.throws(() => replaceManaged('nothing', 'x', { version: '1', style: 'html' }));
});

test('managed » json style uses _slicekit key', () => {
  const out = wrapManaged('{"a": 1}', { version: '3', style: 'json' });
  assert.deepEqual(JSON.parse(out), { a: 1, _slicekit: { managed: true, version: '3' } });
  assert.ok(out.endsWith('}\n'));
  const got = extractManaged(out, 'json');
  assert.equal(got.version, '3');
  assert.equal(got.before, '');
  assert.equal(got.after, '');
  const next = replaceManaged(out, '{"b": 2}', { version: '4', style: 'json' });
  assert.deepEqual(JSON.parse(next), { b: 2, _slicekit: { managed: true, version: '4' } });
});
