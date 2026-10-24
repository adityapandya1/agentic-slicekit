import path from 'node:path';

export function kitPaths(root, cfg) {
  const kit = path.join(root, '.slicekit');
  const docs = path.join(root, cfg.docsRoot);
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
    decisions: path.join(docs, 'decisions'),
    spec: path.join(docs, 'spec'),
    contracts: path.join(docs, 'contracts'),
    gaps: path.join(docs, 'gaps'),
    stack: path.join(docs, 'stack'),
    platform: path.join(docs, 'platform'),
    observability: path.join(docs, 'observability'),
    runbook: path.join(docs, 'runbook'),
    phases: path.join(docs, 'phases'),
    releases: path.join(docs, 'releases'),
    build: path.join(root, 'BUILD.md'),
    claude: path.join(root, '.claude'),
    githooks: path.join(root, '.githooks'),
    workflow: path.join(root, '.github', 'workflows', 'slicekit.yml'),
  };
}
