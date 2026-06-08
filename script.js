/* =====================================================================
   NEWSLETTER BUILDER
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
    fill: '#222222', fillType: 'solid',           // solid | gradient
    gradFrom: '#0d99ff', gradTo: '#7b61ff', gradAngle: 135,
    radius: 0, opacity: 100, visible: true,
    strokeColor: '#000000', strokeWidth: 0,
    effects: [],          // [{type:'shadow'|'inner'|'blur', x,y,blur,spread,color}]
    children: [],
  };
  let n;
  switch (type) {
    case 'frame': n = { ...base, name: 'Frame', w: 600, h: 400, fill: '#ffffff', radius: 0,
      layout: 'vertical', padding: { t: 24, r: 24, b: 24, l: 24 }, gap: 16,
      primaryAlign: 'start', counterAlign: 'start' }; break;
    case 'text': n = { ...base, name: 'Text', type: 'text', w: 240, h: 28, widthMode: 'hug', heightMode: 'hug',
      fill: 'transparent', text: 'Type something', href: '', fontSize: 16, fontWeight: 400, color: '#1d1d1f',
      textAlign: 'left', lineHeight: 1.4, letterSpacing: 0 }; break;
    case 'rect': n = { ...base, name: 'Rectangle', w: 160, h: 120, fill: '#0d99ff', radius: 8 }; break;
    case 'ellipse': n = { ...base, name: 'Ellipse', type: 'ellipse', w: 140, h: 140, fill: '#0d99ff', radius: 0 }; break;
    case 'triangle': n = { ...base, name: 'Triangle', type: 'triangle', w: 150, h: 130, fill: '#0d99ff', radius: 0 }; break;
    case 'line': n = { ...base, name: 'Line', type: 'line', w: 200, h: 0, heightMode: 'fixed', fill: 'transparent', strokeColor: '#1d1d1f', strokeWidth: 2 }; break;
    case 'arrow': n = { ...base, name: 'Arrow', type: 'arrow', w: 200, h: 24, fill: '#1d1d1f', radius: 0 }; break;
    case 'image': n = { ...base, name: 'Image', type: 'image', w: 280, h: 180, radius: 8, href: '',
      src: 'https://placehold.co/560x360/0d99ff/ffffff?text=Image', fill: '#2a2a2a' }; break;
    case 'button': n = { ...base, name: 'Button', type: 'button', w: 140, h: 44, widthMode: 'hug', heightMode: 'fixed',
      fill: '#0d99ff', radius: 10, text: 'Button', href: 'https://example.com', fontSize: 14, color: '#ffffff', fontWeight: 600,
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
  scheduleCommit();
}

// Repaint only the canvas + overlay without rebuilding the inspector.
// Used for live slider dragging so the control keeps focus mid-drag.
function renderSceneOnly() {
  els.scene.innerHTML = scene.children.map(n => nodeHTML(n, scene)).join('');
  applyTransform();
  drawOverlay();
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
  const gradCss = `linear-gradient(${node.gradAngle || 135}deg, ${node.gradFrom || '#0d99ff'}, ${node.gradTo || '#7b61ff'})`;
  // Text uses a clipped gradient so the letters themselves are colored;
  // everything else fills its box background with the gradient.
  if (node.fillType === 'gradient' && node.type === 'text') {
    css.push(`background-image:${gradCss}`, '-webkit-background-clip:text', 'background-clip:text', '-webkit-text-fill-color:transparent', 'color:transparent');
  } else if (node.fillType === 'gradient') {
    css.push(`background:${gradCss}`);
  } else if (node.fill && node.fill !== 'transparent') css.push(`background:${node.fill}`);
  if (node.radius) css.push(`border-radius:${node.radius}px`);
  if (node.opacity != null && node.opacity !== 100) css.push(`opacity:${node.opacity / 100}`);
  if (node.strokeWidth) css.push(`border:${node.strokeWidth}px solid ${node.strokeColor || '#000'}`);

  // --- effects (shadows / blur) ---
  const fx = effectCss(node);
  if (fx.shadow) css.push(`box-shadow:${fx.shadow}`);
  if (fx.filter) css.push(`filter:${fx.filter}`);

  // --- frame auto-layout container ---
  if (node.type === 'frame') {
    if (isAutoLayout(node)) {
      const gx = node.gapX ?? node.gap ?? 16;     // horizontal spacing (columns)
      const gy = node.gapY ?? node.gap ?? 16;     // vertical spacing (rows)
      if (node.layout === 'grid') {
        css.push('display:grid');
        css.push(`grid-template-columns:repeat(${Math.max(1, node.cols || 2)}, 1fr)`);
        css.push(`column-gap:${gx}px`, `row-gap:${gy}px`);
        css.push(`justify-items:${mapCounter(node.counterAlign)}`);
        css.push(`align-content:${mapPrimary(node.primaryAlign)}`);
      } else if (node.layout === 'wrap') {
        css.push('display:flex', 'flex-wrap:wrap', 'flex-direction:row');
        css.push(`column-gap:${gx}px`, `row-gap:${gy}px`);
        css.push(`justify-content:${mapPrimary(node.primaryAlign)}`);
        css.push(`align-items:${mapCounter(node.counterAlign)}`);
      } else {
        css.push('display:flex');
        css.push(`flex-direction:${node.layout === 'horizontal' ? 'row' : 'column'}`);
        css.push(`gap:${node.gap ?? 16}px`);
        css.push(`justify-content:${mapPrimary(node.primaryAlign)}`);
        css.push(`align-items:${mapCounter(node.counterAlign)}`);
      }
    } else { css.push('position:relative'); }
    const p = node.padding || { t: 0, r: 0, b: 0, l: 0 };
    css.push(`padding:${p.t}px ${p.r}px ${p.b}px ${p.l}px`);
  }

  // --- text ---
  if (node.type === 'text') {
    css.push(`font-size:${node.fontSize}px`, `font-weight:${node.fontWeight}`,
      `text-align:${node.textAlign}`, `line-height:${node.lineHeight}`, `letter-spacing:${node.letterSpacing}px`);
    if (node.fillType !== 'gradient') css.push(`color:${node.color}`);
  }
  // --- button ---
  if (node.type === 'button') {
    const p = node.padding || { t: 12, r: 22, b: 12, l: 22 };
    css.push('display:inline-flex', 'align-items:center', 'justify-content:center', 'text-align:center',
      'line-height:1', 'box-sizing:border-box', 'white-space:nowrap',
      `padding:${p.t}px ${p.r}px ${p.b}px ${p.l}px`, `font-size:${node.fontSize}px`,
      `color:${node.color}`, `font-weight:${node.fontWeight}`);
  }
  // --- image ---
  if (node.type === 'image' && node.src) css.push(`background-image:url('${cssUrl(node.src)}')`, `background-size:${node.fit === 'contain' ? 'contain' : 'cover'}`);

  // --- extra shapes (ellipse / triangle / line / arrow) ---
  if (node.type === 'ellipse') css.push('border-radius:50%');
  if (node.type === 'triangle') { css.push('clip-path:polygon(50% 0%, 0% 100%, 100% 100%)'); }
  if (node.type === 'arrow') { css.push('clip-path:polygon(0% 30%, 65% 30%, 65% 10%, 100% 50%, 65% 90%, 65% 70%, 0% 70%)'); }
  if (node.type === 'line') {
    // A line renders as a horizontal stroke: thickness = strokeWidth.
    const t = node.strokeWidth || 2;
    css.push(`height:${t}px`, `background:${node.strokeColor || '#1d1d1f'}`, 'border:0', 'border-radius:99px');
  }

  return css.join(';');
}
function mapPrimary(a) { return a === 'center' ? 'center' : a === 'end' ? 'flex-end' : a === 'space-between' ? 'space-between' : 'flex-start'; }
function mapCounter(a) { return a === 'center' ? 'center' : a === 'end' ? 'flex-end' : a === 'stretch' ? 'stretch' : 'flex-start'; }
function cssUrl(u) { return String(u).replace(/'/g, "\\'"); }
function esc(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

// Translate a node's effects array into box-shadow + filter strings
function effectCss(node) {
  const shadows = [], filters = [];
  (node.effects || []).forEach(e => {
    if (e.type === 'shadow') shadows.push(`${e.x || 0}px ${e.y || 0}px ${e.blur || 0}px ${e.spread || 0}px ${e.color || 'rgba(0,0,0,.25)'}`);
    else if (e.type === 'inner') shadows.push(`inset ${e.x || 0}px ${e.y || 0}px ${e.blur || 0}px ${e.spread || 0}px ${e.color || 'rgba(0,0,0,.25)'}`);
    else if (e.type === 'blur') filters.push(`blur(${e.blur || 0}px)`);
  });
  return { shadow: shadows.join(', '), filter: filters.join(' ') };
}

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

// Track the last cursor position over the canvas so paste can target it.
let _lastPointer = null;
els.viewport.addEventListener('pointermove', e => { _lastPointer = { x: e.clientX, y: e.clientY }; });

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
  // Decide parent: only drop INTO a frame when it's a freeform (non-auto)
  // frame, so a drawn shape stays exactly where the user drew it. Drawing
  // over an auto-layout frame would otherwise inject it into the flow and
  // move it somewhere unexpected — so those land on the canvas instead.
  const overEl = e.target.closest('.node[data-id]');
  let parent = scene, overFrame = null;
  if (overEl) {
    const cand = findNode(overEl.dataset.id);
    const frame = cand && cand.type === 'frame' ? cand : findParent(cand.id);
    if (frame && frame.type === 'frame' && !isAutoLayout(frame)) overFrame = frame;
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
        // append into a freeform frame, positioned where it was drawn
        node.x = Math.round(r.x - overFrame.x); node.y = Math.round(r.y - overFrame.y);
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
  // Snapping context: only free (non-auto-layout) nodes participate. Capture the
  // moving selection's bounding box and the sibling boxes to snap against.
  const snap = buildSnapContext(starts);
  drag = {
    type: 'move',
    move(ev) {
      let dx = (ev.clientX - sx) / view.zoom, dy = (ev.clientY - sy) / view.zoom;
      if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 3) moved = true;
      // Apply smart-guide + grid snapping for free nodes (Shift bypasses snap).
      if (snap && !ev.shiftKey) {
        const adj = applySnap(snap, dx, dy);
        dx = adj.dx; dy = adj.dy; drawGuides(adj.guides);
      } else clearGuides();
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
    end() { clearInsert(); clearGuides(); if (moved) render(); },
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

/* =====================================================================
   SMART GUIDES + GRID SNAPPING (free-positioned nodes)
   ===================================================================== */
