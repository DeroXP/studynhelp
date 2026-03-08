// Simple in-memory state with localStorage persistence

const LS_KEY = 'snhelp_state_v1';

const defaultState = {
  sessionId: null,
  settings: {
    theme: 'dark',
    detectionSensitivity: 0.6,
    modelOverride: null,
    graph: { grid: true },
  },
  history: [], // chat summaries
};

let state = loadState();
const listeners = new Set();

function genId() {
  return 'sess_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { ...defaultState, sessionId: genId() };
}

function saveState() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch {}
}

export function getState() { return state; }
export function getSessionId() { return state.sessionId || (state.sessionId = genId(), saveState(), state.sessionId); }

export function update(fn) {
  const prev = state;
  state = fn({ ...state });
  saveState();
  listeners.forEach((l) => {
    try { l(state, prev); } catch {}
  });
  return state;
}

export function setSetting(key, value) {
  return update((s) => {
    s.settings = { ...s.settings, [key]: value };
    return s;
  });
}

export function addHistoryEntry(entry) {
  return update((s) => {
    s.history = [...(s.history || []), { ...entry, ts: Date.now() }].slice(-200);
    return s;
  });
}

export function clearSession() {
  return update((s) => {
    s.history = [];
    s.sessionId = genId();
    return s;
  });
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
