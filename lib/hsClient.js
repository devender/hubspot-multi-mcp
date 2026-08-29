// lib/hsClient.js — minimal READ-ONLY HubSpot client, one instance per portal token.
//
// READ-ONLY BY CONSTRUCTION: this module only ever issues GET requests and the CRM `/search`
// POST (a read, despite the verb). There is no create/update/delete path here, so even a
// write-capable token cannot mutate anything through this server.
//
// The bearer token is REDACTED from every error this client throws, so a token can never leak
// into a model transcript, a log, or a thrown stack.
import { DEFAULT_BASE_URL } from './portals.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Replace the token anywhere it might appear in a string with a fixed placeholder.
function redact(str, token) {
  if (!str) return str;
  let s = String(str);
  if (token) s = s.split(token).join('***REDACTED***');
  // Belt-and-suspenders: also mask anything that looks like a HubSpot private-app token.
  return s.replace(/pat-[a-z0-9]+-[A-Za-z0-9-]+/g, 'pat-***');
}

async function hsRequest(token, baseUrl, method, urlPath, { query, body } = {}) {
  let url = (baseUrl || DEFAULT_BASE_URL) + urlPath;
  if (query && Object.keys(query).length) {
    const qs = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    if (qs) url += '?' + qs;
  }
  const headers = { Authorization: `Bearer ${token}` };
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  for (let attempt = 1; attempt <= 5; attempt++) {
    let res;
    try {
      res = await fetch(url, { method, headers, body: payload });
    } catch (netErr) {
      if (attempt < 5) {
        await sleep(300 * attempt);
        continue;
      }
      throw new Error(redact(`Network error on ${method} ${urlPath}: ${netErr.message}`, token), {
        cause: netErr,
      });
    }
    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      await sleep(300 * attempt);
      continue;
    }
    const text = await res.text();
    if (!res.ok) {
      throw new Error(redact(`${method} ${urlPath} -> ${res.status}: ${text.slice(0, 500)}`, token));
    }
    return text ? JSON.parse(text) : null;
  }
  throw new Error(`${method} ${urlPath} failed after retries.`);
}

export function makeClient(token, baseUrl = DEFAULT_BASE_URL) {
  const req = (method, urlPath, opts) => hsRequest(token, baseUrl, method, urlPath, opts);
  return {
    // Verify the token + identify the portal it belongs to. Needs the account-info scope.
    accountInfo: () => req('GET', '/account-info/v3/details'),

    // Lightweight liveness probe covered by a basic CRM read scope (crm.objects.contacts.read).
    // Used to confirm a token works even when the account-info scope wasn't granted.
    ping: () => req('GET', '/crm/v3/objects/contacts', { query: { limit: 1 } }),

    // Schema discovery — list custom object schemas defined in the portal.
    listSchemas: () => req('GET', '/crm/v3/schemas'),

    // Schema discovery — list the properties (fields) of one object type.
    listProperties: (object) => req('GET', `/crm/v3/properties/${encodeURIComponent(object)}`),

    // CRM search. `query` is a free-text search; filterGroups for structured filters.
    search: (object, { query, filterGroups, properties, limit = 25, after, sorts } = {}) => {
      const body = { limit };
      if (query) body.query = query;
      if (filterGroups) body.filterGroups = filterGroups;
      if (properties) body.properties = properties;
      if (after) body.after = after;
      if (sorts) body.sorts = sorts;
      return req('POST', `/crm/v3/objects/${encodeURIComponent(object)}/search`, { body });
    },

    // Single record by id.
    getById: (object, id, properties) =>
      req('GET', `/crm/v3/objects/${encodeURIComponent(object)}/${encodeURIComponent(id)}`, {
        query: properties && properties.length ? { properties: properties.join(',') } : undefined,
      }),

    // CRM owners (users), to resolve owner ids to people.
    listOwners: (limit = 100) => req('GET', '/crm/v3/owners', { query: { limit } }),
  };
}
