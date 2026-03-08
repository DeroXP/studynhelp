import { createEl, injectStyles, makeDraggable, makeResizable } from '../core/dom.js';
import { getState, setSetting, clearSession, subscribe } from '../core/state.js';

const STYLES = `
.snhelp-panel { position: fixed; z-index: 2147483647; top: 20px; right: 20px; width: 420px; height: 520px; color: #e6e6e6; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, 'Helvetica Neue', Arial, 'Noto Sans', 'Liberation Sans', sans-serif; background: rgba(16,18,22,0.92); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,.35); overflow: hidden; }
.snhelp-panel *, .snhelp-panel *::before, .snhelp-panel *::after { box-sizing: border-box; }
.snhelp-header { display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: rgba(255,255,255,0.03); border-bottom: 1px solid rgba(255,255,255,0.08); cursor: move; }
.snhelp-title { font-weight: 700; font-size: 14px; letter-spacing: .4px; }
.snhelp-spacer { flex: 1; }
.snhelp-btn { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12); color: inherit; border-radius: 8px; padding: 6px 10px; cursor: pointer; font-size: 12px; }
.snhelp-btn:hover { background: rgba(255,255,255,0.16); }
.snhelp-content { display: flex; height: calc(100% - 46px); }
.snhelp-tabs { width: 56px; padding: 8px 6px; display: flex; flex-direction: column; gap: 8px; border-right: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.02); }
.snhelp-tab { display: flex; align-items: center; justify-content: center; height: 40px; border-radius: 10px; cursor: pointer; border: 1px solid transparent; font-size: 12px; }
.snhelp-tab[aria-selected="true"] { background: rgba(117,151,255,0.16); border-color: rgba(117,151,255,0.35); }
.snhelp-views { flex: 1; position: relative; }
.snhelp-view { position: absolute; inset: 0; padding: 10px; overflow: auto; display: none; }
.snhelp-view[aria-hidden="false"] { display: block; }
.snhelp-footer { position: absolute; bottom: 0; left: 56px; right: 0; height: 0; }
.snhelp-collapsed { height: 44px !important; }
`;

function elTab(id, label, title) {
  return createEl('button', { className: 'snhelp-tab', text: label, attrs: { role: 'tab', 'aria-selected': 'false', 'data-target': id, title } });
}

export function createPanel() {
  injectStyles('snhelp-panel', STYLES);

  const root = createEl('div', { className: 'snhelp-panel', attrs: { role: 'dialog', 'aria-label': 'Study N Help Assistant' } });
  Object.assign(root.style, { left: 'auto', right: '20px' });

  const header = createEl('div', { className: 'snhelp-header' });
  const title = createEl('div', { className: 'snhelp-title', text: 'StudyNHelp — Tutor' });
  const spacer = createEl('div', { className: 'snhelp-spacer' });
  const collapseBtn = createEl('button', { className: 'snhelp-btn', text: '▁', attrs: { 'aria-label': 'Collapse' } });
  const closeBtn = createEl('button', { className: 'snhelp-btn', text: '×', attrs: { 'aria-label': 'Close assistant' } });

  header.append(title, spacer, collapseBtn, closeBtn);

  const content = createEl('div', { className: 'snhelp-content' });
  const tabs = createEl('div', { className: 'snhelp-tabs', attrs: { role: 'tablist', 'aria-orientation': 'vertical' } });
  const views = createEl('div', { className: 'snhelp-views' });

  const tabChat = elTab('snhelp-chat', '💬', 'Chat Tutor');
  const tabAnalyze = elTab('snhelp-analyze', '🔍', 'Question Analyzer');
  const tabCalc = elTab('snhelp-calc', '🧮', 'Calculator');
  const tabGraph = elTab('snhelp-graph', '📈', 'Graphing');
  const tabScan = elTab('snhelp-scan', '🗂️', 'Page Scanner');
  const tabDev = elTab('snhelp-dev', '⚙️', 'Developer Diagnostics');

  [tabChat, tabAnalyze, tabCalc, tabGraph, tabScan, tabDev].forEach(t => tabs.appendChild(t));

  const viewChat = createEl('div', { className: 'snhelp-view', attrs: { id: 'snhelp-chat', 'aria-hidden': 'true' } });
  const viewAnalyze = createEl('div', { className: 'snhelp-view', attrs: { id: 'snhelp-analyze', 'aria-hidden': 'true' } });
  const viewCalc = createEl('div', { className: 'snhelp-view', attrs: { id: 'snhelp-calc', 'aria-hidden': 'true' } });
  const viewGraph = createEl('div', { className: 'snhelp-view', attrs: { id: 'snhelp-graph', 'aria-hidden': 'true' } });
  const viewScan = createEl('div', { className: 'snhelp-view', attrs: { id: 'snhelp-scan', 'aria-hidden': 'true' } });
  const viewDev = createEl('div', { className: 'snhelp-view', attrs: { id: 'snhelp-dev', 'aria-hidden': 'true' } });

  views.append(viewChat, viewAnalyze, viewCalc, viewGraph, viewScan, viewDev);
  content.append(tabs, views);

  root.append(header, content);

  // behaviors
  const unsubscribeDrag = makeDraggable(root, header);
  const unsubscribeResize = makeResizable(root);

  function selectTab(id) {
    [tabChat, tabAnalyze, tabCalc, tabGraph, tabScan, tabDev].forEach((t) => t.setAttribute('aria-selected', String(t.dataset.target === id)));
    [viewChat, viewAnalyze, viewCalc, viewGraph, viewScan, viewDev].forEach((v) => v.setAttribute('aria-hidden', String(v.id !== id)));
  }

  [tabChat, tabAnalyze, tabCalc, tabGraph, tabScan, tabDev].forEach((t) => t.addEventListener('click', () => selectTab(t.dataset.target)));
  selectTab('snhelp-chat');

  collapseBtn.addEventListener('click', () => {
    const collapsed = root.classList.toggle('snhelp-collapsed');
    if (collapsed) {
      content.style.display = 'none';
    } else {
      content.style.display = 'flex';
    }
  });
  closeBtn.addEventListener('click', () => root.remove());

  return { root, views: { viewChat, viewAnalyze, viewCalc, viewGraph, viewScan, viewDev } };
}
