import { createEl } from '../core/dom.js';
import { request } from '../core/net.js';
import { getState, addHistoryEntry } from '../core/state.js';

const STYLE = `
.snhelp-chat { display: flex; flex-direction: column; height: 100%; }
.snhelp-chat__messages { flex: 1; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 8px; }
.snhelp-chat__msg { padding: 8px 10px; border-radius: 10px; max-width: 90%; line-height: 1.4; font-size: 13px; }
.snhelp-chat__msg--user { align-self: flex-end; background: rgba(94,148,255,0.2); border: 1px solid rgba(94,148,255,0.35); }
.snhelp-chat__msg--ai { align-self: flex-start; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.12); }
.snhelp-chat__input { display: flex; gap: 8px; padding: 8px; border-top: 1px solid rgba(255,255,255,0.08); }
.snhelp-chat__textarea { flex: 1; min-height: 46px; max-height: 120px; resize: vertical; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12); background: rgba(12,15,19,0.7); color: inherit; padding: 8px; }
.snhelp-chat__btn { padding: 8px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.08); color: inherit; cursor: pointer; }
.snhelp-chat__toolbar { display: flex; gap: 6px; padding: 6px 8px; border-top: 1px solid rgba(255,255,255,0.08); }
.snhelp-chat__toolbtn { font-size: 12px; padding: 6px 10px; border-radius: 8px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12); cursor: pointer; }
.snhelp-chat__status { font-size: 12px; padding: 4px 8px; opacity: .75; }
`;

export function mountChat(rootEl) {
  const styleEl = document.createElement('style');
  styleEl.textContent = STYLE;
  rootEl.appendChild(styleEl);

  const wrap = createEl('div', { className: 'snhelp-chat' });
  const messagesEl = createEl('div', { className: 'snhelp-chat__messages', attrs: { 'aria-live': 'polite' } });
  const inputWrap = createEl('div', { className: 'snhelp-chat__input' });
  const textarea = createEl('textarea', { className: 'snhelp-chat__textarea', attrs: { placeholder: 'Ask a question... (Shift+Enter for newline)' } });
  const sendBtn = createEl('button', { className: 'snhelp-chat__btn', text: 'Send' });
  inputWrap.append(textarea, sendBtn);

  const toolbar = createEl('div', { className: 'snhelp-chat__toolbar' });
  const btnNext = createEl('button', { className: 'snhelp-chat__toolbtn', text: 'Next Step' });
  const btnExplain = createEl('button', { className: 'snhelp-chat__toolbtn', text: 'Explain More' });
  const btnHints = createEl('button', { className: 'snhelp-chat__toolbtn', text: 'Show Hints' });
  const btnReveal = createEl('button', { className: 'snhelp-chat__toolbtn', text: 'Reveal Answer' });
  const statusEl = createEl('div', { className: 'snhelp-chat__status' });
  toolbar.append(btnNext, btnExplain, btnHints, btnReveal, statusEl);

  wrap.append(messagesEl, inputWrap, toolbar);
  rootEl.appendChild(wrap);

  const convo = [];

  function addMessage(role, text) {
    const msg = createEl('div', { className: 'snhelp-chat__msg ' + (role === 'user' ? 'snhelp-chat__msg--user' : 'snhelp-chat__msg--ai'), text });
    messagesEl.appendChild(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function send(kind) {
    const text = textarea.value.trim();
    if (!text && kind === 'user') return;
    if (kind === 'user') {
      addMessage('user', text);
      convo.push({ role: 'user', text });
      textarea.value = '';
    }
    statusEl.textContent = 'Thinking...';
    try {
      const body = {
        message: kind === 'reveal' ? (text || 'Please reveal the final answer now.') : (text || ''),
        context: { conversation: convo.slice(-20) },
        metadata: { page_url: location.href, detected_question_id: null },
      };
      const data = await request('/chat', { method: 'POST', body });
      const answer = data.response || 'No response';
      addMessage('ai', answer);
      const steps = Array.isArray(data.steps) ? data.steps : [];
      if (steps.length) {
        addMessage('ai', 'Steps:\n- ' + steps.join('\n- '));
      }
      addHistoryEntry({ type: 'chat', model: data.model_used, search: data.search_invoked, url: location.href });
      convo.push({ role: 'assistant', text: answer });
      statusEl.textContent = `Model: ${data.model_used}${data.search_invoked ? ' (search)' : ''}`;
    } catch (e) {
      statusEl.textContent = 'Error: ' + (e && e.message || 'Network error');
    }
  }

  sendBtn.addEventListener('click', () => send('user'));
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send('user');
    }
  });

  btnNext.addEventListener('click', () => {
    textarea.value = (textarea.value + '\nNext step please.').trim();
    send('tool');
  });
  btnExplain.addEventListener('click', () => {
    textarea.value = (textarea.value + '\nExplain more detail on the previous step.').trim();
    send('tool');
  });
  btnHints.addEventListener('click', () => {
    textarea.value = (textarea.value + '\nShow hints only, do not reveal final answer.').trim();
    send('tool');
  });
  btnReveal.addEventListener('click', () => {
    textarea.value = (textarea.value + '\nReveal the final answer now.').trim();
    send('reveal');
  });

  addMessage('ai', 'Hi! I’m your study buddy. Paste a question or highlight text and switch to the Analyzer.');
}
