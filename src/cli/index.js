import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_PATH, ConfigNewerError, loadConfig, migrateConfigFile } from '../config.js';
import { currentBranch } from '../git.js';
import { sliceFromBranch } from '../ids.js';
import { findSliceFiles, parseSliceFile } from '../slicefile.js';
import { auditCommand } from './audit.js';
import { baselineCommand } from './baseline.js';
import { branchCommand } from './branch.js';
import { briefCommand } from './brief.js';
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
import { nextCommand } from './next.js';
import { opsCommand } from './ops.js';
import { planCommand } from './plan.js';
import { hookCommand } from './hook.js';
import { readyLabelCommand } from './ready-label.js';
import { releaseCommand } from './release.js';
import { reviewCommand } from './review.js';
import { specCommand } from './spec.js';
import { stageCommand } from './stage.js';
import { shippedCommand } from './shipped.js';
import { stateCommand } from './state.js';
import { statusCommand } from './status.js';
import { syncCommand } from './sync.js';
import { traceCommand } from './trace.js';
import { uncoveredCommand } from './uncovered.js';
import { updateCommand } from './update.js';
import { visualizeCommand } from './visualize.js';
import { workflowCommand } from './workflow.js';

// Later tasks add entries: { [name]: { run(args, io) -> Promise<number>, usage: string, subcommands?: string[] } }
export const COMMANDS = {
  audit: auditCommand,
  baseline: baselineCommand,
  branch: branchCommand,
  brief: briefCommand,
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
  next: nextCommand,
  ops: opsCommand,
  plan: planCommand,
  pr: prCommand,
  'ready-label': readyLabelCommand,
  release: releaseCommand,
  review: reviewCommand,
  spec: specCommand,
  shipped: shippedCommand,
  stage: stageCommand,
  state: stateCommand,
  status: statusCommand,
  sync: syncCommand,
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
  // `<command> --help` (P3/S-36, issue #77) answers like `--help`; one after `--` is the command's.
  const end = rest.indexOf('--');
  if ((end === -1 ? rest : rest.slice(0, end)).includes('--help')) {
    io.stdout(commandUsage(command));
    return 0;
  }
  // REQ-5.6, D-60, D-93: an older config is migrated before the command reads it. A hook never
  // writes the team's tracked file mid-turn; it reads the config migrated in memory (loadConfig).
  // D-93 names two more cases that read it migrated, write nothing and print one line: a slice
  // branch or a slice's review branch (writesMigration), and `slicekit branch` of every kind, which
  // refuses a changed tracked file; the branch is cut first and the next command writes on it. A
  // migration an earlier command already wrote is carried by `slicekit branch` itself (D-94).
  // `slicekit next` writes no file anywhere (REQ-2.16, P8/S-62): it reads the config migrated too.
  if (command !== COMMANDS.hook && typeof io.cwd === 'string') {
    try {
      // The branch is asked about only when the config is older, so a current one costs no git call.
      const older = migrateConfigFile(io.cwd, { write: false });
      const here = older !== null && writesMigration(io.cwd);
      const write = here && command !== COMMANDS.branch && command !== COMMANDS.next;
      const migrated = write ? migrateConfigFile(io.cwd) : older;
      if (migrated && !write) {
        const where =
          command === COMMANDS.next
            ? 'slicekit next writes nothing, and the next command that writes migrates it'
            : here
              ? 'slicekit branch writes nothing, and the next command writes it on the branch it runs on'
              : 'it is migrated on the default branch or on a plan branch';
        io.stderr(`config: ${CONFIG_FILE} is at configVersion ${migrated.from} and is read as ${migrated.to} here, unwritten; ${where}
`);
      } else if (migrated) {
        io.stderr(`config: migrated ${CONFIG_FILE} from configVersion ${migrated.from} to ${migrated.to}
`);
        for (const change of migrated.changes) io.stderr(`  - ${change}
`);
      }
    } catch (e) {
      if (!(e instanceof ConfigNewerError)) throw e;
      io.stderr(`slicekit: ${e.message}
`);
      return 2;
    }
  }
  return command.run(rest, io);
}

const CONFIG_FILE = CONFIG_PATH.split(path.sep).join('/');

// Whether a command run in `cwd` may write the migrated config (review r1, H-1; D-93). On a slice branch
// or a slice's review branch no build step commits a changed config (`build commit` refuses a kit
// file, `build pr` an uncommitted change), so there the config is read migrated and left as it is.
// The exception is the slice whose Expected changes name the config: its slice branch and its review
// branch both write, since a review branch's commits go to the slice branch and `build config`
// commits the file (D-53, D-94). Anything unreadable on the way (no slice file, a config that does
// not load) is no reason to write.
function writesMigration(cwd) {
  let branch;
  try {
    branch = currentBranch(cwd);
  } catch {
    return true;
  }
  const id = branch === null ? null : sliceFromBranch(branch);
  if (id === null) return true;
  try {
    const cfg = loadConfig(cwd);
    for (const f of findSliceFiles(cwd, cfg)) {
      let slice;
      try {
        slice = parseSliceFile(fs.readFileSync(f.path, 'utf8'), f.path);
      } catch {
        continue;
      }
      if (slice.id === id) return slice.expectedChanges.includes(CONFIG_FILE);
    }
  } catch {
    return false;
  }
  return false;
}

function commandUsage(command) {
  const lines = command.usage.split('\n').map((line) => `  slicekit ${line.trim()}`);
  return `usage:\n${lines.join('\n')}\n`;
}
