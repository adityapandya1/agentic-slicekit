# Platform

The example is a small HTTP server that runs only as its tests, on the machine that builds it.

## Providers and services

None.

## Environments

One: a developer machine with Node 22.

## How a change reaches each environment

A merged pull request; nothing is deployed.

## Access and ownership

Whoever holds the repository.

## Secrets

None.

## Network boundaries

The tests start the server on a free port of the loopback address and call it there; nothing leaves the machine.
