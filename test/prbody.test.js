import { test } from 'node:test';
import assert from 'node:assert/strict';
import ciBody from '../src/check/rules/ci-body.js';
import { PrBodyError, REQUIRED_SECTIONS, getSection, prBodyProblems, renderPrBody, setSection } from '../src/prbody.js';

const TITLE = '[P1/S-03] Thing';
const sections = Object.fromEntries(REQUIRED_SECTIONS.map((n) => [n, `text for ${n}`]));
const ciMessages = (title, body) => ciBody.run({ ci: true, env: { SLICEKIT_PR_TITLE: title, SLICEKIT_PR_BODY: body } }).map((f) => f.message);

// REQ-2.10: a human's edits around the kit's sections survive a section being rewritten.
test('setSection keeps text outside the section', () => {
  const lines = renderPrBody({ slice: 'P1/S-03', name: 'Thing', sections }).split('\n');
  lines.splice(1, 0, 'A note under the heading, written by a person.');
  const tryAt = lines.findIndex((l) => l.startsWith('**Try it:**'));
  lines.splice(tryAt + 1, 0, '', 'A paragraph a human added after Try it.', '');
  const body = lines.join('\n');
  const out = setSection(body, 'Reviewer blocked', 'B-1: the push refused main; fixed in abc1234');
  const before = body.split('\n');
  const after = out.split('\n');
  assert.equal(after.length, before.length);
  const changed = after.map((l, i) => (l === before[i] ? null : i)).filter((i) => i !== null);
  assert.equal(changed.length, 1);
  assert.equal(after[changed[0]], '**Reviewer blocked:** B-1: the push refused main; fixed in abc1234');
  assert.deepEqual(prBodyProblems(TITLE, out, {}), []);
  assert.equal(getSection(out, 'Reviewer blocked'), 'B-1: the push refused main; fixed in abc1234');
});

test('setSection keeps CRLF line ends and replaces continuation lines', () => {
  const body = ['## [P1/S-03] Thing', ...REQUIRED_SECTIONS.map((n) => `**${n}:** x`)].join('\r\n').replace('**Proof:** x', '**Proof:**\r\nnpm test\r\n2 pass');
  assert.equal(getSection(body, 'Proof'), 'npm test\n2 pass');
  const out = setSection(body, 'Proof', 'npm test: 3 pass');
  assert.equal(out, body.replace('**Proof:**\r\nnpm test\r\n2 pass', '**Proof:** npm test: 3 pass'));
});

test('setSection inserts an absent section before the next present one, else at the end', () => {
  const short = '**Done when:** a\n**Decisions:** none\n';
  assert.equal(setSection(short, 'Proof', 'p'), '**Done when:** a\n**Proof:** p\n**Decisions:** none\n');
  assert.equal(setSection('**Done when:** a', 'Proof', 'p'), '**Done when:** a\n**Proof:** p');
  assert.equal(setSection('', 'Proof', 'p'), '**Proof:** p');
  assert.throws(() => setSection(short, 'Proof', '  '), PrBodyError);
  assert.throws(() => setSection(short, 'Nope', 'x'), PrBodyError);
});

test('getSection ignores a fenced example and reads text on the next line', () => {
  const body = '```\n**Proof:** example\n```\n**Done when:**\n\n- one\n';
  assert.equal(getSection(body, 'Proof'), null);
  assert.equal(getSection(body, 'Done when'), '- one');
});

test('a rendered body passes ci-body, for a slice and for a [spec] or [plan] title', () => {
  const slice = renderPrBody({ slice: 'P1/S-03', name: 'Thing', sections });
  assert.ok(slice.startsWith('## [P1/S-03] Thing\n**Done when:** text for Done when\n'));
  assert.deepEqual(ciMessages(TITLE, slice), []);
  const spec = renderPrBody({ slice: null, name: 'ignored', sections: { 'Done when': 'a', Proof: 'b', Decisions: 'none' } });
  assert.equal(spec, '**Done when:** a\n**Proof:** b\n**Decisions:** none\n');
  assert.deepEqual(ciMessages('[spec] demo', spec), []);
  assert.deepEqual(ciMessages('[plan] demo', spec), []);
});

test('a blank section is refused by name', () => {
  assert.throws(() => renderPrBody({ slice: 'P1/S-03', name: 'Thing', sections: { ...sections, Runbook: ' ' } }), (e) => e instanceof PrBodyError && e.message === 'section "Runbook" is empty');
  assert.throws(() => renderPrBody({ slice: null, name: 'x', sections: { 'Done when': 'a', Proof: 'b' } }), /section "Decisions" is empty/);
});

