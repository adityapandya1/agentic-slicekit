import fs from 'node:fs';
import { baselineCommand } from './baseline.js';
import { branchCommand } from './branch.js';
import { buildCommand } from './build.js';
import { checkCommand } from './check.js';
import { ciCommand } from './ci.js';
import { decideCommand } from './decide.js';
import { gapsCommand } from './gaps.js';
import { graphCommand } from './graph.js';
import { historyCommand } from './history.js';
import { impactCommand } from './impact.js';
import { initCommand } from './init.js';
import { intakeCommand } from './intake.js';
import { prCommand } from './pr.js';
import { instructionsCommand } from './instructions.js';
import { journalCommand } from './journal.js';
import { planCommand } from './plan.js';
import { hookCommand } from './hook.js';
import { readyLabelCommand } from './ready-label.js';
import { reviewCommand } from './review.js';
import { specCommand } from './spec.js';
import { stageCommand } from './stage.js';
import { shippedCommand } from './shipped.js';
import { stateCommand } from './state.js';
import { statusCommand } from './status.js';
import { traceCommand } from './trace.js';
import { uncoveredCommand } from './uncovered.js';
import { updateCommand } from './update.js';
import { visualizeCommand } from './visualize.js';
import { workflowCommand } from './workflow.js';

// Later tasks add entries: { [name]: { run(args, io) -> Promise<number>, usage: string, subcommands?: string[] } }
export const COMMANDS = {
  baseline: baselineCommand,
  branch: branchCommand,
  build: buildCommand,
  check: checkCommand,
  ci: ciCommand,
  decide: decideCommand,
  gaps: gapsCommand,
  graph: graphCommand,
  history: historyCommand,
  impact: impactCommand,
  init: initCommand,
  intake: intakeCommand,
  instructions: instructionsCommand,
  hook: hookCommand,
  journal: journalCommand,
  plan: planCommand,
  pr: prCommand,
  'ready-label': readyLabelCommand,
  review: reviewCommand,
  spec: specCommand,
  shipped: shippedCommand,
  stage: stageCommand,
  state: stateCommand,
  status: statusCommand,
  trace: traceCommand,
  uncovered: uncoveredCommand,
  update: updateCommand,
  visualize: visualizeCommand,
  workflow: workflowCommand,
};

function readVersion() {
  const url = new URL('../../package.json', import.meta.url);
  return JSON.parse(fs.readFileSync(url, 'utf8')).version;
}

function usageText() {
  const lines = ['usage: slicekit <command> [options]', ''];
  const names = Object.keys(COMMANDS).sort();
  if (names.length > 0) {
    lines.push('commands:');
    // One line per form, each starting with the command's name; a command's own continuation lines
    // are indented for its usage error and set level here.
    for (const name of names) for (const line of COMMANDS[name].usage.split('\n')) lines.push(`  ${line.trim()}`);
    lines.push('');
  }
  lines.push(
    'options:',
    '  --help       show this text',
    '  --version    print the version',
    '  --<option>=<value>  a value that starts with "-", for any option',
    '',
  );
  return lines.join('\n');
}

export async function main(argv, io) {
  const [first, ...rest] = argv;
  if (first === '--version') {
    io.stdout(`${readVersion()}\n`);
    return 0;
  }
  // The help asked for is the answer, on standard output; the usage after a mistake is an error.
  if (first === '--help') {
    io.stdout(usageText());
    return 0;
  }
  const command = Object.hasOwn(COMMANDS, first ?? '') ? COMMANDS[first] : undefined;
  if (!command) {
    io.stderr(usageText());
    if (first !== undefined) io.stderr(`slicekit: unknown command '${first}'\n`);
    return 2;
  }
  return command.run(rest, io);
}
