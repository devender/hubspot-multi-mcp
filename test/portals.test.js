import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point the store at a throwaway dir BEFORE importing the module (CONFIG_DIR is read at load).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hmm-portals-'));
process.env.HUBSPOT_MULTI_MCP_DIR = tmp;
const { slugify, savePortals, loadPortals, PORTALS_PATH, DEFAULT_BASE_URL } =
  await import('../lib/portals.js');

test('slugify normalizes names to enum-safe keys', () => {
  assert.equal(slugify('Sales EU!'), 'sales-eu');
  assert.equal(slugify('  Marketing  '), 'marketing');
  assert.equal(slugify('client #1'), 'client-1');
  assert.equal(slugify('---'), '');
});

test('save/load round-trips a named portal map at mode 600', () => {
  savePortals({
    Sales: { token: 'pat-na1-abc' },
    'Marketing EU': { token: 'pat-eu1-xyz', base_url: DEFAULT_BASE_URL },
  });
  const mode = fs.statSync(PORTALS_PATH).mode & 0o777;
  assert.equal(mode, 0o600);
  const loaded = loadPortals();
  assert.deepEqual(Object.keys(loaded).sort(), ['marketing-eu', 'sales']);
  assert.equal(loaded.sales.token, 'pat-na1-abc');
  assert.equal(loaded.sales.baseUrl, DEFAULT_BASE_URL);
});

test('loadPortals tolerates junk and skips tokenless/nameless entries', () => {
  fs.writeFileSync(
    PORTALS_PATH,
    JSON.stringify({ good: { token: 't' }, bad: { nope: 1 }, '': { token: 'x' } })
  );
  assert.deepEqual(Object.keys(loadPortals()), ['good']);
});

test('a missing file yields an empty map (server still starts)', () => {
  fs.rmSync(PORTALS_PATH, { force: true });
  assert.deepEqual(loadPortals(), {});
});
