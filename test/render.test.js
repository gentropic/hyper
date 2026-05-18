const test = require('node:test');
const assert = require('node:assert/strict');
const {
  formatBytes,
  decorateTool,
  decorateUnattributed,
  buildBarSegments,
  buildToolDetails,
  buildUnattributedDetails,
  summaryStats,
  hasUnattributed,
  isPhraseAccepted,
} = require('../src/js/render');

test('formatBytes: null → em dash', () => {
  assert.equal(formatBytes(null), '—');
});

test('formatBytes: small values in bytes', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
});

test('formatBytes: kilobytes', () => {
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(2048), '2.0 KB');
});

test('formatBytes: megabytes', () => {
  assert.equal(formatBytes(1024 * 1024), '1.0 MB');
  assert.equal(formatBytes(1.5 * 1024 * 1024), '1.5 MB');
});

test('formatBytes: gigabytes', () => {
  assert.equal(formatBytes(1024 * 1024 * 1024), '1.0 GB');
});

test('decorateTool: announced tool with full metadata', () => {
  const tool = {
    name: 'ep',
    source: 'announcement',
    announcement: { name: 'ep', displayName: 'EP', version: '0.2.3' },
    storage: {
      cacheNames: ['ep-shell-v1'],
      idbNames: ['ep'],
      localStorageKeys: ['ep:current', 'ep:saved'],
      swScopes: ['/ep/'],
    },
  };
  const inspectResult = {
    caches: [{ name: 'ep-shell-v1', entryCount: 7 }],
    idbs: [{ name: 'ep', stores: [{ name: 'programs', recordCount: 5 }, { name: 'snapshots', recordCount: 2 }] }],
  };
  const d = decorateTool(tool, inspectResult);
  assert.equal(d.name, 'ep');
  assert.equal(d.displayName, 'EP');
  assert.equal(d.version, '0.2.3');
  assert.equal(d.source, 'announcement');
  assert.equal(d.cacheCount, 1);
  assert.equal(d.cacheEntries, 7);
  assert.equal(d.idbCount, 1);
  assert.equal(d.idbRecords, 7);
  assert.equal(d.localStorageCount, 2);
  assert.equal(d.swCount, 1);
});

test('decorateTool: heuristic tool with no announcement', () => {
  const tool = {
    name: 'calque',
    source: 'heuristic',
    announcement: null,
    storage: {
      cacheNames: ['calque-static-v3'],
      idbNames: ['calque'],
      localStorageKeys: [],
      swScopes: ['/calque/'],
    },
  };
  const inspectResult = {
    caches: [{ name: 'calque-static-v3', entryCount: 12 }],
    idbs: [{ name: 'calque', stores: [{ name: 'sheets', recordCount: 4 }] }],
  };
  const d = decorateTool(tool, inspectResult);
  assert.equal(d.displayName, 'calque');
  assert.equal(d.version, null);
  assert.equal(d.cacheEntries, 12);
  assert.equal(d.idbRecords, 4);
});

test('decorateTool: lsBytes computed from actual LS values (UTF-16)', () => {
  const tool = {
    name: 'ep', source: 'announcement', announcement: { name: 'ep' },
    storage: { cacheNames: [], idbNames: [], localStorageKeys: ['ep:a', 'ep:b'], swScopes: [] },
  };
  const inspectResult = {
    caches: [], idbs: [],
    localStorage: [['ep:a', 'XX'], ['ep:b', 'YYYY'], ['unrelated', 'ignored']],
  };
  const d = decorateTool(tool, inspectResult, null);
  // ('ep:a'.len + 'XX'.len + 'ep:b'.len + 'YYYY'.len) * 2 = (4+2+4+4)*2 = 28
  assert.equal(d.lsBytes, 28);
});

test('decorateTool: no cacheSizes → cacheBytes=0, hasCacheSizes=false when caches exist', () => {
  const tool = {
    name: 'ep', source: 'announcement', announcement: { name: 'ep' },
    storage: { cacheNames: ['ep-shell'], idbNames: [], localStorageKeys: [], swScopes: [] },
  };
  const d = decorateTool(tool, { caches: [{ name: 'ep-shell', entryCount: 1 }], idbs: [], localStorage: [] }, null);
  assert.equal(d.cacheBytes, 0);
  assert.equal(d.hasCacheSizes, false);
});

