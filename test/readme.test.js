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
  assert.match(status, /npm/);
  assert.match(status, /0\.0\.1/);
  assert.match(status, /placeholder/);
  assert.match(status, /\b0\.1\b/);
  assert.match(status, /Phases? 1 and 2/);
  assert.match(status, /Phases? 3 and 4/);
  assert.match(status, /git clone https:\/\/github\.com\/adityapandya1\/agentic-slicekit/);
  assert.match(status, /node bin\/slicekit\.js --version/);
  assert.match(readme, /^License: MIT\.$/m);
});

test('the scope line says the kit parses no source code and names graphify', () => {
  const scope = section('Scope');
  assert.match(scope, /does not parse (your )?source code/);
  assert.match(scope, /graphify/);
  // The one line that runs both in one Claude Code session.
  assert.match(scope, /`\/graphify [^`]*`[^\n]*`\/slicekit [^`]*`/);
});
