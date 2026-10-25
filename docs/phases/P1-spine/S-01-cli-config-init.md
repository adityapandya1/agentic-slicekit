---
slice: P1/S-01
name: CLI skeleton, config, init
repo: .
group: A1
runbook: no
requirements: [REQ-1.1, REQ-1.11, REQ-1.10, REQ-5.1, REQ-5.2, REQ-5.3]
decisions: [D-04, D-11, D-14, D-24, D-26, D-29]
---

## Done when

1. `node bin/slicekit.js init --shape backend --name demo` in an empty git repo creates every path of REQ-1.1 except `docs/phases/*`, `docs/releases/*`, the optional workspace file and the graph cache, and the adapter files (`.claude/` from S-02, the `.githooks/*` files from S-06, the CI workflow from S-08), and prints each created path.
2. The optional workspace file is `.slicekit/workspace.json`, which a program repository writes by hand. <!-- slicekit:example -->
3. The graph cache is `.slicekit/graph/`, written by the graph builder and never committed. <!-- slicekit:example -->
4. The CI workflow is `.github/workflows/slicekit.yml`. <!-- slicekit:pending P1/S-08 -->
5. Running it again creates nothing and prints each skipped path; a pre-existing `docs/README.md` is untouched. <!-- slicekit:example -->
6. `config.json` validates; an unknown shape or a non-string command is reported with the field name and exit 2.
7. `package.json` has no `dependencies`; `npm test` (`node --test "test/**/*.test.js"`) passes.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `init.test.js » creates the layout for shape backend` | happy | REQ-1.1 |
| `init.test.js » creates platform, observability and runbook with "Not yet known" sections` | happy | REQ-1.11 |
| `init.test.js » second run skips everything and overwrites nothing` | negative | REQ-1.1 |
| `init.test.js » init on a repo with no commits` | negative | REQ-1.1 |
| `config.test.js » rejects unknown shape with the field name` | negative | REQ-1.10 |
| `config.test.js » empty command strings are valid` | happy | REQ-1.1 |
| `markdown.test.js » parses CRLF` | negative | REQ-5.2 |
| `cli.test.js » unknown subcommand exits 2 with usage` | negative | REQ-5.1 |
| `package.test.js » no dependencies` | negative | REQ-5.3 |

## Expected changes

`package.json`, `bin/`, `src/cli/index.js`, `src/cli/init.js`, `src/config.js`, `src/paths.js`, `src/fs.js`, `src/git.js`, `src/ids.js`, `src/markdown.js`, `src/init.js`, `templates/docs/`, `templates/style.json`, `test/`.

## Tasks

### Task 1: Package, entry point, dispatch

**Files:** Create `package.json`, `bin/slicekit.js`, `src/cli/index.js`, `test/helpers/run-cli.js`, `test/cli.test.js`, `test/package.test.js`.

**Interfaces:**
- Produces `main(argv: string[], io: {cwd, stdout: (s)=>void, stderr: (s)=>void, stdin: ()=>Promise<string>, env}) → Promise<number>` in `src/cli/index.js`; a `COMMANDS` map `{name: {run(args, io), usage}}` that later tasks register into.
- Produces `runCli(args, {cwd, stdin?, env?}) → {code, stdout, stderr}` in `test/helpers/run-cli.js`, spawning `node bin/slicekit.js`.

- [ ] **Step 1: Write the failing tests**

```js
// test/cli.test.js
test('unknown subcommand exits 2 with usage', async () => {
  const r = runCli(['nope'], { cwd: os.tmpdir() });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /usage: slicekit <command>/);
});
test('--version prints package version', ...)  // exit 0, stdout matches /^0\.0\.1/
// test/package.test.js
test('no dependencies', () => { assert.equal(pkg.dependencies, undefined); assert.equal(pkg.type, 'module'); assert.equal(pkg.engines.node, '>=22'); });
```

- [ ] **Step 2: Run `npm test` — expect FAIL (no bin, no package)**
- [ ] **Step 3: Write `package.json`** — `name: slicekit`, `version: 0.0.1`, `bin: {slicekit: bin/slicekit.js}`, `type: module`, `engines: {node: ">=22"}`, `files: [bin, src, templates]`, `scripts: {test: "node --test \"test/**/*.test.js\""}`, `license: MIT`. Write `bin/slicekit.js` calling `main(process.argv.slice(2), io)` and `process.exit(code)`. Write `main` with the dispatch table, `--version`, `--help`, usage on stderr with exit 2.
- [ ] **Step 4: Run tests — expect PASS**
- [ ] **Step 5: Commit** `feat(cli): package and dispatch` with trailer `Slice: P1/S-01`.

