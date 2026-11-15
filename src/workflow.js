// The GitHub Actions workflow init writes (REQ-3.11): a gate, a job per declared team command, a job
// per observability step of config and of observability.md (D-20, D-56), the ready label and the post-merge state sync (D-12), which opens a
// [sync] pull request and starts the workflow on its branch with workflow_dispatch (D-78, D-80). The YAML is
// generated as text; every free-text value goes through yamlScalar so a quote, colon or hash in a
// team's command cannot change the document's structure.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError, DEFAULT_RUNS_ON, DEFAULT_TIMEOUT_MINUTES, GITHUB_EXPRESSION, LINE_SEPARATOR, MATRIX_OS, shardErrors, shardRunnerErrors } from './config.js';
import { readText } from './fs.js';
import { allSteps, docSteps } from './observability.js';
import { kitPaths } from './paths.js';
import { substitute } from './render/entry.js';

export const WORKFLOW_TEMPLATE = fileURLToPath(new URL('../templates/workflow/slicekit.yml', import.meta.url));
export const PINS_PATH = fileURLToPath(new URL('../templates/workflow/pins.json', import.meta.url));
// Where the workflow lands in a repository, relative to its root.
export const WORKFLOW_PATH = '.github/workflows/slicekit.yml';
export const WORKFLOW_DRIFT = `${WORKFLOW_PATH} differs from the generator; run slicekit workflow --write to regenerate it`;

const ACTIONS = { checkout: 'actions/checkout', setupNode: 'actions/setup-node', uploadArtifact: 'actions/upload-artifact', cache: 'actions/cache', setupJava: 'actions/setup-java' };
const COMMAND_ORDER = ['test', 'lint', 'build', 'e2e'];
const SHA = /^[0-9a-f]{40}$/;
const TAG = /^v\d+\.\d+\.\d+$/;
const BLOCK_KEYS = ['gateExtraSteps', 'commandJobs', 'observabilityJobs'];
// Filled as written: values the kit computes or validates to a safe shape.
const VALUE_KEYS = [
  'checksOk', 'defaultBranchItem', 'readyNeeds', 'runsOn', 'timeoutMinutes',
  ...Object.keys(ACTIONS).flatMap((k) => [`${k}Sha`, `${k}Tag`]),
];
// The team's own text: a mapping value holding one is filled, then quoted as a whole.
const FREE_TEXT_KEYS = ['cli', 'defaultBranch'];

// REQ-5.3 for the kit's own repository: fails naming each non-empty field that installs a package
// with the kit (devDependencies are allowed) and its entries. `bundleDependencies: true` bundles all.
const DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies', 'bundleDependencies', 'bundledDependencies', 'peerDependencies'];
const NO_DEPENDENCIES = [
  '      - name: No runtime dependencies (REQ-5.3)',
  '        run: |',
  `          node -e "const p = require('./package.json'); const bad = [${DEPENDENCY_FIELDS.map((f) => `'${f}'`).join(', ')}].flatMap((f) => { const v = p[f]; const n = v === true ? ['true'] : Array.isArray(v) ? v : Object.keys(v || {}); return n.length ? [f + ': ' + n.join(', ')] : []; }); if (bad.length) { console.error('package.json has runtime dependencies: ' + bad.join('; ')); process.exit(1) }"`,
];

// D-67: the runner of every job, ci.runsOn (a label or a list of labels), default ubuntu-latest.
// A label inside a flow sequence: quoted when a comma or bracket would end it.
const flowItem = (label) => {
  const out = yamlScalar(label);
  return out.startsWith("'") || !/[,[\]]/.test(out) ? out : `'${label.replace(/'/g, "''")}'`;
};
export function runsOnValue(runsOn) {
  if (runsOn === undefined) return DEFAULT_RUNS_ON;
  return Array.isArray(runsOn) ? `[${runsOn.map(flowItem).join(', ')}]` : yamlScalar(runsOn);
}

