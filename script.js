/* =====================================================================
   BRAIN DO — Spatial Newsletter Studio
   A Figma-style auto-layout design engine (vanilla JS, DOM-rendered).

   Auto Layout == CSS Flexbox. Sizing modes (Fixed / Hug / Fill) map to
   flex behaviours. The scene is an infinite pan/zoom canvas.
   ===================================================================== */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* =====================================================================
   STATE & MODEL
   ===================================================================== */
let _uid = 0;
const newId = () => `n${Date.now().toString(36)}${(_uid++).toString(36)}`;

// The scene holds root frames positioned freely on the infinite canvas.
let scene = { id: 'scene', type: 'scene', children: [] };

let selection = new Set();          // selected node ids
let collapsed = new Set();          // collapsed layer-tree ids
let view = { x: 120, y: 80, zoom: 1 };
let activeTool = 'move';            // move | frame | text | rect | image | button
let hoverId = null;

const els = {
  viewport: $('#viewport'),
  scene: $('#scene'),
  handles: $('#handles'),
  layers: $('#layers'),
  inspector: $('#inspector'),
  hint: $('#hint'),
};

/* ---- Node factory --------------------------------------------------- */
function makeNode(type, over = {}) {
  const base = {
    id: newId(), type, name: '',
    x: 0, y: 0, w: 120, h: 60,
    widthMode: 'fixed', heightMode: 'fixed',
    fill: '#222222', radius: 0, opacity: 100, visible: true,
    children: [],
  };
  let n;
  switch (type) {
    case 'frame': n = { ...base, name: 'Frame', w: 600, h: 400, fill: '#ffffff', radius: 0,
      layout: 'vertical', padding: { t: 24, r: 24, b: 24, l: 24 }, gap: 16,
      primaryAlign: 'start', counterAlign: 'start' }; break;
    case 'text': n = { ...base, name: 'Text', type: 'text', w: 240, h: 28, widthMode: 'hug', heightMode: 'hug',
      fill: 'transparent', text: 'Type something', fontSize: 16, fontWeight: 400, color: '#1d1d1f',
      textAlign: 'left', lineHeight: 1.4, letterSpacing: 0 }; break;
    case 'rect': n = { ...base, name: 'Rectangle', w: 160, h: 120, fill: '#0d99ff', radius: 8 }; break;
    case 'image': n = { ...base, name: 'Image', type: 'image', w: 280, h: 180, radius: 8,
      src: 'https://placehold.co/560x360/0d99ff/ffffff?text=Image', fill: '#2a2a2a' }; break;
    case 'button': n = { ...base, name: 'Button', type: 'button', w: 140, h: 44, widthMode: 'hug', heightMode: 'fixed',
      fill: '#0d99ff', radius: 10, text: 'Button', fontSize: 14, color: '#ffffff', fontWeight: 600,
      padding: { t: 12, r: 22, b: 12, l: 22 } }; break;
    default: n = base;
  }
  return { ...n, ...over };
}

/* ---- Tree helpers --------------------------------------------------- */
function walk(node, fn, parent = null, depth = 0) {
  if (node !== scene) fn(node, parent, depth);
  (node.children || []).forEach(c => walk(c, fn, node === scene ? scene : node, depth + 1));
}
function findNode(id, node = scene) {
  if (node.id === id) return node;
  for (const c of node.children || []) { const f = findNode(id, c); if (f) return f; }
  return null;
}
function findParent(id, node = scene) {
  for (const c of node.children || []) {
    if (c.id === id) return node;
    const f = findParent(id, c); if (f) return f;
  }
  return null;
}
function isAutoLayout(n) { return n && n.type === 'frame' && n.layout && n.layout !== 'none'; }
function firstSelected() { return selection.size ? findNode([...selection][0]) : null; }

/* =====================================================================
   RENDER — build the DOM scene from the model (auto-layout = flexbox)
   ===================================================================== */
function render() {
  els.scene.innerHTML = scene.children.map(n => nodeHTML(n, scene)).join('');
  applyTransform();
  renderLayers();
  renderInspector();
  drawOverlay();
  els.hint.classList.toggle('hide', scene.children.length > 0);
  bindNodeEvents();
}