const SNAP_GRID = 8;       // pixel grid step
const SNAP_DIST = 6;       // snap threshold in scene units
// Gather the moving bounding box (scene coords) + sibling edges to snap to.
function buildSnapContext(starts) {
  // Only free nodes (canvas or non-auto frame children) snap.
  const free = starts.filter(s => !isAutoLayout(s.parent));
  if (!free.length) return null;
  const sel = new Set(starts.map(s => s.id));
  // moving union box in scene coords (from stored geometry at drag start)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  free.forEach(s => {
    const n = findNode(s.id);
    const w = nodeOuterW(n), h = nodeOuterH(n);
    minX = Math.min(minX, s.x); minY = Math.min(minY, s.y);
    maxX = Math.max(maxX, s.x + w); maxY = Math.max(maxY, s.y + h);
  });
  // Candidate targets: siblings of the first moving node (same parent) not selected.
  const parent = free[0].parent;
  const sibs = (parent === scene ? scene.children : parent.children) || [];
  const xs = [], ys = [];     // {pos, kind} guide candidates in scene coords
  const offX = parent === scene ? 0 : parent.x;
  const offY = parent === scene ? 0 : parent.y;
  sibs.forEach(n => {
    if (sel.has(n.id)) return;
    const x = (n.x || 0) + offX, y = (n.y || 0) + offY;
    const w = nodeOuterW(n), h = nodeOuterH(n);
    xs.push(x, x + w / 2, x + w);
    ys.push(y, y + h / 2, y + h);
  });
  // Snap to the parent frame's content edges too.
  if (parent !== scene) {
    const pad = parent.padding || { t: 0, r: 0, b: 0, l: 0 };
    xs.push(parent.x + pad.l, parent.x + (parent.w || 0) - pad.r);
    ys.push(parent.y + pad.t, parent.y + (parent.h || 0) - pad.b);
  }
  return { box: { minX, minY, maxX, maxY }, xs, ys };
}
// Given a drag delta, snap it to the nearest guide/grid and report guide lines.
function applySnap(ctx, dx, dy) {
  const b = ctx.box;
  const guides = [];
  // moving edges after the raw delta
  const movX = [b.minX + dx, (b.minX + b.maxX) / 2 + dx, b.maxX + dx];   // left, center, right
  const movY = [b.minY + dy, (b.minY + b.maxY) / 2 + dy, b.maxY + dy];   // top, middle, bottom
  // best element snap on each axis
  let bestX = null, bestY = null;
  movX.forEach(m => ctx.xs.forEach(t => { const d = t - m; if (Math.abs(d) <= SNAP_DIST && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, pos: t }; }));
  movY.forEach(m => ctx.ys.forEach(t => { const d = t - m; if (Math.abs(d) <= SNAP_DIST && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, pos: t }; }));
  if (bestX) { dx += bestX.d; guides.push({ axis: 'x', pos: bestX.pos }); }
  else { const snapped = Math.round((b.minX + dx) / SNAP_GRID) * SNAP_GRID; dx += snapped - (b.minX + dx); }
  if (bestY) { dy += bestY.d; guides.push({ axis: 'y', pos: bestY.pos }); }
  else { const snapped = Math.round((b.minY + dy) / SNAP_GRID) * SNAP_GRID; dy += snapped - (b.minY + dy); }
  return { dx, dy, guides };
}
function drawGuides(guides) {
  clearGuides();
  if (!guides || !guides.length) return;
  const vr = els.viewport.getBoundingClientRect();
  guides.forEach(g => {
    const el = document.createElement('div');
    el.className = 'snap-guide ' + (g.axis === 'x' ? 'v' : 'h');
    if (g.axis === 'x') { const sx = g.pos * view.zoom + view.x; el.style.cssText = `left:${sx}px;top:0;width:1px;height:${vr.height}px`; }
    else { const sy = g.pos * view.zoom + view.y; el.style.cssText = `top:${sy}px;left:0;height:1px;width:${vr.width}px`; }
    els.handles.appendChild(el);
  });
}
function clearGuides() { $$('.snap-guide', els.handles).forEach(g => g.remove()); }

/* ---- Resize ---- */
function startResize(e, dir) {
  const node = firstSelected(); const parent = findParent(node.id);
  const el = nodeEl(node.id); const r0 = el.getBoundingClientRect();
  const sx = e.clientX, sy = e.clientY;
  const w0 = r0.width / view.zoom, h0 = r0.height / view.zoom;
  const x0 = node.x, y0 = node.y;
  // When resizing a frame/group, snapshot its subtree so children scale along.
  const scaleKids = node.type === 'frame' && (node.children || []).length > 0;
  const snap = scaleKids ? snapshotGeom(node) : null;
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
      if (scaleKids) scaleSubtree(node, snap, w / w0, h / h0);
      render();
    },
    end() {},
  };
  capture(e);
}

