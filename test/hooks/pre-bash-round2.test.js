// P6/S-52, review round 2 (REQ-3.2, REQ-3.13, REQ-3.14): one test per finding of the verdict
// P6-S-52-r2 on the pre-bash guard: B-1, H-2, H-7 and H-8.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { handle } from '../../src/hooks/pre-bash.js';
import { defaultConfig } from '../../src/config.js';
import { makeRepo, commit } from '../helpers/tmp-repo.js';

const plain = defaultConfig({ name: 'demo', shape: 'backend' });
const listed = { ...plain, agents: { denyPaths: ['data/**', '**/*.pem'] } };
const decision = (r) => r.hookSpecificOutput?.permissionDecision ?? 'allow';
const reasonOf = (r) => r.hookSpecificOutput?.permissionDecisionReason ?? '';

function decide(root, command, { cfg = plain, agent } = {}) {
  const input = { session_id: 's', tool_name: 'Bash', tool_input: { command }, cwd: root };
  if (agent !== undefined) input.agent_id = agent;
  return handle(input, { root, cfg, env: {} });
}

function repo(branch = 'slice/P6-S-52-x') {
  const r = makeRepo({ branch, files: { 'data/x.xml': '<x/>', 'src/a.js': 'x', 'keys/prod.pem': 'k' } });
  execFileSync('git', ['add', '-A'], { cwd: r.root });
  commit(r.root, 'seed', { allowEmpty: false });
  return r;
}

