# Platform

The example is a function over a small file, and it runs only as its tests, on the machine that builds it.

## Providers and services

None.

## Environments

One: a developer machine with Node 22.

## How a change reaches each environment

A merged pull request; nothing is deployed.

## Access and ownership

Whoever holds the repository. `data/sales.csv` is made up for the example and holds no one's data.

## Secrets

None.

## Network boundaries

None: the tests make no network call.
