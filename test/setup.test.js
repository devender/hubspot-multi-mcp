import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mergeMcpServer, registerInClaudeDesktop, launcherConfig } from '../setup.js';

const LAUNCHER = { command: '/abs/node', args: ['/abs/pkg/cli.js'] };

test('mergeMcpServer adds our server without touching other keys or servers', () => {
  const existing = {
    globalShortcut: 'X',
    mcpServers: { other: { command: 'keep-me' } },
  };
  const merged = mergeMcpServer(existing, 'hubspot-multi', LAUNCHER);
  assert.equal(merged.globalShortcut, 'X'); // sibling top-level key preserved
  assert.deepEqual(merged.mcpServers.other, { command: 'keep-me' }); // other server preserved
  assert.deepEqual(merged.mcpServers['hubspot-multi'], LAUNCHER); // ours added
  // input not mutated
  assert.equal(existing.mcpServers['hubspot-multi'], undefined);
});

test('mergeMcpServer copes with a config that has no mcpServers', () => {
  const merged = mergeMcpServer({ theme: 'dark' }, 'hubspot-multi', LAUNCHER);
  assert.equal(merged.theme, 'dark');
  assert.deepEqual(merged.mcpServers, { 'hubspot-multi': LAUNCHER });
});

test('registerInClaudeDesktop is non-destructive and backs up (mode 600)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmm-cfg-'));
  const cfgPath = path.join(dir, 'claude_desktop_config.json');
  fs.writeFileSync(
    cfgPath,
    JSON.stringify({ globalShortcut: 'X', mcpServers: { other: { command: 'keep-me' } } })
  );
  const { backedUp, parseFailed } = registerInClaudeDesktop({
    configPath: cfgPath,
    serverKey: 'hubspot-multi',
    launcher: LAUNCHER,
    log: () => {},
  });
  assert.equal(parseFailed, false);
  assert.ok(backedUp && fs.existsSync(backedUp), 'a backup was written');
  assert.equal(fs.statSync(backedUp).mode & 0o777, 0o600, 'backup is mode 600');
  const written = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.equal(written.globalShortcut, 'X');
  assert.deepEqual(written.mcpServers.other, { command: 'keep-me' });
  assert.deepEqual(written.mcpServers['hubspot-multi'], LAUNCHER);
});

test('registerInClaudeDesktop warns (not silently) on a corrupt config, keeping the backup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmm-cfg-'));
  const cfgPath = path.join(dir, 'claude_desktop_config.json');
  fs.writeFileSync(cfgPath, '{ this is not json, ');
  let warned = '';
  const { backedUp, parseFailed } = registerInClaudeDesktop({
    configPath: cfgPath,
    serverKey: 'hubspot-multi',
    launcher: LAUNCHER,
    log: (m) => {
      warned += m;
    },
  });
  assert.equal(parseFailed, true);
  assert.match(warned, /not valid JSON/i);
  assert.ok(backedUp && fs.existsSync(backedUp), 'the corrupt config was backed up');
  assert.match(warned, new RegExp(backedUp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const written = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.deepEqual(written.mcpServers['hubspot-multi'], LAUNCHER);
});

test('registerInClaudeDesktop creates a fresh config when none exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmm-cfg-'));
  const cfgPath = path.join(dir, 'nested', 'claude_desktop_config.json');
  const { backedUp } = registerInClaudeDesktop({
    configPath: cfgPath,
    serverKey: 'hubspot-multi',
    launcher: LAUNCHER,
    log: () => {},
  });
  assert.equal(backedUp, null);
  const written = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.deepEqual(written.mcpServers['hubspot-multi'], LAUNCHER);
});

test('launcherConfig pins absolute node + an absolute cli.js (no PATH dependency)', () => {
  const cfg = launcherConfig('/opt/whatever/node_modules/hubspot-multi-mcp');
  assert.equal(cfg.command, process.execPath);
  assert.equal(cfg.args.length, 1);
  assert.equal(cfg.args[0], '/opt/whatever/node_modules/hubspot-multi-mcp/cli.js');
  assert.ok(path.isAbsolute(cfg.args[0]));
  assert.notEqual(cfg.command, 'npx');
});
