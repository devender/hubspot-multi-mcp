// lib/portals.js — load/save an arbitrary, NAMED map of HubSpot portals.
//
// Unlike a single-account connector, this server multiplexes any number of portals you name
// yourself ("sales", "marketing", "eu", "clientA", ...). Each entry is just a name -> token
// (plus an optional base_url for the rare EU/region case; the token normally routes the portal).
//
// Tokens live OUTSIDE this repo, at ~/.config/hubspot-multi-mcp/portals.json (mode 600), so they
// are never committed and never travel with the code/zip/npm package.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_BASE_URL = 'https://api.hubapi.com';

export const CONFIG_DIR =
  process.env.HUBSPOT_MULTI_MCP_DIR ||
  path.join(os.homedir(), '.config', 'hubspot-multi-mcp');
export const PORTALS_PATH = path.join(CONFIG_DIR, 'portals.json');

// Turn a human name ("Sales EU!") into a stable, enum-safe key ("sales-eu"). Names are how the
// user and the model refer to a portal, so they must be predictable.
export function slugify(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Returns { <name>: { token, baseUrl } } for whatever is configured (may be empty).
// Silently returns {} if the file is missing or unreadable — the server still starts and simply
// reports "no portals configured".
export function loadPortals() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(PORTALS_PATH, 'utf8'));
  } catch {
    return {};
  }
  const out = {};
  // Accept both the new flat shape { name: { token, base_url } } and tolerate stray junk.
  for (const [name, entry] of Object.entries(raw || {})) {
    const token = entry && (entry.token || entry.accessToken);
    if (!token) continue;
    const key = slugify(name);
    if (!key) continue;
    out[key] = { token, baseUrl: (entry.base_url || entry.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '') };
  }
  return out;
}

// portals: { <name>: { token, base_url? } }  — written atomically, readable only by the owner.
export function savePortals(portals) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const clean = {};
  for (const [name, entry] of Object.entries(portals)) {
    const key = slugify(name);
    if (!key || !entry?.token) continue;
    clean[key] = { token: entry.token };
    if (entry.base_url && entry.base_url !== DEFAULT_BASE_URL) clean[key].base_url = entry.base_url;
  }
  const tmp = `${PORTALS_PATH}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(clean, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, PORTALS_PATH);
  try {
    fs.chmodSync(PORTALS_PATH, 0o600);
  } catch {
    /* no-op if the platform doesn't support it */
  }
}
