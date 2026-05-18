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

// Build the "show details" payload for a tool — cross-references the tool's
// claimed storage names against the rich inspect data, returning the per-cache
// URL list, per-IDB stores, LS key/value pairs, and SW details.
function buildToolDetails(tool, inspectResult) {
  const cacheMap = new Map(inspectResult.caches.map((c) => [c.name, c]));
  const idbMap = new Map(inspectResult.idbs.map((i) => [i.name, i]));
  const lsMap = new Map(inspectResult.localStorage);
  const swMap = new Map(inspectResult.swRegistrations.map((r) => [normalizeScope(r.scope), r]));

  return {
    caches: (tool.storage.cacheNames || [])
      .map((n) => cacheMap.get(n))
      .filter(Boolean)
      .map((c) => ({ name: c.name, urls: c.entryUrls || [] })),
    idbs: (tool.storage.idbNames || [])
      .map((n) => idbMap.get(n))
      .filter(Boolean)
      .map((i) => ({ name: i.name, version: i.version, stores: i.stores || [] })),
    localStorage: (tool.storage.localStorageKeys || [])
      .filter((k) => lsMap.has(k))
      .map((k) => [k, lsMap.get(k)]),
    sws: (tool.storage.swScopes || [])
      .map((s) => swMap.get(s))
      .filter(Boolean)
      .map((r) => ({ scope: r.scope, scriptURL: r.scriptURL, state: r.state })),
  };
}

// Inline copy of inspect.normalizeScope. Kept here so render.js stays
// callable in node tests without requiring inspect.js (which depends on
// browser globals at top-level via async functions). Cheap and pure.
function normalizeScope(scope) {
  try { return new URL(scope).pathname; } catch { return scope; }
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
    list.appendChild(renderToolRow(decorateTool(tool, state.inspectResult), tool, state.inspectResult));
  }
  return list;
}

function renderToolRow(t, tool, inspectResult) {
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

  row.appendChild(renderToolDetails(buildToolDetails(tool, inspectResult)));
  return row;
}

function renderToolDetails(details) {
  const wrap = el('details', { class: 'hyper-tool__details' });
  wrap.appendChild(el('summary', { text: 'Show details' }));

  if (details.caches.length === 0 && details.idbs.length === 0 && details.localStorage.length === 0 && details.sws.length === 0) {
    wrap.appendChild(el('p', { class: 'muted', text: 'No storage to inspect.' }));
    return wrap;
  }

  for (const c of details.caches) {
    const section = el('div', { class: 'hyper-detail-section' });
    section.appendChild(el('h3', { text: `cache: ${c.name} (${c.urls.length} entries)` }));
    if (c.urls.length) {
      const ul = el('ul', { class: 'hyper-detail-list' });
      for (const u of c.urls) ul.appendChild(el('li', { text: u }));
      section.appendChild(ul);
    }
    wrap.appendChild(section);
  }
  for (const i of details.idbs) {
    const section = el('div', { class: 'hyper-detail-section' });
    section.appendChild(el('h3', { text: `IDB: ${i.name}${i.version != null ? ` (v${i.version})` : ''}` }));
    if (i.stores.length) {
      const ul = el('ul', { class: 'hyper-detail-list' });
      for (const s of i.stores) ul.appendChild(el('li', { text: `${s.name}: ${s.recordCount} record${s.recordCount === 1 ? '' : 's'}` }));
      section.appendChild(ul);
    }
    wrap.appendChild(section);
  }
  if (details.localStorage.length) {
    const section = el('div', { class: 'hyper-detail-section' });
    section.appendChild(el('h3', { text: 'localStorage' }));
    const table = el('table', { class: 'hyper-detail-kv' });
    for (const [k, v] of details.localStorage) {
      const tr = el('tr');
      tr.appendChild(el('th', { text: k, attrs: { scope: 'row' } }));
      tr.appendChild(el('td', { text: v }));
      table.appendChild(tr);
    }
    section.appendChild(table);
    wrap.appendChild(section);
  }
  for (const sw of details.sws) {
    const section = el('div', { class: 'hyper-detail-section' });
    section.appendChild(el('h3', { text: `SW: ${sw.scope}` }));
    const dl = el('dl', { class: 'hyper-detail-kv' });
    dl.appendChild(el('dt', { text: 'state' }));
    dl.appendChild(el('dd', { text: sw.state }));
    if (sw.scriptURL) {
      dl.appendChild(el('dt', { text: 'script' }));
      dl.appendChild(el('dd', { text: sw.scriptURL }));
    }
    section.appendChild(dl);
    wrap.appendChild(section);
  }
  return wrap;
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

// --- Modal dialogs --------------------------------------------------------

// Pure: case-sensitive equality after trimming. Used by confirmWithPhrase and
// callable independently for testing.
function isPhraseAccepted(input, required) {
  return typeof input === 'string' && input.trim() === required;
}

function confirmDialog({ title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const dialog = el('dialog', { class: 'hyper-dialog' });
    if (title) dialog.appendChild(el('h2', { class: 'hyper-dialog__title', text: title }));
    if (body) dialog.appendChild(el('p', { class: 'hyper-dialog__body', text: body }));
    const actions = el('div', { class: 'hyper-dialog__actions' });
    const cancel = el('button', { class: 'hyper-btn', text: cancelLabel, attrs: { type: 'button' } });
    const confirm = el('button', {
      class: `hyper-btn${danger ? ' hyper-btn--danger' : ''}`,
      text: confirmLabel,
      attrs: { type: 'button' },
    });
    actions.appendChild(cancel);
    actions.appendChild(confirm);
    dialog.appendChild(actions);

    let result = false;
    cancel.addEventListener('click', () => { result = false; dialog.close(); });
    confirm.addEventListener('click', () => { result = true; dialog.close(); });
    dialog.addEventListener('close', () => { dialog.remove(); resolve(result); });

    document.body.appendChild(dialog);
    dialog.showModal();
    cancel.focus();
  });
}

