// Bundle IDB + localStorage (+ sessionStorage) into the JSON shape from
// SPEC §Export, and trigger a browser download.
//
// Pure layer (testable): buildBundle, buildToolBundle, filenameTimestamp.
// Browser layer: readIdbContents (cursor walk per store), downloadBundle
//                (Blob + synthetic <a download> click).
//
// Cache Storage is intentionally NOT included — caches are regenerable from
// the network. SPEC mentions an opt-in "include caches" toggle; deferred.

function buildBundle({ detectResult, idbContents, lsEntries, ssEntries, origin, exportedAt }) {
  const lsMap = toMap(lsEntries);
  const ssMap = toMap(ssEntries);
  const idbMap = toMap(idbContents);

  const tools = {};
  for (const tool of detectResult.tools) {
    tools[tool.name] = buildToolBundle(tool, idbMap, lsMap);
  }

  const unattributed = {
    idb: pickKeys(idbMap, detectResult.unattributed.idbNames),
    localStorage: pickKeys(lsMap, detectResult.unattributed.localStorageKeys),
    sessionStorage: Object.fromEntries(ssMap),
  };

  return {
    exportedAt: exportedAt || new Date().toISOString(),
    exportedFrom: origin || '',
    tools,
    unattributed,
  };
}

function buildToolBundle(tool, idbMap, lsMap) {
  const out = {
    version: (tool.announcement && tool.announcement.version) || null,
    source: tool.source,
    idb: pickKeys(idbMap, tool.storage.idbNames || []),
    localStorage: pickKeys(lsMap, tool.storage.localStorageKeys || []),
  };
  return out;
}

function pickKeys(map, keys) {
  const out = {};
  for (const k of keys) {
    if (map.has(k)) out[k] = map.get(k);
  }
  return out;
}

function toMap(input) {
  if (!input) return new Map();
  if (input instanceof Map) return input;
  if (Array.isArray(input)) return new Map(input);
  return new Map(Object.entries(input));
}

function filenameTimestamp(date) {
  return (date || new Date()).toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

// --- Browser layer -------------------------------------------------------

function readIdbContents(name) {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { resolve({}); return; }
    const req = indexedDB.open(name);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
    req.onsuccess = async () => {
      const db = req.result;
      const out = {};
      try {
        for (const storeName of db.objectStoreNames) {
          out[storeName] = await readStore(db, storeName);
        }
        db.close();
        resolve(out);
      } catch (e) {
        db.close();
        reject(e);
      }
    };
  });
}

function readStore(db, storeName) {
  return new Promise((resolve, reject) => {
    const records = [];
    const req = db.transaction(storeName, 'readonly').objectStore(storeName).openCursor();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        records.push(cursor.value);
        cursor.continue();
      } else {
        resolve(records);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

function downloadBundle(bundle, filename) {
  if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof document === 'undefined') {
    return false;
  }
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

// --- Orchestrators -------------------------------------------------------

async function exportAll(state) {
  const idbNames = uniq([
    ...state.detectResult.tools.flatMap((t) => t.storage.idbNames || []),
    ...state.detectResult.unattributed.idbNames,
  ]);
  const idbContents = await readManyIdbs(idbNames);
  const bundle = buildBundle({
    detectResult: state.detectResult,
    idbContents,
    lsEntries: state.inspectResult.localStorage,
    ssEntries: state.inspectResult.sessionStorage,
    origin: state.origin,
  });
  downloadBundle(bundle, `hyper-export-${filenameTimestamp()}.json`);
  return bundle;
}

async function exportTool(state, toolName) {
  const tool = state.detectResult.tools.find((t) => t.name === toolName);
  if (!tool) throw new Error(`tool not found: ${toolName}`);
  const idbContents = await readManyIdbs(tool.storage.idbNames || []);
  const synthetic = {
    tools: [tool],
    unattributed: { idbNames: [], localStorageKeys: [], cacheNames: [], swScopes: [] },
    malformed: [],
  };
  const bundle = buildBundle({
    detectResult: synthetic,
    idbContents,
    lsEntries: state.inspectResult.localStorage,
    ssEntries: state.inspectResult.sessionStorage,
    origin: state.origin,
  });
  downloadBundle(bundle, `hyper-export-${tool.name}-${filenameTimestamp()}.json`);
  return bundle;
}

async function readManyIdbs(names) {
  const map = new Map();
  for (const name of names) {
    try {
      map.set(name, await readIdbContents(name));
    } catch (e) {
      map.set(name, { __error: String(e && e.message ? e.message : e) });
    }
  }
  return map;
}

function uniq(arr) { return [...new Set(arr)]; }

if (typeof module !== 'undefined') {
  module.exports = {
    buildBundle,
    buildToolBundle,
    pickKeys,
    toMap,
    filenameTimestamp,
    readIdbContents,
    downloadBundle,
    exportAll,
    exportTool,
  };
}
