// Entry point. Concatenated last by build.js, so functions from detect /
// inspect / render / actions are all defined as globals by the time we run.

let currentState = null;
let busy = false;
// Opt-in cache byte totals. Cleared on every boot() because cache contents
// may have changed; preserved across renders within a single boot.
let cacheSizes = new Map();

async function boot() {
  const root = document.getElementById('app');
  if (!currentState) {
    // Attach the delegated click handler exactly once.
    root.addEventListener('click', onActionClick);
  }
  try {
    cacheSizes = new Map();
    currentState = await loadState();
    currentState.cacheSizes = cacheSizes;
    renderApp(currentState, root);
  } catch (err) {
    showError(root, err);
  }
}

async function loadState() {
  // Pre-read localStorage so we can compute IDB hints before inspectOrigin
  // runs. The hints are only consumed by the listIdbs fallback path on
  // browsers without indexedDB.databases() (older Safari, some WebViews).
  const lsForHints = listLocalStorage();
  const idbHints = gatherIdbHints(lsForHints);
  const inspectResult = await inspectOrigin({ idbHints });
  const detectResult = detectTools(inspectResult.localStorage, toObserved(inspectResult));
  const { logs, warnings: logWarnings } = parseLogs(inspectResult.localStorage);
  const { images, warnings: imageWarnings } = parseImages(inspectResult.localStorage);
  return {
    origin: typeof location !== 'undefined' ? location.origin : '',
    inspectResult,
    detectResult,
    logs,
    logWarnings: [...logWarnings, ...imageWarnings],
    images,
  };
}

async function onActionClick(e) {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  if (busy) return;
  const action = target.dataset.action;
  const toolName = target.dataset.tool || null;
  const imageId = target.dataset.image || null;
  const tool = toolName
    ? currentState.detectResult.tools.find((t) => t.name === toolName)
    : null;
  const image = imageId
    ? (currentState.images || []).find((i) => i.id === imageId)
    : null;
  busy = true;
  try {
    const didMutate = await dispatch(action, tool, image);
    if (didMutate) await boot();
  } catch (err) {
    await messageDialog({
      title: `Action "${action}" failed`,
      body: err && err.message ? err.message : String(err),
      danger: true,
    });
  } finally {
    busy = false;
  }
}

async function dispatch(action, tool, image) {
  switch (action) {
    case 'reset-tool': {
      if (!tool) return false;
      const plan = planResetTool(tool);
      const ok = await confirmDialog({
        title: `Reset ${tool.name}?`,
        body: `Will delete: ${describePlan(plan)}.`,
        confirmLabel: 'Reset',
        danger: true,
      });
      if (!ok) return false;
      await resetTool(tool);
      return true;
    }
    case 'refresh-tool': {
      if (!tool) return false;
      await forceRefreshTool(tool, (url) => window.open(url, '_blank'), location.origin);
      return true;
    }
    case 'refresh-all': {
      const n = currentState.detectResult.tools.length;
      if (n === 0) return false;
      const ok = await confirmDialog({
        title: 'Refresh all tools?',
        body: `Will clear caches and unregister service workers for ${n} tool${n === 1 ? '' : 's'}. User data (IDB, localStorage) is preserved.`,
        confirmLabel: 'Refresh all',
      });
      if (!ok) return false;
      await refreshAllTools(currentState.detectResult);
      return true;
    }
    case 'reset-unattributed': {
      const plan = planResetUnattributed(currentState.detectResult, currentState.inspectResult);
      const ok = await confirmDialog({
        title: 'Reset all unattributed storage?',
        body: `Will delete: ${describePlan(plan)}.`,
        confirmLabel: 'Reset',
        danger: true,
      });
      if (!ok) return false;
      await resetUnattributed(currentState.detectResult, currentState.inspectResult);
      return true;
    }
    case 'export-unattributed': {
      await exportUnattributed(currentState);
      return false;
    }
    case 'reset-image': {
      if (!image) return false;
      const plan = planResetImage(image);
      const ok = await confirmDialog({
        title: `Reset container "${image.name}"?`,
        body: `Will delete: ${describeImagePlan(plan)}. Other containers sharing this runtime's storage are not affected.`,
        confirmLabel: 'Reset',
        danger: true,
      });
      if (!ok) return false;
      await resetImage(image);
      return true;
    }
    case 'open-image': {
      if (!image || !image.scope) return false;
      window.open(image.scope, '_blank');
      return false;
    }
    case 'nuke': {
      const plan = planNuke(currentState.inspectResult);
      const ok = await confirmWithPhrase({
        title: 'Nuke everything on this origin',
        body: `Will delete: ${describePlan(plan)}.\n\nThis cannot be undone. Export first if you want your data back.`,
        phrase: 'delete',
        confirmLabel: 'Nuke',
      });
      if (!ok) return false;
      await nukeOrigin(currentState.inspectResult);
      return true;
    }
    case 'compute-cache-sizes': {
      if (!tool) return false;
      const names = tool.storage.cacheNames || [];
      if (names.length === 0) return false;
      const sizes = await bytesForCaches(names);
      for (const [k, v] of sizes) cacheSizes.set(k, v);
      // Re-render in place — no need to re-inspect the origin.
      renderApp(currentState, document.getElementById('app'));
      return false;
    }
    case 'compute-unattributed-cache-sizes': {
      const names = currentState.detectResult.unattributed.cacheNames || [];
      if (names.length === 0) return false;
      const sizes = await bytesForCaches(names);
      for (const [k, v] of sizes) cacheSizes.set(k, v);
      renderApp(currentState, document.getElementById('app'));
      return false;
    }
    case 'export-tool': {
      if (!tool) return false;
      await exportTool(currentState, tool.name);
      return false;
    }
    case 'export-all': {
      await exportAll(currentState);
      return false;
    }
    default:
      // eslint-disable-next-line no-console
      console.warn('[hyper] unknown action:', action);
      return false;
  }
}

function showError(root, err) {
  root.replaceChildren();
  const pre = document.createElement('pre');
  pre.className = 'hyper-error';
  pre.textContent = `hyper failed to load:\n${err && err.stack ? err.stack : err}`;
  root.appendChild(pre);
}

boot();