function confirmWithPhrase({ title, body, phrase, confirmLabel = 'Confirm', cancelLabel = 'Cancel' }) {
  return new Promise((resolve) => {
    const dialog = el('dialog', { class: 'hyper-dialog hyper-dialog--danger' });
    if (title) dialog.appendChild(el('h2', { class: 'hyper-dialog__title', text: title }));
    if (body) dialog.appendChild(el('p', { class: 'hyper-dialog__body', text: body }));
    dialog.appendChild(el('p', { class: 'hyper-dialog__prompt', text: `Type "${phrase}" to confirm:` }));
    const input = el('input', { class: 'hyper-dialog__input', attrs: { type: 'text', autocomplete: 'off' } });
    dialog.appendChild(input);

    const actions = el('div', { class: 'hyper-dialog__actions' });
    const cancel = el('button', { class: 'hyper-btn', text: cancelLabel, attrs: { type: 'button' } });
    const confirm = el('button', {
      class: 'hyper-btn hyper-btn--danger',
      text: confirmLabel,
      attrs: { type: 'button', disabled: '' },
    });
    actions.appendChild(cancel);
    actions.appendChild(confirm);
    dialog.appendChild(actions);

    let result = false;
    const sync = () => {
      if (isPhraseAccepted(input.value, phrase)) confirm.removeAttribute('disabled');
      else confirm.setAttribute('disabled', '');
    };
    input.addEventListener('input', sync);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && isPhraseAccepted(input.value, phrase)) {
        e.preventDefault();
        result = true;
        dialog.close();
      }
    });
    cancel.addEventListener('click', () => { result = false; dialog.close(); });
    confirm.addEventListener('click', () => {
      if (isPhraseAccepted(input.value, phrase)) { result = true; dialog.close(); }
    });
    dialog.addEventListener('close', () => { dialog.remove(); resolve(result); });

    document.body.appendChild(dialog);
    dialog.showModal();
    input.focus();
  });
}

if (typeof module !== 'undefined') {
  module.exports = {
    formatBytes,
    decorateTool,
    buildToolDetails,
    summaryStats,
    hasUnattributed,
    isPhraseAccepted,
  };
}
