// P6/S-52, review round 1 (REQ-3.2, REQ-3.13, REQ-3.14): one test per finding of the verdict
// P6-S-52-r1 on the pre-bash guard, H-1 to H-6.
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

// REQ-3.13: verdict P6-S-52-r1 H-1
test('a bracket expression with an escape, an equivalence class or a collating symbol is read as Bash reads it', () => {
  const { root, cleanup } = repo();
  try {
    for (const command of [
      'cat [[=d=]]ata/x.xml',
      'cat [[.d.]]ata/x.xml',
      'cat d[a\\]]ta/x.xml',
      'cat d[\\a]ta/x.xml',
      'cat d["a"]ta/x.xml',
      'cat data/[[=x=]].xml',
      'cat keys/pro[[.d.]].pem',
    ]) {
      const r = decide(root, command, { cfg: listed });
      assert.equal(decision(r), 'deny', command);
      assert.match(reasonOf(r), /agents\.denyPaths pattern (data\/\*\*|\*\*\/\*\.pem)/, `${command}: ${reasonOf(r)}`);
    }
    // A class the guard cannot read as Bash would: the word may match any listed path.
    for (const command of ['cat [[.hyphen.]]ata/x.xml', 'cat [![=s=]]ata/x.xml', 'cat [[=ab=]]ata/x.xml']) {
      const r = decide(root, command, { cfg: listed });
      assert.equal(decision(r), 'deny', command);
      assert.match(reasonOf(r), /REQ-3\.13/, `${command}: ${reasonOf(r)}`);
      assert.match(reasonOf(r), /cannot tell what/, `${command}: ${reasonOf(r)}`);
    }
    // The same forms on a path that is not listed are allowed, and with no list nothing is denied.
    for (const command of ['cat [[=s=]]rc/a.js', 'cat [[.s.]]rc/a.js', 'cat s[r\\]]c/a.js', 'cat src/[[=a=]].js', 'cat s[\\r]c/a.js']) {
      assert.equal(decision(decide(root, command, { cfg: listed })), 'allow', command);
    }
    for (const command of ['cat [[=d=]]ata/x.xml', 'cat [[.hyphen.]]ata/x.xml', 'cat d[a\\]]ta/x.xml']) {
      assert.equal(decision(decide(root, command)), 'allow', `${command} with no list`);
    }
  } finally {
    cleanup();
  }
});

// REQ-3.13: verdict P6-S-52-r1 H-2
test('a cd inside a brace group that is piped or put in the background does not last', () => {
  const { root, cleanup } = repo();
  try {
    for (const command of [
      '{ cd src; } | cat; cat data/x.xml',
      '{ cd src; } | cat && cat data/x.xml',
      '{ cd src; } & cat data/x.xml',
      '{ cd src; pwd; } | cat\ncat data/x.xml',
      '{ { cd src; }; } | cat; cat data/x.xml',
      // Inside the group the cd still holds.
      '{ cd src; cat ../data/x.xml; } | cat',
    ]) {
      const r = decide(root, command, { cfg: listed });
      assert.equal(decision(r), 'deny', command);
      assert.ok(reasonOf(r).includes('data/x.xml') && reasonOf(r).includes('agents.denyPaths pattern data/**'), `${command}: ${reasonOf(r)}`);
    }
    for (const command of [
      '{ cd src; } | cat; cat src/a.js',
      '{ cd src; cat a.js; } | cat',
      '{ cd src; } & ls',
      // A group that is not piped keeps its cd.
      '{ cd src; }; cat a.js',
      '{ cd src; } && cat ../src/a.js',
    ]) {
      assert.equal(decision(decide(root, command, { cfg: listed })), 'allow', command);
    }
    const kept = decide(root, '{ cd src; }; cat ../data/x.xml', { cfg: listed });
    assert.equal(decision(kept), 'deny', 'a group that is not piped keeps its cd');
    // The header no longer lists the form as a gap.
    const src = fs.readFileSync(new URL('../../src/hooks/pre-bash.js', import.meta.url), 'utf8');
    const header = src.slice(0, src.search(/^import /m));
    assert.doesNotMatch(header, /brace group that is piped[\s\S]{0,80}is taken to last/);
  } finally {
    cleanup();
  }
});

