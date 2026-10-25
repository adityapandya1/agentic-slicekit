// `slicekit ready-label` (03 REQ-3.11): the ready-label job of the generated workflow. It reads the
// pull request from the GitHub event, decides, prints the decision, and with GH_TOKEN set adds or
// removes the `ready` label through the git host. It always exits 0: the label is information.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from '../config.js';
import { stateFileName } from '../ids.js';
import { kitPaths } from '../paths.js';
import { EXEMPT_TITLE, readCiEvent } from '../check/ci-event.js';
import { titleSlice } from '../check/rules/ci-title.js';
import { readSlice } from '../state/index.js';
import { READY_LABEL, READY_LABEL_COLOR, READY_LABEL_DESCRIPTION, decideReady } from '../ready-label.js';
import { getHost } from '../adapters/githost/index.js';

const USAGE = 'ready-label';

// A workflow command's message: GitHub reads %, CR and LF as escapes, so they are written escaped.
const annotation = (text) => text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

const tryConfig = (root) => {
  try {
    return loadConfig(root);
  } catch {
    return undefined;
  }
};

// The decision for one pull request, as { slice, ready, reason }. Anything that stops a decision
// being made is a "not ready" with that reason.
function decide(root, env, pr) {
  if (EXEMPT_TITLE.test(pr.title)) {
    return { slice: null, ready: false, reason: 'the title names no slice (a [spec] or [plan] pull request)' };
  }
  const slice = titleSlice(pr.title);
  if (!slice) return { slice: null, ready: false, reason: 'the title names no slice' };
  // Fail closed: only the workflow's explicit report that every needed job passed counts.
  if (env.SLICEKIT_CHECKS_OK !== 'true') return { slice, ready: false, reason: 'a required check did not pass' };
  try {
    const cfg = loadConfig(root);
    if (!fs.existsSync(path.join(kitPaths(root, cfg).state, stateFileName(slice)))) {
      return { slice, ready: false, reason: `slice ${slice} has no state file` };
    }
    const state = readSlice(root, cfg, slice);
    return { slice, ...decideReady(state, cfg, { headSha: pr.headSha ?? undefined, number: pr.number, root }) };
  } catch (e) {
    return { slice, ready: false, reason: e.message };
  }
}

async function run(args, io) {
  try {
    parseArgs({ args, options: {}, allowPositionals: false });
  } catch (e) {
    io.stderr(`slicekit: ${e.message}\nusage: slicekit ${USAGE}\n`);
    return 0;
  }
  const root = io.cwd;
  const env = io.env ?? process.env;
  let pr;
  try {
    pr = readCiEvent(env);
  } catch (e) {
    io.stderr(`ready-label: ${e.message}\n`);
    return 0;
  }
  if (!pr) {
    io.stdout('ready-label: not a pull request; nothing to do\n');
    return 0;
  }
  const d = decide(root, env, pr);
  io.stdout(`ready-label: ${d.slice ?? 'pull request'} ${d.ready ? 'ready' : 'not ready'}: ${d.reason}\n`);
  // Adding is idempotent, so a ready decision always adds; a removal needs the label to be there.
  if (!d.ready && !pr.labels.includes(READY_LABEL)) return 0;
  if (!env.GH_TOKEN) {
    io.stdout('ready-label: GH_TOKEN not set; label left unchanged\n');
    return 0;
  }
  if (!Number.isInteger(pr.number)) {
    io.stdout('ready-label: the event carries no pull request number; label left unchanged\n');
    return 0;
  }
  // A label call that fails is reported on stderr and as a GitHub warning annotation on stdout.
  const warn = (what, e) => {
    const message = `could not ${what} the label: ${e.message}`;
    io.stderr(`ready-label: ${message}\n`);
    io.stdout(`::warning title=slicekit ready-label::${annotation(message)}\n`);
  };
  const action = d.ready ? 'add' : 'remove';
  let host;
  try {
    host = getHost(tryConfig(root), env, root);
  } catch (e) {
    warn(action, e);
    return 0;
  }
  // The repository may not have the label yet: create it first (idempotent). Adding is tried even
  // when that fails, since the label may already be there.
  if (d.ready) {
    try {
      host.ensureLabel(READY_LABEL, { color: READY_LABEL_COLOR, description: READY_LABEL_DESCRIPTION });
    } catch (e) {
      warn('create', e);
    }
  }
  try {
    host.setLabel(pr.number, READY_LABEL, d.ready);
    io.stdout(d.ready ? `ready-label: added label ${READY_LABEL} to #${pr.number}\n` : `ready-label: removed label ${READY_LABEL} from #${pr.number}\n`);
  } catch (e) {
    warn(action, e);
  }
  return 0;
}

export const readyLabelCommand = { run, usage: USAGE };
