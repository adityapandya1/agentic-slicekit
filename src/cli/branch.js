// `slicekit branch <spec|gaps|plan|release> <slug>` (REQ-2.3..REQ-2.5, REQ-2.9, D-54): puts the session on the
// work branch of a document pull request, cut from the default branch as origin has it. The command owns git
// (D-19). A change to a tracked file (staged or not) is refused, so no edit is carried across;
// untracked files go along as git carries them, so a source dropped in for intake survives. The one
// change carried is the config as the migration writes it from the committed one (D-94): an earlier
// command on this branch, such as `release --dry-run`, wrote it, and `pr open` commits it. Where the
// commit the session is put on holds another config than the one here (an earlier `pr open`
// committed the migration there), the change is dropped when that config equals it, and refused
// with one line naming the difference when it does not (issue #162).
// A `release/<slug>` branch that exists away from the default branch's tip is moved there or refused;
// one that holds its own commits is refused with its open pull request, read through the git host
// (C-1 pullRequestForBranch), or with the next free slug when the host says none is open. The host
// is asked about each `release/<slug>-<n>` branch as well: the phase's open release pull request
// may be on one of them, taken after `release/<slug>` was closed unmerged (issue #152). A slug
// given numbered, `<base>-<n>` with <n> 2 or more (the numbers the command itself names), belongs
// to the family of `release/<base>`: the host is asked about that branch and each
// `release/<base>-<n>` too, so an open release pull request on any of them refuses.
import { getHost } from '../adapters/githost/index.js';
import { GitHostError } from '../adapters/githost/errors.js';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_PATH, ConfigError, loadConfig, migrateConfig } from '../config.js';
import { GitError, assertRef, currentBranch, git, hasRemote, switchBranch } from '../git.js';

const KINDS = ['spec', 'gaps', 'plan', 'release'];
const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;
const USAGE = 'branch <spec|gaps|plan|release> <slug>';

const resolves = (root, ref) => {
  try {
    git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return true;
  } catch (e) {
    if (e instanceof GitError) return false;
    throw e;
  }
};

const CONFIG_FILE = CONFIG_PATH.split(path.sep).join('/');

// D-94: whether the only uncommitted change to a tracked file is the config, and the file holds
// exactly what the migration writes from the config the last commit holds. A config staged with
// one content and holding another in the working directory is not that change.
function onlyMigratedConfig(root) {
  const names = (args) => git(root, ['diff', '--name-only', '--no-renames', '-z', ...args]).split('\0').filter((f) => f !== '');
  const staged = names(['--cached', 'HEAD']);
  const unstaged = names([]);
  const changed = new Set([...staged, ...unstaged]);
  if (changed.size !== 1 || !changed.has(CONFIG_FILE)) return false;
  if (staged.length > 0 && unstaged.length > 0) return false;
  try {
    const committed = JSON.parse(git(root, ['show', `HEAD:${CONFIG_FILE}`]));
    const { cfg, from } = migrateConfig(committed);
    if (cfg === committed || from === cfg.configVersion) return false;
    return fs.readFileSync(path.join(root, CONFIG_PATH), 'utf8') === `${JSON.stringify(cfg, null, 2)}\n`;
  } catch (e) {
    if (e instanceof GitError || e instanceof ConfigError || e instanceof SyntaxError || e.code !== undefined) return false;
    throw e;
  }
}