// Compute the inline style for a node given its parent (for sizing logic)
function styleFor(node, parent) {
  const css = [];
  const horiz = isAutoLayout(parent) && parent.layout === 'horizontal';
  const auto = isAutoLayout(parent);

  // --- sizing (Hug / Fill / Fixed) ---
  // width
  if (node.widthMode === 'fixed') { css.push(`width:${node.w}px`); if (horiz) css.push('flex-shrink:0'); }
  else if (node.widthMode === 'fill') {
    if (horiz) css.push('flex:1 1 0;width:auto;min-width:0');
    else css.push('align-self:stretch;width:auto');
  } else { // hug
    css.push(node.type === 'text' ? 'width:max-content;max-width:100%' : 'width:fit-content');
    if (horiz) css.push('flex:0 0 auto');
  }
  // height
  if (node.heightMode === 'fixed') { css.push(`height:${node.h}px`); if (auto && !horiz) css.push('flex-shrink:0'); }
  else if (node.heightMode === 'fill') {
    if (auto && !horiz) css.push('flex:1 1 0;height:auto;min-height:0');
    else css.push('align-self:stretch;height:auto');
  } else { css.push('height:fit-content'); }

  // --- root frame: free position on canvas ---
  if (parent === scene) css.push(`left:${node.x}px;top:${node.y}px`);
  // --- child of a free (non-auto) frame: absolute position ---
  else if (parent && parent.type === 'frame' && !isAutoLayout(parent)) css.push(`position:absolute;left:${node.x}px;top:${node.y}px`);

  // --- appearance ---
  if (node.fill && node.fill !== 'transparent') css.push(`background:${node.fill}`);
  if (node.radius) css.push(`border-radius:${node.radius}px`);
  if (node.opacity != null && node.opacity !== 100) css.push(`opacity:${node.opacity / 100}`);

  // --- frame auto-layout container ---
  if (node.type === 'frame') {
    if (isAutoLayout(node)) {
      css.push('display:flex');
      css.push(`flex-direction:${node.layout === 'horizontal' ? 'row' : 'column'}`);
      css.push(`gap:${node.gap}px`);
      css.push(`justify-content:${mapPrimary(node.primaryAlign)}`);
      css.push(`align-items:${mapCounter(node.counterAlign)}`);
    } else { css.push('position:relative'); }
    const p = node.padding || { t: 0, r: 0, b: 0, l: 0 };
    css.push(`padding:${p.t}px ${p.r}px ${p.b}px ${p.l}px`);
  }

  // --- text ---
  if (node.type === 'text') {
    css.push(`font-size:${node.fontSize}px`, `font-weight:${node.fontWeight}`, `color:${node.color}`,
      `text-align:${node.textAlign}`, `line-height:${node.lineHeight}`, `letter-spacing:${node.letterSpacing}px`);
  }
  // --- button ---
  if (node.type === 'button') {
    const p = node.padding || { t: 12, r: 22, b: 12, l: 22 };
    css.push(`padding:${p.t}px ${p.r}px ${p.b}px ${p.l}px`, `font-size:${node.fontSize}px`,
      `color:${node.color}`, `font-weight:${node.fontWeight}`);
  }
  // --- image ---
  if (node.type === 'image' && node.src) css.push(`background-image:url('${cssUrl(node.src)}')`);

  return css.join(';');
}
function mapPrimary(a) { return a === 'center' ? 'center' : a === 'end' ? 'flex-end' : a === 'space-between' ? 'space-between' : 'flex-start'; }
function mapCounter(a) { return a === 'center' ? 'center' : a === 'end' ? 'flex-end' : 'flex-start'; }
function cssUrl(u) { return String(u).replace(/'/g, "\\'"); }
function esc(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

function nodeHTML(node, parent) {
  const rootCls = parent === scene ? ' root' : '';
  const cls = `node type-${node.type}${rootCls}${node.children && node.children.length === 0 && node.type === 'frame' ? ' empty-frame' : ''}`;
  const style = styleFor(node, parent) + (node.visible === false ? ';display:none' : '');
  let inner = '';
  if (node.type === 'text' || node.type === 'button') {
    inner = `<div class="node-text" data-edit="${node.id}">${esc(node.text)}</div>`;
  } else if (node.children) {
    inner = node.children.map(c => nodeHTML(c, node)).join('');
  }
  return `<div class="${cls}" data-id="${node.id}" style="${style}">${inner}</div>`;
}

/* =====================================================================
   PAN & ZOOM (infinite canvas)
   ===================================================================== */
function applyTransform() {
  els.scene.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
  $('#zoomVal').textContent = Math.round(view.zoom * 100) + '%';
  drawOverlay();
}
function zoomAt(clientX, clientY, factor) {
  const r = els.viewport.getBoundingClientRect();
  const px = clientX - r.left, py = clientY - r.top;
  const nz = clamp(view.zoom * factor, 0.05, 8);
  // keep the point under the cursor stationary
  view.x = px - (px - view.x) * (nz / view.zoom);
  view.y = py - (py - view.y) * (nz / view.zoom);
  view.zoom = nz;
  applyTransform();
}
els.viewport.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  } else {
    view.x -= e.deltaX; view.y -= e.deltaY; applyTransform();
  }
}, { passive: false });

$('#zoomIn').onclick = () => { const r = els.viewport.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.2); };
$('#zoomOut').onclick = () => { const r = els.viewport.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.2); };
$('#zoomVal').onclick = () => { view.zoom = 1; applyTransform(); };
$('#zoomFit').onclick = zoomToFit;

function zoomToFit() {
  if (!scene.children.length) { view = { x: 120, y: 80, zoom: 1 }; applyTransform(); return; }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  scene.children.forEach(n => {
    const w = nodeOuterW(n), h = nodeOuterH(n);
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + w); maxY = Math.max(maxY, n.y + h);
  });
  const r = els.viewport.getBoundingClientRect();
  const pad = 80;
  const zoom = clamp(Math.min((r.width - pad * 2) / (maxX - minX), (r.height - pad * 2) / (maxY - minY)), 0.05, 2);
  view.zoom = zoom;
  view.x = (r.width - (maxX - minX) * zoom) / 2 - minX * zoom;
  view.y = (r.height - (maxY - minY) * zoom) / 2 - minY * zoom;
  applyTransform();
}
// Measured outer size (uses live DOM when available, else stored)
function nodeOuterW(n) { const el = nodeEl(n.id); return el ? el.offsetWidth : n.w; }
function nodeOuterH(n) { const el = nodeEl(n.id); return el ? el.offsetHeight : n.h; }
function nodeEl(id) { return els.scene.querySelector(`[data-id="${id}"]`); }

/* convert a client point to scene coordinates */
function toScene(clientX, clientY) {
  const r = els.viewport.getBoundingClientRect();
  return { x: (clientX - r.left - view.x) / view.zoom, y: (clientY - r.top - view.y) / view.zoom };
}

/* =====================================================================
   SELECTION OVERLAY + RESIZE HANDLES (screen space)
   ===================================================================== */