// D-69, D-85: a repository is a Java repository when it holds a Maven or Gradle build file at its root
// or a declared command calls mvn, gradle or ./gradlew. The cache is the build tool of the one build
// file present; with both or neither, the tool the first command calling one names (Maven when none does).
export const DEFAULT_JAVA = 25;
const BUILD_FILES = { 'pom.xml': 'maven', 'build.gradle': 'gradle', 'build.gradle.kts': 'gradle' };
// The tool counts only where a shell runs it: as the first word of a simple command. The command is
// split at line breaks and at ; & | ( ) outside quotes, and each part into words as a shell splits
// them (shellCommands below); in each part, NAME=value assignments and the wrapper words
// below (with the flags after them) and shell keywords such as then or do are skipped; a flag of a
// wrapper that takes a value (sudo -u runner, nice -n 10, env -u FOO) has that value skipped with it,
// so the value is never read as the command (issue #136); a shell started with a flag holding c (sh -c,
// bash -lc) has its script read the same way. A mention such as echo "mvn test" or rg 'gradle' docs
// is an argument, not a call.
const JAVA_TOOLS = { mvn: 'maven', gradle: 'gradle', './gradlew': 'gradle' };
// Each wrapper word, with its options that take a value in the next word: the letters of the short
// ones and the names of the long ones. `--user=runner` and `-urunner` hold their value themselves.
const WRAPPER_VALUES = {
  env: { short: 'uC', long: ['unset', 'chdir'] },
  time: { short: 'fo', long: ['format', 'output'] },
  nice: { short: 'n', long: ['adjustment'] },
  nohup: { short: '', long: [] },
  exec: { short: 'a', long: [] },
  command: { short: '', long: [] },
  sudo: { short: 'CDghpRrTtUu', long: ['close-from', 'chdir', 'group', 'host', 'prompt', 'chroot', 'role', 'command-timeout', 'type', 'other-user', 'user'] },
  'xvfb-run': { short: 'efnpsw', long: ['error-file', 'auth-file', 'server-num', 'xauth-protocol', 'server-args', 'wait'] },
};
const WRAPPERS = new Set(Object.keys(WRAPPER_VALUES));
// Whether the flag `word` of `wrapper` takes its value from the next word. In a cluster of short
// flags the first one that takes a value ends the flags: what follows it in the word is its value.
function takesNextWord(wrapper, word) {
  const { short, long } = WRAPPER_VALUES[wrapper];
  if (word.startsWith('--')) return long.includes(word.slice(2));
  const at = [...word.slice(1)].findIndex((c) => short.includes(c));
  return at !== -1 && at === word.length - 2;
}
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash']);
// Shell keywords that open a command position: if ...; then mvn verify; fi.
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{']);
// The simple commands of a shell command, each a list of words, read as a shell splits them (review H-1
// of round 1 of P6/S-51): a word ends at unquoted white space; a line break or one of ; & | ( ) ends a
// command only outside quotes; '...' is taken as written, "..." with a backslash before $, a backtick,
// " or \ read as an escape, and a backslash outside quotes takes the next character as written (before
// a line break it joins the two lines). Each word is { value, lead, known }: lead is the unquoted
// text the word starts with, which is what makes it an assignment or a keyword.
// Two cases cannot be split with certainty:
// - an unclosed quote: the quoted text runs to the end of the command, as a shell reads on for the
//   closing quote, so no word after the quote is read as a command;
// - a command substitution, $(...) or a pair of backticks: its output is not known, so the word that
//   holds it has known false and is never read as a tool, a wrapper, a keyword or a shell, though it
//   is still one word; the command inside it is read as a command of its own, since the shell runs it.
function shellCommands(command) {
  const commands = [];
  const script = (s, start, inSubstitution) => {
    let words = [];
    let word = null;
    let depth = 0;
    let i = start;
    const open = () => { word ??= { value: '', lead: '', known: true, quoted: false }; return word; };
    const add = (text, quoted) => {
      const w = open();
      if (quoted) w.quoted = true;
      else if (!w.quoted) w.lead += text;
      w.value += text;
    };
    const endWord = () => { if (word) { words.push({ value: word.value, lead: word.lead, known: word.known }); word = null; } };
    const endCommand = () => { endWord(); if (words.length > 0) commands.push(words); words = []; };
    // A substitution starting at s[i]: reads its commands, marks the word, and returns the index after it.
    const substitution = () => {
      const w = open();
      w.known = false;
      w.quoted = true;
      if (s[i] === '$') return script(s, i + 2, true);
      let inner = '';
      let k = i + 1;
      while (k < s.length && s[k] !== '`') {
        if (s[k] === '\\' && k + 1 < s.length) k += 1;
        inner += s[k];
        k += 1;
      }
      script(inner, 0, false);
      return k + 1;
    };
    while (i < s.length) {
      const c = s[i];
      if (c === '\\') {
        if (s[i + 1] === '\n') { i += 2; continue; }
        if (i + 1 < s.length) add(s[i + 1], true);
        i += 2;
      } else if (c === "'") {
        const close = s.indexOf("'", i + 1);
        add(s.slice(i + 1, close === -1 ? s.length : close), true);
        i = close === -1 ? s.length : close + 1;
      } else if (c === '"') {
        add('', true);
        i += 1;
        while (i < s.length && s[i] !== '"') {
          if (s[i] === '\\' && '$`"\\\n'.includes(s[i + 1] ?? ' ')) { if (s[i + 1] !== '\n') add(s[i + 1], true); i += 2; }
          else if ((s[i] === '$' && s[i + 1] === '(') || s[i] === '`') i = substitution();
          else { add(s[i], true); i += 1; }
        }
        i += 1;
      } else if ((c === '$' && s[i + 1] === '(') || c === '`') {
        i = substitution();
      } else if (c === '\n' || ';&|()'.includes(c)) {
        endCommand();
        i += 1;
        if (c === '(') depth += 1;
        else if (c === ')') {
          if (depth > 0) depth -= 1;
          else if (inSubstitution) return i;
        }
      } else if (/\s/.test(c)) {
        endWord();
        i += 1;
      } else {
        add(c, false);
        i += 1;
      }
    }
    endCommand();
    return i;
  };
  script(String(command), 0, false);
  return commands;
}
function toolCalled(command) {
  for (const words of shellCommands(command)) {
    const is = (w, set) => w.known && set.has(w.value);
    let i = 0;
    while (i < words.length) {
      const word = words[i];
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word.lead) || (word.lead === word.value && is(word, KEYWORDS))) { i += 1; continue; }
      if (is(word, WRAPPERS)) {
        i += 1;
        while (i < words.length && words[i].value.startsWith('-')) i += words[i].known && takesNextWord(word.value, words[i].value) ? 2 : 1;
        continue;
      }
      break;
    }
    if (i >= words.length) continue;
    const first = words[i];
    if (!first.known) continue;
    if (JAVA_TOOLS[first.value]) return JAVA_TOOLS[first.value];
    if (SHELLS.has(first.value)) {
      const flag = words.findIndex((w, k) => k > i && /^-[A-Za-z]*c[A-Za-z]*$/.test(w.value));
      if (flag !== -1 && flag + 1 < words.length) {
        const inner = toolCalled(words[flag + 1].value);
        if (inner) return inner;
      }
    }
  }
  return null;
}
// A root build file counts only when the CI checkout holds it too: in a git repository, a file git
// tracks or would add (a gitignored pom.xml is absent from the checkout, as for the cache below).
function hasBuildFile(root, file, tracked) {
  if (!fs.existsSync(path.join(root, file))) return false;
  return tracked === null || tracked.includes(file);
}
export function javaBuildTool(root, commands) {
  const tracked = root ? trackedFiles(root) : null;
  const fromFiles = new Set(root ? Object.entries(BUILD_FILES).filter(([f]) => hasBuildFile(root, f, tracked)).map(([, t]) => t) : []);
  if (fromFiles.size === 1) return [...fromFiles][0];
  const call = commands.map(toolCalled).find(Boolean);
  if (call) return call;
  return fromFiles.size > 0 ? 'maven' : null;
}

