import { createEl } from '../core/dom.js';
import { request } from '../core/net.js';

const STYLE = `
.snhelp-calc { display: grid; grid-template-rows: auto 1fr; gap: 10px; height: 100%; }
.snhelp-calc__display { background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.12); border-radius: 8px; padding: 8px; font-family: 'Consolas', 'SF Mono', ui-monospace, monospace; font-size: 14px; }
.snhelp-calc__grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
.snhelp-calc__btn { padding: 10px; border-radius: 8px; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12); cursor: pointer; }
.snhelp-calc__history { height: 120px; overflow: auto; border-radius: 8px; border: 1px solid rgba(255,255,255,.1); background: rgba(5,7,10,.55); font-family: ui-monospace, monospace; font-size: 12px; padding: 6px; }
`;

const BUTTONS = [
  '7','8','9','/','C',
  '4','5','6','*','(',
  '1','2','3','-',' )',
  '0','.','^','+','=',
  'sin','cos','tan','sqrt','Ans',
  'log','ln','abs','pi','e'
];

export function mountCalculator(rootEl) {
  rootEl.appendChild(createEl('style', { text: STYLE }));

  const wrap = createEl('div', { className: 'snhelp-calc' });
  const display = createEl('input', { className: 'snhelp-calc__display', attrs: { placeholder: 'Expression (e.g., 2*(3+4), sin(pi/2))' } });
  const grid = createEl('div', { className: 'snhelp-calc__grid' });
  const history = createEl('div', { className: 'snhelp-calc__history' });

  BUTTONS.forEach((label) => {
    const btn = createEl('button', { className: 'snhelp-calc__btn', text: label.trim() });
    btn.addEventListener('click', () => onBtn(label.trim()));
    grid.appendChild(btn);
  });

  wrap.append(display, grid, history);
  rootEl.appendChild(wrap);

  function onBtn(lbl) {
    if (lbl === 'C') { display.value = ''; return; }
    if (lbl === '=') { evaluate(); return; }
    if (lbl === 'ln') { insert('ln('); return; }
    if (['sin','cos','tan','sqrt','abs','log'].includes(lbl)) { insert(lbl + '('); return; }
    insert(lbl);
  }

  function insert(text) {
    const start = display.selectionStart ?? display.value.length;
    const end = display.selectionEnd ?? display.value.length;
    display.setRangeText(text, start, end, 'end');
    display.focus();
  }

  async function evaluate() {
    const expr = display.value.trim();
    if (!expr) return;
    const entry = document.createElement('div');
    entry.textContent = '› ' + expr;
    history.appendChild(entry);
    try {
      const data = await request('/math_help', { method: 'POST', body: { expression: expr, options: { show_steps: true } } });
      const res = document.createElement('div');
      res.textContent = '= ' + String(data.result);
      history.appendChild(res);
      if (Array.isArray(data.steps) && data.steps.length) {
        const stepsDiv = document.createElement('div');
        stepsDiv.textContent = (data.steps || []).join(' | ');
        stepsDiv.style.opacity = '.8'; stepsDiv.style.fontSize = '11px';
        history.appendChild(stepsDiv);
      }
      history.scrollTop = history.scrollHeight;
    } catch (e) {
      const err = document.createElement('div');
      err.textContent = 'Error: ' + (e && e.message || 'Network error');
      err.style.color = '#ff8080';
      history.appendChild(err);
    }
  }
}
