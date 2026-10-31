/* The visualize page's script (REQ-4.7). A classic script: it defines one global, slicekitViews,
   whose view functions take the graph and return HTML strings, so a test runs them under node:vm
   without a browser. Every text it inserts goes through escapeHtml. Only when a document exists does
   it read the inlined graph and fill the page. It loads nothing. */
var slicekitViews = (function () {
  'use strict';

  var STATES = ['todo', 'tests-red', 'building', 'draft-pr', 'in-review', 'changes-requested', 'ci-green', 'ready', 'merged', 'released'];
  var ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, function (c) {
      return ENTITIES[c];
    });
  }

  function cmp(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function keyOf(id) {
    var s = String(id);
    return s.slice(s.indexOf(':') + 1);
  }
  function kindOf(id) {
    var s = String(id);
    var i = s.indexOf(':');
    return i === -1 ? '' : s.slice(0, i);
  }
  // REQ-1.10 after REQ-1.9; P2/S-03 after P1/S-10: digits compared as numbers.
  function natural(a, b) {
    var x = String(a).split(/(\d+)/);
    var y = String(b).split(/(\d+)/);
    for (var i = 0; i < Math.min(x.length, y.length); i++) {
      if (x[i] === y[i]) continue;
      if (i % 2 === 1) return Number(x[i]) - Number(y[i]) || cmp(x[i], y[i]);
      return cmp(x[i], y[i]);
    }
    return x.length - y.length;
  }
  function day(iso) {
    return iso ? String(iso).slice(0, 10) : '';
  }
  // Only a web address may become a link.
  function webOnly(url) {
    return /^https?:\/\//i.test(String(url || '')) ? String(url) : null;
  }

  var cache = typeof WeakMap === 'function' ? new WeakMap() : null;
  function index(graph) {
    if (cache && cache.has(graph)) return cache.get(graph);
    var byId = new Map();
    var kinds = new Map();
    var outs = new Map();
    var ins = new Map();
    (graph.nodes || []).forEach(function (n) {
      byId.set(n.id, n);
      if (!kinds.has(n.kind)) kinds.set(n.kind, []);
      kinds.get(n.kind).push(n);
    });
    (graph.edges || []).forEach(function (e) {
      if (!outs.has(e.from)) outs.set(e.from, []);
      outs.get(e.from).push(e);
      if (!ins.has(e.to)) ins.set(e.to, []);
      ins.get(e.to).push(e);
    });
    function pick(map, id, kind, otherKind, end) {
      var list = (map.get(id) || []).filter(function (e) {
        return (!kind || e.kind === kind) && (!otherKind || kindOf(e[end]) === otherKind);
      });
      var seen = new Set();
      var nodes = [];
      list.forEach(function (e) {
        var n = byId.get(e[end]);
        if (n && !seen.has(n.id)) {
          seen.add(n.id);
          nodes.push(n);
        }
      });
      return nodes;
    }
    var idx = {
      node: function (id) {
        return byId.get(id) || null;
      },
      byKind: function (kind) {
        return (kinds.get(kind) || []).slice();
      },
      // The nodes an edge of `kind` reaches from `id` (out) or comes from into `id` (in).
      out: function (id, kind, otherKind) {
        return pick(outs, id, kind, otherKind, 'to');
      },
      in: function (id, kind, otherKind) {
        return pick(ins, id, kind, otherKind, 'from');
      },
      neighbours: function (id) {
        var list = [];
        (outs.get(id) || []).forEach(function (e) {
          list.push({ edge: e.kind, dir: 'out', node: byId.get(e.to) });
        });
        (ins.get(id) || []).forEach(function (e) {
          list.push({ edge: e.kind, dir: 'in', node: byId.get(e.from) });
        });
        return list.filter(function (x) {
          return x.node;
        });
      },
    };
    if (cache) cache.set(graph, idx);
    return idx;
  }

  // A workspace repository's pull request is <repo>#<n>, as src/graph/render.js names it; one of the
  // program repository is #<n>.
  function prName(p) {
    return p.repo ? keyOf(p.id) : '#' + (p.number || keyOf(p.id));
  }
  function title(n) {
    var key = keyOf(n.id);
    if (n.kind === 'commit') return key.slice(0, 7) + ' ' + (n.subject || n.label || '');
    if (n.kind === 'pull-request') return prName(n) + ' ' + (n.label || '');
    if (n.kind === 'file' || n.kind === 'test' || n.kind === 'intake' || n.kind === 'repo') return key;
    if (n.kind === 'release') return key;
    return n.label && n.label !== key ? key + ' ' + n.label : key;
  }
  // A clickable node: a button carrying the node's id.
  function nodeButton(n, text) {
    return '<button type="button" class="node" data-id="' + escapeHtml(n.id) + '">' + escapeHtml(text === undefined ? title(n) : text) + '</button>';
  }
  function empty(text) {
    return '<p class="empty">' + escapeHtml(text) + '</p>';
  }
  function list(nodes, render) {
    if (nodes.length === 0) return '';
    return '<ul>' + nodes.map(function (n) {
      return '<li>' + (render ? render(n) : nodeButton(n)) + '</li>';
    }).join('') + '</ul>';
  }
  function byNatural(a, b) {
    return natural(keyOf(a.id), keyOf(b.id));
  }

  // The requirement tree: spec file, then requirement, then the slices implementing it and the tests covering it.
  function requirements(graph) {
    var idx = index(graph);
    var reqs = idx.byKind('requirement').sort(byNatural);
    if (reqs.length === 0) return '<h2>Requirements</h2>' + empty('No requirement in the graph.');
    var files = new Map();
    reqs.forEach(function (r) {
      var file = String(r.from || '').replace(/:\d+$/, '');
      if (!files.has(file)) files.set(file, []);
      files.get(file).push(r);
    });
    var html = '<h2>Requirements</h2><ul class="tree">';
    Array.from(files.keys()).sort(natural).forEach(function (file) {
      html += '<li><code>' + escapeHtml(file) + '</code><ul>';
      files.get(file).forEach(function (r) {
        var slices = idx.in(r.id, 'implements', 'slice').sort(byNatural);
        var tests = idx.in(r.id, 'covers', 'test').sort(byNatural);
        html += '<li>' + nodeButton(r);
        if (slices.length || tests.length) {
          html += '<ul>' + slices.map(function (s) {
            return '<li><span class="kind">slice</span>' + nodeButton(s) + ' <span class="n">' + escapeHtml(s.state || '') + '</span></li>';
          }).join('') + tests.map(function (t) {
            return '<li><span class="kind">test</span>' + nodeButton(t) + '</li>';
          }).join('') + '</ul>';
        } else {
          html += ' <span class="empty">no slice, no test</span>';
        }
        html += '</li>';
      });
      html += '</ul></li>';
    });
    return html + '</ul>';
  }

  // Slices by state, in REQ-1.8's order; a state outside it goes last.
  function board(graph) {
    var idx = index(graph);
    var slices = idx.byKind('slice').sort(byNatural);
    var columns = STATES.slice();
    slices.forEach(function (s) {
      var st = s.state || 'todo';
      if (columns.indexOf(st) === -1) columns.push(st);
    });
    var html = '<h2>Board</h2>';
    if (slices.length === 0) html += empty('No slice in the graph.');
    html += '<div class="board">';
    columns.forEach(function (st) {
      var here = slices.filter(function (s) {
        return (s.state || 'todo') === st;
      });
      html += '<div class="column"><h3>' + escapeHtml(st) + ' <span class="count">' + here.length + '</span></h3>';
      html += here.length ? list(here) : '';
      html += '</div>';
    });
    return html + '</div>';
  }

  function sliceCommits(idx, slice) {
    return idx.in(slice.id, 'in', 'commit').sort(function (a, b) {
      return cmp(a.date || '', b.date || '') || cmp(a.id, b.id);
    });
  }

  // Each slice from its first commit to its merge (or its last commit while open).
  function timeline(graph) {
    var idx = index(graph);
    var rows = [];
    var none = [];
    idx.byKind('slice').forEach(function (s) {
      var commits = sliceCommits(idx, s);
      if (commits.length === 0) {
        none.push(s);
        return;
      }
      var start = commits[0].date || '';
      var last = commits[commits.length - 1].date || start;
      rows.push({ slice: s, start: start, end: s.mergedAt || last, merged: Boolean(s.mergedAt) });
    });
    rows.sort(function (a, b) {
      return cmp(a.start, b.start) || byNatural(a.slice, b.slice);
    });
    var html = '<h2>Timeline</h2>';
    if (rows.length === 0) html += empty('No slice has a commit yet.');
    else {
      var lo = Math.min.apply(null, rows.map(function (r) { return Date.parse(r.start) || 0; }));
      var hi = Math.max.apply(null, rows.map(function (r) { return Date.parse(r.end) || 0; }));
      var span = Math.max(hi - lo, 1);
      html += '<ul class="rows">' + rows.map(function (r) {
        var left = (((Date.parse(r.start) || lo) - lo) / span) * 100;
        var width = Math.max((((Date.parse(r.end) || lo) - (Date.parse(r.start) || lo)) / span) * 100, 0.5);
        if (left + width > 100) width = 100 - left;
        return '<li>' + nodeButton(r.slice) +
          '<span class="dates">' + escapeHtml(day(r.start)) + ' to ' + escapeHtml(day(r.end)) + (r.merged ? '' : ' (open)') + '</span>' +
          '<div class="track" aria-hidden="true"><div class="bar" style="margin-left:' + left.toFixed(2) + '%;width:' + width.toFixed(2) + '%"></div></div></li>';
      }).join('') + '</ul>';
    }
    if (none.length) html += '<h3>No commit yet</h3>' + list(none.sort(byNatural));
    return html;
  }

  // Each file with the number of slices whose commits touched it, most first.
  function heat(graph) {
    var idx = index(graph);
    var rows = [];
    idx.byKind('file').forEach(function (f) {
      var slices = new Set();
      idx.in(f.id, 'touched', 'commit').forEach(function (c) {
        idx.out(c.id, 'in', 'slice').forEach(function (s) {
          slices.add(s.id);
        });
      });
      if (slices.size > 0) rows.push({ file: f, n: slices.size });
    });
    rows.sort(function (a, b) {
      return b.n - a.n || cmp(keyOf(a.file.id), keyOf(b.file.id));
    });
    var html = '<h2>File heat</h2>';
    if (rows.length === 0) return html + empty('No file has been touched by a slice.');
    var max = rows[0].n;
    return html + '<ul class="rows">' + rows.map(function (r) {
      return '<li>' + nodeButton(r.file) + '<span class="n">' + r.n + (r.n === 1 ? ' slice' : ' slices') + '</span>' +
        '<div class="track" aria-hidden="true"><div class="bar" style="width:' + ((r.n / max) * 100).toFixed(2) + '%"></div></div></li>';
    }).join('') + '</ul>';
  }

  function sliceWithRepo(s) {
    return nodeButton(s) + ' <span class="n">repo ' + escapeHtml(s.repo || '.') + '</span>';
  }

  // Each contract with its producer and consumer slices and their repositories.
  function contracts(graph) {
    var idx = index(graph);
    var all = idx.byKind('contract').sort(byNatural);
    var html = '<h2>Contracts</h2>';
    if (all.length === 0) return html + empty('No contract in the graph.');
    return html + all.map(function (c) {
      var producers = idx.in(c.id, 'produces', 'slice').sort(byNatural);
      var consumers = idx.in(c.id, 'consumes', 'slice').sort(byNatural);
      return '<div class="card">' + nodeButton(c) +
        '<h3>Producer</h3>' + (producers.length ? list(producers, sliceWithRepo) : empty('none named')) +
        '<h3>Consumers</h3>' + (consumers.length ? list(consumers, sliceWithRepo) : empty('none named')) + '</div>';
    }).join('');
  }

  function prNumber(a, b) {
    return (Number(a.number) || 0) - (Number(b.number) || 0) || cmp(a.id, b.id);
  }

  // Each release with its pull requests and the requirements their slices implement.
  function releases(graph) {
    var idx = index(graph);
    var all = idx.byKind('release').sort(byNatural);
    var html = '<h2>Releases</h2>';
    if (all.length === 0) return html + empty('No release record in the graph.');
    return html + all.map(function (r) {
      var prs = idx.in(r.id, 'released-in', 'pull-request').sort(prNumber);
      var reqs = new Map();
      prs.forEach(function (p) {
        idx.out(p.id, 'in', 'slice').forEach(function (s) {
          idx.out(s.id, 'implements', 'requirement').forEach(function (q) {
            reqs.set(q.id, q);
          });
        });
      });
      var reqList = Array.from(reqs.values()).sort(byNatural);
      return '<div class="card">' + nodeButton(r, 'Release ' + keyOf(r.id)) +
        '<h3>Pull requests</h3>' + (prs.length ? list(prs) : empty('none')) +
        '<h3>Requirements</h3>' + (reqList.length ? list(reqList) : empty('none')) + '</div>';
    }).join('');
  }

  // The repository a commit belongs to: its slice's, else the one its files sit in.
  function commitRepo(idx, commit) {
    var slices = idx.out(commit.id, 'in', 'slice');
    for (var i = 0; i < slices.length; i++) {
      var r = idx.node('repo:' + (slices[i].repo || '.'));
      if (r) return r;
    }
    var files = idx.out(commit.id, 'touched', 'file');
    for (var j = 0; j < files.length; j++) {
      var repos = idx.out(files[j].id, 'in', 'repo');
      if (repos.length) return repos[0];
    }
    return null;
  }

  function link(url, text) {
    return '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(text) + '</a>';
  }

  function commitLine(idx, c) {
    var sha = keyOf(c.id);
    var repo = commitRepo(idx, c);
    var web = repo && webOnly(repo.web);
    var shaHtml = web ? link(web.replace(/\/+$/, '') + '/commit/' + sha, sha.slice(0, 7)) : '<code>' + escapeHtml(sha.slice(0, 7)) + '</code>';
    return shaHtml + ' ' + nodeButton(c, c.subject || c.label || sha) + ' <span class="n">' + escapeHtml(day(c.date)) + '</span>';
  }

  function prLine(p) {
    var url = webOnly(p.url);
    var text = prName(p);
    return (url ? link(url, text) : '<code>' + escapeHtml(text) + '</code>') + ' ' + nodeButton(p, p.label || text) +
      (p.state ? ' <span class="n">' + escapeHtml(String(p.state).toLowerCase()) + '</span>' : '');
  }

  // The slices whose work a node gathers: itself for a slice, its slices for anything above or below one.
  function slicesOf(idx, n) {
    switch (n.kind) {
      case 'slice': return [n];
      case 'requirement': return idx.in(n.id, 'implements', 'slice');
      case 'contract': return idx.in(n.id, 'produces', 'slice').concat(idx.in(n.id, 'consumes', 'slice'));
      case 'phase': return idx.in(n.id, 'in', 'slice');
      case 'pull-request':
      case 'verdict': return idx.out(n.id, 'in', 'slice');
      case 'release': {
        var out = [];
        idx.in(n.id, 'released-in', 'pull-request').forEach(function (p) {
          out = out.concat(idx.out(p.id, 'in', 'slice'));
        });
        return out;
      }
      case 'commit': return idx.out(n.id, 'in', 'slice');
      default: return [];
    }
  }

  function uniq(nodes) {
    var seen = new Set();
    return nodes.filter(function (n) {
      if (!n || seen.has(n.id)) return false;
      seen.add(n.id);
      return true;
    });
  }

  // The detail panel for one node: what it is, its files, commits and pull requests, then its other neighbours.
  function detail(graph, id) {
    var idx = index(graph);
    var n = idx.node(id);
    if (!n) return empty('Not in the graph: ' + id);
    var slices = uniq(slicesOf(idx, n));
    var commits;
    var files;
    if (n.kind === 'commit') {
      commits = [n];
    } else if (n.kind === 'file') {
      commits = idx.in(n.id, 'touched', 'commit');
    } else {
      commits = [];
      slices.forEach(function (s) {
        commits = commits.concat(idx.in(s.id, 'in', 'commit'));
      });
    }
    commits = uniq(commits).sort(function (a, b) {
      return cmp(a.date || '', b.date || '') || cmp(a.id, b.id);
    });
    files = [];
    if (n.kind !== 'file') {
      commits.forEach(function (c) {
        files = files.concat(idx.out(c.id, 'touched', 'file'));
      });
    }
    files = uniq(files).sort(function (a, b) {
      return cmp(keyOf(a.id), keyOf(b.id));
    });
    var prs = n.kind === 'pull-request' ? [n] : [];
    var prSlices = n.kind === 'file' ? uniq([].concat.apply([], commits.map(function (c) { return idx.out(c.id, 'in', 'slice'); }))) : slices;
    prSlices.forEach(function (s) {
      prs = prs.concat(idx.in(s.id, 'in', 'pull-request'));
    });
    if (n.kind === 'release') prs = prs.concat(idx.in(n.id, 'released-in', 'pull-request'));
    prs = uniq(prs).sort(prNumber);

    var html = '<h2><span class="kind">' + escapeHtml(n.kind) + '</span>' + escapeHtml(title(n)) + '</h2>';
    if (n.from) html += '<p class="meta">from <code>' + escapeHtml(n.from) + '</code></p>';
    if (n.kind === 'slice') html += '<p class="meta">state ' + escapeHtml(n.state || 'todo') + ', repo ' + escapeHtml(n.repo || '.') + (n.mergedAt ? ', merged ' + escapeHtml(day(n.mergedAt)) : '') + '</p>';
    if (n.kind === 'repo' && webOnly(n.web)) html += '<p>' + link(n.web, n.web) + '</p>';
    if (n.kind !== 'slice' && slices.length) html += '<h3>Slices</h3>' + list(slices.sort(byNatural));
    if (n.kind === 'file') html += '<h3>Slices</h3>' + (prSlices.length ? list(prSlices.sort(byNatural)) : empty('none'));
    if (n.kind !== 'file') html += '<h3>Files</h3>' + (files.length ? list(files) : empty('none'));
    html += '<h3>Commits</h3>' + (commits.length ? list(commits, function (c) { return commitLine(idx, c); }) : empty('none'));
    html += '<h3>Pull requests</h3>' + (prs.length ? list(prs, prLine) : empty('none'));

    var shown = new Set([n.id]);
    slices.concat(commits, files, prs).forEach(function (x) { shown.add(x.id); });
    var others = idx.neighbours(n.id).filter(function (x) { return !shown.has(x.node.id); });
    if (others.length) {
      html += '<h3>Linked</h3><ul>' + others.sort(function (a, b) {
        return cmp(a.edge, b.edge) || cmp(a.node.id, b.node.id);
      }).map(function (x) {
        return '<li><span class="kind">' + escapeHtml(x.dir === 'out' ? x.edge : x.edge + ' by') + '</span>' + nodeButton(x.node) + '</li>';
      }).join('') + '</ul>';
    }
    return html;
  }

  return {
    escapeHtml: escapeHtml,
    requirements: requirements,
    board: board,
    timeline: timeline,
    heat: heat,
    contracts: contracts,
    releases: releases,
    detail: detail,
  };
})();

