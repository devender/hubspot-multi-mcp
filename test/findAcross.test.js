import test from 'node:test';
import assert from 'node:assert/strict';
import { findAcross } from '../lib/findAcross.js';

const clientReturning = (results) => ({ search: async () => ({ results }) });
const clientThrowing = (msg) => ({
  search: async () => {
    throw new Error(msg);
  },
});

test('find_across reports matched portals and isolates a failing one', async () => {
  const clients = {
    sales: clientReturning([{ id: '1' }, { id: '2' }]),
    marketing: clientReturning([]),
    eu: clientThrowing('boom'),
  };
  const out = await findAcross(clients, { query: 'acme' });
  assert.deepEqual(out.matched_in, ['sales']);
  assert.equal(out.portals.length, 3);
  const eu = out.portals.find((p) => p.instance === 'eu');
  assert.equal(eu.error, 'boom'); // the failing portal did not abort the others
  const sales = out.portals.find((p) => p.instance === 'sales');
  assert.equal(sales.count, 2);
});

test('find_across runs the portals in parallel, not sequentially', async () => {
  let active = 0;
  let peak = 0;
  const slow = () => ({
    search: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 20));
      active -= 1;
      return { results: [] };
    },
  });
  await findAcross({ a: slow(), b: slow(), c: slow() }, { query: 'x' });
  assert.ok(peak > 1, `expected overlapping calls, peak concurrency was ${peak}`);
});

test('find_across tolerates a null response body', async () => {
  const out = await findAcross({ a: { search: async () => null } }, { query: 'x' });
  assert.deepEqual(out.matched_in, []);
  assert.equal(out.portals[0].count, 0);
});
