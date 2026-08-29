// setup.js — one-time setup, written for a non-technical user.
//   1) asks you to NAME each HubSpot portal and paste its READ-ONLY token (repeat as many as you like)
//   2) verifies each token against HubSpot
//   3) saves them to ~/.config/hubspot-multi-mcp/portals.json (mode 600, outside this package)
//   4) registers this server in the Claude Desktop config (backing up any existing config first)
// Nothing sensitive is stored inside this folder, and no token is ever printed back.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { makeClient } from './lib/hsClient.js';
import { savePortals, PORTALS_PATH, slugify } from './lib/portals.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(__dirname, 'cli.js');
const CLAUDE_CONFIG = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'Claude',
  'claude_desktop_config.json'
);
const SERVER_KEY = 'hubspot-multi';

const ask = (rl, q) => new Promise((res) => rl.question(q, (a) => res(a.trim())));

// How should Claude Desktop launch us? If we're running from an npx/global install, relaunch via
// npx (self-updating, no path to a temp cache). If from a local clone, point node at cli.js.
function launcherConfig() {
  const installed = /[/\\](?:_npx|node_modules)[/\\]/.test(__dirname);
  if (installed) {
    let npx = 'npx';
    const guess = path.join(path.dirname(process.execPath), 'npx');
    if (fs.existsSync(guess)) npx = guess;
    return { command: npx, args: ['-y', 'hubspot-multi-mcp'] };
  }
  // Local clone: use the absolute path to THIS node binary (Claude Desktop launches servers with a
  // minimal PATH, so a bare "node" often fails with "spawn node ENOENT").
  return { command: process.execPath, args: [CLI_PATH] };
}

export async function runSetup() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  console.log('\n  hubspot-multi-mcp — setup');
  console.log('  Give each HubSpot portal a short name, then paste its read-only token.');
  console.log('  Add as many as you like. Press Enter on the name to finish.\n');

  const portals = {};
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const name = await ask(rl, `  Name for HubSpot #${n} (e.g. sales, marketing, eu) — or Enter to finish: `);
    if (!name) break;
    const key = slugify(name);
    if (!key) {
      console.log('    – please use letters or numbers for the name.\n');
      continue;
    }
    if (portals[key]) {
      console.log(`    – "${key}" is already added; pick a different name.\n`);
      continue;
    }
    const token = await ask(rl, `  Paste the READ-ONLY token for "${key}": `);
    if (!token) {
      console.log('    – no token entered; skipped.\n');
      continue;
    }
    try {
      const client = makeClient(token);
      let info = null;
      // account-info gives a nice portal id, but its scope is optional — fall back to a CRM read.
      try {
        info = await client.accountInfo();
      } catch {
        await client.ping();
      }
      portals[key] = { token };
      if (info) {
        console.log(`    ✓ "${key}" verified — portal ${info.portalId} (${info.uiDomain || 'na'})\n`);
      } else {
        console.log(`    ✓ "${key}" verified — read access OK (add the account-info scope to show the portal id)\n`);
      }
      n += 1;
    } catch (e) {
      console.log(`    ✗ "${key}" token did NOT work: ${e.message}`);
      console.log('      Not saved — check the token and its read scopes, then add it again.\n');
    }
  }
  rl.close();

  if (!Object.keys(portals).length) {
    console.error('  No valid tokens entered. Nothing was saved.');
    process.exit(1);
  }

  savePortals(portals);
  console.log(`  Saved ${Object.keys(portals).length} portal(s) to ${PORTALS_PATH} (readable only by you).`);

  // Register in the Claude Desktop config, preserving anything already there.
  let cfg = {};
  if (fs.existsSync(CLAUDE_CONFIG)) {
    try {
      cfg = JSON.parse(fs.readFileSync(CLAUDE_CONFIG, 'utf8'));
    } catch {
      cfg = {};
    }
    fs.copyFileSync(CLAUDE_CONFIG, `${CLAUDE_CONFIG}.bak-${process.pid}`);
  } else {
    fs.mkdirSync(path.dirname(CLAUDE_CONFIG), { recursive: true });
  }
  cfg.mcpServers = cfg.mcpServers || {};
  cfg.mcpServers[SERVER_KEY] = launcherConfig();
  fs.writeFileSync(CLAUDE_CONFIG, JSON.stringify(cfg, null, 2));

  console.log(`  Registered "${SERVER_KEY}" in Claude Desktop:\n    ${CLAUDE_CONFIG}`);
  console.log('\n  Done! QUIT the Claude Desktop app completely (Cmd+Q) and reopen it,');
  console.log('  then ask Claude: "list my hubspot portals".\n');
}
