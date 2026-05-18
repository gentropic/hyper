// Destructive operations: clear caches / unregister SWs / delete IDBs /
// clear LS, plus the orchestrations (force-refresh, reset-tool, nuke).
//
// Same two-layer pattern as inspect.js:
//   - plan* helpers are pure (testable) and produce the data shown in
//     confirmation dialogs ("will delete: 2 caches, 1 SW, ...").
//   - exec* functions touch platform APIs; each guards on `typeof`.
//
// Confirmation gating lives in main.js — actions here just do the work.

// --- Pure planning helpers ------------------------------------------------

function planResetTool(tool) {
  const sk = (tool && tool.storage) || {};
  return {
    cacheNames: sk.cacheNames || [],
    swScopes: sk.swScopes || [],
    idbNames: sk.idbNames || [],
    localStorageKeys: sk.localStorageKeys || [],
    sessionStorageKeys: [],
  };
}

function planForceRefresh(tool) {
  const sk = (tool && tool.storage) || {};
  return {
    cacheNames: sk.cacheNames || [],
    swScopes: sk.swScopes || [],
    url: pickToolURL(tool),
  };
}

function planNuke(inspectResult) {
  return {
    cacheNames: inspectResult.caches.map((c) => c.name),
    swScopes: inspectResult.swRegistrations.map((r) => r.scope),
    idbNames: inspectResult.idbs.map((i) => i.name),
    localStorageKeys: inspectResult.localStorage.map(([k]) => k),
    sessionStorageKeys: inspectResult.sessionStorage.map(([k]) => k),
  };
}

function pickToolURL(tool) {
  if (!tool) return null;
  const links = tool.announcement && tool.announcement.links;
  if (links && links.homepage) return links.homepage;
  const scopes = tool.storage && tool.storage.swScopes;
  if (scopes && scopes[0]) return scopes[0];
  return null;
}

function describePlan(plan) {
  const parts = [];
  const pushIf = (count, singular, plural) => {
    if (count > 0) parts.push(`${count} ${count === 1 ? singular : plural}`);
  };
  pushIf((plan.cacheNames || []).length, 'cache', 'caches');
  pushIf((plan.swScopes || []).length, 'service worker', 'service workers');
  pushIf((plan.idbNames || []).length, 'IDB database', 'IDB databases');
  pushIf((plan.localStorageKeys || []).length, 'localStorage key', 'localStorage keys');
  pushIf((plan.sessionStorageKeys || []).length, 'sessionStorage key', 'sessionStorage keys');
  return parts.length ? parts.join(', ') : 'nothing';
}

// --- Browser-side primitives ----------------------------------------------

async function clearCaches(names) {
  if (typeof caches === 'undefined') return { cleared: [] };
  const cleared = [];
  for (const name of names) {
    if (await caches.delete(name)) cleared.push(name);
  }
  return { cleared };
}

async function unregisterScopes(scopes) {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
    return { unregistered: [] };
  }
  const targets = new Set(scopes);
  const regs = await navigator.serviceWorker.getRegistrations();
  const unregistered = [];
  for (const reg of regs) {
    if (targets.has(reg.scope) || targets.has(scopePath(reg.scope))) {
      if (await reg.unregister()) unregistered.push(reg.scope);
    }
  }
  return { unregistered };
}

function scopePath(scope) {
  try { return new URL(scope).pathname; } catch { return scope; }
}

function deleteIdbs(names) {
  if (typeof indexedDB === 'undefined') return Promise.resolve({ deleted: [], blocked: [], errors: [] });
  return Promise.all(names.map(deleteIdb)).then((results) => ({
    deleted: results.filter((r) => r.status === 'deleted').map((r) => r.name),
    blocked: results.filter((r) => r.status === 'blocked').map((r) => r.name),
    errors: results.filter((r) => r.status === 'error').map((r) => r.name),
  }));
}

function deleteIdb(name) {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve({ name, status: 'deleted' });
    req.onerror = () => resolve({ name, status: 'error' });
    // Blocked means another tab holds the DB open; we resolve so the UI can
    // tell the user. The delete request itself stays pending and may complete
    // later when the blocker closes. Re-running will be a no-op by then.
    req.onblocked = () => resolve({ name, status: 'blocked' });
  });
}

function clearLocalStorageKeys(keys) {
  if (typeof localStorage === 'undefined') return { cleared: [] };
  return clearStorageKeys(localStorage, keys);
}

function clearSessionStorageKeys(keys) {
  if (typeof sessionStorage === 'undefined') return { cleared: [] };
  return clearStorageKeys(sessionStorage, keys);
}

function clearStorageKeys(store, keys) {
  const cleared = [];
  for (const k of keys) {
    if (store.getItem(k) !== null) {
      store.removeItem(k);
      cleared.push(k);
    }
  }
  return { cleared };
}

// --- Orchestrations -------------------------------------------------------

async function resetTool(tool) {
  const plan = planResetTool(tool);
  const [c, s, i, l] = await Promise.all([
    clearCaches(plan.cacheNames),
    unregisterScopes(plan.swScopes),
    deleteIdbs(plan.idbNames),
    Promise.resolve(clearLocalStorageKeys(plan.localStorageKeys)),
  ]);
  return { caches: c, sws: s, idbs: i, localStorage: l };
}

async function forceRefreshTool(tool, openURL) {
  const plan = planForceRefresh(tool);
  const [s, c] = await Promise.all([
    unregisterScopes(plan.swScopes),
    clearCaches(plan.cacheNames),
  ]);
  if (plan.url && typeof openURL === 'function') openURL(plan.url);
  return { caches: c, sws: s, url: plan.url };
}

async function refreshAllTools(detectResult) {
  const results = [];
  for (const tool of detectResult.tools) {
    const plan = planForceRefresh(tool);
    const [s, c] = await Promise.all([
      unregisterScopes(plan.swScopes),
      clearCaches(plan.cacheNames),
    ]);
    results.push({ tool: tool.name, caches: c, sws: s });
  }
  return { results };
}

async function nukeOrigin(inspectResult) {
  const plan = planNuke(inspectResult);
  const [c, s, i, l, ss] = await Promise.all([
    clearCaches(plan.cacheNames),
    unregisterScopes(plan.swScopes),
    deleteIdbs(plan.idbNames),
    Promise.resolve(clearLocalStorageKeys(plan.localStorageKeys)),
    Promise.resolve(clearSessionStorageKeys(plan.sessionStorageKeys)),
  ]);
  return { caches: c, sws: s, idbs: i, localStorage: l, sessionStorage: ss };
}

if (typeof module !== 'undefined') {
  module.exports = {
    planResetTool,
    planForceRefresh,
    planNuke,
    pickToolURL,
    describePlan,
    scopePath,
    clearCaches,
    unregisterScopes,
    deleteIdbs,
    clearLocalStorageKeys,
    clearSessionStorageKeys,
    resetTool,
    forceRefreshTool,
    refreshAllTools,
    nukeOrigin,
  };
}
