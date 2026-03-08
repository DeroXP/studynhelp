// Lightweight DOM helpers, drag/resize utilities, and style injection

const styleRegistry = new Map();

function sanitizeCss(cssText) {
  return String(cssText || '').replace(/<\/?style/gi, '');
}

export function injectStyles(key, cssText) {
  if (typeof document === 'undefined' || !cssText) return;
  if (styleRegistry.has(key)) return;
  const styleEl = document.createElement('style');
  styleEl.type = 'text/css';
  styleEl.dataset.snhelpStyle = key;
  styleEl.textContent = sanitizeCss(cssText);
  document.head.appendChild(styleEl);
  styleRegistry.set(key, styleEl);
}

export function createEl(tag, opts = {}) {
  const el = document.createElement(tag);
  const { className, classes, attrs, text, html, children, style, dataset } = opts;
  if (className) el.className = className;
  if (Array.isArray(classes)) el.classList.add(...classes.filter(Boolean));
  if (attrs) Object.entries(attrs).forEach(([k, v]) => v != null && el.setAttribute(k, String(v)));
  if (dataset) Object.entries(dataset).forEach(([k, v]) => v != null && (el.dataset[k] = String(v)));
  if (style) Object.assign(el.style, style);
  if (text != null) el.textContent = String(text);
  if (html != null) el.innerHTML = String(html);
  if (children) children.forEach(c => c && el.appendChild(c));
  return el;
}

export function makeDraggable(el, handle) {
  let startX = 0, startY = 0, origX = 0, origY = 0, dragging = false;
  const h = handle || el;
  const onDown = (e) => {
    if (e.button !== 0) return;
    dragging = true;
    const rect = el.getBoundingClientRect();
    origX = rect.left + window.scrollX;
    origY = rect.top + window.scrollY;
    startX = e.clientX;
    startY = e.clientY;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  };
  const onMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const x = Math.max(0, origX + dx);
    const y = Math.max(0, origY + dy);
    Object.assign(el.style, { left: x + 'px', top: y + 'px' });
  };
  const onUp = () => {
    dragging = false;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  h.addEventListener('mousedown', onDown);
  return () => h.removeEventListener('mousedown', onDown);
}

export function makeResizable(el, opts = {}) {
  const grip = createEl('div', { className: 'snhelp-resize-grip', attrs: { 'aria-label': 'Resize panel', role: 'separator' } });
  Object.assign(grip.style, {
    position: 'absolute', right: '2px', bottom: '2px', width: '12px', height: '12px',
    cursor: 'nwse-resize', background: 'linear-gradient(135deg, rgba(255,255,255,.35), rgba(255,255,255,.05))',
    borderRadius: '3px', opacity: '.6'
  });
  el.appendChild(grip);
  let startX = 0, startY = 0, startW = 0, startH = 0, resizing = false;
  const minW = opts.minWidth || 320;
  const minH = opts.minHeight || 260;
  grip.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    resizing = true;
    const rect = el.getBoundingClientRect();
    startW = rect.width; startH = rect.height;
    startX = e.clientX; startY = e.clientY;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
  function onMove(e) {
    if (!resizing) return;
    const dw = e.clientX - startX;
    const dh = e.clientY - startY;
    const w = Math.max(minW, startW + dw);
    const h = Math.max(minH, startH + dh);
    Object.assign(el.style, { width: w + 'px', height: h + 'px' });
  }
  function onUp() {
    resizing = false;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }
  return () => grip.remove();
}

export function rafThrottle(fn) {
  let scheduled = false;
  let lastArgs = null;
  return function throttled(...args) {
    lastArgs = args;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      fn.apply(null, lastArgs);
    });
  };
}
