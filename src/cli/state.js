import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from '../config.js';
import { STATES } from '../state/transitions.js';
import { TransitionError, readSlice, setState, unfreeze } from '../state/index.js';

const USAGE =
  'state set <id> <to> [--commit sha] [--test-exit n] [--check-exit n] [--tests a,b] [--pr-number n --pr-title t --pr-url u --pr-sha s] [--verdict path --round n --blockers n [--independent]] [--ci-status s --ci-sha s] [--merged-at iso] [--release path] [--backfill]\n' +
  '  slicekit state show <id> [--json]\n  slicekit state unfreeze <id> <path>';

const OPTIONS = {
  commit: { type: 'string' },
  'test-exit': { type: 'string' },
  'check-exit': { type: 'string' },
  tests: { type: 'string' },
  'pr-number': { type: 'string' },
  'pr-title': { type: 'string' },
  'pr-url': { type: 'string' },
  'pr-sha': { type: 'string' },
  verdict: { type: 'string' },
  round: { type: 'string' },
  blockers: { type: 'string' },
  independent: { type: 'boolean' },
  'ci-status': { type: 'string' },
  'ci-sha': { type: 'string' },
  'merged-at': { type: 'string' },
  release: { type: 'string' },
  backfill: { type: 'boolean' },
  json: { type: 'boolean' },
};

const num = (s) => (s === undefined ? undefined : Number(s));

function evidenceFrom(v) {
  const ev = {};
  if (v.commit !== undefined) ev.commit = v.commit;
  if (v['test-exit'] !== undefined) ev.testExit = num(v['test-exit']);
  if (v['check-exit'] !== undefined) ev.checkExit = num(v['check-exit']);
  if (v.tests !== undefined) ev.tests = v.tests.split(',').map((t) => t.trim()).filter(Boolean);
  if (['pr-number', 'pr-title', 'pr-url', 'pr-sha'].some((k) => v[k] !== undefined)) {
    ev.pr = { number: num(v['pr-number']), url: v['pr-url'], headSha: v['pr-sha'], title: v['pr-title'] };
  }
  if (v.verdict !== undefined) {
    ev.verdict = {
      round: num(v.round),
      path: v.verdict,
      blockers: num(v.blockers),
      independent: Boolean(v.independent),
    };
  }
  if (v['ci-status'] !== undefined || v['ci-sha'] !== undefined) {
    ev.ci = { status: v['ci-status'], sha: v['ci-sha'] };
  }
  if (v['merged-at'] !== undefined) ev.mergedAt = v['merged-at'];
  if (v.release !== undefined) ev.release = v.release;
  if (v.backfill) ev.backfill = true;
  return ev;
}

async function run(args, io) {
  let parsed;
  try {
    parsed = parseArgs({ args, options: OPTIONS, allowPositionals: true });
  } catch (e) {
    io.stderr(`slicekit: ${e.message}\nusage: slicekit ${USAGE}\n`);
    return 2;
  }
  const { values, positionals } = parsed;
  const [sub, id, arg] = positionals;
  const wanted = { set: 3, unfreeze: 3, show: 2 }[sub];
  if (!wanted || positionals.length !== wanted) {
    io.stderr(`usage: slicekit ${USAGE}\n`);
    return 2;
  }
  if (sub === 'set' && !STATES.includes(arg)) {
    io.stderr(`slicekit: unknown state '${arg}'; one of ${STATES.join(', ')}\n`);
    return 2;
  }
  const root = io.cwd;
  try {
    const cfg = loadConfig(root);
    if (sub === 'set') {
      const s = setState(root, cfg, id, arg, evidenceFrom(values));
      io.stdout(`${id}  ${s.state}\n`);
    } else if (sub === 'unfreeze') {
      unfreeze(root, cfg, id, arg);
      io.stdout(`${id}  unfroze ${arg}\n`);
    } else {
      const s = readSlice(root, cfg, id);
      io.stdout(values.json ? `${JSON.stringify(s, null, 2)}\n` : `${id}  ${s.state}  PR ${s.pr?.number ?? '-'}\n`);
    }
    return 0;
  } catch (e) {
    if (e instanceof TransitionError) {
      io.stderr(`refused: ${e.reason}\n`);
      return 1;
    }
    if (e instanceof ConfigError || /^unknown slice /.test(e.message)) {
      io.stderr(`slicekit: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
}

export const stateCommand = { run, usage: USAGE };