// Snapshot the geometry of a frame's whole subtree (so a resize can scale it).
function snapshotGeom(root) {
  const map = new Map();
  walk(root, n => {
    map.set(n.id, {
      x: n.x, y: n.y, w: n.w, h: n.h,
      gap: n.gap, padding: n.padding ? { ...n.padding } : null,
      fontSize: n.fontSize, radius: n.radius, strokeWidth: n.strokeWidth,
    });
  });
  return map;
}
// Scale every descendant of a frame by horizontal (rx) / vertical (ry) ratios.
function scaleSubtree(frame, snap, rx, ry) {
  const fs = (rx + ry) / 2;            // uniform factor for type/radius/stroke
  walk(frame, n => {
    if (n.id === frame.id) return;
    const s = snap.get(n.id); if (!s) return;
    if (typeof s.w === 'number') n.w = Math.max(1, Math.round(s.w * rx));
    if (typeof s.h === 'number') n.h = Math.max(1, Math.round(s.h * ry));
    if (!isAutoLayout(findParent(n.id))) {
      n.x = Math.round(s.x * rx); n.y = Math.round(s.y * ry);
    }
    if (s.padding) n.padding = {
      t: Math.round(s.padding.t * ry), r: Math.round(s.padding.r * rx),
      b: Math.round(s.padding.b * ry), l: Math.round(s.padding.l * rx),
    };
    if (typeof s.gap === 'number') n.gap = Math.round(s.gap * (n.layout === 'horizontal' ? rx : ry));
    if (typeof s.fontSize === 'number') n.fontSize = Math.max(6, Math.round(s.fontSize * fs));
    if (typeof s.radius === 'number') n.radius = Math.round(s.radius * fs);
    if (typeof s.strokeWidth === 'number' && s.strokeWidth) n.strokeWidth = Math.max(0, +(s.strokeWidth * fs).toFixed(1));
  });
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
  $('#inspTitle').textContent = node ? (selection.size > 1 ? selection.size + ' selected' : node.name) : 'Inspector';
  if (!node) {
    els.inspector.innerHTML = `<div class="insp-empty">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 8h16M4 16h16M8 4v16M16 4v16"/></svg>
      Select a layer to edit its properties.</div>`;
    return;
  }
  // Multiple selection — offer Group / align actions.
  if (selection.size > 1) {
    els.inspector.innerHTML = `
      <div class="insp-sec">
        <div class="insp-sec-head"><span>${selection.size} elements selected</span></div>
        <div class="f-label" style="margin-bottom:6px">Group as</div>
        <div class="group-opts">
          <button class="group-opt" data-mact="group" data-mode="auto" title="Auto-detect the best layout">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.2-8.6"/><path d="M21 3v6h-6"/></svg>
            <span>Recommended</span></button>
          <button class="group-opt" data-mact="group" data-mode="none" title="Freeform — keep absolute positions">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 5h4v4H5z"/><path d="M14 9h5v5h-5z"/><path d="M8 14h4v5H8z"/></svg>
            <span>Freeform</span></button>
          <button class="group-opt" data-mact="group" data-mode="vertical" title="Stack vertically">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="3" width="12" height="5" rx="1"/><rect x="6" y="11" width="12" height="5" rx="1"/><rect x="6" y="19" width="12" height="2" rx="1"/></svg>
            <span>Vertical</span></button>
          <button class="group-opt" data-mact="group" data-mode="horizontal" title="Place side by side">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="5" height="12" rx="1"/><rect x="11" y="6" width="5" height="12" rx="1"/><rect x="19" y="6" width="2" height="12" rx="1"/></svg>
            <span>Horizontal</span></button>
          <button class="group-opt" data-mact="group" data-mode="grid" title="Arrange in a grid">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></svg>
            <span>Grid</span></button>
          <button class="group-opt" data-mact="group" data-mode="wrap" title="Wrap onto multiple rows">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M3 6v6a3 3 0 0 0 3 3h12"/><path d="M15 12l3 3-3 3"/></svg>
            <span>Wrap</span></button>
        </div>
        <div class="f-row" style="margin-top:10px">
          <button class="btn ghost" style="flex:1" data-mact="dup">Duplicate</button>
          <button class="btn ghost" style="flex:1;color:var(--danger)" data-mact="del">Delete</button>
        </div>
      </div>`;
    $$('[data-mact]', els.inspector).forEach(b => b.addEventListener('click', () => {
      if (b.dataset.mact === 'group') groupSelection(b.dataset.mode || 'auto');
      if (b.dataset.mact === 'dup') duplicateSelection();
      if (b.dataset.mact === 'del') deleteSelection();
    }));
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
  `));

  // ---- AUTO LAYOUT (frames) ----
  if (node.type === 'frame') {
    const on = isAutoLayout(node);
    const isGridish = node.layout === 'grid' || node.layout === 'wrap';
    secs.push(sec('Auto Layout', `
      <div class="f-row">
        <div class="seg seg-layout" style="flex:1" data-prop="layout">
          <button data-v="none" class="${node.layout === 'none' || !node.layout ? 'active' : ''}" title="Freeform">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 5h4v4H5z"/><path d="M14 9h5v5h-5z"/><path d="M8 14h4v5H8z"/></svg></button>
          <button data-v="vertical" class="${node.layout === 'vertical' ? 'active' : ''}" title="Vertical">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="3" width="12" height="5" rx="1"/><rect x="6" y="11" width="12" height="5" rx="1"/><rect x="6" y="19" width="12" height="2" rx="1"/></svg></button>
          <button data-v="horizontal" class="${node.layout === 'horizontal' ? 'active' : ''}" title="Horizontal">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="5" height="12" rx="1"/><rect x="11" y="6" width="5" height="12" rx="1"/><rect x="19" y="6" width="2" height="12" rx="1"/></svg></button>
          <button data-v="grid" class="${node.layout === 'grid' ? 'active' : ''}" title="Grid">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></svg></button>
          <button data-v="wrap" class="${node.layout === 'wrap' ? 'active' : ''}" title="Wrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M3 6v6a3 3 0 0 0 3 3h12"/><path d="M15 12l3 3-3 3"/></svg></button>
        </div>
      </div>
      <button class="btn ghost" style="width:100%;justify-content:center;margin-bottom:8px" data-act="autoLayout"
        title="Detect how the children are arranged and turn this frame into auto layout">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.2-8.6"/><path d="M21 3v6h-6"/></svg>
        Auto-detect layout
      </button>
      ${on ? `
      ${isGridish ? `
      <div class="f-label" style="margin-top:4px">Spacing</div>
      <div class="f-row">
        ${numField('↔', 'gapX', node.gapX ?? node.gap ?? 16)}
        ${numField('↕', 'gapY', node.gapY ?? node.gap ?? 16)}
      </div>
      ${node.layout === 'grid' ? `<div class="f-row">${numField('▦', 'cols', node.cols || 2)}
        <div class="f-col"></div></div>` : ''}
      <div class="f-row">
        <div class="f-col"><div class="f-label">Align</div>
          <select class="select" data-prop="primaryAlign">
            <option value="start" ${node.primaryAlign==='start'?'selected':''}>Start</option>
            <option value="center" ${node.primaryAlign==='center'?'selected':''}>Center</option>
            <option value="end" ${node.primaryAlign==='end'?'selected':''}>End</option>
            <option value="space-between" ${node.primaryAlign==='space-between'?'selected':''}>Space between</option>
          </select></div>
      </div>
      ` : `
      <div class="f-row">${numField('⇆', 'gap', node.gap)}
        <div class="f-col"><div class="f-label">Align</div>
          <select class="select" data-prop="primaryAlign">
            <option value="start" ${node.primaryAlign==='start'?'selected':''}>Start</option>
            <option value="center" ${node.primaryAlign==='center'?'selected':''}>Center</option>
            <option value="end" ${node.primaryAlign==='end'?'selected':''}>End</option>
            <option value="space-between" ${node.primaryAlign==='space-between'?'selected':''}>Space between</option>
          </select></div>
      </div>`}
      <div class="f-label" style="margin-top:4px">Cross axis</div>
      <div class="seg" data-prop="counterAlign">
        <button data-v="start" class="${node.counterAlign==='start'?'active':''}" title="Align start">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4v16"/><rect x="7" y="8" width="9" height="8" rx="1" fill="currentColor" stroke="none"/></svg></button>
        <button data-v="center" class="${node.counterAlign==='center'?'active':''}" title="Align center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v18"/><rect x="6" y="8" width="12" height="8" rx="1" fill="currentColor" stroke="none" opacity="0.85"/></svg></button>
        <button data-v="end" class="${node.counterAlign==='end'?'active':''}" title="Align end">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 4v16"/><rect x="8" y="8" width="9" height="8" rx="1" fill="currentColor" stroke="none"/></svg></button>
        <button data-v="stretch" class="${node.counterAlign==='stretch'?'active':''}" title="Fill / stretch">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4v16M20 4v16"/><rect x="8" y="7" width="8" height="10" rx="1" fill="currentColor" stroke="none" opacity="0.7"/></svg></button>
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

  // ---- LINK (hyperlink for text / button / image) ----
  if (node.type === 'text' || node.type === 'button' || node.type === 'image') {
    secs.push(sec('Link', `
      <div class="f-label">URL</div>
      <div class="field text"><input data-prop="href" placeholder="https://…" value="${esc(node.href || '')}"></div>
      <div style="color:var(--text-3);font-size:10.5px;margin-top:6px">Opens in a new tab in the exported email.</div>
    `));
  }

  // ---- IMAGE ----
  if (node.type === 'image') {
    secs.push(sec('Image', `
      <button class="btn ghost" style="width:100%;justify-content:center;margin-bottom:8px" data-act="importImg">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 9l5-5 5 5"/><path d="M12 4v12"/></svg>
        Import from computer
      </button>
      <div class="f-label">Source URL</div>
      <div class="field text"><input data-prop="src" value="${esc(node.src)}"></div>
      <div class="f-row" style="margin-top:8px"><div class="seg" style="flex:1" data-prop="fit">
        <button data-v="cover" class="${(node.fit||'cover')==='cover'?'active':''}">Cover</button>
        <button data-v="contain" class="${node.fit==='contain'?'active':''}">Contain</button>
      </div></div>`));
  }

  // ---- FILL ----
  secs.push(sec('Fill', fillBody(node)));

  // ---- APPEARANCE (stroke / border) ----
  secs.push(sec('Appearance', `
    <div class="f-label">Corner radius</div>
    <div class="radius-row">
      <input type="range" class="radius-slider" data-prop="radius" min="0" max="${maxRadius(node)}" value="${node.radius || 0}">
      ${numField('⟳', 'radius', node.radius || 0)}
    </div>
    <div class="f-row" style="margin-top:8px">${numField('▢', 'strokeWidth', node.strokeWidth || 0)}
      <div class="f-col"><div class="f-label">Stroke</div>
        <span class="swatch"><input type="color" data-prop="strokeColor" value="${node.strokeColor || '#000000'}"></span></div>
    </div>
    <div class="f-row"><div class="f-col"><div class="f-label">Opacity</div>
      <div class="field"><span class="glyph" data-scrub="opacity">◎</span><input data-prop="opacity" value="${node.opacity}"></div></div>
      <div class="f-col"></div></div>
  `));

  // ---- EFFECTS ----
  secs.push(effectsSec(node));

  // ---- ACTIONS ----
  secs.push(`<div class="insp-sec"><div class="f-row">
    <button class="btn ghost" style="flex:1" data-act="dup">Duplicate</button>
    <button class="btn ghost" style="flex:1;color:var(--danger)" data-act="del">Delete</button>
  </div>${node.type === 'frame' && node.children && node.children.length ? `
  <button class="btn ghost" style="width:100%;justify-content:center;margin-top:8px" data-act="ungroup">
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><path d="M10 6.5h4M6.5 10v4"/></svg>
    Ungroup <span style="color:var(--text-3);margin-left:6px">Ctrl+Shift+G</span>
  </button>` : ''}</div>`);

  els.inspector.innerHTML = secs.join('');
  bindInspector(node);
}
function sec(title, body) { return `<div class="insp-sec"><div class="insp-sec-head"><span>${title}</span></div>${body}</div>`; }
function numField(glyph, prop, val) {
  return `<div class="f-col"><div class="field"><span class="glyph" data-scrub="${prop}">${glyph}</span><input data-prop="${prop}" value="${val}"></div></div>`;
}
// Upper bound for the corner-radius slider — half the smaller side gives a full pill.
function maxRadius(node) { return Math.max(40, Math.round(Math.min(node.w || 0, node.h || 0) / 2)); }
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
// Fill section: Solid / Gradient toggle + relevant editor
function fillBody(node) {
  const isGrad = node.fillType === 'gradient';
  const preview = isGrad
    ? `linear-gradient(${node.gradAngle || 135}deg, ${node.gradFrom || '#0d99ff'}, ${node.gradTo || '#7b61ff'})`
    : (node.fill === 'transparent' ? 'transparent' : node.fill);
  return `
    <div class="f-row"><div class="seg" style="flex:1" data-prop="fillType">
      <button data-v="solid" class="${!isGrad ? 'active' : ''}">Solid</button>
      <button data-v="gradient" class="${isGrad ? 'active' : ''}">Gradient</button>
    </div></div>
    <div class="grad-preview" style="background:${preview}"></div>
    ${isGrad ? `
      <div class="color-row" style="margin-top:8px"><span class="swatch"><input type="color" data-prop="gradFrom" value="${node.gradFrom || '#0d99ff'}"></span>
        <div class="field text" style="flex:1"><input data-prop="gradFrom" value="${node.gradFrom || '#0d99ff'}"></div></div>
      <div class="color-row" style="margin-top:8px"><span class="swatch"><input type="color" data-prop="gradTo" value="${node.gradTo || '#7b61ff'}"></span>
        <div class="field text" style="flex:1"><input data-prop="gradTo" value="${node.gradTo || '#7b61ff'}"></div></div>
      <div class="f-row" style="margin-top:8px">${numField('∠', 'gradAngle', node.gradAngle || 135)}</div>
    ` : `<div style="margin-top:8px">${colorRow('Color', 'fill', node.fill === 'transparent' ? '#ffffff' : node.fill, node.fill === 'transparent')}</div>`}
  `;
}
function effectsSec(node) {
  const list = (node.effects || []).map((e, i) => {
    const isBlur = e.type === 'blur';
    return `<div class="fx-card" data-fx="${i}">
      <div class="fx-head">
        <select class="select fx-type" data-fxprop="type">
          <option value="shadow" ${e.type==='shadow'?'selected':''}>Drop shadow</option>
          <option value="inner" ${e.type==='inner'?'selected':''}>Inner shadow</option>
          <option value="blur" ${e.type==='blur'?'selected':''}>Layer blur</option>
        </select>
        <button class="fx-del" data-fxdel title="Remove">✕</button>
      </div>
      ${isBlur ? `<div class="f-row">${fxNum('◍','blur',e.blur||0)}</div>` : `
        <div class="f-row">${fxNum('X','x',e.x||0)}${fxNum('Y','y',e.y||0)}</div>
        <div class="f-row">${fxNum('◍','blur',e.blur||0)}${fxNum('⤢','spread',e.spread||0)}</div>
        <div class="color-row"><span class="swatch"><input type="color" data-fxprop="colorHex" value="${rgbaToHex(e.color)}"></span>
          <div class="field text" style="flex:1"><input data-fxprop="color" value="${e.color||'rgba(0,0,0,0.25)'}"></div></div>`}
    </div>`;
  }).join('');
  return `<div class="insp-sec"><div class="insp-sec-head"><span>Effects</span>
    <div class="sec-act"><button data-act="addFx" title="Add effect">＋</button></div></div>
    <div class="fx-list">${list || '<div style="color:var(--text-3);font-size:11.5px">No effects</div>'}</div></div>`;
}
function fxNum(glyph, prop, val) {
  return `<div class="f-col"><div class="field"><span class="glyph" data-fxscrub="${prop}">${glyph}</span><input data-fxprop="${prop}" value="${val}"></div></div>`;
}
function rgbaToHex(c) {
  if (!c) return '#000000';
  const m = String(c).match(/rgba?\(([^)]+)\)/);
  if (m) { const [r,g,b] = m[1].split(',').map(n => parseInt(n)); return '#' + [r,g,b].map(x => clamp(x||0,0,255).toString(16).padStart(2,'0')).join(''); }
  return c.startsWith('#') ? c : '#000000';
}

function bindInspector(node) {
  const setProp = (prop, value) => {
    if (prop.startsWith('pad.')) { node.padding = node.padding || { t: 0, r: 0, b: 0, l: 0 }; node.padding[prop.slice(4)] = num(value); }
    else if (prop === 'fill_hex' || prop === 'color_hex') { const base = prop.split('_')[0]; node[base] = value.trim(); }
    else if (['x','y','w','h','radius','opacity','gap','gapX','gapY','cols','fontSize','lineHeight','letterSpacing','strokeWidth','gradAngle'].includes(prop)) node[prop] = num(value);
    else node[prop] = value;
    if (prop === 'w') node.widthMode = 'fixed';
    if (prop === 'h') node.heightMode = 'fixed';
    render();
  };
  // text/number inputs
  $$('input[data-prop]', els.inspector).forEach(inp => {
    if (inp.type === 'color') { inp.addEventListener('input', () => setProp(inp.dataset.prop, inp.value)); return; }
    if (inp.type === 'range') {
      // Live drag: update the node + paired number box and repaint canvas only.
      inp.addEventListener('input', () => {
        node[inp.dataset.prop] = num(inp.value);
        const box = els.inspector.querySelector(`input[data-prop="${inp.dataset.prop}"]:not([type="range"])`);
        if (box) box.value = inp.value;
        renderSceneOnly();
      });
      inp.addEventListener('change', () => setProp(inp.dataset.prop, inp.value));
      return;
    }
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
      if (prop === 'layout' && b.dataset.v !== 'none') {
        node.gap = node.gap ?? 16; node.primaryAlign = node.primaryAlign || 'start'; node.counterAlign = node.counterAlign || 'start';
        if (b.dataset.v === 'grid' || b.dataset.v === 'wrap') {
          node.gapX = node.gapX ?? node.gap ?? 16; node.gapY = node.gapY ?? node.gap ?? 16;
          if (b.dataset.v === 'grid') node.cols = node.cols || 2;
        }
      }
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
    if (b.dataset.act === 'importImg') pickImageFor(node);
    if (b.dataset.act === 'autoLayout') detectAutoLayout(node);
    if (b.dataset.act === 'ungroup') ungroupSelection();
    if (b.dataset.act === 'addFx') { node.effects = node.effects || []; node.effects.push({ type: 'shadow', x: 0, y: 4, blur: 12, spread: 0, color: 'rgba(0,0,0,0.25)' }); render(); }
  }));

  // effect cards
  $$('.fx-card', els.inspector).forEach(card => {
    const i = +card.dataset.fx; const e = node.effects[i];
    const apply = () => render();
    card.querySelector('[data-fxdel]').addEventListener('click', () => { node.effects.splice(i, 1); render(); });
    card.querySelector('select[data-fxprop="type"]').addEventListener('change', ev => { e.type = ev.target.value; render(); });
    card.querySelectorAll('input[data-fxprop]').forEach(inp => {
      const p = inp.dataset.fxprop;
      if (inp.type === 'color') { inp.addEventListener('input', () => { e.color = inp.value; render(); }); return; }
      if (p === 'color') { inp.addEventListener('change', () => { e.color = inp.value.trim(); render(); }); return; }
      inp.addEventListener('change', () => { e[p] = num(inp.value); apply(); });
      inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') inp.blur(); });
    });
    card.querySelectorAll('.glyph[data-fxscrub]').forEach(g => g.addEventListener('pointerdown', ev => {
      ev.preventDefault(); const p = g.dataset.fxscrub; const sx = ev.clientX; const cur = num(e[p]);
      const mv = m => { e[p] = cur + Math.round(m.clientX - sx); render(); };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    }));
  });
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
   AUTO-LAYOUT DETECTION
   Inspect a frame's free-positioned children, figure out whether they
   form a row or a column, and convert the frame to auto layout — deriving
   gap, padding and cross-axis alignment from their actual positions.
   ===================================================================== */
function detectAutoLayout(frame) {
  if (!frame || frame.type !== 'frame') return;
  const kids = frame.children || [];
  if (kids.length < 1) { toast('Add elements to the frame first'); return; }

  // Measure each child's position relative to the frame using the live DOM,
  // so detection works whether children are free-positioned OR already laid out.
  const frameEl = nodeEl(frame.id);
  const fr = frameEl ? frameEl.getBoundingClientRect() : null;
  const z = view.zoom || 1;
  const boxes = kids.map(n => {
    const el = nodeEl(n.id);
    if (el && fr) {
      const r = el.getBoundingClientRect();
      return { n, x: (r.left - fr.left) / z, y: (r.top - fr.top) / z, w: r.width / z, h: r.height / z };
    }
    return { n, x: n.x || 0, y: n.y || 0, w: n.w || 0, h: n.h || 0 };
  });

  // Row vs column: compare the spread of centers on each axis.
  const cx = boxes.map(b => b.x + b.w / 2), cy = boxes.map(b => b.y + b.h / 2);
  const spread = arr => Math.max(...arr) - Math.min(...arr);
  const horizontal = kids.length > 1 ? spread(cx) >= spread(cy) : false;

  // Sort children along the main axis.
  boxes.sort((a, b) => horizontal ? a.x - b.x : a.y - b.y);

  // Gap = average space between consecutive items along the main axis.
  let gaps = [];
  for (let i = 1; i < boxes.length; i++) {
    const prev = boxes[i - 1], cur = boxes[i];
    gaps.push(horizontal ? cur.x - (prev.x + prev.w) : cur.y - (prev.y + prev.h));
  }
  const gap = gaps.length ? Math.max(0, Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)) : 16;

  // Padding from the frame edges to the children bounding box.
  const minX = Math.min(...boxes.map(b => b.x));
  const minY = Math.min(...boxes.map(b => b.y));
  const maxX = Math.max(...boxes.map(b => b.x + b.w));
  const maxY = Math.max(...boxes.map(b => b.y + b.h));
  const fw = frame.w || maxX, fh = frame.h || maxY;
  const padding = {
    t: Math.max(0, Math.round(minY)),
    r: Math.max(0, Math.round(fw - maxX)),
    b: Math.max(0, Math.round(fh - maxY)),
    l: Math.max(0, Math.round(minX)),
  };

  // Primary-axis distribution: if the items leave a lot of empty space between
  // them (and little inside the edges), treat it as "space between".
  const contentMain = boxes.reduce((s, b) => s + (horizontal ? b.w : b.h), 0);
  const mainSize = horizontal ? fw : fh;
  const padMain = horizontal ? padding.l + padding.r : padding.t + padding.b;
  const freeSpace = mainSize - padMain - contentMain;
  let primaryAlign = frame.primaryAlign || 'start';
  let finalGap = gap;
  if (boxes.length >= 2 && freeSpace > contentMain * 0.4 && gap > 24) {
    primaryAlign = 'space-between';
    finalGap = 16; // gap is implied by distribution; keep a sensible fallback
  }

  // Cross-axis alignment: are items centered / end-aligned across the frame?
  const crossStart = horizontal ? minY : minX;
  const crossEnd = horizontal ? (fh - maxY) : (fw - maxX);
  let counterAlign = 'start';
  if (Math.abs(crossStart - crossEnd) <= 4) counterAlign = 'center';
  else if (crossEnd < crossStart) counterAlign = 'end';

  // Apply.
  frame.layout = horizontal ? 'horizontal' : 'vertical';
  frame.gap = finalGap;
  frame.padding = padding;
  frame.primaryAlign = primaryAlign;
  frame.counterAlign = counterAlign;
  // Reorder children to match the detected sequence and drop free coordinates.
  frame.children = boxes.map(b => { delete b.n.x; delete b.n.y; return b.n; });
  // Let the frame hug its content vertically when it was a column.
  if (!horizontal && frame.heightMode === 'fixed') frame.heightMode = 'hug';

  render();
  toast(`Auto layout: ${frame.layout}${primaryAlign === 'space-between' ? ' · space-between' : ' · gap ' + finalGap}`);
}

/* =====================================================================
   GROUP / UNGROUP
   Group = wrap the selected siblings in a new auto-layout frame (so they
   align as a row/column). Ungroup = dissolve a frame back onto its parent.
   ===================================================================== */
// Measure a node's box in scene coordinates using the live DOM.
function sceneRectOf(id) {
  const el = nodeEl(id); if (!el) return null;
  const r = el.getBoundingClientRect();
  const tl = toScene(r.left, r.top);
  return { x: tl.x, y: tl.y, w: r.width / view.zoom, h: r.height / view.zoom };
}
function groupSelection(mode = 'auto') {
  const ids = [...selection];
  if (ids.length < 2) { toast('Select 2+ elements to group'); return; }
  // Only group siblings sharing one parent (use the first node's parent).
  const parent = findParent(ids[0]);
  const nodes = ids.map(id => findNode(id)).filter(n => n && findParent(n.id) === parent);
  if (nodes.length < 2) { toast('Select elements in the same container'); return; }

  // Measure each node in scene coords; compute the bounding box.
  const rects = nodes.map(n => ({ n, r: sceneRectOf(n.id) })).filter(o => o.r);
  // Keep children in left-to-right / top-to-bottom reading order for layouts.
  rects.sort((a, b) => (a.r.y - b.r.y) || (a.r.x - b.r.x));
  const minX = Math.min(...rects.map(o => o.r.x));
  const minY = Math.min(...rects.map(o => o.r.y));
  const maxX = Math.max(...rects.map(o => o.r.x + o.r.w));
  const maxY = Math.max(...rects.map(o => o.r.y + o.r.h));

  // Parent origin in scene coords (0,0 for the canvas).
  const pr = parent === scene ? { x: 0, y: 0 } : (sceneRectOf(parent.id) || { x: 0, y: 0 });
  const group = makeNode('frame', {
    name: 'Group', layout: 'none', fill: 'transparent',
    widthMode: 'fixed', heightMode: 'fixed',
    w: Math.round(maxX - minX), h: Math.round(maxY - minY),
    x: Math.round(minX - pr.x), y: Math.round(minY - pr.y),
    padding: { t: 0, r: 0, b: 0, l: 0 },
  });
  // Move children in (positions become relative to the group box).
  rects.forEach(({ n, r }) => {
    const idx = parent.children.indexOf(n);
    if (idx >= 0) parent.children.splice(idx, 1);
    n.x = Math.round(r.x - minX); n.y = Math.round(r.y - minY);
    if (n.widthMode === 'fill') { n.widthMode = 'fixed'; n.w = Math.round(r.w); }
    if (n.heightMode === 'fill') { n.heightMode = 'fixed'; n.h = Math.round(r.h); }
    group.children.push(n);
  });
  parent.children.push(group);
  selectOnly(group.id);
  render();
  // Apply the requested layout mode.
  applyGroupMode(group, mode);
  selectOnly(group.id);
}
// Turn a freshly created group into the chosen layout style.
function applyGroupMode(group, mode) {
  if (mode === 'auto') { detectAutoLayout(group); return; }
  if (mode === 'none') {
    group.layout = 'none';
    render();
    toast('Grouped · freeform');
    return;
  }
  // Order children by reading order for predictable flow layouts.
  group.children.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  group.layout = mode;
  group.gap = group.gap ?? 16;
  group.gapX = group.gapX ?? 16;
  group.gapY = group.gapY ?? 16;
  group.primaryAlign = 'start';
  group.counterAlign = 'start';
  group.padding = group.padding || { t: 0, r: 0, b: 0, l: 0 };
  if (mode === 'grid') group.cols = group.cols || Math.min(group.children.length, Math.ceil(Math.sqrt(group.children.length)));
  // Children flow now — drop absolute coordinates and fixed sizes that fight flow.
  group.children.forEach(n => { delete n.x; delete n.y; });
  if (mode === 'vertical' && group.heightMode === 'fixed') group.heightMode = 'hug';
  if (mode === 'wrap' && group.heightMode === 'fixed') group.heightMode = 'hug';
  render();
  toast('Grouped · ' + mode);
}

function ungroupSelection() {
  const ids = [...selection];
  const frames = ids.map(id => findNode(id)).filter(n => n && n.type === 'frame' && n.children && n.children.length);
  if (!frames.length) { toast('Select a group/frame to ungroup'); return; }
  const newSel = [];
  frames.forEach(frame => {
    const parent = findParent(frame.id);
    if (!parent) return;
    const parentOrigin = parent === scene ? { x: 0, y: 0 } : (sceneRectOf(parent.id) || { x: 0, y: 0 });
    const kids = [...frame.children];
    // Measure children before removing the frame from the tree.
    const measured = kids.map(k => ({ k, r: sceneRectOf(k.id) }));
    const at = parent.children.indexOf(frame);
    parent.children.splice(at, 1);
    measured.forEach(({ k, r }, i) => {
      if (r) {
        k.x = Math.round(r.x - parentOrigin.x); k.y = Math.round(r.y - parentOrigin.y);
        if (k.widthMode === 'fill') { k.widthMode = 'fixed'; k.w = Math.round(r.w); }
        if (k.heightMode === 'fill') { k.heightMode = 'fixed'; k.h = Math.round(r.h); }
      }
      parent.children.splice(at + i, 0, k);
      newSel.push(k.id);
    });
  });
  selection = new Set(newSel);
  render();
  toast('Ungrouped');
}

/* =====================================================================
   COPY / CUT / PASTE  (in-editor clipboard of whole nodes)
   ===================================================================== */
let _clipboard = [];   // array of detached node copies
function copySelection() {
  if (!selection.size) return;
  // store top-level selected nodes in document order
  _clipboard = [];
  walkOrdered(scene, n => { if (selection.has(n.id)) _clipboard.push(cloneNode(n)); });
  toast(`Copied ${_clipboard.length} item${_clipboard.length > 1 ? 's' : ''}`);
}
function cutSelection() {
  if (!selection.size) return;
  copySelection();
  deleteSelection();
}
function pasteClipboard() {
  if (!_clipboard.length) return;
  // Decide the target parent: the frame under the cursor (joins its layout),
  // otherwise the parent of the first copied node, otherwise the canvas.
  let parent = null, atCanvas = false, scenePt = null;
  if (_lastPointer) {
    scenePt = toScene(_lastPointer.x, _lastPointer.y);
    parent = frameAtClient(_lastPointer.x, _lastPointer.y);
  }
  if (!parent) { parent = scene; atCanvas = true; }
  const newIds = [];
  _clipboard.forEach(src => {
    const copy = cloneNode(src);
    if (parent === scene) {
      // free canvas — drop near the cursor, else offset from original
      if (scenePt) { copy.x = Math.round(scenePt.x); copy.y = Math.round(scenePt.y); }
      else { copy.x = (copy.x || 0) + 24; copy.y = (copy.y || 0) + 24; }
      scene.children.push(copy);
    } else if (isAutoLayout(parent)) {
      // auto-layout frame positions children automatically
      parent.children = parent.children || [];
      parent.children.push(copy);
    } else {
      // free frame — place relative to the cursor inside it
      parent.children = parent.children || [];
      if (scenePt) { copy.x = Math.round(scenePt.x - parent.x); copy.y = Math.round(scenePt.y - parent.y); }
      else { copy.x = (copy.x || 0) + 24; copy.y = (copy.y || 0) + 24; }
      parent.children.push(copy);
    }
    newIds.push(copy.id);
  });
  selection = new Set(newIds);
  render();
  toast(`Pasted ${newIds.length} item${newIds.length > 1 ? 's' : ''}`);
}
// Walk the tree in render order, calling fn on every node.
function walkOrdered(root, fn) {
  (root.children || []).forEach(n => { fn(n); walkOrdered(n, fn); });
}
// Find the deepest frame whose box contains the given client point.
function frameAtClient(clientX, clientY) {
  const stack = els.scene.querySelectorAll('.node.type-frame');
  let best = null, bestArea = Infinity;
  stack.forEach(el => {
    const r = el.getBoundingClientRect();
    if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
      const area = r.width * r.height;
      if (area < bestArea) { bestArea = area; best = findNode(el.dataset.id); }
    }
  });
  return best;
}

/* =====================================================================
   TOOLS & TOOLBAR
   ===================================================================== */
function setTool(t) {
  activeTool = t;
  const shapeTools = ['rect', 'ellipse', 'triangle', 'line', 'arrow'];
  $$('.tool').forEach(b => {
    const on = b.dataset.tool === t || (b.dataset.tool === 'rect' && shapeTools.includes(t));
    b.classList.toggle('active', on);
  });
  els.viewport.classList.toggle('tool-draw', t !== 'move');
}
// Image tool opens a small menu so the user can choose how to add an image.
function toggleImageToolMenu(force) {
  const menu = $('#imageToolMenu');
  if (!menu) return;
  const show = force !== undefined ? force : menu.hidden;
  menu.hidden = !show;
}
// Shapes tool opens a flyout to pick which shape to draw.
function toggleShapeMenu(force) {
  const menu = $('#shapeToolMenu');
  if (!menu) return;
  const show = force !== undefined ? force : menu.hidden;
  menu.hidden = !show;
}
$$('.tool').forEach(b => b.addEventListener('click', e => {
  if (b.dataset.tool === 'image') {
    e.stopPropagation();
    toggleShapeMenu(false);
    toggleImageToolMenu();          // ask the user what they want to do
    return;
  }
  if (b.dataset.tool === 'rect') {
    e.stopPropagation();
    toggleImageToolMenu(false);
    toggleShapeMenu();              // pick a shape
    return;
  }
  toggleImageToolMenu(false);
  toggleShapeMenu(false);
  setTool(b.dataset.tool);
}));
// Shape menu choices
$$('#shapeToolMenu .shape-item').forEach(item => item.addEventListener('click', e => {
  e.stopPropagation();
  const shape = item.dataset.shape;
  $$('#shapeToolMenu .shape-item').forEach(s => s.classList.toggle('active', s === item));
  // Reflect the chosen shape's icon on the toolbar button.
  const btn = $('.tool[data-tool="rect"]');
  if (btn) { btn.innerHTML = item.querySelector('svg').outerHTML; btn.title = item.querySelector('span').textContent + ' (R)'; }
  toggleShapeMenu(false);
  setTool(shape);
}));
// Menu choices
$('#imgImportItem').addEventListener('click', e => {
  e.stopPropagation();
  toggleImageToolMenu(false);
  setTool('move');
  pickImageFor(null);               // import from computer
});
$('#imgDrawItem').addEventListener('click', e => {
  e.stopPropagation();
  toggleImageToolMenu(false);
  setTool('image');                 // old behavior: draw a placeholder on canvas
});
// Close the image-tool menu on outside click / Escape
document.addEventListener('click', () => { toggleImageToolMenu(false); toggleShapeMenu(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { toggleImageToolMenu(false); toggleShapeMenu(false); } });
$('#addRootFrame').onclick = () => {
  const f = makeNode('frame');
  // Center the new frame in the currently visible viewport. Use true client
  // coordinates (rect.left/top + half size) so it lands on-screen regardless
  // of window size — passing bare width/2 placed it off-screen in some hosts.
  const r = els.viewport.getBoundingClientRect();
  const c = toScene(r.left + r.width / 2, r.top + r.height / 2);
  f.x = Math.round(c.x - f.w / 2); f.y = Math.round(c.y - f.h / 2);
  scene.children.push(f); selectOnly(f.id); render();
};

/* =====================================================================
   KEYBOARD SHORTCUTS
   ===================================================================== */
window.addEventListener('keydown', e => {
  if (isEditing()) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z' && e.shiftKey) { e.preventDefault(); redo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); duplicateSelection(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'g' && e.shiftKey) { e.preventDefault(); ungroupSelection(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'g') { e.preventDefault(); groupSelection(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'c') { e.preventDefault(); copySelection(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'x') { e.preventDefault(); cutSelection(); return; }
  // Only intercept Ctrl+V for internal nodes; otherwise let the native paste
  // event run so images can still be pasted from the system clipboard.
  if ((e.ctrlKey || e.metaKey) && k === 'v' && _clipboard.length) { e.preventDefault(); pasteClipboard(); return; }
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
    let html;
    if (c.type === 'image') html = `<img src="${esc(c.src)}" alt="" style="${st};display:block;object-fit:${c.fit === 'contain' ? 'contain' : 'cover'}">`;
    else html = `<div style="${st}">${innerHTML(c)}</div>`;
    return wrapLink(c, html);
  }).join('');
}
// Wrap an exported element in an <a> when the node has a hyperlink
function wrapLink(node, html) {
  const href = (node.href || '').trim();
  if (!href) return html;
  return `<a href="${esc(href)}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit;display:inline-block">${html}</a>`;
}

/* =====================================================================
   EMAIL-SAFE EXPORT  (table-based, inline styles)
   Browser HTML uses flexbox, which Outlook/Gmail ignore. For .eml we
   convert the frame tree into nested <table>s with inline styles so it
   renders consistently across email clients.
   ===================================================================== */
function emailBg(node) {
  // Email clients can't render CSS gradients reliably — fall back to a solid.
  if (node.fillType === 'gradient') return node.gradFrom || '#0d99ff';
  return (node.fill && node.fill !== 'transparent') ? node.fill : '';
}
function emailTextStyle(node) {
  const color = node.fillType === 'gradient' ? (node.gradFrom || '#0d99ff') : node.color;
  return `margin:0;font-family:Arial,Helvetica,sans-serif;font-size:${node.fontSize}px;`
    + `font-weight:${node.fontWeight};color:${color};line-height:${node.lineHeight};`
    + `text-align:${node.textAlign};letter-spacing:${node.letterSpacing}px`;
}
function emailChild(node) {
  if (node.type === 'text') {
    return wrapLink(node, `<div style="${emailTextStyle(node)}">${esc(node.text).replace(/\n/g, '<br>')}</div>`);
  }
  if (node.type === 'button') {
    const p = node.padding || { t: 12, r: 22, b: 12, l: 22 };
    const bg = emailBg(node) || '#0d99ff';
    const href = (node.href || '#').trim() || '#';
    return `<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:separate"><tr>`
      + `<td align="center" bgcolor="${bg}" style="background:${bg};border-radius:${node.radius || 0}px;`
      + `padding:${p.t}px ${p.r}px ${p.b}px ${p.l}px">`
      + `<a href="${esc(href)}" target="_blank" style="font-family:Arial,Helvetica,sans-serif;`
      + `font-size:${node.fontSize}px;font-weight:${node.fontWeight};color:${node.color};`
      + `text-decoration:none;display:inline-block">${esc(node.text)}</a></td></tr></table>`;
  }
  if (node.type === 'image') {
    const fill = node.widthMode === 'fill';
    const wAttr = fill ? '' : ` width="${node.w}"`;
    const wStyle = fill ? 'width:100%;' : `width:${node.w}px;`;
    const img = `<img src="${esc(node.src || '')}" alt=""${wAttr} style="display:block;${wStyle}`
      + `max-width:100%;height:auto;border:0;outline:none;text-decoration:none;`
      + `border-radius:${node.radius || 0}px" />`;
    return wrapLink(node, img);
  }
  if (node.type === 'rect') {
    const bg = emailBg(node) || '#cccccc';
    const fill = node.widthMode === 'fill';
    const h = node.heightMode === 'fixed' ? node.h : 8;
    return `<table border="0" cellpadding="0" cellspacing="0" role="presentation" ${fill ? 'width="100%"' : `width="${node.w}"`} `
      + `style="${fill ? 'width:100%' : 'width:' + node.w + 'px'}"><tr>`
      + `<td height="${h}" style="height:${h}px;line-height:${h}px;font-size:0;background:${bg};`
      + `border-radius:${node.radius || 0}px">&nbsp;</td></tr></table>`;
  }
  if (node.type === 'frame') return emailFrame(node);
  return '';
}
function emailFrame(frame) {
  const p = frame.padding || { t: 0, r: 0, b: 0, l: 0 };
  const bg = emailBg(frame);
  const fixed = frame.widthMode !== 'fill';
  const widthAttr = fixed ? ` width="${frame.w}"` : ' width="100%"';
  const widthStyle = fixed ? `width:${frame.w}px;max-width:100%;` : 'width:100%;';
  const children = frame.children || [];
  const gap = frame.gap || 0;
  const horizontal = isAutoLayout(frame) && frame.layout === 'horizontal';
  let inner = '';
  if (children.length && horizontal) {
    inner = `<table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%"><tr>`
      + children.map((c, i) => `<td valign="top"${i < children.length - 1 ? ` style="padding-right:${gap}px"` : ''}>${emailChild(c)}</td>`).join('')
      + `</tr></table>`;
  } else if (children.length) {
    // vertical stack (also used for non-auto frames — absolute positions can't survive in email)
    const align = frame.counterAlign === 'center' ? 'center' : frame.counterAlign === 'end' ? 'right' : 'left';
    inner = `<table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%">`
      + children.map((c, i) => `<tr><td align="${align}"${i < children.length - 1 ? ` style="padding-bottom:${gap}px"` : ''}>${emailChild(c)}</td></tr>`).join('')
      + `</table>`;
  }
  return `<table border="0" cellpadding="0" cellspacing="0" role="presentation"${widthAttr} `
    + `style="${widthStyle}${bg ? 'background:' + bg + ';' : ''}${frame.radius ? 'border-radius:' + frame.radius + 'px;' : ''}border-collapse:separate">`
    + `<tr><td style="padding:${p.t}px ${p.r}px ${p.b}px ${p.l}px">${inner}</td></tr></table>`;
}
function exportEmailHTML() {
  const frames = scene.children.filter(n => n.type === 'frame');
  const body = frames.map(f =>
    `<table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%" style="margin:0 auto 24px">`
    + `<tr><td align="center">${emailFrame(f)}</td></tr></table>`).join('');
  return `<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head>`
    + `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta http-equiv="X-UA-Compatible" content="IE=edge"><title>Newsletter</title></head>`
    + `<body style="margin:0;padding:24px;background:#f2f2f2;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">`
    + `${body}</body></html>`;
}

$('#previewBtn').onclick = () => {
  $('#previewFrame').srcdoc = exportHTML();
  $('#previewModal').classList.add('show');
};
$('#closePreview').onclick = () => $('#previewModal').classList.remove('show');
$('#previewModal').addEventListener('click', e => { if (e.target.id === 'previewModal') e.currentTarget.classList.remove('show'); });

// ---- Export dropdown (Image / HTML / Email) -------------------------
const _exportMenu = $('#exportMenu');
function toggleExportMenu(force) {
  const open = force != null ? force : _exportMenu.hidden;
  _exportMenu.hidden = !open;
  $('#exportBtn').setAttribute('aria-expanded', String(open));
}
$('#exportBtn').onclick = e => { e.stopPropagation(); toggleExportMenu(); };
document.addEventListener('click', e => { if (!e.target.closest('.export-wrap')) toggleExportMenu(false); });
window.addEventListener('keydown', e => { if (e.key === 'Escape') toggleExportMenu(false); });

$('#exportHtmlBtn').onclick = () => {
  toggleExportMenu(false);
  const blob = new Blob([exportHTML()], { type: 'text/html' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'newsletter.html'; a.click();
  URL.revokeObjectURL(a.href); toast('Exported newsletter.html');
};
$('#exportEmailBtn').onclick = () => { toggleExportMenu(false); openInOutlook(); };
$('#exportImageBtn').onclick = () => { toggleExportMenu(false); exportImage(); };

// Rasterize the newsletter to a PNG via SVG <foreignObject> (offline, no libs).
function exportImage() {
  const frames = scene.children.filter(n => n.type === 'frame');
  if (!frames.length) { toast('Nothing to export'); return; }
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;left:-99999px;top:0';
  const holder = document.createElement('div');
  holder.setAttribute('style', 'display:inline-block;background:#f2f2f2;padding:24px;font-family:Inter,Arial,sans-serif');
  holder.innerHTML = frames.map(f =>
    `<div style="${styleFor(f, scene).replace(/left:[^;]+;?|top:[^;]+;?|position:[^;]+;?/g, '')};margin:0 auto 24px">${innerHTML(f)}</div>`
  ).join('');
  wrap.appendChild(holder); document.body.appendChild(wrap);
  const rect = holder.getBoundingClientRect();
  const w = Math.max(1, Math.ceil(rect.width)), h = Math.max(1, Math.ceil(rect.height));
  const xhtml = new XMLSerializer().serializeToString(holder);
  document.body.removeChild(wrap);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<foreignObject width="100%" height="100%">${xhtml}</foreignObject></svg>`;
  const scale = 2;
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = w * scale; canvas.height = h * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale); ctx.drawImage(img, 0, 0);
    canvas.toBlob(blob => {
      if (!blob) { toast('Image export failed'); return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = 'newsletter.png'; a.click(); URL.revokeObjectURL(a.href);
      toast('Exported newsletter.png');
    }, 'image/png');
  };
  img.onerror = () => toast('Image export failed');
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast';
  t.innerHTML = `<span class="dot"></span>${esc(msg)}`;
  $('#toastWrap').appendChild(t); setTimeout(() => t.remove(), 2600);
}

/* =====================================================================
   IMAGE IMPORT — file picker, paste, and drag-and-drop from local system
   ===================================================================== */
let _imgTarget = null;   // node whose src we are replacing (else create new)
// Accepted raster + vector image formats (by extension, as a fallback to MIME)
const IMAGE_EXT = /\.(png|jpe?g|jfif|pjpeg|svg|svgz|gif|webp|bmp|ico|cur|avif|apng|tiff?|heic|heif)$/i;
// Map a file extension to its image MIME type (used when the OS gives no type)
const EXT_MIME = {
  png: 'image/png', apng: 'image/apng', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  jfif: 'image/jpeg', pjpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', ico: 'image/x-icon', cur: 'image/x-icon', svg: 'image/svg+xml',
  svgz: 'image/svg+xml', avif: 'image/avif', tif: 'image/tiff', tiff: 'image/tiff',
  heic: 'image/heic', heif: 'image/heif'
};
function isImageFile(file) {
  if (!file) return false;
  if (file.type && file.type.startsWith('image/')) return true;
  return IMAGE_EXT.test(file.name || '');
}
function pickImageFor(node) { _imgTarget = node || null; $('#imageFile').click(); }
$('#imageFile').addEventListener('change', e => {
  const files = [...(e.target.files || [])].filter(isImageFile);
  e.target.value = '';
  if (!files.length) return;
  if (_imgTarget) {
    // Replacing an existing image — use the first file only.
    readImageFile(files[0], n => { _imgTarget.src = n.src; _imgTarget.fill = 'transparent'; if (/^data:image\/svg\+xml/i.test(n.src)) _imgTarget.fit = 'contain'; render(); selectOnly(_imgTarget.id); });
  } else {
    files.forEach(f => readImageFile(f, n => placeImageNode(n.src)));
  }
});
// Read a File/Blob → data URL (works fully offline; embeds the image).
// When the OS provides no/incorrect MIME type, coerce it from the file
// extension so the browser can decode every supported format (PNG, JPEG,
// SVG, GIF, WebP, BMP, ICO, AVIF, …).
function readImageFile(file, cb) {
  const ext = (String(file.name || '').match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
  const wantType = EXT_MIME[ext];
  const needsType = wantType && (!file.type || !file.type.startsWith('image/'));
  const blob = needsType ? file.slice(0, file.size, wantType) : file;
  const r = new FileReader();
  r.onload = () => cb({ src: r.result });
  r.onerror = () => toast('Could not read ' + (file.name || 'image'));
  r.readAsDataURL(blob);
}
// Create an image node sized to the bitmap, dropped into a frame or on the canvas
function placeImageNode(src, scenePt) {
  const img = new Image();
  const finish = (iw, ih) => {
    const maxW = 520;
    // Vector/unsized images report 0 — fall back to a sensible default box.
    const natW = iw || 400, natH = ih || 300;
    const ratio = natH / natW;
    let w = Math.min(maxW, natW); let h = Math.round(w * ratio);
    // Imported images keep a transparent backdrop so PNG/SVG transparency shows
    // through. Vector art defaults to "contain" so it isn't cropped.
    const isVector = /^data:image\/svg\+xml/i.test(src);
    const node = makeNode('image', { src, w, h, fill: 'transparent', fit: isVector ? 'contain' : 'cover' });
    // drop into a frame under the point if available
    let parent = scene, frame = null;
    if (scenePt) {
      const overEl = document.elementFromPoint(scenePt.clientX, scenePt.clientY);
      const nEl = overEl && overEl.closest('.node[data-id]');
      if (nEl) { const cand = findNode(nEl.dataset.id); frame = cand && cand.type === 'frame' ? cand : findParent(cand.id); }
    }
    if (frame && frame.type === 'frame') {
      node.widthMode = 'fill'; node.heightMode = 'fixed';
      frame.children.push(node); parent = frame;
    } else {
      const vr = els.viewport.getBoundingClientRect();
      const pt = scenePt ? toScene(scenePt.clientX, scenePt.clientY)
        : toScene(vr.left + vr.width / 2, vr.top + vr.height / 2);
      node.x = Math.round(pt.x - w / 2); node.y = Math.round(pt.y - h / 2);
      scene.children.push(node);
    }
    selectOnly(node.id); render(); toast('Image added');
  };
  img.onload = () => finish(img.naturalWidth || img.width, img.naturalHeight || img.height);
  img.onerror = () => finish(0, 0);   // still place it (e.g. some SVGs)
  img.src = src;
}
// Paste image from clipboard anywhere in the app
window.addEventListener('paste', e => {
  if (isEditing()) return;
  const items = [...(e.clipboardData && e.clipboardData.items || [])];
  const imgItem = items.find(it => it.type.startsWith('image/'));
  if (imgItem) { e.preventDefault(); readImageFile(imgItem.getAsFile(), n => placeImageNode(n.src)); }
});
// Drag image files from the OS onto the canvas
els.viewport.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
els.viewport.addEventListener('drop', e => {
  const files = e.dataTransfer && [...e.dataTransfer.files].filter(isImageFile);
  if (files && files.length) { e.preventDefault(); files.forEach(f => readImageFile(f, n => placeImageNode(n.src, { clientX: e.clientX, clientY: e.clientY }))); }
});

/* =====================================================================
   SAVE / OPEN PROJECT FILE  (.bmsnews — JSON of the whole document)
   ===================================================================== */
function serializeProject() {
  return JSON.stringify({ app: 'bms-newsletter', version: 1, savedAt: new Date().toISOString(), uid: _uid, scene }, null, 2);
}
function saveProject() {
  const blob = new Blob([serializeProject()], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'newsletter.bmsnews'; a.click(); URL.revokeObjectURL(a.href);
  toast('Project saved');
}
function loadProject(text) {
  try {
    const data = JSON.parse(text);
    const root = data.scene || (data.app ? null : data);
    if (!root || root.type !== 'scene') throw new Error('Invalid project file');
    scene = root; _uid = data.uid || _uid;
    selection.clear(); collapsed.clear();
    render(); zoomToFit(); toast('Project loaded');
  } catch (err) { toast('Could not open file: ' + err.message); }
}
$('#saveBtn').onclick = saveProject;
$('#openBtn').onclick = () => $('#openFile').click();
$('#openFile').addEventListener('change', e => {
  const file = e.target.files && e.target.files[0]; e.target.value = '';
  if (!file) return;
  const r = new FileReader(); r.onload = () => loadProject(r.result); r.readAsText(file);
});
// Ctrl+S to save, Ctrl+O to open
window.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); $('#openFile').click(); }
});

/* =====================================================================
   OUTLOOK CONNECTOR — generate a .eml the desktop client opens directly
   (mailto can't carry HTML; an .eml with a MIME HTML part can).
   ===================================================================== */
function buildEml() {
  const html = exportEmailHTML();
  const subject = (scene.children.find(n => n.type === 'frame') || {}).name || 'Newsletter';
  // base64-encode the HTML body so non-ASCII / long lines survive transport
  const b64 = base64FromUtf8(html);
  const headers = [
    'X-Unsent: 1',                     // tells Outlook to open as an editable draft
    'Date: ' + new Date().toUTCString(),
    'Subject: ' + subject,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
  ];
  // wrap base64 at 76 chars per RFC. A blank line (\r\n\r\n) separates the
  // MIME headers from the body — without it clients fail to render the part.
  const body = (b64.match(/.{1,76}/g) || []).join('\r\n');
  return headers.join('\r\n') + '\r\n\r\n' + body + '\r\n';
}
function base64FromUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = ''; bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin);
}
function openInOutlook() {
  const blob = new Blob([buildEml()], { type: 'message/rfc822' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'newsletter.eml'; a.click(); URL.revokeObjectURL(a.href);
  toast('Opening in Outlook — open the downloaded .eml');
}


/* =====================================================================
   SEED CONTENT — a starter newsletter frame to demo auto-layout
   ===================================================================== */
function seed() {
  const frame = makeNode('frame', { name: 'Newsletter', x: 0, y: 0, w: 600, layout: 'vertical', gap: 20,
    padding: { t: 40, r: 40, b: 40, l: 40 }, heightMode: 'hug', fill: '#ffffff' });
  const logo = makeNode('text', { name: 'Brand', text: 'LOREM IPSUM', fontSize: 14, fontWeight: 800, color: '#0d99ff', letterSpacing: 2, widthMode: 'hug', heightMode: 'hug' });
  const hero = makeNode('image', { name: 'Hero', src: 'https://placehold.co/520x240/0d99ff/ffffff?text=Lorem+Ipsum', widthMode: 'fill', heightMode: 'fixed', h: 220, radius: 12 });
  const h1 = makeNode('text', { name: 'Headline', text: 'Lorem ipsum dolor sit amet', fontSize: 30, fontWeight: 800, color: '#111111', widthMode: 'fill', heightMode: 'hug', lineHeight: 1.2 });
  const body = makeNode('text', { name: 'Body', text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.', fontSize: 16, fontWeight: 400, color: '#444444', widthMode: 'fill', heightMode: 'hug', lineHeight: 1.6 });
  const cta = makeNode('button', { name: 'CTA', text: 'Read more →', href: 'https://example.com', fill: '#0d99ff', color: '#ffffff', widthMode: 'hug', heightMode: 'fixed', h: 46 });
  const row = makeNode('frame', { name: 'Footer row', layout: 'horizontal', gap: 12, padding: { t: 16, r: 0, b: 0, l: 0 }, widthMode: 'fill', heightMode: 'hug', fill: 'transparent', primaryAlign: 'space-between', counterAlign: 'center' });
  row.children.push(makeNode('text', { name: 'Copyright', text: '© 2026 Lorem Ipsum', fontSize: 12, color: '#999999', widthMode: 'hug', heightMode: 'hug' }));
  row.children.push(makeNode('text', { name: 'Unsub', text: 'Unsubscribe', href: '#', fontSize: 12, color: '#0d99ff', widthMode: 'hug', heightMode: 'hug' }));
  frame.children.push(logo, hero, h1, body, cta, row);
  scene.children.push(frame);
}

/* =====================================================================
   UNDO / REDO  — history of document snapshots (JSON of the scene).
   render() auto-commits (debounced) whenever the document actually
   changes, so every edit is undoable without sprinkling calls everywhere.
   ===================================================================== */
let _history = [], _hIdx = -1, _histTimer = null, _restoring = false;
function _snap() { return JSON.stringify(scene); }
function commitHistory() {
  const snap = _snap();
  if (_hIdx >= 0 && _history[_hIdx] === snap) return;   // nothing changed
  _history = _history.slice(0, _hIdx + 1);
  _history.push(snap);
  if (_history.length > 80) _history.shift();            // cap memory
  _hIdx = _history.length - 1;
  updateHistButtons();
}
function scheduleCommit() {
  if (_restoring) return;
  clearTimeout(_histTimer);
  _histTimer = setTimeout(commitHistory, 220);
}
function restoreHist() {
  _restoring = true;
  scene = JSON.parse(_history[_hIdx]);
  selection = new Set([...selection].filter(id => findNode(id)));   // drop gone ids
  render();
  _restoring = false;
  updateHistButtons();
}
function undo() { if (_hIdx > 0) { clearTimeout(_histTimer); commitHistory(); if (_hIdx > 0) { _hIdx--; restoreHist(); } } }
function redo() { if (_hIdx < _history.length - 1) { _hIdx++; restoreHist(); } }
function updateHistButtons() {
  const u = $('#undoBtn'), r = $('#redoBtn');
  if (u) u.disabled = _hIdx <= 0;
  if (r) r.disabled = _hIdx >= _history.length - 1;
}
$('#undoBtn').onclick = undo;
$('#redoBtn').onclick = redo;

/* =====================================================================
   INIT
   ===================================================================== */
seed();
render();
zoomToFit();
commitHistory();   // seed the initial undo state

