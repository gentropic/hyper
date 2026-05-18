const test = require('node:test');
const assert = require('node:assert/strict');
const {
  formatBytes,
  decorateTool,
  summaryStats,
  hasUnattributed,
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
