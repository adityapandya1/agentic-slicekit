# Platform

## Providers and services

GitHub hosts the repository, its pull requests and issues; GitHub Actions runs CI on hosted runners (Linux, macOS, Windows); npm hosts the published package (D-79).

Anthropic: Claude Code runs each benchmark trial on the team's own Claude account or API key, and the new-model check calls Anthropic's models API. The team pays for the usage. The kit adds no service of its own (D-119).

## Environments

None. The kit is a command-line package with no deployed service; a version on npm is the only thing that ships (D-79).

## How a change reaches each environment

A pull request merges to `main` after CI and a human review. A version reaches npm from CI: the merge to `main` of the sync pull request that sets the version starts the publish workflow, which publishes once the author approves its deployment to the environment `npm` (D-62, D-90, D-91). The previews up to 0.2.1 were published by hand (D-41) (D-79).

## Access and ownership

The author owns the repository and the npm package, merges pull requests and publishes versions (D-79).

## Secrets

CI uses only the workflow's own `GITHUB_TOKEN`. Publishing uses npm trusted publishing, so no npm token is stored (D-62). Contributors need a `gh` login on their own machine (D-79).

The benchmark uses Claude Code's own login on a person's machine, or `ANTHROPIC_API_KEY` in the environment for the models API; the opt-in CI job uses `ANTHROPIC_API_KEY` as a repository secret the team adds. The kit never writes a key to a file, a run record or the report (D-120).

## Network boundaries

The CLI reaches the git host through `gh` and a URL given to `intake snapshot`; nothing else. CI reaches GitHub and the npm registry (D-79).

The benchmark adds the models API call of the new-model check and the Claude Code run of each trial, which reaches Anthropic as it always does. A trial's throwaway folder holds no git remote, so a trial cannot push. Nothing else is called (D-121).
