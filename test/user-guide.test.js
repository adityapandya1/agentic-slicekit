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

// P6/S-55 (REQ-5.8, D-97, D-98): the guide index opens as the README does: its heading, then the
// README's one line, then one paragraph of at most four sentences on what the guide holds.
test("the guide index opens with the README's line", () => {
  const ONE_LINE = 'A closed-loop framework for spec-driven development with coding agents.';
  const index = fs.readFileSync(path.join(GUIDE, 'README.md'), 'utf8').replace(/\r\n/g, '\n');
  // Its paragraphs: runs of non-blank lines.
  const paragraphs = index.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  assert.equal(paragraphs[0], '# slicekit guide', 'the index heading');
  assert.equal(paragraphs[1], ONE_LINE, "the line after the heading is not the README's");
  const about = paragraphs[2] ?? '';
  assert.doesNotMatch(about, /^#/, 'no paragraph follows the line');
  const sentences = about.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z`[])/);
  assert.ok(sentences.length <= 4, `the paragraph after the line has ${sentences.length} sentences: ${about}`);
  assert.match(about, /guide/i, 'the paragraph does not say what the guide holds');

  // The same line as the README's.
  const readme = fs.readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(readme.split('\n').some((l) => l.trim() === ONE_LINE), 'README.md has no line "A closed-loop framework ..."');
});

// P7/S-56 (REQ-5.8, REQ-5.7, D-99): `slicekit brief` and `/slicekit brief` have their pages, the
// guide index's Pages section links both, and the README's "What it covers" table has a Brief row.
test('the brief command and procedure have pages', () => {
  const lists = kitLists();
  assert.ok(lists.commands.includes('brief'), `COMMANDS has no brief: ${lists.commands.join(' ')}`);
  assert.ok(lists.slash.includes('brief'), `PROCEDURES has no brief: ${lists.slash.join(' ')}`);
  for (const page of ['commands/brief', 'slash/brief']) {
    assert.ok(fs.existsSync(pagePath(page)), `docs/guide/${page}.md is missing`);
    assert.notEqual(readPage(page).trim(), '', `docs/guide/${page}.md is empty`);
  }
  const index = fs.readFileSync(path.join(GUIDE, 'README.md'), 'utf8').replace(/\r\n/g, '\n');
  const pages = (section(index, 'Pages') ?? []).join('\n');
  for (const page of ['commands/brief', 'slash/brief']) {
    assert.ok(pages.includes(`](${page}.md)`) || pages.includes(`](./${page}.md)`), `the Pages section does not link ${page}.md`);
  }
  // The README's "What it covers" table has a row for /slicekit brief.
  const readme = fs.readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
  const covers = section(readme, 'What it covers') ?? [];
  const row = covers.find((l) => l.startsWith('|') && /`\/slicekit[ -]brief`/.test(l));
  assert.ok(row, 'the README\'s What it covers table has no /slicekit brief row');
  assert.match(row.split('|')[1].trim(), /^Brief$/);
});

// P7/S-57 (REQ-5.8, D-99, D-97): the guide index's Stages table opens with the optional brief stage,
// the paragraph above it names `brief` as optional and before `intake`, and the "Intake and spec"
// group links the brief pages.
test('the Stages table opens with the optional brief stage and its CLI steps', () => {
  const index = fs.readFileSync(path.join(GUIDE, 'README.md'), 'utf8').replace(/\r\n/g, '\n');
  const stages = section(index, 'Stages');
  assert.ok(stages, 'the index has no ## Stages');
  const rows = stages.filter((l) => l.trim().startsWith('|'));
  const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  assert.deepEqual(cells(rows[0] ?? ''), ['Stage', 'Slash command', 'What happens', 'CLI steps'], 'the Stages table header');
  // rows[1] is the |---| line; rows[2] is the first stage.
  const first = cells(rows[2] ?? '');
  assert.equal(first[0], '0. Brief (optional)', `the first row of the Stages table: ${rows[2]}`);
  assert.ok(first[1].includes('`/slicekit brief [<slug>]`'), `the brief row's slash command: ${first[1]}`);
  assert.match(first[2], /no requirement document/i, 'the brief row does not say it is for a person with no requirement document');
  assert.match(first[2], /intake does not require it|intake[^.]*not require/i, 'the brief row does not say intake does not require it');
  const steps = [...first[3].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  assert.deepEqual(steps, ['branch spec', 'brief start', 'brief ask', 'brief answer', 'brief done', 'stage require brief'], 'the brief row\'s CLI steps');
  // The intake row still follows, unchanged in name.
  assert.ok(rows.slice(3).some((r) => cells(r)[0] === '1. Intake'), 'the Stages table lost its 1. Intake row');

  // The paragraph above the table names brief as an optional stage before intake.
  const above = stages.slice(0, stages.findIndex((l) => l.trim().startsWith('|'))).join(' ').replace(/\s+/g, ' ');
  const sentence = above.split(/(?<=[.!?])\s+(?=[A-Z`[])/).find((s) => s.includes('`brief`'));
  assert.ok(sentence, `the paragraph above the Stages table does not name \`brief\`: ${above}`);
  assert.match(sentence, /optional/i, `the sentence naming \`brief\` does not say it is optional: ${sentence}`);
  assert.match(sentence, /before `intake`/, `the sentence naming \`brief\` does not say it comes before \`intake\`: ${sentence}`);

  // The "Intake and spec" group names the brief pages.
  const lines = index.split('\n');
  const start = lines.findIndex((l) => l.trim() === '### Intake and spec');
  assert.ok(start >= 0, 'the index has no ### Intake and spec');
  const end = lines.findIndex((l, i) => i > start && /^#{1,3}\s/.test(l));
  const group = lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
  for (const page of ['commands/brief.md', 'slash/brief.md']) {
    assert.ok(group.includes(`](${page})`), `the Intake and spec group does not link ${page}`);
  }
});

// P8/S-61 (REQ-5.8, D-103, D-101): the lane rule has a page the index links, and both review pages
// say the independent round budget: one independent round, a second only after a blocker, and one
// more only when a person allows it.
test('the lane rule has a page and the review page names the independent round budget', () => {
  const page = (rel) => path.join(GUIDE, ...rel.split('/'));
  const read = (rel) => fs.readFileSync(page(rel), 'utf8').replace(/\r\n/g, '\n');

  assert.ok(fs.existsSync(page('rules/lane.md')), 'docs/guide/rules/lane.md is missing');
  const lane = read('rules/lane.md');
  assert.match(lane, /^# Check rule: lane$/m, lane);
  for (const part of ['lane: quick', 'src/', 'bin/', 'templates/', '## The failure it prevents']) {
    assert.ok(lane.includes(part), `rules/lane.md does not say ${part}`);
  }

  // The index's Check rules table links the page.
  const index = read('README.md');
  const start = index.indexOf('### Check rules');
  assert.ok(start >= 0, 'docs/guide/README.md has no Check rules heading');
  const next = index.indexOf('\n#', start + 1);
  const table = index.slice(start, next < 0 ? undefined : next);
  assert.ok(table.includes('](rules/lane.md)'), 'the Check rules table does not link rules/lane.md');

  // Both review pages name the independent round budget.
  for (const rel of ['commands/review.md', 'slash/review.md']) {
    const text = read(rel).replace(/\s+/g, ' ');
    assert.match(text, /second independent round/i, `${rel} does not name the second independent round`);
    assert.match(text, /blocker/i, `${rel} does not say a blocker opens the second round`);
    assert.match(text, /one more round/i, `${rel} does not say how a person allows one more round`);
  }
});