function drawOverlay() {
  const h = els.handles; h.innerHTML = '';
  if (!selection.size) return;
  const vr = els.viewport.getBoundingClientRect();
  let union = null;

  selection.forEach(id => {
    const el = nodeEl(id); if (!el) return;
    const r = el.getBoundingClientRect();
    const box = { x: r.left - vr.left, y: r.top - vr.top, w: r.width, h: r.height };
    union = union ? {
      x: Math.min(union.x, box.x), y: Math.min(union.y, box.y),
      r: Math.max(union.x + union.w, box.x + box.w), b: Math.max(union.y + union.h, box.y + box.h),
    } : { x: box.x, y: box.y, r: box.x + box.w, b: box.y + box.h };

    const sb = document.createElement('div');
    sb.className = 'sel-box';
    sb.style.cssText = `left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px`;
    const node = findNode(id);
    sb.innerHTML = `<span class="sel-tag">${esc(node ? node.name : '')}</span>`;
    h.appendChild(sb);
  });

  if (union) union = { x: union.x, y: union.y, w: union.r - union.x, h: union.b - union.y };
  // Single selection → resize handles + dimension label
  if (selection.size === 1 && union) {
    const node = firstSelected();
    ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach(dir => {
      const hd = document.createElement('div');
      hd.className = 'handle ' + dir;
      const pos = handlePos(dir, union);
      hd.style.cssText = `left:${pos.x - 4.5}px;top:${pos.y - 4.5}px`;
      hd.dataset.dir = dir;
      h.appendChild(hd);
    });
    const dim = document.createElement('div');
    dim.className = 'sel-dim';
    dim.textContent = `${Math.round(nodeOuterW(node))} × ${Math.round(nodeOuterH(node))}`;
    dim.style.cssText = `left:${union.x + union.w / 2}px;top:${union.y + union.h}px`;
    h.appendChild(dim);
  }
}
function handlePos(dir, u) {
  const cx = u.x + u.w / 2, cy = u.y + u.h / 2;
  return {
    nw: { x: u.x, y: u.y }, n: { x: cx, y: u.y }, ne: { x: u.x + u.w, y: u.y },
    e: { x: u.x + u.w, y: cy }, se: { x: u.x + u.w, y: u.y + u.h }, s: { x: cx, y: u.y + u.h },
    sw: { x: u.x, y: u.y + u.h }, w: { x: u.x, y: cy },
  }[dir];
}

/* =====================================================================
   POINTER INTERACTIONS  (pan, draw, select, move, resize, reorder)
   ===================================================================== */
let spaceDown = false;
let drag = null;   // active gesture descriptor

window.addEventListener('keydown', e => {
  if (e.code === 'Space' && !isEditing()) { spaceDown = true; els.viewport.classList.add('space'); e.preventDefault(); }
});
window.addEventListener('keyup', e => { if (e.code === 'Space') { spaceDown = false; els.viewport.classList.remove('space'); } });

els.viewport.addEventListener('pointerdown', onPointerDown);

function onPointerDown(e) {
  if (e.button === 1 || (e.button === 0 && (spaceDown || activeTool === 'move' && e.target === els.viewport && false))) { /* handled below */ }

  // Resize handle?
  const handle = e.target.closest('.handle');
  if (handle && selection.size === 1) { startResize(e, handle.dataset.dir); return; }

  // Pan: middle mouse or space-drag
  if (e.button === 1 || (spaceDown && e.button === 0)) { startPan(e); return; }

  // Drawing tools
  if (activeTool !== 'move') { startDraw(e); return; }

  // Move tool: hit-test a node
  const nodeEl = e.target.closest('.node');
  if (nodeEl) {
    const id = nodeEl.dataset.id;
    if (e.shiftKey) toggleSelect(id);
    else if (!selection.has(id)) selectOnly(id);
    startMove(e);
  } else {
    if (!e.shiftKey) { selection.clear(); syncSelectionUI(); }
    startMarquee(e);
  }
}

/* ---- Pan ---- */
function startPan(e) {
  els.viewport.classList.add('grabbing');
  const sx = e.clientX, sy = e.clientY, ox = view.x, oy = view.y;
  drag = { type: 'pan', move(ev) { view.x = ox + (ev.clientX - sx); view.y = oy + (ev.clientY - sy); applyTransform(); }, end() { els.viewport.classList.remove('grabbing'); } };
  capture(e);
}

/* ---- Draw new node ---- */
function startDraw(e) {
  const start = toScene(e.clientX, e.clientY);
  const tool = activeTool;
  // Decide parent: drop into a frame if pointer is over one (auto-layout appends)
  const overEl = e.target.closest('.node[data-id]');
  let parent = scene, overFrame = null;
  if (overEl) {
    const cand = findNode(overEl.dataset.id);
    const frame = cand && cand.type === 'frame' ? cand : findParent(cand.id);
    if (frame && frame.type === 'frame') overFrame = frame;
  }
  const ghost = document.createElement('div');
  ghost.className = 'marquee';
  els.handles.appendChild(ghost);
  drag = {
    type: 'draw',
    move(ev) {
      const p = toScene(ev.clientX, ev.clientY);
      const vr = els.viewport.getBoundingClientRect();
      const x = Math.min(start.x, p.x), y = Math.min(start.y, p.y);
      const w = Math.abs(p.x - start.x), hh = Math.abs(p.y - start.y);
      ghost.style.cssText = `left:${x * view.zoom + view.x}px;top:${y * view.zoom + view.y}px;width:${w * view.zoom}px;height:${hh * view.zoom}px`;
      drag._rect = { x, y, w, h: hh };
    },
    end() {
      ghost.remove();
      const r = drag._rect || { w: 0, h: 0 };
      const tiny = r.w < 6 || r.h < 6;
      const node = makeNode(tool);
      if (!tiny) { node.w = Math.round(r.w); node.h = Math.round(r.h); }
      if (tool === 'text' || tool === 'button') { node.widthMode = tiny ? 'hug' : 'fixed'; node.heightMode = 'hug'; }
      if (overFrame) {
        // append into frame (auto-layout will position it)
        if (!isAutoLayout(overFrame)) { node.x = Math.round(r.x - overFrame.x); node.y = Math.round(r.y - overFrame.y); }
        overFrame.children.push(node);
      } else {
        node.x = Math.round(tiny ? start.x : r.x);
        node.y = Math.round(tiny ? start.y : r.y);
        scene.children.push(node);
      }
      selectOnly(node.id);
      setTool('move');
      render();
      if (tool === 'text') setTimeout(() => beginEditText(node.id), 0);
    },
  };
  capture(e);
}

