import { createEl } from '../core/dom.js';
import { request } from '../core/net.js';
import { addHistoryEntry } from '../core/state.js';

const STYLE = `
.snhelp-chat { display: flex; flex-direction: column; height: 100%; }
.snhelp-chat__banner { padding: 6px 10px; background: rgba(94,148,255,0.12); border-bottom: 1px solid rgba(94,148,255,0.25); font-size: 11px; color: rgba(200,215,255,0.9); display: flex; align-items: center; gap: 6px; }
.snhelp-chat__banner-q { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: 0.85; }
.snhelp-chat__banner-btn { background: rgba(94,148,255,0.25); border: 1px solid rgba(94,148,255,0.4); color: inherit; border-radius: 6px; padding: 2px 8px; cursor: pointer; font-size: 11px; flex-shrink: 0; }
.snhelp-chat__messages { flex: 1; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 8px; }
.snhelp-chat__msg { padding: 8px 12px; border-radius: 10px; max-width: 92%; line-height: 1.5; font-size: 13px; white-space: pre-wrap; word-break: break-word; }
.snhelp-chat__msg--user { align-self: flex-end; background: rgba(94,148,255,0.2); border: 1px solid rgba(94,148,255,0.35); }
.snhelp-chat__msg--ai { align-self: flex-start; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.12); }
.snhelp-chat__msg--system { align-self: center; background: rgba(255,200,80,0.1); border: 1px solid rgba(255,200,80,0.25); color: rgba(255,220,120,0.9); font-size: 11px; text-align: center; max-width: 100%; }
.snhelp-chat__msg--thinking { opacity: 0.6; font-style: italic; }
.snhelp-chat__steps { margin-top: 6px; padding: 6px 10px; background: rgba(255,255,255,0.04); border-radius: 8px; border: 1px solid rgba(255,255,255,0.08); }
.snhelp-chat__steps li { margin: 3px 0; font-size: 12px; line-height: 1.4; }
.snhelp-chat__input { display: flex; gap: 8px; padding: 8px; border-top: 1px solid rgba(255,255,255,0.08); }
.snhelp-chat__textarea { flex: 1; min-height: 40px; max-height: 100px; resize: none; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12); background: rgba(12,15,19,0.7); color: inherit; padding: 8px; font-size: 13px; font-family: inherit; }
.snhelp-chat__textarea:focus { outline: none; border-color: rgba(94,148,255,0.5); }
.snhelp-chat__btn { padding: 8px 14px; border-radius: 10px; border: 1px solid rgba(94,148,255,0.4); background: rgba(94,148,255,0.18); color: inherit; cursor: pointer; font-size: 13px; }
.snhelp-chat__btn:hover { background: rgba(94,148,255,0.3); }
.snhelp-chat__toolbar { display: flex; gap: 5px; padding: 5px 8px; border-top: 1px solid rgba(255,255,255,0.08); flex-wrap: wrap; }
.snhelp-chat__toolbtn { font-size: 11px; padding: 5px 9px; border-radius: 8px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); cursor: pointer; color: inherit; white-space: nowrap; }
.snhelp-chat__toolbtn:hover { background: rgba(255,255,255,0.14); }
.snhelp-chat__status { font-size: 11px; padding: 3px 8px; opacity: 0.6; width: 100%; }
`;

// ── Junk patterns to ignore ───────────────────────────────────────────────────
const JUNK_RE = /(cookie|privacy policy|terms of (use|service)|accept|consent|advertisement|©|copyright|all rights reserved|sign in|log in|subscribe|newsletter|close this|skip to|navigation|search bar|loading|please wait|javascript|browser)/i;

// ── Strong academic signals ───────────────────────────────────────────────────
const ACADEMIC_RE = /(probability|solve|find|calculate|compute|determine|evaluate|simplify|derivative|integral|equation|hypothesis|null hypothesis|p-value|confidence interval|standard deviation|mean|median|variance|correlation|regression|matrix|vector|theorem|proof|given that|what is the|how many|how much|what are|which of the following|select all|true or false|random sample|contingency|distribution|sample size|test statistic|z-score|t-score|chi-square|anova|binomial|normal distribution|percent|proportion|ratio|factor|expand|graph|sketch|describe|explain why|compare|contrast)/i;

