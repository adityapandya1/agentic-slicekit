# Platform

## Providers and services

GitHub hosts the repository, its pull requests and issues; GitHub Actions runs CI on hosted runners (Linux, macOS, Windows); npm hosts the published package (D-79).

## Environments

None. The kit is a command-line package with no deployed service; a version on npm is the only thing that ships (D-79).

## How a change reaches each environment

A pull request merges to `main` after CI and a human review. A version reaches npm when the author publishes it from `main` (D-41); from P5/S-24 the publish workflow does it on a `v*` tag (D-62) (D-79).

## Access and ownership

The author owns the repository and the npm package, merges pull requests and publishes versions (D-79).

## Secrets

CI uses only the workflow's own `GITHUB_TOKEN`. Publishing uses npm trusted publishing, so no npm token is stored (D-62). Contributors need a `gh` login on their own machine (D-79).

## Network boundaries

The CLI reaches the git host through `gh` and a URL given to `intake snapshot`; nothing else. CI reaches GitHub and the npm registry (D-79).