### Task 2: Config

**Files:** Create `src/config.js`, `test/config.test.js`.

**Interfaces:**
- Produces `CONFIG_VERSION = 1`; `SHAPES = ['backend','fullstack','data']`; `defaultConfig({name, shape, docsRoot='docs', commands={}}) → cfg`; `validateConfig(cfg) → string[]` (empty = valid; each error `"<field>: <problem>"`); `loadConfig(root) → cfg` (throws `ConfigError` with the errors joined if invalid or missing); `compileDestructive(cfg) → RegExp[]` (every pattern with the `i` flag).
- The config shape (every key present after `defaultConfig`): `configVersion, name, shape, docsRoot, defaultBranch:'main', protectedBranches:['main'], commands:{test,lint,build,e2e} (strings, '' allowed), repos:[], gitHost:{kind:'github'}, tracker:{kind:'github-issues'}, review:{independent:'required'}, freezeTests:true, style:{banned:[…from templates/style.json]}, destructive:[regex strings], ci:{observabilitySteps:[]}`.

- [ ] **Step 1: Write failing tests** — `rejects unknown shape with the field name` (`validateConfig({...defaultConfig(...), shape:'mobile'})` includes `'shape: must be one of backend, fullstack, data'`); `empty command strings are valid`; `rejects non-string command` (`commands.test: 3` → `'commands.test: must be a string'`); `loadConfig throws ConfigError when file missing`; `defaultConfig seeds banned phrases from templates/style.json` (includes `'minting at the gate'`).
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement** `src/config.js` and `templates/style.json` (`{"banned": ["minting at the gate","at the boundary of","it's worth noting","robust","seamlessly","leverage","delve"]}`); default `destructive`: `["\\brm\\s+-rf\\s+(/|~|\\.\\.)", "\\bDROP\\s+(TABLE|DATABASE|SCHEMA)\\b", "\\bTRUNCATE\\b", "git\\s+push\\s+.*--force", "git\\s+reset\\s+--hard\\s+origin/"]`.
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit** `feat(config): schema, defaults, validation`.

### Task 3: Shared helpers: fs, paths, ids, git, markdown

**Files:** Create `src/fs.js`, `src/paths.js`, `src/ids.js`, `src/git.js`, `src/markdown.js`, `test/helpers/tmp-repo.js`, tests `test/fs.test.js`, `test/ids.test.js`, `test/git.test.js`, `test/markdown.test.js`.

**Interfaces:**
- `src/fs.js`: `readText(p) → string` (normalises CRLF to LF), `writeText(p, s)` (mkdir -p, write to `p + '.tmp-' + pid`, rename), `exists(p)`, `listFiles(dir, {ext?, ignore=['node_modules','.git']}) → string[]` (recursive, POSIX-separated relative paths).
- `src/paths.js`: `kitPaths(root, cfg) → {kit, config, state, baselines, journalDir, graph, workspace, docs, intake, decisions, spec, contracts, gaps, stack, platform, observability, runbook, phases, releases, build, claude, githooks, workflow, gitignore}` all absolute.
- `src/ids.js`: `ID = {req, decision, gap, contract, phase, slice, sliceAddr}` regexes (global, source strings reusable); `parseSliceAddr('P1/S-03') → {phase:1, slice:3, id:'P1/S-03'}`; `sliceFromBranch('slice/P1-S-03-x') → 'P1/S-03' | null`; `stateFileName('P1/S-03') → 'P1-S-03.json'`.
- `src/git.js`: `git(root, args: string[]) → string` (execFileSync, trims; throws `GitError` with stderr), `isRepo(root)`, `hasCommits(root)`, `currentBranch(root)`, `headSha(root)`, `changedFiles(root, base) → string[]`, `commitsOnBranch(root, base) → [{sha, subject, body, trailers:{}}]` using `git log --format=%H%x1f%s%x1f%b%x1e base..HEAD`.
- `src/markdown.js`: `lines(text) → string[]`, `headings(text) → [{level, text, line}]`, `frontMatter(text) → {data, body}` (key: value, `[a, b]` lists, `- item` lists, strings only), `tables(text) → [{line, header:[], rows:[[]]}]`, `refs(text) → [{kind:'path'|'id'|'anchor', value, line}]` (relative `.md` links, backticked paths containing `/`, every ID regex).
- `test/helpers/tmp-repo.js`: `makeRepo({commits=0, branch='main', files={}} = {}) → {root, cleanup()}` doing `git init -b main`, config user, optional commits.

