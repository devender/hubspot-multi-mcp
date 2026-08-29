#!/usr/bin/env node
// cli.js — single entrypoint. Claude Desktop launches this with no arguments (the MCP server);
// people run `npx hubspot-multi-mcp setup` and `... verify` for the one-time setup + a health check.
const cmd = process.argv[2];

try {
  if (cmd === 'setup') {
    const { runSetup } = await import('./setup.js');
    await runSetup();
  } else if (cmd === 'verify') {
    const { runVerify } = await import('./verify.js');
    await runVerify();
  } else if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
    console.log(
      [
        'hubspot-multi-mcp — connect Claude to many HubSpot portals at once (read-only).',
        '',
        'Usage:',
        '  npx hubspot-multi-mcp setup    Add/verify your portals and wire up Claude Desktop',
        '  npx hubspot-multi-mcp verify   Check which portals are reachable (no secrets shown)',
        '  npx hubspot-multi-mcp          Run the MCP server (Claude Desktop does this for you)',
      ].join('\n')
    );
  } else {
    const { startServer } = await import('./server.js');
    await startServer();
  }
} catch (e) {
  console.error(e?.message || e);
  process.exit(1);
}