// ── Question extraction ───────────────────────────────────────────────────────
function extractPageQuestion() {
  const candidates = [];

  function scoreEl(el) {
    if (!el || el.closest('#snhelp-root')) return null;
    const txt = (el.innerText || '').trim().replace(/\s+/g, ' ');
    if (txt.length < 25 || txt.length > 2000) return null;
    if (JUNK_RE.test(txt)) return null;

    let score = 0;

    // Strong signals
    if (ACADEMIC_RE.test(txt)) score += 6;
    if (/\?/.test(txt)) score += 4;
    if (/\(a\)|\(b\)|\(c\)|\d+\./.test(txt)) score += 3; // numbered parts
    if (/\d/.test(txt)) score += 2; // contains numbers
    if (el.querySelector('math, .math, .katex, .MathJax, [class*="math"]')) score += 4;
    if (/[=+\-*/^÷×∫∑√]/.test(txt)) score += 3;

    // Element type bonuses
    if (el.matches('[class*="question"],[class*="problem"],[class*="prompt"],[id*="question"],[id*="problem"]')) score += 8;
    if (el.matches('[class*="hw"],[class*="assignment"],[class*="exercise"],[class*="quiz"]')) score += 6;
    if (el.matches('h1,h2,h3,h4')) score += 1;

    // Penalties
    if (el.matches('nav, header, footer, aside')) score -= 10;
    if (el.matches('button, a, input, select')) score -= 8;
    if (txt.length < 60) score -= 2;
    if (/^(home|menu|close|next|back|submit|cancel)/i.test(txt)) score -= 10;

    // Deprioritize if deep nesting with little unique text
    const childText = Array.from(el.children).map(c => (c.innerText || '').trim()).join(' ');
    if (childText.length > txt.length * 0.9 && el.children.length > 3) score -= 3;

    return score > 3 ? { txt, score, el } : null;
  }

  // Check specific high-value selectors first
  const prioritySelectors = [
    '[class*="question"]', '[class*="problem"]', '[class*="prompt"]',
    '[id*="question"]', '[id*="problem"]',
    '[class*="hw-"]', '[class*="exercise"]',
    'h1', 'h2', 'h3', 'h4',
    'p', 'li', 'td', 'label', 'div'
  ];

  const seen = new Set();
  for (const sel of prioritySelectors) {
    try {
      document.querySelectorAll(sel).forEach(el => {
        if (seen.has(el)) return;
        seen.add(el);
        const result = scoreEl(el);
        if (result) candidates.push(result);
      });
    } catch (_) {}
  }

  candidates.sort((a, b) => b.score - a.score);

  // Return top candidate text, but strip down to the most relevant portion
  const best = candidates[0];
  if (!best) return null;

  // If very long, try to find the actual question sentence
  let txt = best.txt;
  if (txt.length > 400) {
    // Look for the sentence with a question mark or strong academic keyword
    const sentences = txt.split(/(?<=[.?!])\s+/);
    const qSentences = sentences.filter(s => /\?/.test(s) || ACADEMIC_RE.test(s));
    if (qSentences.length) txt = qSentences.slice(0, 3).join(' ');
  }

  return txt.slice(0, 600);
}