/* ---- Marquee select ---- */
function startMarquee(e) {
  const start = toScene(e.clientX, e.clientY);
  const ghost = document.createElement('div'); ghost.className = 'marquee'; els.handles.appendChild(ghost);
  drag = {
    type: 'marquee',
    move(ev) {
      const p = toScene(ev.clientX, ev.clientY);
      const x = Math.min(start.x, p.x), y = Math.min(start.y, p.y), w = Math.abs(p.x - start.x), hh = Math.abs(p.y - start.y);
      ghost.style.cssText = `left:${x * view.zoom + view.x}px;top:${y * view.zoom + view.y}px;width:${w * view.zoom}px;height:${hh * view.zoom}px`;
      drag._rect = { x, y, w, h: hh };
    },
    end() {
      ghost.remove();
      const r = drag._rect; if (!r || r.w < 4) return;
      const vr = els.viewport.getBoundingClientRect();
      scene.children.forEach(n => {
        const el = nodeEl(n.id); if (!el) return;
        const b = el.getBoundingClientRect();
        const bx = (b.left - vr.left - view.x) / view.zoom, by = (b.top - vr.top - view.y) / view.zoom;
        const bw = b.width / view.zoom, bh = b.height / view.zoom;
        if (bx < r.x + r.w && bx + bw > r.x && by < r.y + r.h && by + bh > r.y) selection.add(n.id);
      });
      syncSelectionUI();
    },
  };
  capture(e);
}

/* ---- Move selected nodes ---- */
function startMove(e) {
  const ids = [...selection];
  const starts = ids.map(id => { const n = findNode(id); return { id, x: n.x, y: n.y, parent: findParent(id) }; });
  const sx = e.clientX, sy = e.clientY;
  let moved = false;
  drag = {
    type: 'move',
    move(ev) {
      const dx = (ev.clientX - sx) / view.zoom, dy = (ev.clientY - sy) / view.zoom;
      if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 3) moved = true;
      let reordered = false;
      starts.forEach(s => {
        const n = findNode(s.id);
        if (isAutoLayout(s.parent)) {
          // Auto-layout: reorder among siblings based on pointer
          reordered = reorderInLayout(s.parent, n, ev) || reordered;
        } else {
          n.x = Math.round(s.x + dx); n.y = Math.round(s.y + dy);
        }
      });
      if (reordered) render(); else { quickReposition(); drawOverlay(); }
      clearInsert();
    },
    end() { clearInsert(); if (moved) render(); },
  };
  capture(e);
}
// Cheap DOM reposition for free-moving nodes (avoids full re-render each frame)
function quickReposition() {
  selection.forEach(id => {
    const n = findNode(id), parent = findParent(id);
    if (isAutoLayout(parent)) return;
    const el = nodeEl(id); if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
  });
}
// Reorder a node within an auto-layout parent based on pointer position
function reorderInLayout(parent, node, ev) {
  const sibs = parent.children;
  const horiz = parent.layout === 'horizontal';
  const p = ev;
  let target = sibs.length - 1;
  for (let i = 0; i < sibs.length; i++) {
    const el = nodeEl(sibs[i].id); if (!el) continue;
    const r = el.getBoundingClientRect();
    const mid = horiz ? r.left + r.width / 2 : r.top + r.height / 2;
    const cur = horiz ? p.clientX : p.clientY;
    if (cur < mid) { target = i; break; }
    target = i + 1 > sibs.length - 1 ? sibs.length - 1 : i + 1;
  }
  const from = sibs.indexOf(node);
  let to = clamp(target, 0, sibs.length - 1);
  if (from === to) { showInsert(parent, to, horiz); return false; }
  sibs.splice(from, 1);
  sibs.splice(to, 0, node);
  return true;
}
function showInsert(parent, index, horiz) {
  clearInsert();
  const sibs = parent.children;
  const ref = nodeEl((sibs[index] || sibs[sibs.length - 1]).id); if (!ref) return;
  const vr = els.viewport.getBoundingClientRect(); const r = ref.getBoundingClientRect();
  const bar = document.createElement('div'); bar.className = 'insert-bar'; bar.id = '_insbar';
  if (horiz) bar.style.cssText = `left:${r.left - vr.left - 2}px;top:${r.top - vr.top}px;width:3px;height:${r.height}px`;
  else bar.style.cssText = `left:${r.left - vr.left}px;top:${r.top - vr.top - 2}px;width:${r.width}px;height:3px`;
  els.handles.appendChild(bar);
}
function clearInsert() { const b = $('#_insbar'); if (b) b.remove(); }

/* ---- Resize ---- */
function startResize(e, dir) {
  const node = firstSelected(); const parent = findParent(node.id);
  const el = nodeEl(node.id); const r0 = el.getBoundingClientRect();
  const sx = e.clientX, sy = e.clientY;
  const w0 = r0.width / view.zoom, h0 = r0.height / view.zoom;
  const x0 = node.x, y0 = node.y;
  drag = {
    type: 'resize',
    move(ev) {
      const dx = (ev.clientX - sx) / view.zoom, dy = (ev.clientY - sy) / view.zoom;
      let w = w0, h = h0, x = x0, y = y0;
      if (dir.includes('e')) w = w0 + dx;
      if (dir.includes('s')) h = h0 + dy;
      if (dir.includes('w')) { w = w0 - dx; x = x0 + dx; }
      if (dir.includes('n')) { h = h0 - dy; y = y0 + dy; }
      w = Math.max(8, Math.round(w)); h = Math.max(8, Math.round(h));
      node.widthMode = 'fixed'; node.w = w;
      if (dir.includes('n') || dir.includes('s')) { node.heightMode = 'fixed'; node.h = h; }
      if (!isAutoLayout(parent)) { node.x = Math.round(x); node.y = Math.round(y); }
      render();
    },
    end() {},
  };
  capture(e);
}

