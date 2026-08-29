// verify.js — quick health check. Prints which configured portals are reachable. No secrets shown.
import { loadPortals } from './lib/portals.js';
import { makeClient } from './lib/hsClient.js';

export async function runVerify() {
  const portals = loadPortals();
  const names = Object.keys(portals);
  if (!names.length) {
    console.log('No portals configured. Run `npx hubspot-multi-mcp setup`.');
    return;
  }
  console.log(`Checking ${names.length} portal(s):\n`);
  for (const n of names) {
    const client = makeClient(portals[n].token, portals[n].baseUrl);
    try {
      const info = await client.accountInfo();
      console.log(`  ✓ ${n} — portal ${info.portalId} (${info.uiDomain || 'na'})`);
    } catch {
      try {
        await client.ping();
        console.log(`  ✓ ${n} — read access OK (no account-info scope)`);
      } catch (e) {
        console.log(`  ✗ ${n} — ${e.message}`);
      }
    }
  }
  console.log('');
}
