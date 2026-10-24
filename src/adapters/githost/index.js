import { GitHostError } from './errors.js';
import { fixtureHost } from './fixture.js';
import { githubHost } from './github.js';

// C-1: the only door to a git host. A second host is a second file and one more branch here.
export function getHost(cfg, env = process.env) {
  if (env.SLICEKIT_GITHOST_FIXTURE) return fixtureHost(env.SLICEKIT_GITHOST_FIXTURE);
  const kind = cfg?.gitHost?.kind;
  if (kind === 'github') return githubHost(env);
  throw new GitHostError(`unsupported git host: ${kind}`);
}