test('decorateTool: tool with no caches → hasCacheSizes=true vacuously', () => {
  const tool = {
    name: 'ep', source: 'announcement', announcement: { name: 'ep' },
    storage: { cacheNames: [], idbNames: [], localStorageKeys: [], swScopes: [] },
  };
  const d = decorateTool(tool, { caches: [], idbs: [], localStorage: [] }, null);
  assert.equal(d.hasCacheSizes, true);
});

test('decorateTool: cacheSizes covering all caches → cacheBytes summed, hasCacheSizes=true', () => {
  const tool = {
    name: 'ep', source: 'announcement', announcement: { name: 'ep' },
    storage: { cacheNames: ['a', 'b'], idbNames: [], localStorageKeys: [], swScopes: [] },
  };
  const sizes = new Map([['a', 1024], ['b', 2048]]);
  const d = decorateTool(tool, { caches: [], idbs: [], localStorage: [] }, sizes);
  assert.equal(d.cacheBytes, 3072);
  assert.equal(d.hasCacheSizes, true);
});

test('decorateTool: cacheSizes partial → hasCacheSizes=false, sums only known', () => {
  const tool = {
    name: 'ep', source: 'announcement', announcement: { name: 'ep' },
    storage: { cacheNames: ['a', 'b'], idbNames: [], localStorageKeys: [], swScopes: [] },
  };
  const sizes = new Map([['a', 100]]);
  const d = decorateTool(tool, { caches: [], idbs: [], localStorage: [] }, sizes);
  assert.equal(d.cacheBytes, 100);
  assert.equal(d.hasCacheSizes, false);
});

test('decorateTool: cacheSizes with null value (uncomputable) skipped from sum', () => {
  const tool = {
    name: 'ep', source: 'announcement', announcement: { name: 'ep' },
    storage: { cacheNames: ['a', 'b'], idbNames: [], localStorageKeys: [], swScopes: [] },
  };
  const sizes = new Map([['a', 100], ['b', null]]);
  const d = decorateTool(tool, { caches: [], idbs: [], localStorage: [] }, sizes);
  assert.equal(d.cacheBytes, 100);
  // hasCacheSizes is true because we tried both — null still counts as "we tried"
  assert.equal(d.hasCacheSizes, true);
});

test('buildBarSegments: cache + LS segments scaled to maxBytes', () => {
  const d = { cacheBytes: 1000, lsBytes: 200, hasCacheSizes: true };
  const r = buildBarSegments(d, 2000);
  assert.equal(r.totalBytes, 1200);
  assert.equal(r.segments.length, 2);
  assert.equal(r.segments[0].label, 'cache');
  assert.equal(r.segments[0].percent, 50);
  assert.equal(r.segments[1].label, 'ls');
  assert.equal(r.segments[1].percent, 10);
});

test('buildBarSegments: cache segment omitted when sizes not computed', () => {
  const d = { cacheBytes: 0, lsBytes: 100, hasCacheSizes: false };
  const r = buildBarSegments(d, 1000);
  assert.equal(r.segments.length, 1);
  assert.equal(r.segments[0].label, 'ls');
  assert.equal(r.totalBytes, 100);
});

test('buildBarSegments: zero bytes everywhere → empty segments', () => {
  const r = buildBarSegments({ cacheBytes: 0, lsBytes: 0, hasCacheSizes: true }, 1000);
  assert.deepEqual(r.segments, []);
  assert.equal(r.totalBytes, 0);
});

test('buildBarSegments: maxBytes=0 does not divide by zero', () => {
  const r = buildBarSegments({ cacheBytes: 0, lsBytes: 10, hasCacheSizes: true }, 0);
  assert.equal(r.segments[0].percent, 1000); // 10/1 * 100; ref clamped to 1
});

test('decorateUnattributed: lsBytes includes own LS keys + all sessionStorage', () => {
  const u = { cacheNames: [], idbNames: [], localStorageKeys: ['stray'], swScopes: [] };
  const inspectResult = {
    caches: [], idbs: [],
    localStorage: [['stray', 'AAAA'], ['unrelated', 'X']], // only 'stray' matches
    sessionStorage: [['s', 'YY']],
  };
  const d = decorateUnattributed(u, inspectResult, null);
  // 'stray'(5) + 'AAAA'(4) + 's'(1) + 'YY'(2) = 12 chars × 2 = 24
  assert.equal(d.lsBytes, 24);
  assert.equal(d.cacheCount, 0);
  assert.equal(d.hasCacheSizes, true);
  assert.equal(d.cacheBytes, 0);
});