// The text of the config at `ref`, or null when that commit holds none.
function configAt(root, ref) {
  try {
    return git(root, ['show', `${ref}:${CONFIG_FILE}`]);
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
}

const plain = (text) => text.replace(/\r\n/g, '\n').trimEnd();
const sameText = (a, b) => a !== null && b !== null && plain(a) === plain(b);

// Where two configs differ: the top-level fields whose values differ, or, when one of the two is
// not a JSON object, the first line that differs.
function configDifference(here, there) {
  const parse = (text) => {
    try {
      const v = JSON.parse(text);
      return v !== null && typeof v === 'object' && !Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  };
  const a = parse(here);
  const b = parse(there);
  if (a && b) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    if (keys.length > 0) return `${keys.length === 1 ? 'the field' : 'the fields'} ${keys.join(', ')}`;
  }
  const x = plain(here).split('\n');
  const y = plain(there).split('\n');
  let n = 0;
  while (n < x.length && n < y.length && x[n] === y[n]) n += 1;
  return `line ${n + 1}`;
}

// What becomes of the migrated config, the only uncommitted change, when the session moves to the
// commit `ref` (issue #162, D-94). -> 'carry' when that commit holds the config HEAD holds, so git
// carries the change; 'drop' when it holds the migrated config already; else the line to refuse with.
function migratedConfigTo(root, ref, label) {
  const there = configAt(root, ref);
  if (sameText(there, configAt(root, 'HEAD'))) return 'carry';
  const here = fs.readFileSync(path.join(root, CONFIG_PATH), 'utf8');
  if (sameText(there, here)) return 'drop';
  if (there === null) return `${CONFIG_FILE} is migrated here and not committed, and ${label} holds no ${CONFIG_FILE}; the change is left here and no branch is switched to`;
  return `${CONFIG_FILE} is migrated here and not committed, and ${CONFIG_FILE} on ${label} differs from it in ${configDifference(here, there)}; the change is left here and no branch is switched to`;
}

// The `release/<slug>-<n>` branches that exist here or on origin, as branch names in the order of <n>.
function numberedBranches(root, target) {
  const found = new Map();
  const refs = git(root, ['for-each-ref', '--format=%(refname)', `refs/heads/${target}-*`, `refs/remotes/origin/${target}-*`]);
  for (const ref of refs.split('\n').filter((l) => l !== '')) {
    const name = ref.replace(/^refs\/(heads|remotes\/origin)\//, '');
    const m = /^-(\d+)$/.exec(name.slice(target.length));
    if (m) found.set(name, Number(m[1]));
  }
  return [...found.keys()].sort((x, y) => found.get(x) - found.get(y));
}

async function run(args, io) {
  const [kind, slug, ...rest] = args;
  if (!KINDS.includes(kind) || slug === undefined || rest.length > 0) {
    io.stderr(`usage: slicekit ${USAGE}\n`);
    return 2;
  }
  if (!SLUG.test(slug)) {
    io.stderr(`slicekit: slug '${slug}' must be lowercase letters, digits and dashes, at most 60, not starting with a dash\n`);
    return 2;
  }
  const root = io.cwd;
  const target = `${kind}/${slug}`;
  // The first branch of the release family a numbered slug belongs to; else the target itself.
  const numberedSlug = kind === 'release' ? /^(.+)-(\d+)$/.exec(slug) : null;
  const family = numberedSlug && Number(numberedSlug[2]) >= 2 ? `${kind}/${numberedSlug[1]}` : target;
  try {
    const cfg = loadConfig(root);
    const base = assertRef(cfg.defaultBranch);
    const onTarget = currentBranch(root) === target;
    if (onTarget && kind !== 'release') {
      io.stdout(`${target}\n`);
      return 0;
    }
    const changed = git(root, ['status', '--porcelain', '--untracked-files=no']) !== '';
    const migrated = changed && onlyMigratedConfig(root);
    const dirty = changed && !migrated;
    // Moves the session to the commit `ref` with `go`. The migrated config is carried, dropped
    // first where `ref` holds it already, or the move is refused. -> false when refused, with the
    // line printed. A dropped copy is put back when the move fails. After the move the file holds
    // the bytes the migration wrote: a checkout that converts line endings writes the same config
    // with other ones, which git reads as no change.
    const move = (ref, label, go) => {
      const file = path.join(root, CONFIG_PATH);
      let kept = null;
      if (migrated) {
        const what = migratedConfigTo(root, ref, label);
        if (what !== 'carry' && what !== 'drop') {
          io.stderr(`slicekit: ${what}\n`);
          return false;
        }
        if (what === 'drop') {
          kept = fs.readFileSync(file);
          git(root, ['restore', '-q', '--staged', '--worktree', '--source=HEAD', '--', CONFIG_FILE]);
        }
      }
      try {
        go();
      } catch (e) {
        if (kept !== null) fs.writeFileSync(file, kept);
        throw e;
      }
      if (kept !== null) {
        const now = fs.readFileSync(file);
        if (!now.equals(kept) && sameText(now.toString('utf8'), kept.toString('utf8'))) {
          fs.writeFileSync(file, kept);
          // The file's size changed, which git takes for a change until the index entry is read
          // again; the add stages nothing, since the content is the commit's.
          git(root, ['--literal-pathspecs', 'add', '--', CONFIG_FILE]);
        }
      }
      return true;
    };
    const short = (ref) => ref.replace(/^refs\/(heads|remotes)\//, '');
    if (dirty && !onTarget) {
      io.stderr('slicekit: commit or stash your changes first\n');
      return 1;
    }
    // The full ref: a tag named like the default branch must not be what the branch is cut from.
    let from = `refs/heads/${base}`;
    const origin = hasRemote(root, 'origin');
    let fetched = false;
    if (origin) {
      try {
        git(root, ['fetch', '-q', 'origin', base]);
        fetched = true;
        if (resolves(root, `refs/remotes/origin/${base}`)) from = `refs/remotes/origin/${base}`;
        // The work branch too, so one pushed from another clone is found; origin not having it is
        // the usual case for a new branch, not an error.
        try {
          git(root, ['fetch', '-q', 'origin', `+refs/heads/${target}:refs/remotes/origin/${target}`]);
        } catch (e) {
          if (!(e instanceof GitError)) throw e;
        }
        // And, for a release, each numbered branch of the slug another clone pushed.
        if (kind === 'release') {
          const specs = [`+refs/heads/${target}-*:refs/remotes/origin/${target}-*`];
          // And, for a numbered slug, the first branch of its family and that one's numbered branches.
          if (family !== target) specs.push(`+refs/heads/${family}:refs/remotes/origin/${family}`, `+refs/heads/${family}-*:refs/remotes/origin/${family}-*`);
          for (const spec of specs) {
            try {
              git(root, ['fetch', '-q', 'origin', spec]);
            } catch (e) {
              if (!(e instanceof GitError)) throw e;
            }
          }
        }
      } catch (e) {
        if (!(e instanceof GitError)) throw e;
        const lines = e.stderr.split('\n');
        const reason = lines.find((l) => /^(fatal|error):/.test(l)) ?? (lines[0] || 'unknown reason');
        io.stderr(`slicekit: could not fetch origin (${reason}); branching from local ${base}\n`);
      }
    }
    // A work branch someone already pushed is taken up where it stands, tracking origin's copy;
    // only a new one is cut from the default branch.
    const remote = `refs/remotes/origin/${target}`;
    if (kind === 'release') {
      // `slicekit release` runs only at the default branch's tip. A release branch that stands
      // elsewhere, here or on origin, is moved to the tip when it holds no commit the default
      // branch lacks; one that does is refused: with its open pull request when the host has one,
      // else with the next free slug. A numbered branch of the slug, `release/<slug>-<n>`, that
      // holds commits the default branch lacks is asked about too, whatever `release/<slug>` holds.
      // So are the other branches of a numbered slug's family: `release/<base>` and each
      // `release/<base>-<n>`.
      const tip = git(root, ['rev-parse', '--verify', `${from}^{commit}`]);
      const copies = [`refs/heads/${target}`, remote].filter((ref) => resolves(root, ref));
      const stale = copies.filter((ref) => git(root, ['rev-parse', '--verify', `${ref}^{commit}`]) !== tip);
      const ahead = (ref) => git(root, ['rev-list', '--count', `${from}..${ref}`]) !== '0';
      const own = stale.some(ahead);
      // A branch may be that of the phase's open release pull request; a second slug would then
      // open a second one beside it. A pull request needs its branch on origin, so the host is
      // asked unless a fetch that worked found no such branch there.
      const onOrigin = (name) => origin && (!fetched || resolves(root, `refs/remotes/origin/${name}`));
      const holdsOwn = (name) => [`refs/heads/${name}`, `refs/remotes/origin/${name}`].some((ref) => resolves(root, ref) && ahead(ref));
      const numbered = numberedBranches(root, target).filter(holdsOwn);
      const kin = family === target ? [] : [family, ...numberedBranches(root, family)].filter((name) => name !== target && holdsOwn(name));
      for (const name of [...kin, ...(own ? [target] : []), ...numbered].filter(onOrigin)) {
        let open;
        try {
          open = getHost(cfg, io.env ?? process.env, root).pullRequestForBranch(name, { base });
        } catch (e) {
          if (!(e instanceof GitHostError)) throw e;
          io.stderr(`slicekit: ${name} holds commits ${base} lacks, and the git host could not be asked for its open pull request (${e.message}); no branch is cut\n`);
          return 1;
        }
        if (open) {
          io.stderr(`slicekit: ${name} is the branch of open pull request #${open.number} (${open.url}); the phase's release is already open\n`);
          return 1;
        }
      }
      if (own) {
        let n = 2;
        while (resolves(root, `refs/heads/${target}-${n}`) || resolves(root, `refs/remotes/origin/${target}-${n}`)) n += 1;
        io.stderr(`slicekit: ${target} holds commits ${base} lacks, so no release runs on it; run slicekit branch release ${slug}-${n}\n`);
        return 1;
      }
      if (onTarget && stale.length === 0) {
        io.stdout(`${target}\n`);
        return 0;
      }
      if (stale.length > 0) {
        if (dirty) {
          io.stderr('slicekit: commit or stash your changes first\n');
          return 1;
        }
        // -C makes the branch, or moves it, to stand at the tip; it held no commit of its own.
        if (!move(from, short(from), () => git(root, ['switch', '-q', '--no-track', '-C', target, from]))) return 1;
        io.stderr(`slicekit: ${target} was behind ${base}; moved to the tip of ${base}\n`);
        io.stdout(`${target}\n`);
        return 0;
      }
    }
    const local = `refs/heads/${target}`;
    let moved;
    if (resolves(root, local)) moved = move(local, target, () => switchBranch(root, target));
    else if (resolves(root, remote)) moved = move(remote, short(remote), () => switchBranch(root, target, { create: true, from: remote, track: true }));
    else moved = move(from, short(from), () => switchBranch(root, target, { create: true, from }));
    if (!moved) return 1;
    io.stdout(`${target}\n`);
    return 0;
  } catch (e) {
    if (e instanceof ConfigError) {
      io.stderr(`slicekit: ${e.message}\n`);
      return 2;
    }
    if (e instanceof GitError) {
      io.stderr(`slicekit: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
}

export const branchCommand = { run, usage: USAGE, subcommands: KINDS };