/* ---- Shared pointer capture ---- */
function capture(e) {
  e.preventDefault();
  const mv = ev => drag && drag.move && drag.move(ev);
  const up = () => {
    window.removeEventListener('pointermove', mv);
    window.removeEventListener('pointerup', up);
    if (drag && drag.end) drag.end();
    drag = null;
  };
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', up);
}

/* =====================================================================
   NODE EVENTS (hover, double-click to edit text / enter frame)
   ===================================================================== */
function bindNodeEvents() {
  $$('.node[data-id]', els.scene).forEach(el => {
    el.addEventListener('mouseenter', () => { hoverId = el.dataset.id; });
    el.addEventListener('dblclick', e => {
      e.stopPropagation();
      const id = el.dataset.id; const n = findNode(id);
      if (n && (n.type === 'text' || n.type === 'button')) beginEditText(id);
    });
  });
}
function beginEditText(id) {
  const el = nodeEl(id); if (!el) return;
  const ed = el.querySelector('[data-edit]'); if (!ed) return;
  ed.setAttribute('contenteditable', 'true');
  ed.focus();
  document.getSelection().selectAllChildren(ed);
  const finish = () => {
    ed.removeAttribute('contenteditable');
    const n = findNode(id); if (n) n.text = ed.textContent;
    ed.removeEventListener('blur', finish);
    render();
  };
  ed.addEventListener('blur', finish);
  ed.addEventListener('keydown', ev => { if (ev.key === 'Escape' || (ev.key === 'Enter' && !ev.shiftKey)) { ev.preventDefault(); ed.blur(); } });
}
function isEditing() { return document.activeElement && document.activeElement.isContentEditable; }

/* =====================================================================
   SELECTION API
   ===================================================================== */
function selectOnly(id) { selection = new Set([id]); syncSelectionUI(); }
function toggleSelect(id) { if (selection.has(id)) selection.delete(id); else selection.add(id); syncSelectionUI(); }
function syncSelectionUI() { drawOverlay(); renderLayers(); renderInspector(); }

/* =====================================================================
   LAYERS TREE  (hierarchy + drag reorder)
   ===================================================================== */
const TYPE_ICON = {
  frame: '<path d="M4 8h16M4 16h16M8 4v16M16 4v16"/>',
  text: '<path d="M4 7V5h16v2M9 19h6M12 5v14"/>',
  rect: '<rect x="4" y="5" width="16" height="14" rx="2"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.7"/><path d="m21 15-5-5L5 21"/>',
  button: '<rect x="3" y="8" width="18" height="8" rx="4"/>',
};
function renderLayers() {
  const rows = [];
  const build = (node, depth) => {
    const hasKids = node.children && node.children.length;
    const isCol = collapsed.has(node.id);
    rows.push(layerRow(node, depth, hasKids, isCol));
    if (hasKids && !isCol) [...node.children].forEach(c => build(c, depth + 1));
  };
  // top-down: render root frames; show children indented (reverse so top of list = front)
  [...scene.children].reverse().forEach(n => build(n, 0));
  els.layers.innerHTML = rows.join('');
  bindLayerEvents();
}
function layerRow(node, depth, hasKids, isCol) {
  const sel = selection.has(node.id) ? ' selected' : '';
  const caret = hasKids
    ? `<span class="layer-caret${isCol ? ' collapsed' : ''}" data-caret="${node.id}"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg></span>`
    : `<span class="layer-caret leaf"></span>`;
  return `<div class="layer-row${sel}" data-layer="${node.id}" draggable="true" style="padding-left:${6 + depth * 14}px">
    ${caret}
    <span class="layer-ic"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${TYPE_ICON[node.type] || ''}</svg></span>
    <span class="layer-name" data-name="${node.id}">${esc(node.name)}</span>
    <span class="layer-vis" data-vis="${node.id}" title="Toggle visibility">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${node.visible === false ? '<path d="M9.9 4.2A9.5 9.5 0 0 1 12 4c6.5 0 10 8 10 8a18 18 0 0 1-2.2 3.2M6.6 6.6A18 18 0 0 0 2 12s3.5 8 10 8a9 9 0 0 0 4.3-1M3 3l18 18"/>' : '<path d="M2 12s3.5-8 10-8 10 8 10 8-3.5 8-10 8-10-8-10-8z"/><circle cx="12" cy="12" r="3"/>'}</svg>
    </span>
  </div>`;
}
let _layerDrag = null;
function bindLayerEvents() {
  $$('.layer-row', els.layers).forEach(row => {
    const id = row.dataset.layer;
    row.addEventListener('mousedown', e => {
      if (e.target.closest('[data-caret]') || e.target.closest('[data-vis]')) return;
      if (e.shiftKey) toggleSelect(id); else selectOnly(id);
    });
    row.addEventListener('dblclick', e => {
      const nameEl = row.querySelector('[data-name]');
      nameEl.setAttribute('contenteditable', 'true'); nameEl.focus();
      document.getSelection().selectAllChildren(nameEl);
      const fin = () => { const n = findNode(id); if (n) n.name = nameEl.textContent.trim() || n.name; nameEl.removeAttribute('contenteditable'); renderLayers(); renderInspector(); };
      nameEl.addEventListener('blur', fin, { once: true });
      nameEl.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); nameEl.blur(); } });
    });
    const caret = row.querySelector('[data-caret]');
    if (caret) caret.addEventListener('click', e => { e.stopPropagation(); if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id); renderLayers(); });
    const vis = row.querySelector('[data-vis]');
    if (vis) vis.addEventListener('click', e => { e.stopPropagation(); const n = findNode(id); n.visible = n.visible === false ? true : false; render(); });

    // drag reorder
    row.addEventListener('dragstart', e => { _layerDrag = id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); });
    row.addEventListener('dragend', () => { _layerDrag = null; $$('.layer-row').forEach(r => r.classList.remove('drop-before', 'drop-after', 'drop-inside')); });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      if (!_layerDrag || _layerDrag === id) return;
      const n = findNode(id); const r = row.getBoundingClientRect(); const rel = (e.clientY - r.top) / r.height;
      row.classList.remove('drop-before', 'drop-after', 'drop-inside');
      if (n.type === 'frame' && rel > 0.25 && rel < 0.75) row.classList.add('drop-inside');
      else if (rel < 0.5) row.classList.add('drop-before');
      else row.classList.add('drop-after');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after', 'drop-inside'));
    row.addEventListener('drop', e => {
      e.preventDefault();
      const mode = row.classList.contains('drop-inside') ? 'inside' : row.classList.contains('drop-before') ? 'before' : 'after';
      row.classList.remove('drop-before', 'drop-after', 'drop-inside');
      moveInTree(_layerDrag, id, mode);
    });
  });
}
function moveInTree(dragId, targetId, mode) {
  if (!dragId || dragId === targetId) return;
  const dragNode = findNode(dragId);
  // prevent dropping into own descendant
  if (findNode(targetId, dragNode)) return;
  const fromParent = findParent(dragId);
  fromParent.children.splice(fromParent.children.indexOf(dragNode), 1);
  const target = findNode(targetId);
  if (mode === 'inside' && target.type === 'frame') {
    target.children.push(dragNode);
  } else {
    const tp = findParent(targetId);
    let idx = tp.children.indexOf(target);
    // list is reversed visually; "before" (above) = later index. Keep model intuitive:
    if (mode === 'after') idx += 1;
    tp.children.splice(idx, 0, dragNode);
  }
  // moving to scene root: ensure x/y exist
  render();
}