// REQ-3.14: verdict P6-S-52-r1 H-3
test('a fragment, a query string or a dot segment does not hide a host-rule path', () => {
  const { root, cleanup } = repo();
  try {
    const writes = [
      "gh api -X PUT 'https://api.github.com/repos/o/r/rulesets#x'",
      'gh api -X PUT repos/o/r/rulesets#x',
      'gh api -X POST "repos/o/r/rulesets?x=1#y"',
      'gh api --method DELETE https://ghe.example.com/api/v3/repos/o/r/branches/main/protection#x',
      'gh api repos/o/r/rules#frag -f name=x',
      "gh api 'https://api.github.com/repos/o/r/rulesets?per_page=1' --input r.json",
    ];
    for (const command of writes) {
      for (const agent of [undefined, 'a1']) {
        const r = decide(root, command, { agent });
        assert.equal(decision(r), 'deny', command);
        assert.match(reasonOf(r), /changes the git host's rules \(REQ-3\.14\)/, `${command}: ${reasonOf(r)}`);
      }
    }
    // A dot segment: what the host makes of the path is not known, so a write is not judged.
    const dotted = [
      'gh api -X PUT repos/o/r/issues/../rulesets/1',
      'gh api -X DELETE https://api.github.com/repos/o/r/./rulesets/1',
      'gh api -X PUT repos/o/r/issues/%2e%2e/rulesets/1',
      "gh api ./graphql -f query='query { viewer { login } }'",
      "gh api x/../graphql -f query='mutation { deleteBranchProtectionRule(input: {clientMutationId: \"x\"}) { clientMutationId } }'",
    ];
    for (const command of dotted) {
      for (const agent of [undefined, 'a1']) {
        const r = decide(root, command, { agent });
        assert.equal(decision(r), 'deny', command);
        assert.match(reasonOf(r), /cannot judge this command \(REQ-3\.14\)/, `${command}: ${reasonOf(r)}`);
        assert.match(reasonOf(r), /\. or \.\. segment/, `${command}: ${reasonOf(r)}`);
      }
    }
    for (const command of [
      'gh api repos/o/r/rulesets#x',
      'gh api -X GET "repos/o/r/rulesets?per_page=1#x"',
      'gh api -X GET repos/o/r/issues/../rulesets/1',
      'gh api -X POST repos/o/r/issues#rulesets',
      'gh api -X POST "repos/o/r/issues?next=/repos/o/r/rulesets"',
      'gh api repos/o/r/contents/a.b/c..d -f message=x',
    ]) {
      assert.equal(decision(decide(root, command)), 'allow', command);
    }
  } finally {
    cleanup();
  }
});

// REQ-3.14: verdict P6-S-52-r1 H-4
test('a GraphQL call is judged by the operation its query declares', () => {
  const { root, cleanup } = repo();
  try {
    const q = (text) => `gh api graphql -f query='${text}'`;
    for (const command of [
      q('query { repository(owner:"o",name:"mutation") { rulesets(first:1) { nodes { id } } } }'),
      q('{ repository(owner: "o", name: "r") { rulesets(first: 1) { nodes { id } } } }'),
      q('# a mutation would change this\nquery { repository(owner: "o", name: "r") { branchProtectionRules(first: 1) { nodes { id } } } }'),
      q('query mutationCount { repository(owner: "o", name: "r") { rulesets(first: 1) { totalCount } } }'),
      q('query { search(query: "mutation deleteBranchProtectionRule", type: ISSUE, first: 1) { issueCount } }'),
      q('mutation { addComment(input: {subjectId: "x", body: "see the ruleset"}) { clientMutationId } }'),
      q('mutation { addStar(input: {starrableId: "x"}) { clientMutationId } } # deleteRepositoryRuleset'),
    ]) {
      assert.equal(decision(decide(root, command)), 'allow', command);
    }
    for (const command of [
      q('mutation { deleteBranchProtectionRule(input: {clientMutationId: "query"}) { clientMutationId } }'),
      q('# query\nmutation M($id: ID!) { deleteRepositoryRuleset(input: {repositoryRulesetId: $id}) { clientMutationId } }'),
      q('query Q { viewer { login } } mutation M { updateRepositoryRuleset(input: {name: "x"}) { clientMutationId } }'),
      q('mutation { ...F } fragment F on Mutation { deleteBranchProtectionRule(input: {clientMutationId: "x"}) { clientMutationId } }'),
    ]) {
      const r = decide(root, command);
      assert.equal(decision(r), 'deny', command);
      assert.match(reasonOf(r), /changes the git host's rules \(REQ-3\.14\)/, `${command}: ${reasonOf(r)}`);
    }
    // A query text that is not a document the guard can read is not judged.
    for (const command of [
      q('mutation { deleteBranchProtectionRule(input: {clientMutationId: "x) { clientMutationId } }'),
      q('query { viewer { login }'),
      q('rulesets'),
      q(''),
    ]) {
      const r = decide(root, command);
      assert.equal(decision(r), 'deny', command);
      assert.match(reasonOf(r), /cannot judge this command \(REQ-3\.14\)/, `${command}: ${reasonOf(r)}`);
    }
  } finally {
    cleanup();
  }
});

// REQ-3.2: verdict P6-S-52-r1 H-5
test('a commit after a cd in a pipeline or in the background is denied with the cause in the reason', () => {
  const { root, cleanup } = repo();
  try {
    const piped = decide(root, 'cd src | cat; git commit -m x');
    assert.equal(decision(piped), 'deny');
    assert.match(reasonOf(piped), /cd src/);
    assert.match(reasonOf(piped), /pipeline/);
    assert.doesNotMatch(reasonOf(piped), /which branch src is on/);
    const tail = decide(root, 'cat src/a.js | cd src; git push');
    assert.equal(decision(tail), 'deny');
    assert.match(reasonOf(tail), /cd src/);
    assert.match(reasonOf(tail), /pipeline/);
    const background = decide(root, 'cd src & git commit -m x');
    assert.equal(decision(background), 'deny');
    assert.match(reasonOf(background), /cd src/);
    assert.match(reasonOf(background), /background/);
    assert.doesNotMatch(reasonOf(background), /pipeline/);
    // A cd on its own is followed as before, and a later literal cd settles the directory again.
    assert.equal(decision(decide(root, 'cd src && git commit -m x')), 'allow');
    assert.equal(decision(decide(root, `cd src | cat; cd "${root.replace(/\\/g, '/')}" && git commit -m x`)), 'allow');
    assert.equal(decision(decide(root, 'cd src | cat; git status')), 'allow');
    // Another unknown directory keeps its own reason.
    assert.equal(reasonOf(decide(root, 'cd $REPO && git commit -m x')), 'cannot tell which branch $REPO is on; run the command from inside the repository');
  } finally {
    cleanup();
  }
});

// REQ-3.2, REQ-3.3: verdict P6-S-52-r1 H-6
test('a git command that rewrites the work tree and names no path is denied while a test is frozen', () => {
  const FROZEN = 'test/a.test.js';
  const r = makeRepo({ branch: 'slice/P1-S-06-hooks', files: { [FROZEN]: 'x\n', 'test/other.js': 'y\n' } });
  const root = r.root;
  try {
    const writers = [
      'git checkout -f',
      'git checkout --force',
      'git checkout -f HEAD~1',
      'git -C . checkout -f',
      'git switch -f main',
      'git switch --discard-changes main',
      'git reset --hard',
      'git reset --hard HEAD~1',
      'git stash',
      'git stash -u',
      'git stash push',
      'git stash pop',
      'git stash apply',
      'git clean -fd',
      'git clean -fdx',
      'git clean -f test',
      'npm test && git checkout -f',
    ];
    const reads = [
      'git stash list',
      'git stash show -p',
      'git clean -n',
      'git clean --dry-run -d',
      'git clean -f src',
      'git stash push -- test/other.js',
      'git reset',
      'git reset --soft HEAD~1',
      'git reset HEAD test/other.js',
      'git status',
    ];
    // With no slice state, nothing is frozen and the commands pass.
    for (const command of writers) assert.equal(decision(decide(root, command)), 'allow', `${command} with nothing frozen`);
    const file = path.join(root, '.slicekit', 'state', 'P1-S-06.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ slice: 'P1/S-06', state: 'building', frozenTests: [FROZEN], unfrozen: [] }));
    for (const command of writers) {
      for (const agent of [undefined, 'a1']) {
        const out = decide(root, command, { agent });
        assert.equal(decision(out), 'deny', command);
        assert.ok(reasonOf(out).includes(FROZEN) && reasonOf(out).includes('P1/S-06'), `${command}: ${reasonOf(out)}`);
      }
    }
    for (const command of reads) assert.equal(decision(decide(root, command)), 'allow', command);
    // The header's Known gaps do not list a form the guard now sees.
    const src = fs.readFileSync(new URL('../../src/hooks/pre-bash.js', import.meta.url), 'utf8');
    const header = src.slice(0, src.search(/^import /m));
    const gaps = header.slice(header.indexOf('Known gaps of rule 0c'), header.indexOf('Known gaps of rule 0d'));
    for (const form of ['`git stash pop`', '`git reset --hard`', '`git clean`']) assert.ok(!gaps.includes(form), `${form} is still listed as a gap`);
    assert.match(header, /git checkout -f/);
  } finally {
    r.cleanup();
  }
});