test('prBodyProblems gives the ci-body messages', () => {
  const body = renderPrBody({ slice: 'P1/S-03', name: 'Thing', sections }).replace(/\*\*Proof:\*\*.*\n/, '');
  assert.deepEqual(prBodyProblems(TITLE, body, {}), ['pull request body is missing "Proof"']);
  assert.deepEqual(prBodyProblems(TITLE, body, {}), ciMessages(TITLE, body));
  assert.deepEqual(prBodyProblems('[P1/S-04] x', renderPrBody({ slice: 'P1/S-03', name: 'Thing', sections }), {}), ['pull request body heading does not name P1/S-04']);
  assert.deepEqual(prBodyProblems(TITLE, renderPrBody({ slice: 'P1/S-03', name: 'Thing', sections: { ...sections, Proof: 'a robust proof' } }), { style: { banned: ['robust'] } }), ['pull request body uses banned phrase "robust"']);
});

// Fix round 1 (I-1, M-7): a value either renders so ci-body passes or is refused naming why.
test('every value either renders so ci-body passes or is refused naming why', () => {
  const render = (over, slice = 'P1/S-03') => renderPrBody({ slice, name: 'Thing', sections: { ...sections, ...over } });
  const passes = {
    'bold text inside': { Proof: 'see **X:** here' },
    'pipe and backtick': { Proof: 'a | b `c`' },
    'two lines': { Proof: 'line1\nline2' },
    'a fence after text': { Proof: 'run:\n```\nnode x\n```' },
    'a fence first': { Proof: '```js\nnode x\n```' },
    'a fence with a blank line inside': { Proof: '```\na\n\nb\n```' },
  };
  for (const [label, over] of Object.entries(passes)) {
    const body = render(over);
    assert.deepEqual(ciMessages(TITLE, body), [], `${label}:\n${body}`);
  }
  assert.ok(render({ Proof: '```js\nnode x\n```' }).includes('**Proof:**\n```js\nnode x\n```\n'));
  const refused = [
    [{ Proof: 'run:\n```\nnode x' }, /missing "Decisions"/],
    [{ Proof: 'a\n**Decisions:** b' }, /"Decisions" twice/],
    [{ Proof: 'a <!-- b' }, /missing "Decisions"/],
    [{ Proof: '<!-- hidden -->' }, /empty "Proof"/],
  ];
  for (const [over, why] of refused) {
    assert.throws(() => render(over), (e) => e instanceof PrBodyError && why.test(e.message), JSON.stringify(over));
  }
  for (const name of [undefined, '', '   ', null, 7]) {
    assert.throws(() => renderPrBody({ slice: 'P1/S-03', name, sections }), (e) => e instanceof PrBodyError && /name/.test(e.message), String(name));
  }
  for (const slice of ['nope', undefined, 'P1/S-3']) {
    assert.throws(() => renderPrBody({ slice, name: 'Thing', sections }), (e) => e instanceof PrBodyError && /slice/.test(e.message), String(slice));
  }
});

test('setSection puts a fenced value on its own lines and refuses one that breaks the body', () => {
  const body = renderPrBody({ slice: 'P1/S-03', name: 'Thing', sections });
  const fenced = setSection(body, 'Proof', '```\nnpm test\n\n3 pass\n```');
  assert.ok(fenced.includes('**Proof:**\n```\nnpm test\n\n3 pass\n```\n**Decisions:**'));
  assert.deepEqual(prBodyProblems(TITLE, fenced, {}), []);
  assert.equal(setSection(fenced, 'Proof', 'single'), setSection(body, 'Proof', 'single'));
  assert.equal(setSection(setSection(body, 'Proof', 'multi\nline'), 'Proof', 'text for Proof'), body);
  assert.throws(() => setSection(body, 'Proof', 'run:\n```\nnode x'), (e) => e instanceof PrBodyError && /missing "Decisions"/.test(e.message));
  assert.throws(() => setSection(body, 'Proof', 'a\n**Runbook:** b'), (e) => e instanceof PrBodyError && /"Runbook" twice/.test(e.message));
  // A body that was already short of sections may still be edited: only new problems refuse.
  assert.equal(setSection('**Done when:** a\n', 'Decisions', 'none'), '**Done when:** a\n**Decisions:** none\n');
});
