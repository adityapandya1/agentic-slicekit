// S-25: the README's shape (REQ-5.7) and its scope line (REQ-4.8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// The prose outside code blocks, so a `#` in a sh block is no heading.
function outsideCode(text) {
  let open = false;
  return text.split('\n').filter((l) => {
    if (/^\s*(`{3,}|~{3,})/.test(l)) {
      open = !open;
      return false;
    }
    return !open;
  });
}

const headings = () => outsideCode(readme).filter((l) => /^##\s/.test(l)).map((l) => l.replace(/^##\s+/, '').trim());

function section(name) {
  const lines = readme.split('\n');
  const start = lines.findIndex((l) => l.trim() === `## ${name}`);
  assert.ok(start >= 0, `no ## ${name}`);
  const end = lines.findIndex((l, i) => i > start && /^##?\s/.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

test('the README opens with two sentences, then Status: preview, the walkthrough and the scope line', () => {
  const lines = readme.split('\n');
  assert.match(lines[0], /^# /);
  const rest = lines.slice(1).join('\n').trimStart();
  const first = rest.split(/\n\s*\n/)[0];
  assert.doesNotMatch(first, /^#/, 'the title is followed by a paragraph');
  const sentences = first.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=[A-Z`])/);
  assert.equal(sentences.length, 2, first);
  assert.deepEqual(headings(), ['Status: preview', 'Walkthrough', 'Scope', 'How the hooks find slicekit']);
  const status = section('Status: preview');
  assert.match(status, /Phases? 1 and 2/);
  assert.match(status, /Phases? 3 and 4/);
  assert.match(status, /git clone https:\/\/github\.com\/adityapandya1\/agentic-slicekit/);
  assert.match(status, /node bin\/slicekit\.js --version/);
  assert.match(readme.trimEnd(), /\nLicense: MIT\.$/);
  // No internal shorthand a newcomer cannot read: decision numbers, hook names.
  assert.doesNotMatch(readme, /\bD-\d+\b/);
  assert.doesNotMatch(readme, /on every stop/);
});

test('the scope line says the kit parses no source code and names graphify', () => {
  const scope = section('Scope');
  assert.match(scope, /does not parse (your )?source code/);
  assert.match(scope, /https:\/\/github\.com\/Graphify-Labs\/graphify/);
  assert.match(scope, /```sh\npip install graphifyy && graphify install\n```/);
  // The one line that runs both in one Claude Code session.
  assert.match(scope, /`\/graphify [^`]*`[^\n]*`\/slicekit [^`]*`/);
});

// S-25 whole-branch review: what a newcomer needs after the walkthrough and from the hooks section.
test('the walkthrough cleans up after itself, and the hooks section points a clone at --cli', () => {
  const walk = section('Walkthrough');
  assert.match(walk, /^cd "\$KIT"$/m);
  assert.match(walk, /^rm -rf "\$WORK"$/m);
  const unset = walk.split('\n').find((l) => l.startsWith('unset ')) ?? '';
  for (const v of ['SLICEKIT_GITHOST_FIXTURE', 'SLICEKIT_TRACKER_FIXTURE', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0']) {
    assert.ok(unset.split(/\s+/).includes(v), v);
  }
  // The independent verdict is round 2, while `rounds: 1 of 2` counts only the in-loop rounds.
  assert.match(walk, /rounds: 1 of 2/);
  const hooks = section('How the hooks find slicekit');
  assert.match(hooks, /--cli/);
  assert.match(hooks, /clone/);
  // The local install comes first, the clone second.
  assert.ok(hooks.indexOf('npm i -D slicekit') >= 0 && hooks.indexOf('npm i -D slicekit') < hooks.indexOf('clone'), hooks);
});

test('the status section gives the npm install and says the walkthrough runs from a clone', () => {
  const status = section('Status: preview');
  assert.match(status, /0\.1\.1/);
  assert.match(status, /```sh\nnpm i -D slicekit\nnpx slicekit init --shape backend --name <your-project>\n```/);
  assert.match(status, /walkthrough[^.]*clone/i);
  assert.match(status, /examples\/walkthrough/);
});

test('the status section names no placeholder and no release still to come', () => {
  const status = section('Status: preview');
  assert.doesNotMatch(status, /placeholder/);
  assert.doesNotMatch(status, /first\s+real\s+release/);
  assert.doesNotMatch(status, /0\.0\.1/);
});
