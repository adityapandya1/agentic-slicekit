// `slicekit spec verify` (REQ-2.3): exit 0 with the REQ, contract and marker counts, then each
// clarification marker; exit 1 with one `<file>:<line> <message>` per finding.
import { ConfigError, loadConfig } from '../config.js';
import { verifySpec } from '../spec-verify.js';

const USAGE = 'spec verify';

async function run(args, io) {
  if (args.length !== 1 || args[0] !== 'verify') {
    io.stderr(`usage: slicekit ${USAGE}\n`);
    return 2;
  }
  let cfg;
  try {
    cfg = loadConfig(io.cwd);
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    io.stderr(`slicekit: ${e.message}\n`);
    return 2;
  }
  const { findings, counts, markers } = verifySpec(io.cwd, cfg);
  if (findings.length > 0) {
    io.stdout(findings.map((f) => `${f.file}:${f.line} ${f.message}\n`).join(''));
    return 1;
  }
  const head = `spec verified: ${counts.reqs} REQ, ${counts.contracts} contracts, ${counts.markers} clarification markers\n`;
  io.stdout(head + markers.map((m) => `${m.file}:${m.line} ${m.text}\n`).join(''));
  return 0;
}

export const specCommand = { run, usage: USAGE, subcommands: ['verify'] };
