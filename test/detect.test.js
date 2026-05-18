const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseAnnouncements,
  inferTools,
  attribute,
  detectTools,
  gatherIdbHints,
  KNOWN_TOOL_NAMES,
} = require('../src/js/detect');

test('parseAnnouncements: valid single announcement', () => {
  const entries = [
    ['gcu:tool:ep', JSON.stringify({ name: 'ep', version: '0.2.3' })],
  ];
  const { tools, malformed } = parseAnnouncements(entries);
  assert.equal(malformed.length, 0);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'ep');
  assert.equal(tools[0].source, 'announcement');
  assert.equal(tools[0].announcement.version, '0.2.3');
});

test('parseAnnouncements: ignores non-gcu:tool entries', () => {
  const entries = [
    ['ep:current', 'ore_body'],
    ['gcu:tool:ep', JSON.stringify({ name: 'ep' })],
    ['random', 'foo'],
  ];
  const { tools } = parseAnnouncements(entries);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'ep');
});

test('parseAnnouncements: empty name suffix is malformed', () => {
  const entries = [['gcu:tool:', JSON.stringify({ name: '' })]];
  const { tools, malformed } = parseAnnouncements(entries);
  assert.equal(tools.length, 0);
  assert.equal(malformed.length, 1);
  assert.equal(malformed[0].key, 'gcu:tool:');
});

test('parseAnnouncements: invalid JSON is malformed', () => {
  const entries = [['gcu:tool:ep', '{not json']];
  const { tools, malformed } = parseAnnouncements(entries);
  assert.equal(tools.length, 0);
  assert.equal(malformed.length, 1);
  assert.match(malformed[0].reason, /invalid JSON/i);
});

test('parseAnnouncements: non-object values are malformed', () => {
  const entries = [
    ['gcu:tool:a', JSON.stringify(null)],
    ['gcu:tool:b', JSON.stringify(['array'])],
    ['gcu:tool:c', JSON.stringify('string')],
  ];
  const { tools, malformed } = parseAnnouncements(entries);
  assert.equal(tools.length, 0);
  assert.equal(malformed.length, 3);
});

test('parseAnnouncements: name field must match key suffix', () => {
  const entries = [['gcu:tool:ep', JSON.stringify({ name: 'calque' })]];
  const { tools, malformed } = parseAnnouncements(entries);
  assert.equal(tools.length, 0);
  assert.equal(malformed.length, 1);
  assert.match(malformed[0].reason, /does not match/);
});

test('parseAnnouncements: multiple valid announcements', () => {
  const entries = [
    ['gcu:tool:ep', JSON.stringify({ name: 'ep' })],
    ['gcu:tool:calque', JSON.stringify({ name: 'calque' })],
  ];
  const { tools, malformed } = parseAnnouncements(entries);
  assert.equal(malformed.length, 0);
  assert.deepEqual(tools.map((t) => t.name).sort(), ['calque', 'ep']);
});

test('inferTools: known tool inferred from idb name', () => {
  const tools = inferTools({ idbNames: ['ep'] }, []);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'ep');
  assert.equal(tools[0].source, 'heuristic');
});

test('inferTools: known tool inferred from cache prefix', () => {
  const tools = inferTools({ cacheNames: ['calque-shell-v1'] }, []);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'calque');
});

test('inferTools: known tool inferred from sw scope', () => {
  const tools = inferTools({ swScopes: ['/dee/'] }, []);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'dee');
});

test('inferTools: known tool inferred from localStorage prefix', () => {
  const tools = inferTools({ localStorageKeys: ['ep:current'] }, []);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'ep');
});

test('inferTools: hyphenated tool name (gcu-press) works', () => {
  const tools = inferTools({ cacheNames: ['gcu-press-shell-v1'] }, []);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'gcu-press');
});

test('inferTools: beacon inferred from cache prefix and SW scope', () => {
  const tools = inferTools({ cacheNames: ['beacon-shell-v1'], swScopes: ['/beacon/'] }, []);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'beacon');
});

test('inferTools: does not infer already-announced tool', () => {
  const tools = inferTools({ idbNames: ['ep'] }, ['ep']);
  assert.equal(tools.length, 0);
});

test('inferTools: does not infer unknown tool name', () => {
  const tools = inferTools({ idbNames: ['mystery'] }, []);
  assert.equal(tools.length, 0);
});

test('inferTools: cache prefix does not cross word boundary (ep vs epic)', () => {
  const tools = inferTools({ cacheNames: ['epic-data'] }, []);
  assert.equal(tools.length, 0);
});

test('attribute: claims declared storage and partitions the rest', () => {
  const tools = [{
    name: 'ep',
    storageKeys: {
      idb: ['ep'],
      cacheNames: ['ep-shell-v1'],
      swScopes: ['/ep/'],
      localStoragePrefix: 'ep:',
    },
  }];
  const observed = {
    cacheNames: ['ep-shell-v1', 'other-cache'],
    idbNames: ['ep', 'mystery'],
    localStorageKeys: ['ep:current', 'ep:saved', 'unrelated'],
    swScopes: ['/ep/', '/external/'],
  };
  const { attributed, unattributed } = attribute(tools, observed);
  assert.deepEqual(attributed.ep.cacheNames, ['ep-shell-v1']);
  assert.deepEqual(attributed.ep.idbNames, ['ep']);
  assert.deepEqual(attributed.ep.swScopes, ['/ep/']);
  assert.deepEqual(attributed.ep.localStorageKeys.sort(), ['ep:current', 'ep:saved']);
  assert.deepEqual(unattributed.cacheNames, ['other-cache']);
  assert.deepEqual(unattributed.idbNames, ['mystery']);
  assert.deepEqual(unattributed.localStorageKeys, ['unrelated']);
  assert.deepEqual(unattributed.swScopes, ['/external/']);
});