/* =====================================================================
   INSPECTOR  (spatial property editor)
   ===================================================================== */
function renderInspector() {
  const node = firstSelected();
  $('#inspTitle').textContent = node ? node.name : 'Inspector';
  if (!node) {
    els.inspector.innerHTML = `<div class="insp-empty">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 8h16M4 16h16M8 4v16M16 4v16"/></svg>
      Select a layer to edit its properties.</div>`;
    return;
  }
  const parent = findParent(node.id);
  const inAuto = isAutoLayout(parent);
  const secs = [];

  // ---- POSITION & SIZE ----
  secs.push(sec('Position & Size', `
    ${!inAuto ? `<div class="f-row">
      ${numField('X', 'x', Math.round(node.x))}
      ${numField('Y', 'y', Math.round(node.y))}
    </div>` : ''}
    <div class="f-row">
      ${sizeField('W', 'w', node.w, node.widthMode, 'widthMode')}
      ${sizeField('H', 'h', node.h, node.heightMode, 'heightMode')}
    </div>
    <div class="f-row">
      ${numField('⟳', 'radius', node.radius || 0)}
      ${numField('◎', 'opacity', node.opacity)}
    </div>
  `));

  // ---- AUTO LAYOUT (frames) ----
  if (node.type === 'frame') {
    const on = isAutoLayout(node);
    secs.push(sec('Auto Layout', `
      <div class="f-row">
        <div class="seg" style="flex:1" data-prop="layout">
          <button data-v="none" class="${node.layout === 'none' || !node.layout ? 'active' : ''}" title="None">✕</button>
          <button data-v="vertical" class="${node.layout === 'vertical' ? 'active' : ''}" title="Vertical">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="3" width="12" height="5" rx="1"/><rect x="6" y="11" width="12" height="5" rx="1"/><rect x="6" y="19" width="12" height="2" rx="1"/></svg></button>
          <button data-v="horizontal" class="${node.layout === 'horizontal' ? 'active' : ''}" title="Horizontal">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="5" height="12" rx="1"/><rect x="11" y="6" width="5" height="12" rx="1"/><rect x="19" y="6" width="2" height="12" rx="1"/></svg></button>
        </div>
      </div>
      ${on ? `
      <div class="f-row">${numField('⇆', 'gap', node.gap)}
        <div class="f-col"><div class="f-label">Align</div>
          <select class="select" data-prop="primaryAlign">
            <option value="start" ${node.primaryAlign==='start'?'selected':''}>Start</option>
            <option value="center" ${node.primaryAlign==='center'?'selected':''}>Center</option>
            <option value="end" ${node.primaryAlign==='end'?'selected':''}>End</option>
            <option value="space-between" ${node.primaryAlign==='space-between'?'selected':''}>Space between</option>
          </select></div>
      </div>
      <div class="f-row">
        <div class="f-col"><div class="f-label">Cross axis</div>
          <select class="select" data-prop="counterAlign">
            <option value="start" ${node.counterAlign==='start'?'selected':''}>Start</option>
            <option value="center" ${node.counterAlign==='center'?'selected':''}>Center</option>
            <option value="end" ${node.counterAlign==='end'?'selected':''}>End</option>
          </select></div>
      </div>
      <div class="f-label" style="margin-top:4px">Padding</div>
      <div class="pad-grid">
        ${numField('T', 'pad.t', node.padding.t)}
        ${numField('R', 'pad.r', node.padding.r)}
        ${numField('B', 'pad.b', node.padding.b)}
        ${numField('L', 'pad.l', node.padding.l)}
      </div>` : ''}
    `));
  }

  // ---- TYPOGRAPHY ----
  if (node.type === 'text' || node.type === 'button') {
    secs.push(sec('Typography', `
      <div class="f-row">${numField('Aa', 'fontSize', node.fontSize)}
        <div class="f-col"><div class="f-label">Weight</div>
          <select class="select" data-prop="fontWeight">
            ${[400,500,600,700,800].map(w => `<option value="${w}" ${node.fontWeight==w?'selected':''}>${w}</option>`).join('')}
          </select></div>
      </div>
      ${node.type==='text' ? `<div class="f-row">${numField('↕', 'lineHeight', node.lineHeight)}${numField('A↔', 'letterSpacing', node.letterSpacing)}</div>
      <div class="f-row"><div class="seg" style="flex:1" data-prop="textAlign">
        <button data-v="left" class="${node.textAlign==='left'?'active':''}">L</button>
        <button data-v="center" class="${node.textAlign==='center'?'active':''}">C</button>
        <button data-v="right" class="${node.textAlign==='right'?'active':''}">R</button>
      </div></div>` : ''}
      ${colorRow('Text', 'color', node.color)}
    `));
  }

  // ---- IMAGE ----
  if (node.type === 'image') {
    secs.push(sec('Image', `<div class="f-col"><div class="f-label">Source URL</div>
      <div class="field text"><input data-prop="src" value="${esc(node.src)}"></div></div>`));
  }

  // ---- FILL ----
  if (node.type !== 'text') {
    secs.push(sec('Fill', colorRow('Fill', 'fill', node.fill === 'transparent' ? '#ffffff' : node.fill, node.fill === 'transparent')));
  }

  // ---- ACTIONS ----
  secs.push(`<div class="insp-sec"><div class="f-row">
    <button class="btn ghost" style="flex:1" data-act="dup">Duplicate</button>
    <button class="btn ghost" style="flex:1;color:var(--danger)" data-act="del">Delete</button>
  </div></div>`);

  els.inspector.innerHTML = secs.join('');
  bindInspector(node);
}
function sec(title, body) { return `<div class="insp-sec"><div class="insp-sec-head"><span>${title}</span></div>${body}</div>`; }
function numField(glyph, prop, val) {
  return `<div class="f-col"><div class="field"><span class="glyph" data-scrub="${prop}">${glyph}</span><input data-prop="${prop}" value="${val}"></div></div>`;
}
function sizeField(glyph, prop, val, mode, modeProp) {
  return `<div class="f-col">
    <div class="field"><span class="glyph" data-scrub="${prop}">${glyph}</span>
      <input data-prop="${prop}" value="${Math.round(val)}" ${mode!=='fixed'?'disabled':''}></div>
    <select class="select" data-prop="${modeProp}" style="height:24px;margin-top:4px;font-size:11px">
      <option value="fixed" ${mode==='fixed'?'selected':''}>Fixed</option>
      <option value="hug" ${mode==='hug'?'selected':''}>Hug</option>
      <option value="fill" ${mode==='fill'?'selected':''}>Fill</option>
    </select></div>`;
}
function colorRow(label, prop, val, isTransparent) {
  return `<div class="f-label">${label}</div><div class="color-row">
    <span class="swatch"><input type="color" data-prop="${prop}" value="${val}"></span>
    <div class="field text" style="flex:1"><input data-prop="${prop}_hex" value="${isTransparent ? 'transparent' : val}"></div>
  </div>`;
}

