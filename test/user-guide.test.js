// P5/S-24 (REQ-5.8, REQ-4.8, D-61): the user guide under docs/guide/ has a page for every slicekit
// command the CLI registers (commands/<name>.md), every /slicekit procedure (slash/<name>.md, and
// slash/slicekit.md for /slicekit itself) and every check rule (rules/<id>.md). A page that is
// missing is named, so the guide cannot fall behind the CLI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMANDS } from '../src/cli/index.js';
import { PROCEDURES } from '../src/instructions.js';
import { ALL_RULES } from '../src/check/index.js';

const GUIDE = fileURLToPath(new URL('../docs/guide/', import.meta.url));

// What the kit has today: its commands, its slash commands and its check rules.
const kitLists = () => ({
  commands: Object.keys(COMMANDS),
  slash: ['slicekit', ...PROCEDURES],
  rules: ALL_RULES.map((rule) => rule.id),
});

const pagePath = (page) => path.join(GUIDE, ...`${page}.md`.split('/'));
const readPage = (page) => fs.readFileSync(pagePath(page), 'utf8').replace(/\r\n/g, '\n');

// Every `commands/<name>`, `slash/<name>` or `rules/<id>` of the lists with no page, or an empty one.
function missingPages(lists = kitLists()) {
  const pages = [
    ...lists.commands.map((name) => `commands/${name}`),
    ...lists.slash.map((name) => `slash/${name}`),
    ...lists.rules.map((id) => `rules/${id}`),
  ];
  return pages.filter((page) => !fs.existsSync(pagePath(page)) || readPage(page).trim() === '');
}

