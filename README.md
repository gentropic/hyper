# hyper

A browser-native inspector and fixer for GCU PWAs. When a tool's service worker has cached stale bytes, when IndexedDB has filled with junk, when a PWA bricks itself and won't recover, `hyper` is the always-available escape hatch.

Live at **[gentropic.org/hyper](https://gentropic.org/hyper)**.

Part of the [GCU](https://github.com/gentropic) stack of single-file working tools.

**Status:** v0.4 shipped. Single ~87 KB `index.html`, zero dependencies, 158 tests. See [`SPEC.md`](SPEC.md) for the design contract.

---

## The idea

Service workers cache aggressively. That's the right default for fast offline-capable PWAs, but it creates a failure class with no escape: the SW serves old bytes, the page can't render new state, the PWA has no chrome (no URL bar, no menus, no way out), and the user can't recover from inside the app. Uninstalling the PWA from the OS doesn't unregister the SW or clear storage — those persist scoped to the origin. The only fix is browser → site settings → clear data, which also wipes all the user's work.

hyper provides the missing layer: a known-good URL outside any GCU PWA's service worker scope. It loads even when every tool's SW on the origin is broken, enumerates everything the origin has cached/stored, lets the user **export their data before nuking**, and offers targeted cleanup (just caches, just SWs, just IDB) instead of all-or-nothing.

It's the "press this when something is wrong" tool. Calculator-scale, single-file, no install, no dependencies.

---

## What it does

- **Inspect** — list all caches, IDB databases, localStorage entries, and SW registrations on the origin. Group by detected GCU tool. Per-tool storage bar with opt-in cache byte measurement (kept off the load path so hyper still paints fast when something is broken).
- **Containers** — surface runtime-published images (e.g. dd containers) via the `gcu:img:<id>` convention. Per-image Reset is record-level: cleans only that image's records without touching siblings on the same runtime's IDB.
- **Export** — bundle user data as a downloadable JSON file. Cache Storage entries are skipped by default (regenerable from network); IDB, localStorage, and sessionStorage are included.
- **Selectively clear** — clear just caches, just SWs, just IDB, or just LS. Per-tool, per-image, per-unattributed-bucket, or origin-wide. Each action confirms before destroying.
- **Force-refresh** — the common case: unregister a tool's SWs + clear its caches + open it fresh. Preserves user data. Picks a local URL when running outside the tool's prod origin.
- **Diagnostics** — show a per-tool timeline of events tools have logged via the `gcu:log:<name>` convention (boot, error, etc.). Lets you see what's been happening before deciding what to clear.
- **Nuke** — last resort. Wipes everything for the origin. Confirms via a phrase prompt (type "delete").

What it doesn't do: launch tools, manage settings, do anything automatically without user consent.

---

## How it works

Web storage is partitioned by **origin** — `scheme + host + port`. Not by path. So everything under `https://gentropic.org/*` shares one storage namespace, including caches/IDB/localStorage/SW registrations. A page at `gentropic.org/hyper/` can enumerate and manage all of it via standard web APIs:

- `indexedDB.databases()` (with name-probe fallback for older Safari / WebViews that lack it)
- `caches.keys()` + `cache.keys()` + `cache.match()`
- `navigator.serviceWorker.getRegistrations()`
- `localStorage` / `sessionStorage`

Service worker scope is path-based, so hyper at `/hyper/` is **outside** any individual GCU tool's SW scope (`/ep/`, `/calque/`, etc.). It loads via direct network even when a tool's SW is broken, then reaches in to clean things up.

For tools hosted on a non-`gentropic.org` origin, `index.html` can be deployed at any path on that same origin and will manage the origin's storage — no code change needed. Standalone `file://` use also works on Firefox (all `file://` URLs share an origin there); Chrome's per-file opaque-origin model makes it more limited. See [SPEC §Deployment](SPEC.md) for the full story.

---

## The `gcu:tool` convention

GCU tools advertise themselves by writing a marker to localStorage on each boot:

```js
localStorage.setItem('gcu:tool:ep', JSON.stringify({
  name: 'ep',
  version: '0.2.3',
  storageKeys: {
    idb: ['ep'],
    localStoragePrefix: 'ep:',
    cacheNames: ['ep-shell-v1'],
    swScopes: ['/ep/'],
  },
}));
```

hyper reads all `gcu:tool:*` keys to identify which storage belongs to which tool. Tools that don't announce themselves still appear, attributed by heuristic where possible and as "unknown" otherwise.

Tools can also opt into the sibling `gcu:log:<name>` convention — a small bounded ring of diagnostic events (boot, error, etc.) that hyper surfaces in each tool's show-details section. Strict caps (500 bytes per entry, 50 entries per ring) keep it from filling localStorage.

A third namespace, `gcu:img:<id>`, handles *containers* — runtime-published images like dd's PWA containers. The marker carries cleanup metadata (`storageKeys` block) so hyper can delete a single image's records without touching siblings on the same runtime's IDB. See SPEC.md for all three contracts.

---

## Try it locally

The built `index.html` is committed. No install step:

```sh
git clone https://github.com/gentropic/hyper
cd hyper
# open index.html directly, or serve the directory (recommended for SW APIs):
python -m http.server 8000
# then visit http://localhost:8000/
```

Some browser APIs (`navigator.serviceWorker`, `navigator.storage.estimate`) only work fully over `http://localhost` or HTTPS, not `file://` — so for a real test, serve the directory.

### Build from source

```sh
npm run build   # or: node build.js
npm test        # or: node --test
```

Zero npm dependencies. The build concatenates `src/template.html` + `src/style.css` + `src/js/*.js` into a single `index.html`.

---

## Credit + ethos

Part of the GCU stack. Same single-file ethos as `ep`, `calque`, `dee`, `plan`, `rv`, `gcu-press` — tools that work offline, work in ten years, work without a server.

hyper is the safety net for that ethos. If everything else fails, hyper still loads.

---

## License

MIT. See [LICENSE](LICENSE).