if (typeof document !== 'undefined') {
  (function () {
    var graph = JSON.parse(document.getElementById('graph').textContent);
    var meta = document.getElementById('meta');
    if (meta) {
      meta.textContent = 'built ' + (graph.builtAt || '?') + ' from ' + String(graph.sha || '?').slice(0, 7) + ', ' +
        (graph.nodes || []).length + ' nodes, ' + (graph.edges || []).length + ' edges';
    }
    var sections = document.querySelectorAll('section[data-view]');
    Array.prototype.forEach.call(sections, function (section) {
      var name = section.getAttribute('data-view');
      try {
        section.innerHTML = slicekitViews[name](graph);
      } catch (e) {
        section.textContent = 'This view failed: ' + (e && e.message ? e.message : e);
      }
    });
    var buttons = document.querySelectorAll('nav button[data-show]');
    function show(name) {
      Array.prototype.forEach.call(sections, function (s) {
        s.hidden = s.getAttribute('data-view') !== name;
      });
      Array.prototype.forEach.call(buttons, function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-show') === name));
      });
    }
    Array.prototype.forEach.call(buttons, function (b) {
      b.addEventListener('click', function () {
        show(b.getAttribute('data-show'));
      });
    });
    var panel = document.getElementById('detail');
    document.addEventListener('click', function (event) {
      var target = event.target && event.target.closest ? event.target.closest('[data-id]') : null;
      if (!target || !panel) return;
      panel.innerHTML = slicekitViews.detail(graph, target.getAttribute('data-id'));
      if (window.matchMedia && window.matchMedia('(max-width: 760px)').matches && panel.scrollIntoView) panel.scrollIntoView();
    });
  })();
}
