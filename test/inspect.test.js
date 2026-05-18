const test = require('node:test');
const assert = require('node:assert/strict');
const {
  listCaches,
  listIdbs,
  listLocalStorage,
  listSessionStorage,
  listServiceWorkers,
  getQuotaEstimate,
  toObserved,
  normalizeScope,
  distinctHosts,
  summarizeCache,
  summarizeOrigin,
  bytesForLocalStorage,
  bytesForSessionStorage,
  bytesForCache,
} = require('../src/js/inspect');

// --- Graceful degradation when browser globals are missing (node default) ---

test('listCaches: empty when caches global is missing', async () => {
  assert.deepEqual(await listCaches(), []);
});

test('listIdbs: empty when indexedDB global is missing', async () => {
  assert.deepEqual(await listIdbs(), []);
});

test('listLocalStorage: empty when localStorage is missing', () => {
  assert.deepEqual(listLocalStorage(), []);
});

test('listSessionStorage: empty when sessionStorage is missing', () => {
  assert.deepEqual(listSessionStorage(), []);
});

test('listServiceWorkers: empty when navigator.serviceWorker is missing', async () => {
  assert.deepEqual(await listServiceWorkers(), []);
});

test('getQuotaEstimate: null when navigator.storage is missing', async () => {
  assert.equal(await getQuotaEstimate(), null);
});

// --- Pure helpers --------------------------------------------------------

test('normalizeScope: full URL → pathname', () => {
  assert.equal(normalizeScope('https://gentropic.org/ep/'), '/ep/');
});

test('normalizeScope: bare path is returned unchanged', () => {
  assert.equal(normalizeScope('/ep/'), '/ep/');
});

test('normalizeScope: nonsense input is returned unchanged', () => {
  assert.equal(normalizeScope('not a url'), 'not a url');
});

test('distinctHosts: dedupes and ignores non-URL strings', () => {
  const urls = [
    'https://gentropic.org/ep/main.js',
    'https://gentropic.org/ep/style.css',
    'https://cdn.example.com/lib.js',
    'not-a-url',
  ];
  assert.deepEqual(distinctHosts(urls).sort(), ['cdn.example.com', 'gentropic.org']);
});

test('distinctHosts: empty input → empty output', () => {
  assert.deepEqual(distinctHosts([]), []);
});

test('summarizeCache: derives entry count and distinct hosts', () => {
  const cache = {
    name: 'ep-shell-v1',
    entryCount: 3,
    entryUrls: [
      'https://gentropic.org/ep/main.js',
      'https://gentropic.org/ep/style.css',
      'https://cdn.example.com/lib.js',
    ],
  };
  const summary = summarizeCache(cache);
  assert.equal(summary.name, 'ep-shell-v1');
  assert.equal(summary.entryCount, 3);
  assert.deepEqual(summary.distinctHosts.sort(), ['cdn.example.com', 'gentropic.org']);
});

test('summarizeCache: missing entryUrls treated as empty', () => {
  const summary = summarizeCache({ name: 'x', entryCount: 0 });
  assert.deepEqual(summary.distinctHosts, []);
});

test('toObserved: extracts the shape detect.detectTools expects', () => {
  const inspectResult = {
    caches: [{ name: 'ep-shell-v1' }, { name: 'calque-static' }],
    idbs: [{ name: 'ep' }, { name: 'calque' }],
    localStorage: [['gcu:tool:ep', '{}'], ['ep:current', 'foo']],
    sessionStorage: [],
    swRegistrations: [
      { scope: 'https://gentropic.org/ep/' },
      { scope: 'https://gentropic.org/calque/' },
    ],
    estimate: null,
  };
  const observed = toObserved(inspectResult);
  assert.deepEqual(observed.cacheNames, ['ep-shell-v1', 'calque-static']);
  assert.deepEqual(observed.idbNames, ['ep', 'calque']);
  assert.deepEqual(observed.localStorageKeys, ['gcu:tool:ep', 'ep:current']);
  assert.deepEqual(observed.swScopes, ['/ep/', '/calque/']);
});

