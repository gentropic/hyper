// Tool discovery: read gcu:tool:* announcements, fall back to heuristics,
// then attribute observed storage (caches/IDBs/LS/SW scopes) to each tool.
//
// All functions here are pure — they take strings and lists, return objects.
// The browser-side glue (reading localStorage, calling caches.keys() etc.)
// lives in inspect.js. Keeping detect pure makes it node-testable.

const KNOWN_TOOL_NAMES = ['ep', 'calque', 'dee', 'plan', 'rv', 'gcu-press', 'beacon'];

const TOOL_KEY_RE = /^gcu:tool:(.*)$/;
const LOG_KEY_RE = /^gcu:log:(.*)$/;

// 50 KB on disk = "your tool is clearly outside the spec'd ~25 KB worst case".
// See SPEC §gcu:log "Strict caps".
const LOG_RING_SIZE_WARN = 50 * 1024;

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

// Parse the gcu:log:<name> rings per SPEC §gcu:log diagnostic convention.
// Pure: input is localStorage entries, output is parsed logs + warnings.
// Hyper surfaces logs in each tool's show-details section; warnings appear
// alongside malformed announcements so misbehaving tools are visible.
function parseLogs(localStorageEntries) {
  const logs = new Map();
  const warnings = [];
  for (const [key, value] of localStorageEntries) {
    const match = LOG_KEY_RE.exec(key);
    if (!match) continue;
    const suffix = match[1];
    if (!suffix) {
      warnings.push({ key, reason: 'empty tool name' });
      continue;
    }

    // UTF-16 byte estimate of the raw stored value.
    const byteLen = (value || '').length * 2;
    if (byteLen > LOG_RING_SIZE_WARN) {
      warnings.push({
        key,
        reason: `ring is ${Math.round(byteLen / 1024)} KB on disk (cap is ~25 KB; tool may have a logging bug)`,
      });
      // Don't bail — partial info still useful.
    }

    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch {
      warnings.push({ key, reason: 'invalid JSON' });
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      warnings.push({ key, reason: 'expected an object with an entries array' });
      continue;
    }
    if (!Array.isArray(parsed.entries)) {
      warnings.push({ key, reason: 'missing entries[] array' });
      continue;
    }

    // Filter out entries that don't have the minimum shape (t: number, type: string).
    const valid = [];
    for (const e of parsed.entries) {
      if (!e || typeof e !== 'object') continue;
      if (typeof e.t !== 'number' || !Number.isFinite(e.t)) continue;
      if (typeof e.type !== 'string') continue;
      valid.push(e);
    }

    logs.set(suffix, {
      schema: typeof parsed.schema === 'number' ? parsed.schema : 1,
      entries: valid,
    });
  }
  return { logs, warnings };
}

// Collect IDB names to probe when indexedDB.databases() isn't available
// (older Safari, some WebViews). Combines announced IDBs from gcu:tool:*
// markers with KNOWN_TOOL_NAMES as a best-effort fallback for tools that
// haven't shipped the announcement yet.
function gatherIdbHints(localStorageEntries) {
  const { tools } = parseAnnouncements(localStorageEntries);
  const announced = tools.flatMap((t) => (t.storageKeys && t.storageKeys.idb) || []);
  return [...new Set([...announced, ...KNOWN_TOOL_NAMES])];
}

function detectTools(localStorageEntries, observed) {
  const { tools: announced, malformed } = parseAnnouncements(localStorageEntries);
  // Strip gcu:tool:* and gcu:log:* keys from observed LS — they are hyper's
  // own metadata, not tool data to be attributed.
  const lsForAttribution = (observed.localStorageKeys || []).filter(
    (k) => !TOOL_KEY_RE.test(k) && !LOG_KEY_RE.test(k),
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
    LOG_KEY_RE,
    parseAnnouncements,
    parseLogs,
    inferTools,
    attribute,
    detectTools,
    gatherIdbHints,
  };
}