// ── Mount ─────────────────────────────────────────────────────────────────────
export function mountChat(rootEl) {
  const styleEl = document.createElement('style');
  styleEl.textContent = STYLE;
  rootEl.appendChild(styleEl);

  const banner = createEl('div', { className: 'snhelp-chat__banner' });
  const bannerQ = createEl('span', { className: 'snhelp-chat__banner-q', text: 'Scanning for question…' });
  const bannerBtn = createEl('button', { className: 'snhelp-chat__banner-btn', text: 'Rescan' });
  banner.append('📌 ', bannerQ, bannerBtn);

  const wrap = createEl('div', { className: 'snhelp-chat' });
  const messagesEl = createEl('div', { className: 'snhelp-chat__messages', attrs: { 'aria-live': 'polite' } });

  const inputWrap = createEl('div', { className: 'snhelp-chat__input' });
  const textarea = createEl('textarea', { className: 'snhelp-chat__textarea', attrs: { placeholder: 'Ask a follow-up or type your answer…' } });
  const sendBtn = createEl('button', { className: 'snhelp-chat__btn', text: '➤' });
  inputWrap.append(textarea, sendBtn);

  const toolbar = createEl('div', { className: 'snhelp-chat__toolbar' });
  const btnHint    = createEl('button', { className: 'snhelp-chat__toolbtn', text: '💡 Hint' });
  const btnStep    = createEl('button', { className: 'snhelp-chat__toolbtn', text: '👣 Next Step' });
  const btnExplain = createEl('button', { className: 'snhelp-chat__toolbtn', text: '🔍 Explain' });
  const btnReveal  = createEl('button', { className: 'snhelp-chat__toolbtn', text: '✅ Reveal Answer' });
  const btnNew     = createEl('button', { className: 'snhelp-chat__toolbtn', text: '🔄 New Question' });
  const statusEl   = createEl('div',   { className: 'snhelp-chat__status' });
  toolbar.append(btnHint, btnStep, btnExplain, btnReveal, btnNew, statusEl);

  wrap.append(messagesEl, inputWrap, toolbar);
  rootEl.append(banner, wrap);

  let convo = [];
  let currentQuestion = null;
  let busy = false;

  function addMessage(role, text, steps) {
    const msg = createEl('div', { className: 'snhelp-chat__msg snhelp-chat__msg--' + role, text });
    messagesEl.appendChild(msg);
    if (steps && steps.length) {
      const ol = document.createElement('ol');
      steps.forEach(s => { const li = document.createElement('li'); li.textContent = s; ol.appendChild(li); });
      const stepsEl = createEl('div', { className: 'snhelp-chat__steps' });
      stepsEl.appendChild(ol);
      messagesEl.appendChild(stepsEl);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return msg;
  }

  function setStatus(txt) { statusEl.textContent = txt; }
  function setBusy(val) {
    busy = val;
    sendBtn.disabled = val;
    textarea.disabled = val;
    [btnHint, btnStep, btnExplain, btnReveal].forEach(b => b.disabled = val);
  }

  async function send(userText, systemOverride) {
    if (busy) return;
    setBusy(true);

    if (userText) {
      addMessage('user', userText);
      convo.push({ role: 'user', text: userText });
    }

    const thinkingEl = addMessage('ai thinking', '…');
    setStatus('Thinking…');

    try {
      let messageToSend = userText || systemOverride || '';
      if (currentQuestion && convo.length <= 2) {
        messageToSend = `The question on this page is:\n"${currentQuestion}"\n\n${messageToSend}`;
      }

      const data = await request('/chat', {
        method: 'POST',
        body: {
          message: messageToSend,
          context: { conversation: convo.slice(-20) },
          metadata: { page_url: location.href, detected_question_id: null }
        }
      });

      const answer = data.response || 'Sorry, no response.';
      const steps = Array.isArray(data.steps) && data.steps.length ? data.steps : null;

      thinkingEl.textContent = answer;
      thinkingEl.classList.remove('snhelp-chat__msg--thinking');

      if (steps) {
        const ol = document.createElement('ol');
        steps.forEach(s => { const li = document.createElement('li'); li.textContent = s; ol.appendChild(li); });
        const stepsEl = createEl('div', { className: 'snhelp-chat__steps' });
        stepsEl.appendChild(ol);
        messagesEl.appendChild(stepsEl);
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }

      convo.push({ role: 'assistant', text: answer });
      addHistoryEntry({ type: 'chat', model: data.model_used, search: data.search_invoked, url: location.href });
      setStatus(`Model: ${data.model_used}`);
    } catch (e) {
      thinkingEl.textContent = '⚠️ ' + (e?.message || 'Network error');
      setStatus('Error');
    } finally {
      setBusy(false);
    }
  }

  function scanAndStart() {
    convo = [];
    messagesEl.innerHTML = '';
    currentQuestion = extractPageQuestion();

    if (currentQuestion) {
      bannerQ.textContent = currentQuestion.slice(0, 100) + (currentQuestion.length > 100 ? '…' : '');
      addMessage('system', '📌 Question detected — starting guided walkthrough…');
      send(null,
        `The student is working on this question:\n"${currentQuestion}"\n\nPlease: 1) Briefly confirm you see the question, 2) Identify what concept/topic it covers, 3) Give ONE helpful starting hint without revealing the answer. Be specific to this exact question.`
      );
    } else {
      bannerQ.textContent = 'No question auto-detected';
      addMessage('ai', '👋 Hi! I\'m your AI tutor. I couldn\'t auto-detect a question — paste it below and I\'ll guide you through it step by step!');
      setStatus('Ready');
    }
  }

  sendBtn.addEventListener('click', () => {
    const txt = textarea.value.trim();
    if (!txt) return;
    textarea.value = '';
    send(txt);
  });

  textarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn.click(); }
  });

  btnHint.addEventListener('click', () => send(null, 'Give me another hint for this problem. Do not reveal the final answer yet.'));
  btnStep.addEventListener('click', () => send(null, 'Walk me through the next step in solving this problem.'));
  btnExplain.addEventListener('click', () => send(null, 'Explain the concept behind the last step in more detail.'));
  btnReveal.addEventListener('click', () => send(null, 'Please reveal the full solution and final answer now, showing all steps clearly.'));
  btnNew.addEventListener('click', () => scanAndStart());
  bannerBtn.addEventListener('click', () => scanAndStart());

  setTimeout(scanAndStart, 500);
}
