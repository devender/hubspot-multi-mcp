// server.js — local stdio MCP server for Claude Desktop (and any stdio MCP client).
//
// Exposes READ-ONLY tools over ANY number of HubSpot portals you name yourself. Every tool takes
// an `instance` argument naming which portal to use; `hubspot_find_across` fans out over all of
// them at once — the thing a one-account connector structurally cannot do.
//
// Tokens are read at startup from ~/.config/hubspot-multi-mcp/portals.json — never from this repo.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { makeClient } from './lib/hsClient.js';
import { loadPortals } from './lib/portals.js';

const STANDARD_OBJECTS = ['contacts', 'companies', 'deals', 'tickets'];

function text(obj) {
  return { content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] };
}

export async function startServer() {
  const portals = loadPortals(); // { name: { token, baseUrl } }
  const names = Object.keys(portals);
  const clients = Object.fromEntries(names.map((n) => [n, makeClient(portals[n].token, portals[n].baseUrl)]));

  // `instance` selector: an enum of configured names. Default to the sole portal when there is
  // exactly one, so single-portal users never have to name it. Fall back to a string (with a
  // helpful message) when nothing is configured yet.
  let instanceArg;
  if (names.length === 0) {
    instanceArg = z
      .string()
      .describe('Which HubSpot portal to use (none configured yet — run `npx hubspot-multi-mcp setup`).');
  } else if (names.length === 1) {
    instanceArg = z
      .enum(names)
      .default(names[0])
      .describe(`Which HubSpot portal to use. Only "${names[0]}" is configured, so it is the default.`);
  } else {
    instanceArg = z
      .enum(names)
      .describe(`Which HubSpot portal to use: ${names.join(', ')}. Ask the user, or call hubspot_list_instances.`);
  }

  const objectArg = z
    .string()
    .default('contacts')
    .describe(
      'CRM object type: contacts, companies, deals, tickets, or a custom object name. ' +
        'Call hubspot_list_objects to see custom object types in a portal.'
    );

  function clientFor(instance) {
    const c = clients[instance];
    if (!c) {
      throw new Error(
        `Portal "${instance}" is not configured. Available: ${names.join(', ') || '(none — run `npx hubspot-multi-mcp setup`)'}.`
      );
    }
    return c;
  }

  const server = new McpServer({ name: 'hubspot-multi', version: '0.1.0' });

  server.tool(
    'hubspot_list_instances',
    'List which HubSpot portals are connected (by the names you gave them) and their account ids. READ-ONLY. Call this first to see what portals are available.',
    {},
    async () => {
      const rows = [];
      for (const n of names) {
        try {
          const info = await clients[n].accountInfo();
          rows.push(`${n}: portal ${info.portalId} (${info.uiDomain || 'na'})`);
        } catch {
          try {
            await clients[n].ping();
            rows.push(`${n}: connected (read access OK; add the account-info scope to show the portal id)`);
          } catch (e) {
            rows.push(`${n}: ERROR — ${e.message}`);
          }
        }
      }
      return text(rows.length ? rows.join('\n') : 'No portals configured. Run `npx hubspot-multi-mcp setup`.');
    }
  );

  server.tool(
    'hubspot_list_objects',
    'List the CRM object types available in a portal — the four standard ones plus any CUSTOM objects defined in that portal. READ-ONLY. Use this before searching a non-standard object.',
    { instance: instanceArg },
    async ({ instance }) => {
      const schemas = await clientFor(instance).listSchemas();
      const custom = (schemas.results ?? []).map((s) => ({
        name: s.name,
        objectTypeId: s.objectTypeId,
        labels: s.labels,
        fullyQualifiedName: s.fullyQualifiedName,
      }));
      return text({ standard: STANDARD_OBJECTS, custom });
    }
  );

  server.tool(
    'hubspot_describe_object',
    'List the properties (fields) of a CRM object type in a portal, so you know what to search on and what to request. READ-ONLY.',
    { instance: instanceArg, object: objectArg },
    async ({ instance, object }) => {
      const r = await clientFor(instance).listProperties(object);
      const props = (r.results ?? []).map((p) => ({
        name: p.name,
        label: p.label,
        type: p.type,
        fieldType: p.fieldType,
      }));
      return text({ object, count: props.length, properties: props });
    }
  );

  server.tool(
    'hubspot_search',
    'Search a HubSpot CRM object in a chosen portal. READ-ONLY. Use `query` for a free-text search (name, email, company/domain); omit it to list recent records.',
    {
      instance: instanceArg,
      object: objectArg,
      query: z.string().optional().describe('Free-text search string (e.g. a name, email, or company domain).'),
      properties: z.array(z.string()).optional().describe('Which properties to return (defaults to the HubSpot standard set).'),
      limit: z.number().int().min(1).max(100).optional().describe('Max records to return (default 25).'),
    },
    async ({ instance, object, query, properties, limit }) => {
      const r = await clientFor(instance).search(object, { query, properties, limit: limit ?? 25 });
      return text(r.results ?? r);
    }
  );

  server.tool(
    'hubspot_get',
    'Fetch a single HubSpot record by id from a chosen portal. READ-ONLY.',
    {
      instance: instanceArg,
      object: objectArg,
      id: z.string().describe('The record id.'),
      properties: z.array(z.string()).optional().describe('Which properties to return.'),
    },
    async ({ instance, object, id, properties }) => {
      const r = await clientFor(instance).getById(object, id, properties);
      return text(r);
    }
  );

  server.tool(
    'hubspot_list_owners',
    'List CRM owners (users) in a chosen portal, to resolve owner ids to people. READ-ONLY.',
    { instance: instanceArg },
    async ({ instance }) => {
      const r = await clientFor(instance).listOwners();
      return text(r.results ?? r);
    }
  );

  server.tool(
    'hubspot_find_across',
    'Search a free-text query across ALL connected HubSpot portals at once, and report which portal(s) matched. READ-ONLY. Use this when the user does not know which portal a record lives in (e.g. "find jane@example.com in any of my hubspots").',
    {
      query: z.string().describe('Free-text search string (name, email, company/domain).'),
      object: objectArg,
      limit: z.number().int().min(1).max(50).optional().describe('Max records per portal (default 10).'),
    },
    async ({ query, object, limit }) => {
      if (names.length === 0) return text('No portals configured. Run `npx hubspot-multi-mcp setup`.');
      const per = limit ?? 10;
      const summary = [];
      for (const n of names) {
        try {
          const r = await clients[n].search(object, { query, limit: per });
          const results = r.results ?? [];
          summary.push({ instance: n, matched: results.length > 0, count: results.length, results });
        } catch (e) {
          summary.push({ instance: n, error: e.message });
        }
      }
      const hits = summary.filter((s) => s.matched).map((s) => s.instance);
      return text({ query, object, matched_in: hits, portals: summary });
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
