// The GitHub Actions workflow init writes (REQ-3.11): a gate, a job per declared team command, a job
// per observability step (D-20), the ready label and the post-merge state sync (D-12). The YAML is
// generated as text; every free-text value goes through yamlScalar so a quote, colon or hash in a
// team's command cannot change the document's structure.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GITHUB_EXPRESSION, LINE_SEPARATOR } from './config.js';
import { kitPaths } from './paths.js';
import { substitute } from './render/entry.js';

export const WORKFLOW_TEMPLATE = fileURLToPath(new URL('../templates/workflow/slicekit.yml', import.meta.url));
export const PINS_PATH = fileURLToPath(new URL('../templates/workflow/pins.json', import.meta.url));

const ACTIONS = { checkout: 'actions/checkout', setupNode: 'actions/setup-node', uploadArtifact: 'actions/upload-artifact' };
const COMMAND_ORDER = ['test', 'lint', 'build', 'e2e'];
const MATRIX_OS = ['ubuntu-latest', 'windows-latest', 'macos-latest'];
const SHA = /^[0-9a-f]{40}$/;
const TAG = /^v\d+\.\d+\.\d+$/;
const BLOCK_KEYS = ['gateExtraSteps', 'commandJobs', 'observabilityJobs'];
// Filled as written: values the kit computes or validates to a safe shape.
const VALUE_KEYS = [
  'defaultBranchItem', 'readyNeeds', 'syncPaths',
  ...Object.keys(ACTIONS).flatMap((k) => [`${k}Sha`, `${k}Tag`]),
];
// The team's own text: a mapping value holding one is filled, then quoted as a whole.
const FREE_TEXT_KEYS = ['cli', 'defaultBranch'];

// REQ-5.3 for the kit's own repository: fails naming each runtime dependency.
const NO_DEPENDENCIES = [
  '      - name: No runtime dependencies (REQ-5.3)',
  '        run: |',
  `          node -e "const d = require('./package.json').dependencies || {}; const n = Object.keys(d); if (n.length) { console.error('package.json has dependencies: ' + n.join(', ')); process.exit(1) }"`,
];

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

function commandJob(name, command, v, matrix) {
  const head = matrix
    ? ['    strategy:', '      matrix:', `        os: [${MATRIX_OS.join(', ')}]`, '    runs-on: ${{ matrix.os }}']
    : ['    runs-on: ubuntu-latest'];
  return ['', `  cmd-${name}:`, ...head, '    steps:', ...setupSteps(v), ...runStep(name, command)];
}

function observabilityJob(n, step, v) {
  return ['', `  obs-${n}:`, `    name: ${yamlScalar(step.name, 4)}`, '    runs-on: ubuntu-latest', '    steps:', ...setupSteps(v), ...runStep(step.name, step.run, step.env)];
}

// One pass over the value, so text inside cli is never itself read as a placeholder.
function fillFreeText(line, vars) {
  if (!FREE_TEXT_KEYS.some((k) => line.includes(`{{${k}}}`))) return line;
  const m = /^(\s*(?:- )?[A-Za-z_-]+: )(.*)$/.exec(line);
  if (!m) throw new Error(`workflow template: a free-text placeholder outside a mapping value: ${line}`);
  return m[1] + yamlScalar(substitute(m[2], vars, FREE_TEXT_KEYS));
}

// What the sync commit may stage: BUILD.md and the state directory, as repository-relative paths.
function syncPaths(cfg) {
  // Neither path depends on docsRoot; the default only keeps a partial config renderable.
  const p = kitPaths('.', { docsRoot: 'docs', ...cfg });
  return [p.build, p.state].map((f) => path.relative('.', f).split(path.sep).join('/')).join(' ');
}

export function renderWorkflow(cfg, pins = loadPins(), { template = fs.readFileSync(WORKFLOW_TEMPLATE, 'utf8') } = {}) {
  if (/[\r\n]/.test(cfg.cli)) throw new Error('cli: must be one line to render the workflow');
  const v = checkPins(pins);
  const matrix = cfg.ci?.matrix === true;
  const commands = COMMAND_ORDER.filter((name) => typeof cfg.commands[name] === 'string' && cfg.commands[name].trim() !== '');
  const steps = cfg.ci?.observabilitySteps ?? [];
  const texts = [cfg.cli, ...commands.map((c) => cfg.commands[c]), ...steps.map((s) => s.run)];
  if (texts.some((t) => GITHUB_EXPRESSION.test(t))) throw new Error('workflow: a command contains a GitHub expression; pass values through env:');
  const blocks = {
    gateExtraSteps: matrix ? NO_DEPENDENCIES : [],
    commandJobs: commands.flatMap((name) => commandJob(name, cfg.commands[name], v, matrix && name === 'test')),
    observabilityJobs: steps.flatMap((step, i) => observabilityJob(i + 1, step, v)),
  };
  const vars = {
    ...v,
    defaultBranchItem: yamlScalar(cfg.defaultBranch),
    readyNeeds: ['gate', ...commands.map((c) => `cmd-${c}`)].join(', '),
    syncPaths: syncPaths(cfg),
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