// setup-java fails a job whose cache matches no file, so the cache is set only when the checkout holds
// a file the tool's cache keys on: pom.xml at any depth for Maven; for Gradle a build, settings or
// wrapper file or versions.properties at any depth, or a *.versions.toml in the gradle folder directly
// under the checkout root (the action's pattern gradle/*.versions.toml is root-only). In a git
// repository only the files git tracks or would add count (git ls-files --cached --others
// --exclude-standard), so a gitignored file the CI checkout lacks turns no cache on; a file not yet
// committed counts, as init runs before the first commit. Outside a git repository, or when git
// fails, the folder is walked.
const CACHE_SKIP = new Set(['.git', 'node_modules', '.worktrees']);
// name is the file's basename, dir its parent folder relative to root with / separators ('' at the root).
const CACHE_FILE = {
  maven: (name) => name === 'pom.xml',
  gradle: (name, dir) => /\.gradle/.test(name) || name === 'gradle-wrapper.properties' || name === 'versions.properties'
    || (dir === 'gradle' && name.endsWith('.versions.toml')),
};
function trackedFiles(root) {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
    return out.split('\0').filter(Boolean);
  } catch { return null; }
}
const parentDir = (p) => { const d = path.posix.dirname(p); return d === '.' ? '' : d; };
export function hasCacheFile(root, tool) {
  const match = CACHE_FILE[tool];
  if (!root || !match) return false;
  const tracked = trackedFiles(root);
  if (tracked) return tracked.some((p) => match(path.posix.basename(p), parentDir(p)));
  const dirs = [root];
  while (dirs.length > 0) {
    const dir = dirs.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory()) { if (!CACHE_SKIP.has(e.name)) dirs.push(path.join(dir, e.name)); }
      else if (match(e.name, path.relative(root, dir).split(path.sep).join('/'))) return true;
    }
  }
  return false;
}