test('decorateUnattributed: no caches → hasCacheSizes=true vacuously', () => {
  const d = decorateUnattributed(
    { cacheNames: [], idbNames: [], localStorageKeys: [], swScopes: [] },
    { caches: [], idbs: [], localStorage: [], sessionStorage: [] },
    null,
  );
  assert.equal(d.hasCacheSizes, true);
  assert.equal(d.cacheCount, 0);
});

test('decorateUnattributed: caches present, no sizes Map → hasCacheSizes=false', () => {
  const d = decorateUnattributed(
    { cacheNames: ['stray-cache'], idbNames: [], localStorageKeys: [], swScopes: [] },
    { caches: [], idbs: [], localStorage: [], sessionStorage: [] },
    null,
  );
  assert.equal(d.hasCacheSizes, false);
  assert.equal(d.cacheCount, 1);
});

test('decorateUnattributed: sizes map covering all caches → bytes summed', () => {
  const d = decorateUnattributed(
    { cacheNames: ['a', 'b'], idbNames: [], localStorageKeys: [], swScopes: [] },
    { caches: [], idbs: [], localStorage: [], sessionStorage: [] },
    new Map([['a', 1000], ['b', 500]]),
  );
  assert.equal(d.hasCacheSizes, true);
  assert.equal(d.cacheBytes, 1500);
});

test('decorateTool: missing inspect metadata is treated as zero', () => {
  const tool = {
    name: 'ghost',
    source: 'announcement',
    announcement: { name: 'ghost' },
    storage: { cacheNames: ['gone'], idbNames: ['gone'], localStorageKeys: [], swScopes: [] },
  };
  const inspectResult = { caches: [], idbs: [] };
  const d = decorateTool(tool, inspectResult);
  assert.equal(d.cacheEntries, 0);
  assert.equal(d.idbRecords, 0);
});

test('summaryStats: aggregates tool count and quota', () => {
  const stats = summaryStats(
    { estimate: { usage: 1024, quota: 2048 } },
    { tools: [{ name: 'a' }, { name: 'b' }] },
  );
  assert.equal(stats.toolCount, 2);
  assert.equal(stats.quotaUsed, 1024);
  assert.equal(stats.quotaTotal, 2048);
});

test('summaryStats: null estimate → null quota fields', () => {
  const stats = summaryStats({ estimate: null }, { tools: [] });
  assert.equal(stats.quotaUsed, null);
  assert.equal(stats.quotaTotal, null);
});

test('hasUnattributed: true when any category non-empty', () => {
  assert.equal(hasUnattributed({ cacheNames: [], idbNames: ['x'], localStorageKeys: [], swScopes: [] }), true);
});

test('hasUnattributed: false when all empty', () => {
  assert.equal(hasUnattributed({ cacheNames: [], idbNames: [], localStorageKeys: [], swScopes: [] }), false);
});

test('buildToolDetails: cross-references inspect data for the tool', () => {
  const tool = {
    name: 'ep',
    storage: {
      cacheNames: ['ep-shell-v1'],
      idbNames: ['ep'],
      localStorageKeys: ['ep:current', 'ep:saved'],
      swScopes: ['/ep/'],
    },
  };
  const inspectResult = {
    caches: [{ name: 'ep-shell-v1', entryUrls: ['https://x/a', 'https://x/b'] }],
    idbs: [{ name: 'ep', version: 2, stores: [{ name: 'programs', recordCount: 7 }] }],
    localStorage: [['ep:current', 'ore'], ['ep:saved', 'data'], ['ep:other', 'ignored']],
    swRegistrations: [{ scope: 'https://gentropic.org/ep/', scriptURL: 'https://gentropic.org/ep/sw.js', state: 'activated' }],
  };
  const d = buildToolDetails(tool, inspectResult);
  assert.deepEqual(d.caches, [{ name: 'ep-shell-v1', urls: ['https://x/a', 'https://x/b'] }]);
  assert.deepEqual(d.idbs, [{ name: 'ep', version: 2, stores: [{ name: 'programs', recordCount: 7 }] }]);
  assert.deepEqual(d.localStorage, [['ep:current', 'ore'], ['ep:saved', 'data']]);
  assert.equal(d.sws.length, 1);
  assert.equal(d.sws[0].state, 'activated');
});

