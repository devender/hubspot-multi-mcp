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
const CLAUDE_CONFIG = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'Claude',
  'claude_desktop_config.json'
);
const SERVER_KEY = 'hubspot-multi';

const ask = (rl, q) => new Promise((res) => rl.question(q, (a) => res(a.trim())));

// Ask for a secret without echoing it to the terminal (so a pasted token never lands in scrollback
// or a screen recording). We mute readline's output writer while the value is typed, then restore it.
function askSecret(rl, query) {
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl._writeToOutput = origWrite;
      rl.output.write('\n');
      resolve(answer.trim());
    });
    const origWrite = rl._writeToOutput.bind(rl);
    rl._writeToOutput = () => {};
  });
}

// How should Claude Desktop launch us? Always pin the ABSOLUTE node binary + the ABSOLUTE path to
// this package's cli.js. Claude Desktop launches servers with a minimal PATH, so a bare `node`/`npx`
// can fail with "spawn ENOENT" (notably under nvm/volta/fnm); an absolute pair has no PATH dependency.
export function launcherConfig(dirname = __dirname) {
  return { command: process.execPath, args: [path.join(dirname, 'cli.js')] };
}

// Pure, non-destructive merge: add/replace only our server key, preserving every other key and every
// other configured MCP server.
export function mergeMcpServer(cfg, serverKey, launcher) {
  const base = cfg && typeof cfg === 'object' ? cfg : {};
  const servers = base.mcpServers && typeof base.mcpServers === 'object' ? base.mcpServers : {};
  return { ...base, mcpServers: { ...servers, [serverKey]: launcher } };
}

// Read → back up → merge → write the Claude Desktop config. Non-destructive to any other servers.
// On an unparseable existing config it warns loudly (naming the backup) rather than silently dropping
// the user's other servers.
export function registerInClaudeDesktop({ configPath, serverKey, launcher, log = console.log }) {
  let cfg = {};
  let backedUp = null;
  let parseFailed = false;
  if (fs.existsSync(configPath)) {
    // Back up FIRST, before any write. The config may hold other servers' secrets → lock it to 600.
    backedUp = `${configPath}.bak-${process.pid}`;
    fs.copyFileSync(configPath, backedUp);
    try {
      fs.chmodSync(backedUp, 0o600);
    } catch {
      /* no-op on platforms without mode support */
    }
    try {
      cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      parseFailed = true;
      log(
        `  ⚠️  Your existing Claude config was not valid JSON. It is backed up at\n` +
          `     ${backedUp}\n` +
          `     Starting a fresh config — your other MCP servers may need to be re-added from that backup.`
      );
      cfg = {};
    }
  } else {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(mergeMcpServer(cfg, serverKey, launcher), null, 2));
  return { backedUp, parseFailed };
}

export async function runSetup() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  console.log('\n  hubspot-multi-mcp — setup');
  console.log('  Give each HubSpot portal a short name, then paste its read-only token.');
  console.log('  Add as many as you like. Press Enter on the name to finish.\n');

  const portals = {};
  let n = 1;
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
    const token = await askSecret(rl, `  Paste the READ-ONLY token for "${key}" (input hidden): `);
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
        console.log(
          `    ✓ "${key}" verified — read access OK (add the account-info scope to show the portal id)\n`
        );
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

  registerInClaudeDesktop({ configPath: CLAUDE_CONFIG, serverKey: SERVER_KEY, launcher: launcherConfig() });
  console.log(`  Registered "${SERVER_KEY}" in Claude Desktop:\n    ${CLAUDE_CONFIG}`);

  // The launcher is pinned to this exact cli.js. If we're running from the transient npx cache, that
  // path can be garbage-collected — recommend a durable install so the tool keeps loading.
  if (/[/\\]_npx[/\\]/.test(__dirname)) {
    console.log(
      '\n  Note: you ran this via npx (no install). For a durable setup, install it once with\n' +
        '    npm install -g hubspot-multi-mcp\n' +
        '  then re-run `hubspot-multi-mcp setup`, so Claude Desktop always finds it.'
    );
  }

  console.log('\n  Done! QUIT the Claude Desktop app completely (Cmd+Q) and reopen it,');
  console.log('  then ask Claude: "list my hubspot portals".\n');
}