function setupJavaSteps(v, java, tool, root) {
  if (!tool) return [];
  return [
    `      - uses: actions/setup-java@${v.setupJavaSha} # ${v.setupJavaTag}`,
    '        with:',
    '          distribution: temurin',
    `          java-version: ${yamlScalar(String(java))}`,
    ...(hasCacheFile(root, tool) ? [`          cache: ${tool}`] : []),
  ];
}

export function loadPins() {
  return JSON.parse(fs.readFileSync(PINS_PATH, 'utf8'));
}

const RESERVED = /^(true|false|yes|no|on|off|null|~|y|n)$/i;

// One YAML scalar for value at a mapping key indented by indent spaces: plain when that is safe, a `|`
// block when it spans lines, otherwise single-quoted (a ' inside is doubled). A carriage return is a
// line break; the separators YAML also breaks on (U+0085, U+2028, U+2029) are refused.
export function yamlScalar(value, indent = 0) {
  if (LINE_SEPARATOR.test(value)) throw new Error('yaml: value contains a line separator YAML cannot carry');
  value = value.replace(/\r\n?/g, '\n');
  if (value.includes('\n')) {
    const lines = value.replace(/\n+$/, '').split('\n');
    const pad = ' '.repeat(indent + 2);
    // YAML takes the indentation from the first non-empty line, so a leading space there needs the indicator.
    const first = lines.find((l) => l !== '') ?? '';
    const indicator = first.startsWith(' ') ? '|2' : '|';
    return [indicator, ...lines.map((l) => (l === '' ? '' : pad + l))].join('\n');
  }
  const unsafe =
    value === '' ||
    /[:#{}*\t]/.test(value) ||
    value !== value.trim() ||
    /^[-?,[\]&!|>'"%@`]/.test(value) ||
    RESERVED.test(value) ||
    /^[-+]?\.(inf|nan)$/i.test(value) ||
    /^[-+]?\.?\d/.test(value);
  return unsafe ? `'${value.replace(/'/g, "''")}'` : value;
}

function checkPins(pins) {
  const vars = {};
  for (const [key, action] of Object.entries(ACTIONS)) {
    const pin = pins?.[action];
    if (!pin || !SHA.test(pin.sha) || !TAG.test(pin.tag)) throw new Error(`pins: ${action} needs a 40-hex sha and a vX.Y.Z tag`);
    vars[`${key}Sha`] = pin.sha;
    vars[`${key}Tag`] = pin.tag;
  }
  return vars;
}

// Checkout (no token kept), Node 22 and npm ci (only when a lockfile exists): the head of every generated job.
function setupSteps(v) {
  return [
    `      - uses: actions/checkout@${v.checkoutSha} # ${v.checkoutTag}`,
    '        with:',
    '          persist-credentials: false',
    `      - uses: actions/setup-node@${v.setupNodeSha} # ${v.setupNodeTag}`,
    '        with:',
    '          node-version: 22',
    '      - name: Install',
    "        if: hashFiles('package-lock.json') != ''",
    '        run: npm ci',
  ];
}

function runStep(name, run, env) {
  const lines = [`      - name: ${yamlScalar(name, 8)}`];
  const vars = Object.entries(env ?? {});
  if (vars.length > 0) {
    lines.push('        env:');
    for (const [k, val] of vars) lines.push(`          ${k}: ${yamlScalar(val, 10)}`);
  }
  lines.push(`        run: ${yamlScalar(run, 8)}`);
  return lines;
}

// The gate's decision (D-49): a push of only bookkeeping skips the team command jobs. A gate that
// failed before deciding leaves the output empty, which reads as code, so the tests still run.
const BOOKKEEPING = "needs.gate.outputs.kind == 'bookkeeping'";
const COMMAND_IF = '    if: ${{ !cancelled() && !(' + BOOKKEEPING + ') }}';

// One job per declared team command, run on `systems`. `shards` (the test command only, D-49) maps a
// system to its shard count; each shard sets SLICEKIT_SHARD to <k>/<n>, 1/1 on a system not split.
function commandJob(name, command, v, systems, timeout, shards, jdk) {
  const strategy = ['    strategy:', '      fail-fast: false', '      matrix:'];
  let head;
  let env = [];
  if (shards) {
    const include = systems.flatMap((os) => {
      const n = shards[os] ?? 1;
      return Array.from({ length: n }, (_x, i) => [`          - os: ${os}`, `            shard: ${yamlScalar(`${i + 1}/${n}`)}`]).flat();
    });
    head = [...strategy, '        include:', ...include, '    runs-on: ${{ matrix.os }}'];
    env = ['        env:', '          SLICEKIT_SHARD: ${{ matrix.shard }}'];
  } else if (systems.length > 1) {
    head = [...strategy, `        os: [${systems.join(', ')}]`, '    runs-on: ${{ matrix.os }}'];
  } else {
    head = [`    runs-on: ${systems[0]}`];
  }
  const [stepName, ...rest] = runStep(name, command);
  return ['', `  cmd-${name}:`, '    needs: [gate]', COMMAND_IF, ...head, `    timeout-minutes: ${timeout}`, '    steps:', ...setupSteps(v), ...jdk, stepName, ...env, ...rest];
}

// SLICEKIT_CHECKS_OK for the checks job, which ready-label reads through its result: the gate and every observability job succeeded, and each team
// command job succeeded or was skipped because the gate said bookkeeping. A job that failed, was
// cancelled or was skipped for any other reason is not passed.
function checksOk(commands, steps) {
  const passed = (id) => `needs.${id}.result == 'success'`;
  const parts = [
    "!contains(needs.*.result, 'failure')",
    "!contains(needs.*.result, 'cancelled')",
    passed('gate'),
    ...commands.map((c) => `(${passed(`cmd-${c}`)} || (needs.cmd-${c}.result == 'skipped' && ${BOOKKEEPING}))`),
    ...steps.map((_s, i) => passed(`obs-${i + 1}`)),
  ];
  return '${{ ' + parts.join(' && ') + ' }}';
}

function observabilityJob(n, step, v, timeout, runsOn) {
  return ['', `  obs-${n}:`, `    name: ${yamlScalar(step.name, 4)}`, `    runs-on: ${runsOn}`, `    timeout-minutes: ${timeout}`, '    steps:', ...setupSteps(v), ...runStep(step.name, step.run, step.env)];
}

// One pass over the value, so text inside cli is never itself read as a placeholder.
function fillFreeText(line, vars) {
  if (!FREE_TEXT_KEYS.some((k) => line.includes(`{{${k}}}`))) return line;
  const m = /^(\s*(?:- )?[A-Za-z_-]+: )(.*)$/.exec(line);
  if (!m) throw new Error(`workflow template: a free-text placeholder outside a mapping value: ${line}`);
  return m[1] + yamlScalar(substitute(m[2], vars, FREE_TEXT_KEYS));
}

// `steps` are the observability steps to render, one obs-<n> job each in that order: config's own when
// the caller passes none; workflowState passes config's followed by those of observability.md (D-56).
export function renderWorkflow(cfg, pins = loadPins(), { template = fs.readFileSync(WORKFLOW_TEMPLATE, 'utf8'), root = null, steps = cfg.ci?.observabilitySteps ?? [] } = {}) {
  if (/[\r\n]/.test(cfg.cli)) throw new Error('cli: must be one line to render the workflow');
  const v = checkPins(pins);
  const matrix = cfg.ci?.matrix === true;
  const timeout = cfg.ci?.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 360) throw new Error('ci.timeoutMinutes: must be an integer from 1 to 360');
  const shardProblems = shardErrors(cfg.ci?.shards);
  if (shardProblems.length > 0) throw new Error(shardProblems.join('; '));
  const runnerProblems = shardRunnerErrors(cfg.ci);
  if (runnerProblems.length > 0) throw new Error(runnerProblems.join('; '));
  const runsOn = runsOnValue(cfg.ci?.runsOn);
  const testSystems = matrix ? MATRIX_OS : [runsOn];
  // Without the matrix the one shard key names a label of the runner; the job is keyed by its rendered runs-on.
  const given = cfg.ci?.shards && Object.keys(cfg.ci.shards).length > 0 ? cfg.ci.shards : null;
  const shards = given && (matrix ? given : { [runsOn]: Object.values(given)[0] });
  const commands = COMMAND_ORDER.filter((name) => typeof cfg.commands[name] === 'string' && cfg.commands[name].trim() !== '');
  const jdk = setupJavaSteps(v, cfg.ci?.java ?? DEFAULT_JAVA, javaBuildTool(root, commands.map((c) => cfg.commands[c])), root);
  const texts = [cfg.cli, ...commands.map((c) => cfg.commands[c]), ...steps.map((s) => s.run)];
  if (texts.some((t) => GITHUB_EXPRESSION.test(t))) throw new Error('workflow: a command contains a GitHub expression; pass values through env:');
  const blocks = {
    gateExtraSteps: matrix ? NO_DEPENDENCIES : [],
    commandJobs: commands.flatMap((name) =>
      name === 'test'
        ? commandJob(name, cfg.commands[name], v, testSystems, timeout, shards, jdk)
        : commandJob(name, cfg.commands[name], v, [runsOn], timeout, null, jdk),
    ),
    observabilityJobs: steps.flatMap((step, i) => observabilityJob(i + 1, step, v, timeout, runsOn)),
  };
  const vars = {
    ...v,
    checksOk: checksOk(commands, steps),
    defaultBranchItem: yamlScalar(cfg.defaultBranch),
    readyNeeds: ['gate', ...commands.map((c) => `cmd-${c}`), ...steps.map((_s, i) => `obs-${i + 1}`)].join(', '),
    runsOn,
    timeoutMinutes: String(timeout),
  };
  const free = { cli: cfg.cli, defaultBranch: cfg.defaultBranch };
  const out = [];
  for (const line of template.replace(/\r\n/g, '\n').split('\n')) {
    const block = /^\{\{([A-Za-z]+)\}\}$/.exec(line);
    if (block && BLOCK_KEYS.includes(block[1])) {
      out.push(...blocks[block[1]]);
      continue;
    }
    out.push(fillFreeText(substitute(line, vars, VALUE_KEYS), free));
  }
  return out.join('\n');
}

// The observability steps of a repository (D-56): config's, then the rows of the steps table of its
// observability.md when the file exists. A step the workflow cannot carry, or one named in both
// places, throws a ConfigError naming the file and line; a row with no command is a warning.
export function workflowSteps(root, cfg) {
  const file = kitPaths(root, cfg).observability;
  const rel = path.relative(root, file).split(path.sep).join('/');
  const all = allSteps(cfg, fs.existsSync(file) ? docSteps(readText(file), rel) : null);
  if (all.errors.length > 0) throw new ConfigError(all.errors);
  return { steps: all.steps, warnings: all.warnings };
}

// The rendered workflow and the repository's copy of it (null when absent), line endings normalised,
// with the warnings of the steps read from observability.md.
export function workflowState(root, cfg, pins = loadPins()) {
  const { steps, warnings } = workflowSteps(root, cfg);
  const expected = renderWorkflow(cfg, pins, { root, steps });
  const file = path.join(root, WORKFLOW_PATH);
  const current = fs.existsSync(file) ? readText(file) : null;
  return { file, expected, current, warnings };
}

// D-49: a team whose test command never reads SLICEKIT_SHARD runs the whole command in every shard.
// The command reads it when its text names it; `npm test` and `npm run <script>` are read through to
// that package.json script, and a command or script `node <file>.js` through to that file.
export function shardWarnings(root, cfg) {
  const shards = cfg.ci?.shards;
  const command = cfg.commands?.test;
  if (!shards || Object.keys(shards).length === 0 || typeof command !== 'string' || command.trim() === '') return [];
  let text = command;
  const npm = /^\s*npm\s+(?:run(?:-script)?\s+(\S+)|test\b|t\b)/.exec(command);
  if (npm) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
      text += ` ${pkg.scripts?.[npm[1] ?? 'test'] ?? ''}`;
    } catch {
      // No readable package.json: only the command's own text counts.
    }
  }
  // The command itself, or the npm script it named when there was one.
  const runs = text === command ? command : text.slice(command.length).trim();
  const script = /^\s*node\s+([\w./-]+\.[cm]?js)\b/.exec(runs);
  if (script && !script[1].split('/').includes('..')) {
    try {
      text += ` ${fs.readFileSync(path.join(root, ...script[1].split('/')), 'utf8')}`;
    } catch {
      // No such file: only the text so far counts.
    }
  }
  if (text.includes('SLICEKIT_SHARD')) return [];
  return ['ci.shards is set but commands.test does not read SLICEKIT_SHARD; every shard runs the whole test command'];
}
