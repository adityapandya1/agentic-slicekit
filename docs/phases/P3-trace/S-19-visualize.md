---
slice: P3/S-19
name: Visualize
repo: .
group: B
runbook: no
requirements: [REQ-4.7]
decisions: [D-04]
---

## Done when

1. `slicekit visualize --write <file>` writes one HTML file with the graph inlined as an `application/json` script block, one inline script, inline CSS and a Content-Security-Policy meta of `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:`; it prints the file's path and exits 0; the file references no `http:`, `https:` or protocol-relative URL except as an `<a href>` (REQ-4.7).
2. The page offers six views, each a `<section data-view="…">` filled by a view function of the page script from the inlined graph: `requirements` (the requirement tree), `board` (slices by state, in REQ-1.8's state order), `timeline` (slices by first commit date to merge date), `heat` (each file path with the number of slices that touched it, most first), `contracts` (each contract with its producer and consumer slices and their repositories) and `releases` (each release with its pull requests and requirements).
3. Clicking a node shows, in the detail panel, its files, commits and pull requests; a commit links to `<web>/commit/<sha>` when its repository node has `web`, a pull request to its `url`; links open in a new tab and nothing loads without a click.
4. `slicekit visualize [--port <n>]` serves that page at the root path and the graph at the path graph.json from `node:http` bound to 127.0.0.1 (any other path is 404), prints `http://127.0.0.1:<port>/`, opens nothing, and on Ctrl-C closes the server and exits 0; a port in use exits 1 with `port <n> is in use; pass --port`; with no graph built it exits 1 with S-17's `no graph at …; run slicekit graph` and serves nothing.
5. The kit's own test renders every view from the written file in a headless browser when one is found on the PATH, and otherwise checks the HTML and runs the page script's view functions under `node:vm` (REQ-4.7's Enforced by).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `visualize.test.js » the page written to disk carries the graph inlined and renders the six views` | happy | REQ-4.7 |
| `visualize.test.js » clicking a node shows its files, commits and pull requests with links to the git host` | happy | REQ-4.7 |
| `visualize.test.js » the page loads no external resource` | negative | REQ-4.7 |
| `visualize.test.js » a label holding a closing script tag stays inside the inlined graph` | negative | REQ-4.7 |
| `visualize.test.js » the server listens on 127.0.0.1 and serves the page and graph.json, and nothing else` | happy | REQ-4.7 |
| `visualize.test.js » with no graph built visualize says to run slicekit graph and starts nothing` | negative | REQ-4.7 |
| `visualize.test.js » a port in use is refused` | negative | REQ-4.7 |
| `visualize.test.js » a headless browser, when one is present, renders every view from the file on disk` | e2e | REQ-4.7 |

## Expected changes

`src/visualize/`, `src/cli/visualize.js`, `src/cli/index.js`, tests.

## Tasks

### Task 1: The page and its six views

**Files:** Create `src/visualize/page.js`, `src/visualize/client.js`, `src/cli/visualize.js`, `test/visualize.test.js`. Modify `src/cli/index.js`.

**Interfaces:**
- Consumes (S-17): `loadGraph`, `GraphError`; `graphRepo` from the graph fixture helper, with a contract, a release and two repositories' worth of nodes added in the test by writing a graph file directly where the builder cannot yet make them (workspace repositories are S-20's).
- In `client.js`, a classic script (no `import`, no `export`) that defines one global, `slicekitViews`: `requirements(graph)`, `board(graph)`, `timeline(graph)`, `heat(graph)`, `contracts(graph)`, `releases(graph)`, each `→ string` of HTML, and `detail(graph, id) → string`; every text it inserts goes through one `escapeHtml`. At its end, only when `document` exists, it reads the graph from `#graph`, fills each `section[data-view]`, wires the six nav buttons and a click handler on `[data-id]` that fills `#detail`.
- In `page.js`: `CSP` (the Done-when string); `inlineJson(graph) → string`, `JSON.stringify` with `<`, `>`, `&`, U+2028 and U+2029 written as `\u` escapes; `renderPage(graph) → string`: `<!doctype html>`, `<meta charset="utf-8">`, the CSP meta, `<title>slicekit graph</title>`, inline `<style>` (light and dark through `prefers-color-scheme`), a `<nav>` of six buttons, six empty `<section data-view>`, `<aside id="detail">`, `<script type="application/json" id="graph">` with `inlineJson(graph)`, and `<script>` holding `client.js`'s text, read once with `fs.readFileSync(new URL('./client.js', import.meta.url))`.
- CLI `visualize --write <file>`: loads the graph, writes `renderPage(graph)` to `<file>` (its directory must exist; else exit 1 `<dir> does not exist`), prints the path.

- [ ] **Step 1: Failing tests** — `the page written to disk carries the graph inlined and renders the six views`: `graph`, then `visualize --write <tmp>/page.html` → the `#graph` block parses to the graph file's content; running the page's second script in `vm.runInNewContext` (no `document`) gives `slicekitViews`, whose six functions on that graph each return HTML naming a node of their kind (`REQ-1.3`, `P1/S-01`, a file path, `C-1`, `P1`). `clicking a node shows its files, commits and pull requests with links to the git host`: `detail(graph, 'slice:P1/S-01')` holds `src/a.js`, a link `https://github.com/o/r/commit/<sha>` and the pull request's URL, each `<a>` with `target="_blank"` and `rel="noopener"`. `the page loads no external resource`: no `<link`, no `<script src`, no `@import`, no `url(` other than `data:`, and no `http:`, `https:` or `//` URL outside an `href` attribute; the CSP meta is present. `a label holding a closing script tag stays inside the inlined graph`: a slice named `</script><script>alert(1)</script>` → the page holds exactly two `<script` openings and the parsed `#graph` block keeps the name. <!-- slicekit:example -->
- [ ] **Step 2: Run** `node --test test/visualize.test.js` → FAIL.
- [ ] **Step 3: Implement**; register `visualize`.
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(visualize): one self-contained page, six views`.

### Task 2: The local server

**Files:** Create `src/visualize/server.js`. Modify `src/cli/visualize.js`, `test/visualize.test.js`.

**Interfaces:**
- In `server.js`: `startServer({html, graphJson, port = 0}) → Promise<{url, port, close}>`: `http.createServer` listening on `127.0.0.1`; `GET /` → 200 `text/html; charset=utf-8`; `GET /graph.json` → 200 `application/json`; anything else → 404; `EADDRINUSE` → rejects with `GraphError` code 1 `port <n> is in use; pass --port`.
- CLI `visualize [--port <n>]`: loads the graph (missing → S-17's refusal, exit 1, no server), starts the server, prints the URL, and on `SIGINT` closes the server and resolves 0. `--port` that is not an integer from 0 to 65535 → exit 2 with the usage. `--write` and `--port` together → exit 2.

- [ ] **Step 1: Failing tests** — `the server listens on 127.0.0.1 and serves the page and graph.json, and nothing else`: `startServer` with port 0 → `url` starts `http://127.0.0.1:`; `fetch(url)` 200 with the HTML; `fetch(url + 'graph.json')` 200 with the JSON; `fetch(url + 'x')` 404; after `close()` a fetch fails. `a port in use is refused`: a second `startServer` on the first one's port rejects with `port <n> is in use; pass --port`. `with no graph built visualize says to run slicekit graph and starts nothing`: the CLI in a repository with no graph exits 1 within five seconds with stderr naming `slicekit graph`.
- [ ] **Step 2: Run** `node --test test/visualize.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(visualize): serve the page on 127.0.0.1`.

### Task 3: A headless browser when one is present

**Files:** Modify `test/visualize.test.js`.

**Interfaces:**
- Consumes: `which` from `src/which.js`.
- The test looks for `chrome`, `google-chrome`, `chromium`, `chromium-browser` and `msedge` on the PATH and skips with `t.skip('no headless browser on the PATH')` when none is found. Found, it runs `<browser> --headless=new --disable-gpu --no-first-run --dump-dom <file URL of page.html>` with a 60-second timeout and no network flag needed, since the page loads nothing.

- [ ] **Step 1: Failing test** — `a headless browser, when one is present, renders every view from the file on disk`: the dumped DOM has six `data-view` sections, each holding at least one element with a `data-id` attribute.
- [ ] **Step 2: Run** `node --test test/visualize.test.js` → PASS where Task 1 is right (the CI runners of GitHub carry Chrome, so it runs there); FAIL shows a view the script did not fill.
- [ ] **Step 3: Run** `npm test` and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 4: Commit** `test(visualize): every view renders in a headless browser when one is present`.