test('attribute: tool with no storageKeys claims nothing', () => {
  const tools = [{ name: 'ep' }];
  const observed = { cacheNames: ['ep-shell-v1'], idbNames: [], localStorageKeys: [], swScopes: [] };
  const { attributed, unattributed } = attribute(tools, observed);
  assert.deepEqual(attributed.ep, { cacheNames: [], idbNames: [], localStorageKeys: [], swScopes: [] });
  assert.deepEqual(unattributed.cacheNames, ['ep-shell-v1']);
});

test('detectTools: end-to-end — announcement + heuristic + unknown', () => {
  const lsEntries = [
    ['gcu:tool:ep', JSON.stringify({
      name: 'ep',
      version: '0.2.3',
      storageKeys: {
        idb: ['ep'],
        cacheNames: ['ep-shell-v1'],
        swScopes: ['/ep/'],
        localStoragePrefix: 'ep:',
      },
    })],
    ['ep:current', 'foo'],
    ['calque:sheet1', 'data'],
    ['unrelated-key', 'x'],
  ];
  const observed = {
    cacheNames: ['ep-shell-v1', 'calque-static-v3', 'old-junk'],
    idbNames: ['ep', 'calque', 'mystery-db'],
    localStorageKeys: lsEntries.map(([k]) => k),
    swScopes: ['/ep/', '/calque/', '/external/'],
  };
  const { tools, unattributed, malformed } = detectTools(lsEntries, observed);
  assert.equal(malformed.length, 0);

  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  assert.equal(byName.ep.source, 'announcement');
  assert.equal(byName.calque.source, 'heuristic');

  assert.deepEqual(byName.ep.storage.idbNames, ['ep']);
  assert.deepEqual(byName.ep.storage.cacheNames, ['ep-shell-v1']);
  assert.deepEqual(byName.ep.storage.localStorageKeys, ['ep:current']);
  assert.deepEqual(byName.ep.storage.swScopes, ['/ep/']);

  assert.deepEqual(byName.calque.storage.idbNames, ['calque']);
  assert.deepEqual(byName.calque.storage.cacheNames, ['calque-static-v3']);
  assert.deepEqual(byName.calque.storage.localStorageKeys, ['calque:sheet1']);
  assert.deepEqual(byName.calque.storage.swScopes, ['/calque/']);

  assert.deepEqual(unattributed.cacheNames, ['old-junk']);
  assert.deepEqual(unattributed.idbNames, ['mystery-db']);
  assert.deepEqual(unattributed.swScopes, ['/external/']);
  assert.deepEqual(unattributed.localStorageKeys, ['unrelated-key']);
});

test('detectTools: gcu:tool:* keys never leak into unattributed', () => {
  const lsEntries = [['gcu:tool:ep', JSON.stringify({ name: 'ep' })]];
  const observed = {
    cacheNames: [],
    idbNames: [],
    localStorageKeys: ['gcu:tool:ep'],
    swScopes: [],
  };
  const { unattributed } = detectTools(lsEntries, observed);
  assert.deepEqual(unattributed.localStorageKeys, []);
});

test('gatherIdbHints: empty LS → just KNOWN_TOOL_NAMES', () => {
  const hints = gatherIdbHints([]);
  for (const name of KNOWN_TOOL_NAMES) {
    assert.ok(hints.includes(name), `missing ${name}`);
  }
  assert.equal(hints.length, KNOWN_TOOL_NAMES.length);
});

test('gatherIdbHints: announced IDB names get merged in', () => {
  const ls = [
    ['gcu:tool:ep', JSON.stringify({ name: 'ep', storageKeys: { idb: ['ep', 'ep-cache'] } })],
    ['gcu:tool:custom', JSON.stringify({ name: 'custom', storageKeys: { idb: ['custom-db'] } })],
  ];
  const hints = gatherIdbHints(ls);
  assert.ok(hints.includes('ep'));
  assert.ok(hints.includes('ep-cache'));
  assert.ok(hints.includes('custom-db'));
  for (const name of KNOWN_TOOL_NAMES) {
    assert.ok(hints.includes(name));
  }
});

test('gatherIdbHints: dedupes overlap between announced and known names', () => {
  const ls = [['gcu:tool:ep', JSON.stringify({ name: 'ep', storageKeys: { idb: ['ep'] } })]];
  const hints = gatherIdbHints(ls);
  assert.equal(hints.filter((n) => n === 'ep').length, 1);
});

test('gatherIdbHints: ignores announcements without storageKeys.idb', () => {
  const ls = [
    ['gcu:tool:ep', JSON.stringify({ name: 'ep' })],
    ['gcu:tool:calque', JSON.stringify({ name: 'calque', storageKeys: {} })],
  ];
  const hints = gatherIdbHints(ls);
  assert.equal(hints.length, KNOWN_TOOL_NAMES.length);
});

test('detectTools: announcement wins over heuristic for the same tool', () => {
  const lsEntries = [['gcu:tool:ep', JSON.stringify({
    name: 'ep',
    storageKeys: { idb: ['ep'], localStoragePrefix: 'ep:' },
  })]];
  const observed = {
    cacheNames: [],
    idbNames: ['ep'],
    localStorageKeys: ['ep:current'],
    swScopes: [],
  };
  const { tools } = detectTools(lsEntries, observed);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].source, 'announcement');
});
