# hyper — design spec

`hyper` is a small browser-native tool that inspects and fixes the state of GCU PWAs on an origin. When a tool's service worker has cached stale bytes, when IndexedDB has accumulated junk, when a PWA bricks itself and won't recover, `hyper` is the always-available escape hatch.

Part of the GCU stack — sibling in spirit to `ep`, `calque`, `dee`, `plan`, `rv`, `gcu-press`. Single-file HTML artifact, same ethos.

**Status:** pre-0.1. Spec only; nothing built.

**Working artifact (planned):** `index.html` at the repo root, deployed at `gentropic.org/hyper/`. Single self-contained file, no install, no server, no dependencies.

---

## What hyper is, what it isn't

hyper is a **PWA inspector and fixer**. It exists because the web platform has no answer to "my PWA is bricked and I can't get out." When that happens, the user's only recourse today is the OS settings → site data → clear, which also nukes all their work.

hyper provides the missing layer: a known-good URL that loads outside the broken tool's service worker scope, can enumerate everything the origin has cached/stored, lets the user **export their data before nuking**, and offers targeted cleanup (just caches, just SWs, just IDB) instead of all-or-nothing.

hyper is **not**:

- A launcher or hub for GCU tools (browsing/opening tools is not its job)
- A settings editor or profile manager
- A general-purpose web storage browser like browser devtools (it's GCU-aware, friendly-shaped)
- A migration tool (one-shot inspector + fixer, not a continuous service)

If you want to *open* a GCU tool, you go to its URL directly. hyper is what you reach for when something has gone wrong.

---

## The problem hyper solves

Service workers cache aggressively. That's the right default for fast offline-capable PWAs, but it creates a failure class with no escape:

1. PWA installs with a service worker
2. Code or data schema changes upstream
3. SW serves the old cached version, page fails to render correctly
4. PWA has no chrome (no URL bar, no menus), user can't escape from inside
5. Uninstalling the PWA from the OS *doesn't* unregister the SW or clear storage — those persist scoped to the origin
6. Only fix: browser → site settings → clear data → also wipes all user work

This was demonstrated concretely on 2026-05-18 when an ep PWA on Android served bytes from before the v0.2 syntax migration (three days stale). The cached UI froze trying to render new-format state. There was no in-app way to recover; the cache-bust attempt via `?q=` failed because the SW used `ignoreSearch: true`.

A `gentropic.org/hyper/` page would have let the user:

- See "ep cache: 1.4 MB, last updated 3 days ago"
- See "ep IDB: 7 saved programs (3.2 KB)"
- Hit **export** to download the IDB data as JSON
- Hit **refresh app** to force-fetch a new copy
- Hit **reset everything** as a last resort

Total recovery time: under a minute, no data loss.

---

## Architecture

### Same-origin storage access

Web storage (Cache Storage, IndexedDB, localStorage, SW registrations) is partitioned by **origin** — scheme + host + port. Not by path. Not by GitHub repo. Not by deployment unit.

So everything under `https://gentropic.org/*` shares one storage namespace. A page at `gentropic.org/hyper/` can:

- Enumerate all Cache Storage entries via `caches.keys()` + `cache.keys()` + `cache.match()` for sizes
- Enumerate all IDB databases via `indexedDB.databases()`, then open each to list object stores + record counts
- Read all localStorage / sessionStorage entries on the origin
- Enumerate all SW registrations via `navigator.serviceWorker.getRegistrations()`, see their scopes + states, and unregister them

No CORS, no permission prompts, no cross-origin barriers. The browser sees one origin and grants full storage access.

### Out-of-scope by design (the SW story)

A SW registered with default scope at `/ep/sw.js` controls only `/ep/*` requests. If `hyper` lives at `/hyper/`, ep's SW does **not** intercept it. That's the point:

- ep's SW could be entirely broken — infinite-loop fetch handler, throwing on every request — and `/hyper/` still loads via direct network
- hyper can then enumerate ep's SW (via `navigator.serviceWorker.getRegistrations()`) and unregister the broken one

This is the "always-available escape hatch" property. hyper is designed to load even when *every* GCU tool's SW on the origin is broken.

### Deployment is portable

`index.html` makes no assumption about its origin or path — it inspects whatever origin it's served from. Three shapes are practical:

**Origin-root deployment (primary)** — `gentropic.org/hyper/` manages every GCU tool deployed to `gentropic.org/*`. One hyper for the whole hosted stack.

**Co-hosted with a tool on a third-party origin** — when a GCU tool is hosted somewhere other than `gentropic.org` (e.g., a partner deploys ep at `partner.example.com/embedded-ep/`), the partner can drop `index.html` at any path on that same origin and it will manage that tool's storage. No code change needed; the runtime reads `location.origin` at boot.

**Standalone local file (`file://`)** — drop `index.html` anywhere a browser can open it. The behaviour here depends on the browser:

- **Firefox** treats all `file://` URLs as a single shared origin. A standalone copy in `~/Downloads/` *can* inspect storage for any other `file://`-loaded GCU tool — useful for local development.
- **Chrome / Edge** give each `file://` URL its own opaque origin, so a standalone copy sees nothing. Sharing storage with a `file://` tool on Chrome requires *embedding* hyper inside the tool's HTML (out of scope for this repo — that's the host tool's call).

The build artifact is the same `index.html` in all cases.

### Single file, no dependencies

Like every GCU tool: one `index.html`, inline CSS, inline JS, no framework, no transpile, no npm runtime deps. ~Switchboard tokens for styling. Build script if needed (concatenate src/ → index.html), zero-dep matching ep's build pattern.

---

## Tool discovery

hyper needs to know which storage entries belong to which GCU tool. Two strategies:

### Self-announcement (preferred)

Each GCU tool writes a marker to localStorage on each boot, keyed by the tool's short name:

```js
localStorage.setItem('gcu:tool:ep', JSON.stringify({
  name: 'ep',
  version: '0.2.3',
  installedAt: 1715792345000,
  storageKeys: {
    idb: ['ep'],                      // IDB database names this tool owns
    localStoragePrefix: 'ep:',        // LS keys with this prefix
    cacheNames: ['ep-shell-v1'],      // Cache Storage names
    swScopes: ['/ep/'],               // SW scopes this tool registers
  }
}));
```

hyper reads all `gcu:tool:*` markers (one per tool) and uses them to group ownership. Tools that don't announce themselves still show up as "unidentified" entries — hyper enumerates *everything*, attribution is best-effort.

The announcement convention is documented in this spec and should be adopted by all GCU tools going forward. ep is the first user; calque, dee, etc. follow.

### Heuristic fallback

For pre-announcement tools or third-party origins, hyper falls back to:

- IDB database names matching common patterns (`ep`, `calque`, `dee`, etc.)
- localStorage keys with known prefixes (`ep:*`, `calque:*`, etc.)
- SW scopes matching `/ep/`, `/calque/`, etc.

This gives best-effort attribution without requiring tools to adopt the announcement convention immediately.

---

## Capabilities

### Inspect

For each detected tool, show:

- **Cache Storage**: total size, entry count, last-modified time of newest entry
- **IDB**: database name(s), object store names, record counts per store
- **localStorage / sessionStorage**: key count, total size (when calculable)
- **Service Worker**: scope, state (active / waiting / redundant), script URL, last activated

For the whole origin (cross-tool):

- Total storage used (sum of all of the above)
- Quota (`navigator.storage.estimate()`)
- Number of distinct tools detected
- Number of unattributed entries

Power-user "show details" toggle reveals the raw inspector — every cache entry URL, every IDB record, every LS key/value. For the friendly view, just the summary stats.

### Export

Bundle everything (or per-tool) as a downloadable JSON file:

```json
{
  "exportedAt": "2026-05-18T14:23:00Z",
  "exportedFrom": "https://gentropic.org",
  "tools": {
    "ep": {
      "version": "0.2.3",
      "idb": { "ep": { "programs": [...], "snapshots": [...] } },
      "localStorage": { "ep:current": "ore_body", "ep:settings": {...} }
    }
  },
  "unattributed": {
    "idb": { ... },
    "localStorage": { ... }
  }
}
```

The format is documented and stable. Other GCU tools can import these bundles for restoring data after a reset.

Cache Storage entries are NOT included in the export by default — they're regenerable from the network. Optional "include caches" toggle for offline-archival use.

### Selectively clear

Targeted cleanup actions, each with confirmation:

- **Clear caches** (per-tool or all) — `caches.delete(cacheName)`
- **Unregister SWs** (per-tool or all) — `registration.unregister()`
- **Clear IDB** (per-tool, per-database, or all) — `indexedDB.deleteDatabase(name)`
- **Clear localStorage** (per-prefix or all on origin) — `localStorage.removeItem(...)`

Each action shows what will be affected before the user confirms.

### Force-refresh

The most common operation: "the tool is stale, get me a fresh copy." A single button per tool that:

1. Unregisters the tool's SWs
2. Clears the tool's caches
3. Opens the tool's URL in a new tab (which fetches fresh + re-registers the SW)

User's data (IDB + localStorage) is preserved. Code is re-fetched.

### Nuke everything

The big red button. Confirms loudly, then:

- Unregisters every SW on the origin
- Deletes every cache
- Deletes every IDB database
- Clears localStorage and sessionStorage

After completion, suggests the user export first if they haven't.

---

## UI shape

Single page, divided into sections:

**Top: at-a-glance summary**

```
gentropic.org — GCU storage

3 tools detected · 4.7 MB used (of 10 GB quota)

  ep         1.4 MB cache · 7 programs · v0.2.3 · updated 3 days ago
  calque     2.1 MB cache · 12 sheets · v0.4.1 · updated 1 day ago
  dee        1.2 MB cache · 3 docs · v0.1.0 · updated 5 days ago

[ Export all ]  [ Refresh all ]  [ Reset everything ]
```

Per-tool row clicks expand into a section showing:

- Per-tool actions: Export, Force refresh, Reset this tool
- Storage breakdown (cache / IDB / LS)
- "Show details" toggle for the raw inspector

**Bottom: unattributed storage**

Anything hyper can't attribute (entries without a `gcu:tool` marker and no matching heuristic) shows in a separate section. Same actions available, but labeled "Unknown."

### Aesthetic

Switchboard tokens. Light/dark theme follows the OS. Same chrome as ep / calque / dee (compact header, monospace gutter for values, accent color for actions).

Critical-action buttons are **danger-styled** (red border, "are you sure" modal with the word "delete" required to confirm for nuke).

---

## Out of scope

Deliberately:

- **Launching tools** — hyper doesn't list "open ep" or browse tools. Use bookmarks or type the URL.
- **Tool installation** — PWA installation is the browser's job.
- **Settings management for individual tools** — each tool has its own settings UI. hyper doesn't reach into them.
- **Migration between tool versions** — if a tool changes its data schema, the tool itself handles migration. hyper just hands the user the raw data via export.
- **Cross-origin recovery** — hyper at `gentropic.org/hyper/` cannot reach storage on `example.com` or `file://`. For those, ship hyper bundled with the tool's artifact.
- **Realtime monitoring / metrics** — hyper is a tool you visit when something's wrong, not a dashboard you keep open.
- **AI suggestions or auto-fix** — every destructive action requires explicit user confirmation. hyper recommends nothing on its own.

---

## File layout (planned)

```
hyper/
  README.md
  SPEC.md                ← this document
  LICENSE                ← MIT
  .gitignore
  index.html             ← built artifact; served at gentropic.org/hyper/
  build.js               ← zero-deps; concatenates src/ → index.html
  src/
    template.html        ← shell HTML
    style.css            ← Switchboard tokens + hyper-specific
    js/
      main.js            ← entry point
      detect.js          ← tool discovery (announcement + heuristic)
      inspect.js         ← enumerate caches / IDB / LS / SWs
      export.js          ← JSON bundle export
      actions.js         ← clear / unregister / refresh / nuke
      render.js          ← UI rendering
  test/
    detect.test.js       ← node-builtin tests for pure logic
    inspect.test.js
```

`npm run build` is `node build.js`. `npm test` is `node --test`. Both zero-deps.

---

## The `gcu:tool` announcement convention

Documenting it here so future GCU tools (and this one) can rely on the contract.

**Where it lives:** `localStorage["gcu:tool:<name>"]` — one JSON object per tool, keyed by the tool's short name (e.g., `gcu:tool:ep`, `gcu:tool:calque`). hyper enumerates all keys matching `gcu:tool:*`.

**When it's written:** on every boot. Tools should overwrite on each boot rather than write-once, so the version field stays current.

**Shape:**

```json
{
  "name": "ep",
  "displayName": "ep",
  "version": "0.2.3",
  "installedAt": 1715792345000,
  "lastBootedAt": 1715920000000,
  "storageKeys": {
    "idb": ["ep"],
    "localStoragePrefix": "ep:",
    "cacheNames": ["ep-shell-v1"],
    "swScopes": ["/ep/"]
  },
  "links": {
    "homepage": "https://gentropic.org/ep/",
    "repo": "https://github.com/gentropic/ep"
  }
}
```

The `name` field inside the value must match the suffix of the key (`gcu:tool:ep` carries `"name": "ep"`). This convention should be added to each tool's spec as it adopts.

---

## Open questions

- **Should hyper itself have a service worker?** Probably not for v0.1 — staying SW-free guarantees it always loads via direct network. If we want hyper to work offline later, the SW would need to be very conservative (network-first for hyper's own HTML, no aggressive caching).
- **Quota recovery on quota-exhausted origin.** If `navigator.storage.estimate()` reports the origin near quota, hyper should highlight it. The fix is just normal cleanup.
- **Should the export format be importable back into tools?** Yes ideally, but the import side is the tool's responsibility, not hyper's. hyper just emits the bundle in a documented shape.
- **Force-refresh URL in non-prod deployments.** Currently uses `tool.announcement.links.homepage`, the canonical prod URL. When hyper is co-hosted on a third-party origin or running from `file://`, opening the prod URL in a new tab is the wrong action — it doesn't refresh the *local* copy of the tool. Options: skip Force-refresh when origins don't match; add a relative-URL fallback; or let tools announce a relative `openLocal` link alongside `homepage`.
- **Authentication / sensitivity.** Some users might have sensitive data in IDB. The "show details" toggle could be gated behind a "I understand this shows raw data" warning. Probably fine without for v0.1.

---

## Versioning

Same trajectory shape as ep:

- **v0.1** — inspector + selective clear + export + force-refresh. Single deployed artifact at `gentropic.org/hyper/`. ep adopts the `gcu:tool` announcement convention.
- **v0.2** — visual storage breakdown (opt-in, gated behind a Compute button to preserve fast first-paint). `indexedDB.databases()` fallback for browsers that lack it. Documented portable-deployment story (origin-root / third-party-cohost / standalone `file://`).
- **v0.3** — multi-origin awareness (for users with multiple GCU origins they manage). Persistent diagnostics ("ep brick'd twice this week — file a bug?").
- **v1.0** — stable JSON export/import contract. Documented for third-party GCU-shaped tools that want to participate.

Calculator-scale tool. Probably plateaus near v0.5 and stays there for a long time.

---

*Spec written 2026-05-18. Treat as snapshot; the artifact wins when they disagree.*
