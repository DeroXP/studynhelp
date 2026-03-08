import { createEl } from '../core/dom.js';

const STYLE = `
.snhelp-graph { position: relative; height: 100%; display: grid; grid-template-rows: auto 1fr; gap: 8px; }
.snhelp-graph__controls { display: flex; gap: 8px; flex-wrap: wrap; }
.snhelp-graph__input { flex: 1; min-width: 140px; background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.12); border-radius: 8px; color: inherit; padding: 6px 8px; }
.snhelp-graph__canvas { width: 100%; height: 100%; background: rgba(5,7,10,.55); border: 1px solid rgba(255,255,255,.1); border-radius: 10px; }
`;

function parseFunctions(text) {
  return text.split(/\n|;/).map(s => s.trim()).filter(Boolean);
}

export function mountGraph(rootEl) {
  rootEl.appendChild(createEl('style', { text: STYLE }));

  const wrap = createEl('div', { className: 'snhelp-graph' });
  const controls = createEl('div', { className: 'snhelp-graph__controls' });
  const input = createEl('textarea', { className: 'snhelp-graph__input', attrs: { rows: 2, placeholder: 'Enter functions, e.g., y=x^2; y=sin(x)' } });
  const btnPlot = createEl('button', { className: 'snhelp-calc__btn', text: 'Plot' });
  const canvas = createEl('canvas', { className: 'snhelp-graph__canvas' });

  controls.append(input, btnPlot);
  wrap.append(controls, canvas);
  rootEl.appendChild(wrap);

  const ctx = canvas.getContext('2d');
  let deviceRatio = window.devicePixelRatio || 1;
  let view = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(100, Math.floor(rect.width * deviceRatio));
    canvas.height = Math.max(100, Math.floor(rect.height * deviceRatio));
    draw();
  }

  function worldToScreen(x, y) {
    const w = canvas.width, h = canvas.height;
    const sx = (x - view.xMin) / (view.xMax - view.xMin) * w;
    const sy = h - (y - view.yMin) / (view.yMax - view.yMin) * h;
    return [sx, sy];
  }

  function screenToWorld(sx, sy) {
    const w = canvas.width, h = canvas.height;
    const x = view.xMin + (sx / w) * (view.xMax - view.xMin);
    const y = view.yMin + ((h - sy) / h) * (view.yMax - view.yMin);
    return [x, y];
  }

  function drawGrid() {
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.scale(deviceRatio, deviceRatio); // visually consistent lines
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    for (let x = Math.ceil(view.xMin); x <= view.xMax; x++) {
      const [sx] = worldToScreen(x, 0);
      ctx.beginPath(); ctx.moveTo(sx / deviceRatio, 0); ctx.lineTo(sx / deviceRatio, h / deviceRatio); ctx.stroke();
    }
    for (let y = Math.ceil(view.yMin); y <= view.yMax; y++) {
      const [, sy] = worldToScreen(0, y);
      ctx.beginPath(); ctx.moveTo(0, sy / deviceRatio); ctx.lineTo(w / deviceRatio, sy / deviceRatio); ctx.stroke();
    }
    // axes
    ctx.globalAlpha = 0.8; ctx.strokeStyle = 'rgba(160,190,255,0.7)';
    const [sx0] = worldToScreen(0, 0);
    const [, sy0] = worldToScreen(0, 0);
    ctx.beginPath(); ctx.moveTo(sx0 / deviceRatio, 0); ctx.lineTo(sx0 / deviceRatio, h / deviceRatio); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, sy0 / deviceRatio); ctx.lineTo(w / deviceRatio, sy0 / deviceRatio); ctx.stroke();
    ctx.restore();
  }

  function parseExpr(expr) {
    // basic safe math with Math.* and power ^ -> **
    const js = expr.replace(/\^/g, '**').replace(/(\b)ln\(/g, '$1Math.log(').replace(/(\b)sin\(/g, '$1Math.sin(')
      .replace(/(\b)cos\(/g, '$1Math.cos(').replace(/(\b)tan\(/g, '$1Math.tan(').replace(/(\b)log\(/g, '$1Math.log(')
      .replace(/(\b)sqrt\(/g, '$1Math.sqrt(').replace(/\bpi\b/gi, 'Math.PI');
    // eslint-disable-next-line no-new-func
    return new Function('x', `with (Math) { return ${js}; }`);
  }

  function drawFunctions() {
    const lines = parseFunctions(input.value);
    const colors = ['#8ab4ff', '#ffb86c', '#9ae6b4', '#f78fb3', '#ffd3a1'];
    lines.forEach((line, idx) => {
      const eq = line.split('=');
      const expr = (eq.length === 2) ? eq[1] : line;
      let fn;
      try { fn = parseExpr(expr); } catch { return; }
      ctx.save();
      ctx.strokeStyle = colors[idx % colors.length];
      ctx.beginPath();
      let first = true;
      for (let i = 0; i <= canvas.width; i += 2) {
        const [x] = screenToWorld(i, 0);
        let y;
        try { y = fn(x); } catch { continue; }
        if (!isFinite(y)) { first = true; continue; }
        const [sx, sy] = worldToScreen(x, y);
        if (first) { ctx.moveTo(sx / deviceRatio, sy / deviceRatio); first = false; }
        else { ctx.lineTo(sx / deviceRatio, sy / deviceRatio); }
      }
      ctx.stroke();
      ctx.restore();
    });
  }

  function draw() { drawGrid(); drawFunctions(); }

  let panning = false; let lastX = 0; let lastY = 0;
  canvas.addEventListener('mousedown', (e) => { panning = true; lastX = e.clientX; lastY = e.clientY; });
  window.addEventListener('mouseup', () => { panning = false; });
  window.addEventListener('mousemove', (e) => {
    if (!panning) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    const [wx0, wy0] = screenToWorld(0, 0);
    const [wx1, wy1] = screenToWorld(dx, dy);
    const shiftX = wx0 - wx1; const shiftY = wy0 - wy1;
    view.xMin += shiftX; view.xMax += shiftX; view.yMin += shiftY; view.yMax += shiftY;
    draw();
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.1 : 0.9;
    const cx = (view.xMin + view.xMax) / 2;
    const cy = (view.yMin + view.yMax) / 2;
    const w = (view.xMax - view.xMin) * factor;
    const h = (view.yMax - view.yMin) * factor;
    view.xMin = cx - w / 2; view.xMax = cx + w / 2; view.yMin = cy - h / 2; view.yMax = cy + h / 2;
    draw();
  }, { passive: false });

  window.addEventListener('resize', resize);
  resize();

  btnPlot.addEventListener('click', draw);
}
