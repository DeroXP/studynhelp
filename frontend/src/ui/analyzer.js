import { createEl } from '../core/dom.js';
import { request } from '../core/net.js';

const STYLE = `
.snhelp-ana { display: flex; flex-direction: column; gap: 10px; height: 100%; }
.snhelp-ana__input { width: 100%; min-height: 90px; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12); background: rgba(12,15,19,0.7); color: inherit; resize: vertical; }
.snhelp-ana__row { display: flex; gap: 8px; flex-wrap: wrap; }
.snhelp-ana__btn { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.18); color: inherit; border-radius: 9px; padding: 6px 12px; cursor: pointer; font-size: 12px; }
.snhelp-ana__status { font-size: 12px; opacity: .8; min-height: 18px; }
.snhelp-ana__results { flex: 1; overflow-y: auto; padding: 8px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.1); background: rgba(5,7,10,0.55); }
.snhelp-ana__item { margin-bottom: 8px; }
.snhelp-ana__item b { color: #9fb4ff; }
`;

export function mountAnalyzer(rootEl) {
  rootEl.appendChild(createEl('style', { text: STYLE }));

  const wrap = createEl('div', { className: 'snhelp-ana' });
  const input = createEl('textarea', { className: 'snhelp-ana__input', attrs: { placeholder: 'Highlight question text on the page and click Capture, or paste here...' } });
  const row = createEl('div', { className: 'snhelp-ana__row' });
  const btnCapture = createEl('button', { className: 'snhelp-ana__btn', text: 'Capture Selection' });
  const btnAnalyze = createEl('button', { className: 'snhelp-ana__btn', text: 'Analyze Question' });
  const status = createEl('div', { className: 'snhelp-ana__status' });
  const results = createEl('div', { className: 'snhelp-ana__results' });
  row.append(btnCapture, btnAnalyze);
  wrap.append(input, row, status, results);
  rootEl.appendChild(wrap);

  btnCapture.addEventListener('click', () => {
    const sel = window.getSelection && window.getSelection();
    const text = sel ? String(sel).trim() : '';
    if (text) {
      input.value = text;
      status.textContent = 'Captured highlighted text.';
    } else {
      status.textContent = 'No selection found. Paste the question manually.';
    }
  });

  btnAnalyze.addEventListener('click', async () => {
    const q = input.value.trim();
    if (!q) { status.textContent = 'Please provide question text.'; return; }
    status.textContent = 'Analyzing...';
    results.textContent = '';
    try {
      const data = await request('/analyze', { method: 'POST', body: { question: q, context: {} } });
      const frag = document.createDocumentFragment();
      const add = (label, value) => {
        const row = createEl('div', { className: 'snhelp-ana__item' });
        row.append(createEl('b', { text: label + ': ' }));
        if (Array.isArray(value)) {
          row.append(createEl('span', { text: value.join(', ') }));
        } else {
          row.append(createEl('span', { text: String(value) }));
        }
        frag.appendChild(row);
      };
      add('Problem type', data.problem_type || '');
      add('Concepts', data.concepts || []);
      add('Suggested strategy', data.suggested_strategy || '');
      add('Steps', (data.steps || []).map((s, i) => `${i + 1}. ${s}`));
      add('Hints', data.hints || []);
      add('Confidence', String(data.confidence ?? ''));
      results.appendChild(frag);
      status.textContent = 'Done.';
    } catch (e) {
      status.textContent = 'Error: ' + (e && e.message || 'Network error');
    }
  });
}
