// Enumerate caches, IDB databases, localStorage, sessionStorage, and SW
// registrations on the current origin. Two layers:
//
// 1. Browser-side enumerators (listCaches, listIdbs, ...) call the platform
//    APIs. Each guards on `typeof <global> === 'undefined'` so the module is
//    safe to require in node — missing APIs degrade to empty results.
// 2. Pure helpers (toObserved, summarizeCache, summarizeOrigin, ...) take the
//    enumerator output and reshape/summarize it. These are node-testable.
//
// Note on IDB: indexedDB.databases() is not available on every browser. When
// missing we return []. Callers that want pre-2023 Safari / older WebView
// coverage can fall back to opening names from gcu:tool announcements.

async function inspectOrigin({ idbHints = [] } = {}) {
  const [cacheList, idbList, ls, ss, swList, estimate] = await Promise.all([
    listCaches(),
    listIdbs(idbHints),
    Promise.resolve(listLocalStorage()),
    Promise.resolve(listSessionStorage()),
    listServiceWorkers(),
    getQuotaEstimate(),
  ]);
  return {
    caches: cacheList,
    idbs: idbList,
    localStorage: ls,
    sessionStorage: ss,
    swRegistrations: swList,
    estimate,
  };
}

async function listCaches() {
  if (typeof caches === 'undefined') return [];
  const names = await caches.keys();
  const results = [];
  for (const name of names) {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    results.push({
      name,
      entryCount: keys.length,
      entryUrls: keys.map((r) => r.url),
    });
  }
  return results;
}

async function listIdbs(hints = []) {
  if (typeof indexedDB === 'undefined') return [];
  if (typeof indexedDB.databases === 'function') return enumerateIdbsNative();
  return enumerateIdbsByHints(hints);
}

async function enumerateIdbsNative() {
  const dbs = await indexedDB.databases();
  const results = [];
  for (const meta of dbs) {
    if (!meta.name) continue;
    try {
      const db = await openIdb(meta.name);
      const stores = [];
      for (const storeName of db.objectStoreNames) {
        stores.push({ name: storeName, recordCount: await countRecords(db, storeName) });
      }
      db.close();
      results.push({ name: meta.name, version: meta.version, stores });
    } catch (e) {
      results.push({ name: meta.name, version: meta.version, stores: [], error: String(e) });
    }
  }
  return results;
}

// Fallback for browsers without indexedDB.databases() (older Safari, some
// WebViews). Probes each candidate name; uses onupgradeneeded(oldVersion=0)
// to detect when we accidentally created an empty DB, then deletes it so
// the probe doesn't pollute the user's origin.
async function enumerateIdbsByHints(names) {
  const results = [];
  for (const name of names) {
    const result = await openIdbIfExists(name);
    if (result) results.push(result);
  }
  return results;
}