function bindInspector(node) {
  const setProp = (prop, value) => {
    if (prop.startsWith('pad.')) { node.padding = node.padding || { t: 0, r: 0, b: 0, l: 0 }; node.padding[prop.slice(4)] = num(value); }
    else if (prop === 'fill_hex' || prop === 'color_hex') { const base = prop.split('_')[0]; node[base] = value.trim(); }
    else if (['x','y','w','h','radius','opacity','gap','fontSize','lineHeight','letterSpacing'].includes(prop)) node[prop] = num(value);
    else node[prop] = value;
    if (prop === 'w') node.widthMode = 'fixed';
    if (prop === 'h') node.heightMode = 'fixed';
    render();
  };
  // text/number inputs
  $$('input[data-prop]', els.inspector).forEach(inp => {
    if (inp.type === 'color') { inp.addEventListener('input', () => setProp(inp.dataset.prop, inp.value)); return; }
    inp.addEventListener('change', () => setProp(inp.dataset.prop, inp.value));
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
  });
  // selects
  $$('select[data-prop]', els.inspector).forEach(sel => sel.addEventListener('change', () => setProp(sel.dataset.prop, sel.value)));
  // segmented controls
  $$('.seg[data-prop]', els.inspector).forEach(seg => {
    const prop = seg.dataset.prop;
    seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      if (prop === 'layout' && b.dataset.v !== 'none' && (!node.padding)) node.padding = { t: 16, r: 16, b: 16, l: 16 };
      node[prop] = b.dataset.v;
      if (prop === 'layout' && b.dataset.v !== 'none') { node.gap = node.gap ?? 16; node.primaryAlign = node.primaryAlign || 'start'; node.counterAlign = node.counterAlign || 'start'; }
      render();
    }));
  });
  // scrub glyphs (drag to change number)
  $$('.glyph[data-scrub]', els.inspector).forEach(g => {
    g.addEventListener('pointerdown', e => {
      e.preventDefault();
      const prop = g.dataset.scrub; const startX = e.clientX;
      const cur = num(getProp(node, prop));
      const step = (prop === 'lineHeight' || prop === 'opacity') ? 0.05 : 1;
      const mv = ev => { setProp(prop, cur + Math.round((ev.clientX - startX)) * step); };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    });
  });
  // actions
  $$('[data-act]', els.inspector).forEach(b => b.addEventListener('click', () => {
    if (b.dataset.act === 'del') deleteSelection();
    if (b.dataset.act === 'dup') duplicateSelection();
  }));
}
function getProp(node, prop) { if (prop.startsWith('pad.')) return node.padding[prop.slice(4)]; return node[prop]; }
function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

/* =====================================================================
   NODE OPERATIONS
   ===================================================================== */
function deleteSelection() {
  selection.forEach(id => { const p = findParent(id); if (p) p.children.splice(p.children.findIndex(c => c.id === id), 1); });
  selection.clear(); render();
}
function duplicateSelection() {
  const newIds = [];
  selection.forEach(id => {
    const n = findNode(id), p = findParent(id);
    const copy = cloneNode(n);
    if (p === scene) { copy.x += 24; copy.y += 24; }
    p.children.splice(p.children.indexOf(n) + 1, 0, copy);
    newIds.push(copy.id);
  });
  selection = new Set(newIds); render();
}
function cloneNode(n) {
  const c = JSON.parse(JSON.stringify(n));
  const reId = node => { node.id = newId(); (node.children || []).forEach(reId); };
  reId(c); return c;
}