- [ ] **Step 1: Write failing tests** — `fs » writeText is atomic` (no `.tmp-*` left, content LF); `fs » readText normalises CRLF`; `ids » sliceFromBranch` (3 cases incl. null); `git » hasCommits false on fresh repo`; `git » commitsOnBranch returns trailers` (`Slice: P1/S-01` parsed); `markdown » parses CRLF` (headings and front matter identical for `\r\n` input); `markdown » frontMatter parses lists`; `markdown » refs finds paths, ids and links`.
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement the five modules and the helper.**
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit** `feat(core): fs, paths, ids, git, markdown helpers`.

### Task 4: Templates and `init`

**Files:** Create `templates/docs/{decisions.md, platform.md, observability.md, runbook.md, BUILD.md, spec/00-overview.md, spec/gaps.md, spec/stack.md, intake/.keep, spec/contracts/.keep, phases/.keep, releases/.keep}`, `src/init.js`, `src/cli/init.js`, `test/init.test.js`.

**Interfaces:**
- Produces `init(root, {name, shape, docsRoot='docs', commands={}}) → {created: string[], updated: string[], skipped: string[], warnings: string[]}`; never overwrites; writes `.slicekit/config.json`, `.slicekit/baselines/references.json` and `style.json` as `{}` placeholders, empty `.slicekit/state/`, `.slicekit/journal/` absent until first session; adds `.slicekit/graph/` to `.gitignore` (append if missing); creates the empty `.githooks/` dir and does not touch `core.hooksPath` (S-06 sets it, with its guards). When `config.json` exists its `shape` and `docsRoot` are the truth; a disagreeing flag is a `ConfigError`. `warnings` is always present; outside a repo it holds `not a git repository`. <!-- slicekit:example -->
- CLI: `slicekit init --shape <s> [--name <n>] [--docs <dir>] [--test <cmd>] [--lint <cmd>] [--build <cmd>] [--e2e <cmd>]`; prompts for nothing when flags are given; with no `--shape` and no `config.json` exits 2 with usage; run from a subdirectory of a repository exits 2 naming the root; `--docs` is normalised to forward slashes without a trailing slash.
- Template placeholders: `{{name}}`, `{{docsRoot}}`, `{{date}}`; sections of REQ-1.11 each containing the single line `Not yet known`.

- [ ] **Step 1: Write failing tests** — `creates the layout for shape backend` (asserts every path from REQ-1.1 that P1 owns exists; `config.json` parses and `validateConfig` is empty); `creates platform, observability and runbook with "Not yet known" sections` (section headings from REQ-1.11 present, each followed by `Not yet known`); `second run skips everything and overwrites nothing` (pre-create `docs/README.md` with content X; after two runs content is X; second result `created` is empty and `skipped` lists the first run's files); `init on a repo with no commits` (fresh `git init`, no commits: succeeds, `core.hooksPath` is not set); `init outside a git repo` (succeeds, prints `not a git repository` to stderr); `writes gitignore rule once`. <!-- slicekit:example -->
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Write the templates and implement `init` and the CLI command.**
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit** `feat(init): layout, templates, config`.

### Task 5: Reserve the npm name (D-26)

- [ ] **Step 1:** `npm view slicekit name` — expect 404 (still free). If taken, stop and add a decision row.
- [ ] **Step 2:** From the slice branch, `npm publish --access public --dry-run`; confirm the file list is `bin/`, `src/`, `templates/`, `package.json`, `LICENSE`, `README.md`.
- [ ] **Step 3:** Ask the author to run `npm login` and `npm publish --access public` themselves (an account action; the kit's rules keep credentials out of agent sessions). Record the result in `docs/decisions.md` D-26's row.
