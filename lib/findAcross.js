// lib/findAcross.js — the cross-portal search the official one-account connector can't do.
//
// Runs the same free-text search over ALL configured portals IN PARALLEL, isolating each portal's
// failure (one portal erroring or timing out never aborts the others), and reports which matched.
export async function findAcross(clients, { query, object = 'contacts', limit = 10 } = {}) {
  const names = Object.keys(clients);
  const portals = await Promise.all(
    names.map(async (name) => {
      try {
        const r = await clients[name].search(object, { query, limit });
        const results = r?.results ?? [];
        return { instance: name, matched: results.length > 0, count: results.length, results };
      } catch (e) {
        return { instance: name, error: e.message };
      }
    })
  );
  const matched_in = portals.filter((p) => p.matched).map((p) => p.instance);
  return { query, object, matched_in, portals };
}
