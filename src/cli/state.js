import { parseArgs } from 'node:util';
import { ConfigError, loadConfig } from '../config.js';
import { getHost } from '../adapters/githost/index.js';
import { GitHostError } from '../adapters/githost/errors.js';
import { STATES } from '../state/transitions.js';
import { LockError, TransitionError, readSlice, setState, unfreeze } from '../state/index.js';

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

// A merge done outside `build finish` is recorded only as the git host reports it (D-43): the slice's
// pull request (the recorded one, else --pr-number) must be merged, and its merge time and head come
// from the host. --merged-at and --pr-sha cannot stand in for the host's report.
function hostMerge(root, cfg, id, ev, env) {
  const recorded = readSlice(root, cfg, id).pr?.number;
  const given = ev.pr?.number;
  if (recorded !== undefined && recorded !== null && given !== undefined && given !== recorded) {
    throw new TransitionError(`${id} records pull request #${recorded}; --pr-number ${given} names another`);
  }
  const number = recorded ?? given;
  if (!Number.isInteger(number)) throw new TransitionError(`backfill to merged needs the pull request number (--pr-number); ${id} records none`);
  const pr = getHost(cfg, env, root).getPullRequest(number);
  if (!pr.mergedAt) throw new TransitionError(`the git host reports pull request #${number} ${String(pr.state ?? 'open').toLowerCase()}, not merged; backfill to merged needs a merged pull request`);
  if (typeof pr.headSha !== 'string' || pr.headSha === '') throw new TransitionError(`the git host reports no head for pull request #${number}`);
  const { mergedAt: _m, pr: _p, ...rest } = ev;
  return { ...rest, source: 'host', mergedAt: pr.mergedAt, pr: { number, headSha: pr.headSha, ...(pr.url ? { url: pr.url } : {}) } };
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
      let ev = evidenceFrom(values);
      if (values.backfill && arg === 'merged') ev = hostMerge(root, cfg, id, ev, io.env ?? process.env);
      const s = setState(root, cfg, id, arg, ev);
      io.stdout(`${id}  ${s.state}\n`);
    } else if (sub === 'unfreeze') {
      unfreeze(root, cfg, id, arg);
      io.stdout(`${id}  unfroze ${arg}\n`);
    } else {
      const s = readSlice(root, cfg, id);
      const pr = s.pr?.number != null ? `#${s.pr.number}` : '-';
      io.stdout(values.json ? `${JSON.stringify(s, null, 2)}\n` : `${id}  ${s.state}  PR ${pr}\n`);
    }
    return 0;
  } catch (e) {
    if (e instanceof TransitionError) {
      io.stderr(`refused: ${e.reason}\n`);
      return 1;
    }
    if (e instanceof GitHostError) {
      io.stderr(`slicekit: ${e.message}\n`);
      return 1;
    }
    if (e instanceof ConfigError || e instanceof LockError || /^unknown slice /.test(e.message)) {
      io.stderr(`slicekit: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
}

export const stateCommand = { run, usage: USAGE };
