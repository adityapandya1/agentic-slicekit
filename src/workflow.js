// The GitHub Actions workflow init writes (REQ-3.11): a gate, a job per declared team command, a job
// per observability step (D-20), the ready label and the post-merge state sync (D-12), which opens a
// [sync] pull request and starts the workflow on its branch with workflow_dispatch (D-78, D-80). The YAML is
// generated as text; every free-text value goes through yamlScalar so a quote, colon or hash in a
// team's command cannot change the document's structure.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RUNS_ON, DEFAULT_TIMEOUT_MINUTES, GITHUB_EXPRESSION, LINE_SEPARATOR, MATRIX_OS, shardErrors, shardRunnerErrors } from './config.js';
import { readText } from './fs.js';
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
const TOOL_CALL = /(?:^|[\s;&|(])(mvn|gradle|\.\/gradlew)(?=$|[\s;&|)])/;
export function javaBuildTool(root, commands) {
  const fromFiles = new Set(root ? Object.entries(BUILD_FILES).filter(([f]) => fs.existsSync(path.join(root, f))).map(([, t]) => t) : []);
  if (fromFiles.size === 1) return [...fromFiles][0];
  const call = commands.map((c) => TOOL_CALL.exec(c)).find(Boolean);
  if (call) return call[1] === 'mvn' ? 'maven' : 'gradle';
  return fromFiles.size > 0 ? 'maven' : null;
}

function setupJavaSteps(v, java, tool) {
  if (!tool) return [];
  return [
    `      - uses: actions/setup-java@${v.setupJavaSha} # ${v.setupJavaTag}`,
    '        with:',
    '          distribution: temurin',
    `          java-version: ${yamlScalar(String(java))}`,
    `          cache: ${tool}`,
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

export function renderWorkflow(cfg, pins = loadPins(), { template = fs.readFileSync(WORKFLOW_TEMPLATE, 'utf8'), root = null } = {}) {
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
  const jdk = setupJavaSteps(v, cfg.ci?.java ?? DEFAULT_JAVA, javaBuildTool(root, commands.map((c) => cfg.commands[c])));
  const steps = cfg.ci?.observabilitySteps ?? [];
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

// The rendered workflow and the repository's copy of it (null when absent), line endings normalised.
export function workflowState(root, cfg, pins = loadPins()) {
  const expected = renderWorkflow(cfg, pins, { root });
  const file = path.join(root, WORKFLOW_PATH);
  const current = fs.existsSync(file) ? readText(file) : null;
  return { file, expected, current };
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