/* =====================================================================
   TOOLS & TOOLBAR
   ===================================================================== */
function setTool(t) {
  activeTool = t;
  $$('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  els.viewport.classList.toggle('tool-draw', t !== 'move');
}
$$('.tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
$('#addRootFrame').onclick = () => {
  const f = makeNode('frame');
  const c = toScene(els.viewport.getBoundingClientRect().width / 2, 200);
  f.x = Math.round(c.x - f.w / 2); f.y = Math.round(c.y);
  scene.children.push(f); selectOnly(f.id); render();
};

/* =====================================================================
   KEYBOARD SHORTCUTS
   ===================================================================== */
window.addEventListener('keydown', e => {
  if (isEditing()) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); duplicateSelection(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
  if (e.key === 'Escape') { selection.clear(); setTool('move'); syncSelectionUI(); return; }
  const map = { v: 'move', f: 'frame', t: 'text', r: 'rect', i: 'image', b: 'button' };
  if (map[k] && !e.ctrlKey && !e.metaKey) setTool(map[k]);
  // arrow nudge
  if (selection.size && e.key.startsWith('Arrow')) {
    e.preventDefault(); const d = e.shiftKey ? 10 : 1;
    selection.forEach(id => { const n = findNode(id); const p = findParent(id); if (isAutoLayout(p)) return;
      if (e.key === 'ArrowLeft') n.x -= d; if (e.key === 'ArrowRight') n.x += d;
      if (e.key === 'ArrowUp') n.y -= d; if (e.key === 'ArrowDown') n.y += d; });
    render();
  }
});

/* =====================================================================
   EXPORT / PREVIEW   (DOM → HTML; table export deferred per plan)
   ===================================================================== */
function exportHTML() {
  const frames = scene.children.filter(n => n.type === 'frame');
  const body = frames.map(f => `<div style="${styleFor(f, scene).replace(/left:[^;]+;?|top:[^;]+;?|position:[^;]+;?/g, '')};margin:0 auto 24px">${innerHTML(f)}</div>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#f2f2f2;font-family:Inter,Arial,sans-serif;padding:24px}</style></head><body>${body}</body></html>`;
}
function innerHTML(node) {
  if (node.type === 'text' || node.type === 'button') return esc(node.text);
  return (node.children || []).map(c => {
    const st = styleFor(c, node);
    if (c.type === 'image') return `<img src="${esc(c.src)}" alt="" style="${st};display:block;object-fit:cover">`;
    return `<div style="${st}">${innerHTML(c)}</div>`;
  }).join('');
}
$('#previewBtn').onclick = () => {
  $('#previewFrame').srcdoc = exportHTML();
  $('#previewModal').classList.add('show');
};
$('#closePreview').onclick = () => $('#previewModal').classList.remove('show');
$('#previewModal').addEventListener('click', e => { if (e.target.id === 'previewModal') e.currentTarget.classList.remove('show'); });
$('#exportBtn').onclick = () => {
  const blob = new Blob([exportHTML()], { type: 'text/html' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'newsletter.html'; a.click();
  URL.revokeObjectURL(a.href); toast('Exported newsletter.html');
};

function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast';
  t.innerHTML = `<span class="dot"></span>${esc(msg)}`;
  $('#toastWrap').appendChild(t); setTimeout(() => t.remove(), 2600);
}

/* =====================================================================
   SEED CONTENT — a starter newsletter frame to demo auto-layout
   ===================================================================== */
function seed() {
  const frame = makeNode('frame', { name: 'Newsletter', x: 0, y: 0, w: 600, layout: 'vertical', gap: 20,
    padding: { t: 40, r: 40, b: 40, l: 40 }, heightMode: 'hug', fill: '#ffffff' });
  const logo = makeNode('text', { name: 'Brand', text: 'BRAIN DO', fontSize: 14, fontWeight: 800, color: '#0d99ff', letterSpacing: 2, widthMode: 'hug', heightMode: 'hug' });
  const hero = makeNode('image', { name: 'Hero', src: 'https://placehold.co/520x240/0d99ff/ffffff?text=Spatial+Studio', widthMode: 'fill', heightMode: 'fixed', h: 220, radius: 12 });
  const h1 = makeNode('text', { name: 'Headline', text: 'Design email like it’s Figma', fontSize: 30, fontWeight: 800, color: '#111111', widthMode: 'fill', heightMode: 'hug', lineHeight: 1.2 });
  const body = makeNode('text', { name: 'Body', text: 'Drop frames, apply Hug / Fill / Fixed, and watch the layout reflow instantly. This whole block is an auto-layout frame.', fontSize: 16, fontWeight: 400, color: '#444444', widthMode: 'fill', heightMode: 'hug', lineHeight: 1.6 });
  const cta = makeNode('button', { name: 'CTA', text: 'Read more →', fill: '#0d99ff', color: '#ffffff', widthMode: 'hug', heightMode: 'fixed', h: 46 });
  const row = makeNode('frame', { name: 'Footer row', layout: 'horizontal', gap: 12, padding: { t: 16, r: 0, b: 0, l: 0 }, widthMode: 'fill', heightMode: 'hug', fill: 'transparent', primaryAlign: 'space-between', counterAlign: 'center' });
  row.children.push(makeNode('text', { name: 'Copyright', text: '© 2026 Brain Do', fontSize: 12, color: '#999999', widthMode: 'hug', heightMode: 'hug' }));
  row.children.push(makeNode('text', { name: 'Unsub', text: 'Unsubscribe', fontSize: 12, color: '#0d99ff', widthMode: 'hug', heightMode: 'hug' }));
  frame.children.push(logo, hero, h1, body, cta, row);
  scene.children.push(frame);
}

/* =====================================================================
   INIT
   ===================================================================== */
seed();
render();
zoomToFit();
