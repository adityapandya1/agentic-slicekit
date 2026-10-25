import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ciBody, { REQUIRED_SECTIONS } from '../../src/check/rules/ci-body.js';

const events = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'ci-events');
const FILE = '.github/pull_request';
const TITLE = '[P1/S-03] Thing';

// The rule reads only `ci` and `env`, so a bare context stands in for a repository.
const run = (env, ci = true) => ciBody.run({ ci, env });
const local = (body, title = TITLE) => run({ SLICEKIT_PR_TITLE: title, SLICEKIT_PR_BODY: body });
const messages = (found) => found.map((f) => f.message);

// A body with every REQ-2.10 section; `over` replaces a section's line (null drops it).
function body({ heading = '## [P1/S-03] Thing', over = {}, order = REQUIRED_SECTIONS } = {}) {
  const out = [heading];
  for (const name of order) {
    const line = name in over ? over[name] : `**${name}:** text for ${name}`;
    if (line !== null) out.push(line);
  }
  return out.join('\n');
}

test('the rule is blocking and not a ratchet', () => {
  assert.equal(ciBody.id, 'ci-body');
  assert.equal(ciBody.blocking, true);
  assert.equal(ciBody.ratchet, false);
});

test('the required sections are REQ-2.10 in order', () => {
  assert.deepEqual(REQUIRED_SECTIONS, ['Done when', 'Proof', 'Decisions', 'Runbook', 'Infra / migration', 'Try it', 'Reviewer blocked', 'Should-haves declined', 'Skipped / not checked']);
});

// REQ-2.10: a body without a section fails naming it.
test('missing section is a finding naming it', () => {
  assert.deepEqual(local(body({ over: { Runbook: null } })), [{ file: FILE, line: 0, message: 'pull request body is missing "Runbook"' }]);
});

// REQ-2.10: a real pull request body of this repository (PR #6) passes.
test('complete body passes', () => {
  assert.deepEqual(run({ GITHUB_EVENT_PATH: path.join(events, 'pr-complete.json') }), []);
});

test('a built complete body passes, with CRLF line ends too', () => {
  assert.deepEqual(local(body()), []);
  assert.deepEqual(local(body().replace(/\n/g, '\r\n')), []);
});

test('outside --ci the rule does nothing', () => {
  assert.deepEqual(run({ SLICEKIT_PR_TITLE: TITLE, SLICEKIT_PR_BODY: '' }, false), []);
});

test('a push event has no pull request and no findings', () => {
  assert.deepEqual(run({ GITHUB_EVENT_PATH: path.join(events, 'push.json') }), []);
});

test('no event and no local override: no findings', () => {
  assert.deepEqual(run({}), []);
});

test('a null body is empty: every section is missing', () => {
  const found = run({ GITHUB_EVENT_PATH: path.join(events, 'pr-null-body.json') });
  assert.deepEqual(messages(found), [
    'pull request body heading does not name P1/S-01',
    ...REQUIRED_SECTIONS.map((n) => `pull request body is missing "${n}"`),
  ]);
});

test('a section out of order is a finding', () => {
  const order = ['Done when', 'Decisions', 'Proof', ...REQUIRED_SECTIONS.slice(3)];
  assert.deepEqual(messages(local(body({ order }))), ['pull request body has "Proof" out of order']);
});

test('an empty section followed by the next section is a finding', () => {
  const found = local(body({ over: { Decisions: '**Decisions:**   ' } }));
  assert.deepEqual(messages(found), ['pull request body has an empty "Decisions"']);
});

test('a section whose text is on the next non-blank line is not empty', () => {
  assert.deepEqual(local(body({ over: { Decisions: '**Decisions:**\n\n- one line' } })), []);
});

test('an empty last section is a finding', () => {
  const found = local(body({ over: { 'Skipped / not checked': '**Skipped / not checked:**\n\n' } }));
  assert.deepEqual(messages(found), ['pull request body has an empty "Skipped / not checked"']);
});

test('a duplicate section is a finding', () => {
  const found = local(body({ over: { Proof: '**Proof:** one\n**Proof:** two' } }));
  assert.deepEqual(messages(found), ['pull request body has "Proof" twice']);
});

test('a heading naming another slice, or no heading, is a finding', () => {
  assert.deepEqual(messages(local(body({ heading: '## [P1/S-04] Thing' }))), ['pull request body heading does not name P1/S-03']);
  assert.deepEqual(messages(local(body({ heading: 'no heading' }))), ['pull request body heading does not name P1/S-03']);
});

test('section text inside a fenced code block does not count', () => {
  const fenced = '```\n**Runbook:** shown as an example\n```';
  const found = local(body({ over: { Runbook: fenced } }));
  assert.deepEqual(messages(found), ['pull request body is missing "Runbook"']);
});

test('a heading inside a fenced code block does not count', () => {
  const b = body({ heading: '```\n## [P1/S-03] Thing\n```' });
  assert.deepEqual(messages(local(b)), ['pull request body heading does not name P1/S-03']);
});

