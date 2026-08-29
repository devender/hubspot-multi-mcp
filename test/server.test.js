import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli.js');
const EXPECTED = [
  'hubspot_describe_object',
  'hubspot_find_across',
  'hubspot_get',
  'hubspot_list_instances',
  'hubspot_list_objects',
  'hubspot_list_owners',
  'hubspot_search',
];

test('the MCP server boots and registers the 7 read-only tools', async () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmm-srv-'));
  const child = spawn(process.execPath, [cli], {
    env: { ...process.env, HUBSPOT_MULTI_MCP_DIR: emptyDir },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  let out = '';
  // Attach the listener BEFORE writing the requests, but do not await yet.
  const toolsP = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for tools/list')), 8000);
    child.stdout.on('data', (chunk) => {
      out += chunk;
      for (const line of out.split('\n')) {
        if (!line.trim()) continue;
        try {
          const m = JSON.parse(line);
          if (m.id === 2 && m.result) {
            clearTimeout(timer);
            resolve((m.result.tools || []).map((t) => t.name));
          }
        } catch {
          /* partial line — wait for more */
        }
      }
    });
    child.on('error', reject);
  });
  child.stdin.write(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'probe', version: '0' },
      },
    }) + '\n'
  );
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');

  const names = await toolsP;
  child.kill();
  assert.deepEqual(names.sort(), EXPECTED.slice().sort());
});
