const test = require('node:test');
const assert = require('node:assert/strict');
const {
  planResetTool,
  planForceRefresh,
  planNuke,
  planResetUnattributed,
  pickToolURL,
  describePlan,
  scopePath,
  clearCaches,
  unregisterScopes,
  deleteIdbs,
  clearLocalStorageKeys,
  clearSessionStorageKeys,
} = require('../src/js/actions');

// --- Pure planning -------------------------------------------------------

test('planResetTool: collects all storage from the tool', () => {
  const plan = planResetTool({
    storage: {
      cacheNames: ['ep-shell-v1'],
      swScopes: ['/ep/'],
      idbNames: ['ep'],
      localStorageKeys: ['ep:current', 'ep:saved'],
    },
  });
  assert.deepEqual(plan.cacheNames, ['ep-shell-v1']);
  assert.deepEqual(plan.swScopes, ['/ep/']);
  assert.deepEqual(plan.idbNames, ['ep']);
  assert.deepEqual(plan.localStorageKeys, ['ep:current', 'ep:saved']);
  assert.deepEqual(plan.sessionStorageKeys, []);
});

test('planResetTool: tool with no storage fields returns empty arrays', () => {
  const plan = planResetTool({});
  assert.deepEqual(plan.cacheNames, []);
  assert.deepEqual(plan.localStorageKeys, []);
});

test('planForceRefresh: includes caches + SWs + chosen URL', () => {
  const plan = planForceRefresh({
    announcement: { links: { homepage: 'https://gentropic.org/ep/' } },
    storage: { cacheNames: ['ep-shell-v1'], swScopes: ['/ep/'] },
  });
  assert.deepEqual(plan.cacheNames, ['ep-shell-v1']);
  assert.deepEqual(plan.swScopes, ['/ep/']);
  assert.equal(plan.url, 'https://gentropic.org/ep/');
});

test('planNuke: pulls everything from inspectResult', () => {
  const plan = planNuke({
    caches: [{ name: 'a' }, { name: 'b' }],
    swRegistrations: [{ scope: '/ep/' }],
    idbs: [{ name: 'ep' }],
    localStorage: [['k1', 'v1'], ['k2', 'v2']],
    sessionStorage: [['s1', 'v']],
  });
  assert.deepEqual(plan.cacheNames, ['a', 'b']);
  assert.deepEqual(plan.swScopes, ['/ep/']);
  assert.deepEqual(plan.idbNames, ['ep']);
  assert.deepEqual(plan.localStorageKeys, ['k1', 'k2']);
  assert.deepEqual(plan.sessionStorageKeys, ['s1']);
});

test('planResetUnattributed: includes all unattributed + all sessionStorage', () => {
  const plan = planResetUnattributed(
    {
      unattributed: {
        cacheNames: ['cache-x'],
        swScopes: ['/x/'],
        idbNames: ['mystery'],
        localStorageKeys: ['stray'],
      },
    },
    { sessionStorage: [['s1', 'v1'], ['s2', 'v2']] },
  );
  assert.deepEqual(plan.cacheNames, ['cache-x']);
  assert.deepEqual(plan.swScopes, ['/x/']);
  assert.deepEqual(plan.idbNames, ['mystery']);
  assert.deepEqual(plan.localStorageKeys, ['stray']);
  assert.deepEqual(plan.sessionStorageKeys, ['s1', 's2']);
});

test('planResetUnattributed: empty unattributed + empty SS → empty plan', () => {
  const plan = planResetUnattributed(
    { unattributed: { cacheNames: [], swScopes: [], idbNames: [], localStorageKeys: [] } },
    { sessionStorage: [] },
  );
  assert.deepEqual(plan, { cacheNames: [], swScopes: [], idbNames: [], localStorageKeys: [], sessionStorageKeys: [] });
});

test('pickToolURL: prefers announcement homepage', () => {
  const url = pickToolURL({
    announcement: { links: { homepage: 'https://gentropic.org/ep/' } },
    storage: { swScopes: ['/ep/'] },
  });
  assert.equal(url, 'https://gentropic.org/ep/');
});

test('pickToolURL: falls back to first SW scope', () => {
  const url = pickToolURL({
    announcement: null,
    storage: { swScopes: ['/calque/', '/calque/sub/'] },
  });
  assert.equal(url, '/calque/');
});

test('pickToolURL: null when nothing usable', () => {
  assert.equal(pickToolURL({ storage: {} }), null);
  assert.equal(pickToolURL(null), null);
});

test('scopePath: full URL → pathname; bare path unchanged', () => {
  assert.equal(scopePath('https://gentropic.org/ep/'), '/ep/');
  assert.equal(scopePath('/ep/'), '/ep/');
  assert.equal(scopePath('garbage'), 'garbage');
});

test('describePlan: singular vs plural; skips empty categories', () => {
  assert.equal(describePlan({
    cacheNames: ['a'],
    swScopes: ['x', 'y'],
    idbNames: [],
    localStorageKeys: ['k'],
  }), '1 cache, 2 service workers, 1 localStorage key');
});

test('describePlan: empty plan → "nothing"', () => {
  assert.equal(describePlan({}), 'nothing');
});

test('describePlan: every category present at once', () => {
  const text = describePlan({
    cacheNames: ['a', 'b'],
    swScopes: ['x'],
    idbNames: ['d1', 'd2', 'd3'],
    localStorageKeys: ['k'],
    sessionStorageKeys: ['s1', 's2'],
  });
  assert.equal(text, '2 caches, 1 service worker, 3 IDB databases, 1 localStorage key, 2 sessionStorage keys');
});

// --- Graceful degradation when browser APIs are missing ------------------

test('clearCaches: no-op when caches global missing', async () => {
  assert.deepEqual(await clearCaches(['a']), { cleared: [] });
});

test('unregisterScopes: no-op when navigator.serviceWorker missing', async () => {
  assert.deepEqual(await unregisterScopes(['/ep/']), { unregistered: [] });
});

test('deleteIdbs: no-op when indexedDB missing', async () => {
  assert.deepEqual(await deleteIdbs(['ep']), { deleted: [], blocked: [], errors: [] });
});

test('clearLocalStorageKeys: no-op when localStorage missing', () => {
  assert.deepEqual(clearLocalStorageKeys(['x']), { cleared: [] });
});

test('clearSessionStorageKeys: no-op when sessionStorage missing', () => {
  assert.deepEqual(clearSessionStorageKeys(['x']), { cleared: [] });
});