test('a section marker may be indented', () => {
  assert.deepEqual(local(body({ over: { Proof: '  **Proof:** indented' } })), []);
});

test('a [spec] or [plan] title needs only Done when, Proof and Decisions, and no slice heading', () => {
  const short = ['**Done when:** a', '**Proof:** b', '**Decisions:** none'].join('\n');
  assert.deepEqual(local(short, '[spec] Write the spec'), []);
  assert.deepEqual(local(short, '[plan] Plan phase 1'), []);
  assert.deepEqual(messages(local('**Done when:** a\n**Decisions:** none', '[plan] Plan')), ['pull request body is missing "Proof"']);
});

test('a title with no slice id: the sections are still checked, the heading is left to ci-title', () => {
  assert.deepEqual(local(body({ heading: 'none' }), 'Fix billing'), []);
  assert.deepEqual(messages(local(body({ over: { Proof: null } }), 'Fix billing')), ['pull request body is missing "Proof"']);
});

test('the local override reads SLICEKIT_PR_BODY', () => {
  assert.equal(local('').length, REQUIRED_SECTIONS.length + 1);
});

test('the event file wins over the local override', () => {
  const env = { GITHUB_EVENT_PATH: path.join(events, 'pr-complete.json'), SLICEKIT_PR_TITLE: TITLE, SLICEKIT_PR_BODY: '' };
  assert.deepEqual(run(env), []);
});

// Fix round 1: fences follow CommonMark, comments hide text, a BOM is not text.
test('a fence closes only on the same character with a run at least as long', () => {
  const b = ['## [P1/S-03] Thing', '````', '```', 'inside', '````', ...REQUIRED_SECTIONS.map((n) => `**${n}:** x`)].join('\n');
  assert.deepEqual(local(b), []);
});

test('an empty section followed by a line that is not a required section is not empty', () => {
  assert.deepEqual(local(body({ over: { Proof: '**Proof:**\n**Unit:** npm test' } })), []);
});

test('a section followed only by an HTML comment is empty', () => {
  assert.deepEqual(messages(local(body({ over: { Proof: '**Proof:**\n<!-- todo -->' } }))), ['pull request body has an empty "Proof"']);
});

test('a section followed by a heading is empty', () => {
  assert.deepEqual(messages(local(body({ over: { Proof: '**Proof:**\n## Notes' } }))), ['pull request body has an empty "Proof"']);
});

test('sections inside a multi-line HTML comment are missing', () => {
  const b = ['## [P1/S-03] Thing', '<!--', ...REQUIRED_SECTIONS.map((n) => `**${n}:** x`), '-->'].join('\n');
  assert.deepEqual(messages(local(b)), REQUIRED_SECTIONS.map((n) => `pull request body is missing "${n}"`));
});

test('a leading byte order mark is not text', () => {
  const b = '\uFEFF' + body();
  assert.deepEqual(local(b), []);
});

// D-37: a pull request opened by a listed bot is exempt from the body rule.
test('a pull request from a listed bot is exempt from ci-body (D-37)', () => {
  const env = { GITHUB_EVENT_PATH: path.join(events, 'pr-bot.json') };
  assert.deepEqual(ciBody.run({ ci: true, env }), [], 'no config: the default list');
  assert.deepEqual(ciBody.run({ ci: true, env, cfg: { ci: { botActors: ['dependabot[bot]'] } } }), []);
  const judged = ciBody.run({ ci: true, env, cfg: { ci: { botActors: [] } } });
  assert.ok(messages(judged).includes('pull request body is missing "Done when"'), messages(judged).join('\n'));
});

// M5 (REQ-3.7 style row, REQ-3.10): the filler list also runs over the pull request body.
test('a banned phrase in the body is one finding per phrase', () => {
  const cfg = { style: { banned: ['robust', "it's worth noting", 'leverage'] } };
  const text = [
    body(),
    'This is Robust, and robust again.',
    "It's",
    'worth noting that we leverage `robust` code.',
    '```',
    'leverage inside a fence',
    '```',
    'robustness and leverages are other words.',
  ].join('\n');
  const found = ciBody.run({ ci: true, env: { SLICEKIT_PR_TITLE: TITLE, SLICEKIT_PR_BODY: text }, cfg });
  assert.deepEqual(messages(found), [
    'pull request body uses banned phrase "robust"',
    'pull request body uses banned phrase "it\'s worth noting"',
    'pull request body uses banned phrase "leverage"',
  ]);
  assert.ok(found.every((f) => f.file === FILE && f.line === 0));
  const clean = [body(), 'Nothing filler here; robustness is fine.', 'A `leverage` in code.'].join('\n');
  assert.deepEqual(ciBody.run({ ci: true, env: { SLICEKIT_PR_TITLE: TITLE, SLICEKIT_PR_BODY: clean }, cfg }), []);
});

test('a bot pull request is exempt from the body style check too (D-37)', () => {
  const env = { GITHUB_EVENT_PATH: path.join(events, 'pr-bot.json') };
  assert.deepEqual(ciBody.run({ ci: true, env, cfg: { style: { banned: ['Bumps'] } } }), []);
});