// The lines of the `## <name>` section of a page, up to the next heading of that level or above;
// null when the page has no such heading. Lines inside a code block are no headings.
function section(text, name) {
  const lines = text.split('\n');
  let open = false;
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(`{3,}|~{3,})/.test(lines[i])) {
      open = !open;
      continue;
    }
    if (open) continue;
    if (start < 0 && lines[i].trim() === `## ${name}`) start = i;
    else if (start >= 0 && /^##?\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return start < 0 ? null : lines.slice(start + 1, end);
}

test('a command or check rule with no guide page fails, naming it', () => {
  const lists = kitLists();
  assert.ok(lists.commands.length >= 30 && lists.commands.includes('graph'), lists.commands.join(' '));
  assert.ok(lists.slash.includes('build') && lists.slash.includes('review'), lists.slash.join(' '));
  assert.ok(lists.rules.length >= 18 && lists.rules.includes('references'), lists.rules.join(' '));

  // A command, a procedure or a rule the guide has no page for is named, each by its own path.
  const fake = {
    commands: [...lists.commands, 'no-such-command'],
    slash: [...lists.slash, 'no-such-procedure'],
    rules: [...lists.rules, 'no-such-rule'],
  };
  const named = missingPages(fake);
  for (const page of ['commands/no-such-command', 'slash/no-such-procedure', 'rules/no-such-rule']) {
    assert.ok(named.includes(page), `${page} has no page and is not named: ${named.join(', ')}`);
  }

  // The kit itself has every page.
  assert.deepEqual(missingPages(), [], 'docs/guide/ has no page for these');
  assert.deepEqual(named.sort(), ['commands/no-such-command', 'rules/no-such-rule', 'slash/no-such-procedure']);

  // docs/guide/README.md links every page, by its path relative to the guide.
  const index = fs.readFileSync(path.join(GUIDE, 'README.md'), 'utf8');
  const all = [...lists.commands.map((n) => `commands/${n}`), ...lists.slash.map((n) => `slash/${n}`), ...lists.rules.map((n) => `rules/${n}`)];
  const unlinked = all.filter((page) => !index.includes(`](${page}.md)`) && !index.includes(`](./${page}.md)`));
  assert.deepEqual(unlinked, [], 'docs/guide/README.md does not link these pages');
});

test('every rule page says the failure it prevents', () => {
  const rules = kitLists().rules;
  assert.ok(rules.length >= 18, rules.join(' '));
  const without = [];
  for (const id of rules) {
    const text = fs.existsSync(pagePath(`rules/${id}`)) ? readPage(`rules/${id}`) : '';
    const lines = section(text, 'The failure it prevents');
    // One paragraph of prose under the heading.
    const paragraphs = (lines ?? []).join('\n').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    if (paragraphs.length !== 1 || !/[.!?]$/.test(paragraphs[0].replace(/\s+/g, ' '))) without.push(`rules/${id}`);
  }
  assert.deepEqual(without, [], 'these rule pages have no "## The failure it prevents" section of one paragraph');
});

test('the graph page says the graph is not a code graph and gives the graphify line', () => {
  assert.ok(fs.existsSync(pagePath('commands/graph')), 'docs/guide/commands/graph.md is missing');
  const text = readPage('commands/graph');
  const prose = text.replace(/\s+/g, ' ');
  assert.match(prose, /graph is built from (its|the kit's) own IDs and (from )?git/);
  assert.match(prose, /not a code graph/);
  assert.match(prose, /does not parse (your )?source code|infers no calls or imports/);
  assert.match(text, /https:\/\/github\.com\/Graphify-Labs\/graphify/);
  // The line that installs graphify, as the README's scope section gives it.
  assert.match(text, /```sh\npip install graphifyy && graphify install\n```/);
  // The one line that runs both in one Claude Code session.
  assert.match(text, /`\/graphify [^`]*`[^\n]*`\/slicekit [^`]*`/);
});

// P6/S-51 (REQ-5.8, D-95, issue #172): the sync-release rule also judges the rendered files of each
// folder under examples/. Its page says so, quotes the second half of the finding line an example
// file gets, as the rule writes it, and names the command that clears it.
test('the sync-release page says what a finding on an example file means', () => {
  const EXAMPLE_HALF = 'a sync pull request changes an example file only to its fresh render at the version it sets';
  // The rule still writes that half; the page quotes the rule, not a line of its own.
  const rule = fs.readFileSync(fileURLToPath(new URL('../src/check/rules/sync-release.js', import.meta.url)), 'utf8');
  assert.ok(rule.includes(EXAMPLE_HALF), 'src/check/rules/sync-release.js no longer writes this line');

  assert.ok(fs.existsSync(pagePath('rules/sync-release')), 'docs/guide/rules/sync-release.md is missing');
  const prose = readPage('rules/sync-release').replace(/\s+/g, ' ');
  // The rendered files of each folder under examples/ are judged too.
  assert.match(prose, /each folder under `examples\/`/);
  assert.match(prose, /rendered files/);
  // The second half of the finding line an example file gets.
  assert.ok(prose.includes(EXAMPLE_HALF), `the page does not quote: ${EXAMPLE_HALF}`);
  // The command that clears it, run in that folder.
  assert.match(prose, /`slicekit update --yes`/);
  assert.match(prose, /in that folder/);
});

// P6/S-54 (REQ-5.8, D-97, D-61): docs/guide/README.md is the index of pages. The sections Slash
// commands and Command reference written for version 0.2.1 are gone, since every command, slash
// command and rule has its page; the PDF copies are rendered from the web page outside the
// repository, so docs/guide holds none and no file of the repository links one.
test('the guide index holds no command reference and links no PDF', () => {
  const index = fs.readFileSync(path.join(GUIDE, 'README.md'), 'utf8').replace(/\r\n/g, '\n');
  // The headings outside code blocks, as `<hashes> <text>`.
  const headings = [];
  let open = false;
  for (const line of index.split('\n')) {
    if (/^\s*(`{3,}|~{3,})/.test(line)) open = !open;
    else if (!open && /^#{1,6}\s/.test(line)) headings.push(line.trim());
  }

  // The older reference is gone: its two sections, each command's entry, and its version.
  assert.ok(!headings.includes('## Command reference'), 'the index still has ## Command reference');
  assert.ok(!headings.includes('## Slash commands'), 'the index still has the older ## Slash commands section');
  const entries = headings.filter((h) => /^#{2,6}\s+`?\/?slicekit\b/.test(h));
  assert.deepEqual(entries, [], 'the index still holds these entries of the older reference');
  assert.doesNotMatch(index, /\(#command-reference\)/, 'the index still links #command-reference');
  assert.doesNotMatch(index, /0\.2\.1/, 'the index still names version 0.2.1');

  // What the index keeps: the tables of pages, and what the pages do not hold.
  for (const kept of ['## Pages', '### Slash commands', '### Commands', '### Check rules', '## Overview', '## Stages', '## Conventions']) {
    assert.ok(headings.includes(kept), `the index has no ${kept}`);
  }

  // The introduction, before the first section, says where the web page and the PDF copies come from.
  const intro = index.slice(0, index.search(/^## /m)).replace(/\s+/g, ' ');
  assert.match(intro, /slicekit-guide\.html/);
  assert.match(intro, /generated from/);
  assert.ok(intro.includes('`node scripts/guide-html.js`'), 'the introduction does not name the command that writes the web page');
  assert.match(intro, /PDF/);
  assert.match(intro, /outside the repository/);

  // The index links no PDF, and docs/guide holds none.
  assert.doesNotMatch(index, /\.pdf\b/i, 'the index names a PDF file');
  const kitRoot = fileURLToPath(new URL('../', import.meta.url));
  const walk = (dir, keep, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!['node_modules', '.git', '.worktrees'].includes(e.name)) walk(path.join(dir, e.name), keep, out);
      } else if (keep(e.name)) out.push(path.relative(kitRoot, path.join(dir, e.name)).split(path.sep).join('/'));
    }
    return out;
  };
  assert.deepEqual(walk(GUIDE, (name) => /\.pdf$/i.test(name)), [], 'docs/guide still holds these PDF copies');

  // No Markdown or HTML file of the repository links a PDF of the guide.
  const linking = [];
  for (const file of walk(kitRoot, (name) => /\.(md|html)$/i.test(name))) {
    const lines = fs.readFileSync(path.join(kitRoot, file), 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (/\]\([^)\s]*\.pdf(#[^)\s]*)?\)|(?:href|src)="[^"]*\.pdf(#[^"]*)?"/i.test(line)) linking.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(linking, [], 'these lines link a PDF file');
});
