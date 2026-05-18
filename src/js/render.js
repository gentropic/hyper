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
// URL list, per-IDB stores, LS key/value pairs, SW details, and (if logs are
// available) the parsed gcu:log entries for this tool.
function buildToolDetails(tool, inspectResult, logs) {
  const base = crossReferenceStorage(tool.storage, inspectResult);
  base.logEntries = (logs && logs.get && logs.get(tool.name) && logs.get(tool.name).entries) || [];
  return base;
}

// Same shape as buildToolDetails plus the full sessionStorage bucket (no
// tool announces SS ownership, so it's always unattributed).
function buildUnattributedDetails(unattributed, inspectResult) {
  const details = crossReferenceStorage(unattributed, inspectResult);
  details.sessionStorage = inspectResult.sessionStorage || [];
  return details;
}

function crossReferenceStorage(claim, inspectResult) {
  const cacheMap = new Map(inspectResult.caches.map((c) => [c.name, c]));
  const idbMap = new Map(inspectResult.idbs.map((i) => [i.name, i]));
  const lsMap = new Map(inspectResult.localStorage);
  const swMap = new Map(inspectResult.swRegistrations.map((r) => [normalizeScope(r.scope), r]));
  return {
    caches: (claim.cacheNames || [])
      .map((n) => cacheMap.get(n))
      .filter(Boolean)
      .map((c) => ({ name: c.name, urls: c.entryUrls || [] })),
    idbs: (claim.idbNames || [])
      .map((n) => idbMap.get(n))
      .filter(Boolean)
      .map((i) => ({ name: i.name, version: i.version, stores: i.stores || [] })),
    localStorage: (claim.localStorageKeys || [])
      .filter((k) => lsMap.has(k))
      .map((k) => [k, lsMap.get(k)]),
    sws: (claim.swScopes || [])
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

// Pure: shape an image marker for display. createdRel is a relative-time
// string derived against `now` (injectable for tests).
function decorateImage(image, now) {
  const createdAt = image && image.createdAt ? Date.parse(image.createdAt) : null;
  return {
    id: image && image.id,
    name: (image && image.name) || (image && image.id) || '(unnamed)',
    runtime: (image && image.runtime) || null,
    isolation: (image && image.isolation) || null,
    scope: (image && image.scope) || null,
    sizeEstimate: image && typeof image.sizeEstimate === 'number' ? image.sizeEstimate : null,
    createdAt,
    createdRel: createdAt != null && !Number.isNaN(createdAt)
      ? formatLogTime(createdAt, now != null ? now : Date.now())
      : null,
  };
}

// Same shape as decorateTool for the size fields, so renderSizeBar accepts
// either. The "name" field is the synthetic '__unattributed__' sentinel,
// not displayed — main.js looks at the action name to know which compute
// path to take, not the tool name.
function decorateUnattributed(unattributed, inspectResult, cacheSizes) {
  const lsMap = new Map(inspectResult.localStorage);
  let lsBytes = 0;
  for (const k of unattributed.localStorageKeys || []) {
    const v = lsMap.get(k);
    if (v != null) lsBytes += (k.length + v.length) * 2;
  }
  // SessionStorage is entirely unattributed (no tool announces SS ownership).
  for (const [k, v] of inspectResult.sessionStorage || []) {
    lsBytes += (k ? k.length : 0) * 2;
    lsBytes += (v ? v.length : 0) * 2;
  }

  const cacheNames = unattributed.cacheNames || [];
  let cacheBytes = 0;
  const hasCacheSizes = cacheNames.length === 0
    || (cacheSizes != null && cacheNames.every((n) => cacheSizes.has(n)));
  if (cacheSizes) {
    for (const n of cacheNames) {
      const b = cacheSizes.get(n);
      if (typeof b === 'number') cacheBytes += b;
    }
  }

  return {
    name: '__unattributed__',
    cacheCount: cacheNames.length,
    cacheBytes,
    hasCacheSizes,
    lsBytes,
  };
}

// Pure: build the bar segment data for a decorated tool, scaled against
// maxBytes (the largest total across all tools+unattributed, used so bars
// are visually comparable). Cache segment is omitted unless we have the
// data (decorated.hasCacheSizes), since drawing a guessed-size bar would
// mislead the user.
function buildBarSegments(decorated, maxBytes) {
  const segments = [];
  if (decorated.hasCacheSizes && decorated.cacheBytes > 0) {
    segments.push({ label: 'cache', bytes: decorated.cacheBytes });
  }
  if (decorated.lsBytes > 0) {
    segments.push({ label: 'ls', bytes: decorated.lsBytes });
  }
  const total = segments.reduce((s, x) => s + x.bytes, 0);
  const ref = maxBytes > 0 ? maxBytes : 1;
  for (const seg of segments) seg.percent = (seg.bytes / ref) * 100;
  return { segments, totalBytes: total };
}

function decorateTool(tool, inspectResult, cacheSizes) {
  const cacheMap = new Map(inspectResult.caches.map((c) => [c.name, c]));
  const idbMap = new Map(inspectResult.idbs.map((i) => [i.name, i]));
  const lsMap = new Map(inspectResult.localStorage);

  const cacheEntries = (tool.storage.cacheNames || [])
    .map((n) => cacheMap.get(n))
    .filter(Boolean)
    .reduce((s, c) => s + c.entryCount, 0);

  const idbRecords = (tool.storage.idbNames || [])
    .map((n) => idbMap.get(n))
    .filter(Boolean)
    .reduce((s, i) => s + i.stores.reduce((a, st) => a + st.recordCount, 0), 0);

  let lsBytes = 0;
  for (const k of tool.storage.localStorageKeys || []) {
    const v = lsMap.get(k);
    if (v != null) lsBytes += (k.length + v.length) * 2;
  }

  const cacheNames = tool.storage.cacheNames || [];
  let cacheBytes = 0;
  const hasCacheSizes = cacheNames.length === 0
    || (cacheSizes != null && cacheNames.every((n) => cacheSizes.has(n)));
  if (cacheSizes) {
    for (const n of cacheNames) {
      const b = cacheSizes.get(n);
      if (typeof b === 'number') cacheBytes += b;
    }
  }

  return {
    name: tool.name,
    displayName: (tool.announcement && tool.announcement.displayName) || tool.name,
    version: tool.announcement ? (tool.announcement.version || null) : null,
    source: tool.source,
    cacheCount: cacheNames.length,
    cacheEntries,
    cacheBytes,
    hasCacheSizes,
    idbCount: (tool.storage.idbNames || []).length,
    idbRecords,
    localStorageCount: (tool.storage.localStorageKeys || []).length,
    lsBytes,
    swCount: (tool.storage.swScopes || []).length,
  };
}

// --- DOM construction (browser only) -------------------------------------

function renderApp(state, root) {
  root.replaceChildren();

  // Decorate tools + unattributed once so bars across the whole page share
  // the same maxBytes scale.
  const decoratedTools = state.detectResult.tools.map((t) => ({
    tool: t,
    d: decorateTool(t, state.inspectResult, state.cacheSizes),
  }));
  const decoratedUnattributed = decorateUnattributed(
    state.detectResult.unattributed, state.inspectResult, state.cacheSizes,
  );
  const maxBytes = Math.max(1, ...[
    ...decoratedTools.map(({ d }) => d.cacheBytes + d.lsBytes),
    decoratedUnattributed.cacheBytes + decoratedUnattributed.lsBytes,
  ]);

  root.appendChild(renderHeader(state));
  root.appendChild(renderToolList(state, decoratedTools, maxBytes));
  const imageList = renderImageList(state);
  if (imageList) root.appendChild(imageList);
  const ssCount = state.inspectResult.sessionStorage.length;
  if (hasUnattributed(state.detectResult.unattributed) || ssCount > 0) {
    root.appendChild(renderUnattributed(
      state.detectResult.unattributed, state.inspectResult, decoratedUnattributed, maxBytes,
    ));
  }
  const issues = renderIssues(state.detectResult.malformed, state.logWarnings);
  if (issues) root.appendChild(issues);
  root.appendChild(renderGlobalActions());
}

function renderHeader(state) {
  const { origin, detectResult, inspectResult } = state;
  const summary = summaryStats(inspectResult, detectResult, state.images);
  const header = el('header', { class: 'hyper-header' });
  header.appendChild(el('h1', { text: `${origin} — GCU storage` }));
  const sub = el('p', { class: 'hyper-summary' });
  sub.appendChild(el('span', { text: `${summary.toolCount} tool${summary.toolCount === 1 ? '' : 's'} detected` }));
  if (summary.imageCount > 0) {
    sub.appendChild(el('span', { class: 'sep', text: ' · ' }));
    sub.appendChild(el('span', { text: `${summary.imageCount} container${summary.imageCount === 1 ? '' : 's'}` }));
  }
  sub.appendChild(el('span', { class: 'sep', text: ' · ' }));
  sub.appendChild(el('span', { text: `${formatBytes(summary.quotaUsed)} used` }));
  if (summary.quotaTotal != null) {
    sub.appendChild(el('span', { class: 'muted', text: ` (of ${formatBytes(summary.quotaTotal)} quota)` }));
  }
  header.appendChild(sub);
  return header;
}

function summaryStats(inspectResult, detectResult, images) {
  return {
    toolCount: detectResult.tools.length,
    imageCount: (images || []).length,
    quotaUsed: inspectResult.estimate ? inspectResult.estimate.usage : null,
    quotaTotal: inspectResult.estimate ? inspectResult.estimate.quota : null,
  };
}

function renderToolList(state, decoratedTools, maxBytes) {
  const list = el('section', { class: 'hyper-tools' });
  if (state.detectResult.tools.length === 0) {
    list.appendChild(el('p', { class: 'muted', text: 'No GCU tools detected on this origin.' }));
    return list;
  }
  for (const { tool, d } of decoratedTools) {
    list.appendChild(renderToolRow(d, tool, state.inspectResult, maxBytes, state.logs));
  }
  return list;
}

function renderToolRow(t, tool, inspectResult, maxBytes, logs) {
  const row = el('article', { class: `hyper-tool hyper-tool--${t.source}`, data: { tool: t.name } });
  const head = el('div', { class: 'hyper-tool__head' });
  head.appendChild(el('span', { class: 'hyper-tool__name', text: t.displayName }));
  if (t.version) head.appendChild(el('span', { class: 'hyper-tool__version', text: `v${t.version}` }));
  if (t.source === 'heuristic') head.appendChild(el('span', { class: 'hyper-tool__tag', text: 'inferred' }));
  row.appendChild(head);

  const bar = renderSizeBar(t, maxBytes);
  if (bar) row.appendChild(bar);

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

  row.appendChild(renderToolDetails(buildToolDetails(tool, inspectResult, logs)));
  return row;
}

// Returns null when there's nothing meaningful to render (no caches → no
// point comparing). Otherwise either a "compute me" placeholder or the
// actual bar with measured sizes.
//
// options.computeAction selects which dispatch case fires when the user
// clicks Compute (tools use 'compute-cache-sizes' with a tool name;
// unattributed uses 'compute-unattributed-cache-sizes' with no name).
function renderSizeBar(decorated, maxBytes, options = {}) {
  if (decorated.cacheCount === 0) return null;

  const computeAction = options.computeAction || 'compute-cache-sizes';
  const targetName = 'targetName' in options ? options.targetName : decorated.name;

  if (!decorated.hasCacheSizes) {
    const wrap = el('div', { class: 'hyper-bar-wrap hyper-bar-wrap--placeholder' });
    wrap.appendChild(el('span', {
      class: 'hyper-bar-label',
      text: `${decorated.cacheCount} cache${decorated.cacheCount === 1 ? '' : 's'} — size not measured`,
    }));
    wrap.appendChild(actionButton('Compute', computeAction, targetName));
    return wrap;
  }

  const bar = buildBarSegments(decorated, maxBytes);
  const wrap = el('div', { class: 'hyper-bar-wrap' });
  const track = el('div', { class: 'hyper-bar' });
  for (const seg of bar.segments) {
    track.appendChild(el('div', {
      class: `hyper-bar__seg hyper-bar__seg--${seg.label}`,
      attrs: { style: `width: ${seg.percent.toFixed(2)}%`, title: `${seg.label}: ${formatBytes(seg.bytes)}` },
    }));
  }
  wrap.appendChild(track);
  wrap.appendChild(el('div', { class: 'hyper-bar-label', text: `${formatBytes(bar.totalBytes)} total` }));
  return wrap;
}

function renderKVSection(label, entries) {
  const section = el('div', { class: 'hyper-detail-section' });
  section.appendChild(el('h3', { text: label }));
  const table = el('table', { class: 'hyper-detail-kv' });
  for (const [k, v] of entries) {
    const tr = el('tr');
    tr.appendChild(el('th', { text: k, attrs: { scope: 'row' } }));
    tr.appendChild(el('td', { text: v }));
    table.appendChild(tr);
  }
  section.appendChild(table);
  return section;
}

function renderToolDetails(details) {
  const wrap = el('details', { class: 'hyper-tool__details' });
  wrap.appendChild(el('summary', { text: 'Show details' }));

  const ss = details.sessionStorage || [];
  const logs = details.logEntries || [];
  if (details.caches.length === 0 && details.idbs.length === 0 && details.localStorage.length === 0 && details.sws.length === 0 && ss.length === 0 && logs.length === 0) {
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
    wrap.appendChild(renderKVSection('localStorage', details.localStorage));
  }
  if (details.sessionStorage && details.sessionStorage.length) {
    wrap.appendChild(renderKVSection('sessionStorage', details.sessionStorage));
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
  if (logs.length) {
    wrap.appendChild(renderLogSection(logs));
  }
  return wrap;
}

function renderLogSection(entries) {
  const section = el('div', { class: 'hyper-detail-section' });
  section.appendChild(el('h3', { text: `Recent events (${entries.length})` }));
  const list = el('ol', { class: 'hyper-log-list' });
  const now = Date.now();
  // Newest first
  for (const e of [...entries].reverse()) {
    const item = el('li', { class: 'hyper-log__entry' });
    item.appendChild(el('time', {
      class: 'hyper-log__t',
      text: formatLogTime(e.t, now),
      attrs: { datetime: new Date(e.t).toISOString(), title: new Date(e.t).toISOString() },
    }));
    item.appendChild(el('span', { class: `hyper-log__type hyper-log__type--${cssToken(e.type)}`, text: e.type }));
    const msg = formatLogPayload(e);
    if (msg) item.appendChild(el('span', { class: 'hyper-log__msg', text: msg }));
    list.appendChild(item);
  }
  section.appendChild(list);
  return section;
}

// Pure: format a log entry's t (ms since epoch) relative to now.
function formatLogTime(ms, now) {
  const diff = (now != null ? now : Date.now()) - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.round(diff / 86_400_000)}d ago`;
  return new Date(ms).toISOString().slice(0, 10);
}

// Pure: render the non-t/type fields of a log entry as "k=v" pairs.
function formatLogPayload(entry) {
  const fields = Object.keys(entry).filter((k) => k !== 't' && k !== 'type');
  if (!fields.length) return '';
  return fields.map((k) => `${k}=${typeof entry[k] === 'string' ? entry[k] : JSON.stringify(entry[k])}`).join(' · ');
}

function cssToken(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
}

function renderImageList(state) {
  if (!state.images || state.images.length === 0) return null;
  const list = el('section', { class: 'hyper-images' });
  list.appendChild(el('h2', { text: `Containers (${state.images.length})` }));

  // Group by runtime. Show runtime sub-headers only when more than one.
  const byRuntime = new Map();
  for (const img of state.images) {
    const r = img.runtime || '(unknown)';
    if (!byRuntime.has(r)) byRuntime.set(r, []);
    byRuntime.get(r).push(img);
  }
  const showRuntimeHeaders = byRuntime.size > 1;

  for (const [runtime, images] of byRuntime) {
    if (showRuntimeHeaders) {
      list.appendChild(el('h3', { class: 'hyper-images__runtime', text: runtime }));
    }
    for (const img of images) {
      list.appendChild(renderImageRow(decorateImage(img)));
    }
  }
  return list;
}

function renderImageRow(d) {
  const row = el('article', { class: 'hyper-image', data: { image: d.id } });
  const head = el('div', { class: 'hyper-image__head' });
  head.appendChild(el('span', { class: 'hyper-image__name', text: d.name }));
  if (d.isolation) {
    head.appendChild(el('span', {
      class: `hyper-image__iso hyper-image__iso--${d.isolation}`,
      text: d.isolation,
    }));
  }
  if (d.runtime) head.appendChild(el('span', { class: 'hyper-image__runtime', text: d.runtime }));
  row.appendChild(head);

  const meta = el('div', { class: 'hyper-image__meta' });
  if (d.sizeEstimate != null) meta.appendChild(el('span', { text: formatBytes(d.sizeEstimate) }));
  if (d.createdRel) meta.appendChild(el('span', { text: `created ${d.createdRel}` }));
  if (d.scope) meta.appendChild(el('span', { class: 'hyper-image__scope', text: d.scope }));
  row.appendChild(meta);

  const actions = el('div', { class: 'hyper-tool__actions' });
  if (d.scope) actions.appendChild(imageActionButton('Open', 'open-image', d.id));
  actions.appendChild(imageActionButton('Reset', 'reset-image', d.id, 'danger'));
  row.appendChild(actions);

  return row;
}

function imageActionButton(label, action, imageId, variant) {
  return el('button', {
    text: label,
    class: `hyper-btn${variant ? ` hyper-btn--${variant}` : ''}`,
    data: { action, image: imageId },
    attrs: { type: 'button' },
  });
}

function renderUnattributed(unattributed, inspectResult, decoratedUnattributed, maxBytes) {
  const section = el('section', { class: 'hyper-unattributed' });
  section.appendChild(el('h2', { text: 'Unattributed storage' }));
  const ssCount = inspectResult.sessionStorage.length;
  const lines = [
    `${unattributed.cacheNames.length} cache${unattributed.cacheNames.length === 1 ? '' : 's'}`,
    `${unattributed.idbNames.length} IDB`,
    `${unattributed.localStorageKeys.length} LS keys`,
    `${unattributed.swScopes.length} SW`,
  ];
  if (ssCount > 0) lines.push(`${ssCount} SS keys`);
  section.appendChild(el('p', { text: lines.join(' · ') }));

  const bar = renderSizeBar(decoratedUnattributed, maxBytes, {
    computeAction: 'compute-unattributed-cache-sizes',
    targetName: null,
  });
  if (bar) section.appendChild(bar);

  const actions = el('div', { class: 'hyper-tool__actions' });
  actions.appendChild(actionButton('Export', 'export-unattributed'));
  actions.appendChild(actionButton('Reset all', 'reset-unattributed', null, 'danger'));
  section.appendChild(actions);

  section.appendChild(renderToolDetails(buildUnattributedDetails(unattributed, inspectResult)));
  return section;
}

function renderIssues(malformed, logWarnings) {
  const all = [...(malformed || []), ...(logWarnings || [])];
  if (all.length === 0) return null;
  const section = el('section', { class: 'hyper-malformed' });
  section.appendChild(el('h2', { text: 'Issues' }));
  const wrap = el('details');
  wrap.appendChild(el('summary', { text: `${all.length} issue${all.length === 1 ? '' : 's'} detected` }));
  const ul = el('ul');
  for (const m of all) {
    ul.appendChild(el('li', { text: `${m.key}: ${m.reason}` }));
  }
  wrap.appendChild(ul);
  section.appendChild(wrap);
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

function messageDialog({ title, body, danger = false, label = 'Close' }) {
  return new Promise((resolve) => {
    const dialog = el('dialog', { class: `hyper-dialog${danger ? ' hyper-dialog--danger' : ''}` });
    if (title) dialog.appendChild(el('h2', { class: 'hyper-dialog__title', text: title }));
    if (body) dialog.appendChild(el('p', { class: 'hyper-dialog__body', text: body }));
    const actions = el('div', { class: 'hyper-dialog__actions' });
    const close = el('button', { class: 'hyper-btn', text: label, attrs: { type: 'button' } });
    actions.appendChild(close);
    dialog.appendChild(actions);
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { dialog.remove(); resolve(); });
    document.body.appendChild(dialog);
    dialog.showModal();
    close.focus();
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
    formatLogTime,
    formatLogPayload,
    decorateTool,
    decorateUnattributed,
    decorateImage,
    buildBarSegments,
    buildToolDetails,
    buildUnattributedDetails,
    summaryStats,
    hasUnattributed,
    isPhraseAccepted,
  };
}