// Each row: a word as it is typed, what `echo <word>` printed in Bash 5.2.26 (Git Bash, locale
// C.UTF-8, default shell options) in a directory holding data/x.xml, src/a.js and keys/prod.pem, and
// what the guard answers for `cat <word>` under the patterns data/** and **/*.pem:
//   deny    the word names a listed path, and the reason names the pattern;
//   unsure  the guard does not read the bracket expression to its end as Bash does, so the word is
//           refused as one it cannot judge;
//   allow   the word names no listed path;
//   either  allow or deny by platform: on Windows the guard matches letters without regard to case.
// A row whose second column names a listed path must be `deny` or `unsure`.
const r = String.raw;
const BRACKETS = [
  // A backslash as a member, escaped or quoted (the finding).
  [r`d[\\a]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d['\'a]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d["\\"a]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[\\-b]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[!\\]ta/x.xml`, 'data/x.xml', 'deny'],
  // Escaped and quoted members.
  [r`d[\a]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d["a"]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d['a']ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[\a\b]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d["ab"]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[a\]]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[\]a]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d["]"a]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[a\[]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[a"]"ta/x.xml`, 'd[a]ta/x.xml', 'allow'],
  [r`d\[a]ta/x.xml`, 'd[a]ta/x.xml', 'allow'],
  [r`d"[a]"ta/x.xml`, 'd[a]ta/x.xml', 'allow'],
  // `]` first, and `[` as a member.
  [r`d[]a]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[!]b]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[a]]ta/x.xml`, 'd[a]]ta/x.xml', 'allow'],
  [r`d[a[]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[[a]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[[]ta/x.xml`, 'd[[]ta/x.xml', 'allow'],
  [r`d[ata/x.xml`, 'd[ata/x.xml', 'allow'],
  // `!` and `^`.
  [r`d[^b]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[!b]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[!a]ta/x.xml`, 'd[!a]ta/x.xml', 'allow'],
  [r`d[\!a]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[\^a]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[\!b]ta/x.xml`, 'd[!b]ta/x.xml', 'allow'],
  [r`d[a!]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[a^]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[^!]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[!^]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[!!]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[^^a]ta/x.xml`, 'd[^^a]ta/x.xml', 'allow'],
  // Ranges.
  [r`d[a-c]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[\a-c]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[a-\c]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d["a"-"c"]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[a\-c]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[b\-c]ta/x.xml`, 'd[b-c]ta/x.xml', 'allow'],
  [r`d[a"-"c]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[b"-"c]ta/x.xml`, 'd[b-c]ta/x.xml', 'allow'],
  [r`d[a-]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[-a]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[--a]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[a--]ta/x.xml`, 'd[a--]ta/x.xml', 'allow'],
  [r`d[a-c-e]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[\]-a]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[a-\]]ta/x.xml`, 'd[a-]]ta/x.xml', 'allow'],
  [r`d[!\]-b]ta/x.xml`, 'd[!]-b]ta/x.xml', 'allow'],
  [r`keys/[p-p]rod.pem`, 'keys/prod.pem', 'deny'],
  // A reversed range is left out of the expression; its other members stay.
  [r`d[z-a]ta/x.xml`, 'd[z-a]ta/x.xml', 'allow'],
  [r`d[z-aa]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[az-a]ta/x.xml`, 'data/x.xml', 'deny'],
  // Named classes.
  [r`d[[:alpha:]]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[[:ascii:]]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[[:word:]]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[[:lower:][:digit:]]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[![:digit:]]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[![:alpha:]]ta/x.xml`, 'd[![:alpha:]]ta/x.xml', 'allow'],
  [r`d[[:alpha:]-z]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[[:digit:]-a]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[a[:]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[\[:alpha:]]ta/x.xml`, 'd[[:alpha:]]ta/x.xml', 'allow'],
  [r`d[[:alpha:]ta/x.xml`, 'd[[:alpha:]ta/x.xml', 'allow'],
  [r`d[[:bogus:]]ta/x.xml`, 'd[[:bogus:]]ta/x.xml', 'unsure'],
  [r`d[[:bogus:]a]ta/x.xml`, 'data/x.xml', 'unsure'],
  [r`d[[:al"p"ha:]]ta/x.xml`, 'data/x.xml', 'unsure'],
  [r`d[a-[:alpha:]]ta/x.xml`, 'd[a-[:alpha:]]ta/x.xml', 'unsure'],
  // Collating symbols.
  [r`d[[.a.]]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[[.a.]-c]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[_-[.a.]]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[%-[.a.]]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[[.-.]a]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[[.].]a]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`keys/pro[[.d.]].pem`, 'keys/prod.pem', 'deny'],
  [r`d[[.a.]ta/x.xml`, 'd[[.a.]ta/x.xml', 'allow'],
  [r`d[[.hyphen.]a]ta/x.xml`, 'data/x.xml', 'unsure'],
  [r`d[[."a".]]ta/x.xml`, 'd[[.a.]]ta/x.xml', 'unsure'],
  [r`d[a[.]ta/x.xml`, 'd[a[.]ta/x.xml', 'unsure'],
  // Equivalence classes.
  [r`d[[=a=]]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[[=a=]-c]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[a[=]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`d[[=a=]ta/x.xml`, 'd[[=a=]ta/x.xml', 'allow'],
  [r`d[![=b=]]ta/x.xml`, 'd[![=b=]]ta/x.xml', 'unsure'],
  [r`d[[=ab=]]ta/x.xml`, 'd[[=ab=]]ta/x.xml', 'unsure'],
  [r`d[a-[=c=]]ta/x.xml`, 'd[a-[=c=]]ta/x.xml', 'unsure'],
  // A bracket expression does not reach across a slash.
  [r`d[a/b]ta/x.xml`, 'd[a/b]ta/x.xml', 'allow'],
  [r`data[/]x.xml`, 'data[/]x.xml', 'allow'],
  [r`data[\/]x.xml`, 'data[/]x.xml', 'allow'],
  [r`dat[a\/]x.xml`, 'dat[a/]x.xml', 'allow'],
  // More than one expression, and one inside a brace expression.
  [r`d[a]t[a]/x.xml`, 'data/x.xml', 'deny'],
  [r`[d]ata/[x].xml`, 'data/x.xml', 'deny'],
  [r`keys/prod[.]pem`, 'keys/prod.pem', 'deny'],
  [r`keys/prod["."]pem`, 'keys/prod.pem', 'deny'],
  [r`d[{a,b}]ta/x.xml`, 'data/x.xml d[b]ta/x.xml', 'deny'],
  // Bash matches a glob with regard to case, on Windows too.
  [r`d[!A]ta/x.xml`, 'data/x.xml', 'deny'],
  [r`[!D]ata/x.xml`, 'data/x.xml', 'deny'],
  [r`[!d]ata/x.xml`, '[!d]ata/x.xml', 'allow'],
  [r`d[A]ta/x.xml`, 'd[A]ta/x.xml', 'either'],
  [r`D[a]ta/x.xml`, 'D[a]ta/x.xml', 'either'],
  [r`d[[:upper:]]ta/x.xml`, 'd[[:upper:]]ta/x.xml', 'either'],
];

// REQ-3.13: verdict P6-S-52-r2 B-1
test('a word with a bracket expression is denied when Bash expands it to a listed path or the guard cannot read it', () => {
  const { root, cleanup } = repo();
  try {
    assert.ok(BRACKETS.length >= 30, 'the table holds at least thirty words');
    const LISTED = new Set(['data/x.xml', 'keys/prod.pem']);
    for (const [word, bash, guard] of BRACKETS) {
      const command = `cat ${word}`;
      const out = decide(root, command, { cfg: listed });
      const expands = bash.split(' ').some((w) => LISTED.has(w));
      // The table itself: a word Bash expands to a listed path is never an allow.
      if (expands) assert.ok(guard === 'deny' || guard === 'unsure', `${word}: Bash gives ${bash}, the table says ${guard}`);
      if (expands) assert.equal(decision(out), 'deny', `${command}: Bash expands it to ${bash}`);
      if (guard === 'deny') {
        assert.equal(decision(out), 'deny', command);
        assert.match(reasonOf(out), /agents\.denyPaths pattern (data\/\*\*|\*\*\/\*\.pem)/, `${command}: ${reasonOf(out)}`);
      } else if (guard === 'unsure') {
        assert.equal(decision(out), 'deny', command);
        assert.match(reasonOf(out), /cannot tell what/, `${command}: ${reasonOf(out)}`);
        assert.match(reasonOf(out), /REQ-3\.13/, `${command}: ${reasonOf(out)}`);
      } else if (guard === 'allow') {
        assert.equal(decision(out), 'allow', `${command}: ${reasonOf(out)}`);
      }
      // With no list set, no word is refused.
      assert.equal(decision(decide(root, command)), 'allow', `${command} with no list`);
    }
    // The same forms on a path that is not listed are allowed.
    for (const word of [r`s[\\r]c/a.js`, r`s['\'r]c/a.js`, r`s[!\\]c/a.js`, r`s[z-ar]c/a.js`, r`s[[:ascii:]]c/a.js`, r`src/[\a].js`, r`s[!R]c/a.js`]) {
      assert.equal(decision(decide(root, `cat ${word}`, { cfg: listed })), 'allow', word);
    }
    // A word the guard cannot read is refused wherever it stands in the command.
    for (const command of [r`cat src/a.js > d[[.hyphen.]a]ta/x.xml`, r`cd src && cat ../d[[:bogus:]a]ta/x.xml`, r`grep -f d[a-[=c=]]ta/x.xml src/a.js`]) {
      const out = decide(root, command, { cfg: listed });
      assert.equal(decision(out), 'deny', command);
      assert.match(reasonOf(out), /REQ-3\.13/, `${command}: ${reasonOf(out)}`);
    }
  } finally {
    cleanup();
  }
  // A word that writes is read the same way: in a directory holding test/a.test.js and test/other.js,
  // Bash 5.2.26 expands each word of the first list to test/a.test.js and no word of the second to it.
  const FROZEN = 'test/a.test.js';
  const made = makeRepo({ branch: 'slice/P1-S-06-hooks', files: { [FROZEN]: 'x\n', 'test/other.js': 'y\n' } });
  try {
    const state = path.join(made.root, '.slicekit', 'state', 'P1-S-06.json');
    fs.mkdirSync(path.dirname(state), { recursive: true });
    fs.writeFileSync(state, JSON.stringify({ slice: 'P1/S-06', state: 'building', frozenTests: [FROZEN], unfrozen: [] }));
    for (const command of [r`rm test/[a\]].test.js`, r`rm test/[\!a].test.js`, r`echo x > test/["]"a].test.js`, r`cp test/other.js test/[\\a].test.js`, r`rm test/[[.hyphen.]a].test.js`]) {
      const out = decide(made.root, command);
      assert.equal(decision(out), 'deny', command);
      assert.ok(reasonOf(out).includes(FROZEN) && reasonOf(out).includes('P1/S-06'), `${command}: ${reasonOf(out)}`);
    }
    for (const command of [r`rm test/[b\]].test.js`, r`rm test/[\!o]ther.js`, r`echo x > test/["]"o]ther.js`]) {
      assert.equal(decision(decide(made.root, command)), 'allow', command);
    }
    // The header's Known gaps of rule 0c no longer list the quoted member.
    const src = fs.readFileSync(new URL('../../src/hooks/pre-bash.js', import.meta.url), 'utf8');
    const header = src.slice(0, src.search(/^import /m));
    const gaps = header.slice(header.indexOf('Known gaps of rule 0c'), header.indexOf('Known gaps of rule 0d'));
    assert.doesNotMatch(gaps, /quoted or escaped character/);
  } finally {
    made.cleanup();
  }
});

// REQ-3.13: verdict P6-S-52-r2 H-2
test('a brace group ends at its closing brace and redirections, whatever word it follows', () => {
  const { root, cleanup } = repo();
  try {
    // Bash 5.2.26 prints the starting directory after each of these groups: the group ran in a subshell.
    for (const group of [
      '{ cd src; } 2>&1 | cat',
      '{ cd src; } 2>&1 &',
      '{ cd src; } 2>&1 |& cat',
      '{ cd src; } >/dev/null 2>&1 | cat',
      '{ cd src; } 2>&1 >/dev/null | cat',
      '{ cd src; } >&2 | cat',
      '{ cd src; } &>/dev/null | cat',
      '{ cd src; } &> /dev/null &',
      '{ cd src; } <&0 | cat',
      'time { cd src; } | cat',
      'time -p { cd src; } | cat',
      'time { cd src; } 2>&1 | cat',
      'time { cd src; } &',
      '! { cd src; } 2>&1 | cat',
      '! time { cd src; } | cat',
      '{ time { cd src; }; } 2>&1 | cat',
      'coproc { cd src; }',
    ]) {
      const sep = group.endsWith('&') ? ' ' : '; ';
      const command = `${group}${sep}cat data/x.xml`;
      const out = decide(root, command, { cfg: listed });
      assert.equal(decision(out), 'deny', command);
      assert.ok(reasonOf(out).includes('data/x.xml') && reasonOf(out).includes('agents.denyPaths pattern data/**'), `${command}: ${reasonOf(out)}`);
      // The file that is not listed is read from the starting directory, and that is allowed.
      const other = `${group}${sep}cat src/a.js`;
      assert.equal(decision(decide(root, other, { cfg: listed })), 'allow', other);
    }
    // A group that is neither piped nor put in the background keeps its cd, redirected or timed.
    for (const group of ['{ cd src; } 2>&1', '{ cd src; } >/dev/null 2>&1', 'time { cd src; }', 'time -p { cd src; } 2>&1']) {
      const out = decide(root, `${group}; cat ../data/x.xml`, { cfg: listed });
      assert.equal(decision(out), 'deny', `${group}; cat ../data/x.xml`);
      assert.ok(reasonOf(out).includes('agents.denyPaths pattern data/**'), `${group}: ${reasonOf(out)}`);
      assert.equal(decision(decide(root, `${group}; cat a.js`, { cfg: listed })), 'allow', `${group}; cat a.js`);
      assert.equal(decision(decide(root, `${group} && cat ../src/a.js`, { cfg: listed })), 'allow', `${group} && cat ../src/a.js`);
    }
    // A simple command's redirection does not hide the pipe or the & either.
    for (const command of [
      'cd src 2>&1 | cat; cat data/x.xml',
      'cd src >/dev/null 2>&1 & cat data/x.xml',
      'cd src &>/dev/null | cat; cat data/x.xml',
      'cat src/a.js |& cd src; cat data/x.xml',
    ]) {
      const out = decide(root, command, { cfg: listed });
      assert.equal(decision(out), 'deny', command);
      assert.match(reasonOf(out), /cannot tell where cd src in a pipeline or in the background goes/, `${command}: ${reasonOf(out)}`);
    }
    assert.equal(decision(decide(root, 'cd src 2>&1 && cat a.js', { cfg: listed })), 'allow', 'cd src 2>&1 && cat a.js');
    assert.equal(decision(decide(root, 'cd src >/dev/null 2>&1; cat a.js', { cfg: listed })), 'allow', 'cd src >/dev/null 2>&1; cat a.js');
    // A group that ends a pipeline written with |& is one that ends a pipeline.
    const tail = decide(root, 'cat src/a.js |& { pwd; cd src; } 2>&1; cat data/x.xml', { cfg: listed });
    assert.equal(decision(tail), 'deny', 'a group after |&');
    assert.match(reasonOf(tail), /cannot tell where a cd in a brace group that ends a pipeline goes/, reasonOf(tail));
    // A closing brace with no group the guard saw open is not guessed at while a list is set.
    const stray = decide(root, 'cd src; } | cat; cat data/x.xml', { cfg: listed });
    assert.equal(decision(stray), 'deny', 'a closing brace with no opening one');
    assert.match(reasonOf(stray), /REQ-3\.13/, reasonOf(stray));
    assert.equal(decision(decide(root, '{ cd src; } 2>&1 | cat; cat data/x.xml')), 'allow', 'with no list');
  } finally {
    cleanup();
  }
});

// REQ-3.14: verdict P6-S-52-r2 H-7
test('a GraphQL comment ends at a carriage return, a line feed or both', () => {
  const { root, cleanup } = repo();
  try {
    const q = (text) => `gh api graphql -f query='${text}'`;
    const mutation = 'mutation M { deleteBranchProtectionRule(input: {clientMutationId: "x"}) { clientMutationId } }';
    for (const command of [
      q(`query Q { viewer { login } } # a comment\r${mutation}`),
      q(`query Q { viewer { login } } # a comment\r\n${mutation}`),
      q(`query Q { viewer { login } } # a comment\n${mutation}`),
      q(`# first\r# second\r${mutation}`),
      q(`query Q { viewer { login } } #\r${mutation} # the end\r`),
    ]) {
      for (const agent of [undefined, 'a1']) {
        const out = decide(root, command, { agent });
        assert.equal(decision(out), 'deny', JSON.stringify(command));
        assert.match(reasonOf(out), /gh api graphql mutation deleteBranchProtectionRule changes the git host's rules \(REQ-3\.14\)/, `${JSON.stringify(command)}: ${reasonOf(out)}`);
      }
    }
    // A comment that a carriage return ends leaves the query after it to be read.
    for (const command of [
      q('# deleteBranchProtectionRule is a mutation\rquery { viewer { login } }'),
      q('query { viewer { login } } # mutation deleteRepositoryRuleset\r'),
      q('query { viewer { login } }\r# mutation { deleteRepositoryRuleset }\r\nquery Q { viewer { login } }'),
      q('mutation { addStar(input: {starrableId: "x"}) { clientMutationId } } # deleteRepositoryRuleset\r'),
    ]) {
      assert.equal(decision(decide(root, command)), 'allow', JSON.stringify(command));
    }
    // A line terminator ends a string as well, so a string that holds one is not a document.
    for (const command of [
      q('query { search(query: "a\rmutation", type: ISSUE, first: 1) { issueCount } }'),
      q(`query { search(query: "a\r", type: ISSUE, first: 1) { issueCount } } ${mutation}`),
    ]) {
      const out = decide(root, command);
      assert.equal(decision(out), 'deny', JSON.stringify(command));
      assert.match(reasonOf(out), /(cannot judge this command|changes the git host's rules) \(REQ-3\.14\)/, `${JSON.stringify(command)}: ${reasonOf(out)}`);
    }
  } finally {
    cleanup();
  }
});

// REQ-3.2: verdict P6-S-52-r2 H-8
test('a long git option cut short is denied as an option the guard cannot judge', () => {
  const FROZEN = 'test/a.test.js';
  const made = makeRepo({ branch: 'slice/P1-S-06-hooks', files: { [FROZEN]: 'x\n', 'test/other.js': 'y\n' } });
  const root = made.root;
  try {
    // [command, the full option the reason names]
    const cut = [
      ['git checkout --forc', '--force'],
      ['git checkout --f HEAD~1', '--force'],
      ['git reset --har', '--hard'],
      ['git reset --h HEAD~1', '--hard'],
      ['git switch --discard main', '--discard-changes'],
      ['git switch --forc main', '--force'],
      [`git restore --staged --worktre ${FROZEN}`, '--worktree'],
      [`git restore --stag ${FROZEN}`, '--staged'],
      [`git restore --sourc=HEAD~1 ${FROZEN}`, '--source'],
      [`git rm --cach ${FROZEN}`, '--cached'],
      ['git clean --dry -f', '--dry-run'],
      ['git checkout --pathspec-from=list.txt', '--pathspec-from-file'],
      ['git -C . checkout --forc', '--force'],
      ['npm test && git reset --har', '--hard'],
      // The same reading holds for the options of the commit and push rules.
      ['git push --forc origin slice/P1-S-06-hooks', '--force'],
      ['git push --force-with origin slice/P1-S-06-hooks', '--force-with-lease'],
      ['git push --mirr origin', '--mirror'],
      ['git push --del origin main', '--delete'],
      ['git commit --al -m x', '--all'],
      ['git commit --mess x', '--message'],
      ['git add --upd', '--update'],
      // A prefix of more than one option: git refuses it as ambiguous, and so does the guard.
      ['git push --f origin slice/P1-S-06-hooks', '--force'],
      ['git restore --s test/other.js', '--staged'],
    ];
    const state = path.join(root, '.slicekit', 'state', 'P1-S-06.json');
    const judge = () => {
      for (const [command, full] of cut) {
        for (const agent of [undefined, 'a1']) {
          const out = decide(root, command, { agent });
          assert.equal(decision(out), 'deny', command);
          assert.match(reasonOf(out), /cannot judge this command \(REQ-3\.2\)/, `${command}: ${reasonOf(out)}`);
          assert.ok(reasonOf(out).includes(full), `${command}: ${reasonOf(out)}`);
        }
      }
    };
    // A command the guard cannot judge is refused in every session, with a test frozen or without.
    judge();
    fs.mkdirSync(path.dirname(state), { recursive: true });
    fs.writeFileSync(state, JSON.stringify({ slice: 'P1/S-06', state: 'building', frozenTests: [FROZEN], unfrozen: [] }));
    judge();
    // The full spelling is judged as before.
    for (const command of ['git checkout --force', 'git reset --hard', 'git switch --discard-changes main', `git restore --staged --worktree ${FROZEN}`, `git restore --source=HEAD~1 ${FROZEN}`]) {
      const out = decide(root, command);
      assert.equal(decision(out), 'deny', command);
      assert.ok(reasonOf(out).includes(FROZEN) && reasonOf(out).includes('P1/S-06'), `${command}: ${reasonOf(out)}`);
    }
    // An option that takes back the one that spares the work tree is read: the command writes it.
    for (const command of [`git restore --staged --no-staged ${FROZEN}`, 'git clean --dry-run --no-dry-run -f', `git rm --cached --no-cached ${FROZEN}`]) {
      const out = decide(root, command);
      assert.equal(decision(out), 'deny', command);
      assert.ok(reasonOf(out).includes(FROZEN), `${command}: ${reasonOf(out)}`);
    }
    // A cut option the guard has no rule on, a word that is a value or a path, and a full option.
    for (const command of [
      'git status --shor',
      'git log --onelin -3',
      'git diff --stat',
      'git diff -- --forc',
      'git commit -m "--forc"',
      'git commit --message=--har',
      'git commit --amend --no-edit',
      'git commit --allow-empty -m x',
      'git checkout -b --forc',
      `git restore --staged ${FROZEN}`,
      `git rm --cached ${FROZEN}`,
      'git clean --dry-run',
      'git push --dry-run origin slice/P1-S-06-hooks',
      'git push --set-upstream origin slice/P1-S-06-hooks',
      'git switch --create slice/P1-S-07-next',
      'git restore --source HEAD~1 test/other.js',
      'git stash list',
    ]) {
      assert.equal(decision(decide(root, command)), 'allow', `${command}: ${reasonOf(decide(root, command))}`);
    }
    const forced = decide(root, 'git push --force-with-lease origin slice/P1-S-06-hooks');
    assert.equal(reasonOf(forced), 'force push refused');
    // The header says how a cut option is read, and its Known gaps do not list the form.
    const src = fs.readFileSync(new URL('../../src/hooks/pre-bash.js', import.meta.url), 'utf8');
    const header = src.slice(0, src.search(/^import /m));
    assert.match(header.slice(0, header.indexOf('Known gaps')), /prefix of a long option/);
  } finally {
    made.cleanup();
  }
});