test('summarizeOrigin: aggregates totals across categories', () => {
  const inspectResult = {
    caches: [
      { name: 'a', entryCount: 3 },
      { name: 'b', entryCount: 5 },
    ],
    idbs: [
      { name: 'ep', stores: [{ name: 's1', recordCount: 7 }, { name: 's2', recordCount: 2 }] },
      { name: 'calque', stores: [{ name: 's1', recordCount: 1 }] },
    ],
    localStorage: [['a', '1'], ['b', '2'], ['c', '3']],
    sessionStorage: [['s', 'v']],
    swRegistrations: [{ scope: '/ep/' }],
    estimate: { usage: 1234, quota: 5678 },
  };
  const summary = summarizeOrigin(inspectResult);
  assert.equal(summary.cacheCount, 2);
  assert.equal(summary.cacheEntryTotal, 8);
  assert.equal(summary.idbCount, 2);
  assert.equal(summary.idbRecordTotal, 10);
  assert.equal(summary.localStorageCount, 3);
  assert.equal(summary.sessionStorageCount, 1);
  assert.equal(summary.swCount, 1);
  assert.equal(summary.quotaUsed, 1234);
  assert.equal(summary.quotaTotal, 5678);
});

test('bytesForLocalStorage: counts UTF-16 (2 bytes per char) for keys + values', () => {
  // "ab"(2) + "cd"(2) = 4 chars × 2 = 8 bytes
  assert.equal(bytesForLocalStorage([['ab', 'cd']]), 8);
});

test('bytesForLocalStorage: sums across multiple entries', () => {
  assert.equal(bytesForLocalStorage([['a', '1'], ['bb', '22']]), (1 + 1 + 2 + 2) * 2);
});

test('bytesForLocalStorage: empty input → 0', () => {
  assert.equal(bytesForLocalStorage([]), 0);
  assert.equal(bytesForLocalStorage(null), 0);
  assert.equal(bytesForLocalStorage(undefined), 0);
});

test('bytesForLocalStorage: null/undefined value treated as empty', () => {
  assert.equal(bytesForLocalStorage([['key', null]]), 6); // 3 chars × 2
});

test('bytesForSessionStorage: behaves identically to localStorage', () => {
  assert.equal(bytesForSessionStorage([['x', 'y']]), 4);
});

test('bytesForCache: returns 0 when caches global is missing', async () => {
  assert.equal(await bytesForCache('anything'), 0);
});

test('summarizeOrigin: missing estimate → null quotas', () => {
  const summary = summarizeOrigin({
    caches: [], idbs: [], localStorage: [], sessionStorage: [], swRegistrations: [], estimate: null,
  });
  assert.equal(summary.quotaUsed, null);
  assert.equal(summary.quotaTotal, null);
});

// --- toObserved → detectTools handshake ----------------------------------

test('toObserved output is the right shape for detect.detectTools', () => {
  const { detectTools } = require('../src/js/detect');
  const inspectResult = {
    caches: [{ name: 'ep-shell-v1' }],
    idbs: [{ name: 'ep' }],
    localStorage: [['gcu:tool:ep', JSON.stringify({
      name: 'ep',
      storageKeys: { idb: ['ep'], cacheNames: ['ep-shell-v1'], swScopes: ['/ep/'], localStoragePrefix: 'ep:' },
    })], ['ep:current', 'foo']],
    sessionStorage: [],
    swRegistrations: [{ scope: 'https://gentropic.org/ep/' }],
    estimate: null,
  };
  const observed = toObserved(inspectResult);
  const { tools, unattributed } = detectTools(inspectResult.localStorage, observed);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'ep');
  assert.deepEqual(tools[0].storage.cacheNames, ['ep-shell-v1']);
  assert.deepEqual(tools[0].storage.swScopes, ['/ep/']);
  assert.deepEqual(unattributed.cacheNames, []);
  assert.deepEqual(unattributed.swScopes, []);
});
