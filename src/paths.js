import path from 'node:path';

export function kitPaths(root, cfg) {
  const kit = path.join(root, '.slicekit');
  const docs = path.join(root, cfg.docsRoot);
  const spec = path.join(docs, 'spec');
  return {
    kit,
    config: path.join(kit, 'config.json'),
    state: path.join(kit, 'state'),
    baselines: path.join(kit, 'baselines'),
    journal: path.join(kit, 'journal.log'),
    graph: path.join(kit, 'graph'),
    workspace: path.join(kit, 'workspace.json'),
    docs,
    intake: path.join(docs, 'intake'),
    decisions: path.join(docs, 'decisions.md'),
    spec,
    contracts: path.join(spec, 'contracts'),
    gaps: path.join(spec, 'gaps.md'),
    stack: path.join(spec, 'stack.md'),
    platform: path.join(docs, 'platform.md'),
    observability: path.join(docs, 'observability.md'),
    runbook: path.join(docs, 'runbook.md'),
    phases: path.join(docs, 'phases'),
    releases: path.join(docs, 'releases'),
    build: path.join(root, 'BUILD.md'),
    claude: path.join(root, '.claude'),
    githooks: path.join(root, '.githooks'),
    workflow: path.join(root, '.github', 'workflows', 'slicekit.yml'),
  };
}
