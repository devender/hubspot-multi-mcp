import test from 'node:test';
import assert from 'node:assert/strict';
import { makeClient } from '../lib/hsClient.js';

function stubFetch(handler) {
  const orig = globalThis.fetch;
  globalThis.fetch = handler;
  return () => {
    globalThis.fetch = orig;
  };
}
const jsonRes = (obj, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(obj),
});
const textRes = (body, status) => ({ ok: false, status, text: async () => body });

test('search issues a POST to /search with the query and limit', async () => {
  let seen;
  const restore = stubFetch(async (url, opts) => {
    seen = { url, opts };
    return jsonRes({ results: [{ id: '1' }] });
  });
  const r = await makeClient('pat-na1-tok').search('contacts', { query: 'jane', limit: 10 });
  restore();
  assert.match(seen.url, /\/crm\/v3\/objects\/contacts\/search$/);
  assert.equal(seen.opts.method, 'POST');
  assert.deepEqual(JSON.parse(seen.opts.body), { limit: 10, query: 'jane' });
  assert.equal(r.results[0].id, '1');
});

test('getById issues a GET with a properties query', async () => {
  let seen;
  const restore = stubFetch(async (url, opts) => {
    seen = { url, method: opts.method };
    return jsonRes({ id: '5' });
  });
  await makeClient('t').getById('deals', '5', ['dealname', 'amount']);
  restore();
  assert.equal(seen.method, 'GET');
  assert.match(seen.url, /\/crm\/v3\/objects\/deals\/5\?properties=dealname%2Camount$/);
});

test('the client exposes ONLY read methods (read-only by construction)', () => {
  const keys = Object.keys(makeClient('t')).sort();
  assert.deepEqual(keys, [
    'accountInfo',
    'getById',
    'listOwners',
    'listProperties',
    'listSchemas',
    'ping',
    'search',
  ]);
  for (const k of keys) assert.doesNotMatch(k, /create|update|delete|patch|write|remove/i);
});

test('the token is redacted from thrown errors', async () => {
  const token = 'pat-na1-supersecret';
  const restore = stubFetch(async () => textRes(`{"message":"bad token ${token}"}`, 401));
  await assert.rejects(
    () => makeClient(token).ping(),
    (err) => {
      assert.doesNotMatch(err.message, /supersecret/);
      assert.match(err.message, /REDACTED|pat-\*\*\*/);
      return true;
    }
  );
  restore();
});

test('retries on 429 then succeeds', async () => {
  let n = 0;
  const restore = stubFetch(async () => {
    n += 1;
    return n === 1 ? jsonRes({}, 429) : jsonRes({ results: [] });
  });
  const r = await makeClient('t').search('contacts', {});
  restore();
  assert.equal(n, 2);
  assert.deepEqual(r, { results: [] });
});