function openIdbIfExists(name) {
  return new Promise((resolve) => {
    let createdByUs = false;
    const req = indexedDB.open(name);
    req.onupgradeneeded = (e) => {
      if (e.oldVersion === 0) createdByUs = true;
    };
    req.onsuccess = async () => {
      const db = req.result;
      if (createdByUs) {
        db.close();
        await new Promise((res) => {
          const del = indexedDB.deleteDatabase(name);
          del.onsuccess = () => res();
          del.onerror = () => res();
          del.onblocked = () => res();
        });
        resolve(null);
        return;
      }
      try {
        const stores = [];
        for (const storeName of db.objectStoreNames) {
          stores.push({ name: storeName, recordCount: await countRecords(db, storeName) });
        }
        db.close();
        resolve({ name, version: db.version, stores });
      } catch (e) {
        db.close();
        resolve({ name, version: db.version, stores: [], error: String(e) });
      }
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function openIdb(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
}

function countRecords(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function listLocalStorage() {
  return readStorage(typeof localStorage === 'undefined' ? null : localStorage);
}

function listSessionStorage() {
  return readStorage(typeof sessionStorage === 'undefined' ? null : sessionStorage);
}

function readStorage(store) {
  if (!store) return [];
  const entries = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key === null) continue;
    entries.push([key, store.getItem(key)]);
  }
  return entries;
}

async function listServiceWorkers() {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return [];
  const regs = await navigator.serviceWorker.getRegistrations();
  return regs.map((r) => {
    const worker = r.active || r.waiting || r.installing;
    return {
      scope: r.scope,
      scriptURL: worker ? worker.scriptURL : null,
      state: worker ? worker.state : 'none',
    };
  });
}

async function getQuotaEstimate() {
  if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.estimate) return null;
  return await navigator.storage.estimate();
}

// --- Size helpers --------------------------------------------------------
//
// Cheap-and-pure: LS / SS byte totals are derived from string lengths
// (UTF-16, 2 bytes per char). Run on every load.
//
// Expensive-and-async: cache byte totals require fetching every Response
// body. Opt-in only — main.js triggers via "compute sizes" action; default
// load skips it to preserve hyper's escape-hatch fast-paint property.

function bytesForLocalStorage(entries) {
  return sumStringBytes(entries);
}

function bytesForSessionStorage(entries) {
  return sumStringBytes(entries);
}

function sumStringBytes(entries) {
  let total = 0;
  for (const [k, v] of entries || []) {
    total += (k ? k.length : 0) * 2;
    total += (v ? v.length : 0) * 2;
  }
  return total;
}

async function bytesForCache(name) {
  if (typeof caches === 'undefined') return 0;
  const cache = await caches.open(name);
  const keys = await cache.keys();
  let total = 0;
  for (const req of keys) {
    const res = await cache.match(req);
    if (!res) continue;
    const blob = await res.blob();
    total += blob.size;
  }
  return total;
}

async function bytesForCaches(names) {
  const out = new Map();
  for (const name of names) {
    try {
      out.set(name, await bytesForCache(name));
    } catch {
      out.set(name, null); // null = could not compute (e.g. opaque response)
    }
  }
  return out;
}

// --- Pure helpers --------------------------------------------------------

// Extract the minimal shape that detect.detectTools consumes.
function toObserved(inspectResult) {
  return {
    cacheNames: inspectResult.caches.map((c) => c.name),
    idbNames: inspectResult.idbs.map((i) => i.name),
    localStorageKeys: inspectResult.localStorage.map(([k]) => k),
    swScopes: inspectResult.swRegistrations.map((r) => normalizeScope(r.scope)),
  };
}

// SW scopes come back from getRegistrations() as full URLs ("https://host/ep/").
// detect's heuristics work in path space ("/ep/"), so we strip to pathname.
function normalizeScope(scope) {
  try {
    return new URL(scope).pathname;
  } catch {
    return scope;
  }
}

function distinctHosts(urls) {
  const hosts = new Set();
  for (const u of urls) {
    try { hosts.add(new URL(u).host); } catch { /* skip non-URLs */ }
  }
  return [...hosts];
}

function summarizeCache(cache) {
  return {
    name: cache.name,
    entryCount: cache.entryCount,
    distinctHosts: distinctHosts(cache.entryUrls || []),
  };
}

function summarizeOrigin(inspectResult) {
  const cacheEntryTotal = inspectResult.caches.reduce((s, c) => s + c.entryCount, 0);
  const idbRecordTotal = inspectResult.idbs.reduce(
    (s, i) => s + i.stores.reduce((a, st) => a + st.recordCount, 0),
    0,
  );
  return {
    cacheCount: inspectResult.caches.length,
    cacheEntryTotal,
    idbCount: inspectResult.idbs.length,
    idbRecordTotal,
    localStorageCount: inspectResult.localStorage.length,
    sessionStorageCount: inspectResult.sessionStorage.length,
    swCount: inspectResult.swRegistrations.length,
    quotaUsed: inspectResult.estimate ? inspectResult.estimate.usage : null,
    quotaTotal: inspectResult.estimate ? inspectResult.estimate.quota : null,
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    inspectOrigin,
    listCaches,
    listIdbs,
    listLocalStorage,
    listSessionStorage,
    listServiceWorkers,
    getQuotaEstimate,
    bytesForLocalStorage,
    bytesForSessionStorage,
    bytesForCache,
    bytesForCaches,
    toObserved,
    normalizeScope,
    distinctHosts,
    summarizeCache,
    summarizeOrigin,
  };
}