test('buildToolDetails: SW scope matches via path (not full URL)', () => {
  const tool = { name: 'ep', storage: { swScopes: ['/ep/'], cacheNames: [], idbNames: [], localStorageKeys: [] } };
  const inspectResult = {
    caches: [], idbs: [], localStorage: [],
    swRegistrations: [{ scope: 'https://gentropic.org/ep/', scriptURL: 'x', state: 'activated' }],
  };
  const d = buildToolDetails(tool, inspectResult);
  assert.equal(d.sws.length, 1);
});

test('buildUnattributedDetails: cross-references + includes all sessionStorage', () => {
  const unattributed = {
    cacheNames: ['stray-cache'],
    idbNames: ['mystery'],
    localStorageKeys: ['orphan-key'],
    swScopes: ['/external/'],
  };
  const inspectResult = {
    caches: [{ name: 'stray-cache', entryUrls: ['https://x/a'] }],
    idbs: [{ name: 'mystery', version: 1, stores: [{ name: 'stuff', recordCount: 3 }] }],
    localStorage: [['orphan-key', 'orphan-value'], ['known-tool-key', 'known']],
    sessionStorage: [['session-a', '1'], ['session-b', '2']],
    swRegistrations: [{ scope: 'https://gentropic.org/external/', scriptURL: 'x', state: 'activated' }],
  };
  const d = buildUnattributedDetails(unattributed, inspectResult);
  assert.deepEqual(d.caches, [{ name: 'stray-cache', urls: ['https://x/a'] }]);
  assert.deepEqual(d.idbs[0].name, 'mystery');
  assert.deepEqual(d.localStorage, [['orphan-key', 'orphan-value']]);
  assert.deepEqual(d.sessionStorage, [['session-a', '1'], ['session-b', '2']]);
  assert.equal(d.sws.length, 1);
});

test('buildUnattributedDetails: empty everything yields empty buckets', () => {
  const d = buildUnattributedDetails(
    { cacheNames: [], idbNames: [], localStorageKeys: [], swScopes: [] },
    { caches: [], idbs: [], localStorage: [], sessionStorage: [], swRegistrations: [] },
  );
  assert.deepEqual(d.caches, []);
  assert.deepEqual(d.idbs, []);
  assert.deepEqual(d.localStorage, []);
  assert.deepEqual(d.sessionStorage, []);
  assert.deepEqual(d.sws, []);
});

test('buildToolDetails: missing storage entries quietly skipped', () => {
  const tool = {
    name: 'ghost',
    storage: { cacheNames: ['gone'], idbNames: ['gone'], localStorageKeys: ['gone'], swScopes: ['/gone/'] },
  };
  const inspectResult = { caches: [], idbs: [], localStorage: [], swRegistrations: [] };
  const d = buildToolDetails(tool, inspectResult);
  assert.deepEqual(d.caches, []);
  assert.deepEqual(d.idbs, []);
  assert.deepEqual(d.localStorage, []);
  assert.deepEqual(d.sws, []);
});

test('isPhraseAccepted: exact match passes', () => {
  assert.equal(isPhraseAccepted('delete', 'delete'), true);
});

test('isPhraseAccepted: surrounding whitespace is tolerated', () => {
  assert.equal(isPhraseAccepted('  delete  ', 'delete'), true);
  assert.equal(isPhraseAccepted('\tdelete\n', 'delete'), true);
});

test('isPhraseAccepted: case-sensitive', () => {
  assert.equal(isPhraseAccepted('Delete', 'delete'), false);
  assert.equal(isPhraseAccepted('DELETE', 'delete'), false);
});

test('isPhraseAccepted: prefix/suffix mismatches rejected', () => {
  assert.equal(isPhraseAccepted('delete me', 'delete'), false);
  assert.equal(isPhraseAccepted('please delete', 'delete'), false);
});

test('isPhraseAccepted: empty and non-string inputs rejected', () => {
  assert.equal(isPhraseAccepted('', 'delete'), false);
  assert.equal(isPhraseAccepted(null, 'delete'), false);
  assert.equal(isPhraseAccepted(undefined, 'delete'), false);
  assert.equal(isPhraseAccepted(42, 'delete'), false);
});
