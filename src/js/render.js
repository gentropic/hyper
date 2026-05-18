// DOM rendering: take a detect/inspect result, produce the UI from SPEC §UI shape.
//
// Two layers, same pattern as inspect.js:
// 1. Pure helpers (formatBytes, decorateTool) — node-testable.
// 2. renderApp(state, root) — DOM construction; eyeball in browser.
//
// Action buttons carry data-action / data-tool attributes; main.js binds a
// single delegated click handler. Until actions.js exists, clicks are no-ops.

function formatBytes(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function decorateTool(tool, inspectResult) {
  const cacheMap = new Map(inspectResult.caches.map((c) => [c.name, c]));
  const idbMap = new Map(inspectResult.idbs.map((i) => [i.name, i]));

  const cacheEntries = (tool.storage.cacheNames || [])
    .map((n) => cacheMap.get(n))
    .filter(Boolean)
    .reduce((s, c) => s + c.entryCount, 0);

  const idbRecords = (tool.storage.idbNames || [])
    .map((n) => idbMap.get(n))
    .filter(Boolean)
    .reduce((s, i) => s + i.stores.reduce((a, st) => a + st.recordCount, 0), 0);

  return {
    name: tool.name,
    displayName: (tool.announcement && tool.announcement.displayName) || tool.name,
    version: tool.announcement ? (tool.announcement.version || null) : null,
    source: tool.source,
    cacheCount: (tool.storage.cacheNames || []).length,
    cacheEntries,
    idbCount: (tool.storage.idbNames || []).length,
    idbRecords,
    localStorageCount: (tool.storage.localStorageKeys || []).length,
    swCount: (tool.storage.swScopes || []).length,
  };
}

// --- DOM construction (browser only) -------------------------------------

function renderApp(state, root) {
  root.replaceChildren();
  root.appendChild(renderHeader(state));
  root.appendChild(renderToolList(state));
  if (hasUnattributed(state.detectResult.unattributed)) {
    root.appendChild(renderUnattributed(state.detectResult.unattributed));
  }
  if (state.detectResult.malformed.length) {
    root.appendChild(renderMalformed(state.detectResult.malformed));
  }
  root.appendChild(renderGlobalActions());
}

function renderHeader(state) {
  const { origin, detectResult, inspectResult } = state;
  const summary = summaryStats(inspectResult, detectResult);
  const header = el('header', { class: 'hyper-header' });
  header.appendChild(el('h1', { text: `${origin} — GCU storage` }));
  const sub = el('p', { class: 'hyper-summary' });
  sub.appendChild(el('span', { text: `${summary.toolCount} tool${summary.toolCount === 1 ? '' : 's'} detected` }));
  sub.appendChild(el('span', { class: 'sep', text: ' · ' }));
  sub.appendChild(el('span', { text: `${formatBytes(summary.quotaUsed)} used` }));
  if (summary.quotaTotal != null) {
    sub.appendChild(el('span', { class: 'muted', text: ` (of ${formatBytes(summary.quotaTotal)} quota)` }));
  }
  header.appendChild(sub);
  return header;
}

function summaryStats(inspectResult, detectResult) {
  return {
    toolCount: detectResult.tools.length,
    quotaUsed: inspectResult.estimate ? inspectResult.estimate.usage : null,
    quotaTotal: inspectResult.estimate ? inspectResult.estimate.quota : null,
  };
}

function renderToolList(state) {
  const list = el('section', { class: 'hyper-tools' });
  if (state.detectResult.tools.length === 0) {
    list.appendChild(el('p', { class: 'muted', text: 'No GCU tools detected on this origin.' }));
    return list;
  }
  for (const tool of state.detectResult.tools) {
    list.appendChild(renderToolRow(decorateTool(tool, state.inspectResult)));
  }
  return list;
}

function renderToolRow(t) {
  const row = el('article', { class: `hyper-tool hyper-tool--${t.source}`, data: { tool: t.name } });
  const head = el('div', { class: 'hyper-tool__head' });
  head.appendChild(el('span', { class: 'hyper-tool__name', text: t.displayName }));
  if (t.version) head.appendChild(el('span', { class: 'hyper-tool__version', text: `v${t.version}` }));
  if (t.source === 'heuristic') head.appendChild(el('span', { class: 'hyper-tool__tag', text: 'inferred' }));
  row.appendChild(head);

  const stats = el('div', { class: 'hyper-tool__stats' });
  stats.appendChild(el('span', { text: `${t.cacheCount} cache${t.cacheCount === 1 ? '' : 's'} (${t.cacheEntries} entries)` }));
  stats.appendChild(el('span', { text: `${t.idbCount} IDB (${t.idbRecords} records)` }));
  stats.appendChild(el('span', { text: `${t.localStorageCount} LS keys` }));
  stats.appendChild(el('span', { text: `${t.swCount} SW` }));
  row.appendChild(stats);

  const actions = el('div', { class: 'hyper-tool__actions' });
  actions.appendChild(actionButton('Export', 'export-tool', t.name));
  actions.appendChild(actionButton('Force refresh', 'refresh-tool', t.name));
  actions.appendChild(actionButton('Reset', 'reset-tool', t.name, 'danger'));
  row.appendChild(actions);

  return row;
}

function renderUnattributed(unattributed) {
  const section = el('section', { class: 'hyper-unattributed' });
  section.appendChild(el('h2', { text: 'Unattributed storage' }));
  const lines = [
    `${unattributed.cacheNames.length} cache${unattributed.cacheNames.length === 1 ? '' : 's'}`,
    `${unattributed.idbNames.length} IDB`,
    `${unattributed.localStorageKeys.length} LS keys`,
    `${unattributed.swScopes.length} SW`,
  ];
  section.appendChild(el('p', { text: lines.join(' · ') }));
  return section;
}

function renderMalformed(malformed) {
  const section = el('section', { class: 'hyper-malformed' });
  section.appendChild(el('h2', { text: 'Malformed announcements' }));
  const ul = el('ul');
  for (const m of malformed) {
    ul.appendChild(el('li', { text: `${m.key}: ${m.reason}` }));
  }
  section.appendChild(ul);
  return section;
}

function renderGlobalActions() {
  const section = el('section', { class: 'hyper-global-actions' });
  section.appendChild(actionButton('Export all', 'export-all'));
  section.appendChild(actionButton('Refresh all', 'refresh-all'));
  section.appendChild(actionButton('Reset everything', 'nuke', null, 'danger'));
  return section;
}

function actionButton(label, action, toolName, variant) {
  const data = { action };
  if (toolName) data.tool = toolName;
  return el('button', {
    text: label,
    class: `hyper-btn${variant ? ` hyper-btn--${variant}` : ''}`,
    data,
    attrs: { type: 'button' },
  });
}

function hasUnattributed(u) {
  return u.cacheNames.length + u.idbNames.length + u.localStorageKeys.length + u.swScopes.length > 0;
}

// Tiny createElement helper — keeps the call sites readable and avoids
// innerHTML entirely (so tool names from localStorage can't inject markup).
function el(tag, opts = {}) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  if (opts.data) for (const [k, v] of Object.entries(opts.data)) node.dataset[k] = v;
  return node;
}

if (typeof module !== 'undefined') {
  module.exports = { formatBytes, decorateTool, summaryStats, hasUnattributed };
}
