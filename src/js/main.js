// Entry point. Concatenated last by build.js, so functions from detect /
// inspect / render / actions are all defined as globals by the time we run.

let currentState = null;
let busy = false;

async function boot() {
  const root = document.getElementById('app');
  if (!currentState) {
    // Attach the delegated click handler exactly once.
    root.addEventListener('click', onActionClick);
  }
  try {
    currentState = await loadState();
    renderApp(currentState, root);
  } catch (err) {
    showError(root, err);
  }
}

async function loadState() {
  const inspectResult = await inspectOrigin();
  const detectResult = detectTools(inspectResult.localStorage, toObserved(inspectResult));
  return {
    origin: typeof location !== 'undefined' ? location.origin : '',
    inspectResult,
    detectResult,
  };
}

async function onActionClick(e) {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  if (busy) return;
  const action = target.dataset.action;
  const toolName = target.dataset.tool || null;
  const tool = toolName
    ? currentState.detectResult.tools.find((t) => t.name === toolName)
    : null;
  busy = true;
  try {
    const didMutate = await dispatch(action, tool);
    if (didMutate) await boot();
  } catch (err) {
    alert(`hyper: action "${action}" failed:\n${err && err.message ? err.message : err}`);
  } finally {
    busy = false;
  }
}

async function dispatch(action, tool) {
  switch (action) {
    case 'reset-tool': {
      if (!tool) return false;
      const plan = planResetTool(tool);
      if (!confirm(`Reset ${tool.name}? Will delete: ${describePlan(plan)}.`)) return false;
      await resetTool(tool);
      return true;
    }
    case 'refresh-tool': {
      if (!tool) return false;
      await forceRefreshTool(tool, (url) => window.open(url, '_blank'));
      return true;
    }
    case 'refresh-all': {
      const n = currentState.detectResult.tools.length;
      if (n === 0) return false;
      if (!confirm(`Refresh all tools? Will clear caches and unregister SWs for ${n} tool${n === 1 ? '' : 's'}.`)) return false;
      await refreshAllTools(currentState.detectResult);
      return true;
    }
    case 'nuke': {
      const plan = planNuke(currentState.inspectResult);
      const summary = describePlan(plan);
      const input = prompt(`NUKE EVERYTHING on this origin.\n\nWill delete: ${summary}.\n\nType "delete" to confirm:`);
      if (input !== 'delete') return false;
      await nukeOrigin(currentState.inspectResult);
      return true;
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
