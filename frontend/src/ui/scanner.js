import { createEl } from '../core/dom.js';

const STYLE = `
.snhelp-scan { display: grid; grid-template-rows: auto 1fr; gap: 8px; height: 100%; }
.snhelp-scan__controls { display: flex; gap: 8px; flex-wrap: wrap; }
.snhelp-scan__btn { background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.18); color: inherit; border-radius: 9px; padding: 6px 12px; cursor: pointer; font-size: 12px; }
.snhelp-scan__list { overflow: auto; border: 1px solid rgba(255,255,255,.1); background: rgba(5,7,10,.55); border-radius: 10px; padding: 8px; }
.snhelp-scan__item { padding: 6px; border-radius: 8px; border: 1px solid rgba(255,255,255,.1); margin-bottom: 6px; cursor: pointer; }
.snhelp-scan__item:hover { border-color: rgba(117,151,255,0.35); }
.snhelp-scan__highlight { position: absolute; pointer-events: none; border: 2px solid rgba(117,151,255,.75); background: rgba(117,151,255,.15); border-radius: 6px; z-index: 2147483646; }
`;

function normalizeText(t) {
  return (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function computeConfidence(text, el) {
  const t = normalizeText(text);
  let score = 0;
  if (/^\d+[).]/.test(t)) score += 0.2;
  if (/[?]$/.test(t)) score += 0.2;
  if (t.length > 40) score += 0.2;
  if (/(solve|compute|find|prove|show|graph|equation|integral|derivative)/.test(t)) score += 0.2;
  if (el && (el.querySelector('math, .math, .katex, .MathJax') || /[=+\-*/^]/.test(t))) score += 0.2;
  return Math.min(1, score);
}

export function mountScanner(rootEl) {
  rootEl.appendChild(createEl('style', { text: STYLE }));

  const wrap = createEl('div', { className: 'snhelp-scan' });
  const controls = createEl('div', { className: 'snhelp-scan__controls' });
  const btnScan = createEl('button', { className: 'snhelp-scan__btn', text: 'Scan Page' });
  const btnClear = createEl('button', { className: 'snhelp-scan__btn', text: 'Clear Highlights' });
  const list = createEl('div', { className: 'snhelp-scan__list' });
  controls.append(btnScan, btnClear);
  wrap.append(controls, list);
  rootEl.appendChild(wrap);

  const overlays = [];

  function highlight(el) {
    const rect = el.getBoundingClientRect();
    const overlay = createEl('div', { className: 'snhelp-scan__highlight' });
    Object.assign(overlay.style, { left: rect.left + window.scrollX + 'px', top: rect.top + window.scrollY + 'px', width: rect.width + 'px', height: rect.height + 'px' });
    document.body.appendChild(overlay);
    overlays.push(overlay);
  }

  function clearHighlights() {
    overlays.splice(0).forEach((o) => o.remove());
  }

  function detect() {
    clearHighlights();
    list.textContent = '';
    const candidates = [];
    try {
      const blocks = Array.from(document.querySelectorAll('article, section, main, div, li, p'));
      blocks.forEach((el) => {
        if (!el) return;
        const txt = (el.innerText || '').trim();
        if (!txt) return;
        const short = txt.split(/\n/).slice(0, 4).join(' ').slice(0, 280);
        const conf = computeConfidence(short, el);
        if (conf >= 0.4) candidates.push({ el, text: short, confidence: conf });
      });
    } catch (e) { /* ignore */ }

    candidates.sort((a, b) => b.confidence - a.confidence);
    candidates.slice(0, 30).forEach((c, idx) => {
      const item = createEl('div', { className: 'snhelp-scan__item' });
      item.textContent = `#${idx + 1} — (${Math.round(c.confidence * 100)}%)  ${c.text}`;
      item.addEventListener('mouseenter', () => highlight(c.el));
      item.addEventListener('mouseleave', clearHighlights);
      item.addEventListener('click', () => {
        clearHighlights();
        highlight(c.el);
        c.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      list.appendChild(item);
    });
  }

  btnScan.addEventListener('click', detect);
  btnClear.addEventListener('click', clearHighlights);
}
