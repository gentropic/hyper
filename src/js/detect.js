// Tool discovery: read gcu:tool:* announcements, fall back to heuristics,
// then attribute observed storage (caches/IDBs/LS/SW scopes) to each tool.
//
// All functions here are pure — they take strings and lists, return objects.
// The browser-side glue (reading localStorage, calling caches.keys() etc.)
// lives in inspect.js. Keeping detect pure makes it node-testable.

const KNOWN_TOOL_NAMES = ['ep', 'calque', 'dee', 'plan', 'rv', 'gcu-press', 'beacon'];

const TOOL_KEY_RE = /^gcu:tool:(.*)$/;

function parseAnnouncements(localStorageEntries) {
  const tools = [];
  const malformed = [];
  for (const [key, value] of localStorageEntries) {
    const match = TOOL_KEY_RE.exec(key);
    if (!match) continue;
    const suffix = match[1];
    if (!suffix) {
      malformed.push({ key, reason: 'empty name suffix' });
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch {
      malformed.push({ key, reason: 'invalid JSON' });
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      malformed.push({ key, reason: 'announcement is not an object' });
      continue;
    }
    if (parsed.name !== suffix) {
      malformed.push({
        key,
        reason: `name field "${parsed.name}" does not match key suffix "${suffix}"`,
      });
      continue;
    }
    tools.push({
      name: suffix,
      source: 'announcement',
      announcement: parsed,
      storageKeys: parsed.storageKeys || {},
    });
  }
  return { tools, malformed };
}

function inferTools(observed, alreadyKnownNames) {
  const known = new Set(alreadyKnownNames);
  const inferred = new Map();

  const ensure = (name) => {
    if (known.has(name) || !KNOWN_TOOL_NAMES.includes(name)) return null;
    if (!inferred.has(name)) {
      inferred.set(name, {
        name,
        source: 'heuristic',
        announcement: null,
        storageKeys: {
          idb: [],
          cacheNames: [],
          swScopes: [],
          localStoragePrefix: `${name}:`,
        },
      });
    }
    return inferred.get(name);
  };

  const pushUnique = (arr, item) => { if (!arr.includes(item)) arr.push(item); };

  for (const idb of observed.idbNames || []) {
    if (KNOWN_TOOL_NAMES.includes(idb)) {
      const tool = ensure(idb);
      if (tool) pushUnique(tool.storageKeys.idb, idb);
    }
  }
  for (const cache of observed.cacheNames || []) {
    for (const name of KNOWN_TOOL_NAMES) {
      if (cache === name || cache.startsWith(`${name}-`)) {
        const tool = ensure(name);
        if (tool) pushUnique(tool.storageKeys.cacheNames, cache);
        break;
      }
    }
  }
  for (const scope of observed.swScopes || []) {
    for (const name of KNOWN_TOOL_NAMES) {
      if (scope === `/${name}/` || scope.startsWith(`/${name}/`)) {
        const tool = ensure(name);
        if (tool) pushUnique(tool.storageKeys.swScopes, scope);
        break;
      }
    }
  }
  for (const lsKey of observed.localStorageKeys || []) {
    for (const name of KNOWN_TOOL_NAMES) {
      if (lsKey.startsWith(`${name}:`)) {
        ensure(name);
        break;
      }
    }
  }

  return [...inferred.values()];
}

function attribute(tools, observed) {
  const cacheNames = new Set(observed.cacheNames || []);
  const idbNames = new Set(observed.idbNames || []);
  const localStorageKeys = new Set(observed.localStorageKeys || []);
  const swScopes = new Set(observed.swScopes || []);

  const attributed = {};
  for (const tool of tools) {
    const claim = { cacheNames: [], idbNames: [], localStorageKeys: [], swScopes: [] };
    const sk = tool.storageKeys || {};
    for (const name of sk.cacheNames || []) {
      if (cacheNames.delete(name)) claim.cacheNames.push(name);
    }
    for (const name of sk.idb || []) {
      if (idbNames.delete(name)) claim.idbNames.push(name);
    }
    for (const scope of sk.swScopes || []) {
      if (swScopes.delete(scope)) claim.swScopes.push(scope);
    }
    if (sk.localStoragePrefix) {
      for (const key of [...localStorageKeys]) {
        if (key.startsWith(sk.localStoragePrefix)) {
          claim.localStorageKeys.push(key);
          localStorageKeys.delete(key);
        }
      }
    }
    attributed[tool.name] = claim;
  }
  return {
    attributed,
    unattributed: {
      cacheNames: [...cacheNames],
      idbNames: [...idbNames],
      localStorageKeys: [...localStorageKeys],
      swScopes: [...swScopes],
    },
  };
}

function detectTools(localStorageEntries, observed) {
  const { tools: announced, malformed } = parseAnnouncements(localStorageEntries);
  // Strip gcu:tool:* keys from observed LS — they are hyper's own metadata,
  // not tool data to be attributed.
  const lsForAttribution = (observed.localStorageKeys || []).filter(
    (k) => !TOOL_KEY_RE.test(k),
  );
  const observedForInference = { ...observed, localStorageKeys: lsForAttribution };
  const inferred = inferTools(observedForInference, announced.map((t) => t.name));
  const allTools = [...announced, ...inferred];
  const { attributed, unattributed } = attribute(allTools, observedForInference);
  return {
    tools: allTools.map((t) => ({ ...t, storage: attributed[t.name] })),
    unattributed,
    malformed,
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    KNOWN_TOOL_NAMES,
    TOOL_KEY_RE,
    parseAnnouncements,
    inferTools,
    attribute,
    detectTools,
  };
}
