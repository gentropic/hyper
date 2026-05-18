# hyper

A browser-native inspector and fixer for GCU PWAs. When a tool's service worker has cached stale bytes, when IndexedDB has filled with junk, when a PWA bricks itself and won't recover, `hyper` is the always-available escape hatch.

Live (planned) at **[gentropic.org/hyper](https://gentropic.org/hyper)**.

Part of the [GCU](https://github.com/gentropic) stack of single-file working tools.

**Status:** pre-0.1. Spec only. See [`SPEC.md`](SPEC.md) for the design contract.

---

## The idea

Service workers cache aggressively. That's the right default for fast offline-capable PWAs, but it creates a failure class with no escape: the SW serves old bytes, the page can't render new state, the PWA has no chrome (no URL bar, no menus, no way out), and the user can't recover from inside the app. Uninstalling the PWA from the OS doesn't unregister the SW or clear storage — those persist scoped to the origin. The only fix is browser → site settings → clear data, which also wipes all the user's work.

hyper provides the missing layer: a known-good URL outside any GCU PWA's service worker scope. It loads even when every tool's SW on the origin is broken, enumerates everything the origin has cached/stored, lets the user **export their data before nuking**, and offers targeted cleanup (just caches, just SWs, just IDB) instead of all-or-nothing.

It's the "press this when something is wrong" tool. Calculator-scale, single-file, no install, no dependencies.

---

## What it does

- **Inspect** — list all caches, IDB databases, localStorage entries, and SW registrations on the origin. Group by detected GCU tool.
- **Export** — bundle user data as a downloadable JSON file. Cache Storage entries are skipped by default (regenerable from network); IDB and localStorage are included.
- **Selectively clear** — clear just caches, just SWs, just IDB, or just LS. Per-tool or origin-wide. Each action confirms before destroying.
- **Force-refresh** — the common case: unregister a tool's SWs + clear its caches + open it fresh. Preserves user data.
- **Nuke** — last resort. Wipes everything for the origin. Confirms loudly.

What it doesn't do: launch tools, manage settings, do anything automatically without user consent.

---

## How it works

Web storage is partitioned by **origin** — `scheme + host + port`. Not by path. So everything under `https://gentropic.org/*` shares one storage namespace, including caches/IDB/localStorage/SW registrations. A page at `gentropic.org/hyper/` can enumerate and manage all of it via standard web APIs:

- `indexedDB.databases()`
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

See SPEC.md for the full announcement contract.

---

## Try it locally (when built)

No build step required to run — just open `index.html`:

```sh
git clone https://github.com/gentropic/hyper
cd hyper
# open index.html in your browser
```

### Build from source (when there is source)

```sh
node build.js
node --test
```

Zero npm dependencies. Single HTML file output.

---

## Credit + ethos

Part of the GCU stack. Same single-file ethos as `ep`, `calque`, `dee`, `plan`, `rv`, `gcu-press` — tools that work offline, work in ten years, work without a server.

hyper is the safety net for that ethos. If everything else fails, hyper still loads.

---

## License

MIT. See [LICENSE](LICENSE).
