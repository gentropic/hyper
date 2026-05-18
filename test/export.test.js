const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildBundle,
  buildToolBundle,
  pickKeys,
  toMap,
  filenameTimestamp,
  readIdbContents,
  downloadBundle,
} = require('../src/js/export');

// --- Pure layer ----------------------------------------------------------

test('buildBundle: full shape — origin, timestamp, tools, unattributed', () => {
  const detectResult = {
    tools: [{
      name: 'ep',
      source: 'announcement',
      announcement: { name: 'ep', version: '0.2.3' },
      storage: {
        idbNames: ['ep'],
        localStorageKeys: ['ep:current', 'ep:saved'],
        cacheNames: [],
        swScopes: [],
      },
    }],
    unattributed: { idbNames: ['mystery'], localStorageKeys: ['stray'], cacheNames: [], swScopes: [] },
  };
  const idbContents = new Map([
    ['ep', { programs: [{ id: 1 }, { id: 2 }] }],
    ['mystery', { stuff: [{ a: 1 }] }],
  ]);
  const bundle = buildBundle({
    detectResult,
    idbContents,
    lsEntries: [['ep:current', 'ore_body'], ['ep:saved', '{"x":1}'], ['stray', 'val']],
    ssEntries: [],
    origin: 'https://gentropic.org',
    exportedAt: '2026-05-18T14:23:00Z',
  });

  assert.equal(bundle.exportedAt, '2026-05-18T14:23:00Z');
  assert.equal(bundle.exportedFrom, 'https://gentropic.org');

  assert.equal(bundle.tools.ep.version, '0.2.3');
  assert.equal(bundle.tools.ep.source, 'announcement');
  assert.deepEqual(bundle.tools.ep.idb, { ep: { programs: [{ id: 1 }, { id: 2 }] } });
  assert.deepEqual(bundle.tools.ep.localStorage, { 'ep:current': 'ore_body', 'ep:saved': '{"x":1}' });

  assert.deepEqual(bundle.unattributed.idb, { mystery: { stuff: [{ a: 1 }] } });
  assert.deepEqual(bundle.unattributed.localStorage, { stray: 'val' });
  assert.deepEqual(bundle.unattributed.sessionStorage, {});
});

test('buildBundle: uses current time when exportedAt omitted', () => {
  const before = Date.now();
  const bundle = buildBundle({
    detectResult: { tools: [], unattributed: { idbNames: [], localStorageKeys: [], cacheNames: [], swScopes: [] } },
    idbContents: new Map(),
    lsEntries: [],
    ssEntries: [],
    origin: 'x',
  });
  const after = Date.now();
  const t = Date.parse(bundle.exportedAt);
  assert.ok(t >= before && t <= after, `timestamp ${bundle.exportedAt} not in window`);
});

test('buildBundle: heuristic tool with no announcement → version null', () => {
  const bundle = buildBundle({
    detectResult: {
      tools: [{
        name: 'calque',
        source: 'heuristic',
        announcement: null,
        storage: { idbNames: ['calque'], localStorageKeys: [], cacheNames: [], swScopes: [] },
      }],
      unattributed: { idbNames: [], localStorageKeys: [], cacheNames: [], swScopes: [] },
    },
    idbContents: new Map([['calque', { sheets: [] }]]),
    lsEntries: [],
    ssEntries: [],
    origin: 'x',
    exportedAt: 't',
  });
  assert.equal(bundle.tools.calque.version, null);
  assert.equal(bundle.tools.calque.source, 'heuristic');
});

test('buildBundle: sessionStorage included in unattributed (whole bucket)', () => {
  const bundle = buildBundle({
    detectResult: { tools: [], unattributed: { idbNames: [], localStorageKeys: [], cacheNames: [], swScopes: [] } },
    idbContents: new Map(),
    lsEntries: [],
    ssEntries: [['session-key', 'session-value']],
    origin: 'x',
    exportedAt: 't',
  });
  assert.deepEqual(bundle.unattributed.sessionStorage, { 'session-key': 'session-value' });
});

test('buildToolBundle: pulls only declared storage', () => {
  const tool = {
    name: 'ep',
    source: 'announcement',
    announcement: { version: '1.0' },
    storage: { idbNames: ['ep'], localStorageKeys: ['ep:a'] },
  };
  const idbMap = new Map([['ep', { s: [1] }], ['other', { x: [] }]]);
  const lsMap = new Map([['ep:a', '1'], ['unrelated', '2']]);
  const out = buildToolBundle(tool, idbMap, lsMap);
  assert.deepEqual(out.idb, { ep: { s: [1] } });
  assert.deepEqual(out.localStorage, { 'ep:a': '1' });
});

test('pickKeys: missing keys are silently skipped', () => {
  const map = new Map([['a', 1]]);
  assert.deepEqual(pickKeys(map, ['a', 'b']), { a: 1 });
});

test('toMap: accepts Map, array of pairs, plain object', () => {
  assert.deepEqual([...toMap(new Map([['a', 1]]))], [['a', 1]]);
  assert.deepEqual([...toMap([['a', 1]])], [['a', 1]]);
  assert.deepEqual([...toMap({ a: 1 })], [['a', 1]]);
  assert.deepEqual([...toMap(null)], []);
});

test('filenameTimestamp: filesystem-safe ISO format', () => {
  const fixed = new Date('2026-05-18T14:23:45.123Z');
  assert.equal(filenameTimestamp(fixed), '2026-05-18T14-23-45');
});

// --- Browser layer: graceful degradation ---------------------------------

test('readIdbContents: empty result when indexedDB missing', async () => {
  assert.deepEqual(await readIdbContents('anything'), {});
});

test('downloadBundle: returns false when Blob/document missing', () => {
  assert.equal(downloadBundle({}, 'x.json'), false);
});
