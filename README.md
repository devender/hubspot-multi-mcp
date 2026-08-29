# hubspot-multi-mcp

**Talk to _all_ your HubSpot portals from Claude — at once, by name.**

A small, local, **read-only** MCP server that connects the **Claude Desktop** app to **as many
HubSpot portals as you want** (Sales, Marketing, an acquired brand, an EU account, each of your
clients…). You name each portal; then just say _"in the **sales** hubspot, find…"_ and Claude uses
the right one. It runs on your own computer with **your own read-only keys** — nothing is hosted and
no credentials are shared.

> **Unofficial.** Not affiliated with, or endorsed by, HubSpot, Inc. "HubSpot" is a trademark of
> its owner and is used here only to describe what this tool connects to.

---

## Why this exists

HubSpot's own connector is **one account per connection** — there's no supported way to point a
single Claude connection at two portals, and Claude won't let you add the same connector twice to
get around it. If your company runs **more than one HubSpot portal**, you're stuck.

This is the practical way around it: a tiny server that runs **on your machine**, talks to **all**
your portals with **your own read-only keys**, and shows up as a HubSpot tool inside Claude. It can
even **search every portal at once** and tell you which one a record lives in — something a
one-account connector simply can't do.

## What you get

Read-only tools, each targeting a portal by the name you gave it:

| Tool | What it does |
|---|---|
| `hubspot_list_instances` | Show which portals are connected + their account ids |
| `hubspot_list_objects` | List object types in a portal — standard **and custom** objects |
| `hubspot_describe_object` | List the fields/properties of an object type |
| `hubspot_search` | Search a CRM object (contacts / companies / deals / tickets / custom) |
| `hubspot_get` | Fetch a single record by id |
| `hubspot_list_owners` | List CRM owners (users) |
| `hubspot_find_across` | **Search every connected portal at once** and report which matched |

**Read-only by design** — the server only ever issues read calls, so it cannot create, edit, or
delete anything, even if a key had write permission.

---

## Quick start  *(about 5 minutes)*

**You need:** a Mac or Windows PC, the **Claude Desktop** app, **Node.js 18+**
(check with `node --version`; if it's missing, install the LTS from <https://nodejs.org>), and a
**read-only HubSpot token for each portal** (how to get one is below).

1. **Open a terminal** (macOS: Terminal app; Windows: PowerShell).
2. **Run setup** — this one command does everything (no download, no `npm install`):
   ```bash
   npx hubspot-multi-mcp setup
   ```
3. **Name each portal and paste its token** when asked. Repeat for as many portals as you have; press
   **Enter** on the name to finish. Setup checks each token and saves them privately on your computer.
4. **Fully quit Claude Desktop** (macOS: **Cmd+Q**, not just the window; Windows: right-click the tray
   icon → Quit) and reopen it.
5. **Try it** — ask Claude:
   > *"List my hubspot portals."*
   then
   > *"In the **sales** hubspot, find the contact for jane@example.com."*
   or, when you're not sure which portal has it:
   > *"Find acme.com **across all** my hubspots."*

**Check it's working any time:** `npx hubspot-multi-mcp verify` (prints the portals it can reach; no
secrets shown).
**Add or change a portal:** run `npx hubspot-multi-mcp setup` again.

---

## How to get a read-only HubSpot token  *(one per portal)*

Do this in each HubSpot portal you want to connect. You need to be an admin of that portal (or ask
one to do it for you).

1. In HubSpot, go to **Settings → Integrations → Private Apps → Create a private app**.
2. Name it something like `claude-readonly`.
3. On the **Scopes** tab, grant **read-only** scopes only (no `.write`):
   - `crm.objects.contacts.read`, `crm.objects.companies.read`, `crm.objects.deals.read`
   - `crm.objects.owners.read` (to see record owners), and `tickets` read if you use tickets
   - `crm.schemas.contacts.read` / `.companies.read` / `.deals.read` (so field discovery works)
   - *(optional)* the **account-info** read scope — only needed to display the portal id
4. **Create the app** and copy its **access token** (starts with `pat-…`). That's what you paste into
   setup. Keep it safe — treat it like a password.

> Granting only read scopes means the token **physically cannot change anything**, which pairs with
> this server being read-only by design.

---

## How your keys are handled  (security)

- **Read-only by construction** — there is no create/update/delete code path in this tool.
- Your tokens are stored at `~/.config/hubspot-multi-mcp/portals.json` (file mode `600`, readable
  only by you), **outside** the package — never committed, never uploaded, never printed back.
- Tokens are **redacted from every error message**, so a key can't leak into a Claude transcript.
- **Nothing is hosted.** The only network calls are read requests from your machine to HubSpot.

---

## Using more than one portal

Every request picks a portal by name. If you only set up **one** portal, you don't have to name it —
it's the default. With several, just say which one (*"in the marketing hubspot…"*), or let Claude
search them all with `hubspot_find_across`. Custom objects work too: ask Claude to
*"list the objects in the sales hubspot"* and it'll show your custom object types, which you can then
search like any other.

## Troubleshooting

- **The tool doesn't appear in Claude** → make sure you **fully quit and reopened** Claude Desktop
  (Cmd+Q on macOS). A running app only loads MCP servers at startup.
- **"spawn npx ENOENT" / server won't start** → Node.js isn't installed, or was installed after
  setup. Install Node (<https://nodejs.org>) and re-run `npx hubspot-multi-mcp setup`.
- **A token "did not work"** → wrong portal, or missing read scopes. Re-issue the private-app token
  with the read scopes above and run setup again.

## For teams  *(operator guide)*

This uses **per-user read-only tokens**: an admin mints them, each person runs setup themselves. No
keys are ever shared in chat.

1. In each portal, create a read-only private app per person (scopes above); copy the `pat-…` token.
2. Send each person **their** tokens **securely** — e.g. a **1Password share restricted to their
   email**, with an expiration. **Never** paste a token into Slack or email.
3. Have them follow **Quick start** above.
4. **To off-board someone:** delete their private app in HubSpot. Tokens are independent, so revoking
   one person affects no one else.

## Run from source  *(optional, for developers)*

```bash
git clone https://github.com/devender/hubspot-multi-mcp
cd hubspot-multi-mcp
npm install
npm run setup     # same interactive setup; registers a local-path launcher
```

## License

MIT — see [LICENSE](./LICENSE).
