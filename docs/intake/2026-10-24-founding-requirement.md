# Intake: the founding requirement

**Source:** a design conversation between the author (Aditya Pandya) and Claude Code on 2026-10-24.
**Form:** spoken requirement, restated here in the author's order, with the author's own emphasis kept.
**Status:** frozen. A later change of mind is a new intake file, never an edit here.

## What the author wants

A public GitHub project that packages a way of building software with AI coding agents. It was
distilled from building the Redelio product end to end with Claude Code. It must be specification
driven, technology agnostic, framework agnostic, and fit for systems that must be highly available,
reliable and secure. Others should be able to install it and use it.

## The problem it solves

During AI-driven development the chance of drift grows. A human writes documents at the start and the
agent builds from them. From then on everything continues with the agent, the documents go stale or
become useless, and nobody knows what has been built or what has been pushed. Maintenance becomes
impossible. The author wants a more deterministic and reliable workflow made of hooks, skills,
agents, commands and whatever other utilities exist.

## The journey, as the author described it

1. A team decides to build a product, a service or an integration. They write the requirement in
   Confluence, a document or a Word file: what to build, which components are needed, possibly the
   technology stack (Java and Spring Boot in the example), and the existing systems it must
   integrate with.
2. Given to an agent, it must first understand the requirement and then ask questions until no
   assumption remains. No filler language such as "minting at the gate" or "at the boundary of". <!-- slicekit:example -->
3. From the documents and the answers, the agent writes specifications as markdown files in the
   repository's docs folder. Companies document differently; the kit adapts.
4. The spec goes for human review and is confirmed or updated.
5. A second scan finds gaps in the requirement.
6. Then the technology stack is decided, if it was not given.
7. Phases are created from the team's milestones. Each phase holds slices, one chunk of work each.
   Every slice in a phase can be worked in parallel, so four developers take four slices without
   conflict.
8. Each slice has an evaluation set: the success criteria. Tests are written before development and
   run again after, until all are green. The test framework follows the stack.
9. A build command starts a slice. It spawns a developer agent, which reports back a draft pull
   request. The build command spawns a reviewer over the whole pull request. The verdict has blockers
   and good-to-haves. Blockers are fixed by a spawned agent. For good-to-haves the user is asked; on
   no, the pull request records it and a ticket is opened in the team's tracker. Review repeats until
   no blockers remain.
10. The slice row gets the pull request number. Commits and pull requests carry the phase and slice
    number, so a later tool can look back through git history and find where a regression entered
    without wasting time or tokens.
11. A graph layer, like graphify, understands the repository structure and the relationships between
    multiple repositories.
12. A `visualize` command serves that graph as a local web page.
13. Some teams are full stack and need UI, backend and everything. Some are pure middleware or
    backend. The kit adapts.
14. Added later in the conversation: infrastructure and observability. Teams may already have a
    monitoring setup that becomes a dependency of CI; the kit adapts to it. The kit must understand
    the infrastructure (Azure, OpenShift, AWS and so on) and adapt. Every repository keeps a
    maintained runbook so that, once in a higher environment, humans or an ops agent can analyse,
    find the root cause and act or suggest actions.

## Named inspirations

OpenSpec, graphify, ponytail, ECC, superpowers, GSD, and other spec-driven development kits. Take the
best of each. The research notes live in `../spec/00-overview.md` under "What exists".
