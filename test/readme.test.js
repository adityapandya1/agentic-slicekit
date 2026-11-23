// S-25: the README's shape (REQ-5.7) and its scope line (REQ-4.8).
// P6/S-55 (D-98): the README opens with the banner, the one line, the badges, Why and a session
// transcript; the status, the scope line, the hooks and how the kit is built follow in <details>
// blocks, and the walkthrough is docs/walkthrough.md.
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

// The summaries of the README's <details> blocks, in order.
const summaries = () => [...readme.matchAll(/^<summary>(.*)<\/summary>$/gm)].map((m) => m[1].trim());

// The text of the <details> block whose <summary> is `name`, up to its </details>.
function details(name) {
  const lines = readme.split('\n');
  const start = lines.findIndex((l) => l.trim() === `<summary>${name}</summary>`);
  assert.ok(start >= 0, `no <details> block "${name}"`);
  const end = lines.findIndex((l, i) => i > start && l.trim() === '</details>');
  assert.ok(end > start, `the <details> block "${name}" is not closed`);
  return lines.slice(start + 1, end).join('\n');
}

// The `## Walkthrough` section of docs/walkthrough.md.
function walkthroughSection() {
  const lines = fs.readFileSync(new URL('../docs/walkthrough.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((l) => l.trim() === '## Walkthrough');
  assert.ok(start >= 0, 'docs/walkthrough.md has no ## Walkthrough');
  const end = lines.findIndex((l, i) => i > start && /^##?\s/.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

test('the README sections come in the order of D-98, with the status, scope, hooks and build in <details> blocks', () => {
  assert.deepEqual(headings(), ['Why', 'See it in action', 'What it covers', 'Quick start', 'How it differs', 'Docs']);
  assert.deepEqual(summaries(), ['Status: preview', 'Scope', 'How the hooks find slicekit', 'Built with itself']);
  // Every <details> block comes after the Docs section.
  assert.ok(readme.indexOf('<details>') > readme.indexOf('## Docs'), 'a <details> block comes before ## Docs');
  assert.equal((readme.match(/^<details>$/gm) ?? []).length, (readme.match(/^<\/details>$/gm) ?? []).length);
  const status = details('Status: preview');
  assert.match(status, /Phases 1 to 5 work/);
  assert.match(status, /Phase 4/);
  assert.match(status, /git clone https:\/\/github\.com\/adityapandya1\/agentic-slicekit/);
  assert.match(status, /node bin\/slicekit\.js --version/);
  assert.match(details('Built with itself'), /built with itself/);
  assert.match(readme.trimEnd(), /\nLicense: MIT\.$/);
  // No internal shorthand a newcomer cannot read: decision numbers, hook names. The transcript's
  // code block shows what intake prints, decision IDs included.
  assert.doesNotMatch(outsideCode(readme).join('\n'), /\bD-\d+\b/);
  assert.doesNotMatch(readme, /on every stop/);
});

test('the scope line says the kit parses no source code and names graphify', () => {
  const scope = details('Scope');
  assert.match(scope, /does not parse (your )?source code/);
  assert.match(scope, /https:\/\/github\.com\/Graphify-Labs\/graphify/);
  assert.match(scope, /```sh\npip install graphifyy && graphify install\n```/);
  // The one line that runs both in one Claude Code session.
  assert.match(scope, /`\/graphify [^`]*`[^\n]*`\/slicekit [^`]*`/);
});

// S-25 whole-branch review: what a newcomer needs after the walkthrough and from the hooks section.
test('the walkthrough cleans up after itself, and the hooks section points a clone at --cli', () => {
  const walk = walkthroughSection();
  assert.match(walk, /^cd "\$KIT"$/m);
  assert.match(walk, /^rm -rf "\$WORK"$/m);
  const unset = walk.split('\n').find((l) => l.startsWith('unset ')) ?? '';
  for (const v of ['SLICEKIT_GITHOST_FIXTURE', 'SLICEKIT_TRACKER_FIXTURE', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0']) {
    assert.ok(unset.split(/\s+/).includes(v), v);
  }
  // The independent verdict is round 2, while `rounds: 1 of 2` counts only the in-loop rounds.
  assert.match(walk, /rounds: 1 of 2/);
  const hooks = details('How the hooks find slicekit');
  assert.match(hooks, /--cli/);
  assert.match(hooks, /clone/);
  // The local install comes first, the clone second.
  const install = 'npm install --save-dev slicekit';
  assert.ok(hooks.indexOf(install) >= 0 && hooks.indexOf(install) < hooks.indexOf('clone'), hooks);
});

test('Quick start gives the npm install and the status says the walkthrough runs from a clone', () => {
  const quick = section('Quick start');
  assert.match(quick, /```sh\nnpm install --save-dev slicekit\nnpx slicekit init --shape backend --name <your-project>\n```/);
  assert.match(quick, /`\/slicekit intake [^`]*`/);
  const link = /\]\((https:\/\/github\.com\/adityapandya1\/agentic-slicekit\/blob\/main\/)?docs\/walkthrough\.md\)/;
  assert.match(quick, link, 'Quick start does not link docs/walkthrough.md');
  assert.match(section('Docs'), link, 'Docs does not link docs/walkthrough.md');
  const status = details('Status: preview');
  assert.match(status, /0\.1\.1/);
  assert.match(status, /walkthrough[^.]*clone/i);
  assert.match(status, /examples\/walkthrough/);
});

// P3/S-35: 0.2.0 ships Phase 3, and the install is spelled out in full wherever the README gives it.
test("the status names Phase 3's commands and the install uses --save-dev", () => {
  const status = details('Status: preview');
  const prose = status.replace(/\s+/g, ' ');
  assert.match(prose, /Phases 1 to 5 work/);
  for (const c of ['graph', 'trace', 'impact', 'history', 'uncovered', 'shipped', 'visualize']) assert.ok(status.includes(`\`${c}\``), c);
  assert.match(prose, /workspaces/);
  assert.match(prose, /Phase 5 is /);
  assert.doesNotMatch(prose, /not built yet/);
  assert.doesNotMatch(prose, /Phase 3 will add|Phases 3 and 4 are not built/);
  assert.match(section('Quick start'), /```sh\nnpm install --save-dev slicekit\n/);
  assert.match(details('How the hooks find slicekit'), /`npm install --save-dev slicekit`/);
  assert.doesNotMatch(readme, /npm i -D/);
});

test('the status section names no placeholder and no release still to come', () => {
  const status = details('Status: preview');
  assert.doesNotMatch(status, /placeholder/);
  assert.doesNotMatch(status, /first\s+real\s+release/);
  assert.doesNotMatch(status, /0\.0\.1/);
});

// P3/S-17, REQ-4.8: the graph exists now; the scope line says what it is built from and what it is not.
test('the scope line says the graph is built from IDs and git and is not a code graph', () => {
  const scope = details('Scope').replace(/\s+/g, ' ');
  assert.match(scope, /graph is built from (its|the kit's) own IDs and (from )?git/);
  assert.match(scope, /not a code graph/);
  assert.doesNotMatch(scope, /coming in Phase 3|will be built|will infer/);
  assert.match(scope, /https:\/\/github\.com\/Graphify-Labs\/graphify/);
  assert.match(details('Scope'), /```sh\npip install graphifyy && graphify install\n```/);
});

// P4/S-44 (REQ-5.8, D-75): the exit path for a second agent tool names every hook subcommand the
// Claude Code renderer registers, with the event that calls it.
test('docs/adapters.md names every hook subcommand in its exit path', () => {
  const adapters = fs.readFileSync(new URL('../docs/adapters.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const hooks = JSON.parse(fs.readFileSync(new URL('../templates/claude-code/hooks.json', import.meta.url), 'utf8'));
  const lines = adapters.split('\n');
  const start = lines.findIndex((l) => /^##\s/.test(l) && /exit path/i.test(l));
  assert.ok(start >= 0, 'docs/adapters.md has no ## heading naming the exit path');
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  const exit = lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
  const pairs = [];
  for (const [event, groups] of Object.entries(hooks)) {
    for (const g of groups) {
      for (const h of g.hooks) {
        const m = /\bhook\s+([a-z-]+)/.exec(h.command);
        if (m) pairs.push({ event, name: m[1] });
      }
    }
  }
  assert.ok(pairs.length >= 7, `hooks.json registers ${pairs.length} hook subcommands`);
  for (const { event, name } of pairs) {
    assert.ok(exit.includes(`hook ${name}`), `the exit path does not name hook ${name}`);
    assert.ok(exit.includes(event), `the exit path does not name the event ${event} for hook ${name}`);
  }
  assert.match(exit, /deny/i, 'the exit path names the deny rules');
  assert.match(exit, /tool-neutral/i, 'the exit path names the parts already tool-neutral');
  assert.match(adapters, /^##\s.*Jira/m, 'docs/adapters.md has a Jira section');
});

// P5/S-24 (REQ-5.7, REQ-5.8, D-41, D-61): all five phases are built, versions are published from CI
// with provenance, and the README links the user guide. P6/S-55: the links are in Docs, which also
// links the walkthrough, the runbook and the changelog.
test('the status names Phase 5 as built and links the guide', () => {
  const status = details('Status: preview');
  const prose = status.replace(/\s+/g, ' ');
  assert.match(prose, /Phases 1 to 5 work/);
  assert.doesNotMatch(prose, /not built yet|will add|still to come/);
  // Phase 5's commands, each named as code.
  assert.match(prose, /Phase 5 is /);
  for (const c of ['release', 'ops', 'audit']) assert.ok(status.includes(`\`${c}\``), c);
  // Versions come from CI, not from the author's machine, and carry provenance.
  assert.match(prose, /published from CI/);
  assert.match(prose, /provenance/);
  assert.doesNotMatch(prose, /published by hand/);

  // Docs links the guide and each of the kit's other documents.
  const guide = section('Docs');
  const link = (file) => new RegExp(`\\]\\((https://github\\.com/adityapandya1/agentic-slicekit/blob/main/)?${file.replace(/[.]/g, '\\.')}\\)`);
  assert.match(guide, link('docs/guide/README.md'));
  assert.match(guide, link('docs/adapters.md'));
  for (const file of ['docs/walkthrough.md', 'docs/runbook.md', 'CHANGELOG.md']) assert.match(guide, link(file), file);
  // What the guide holds: a page per command, per slash command and per check rule.
  const about = guide.replace(/\s+/g, ' ');
  assert.match(about, /command/);
  assert.match(about, /check rule/);
});

// P6/S-54 (REQ-5.8, issue #113): the row of docs/adapters.md for the command files names every
// template under templates/claude-code/commands/, `audit` and the bare `/slicekit` command included.
// A template the row leaves out is named.
test('docs/adapters.md names every slash command template in its commands row', () => {
  const adapters = fs.readFileSync(new URL('../docs/adapters.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const rows = adapters.split('\n').filter((l) => l.trim().startsWith('|') && l.includes('`templates/claude-code/commands/`'));
  assert.equal(rows.length, 1, `docs/adapters.md has ${rows.length} table rows naming templates/claude-code/commands/`);
  const row = rows[0];

  const templates = fs.readdirSync(new URL('../templates/claude-code/commands/', import.meta.url)).filter((f) => f.endsWith('.md')).sort();
  assert.ok(templates.length >= 10 && templates.includes('slicekit.md') && templates.includes('slicekit-audit.md'), templates.join(' '));

  // `slicekit-<stage>.md` is named by its stage as a word; `slicekit.md` by the bare `/slicekit`, which
  // the file pattern `.claude/commands/slicekit*.md` in the row's first cell does not count as.
  const named = (file) => {
    const stage = /^slicekit-([a-z-]+)\.md$/.exec(file);
    if (stage) return new RegExp(`(^|[^a-z-])${stage[1]}([^a-z-]|$)`).test(row);
    if (file === 'slicekit.md') return /(^|[^\w/.-])\/slicekit(?![\w*-])/.test(row);
    return row.includes(file);
  };
  const leftOut = templates.filter((file) => !named(file));
  assert.deepEqual(leftOut, [], 'the commands row of docs/adapters.md leaves out these templates');
});

// ---- P6/S-55 (REQ-5.7, D-98): the front page ----

const ONE_LINE = 'A closed-loop framework for spec-driven development with coding agents.';
const BANNER = 'docs/assets/slicekit-banner.png';
const GRAPH_QUERIES = ['trace', 'impact', 'history', 'uncovered', 'shipped'];

// Lines with their ends trimmed, blank lines and lone <p>/<div> wrapper tags left out.
const WRAPPER = /^<\/?(p|div)(\s[^>]*)?>$/i;
const nonBlank = (lines) => lines.map((l) => l.trim()).filter((l) => l !== '' && !WRAPPER.test(l));

// The text of the README before `## Quick start`: what a reader sees before any install step.
function opening(text) {
  const lines = text.split('\n');
  const end = lines.findIndex((l) => l.trim() === '## Quick start');
  return end < 0 ? null : lines.slice(0, end).join('\n');
}

// Why the README's opening breaks D-98: a version, a count of slices, tests or phases, or a list of
// phases. [] when it holds none.
function openingProblems(text) {
  const open = opening(text);
  if (open === null) return ['the README has no ## Quick start'];
  const problems = [];
  const version = /\b\d+\.\d+\.\d+\b/.exec(open);
  if (version) problems.push(`a version number: ${version[0]}`);
  const count = /\b(\d+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty)\s+(slices?|tests?|phases?)\b/i.exec(open);
  if (count) problems.push(`a count: ${count[0]}`);
  const phase = /\bPhases?\s+(\d+|one|two|three|four|five|six)\b/i.exec(open);
  if (phase) problems.push(`a list of phases: ${phase[0]}`);
  return problems;
}

test('the README opens with the banner, the one line, the badges and Why, and the banner file exists', () => {
  // The banner is a PNG in the repository.
  const banner = new URL(`../${BANNER}`, import.meta.url);
  assert.ok(fs.existsSync(banner), `${BANNER} does not exist`);
  assert.deepEqual([...fs.readFileSync(banner).subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${BANNER} is not a PNG`);

  const lines = readme.split('\n');
  const whyAt = lines.findIndex((l) => l.trim() === '## Why');
  assert.ok(whyAt >= 0, 'the README has no ## Why');
  const top = nonBlank(lines.slice(0, whyAt));
  assert.ok(top.length >= 3, top.join('\n'));
  // First the banner image.
  const file = BANNER.replace(/[.]/g, '\\.');
  const image = new RegExp(`(!\\[[^\\]]*\\]\\((\\./)?${file}\\))|(<img\\s[^>]*src="(\\./)?${file}")`);
  assert.match(top[0], image, 'the README does not open with the banner image');
  // Then the one line.
  assert.equal(top[1], ONE_LINE, 'the line after the banner');
  // Then the three badges, and nothing else before ## Why.
  const badges = top.slice(2).join('\n');
  const images = badges.match(/!\[|<img\s/g) ?? [];
  assert.equal(images.length, 3, `between the line and ## Why: ${badges}`);
  assert.match(badges, /img\.shields\.io\/npm\/v\/slicekit|badge\.fury\.io\/js\/slicekit/, 'no npm version badge');
  assert.match(
    badges,
    /github\.com\/adityapandya1\/agentic-slicekit\/actions\/workflows\/[\w.-]+\.ya?ml\/badge\.svg|img\.shields\.io\/github\/actions\/workflow\/status\/adityapandya1\/agentic-slicekit/,
    'no CI workflow badge',
  );
  assert.match(badges, /img\.shields\.io\/(badge\/licen[sc]e-MIT|npm\/l\/slicekit|github\/license\/adityapandya1\/agentic-slicekit)/i, 'no MIT license badge');
  for (const l of top.slice(2)) assert.match(l, /^(\[!\[|!\[|<a\s|<img\s)/, `not a badge: ${l}`);

  // Why: at most five lines, on prompts and rule files the agent can skip against the checks outside it.
  const why = nonBlank(section('Why').split('\n'));
  assert.ok(why.length >= 1 && why.length <= 5, `## Why has ${why.length} lines`);
  const prose = why.join(' ');
  for (const word of [/prompts?/i, /rule files?/i, /\bCLI\b/, /\bhooks\b/i, /\bCI\b/]) assert.match(prose, word);
});

test("the README's opening holds no version number, no count and no list of phases", () => {
  const clean = ['![slicekit](docs/assets/slicekit-banner.png)', '', ONE_LINE, '', '## Why', '', 'It checks each step.', '', '## Quick start', '', 'npm install 0.6.0'].join('\n');
  assert.deepEqual(openingProblems(clean), [], 'a version after ## Quick start is not in the opening');
  const withIt = (line) => clean.replace('It checks each step.', line);
  assert.deepEqual(openingProblems(withIt('Version 0.6.0 is out.')), ['a version number: 0.6.0']);
  assert.deepEqual(openingProblems(withIt('It was built in 55 slices.')), ['a count: 55 slices']);
  assert.deepEqual(openingProblems(withIt('It has 1200 tests.')), ['a count: 1200 tests']);
  assert.deepEqual(openingProblems(withIt('It took five phases.')), ['a count: five phases']);
  assert.deepEqual(openingProblems(withIt('Phase 3 is the graph.')), ['a list of phases: Phase 3']);
  assert.deepEqual(openingProblems(withIt('Phases 1 to 5 work.')), ['a list of phases: Phases 1']);
  assert.deepEqual(openingProblems(clean.replace('## Quick start', '## Install')), ['the README has no ## Quick start']);

  assert.deepEqual(openingProblems(readme), [], 'the README opening');
});

// A transcript line as the reader reads it: no leading space or tree marker, inner runs of spaces as one.
const norm = (l) => l.replace(/^[\s⎿│]+/, '').replace(/\s+/g, ' ').trim();
// A slash command typed in the transcript, after an optional prompt marker; null for any other line.
const typed = (l) => /^\s*(?:[>$❯]\s*)?(\/slicekit\b.*)$/.exec(l)?.[1].trim() ?? null;

// The fenced blocks of a markdown text: [{lang, lines}].
function codeBlocks(text) {
  const blocks = [];
  let cur = null;
  for (const l of text.split('\n')) {
    if (cur === null) {
      const m = /^\s*(`{3,}|~{3,})\s*([\w-]*)/.exec(l);
      if (m) cur = { fence: m[1], lang: m[2].toLowerCase(), lines: [] };
    } else if (l.trim().startsWith(cur.fence) && l.trim().replace(/[`~]/g, '') === '') {
      blocks.push({ lang: cur.lang, lines: cur.lines });
      cur = null;
    } else {
      cur.lines.push(l);
    }
  }
  return blocks;
}

test('See it in action comes before Quick start, and each build output line is one the walkthrough prints', () => {
  const names = headings();
  assert.ok(names.includes('See it in action'), `no ## See it in action: ${names.join(' | ')}`);
  assert.equal(names.indexOf('See it in action'), names.indexOf('Why') + 1, names.join(' | '));
  assert.ok(names.indexOf('See it in action') < names.indexOf('Quick start'), names.join(' | '));

  const blocks = codeBlocks(section('See it in action'));
  assert.equal(blocks.length, 1, `See it in action holds ${blocks.length} code blocks`);
  const [block] = blocks;
  assert.equal(block.lang, 'text');
  assert.ok(block.lines.length <= 40, `the transcript has ${block.lines.length} lines`);

  // The six slash commands, in order.
  const commands = block.lines.map(typed).filter((c) => c !== null);
  const order = ['/slicekit intake', '/slicekit specify', '/slicekit plan', '/slicekit build P1/S-01', '/slicekit review', '/slicekit release'];
  let at = -1;
  for (const c of order) {
    const i = commands.findIndex((x, j) => j > at && (x === c || x.startsWith(`${c} `)));
    assert.ok(i > at, `the transcript does not run ${c} in order: ${commands.join(' | ')}`);
    at = i;
  }

  // The output of the build step: its lines up to the next slash command.
  const start = block.lines.findIndex((l) => typed(l)?.startsWith('/slicekit build P1/S-01'));
  const rest = block.lines.slice(start + 1);
  const stop = rest.findIndex((l) => typed(l) !== null);
  const output = rest.slice(0, stop < 0 ? undefined : stop).map(norm).filter((l) => l !== '');
  assert.ok(output.length >= 1, 'the build step shows no output');

  // The lines the walkthrough prints, as docs/walkthrough.md records them in its ```text blocks.
  const walkFile = new URL('../docs/walkthrough.md', import.meta.url);
  assert.ok(fs.existsSync(walkFile), 'docs/walkthrough.md does not exist');
  const walk = fs.readFileSync(walkFile, 'utf8').replace(/\r\n/g, '\n');
  const printed = new Set(codeBlocks(walk).filter((b) => b.lang === 'text').flatMap((b) => b.lines.map(norm)).filter((l) => l !== ''));
  assert.ok(printed.size > 0, 'docs/walkthrough.md records no output in a ```text block');
  const unknown = output.filter((l) => !printed.has(l));
  assert.deepEqual(unknown, [], 'build output lines the walkthrough does not print');
});

// The slash command a template under templates/claude-code/commands/ gives: `/slicekit` for
// slicekit.md, `/slicekit <stage>` for slicekit-<stage>.md.
const slashOf = (file) => (file === 'slicekit.md' ? '/slicekit' : `/slicekit ${/^slicekit-([a-z-]+)\.md$/.exec(file)[1]}`);

// The templates and graph queries the README's "What it covers" table leaves out, and a header that
// is not stage, command and what you get. A stage command counts as `/slicekit <stage>` or
// `/slicekit-<stage>`; the bare `/slicekit` counts only where no stage follows it.
function coversMissing(text, templates) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === '## What it covers');
  if (start < 0) return ['the README has no ## What it covers'];
  const end = lines.findIndex((l, i) => i > start && /^##?\s/.test(l));
  const rows = lines.slice(start + 1, end < 0 ? undefined : end).filter((l) => l.trim().startsWith('|'));
  if (rows.length < 3) return ['## What it covers has no table'];
  const head = rows[0].split('|').map((c) => c.trim()).filter(Boolean);
  const missing = [];
  if (!(head.length === 3 && /stage/i.test(head[0]) && /command/i.test(head[1]) && /get/i.test(head[2]))) missing.push(`table header: ${rows[0].trim()}`);
  const table = rows.slice(2).join('\n');
  for (const file of templates) {
    const found =
      file === 'slicekit.md'
        ? /\/slicekit(?![\w-]|[ \t]+[a-z])/.test(table)
        : new RegExp(`/slicekit[ -]${slashOf(file).slice('/slicekit '.length)}(?![\\w-])`).test(table);
    if (!found) missing.push(file);
  }
  for (const q of GRAPH_QUERIES) if (!new RegExp(`(^|[^\\w-])${q}([^\\w-]|$)`).test(table)) missing.push(q);
  return missing;
}

test('What it covers names every command template and the graph queries', () => {
  const templates = fs.readdirSync(new URL('../templates/claude-code/commands/', import.meta.url)).filter((f) => f.endsWith('.md')).sort();
  assert.ok(templates.length >= 10 && templates.includes('slicekit.md'), templates.join(' '));

  // An in-memory README with a row per template and one for the graph queries.
  const row = (file) => `| stage | \`${slashOf(file)}\` | what it gives |`;
  const queries = `| graph | ${GRAPH_QUERIES.map((q) => `\`slicekit ${q}\``).join(', ')} | answers |`;
  const page = (files, q = queries) => ['# Kit', '', '## What it covers', '', '| Stage | Command | What you get |', '|---|---|---|', ...files.map(row), q, '', '## Quick start', ''].join('\n');
  assert.deepEqual(coversMissing(page(templates), templates), []);
  // One template left out is named; `/slicekit build` does not count as the bare `/slicekit`.
  assert.deepEqual(coversMissing(page(templates.filter((f) => f !== 'slicekit-gaps.md')), templates), ['slicekit-gaps.md']);
  assert.deepEqual(coversMissing(page(templates.filter((f) => f !== 'slicekit.md')), templates), ['slicekit.md']);
  assert.deepEqual(coversMissing(page(templates, queries.replace(', `slicekit shipped`', '')), templates), ['shipped']);

  assert.deepEqual(coversMissing(readme, templates), [], 'the README leaves out of What it covers');
});

// P7/S-57 (REQ-5.7, D-98, D-99): after the Quick start's first slash command, one sentence says that a
// person with only an idea types `/slicekit brief` first and then the intake command it prints.
test('Quick start names /slicekit brief for a person with only an idea', () => {
  const prose = outsideCode(section('Quick start')).join(' ').replace(/\s+/g, ' ').trim();
  const sentences = prose.split(/(?<=[.!?])\s+(?=[A-Z`[(])/);
  const firstSlash = sentences.findIndex((s) => /`\/slicekit[ -]?[a-z-]*[^`]*`/.test(s));
  assert.ok(firstSlash >= 0, `Quick start names no slash command: ${prose}`);
  assert.match(sentences[firstSlash], /`\/slicekit intake [^`]*`/, 'the first slash command of Quick start is no longer /slicekit intake');
  const briefs = sentences.map((s, i) => (s.includes('`/slicekit brief`') ? i : -1)).filter((i) => i >= 0);
  assert.equal(briefs.length, 1, `Quick start names \`/slicekit brief\` in ${briefs.length} sentences, not one`);
  const at = briefs[0];
  assert.ok(at > firstSlash, 'the sentence naming /slicekit brief comes before the first slash command');
  const s = sentences[at];
  assert.match(s, /only an idea/i, `the sentence does not say it is for a person with only an idea: ${s}`);
  assert.match(s, /first/i, `the sentence does not say /slicekit brief comes first: ${s}`);
  assert.match(s, /intake/i, `the sentence does not name the intake command: ${s}`);
  assert.match(s, /prints/i, `the sentence does not say the intake command is the one brief prints: ${s}`);
});

// P8/S-62 (REQ-5.7, D-98, issue #195): "Built with itself" says every change to src/, bin/ and
// templates/ went through a slice, and that test files have also changed in spec pull requests,
// naming #94 as the one case so far; the claim that every change to the code went through a slice
// is gone.
test('Built with itself names the test changes made in spec pull requests', () => {
  const text = details('Built with itself').replace(/\s+/g, ' ');
  assert.doesNotMatch(text, /each change to its code goes through a slice/i, 'Built with itself still says each change to the code goes through a slice');
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z`[(])/);
  const slices = sentences.find((s) => s.includes('`src/`') && s.includes('`bin/`') && s.includes('`templates/`'));
  assert.ok(slices, `Built with itself names no sentence with \`src/\`, \`bin/\` and \`templates/\`: ${text}`);
  assert.match(slices, /slice/i, `the sentence naming src/, bin/ and templates/ does not say they went through a slice: ${slices}`);
  assert.match(slices, /every|each/i, `the sentence naming src/, bin/ and templates/ does not say every change: ${slices}`);
  const tests = sentences.find((s) => /test files?/i.test(s) && /spec pull requests?/i.test(s));
  assert.ok(tests, `Built with itself does not say test files changed in spec pull requests: ${text}`);
  assert.match(tests, /#94(?!\d)/, `the sentence on spec pull requests does not name #94: ${tests}`);
  assert.match(tests, /one case|only case/i, `the sentence on spec pull requests does not say #94 is the one case so far: ${tests}`);
});
