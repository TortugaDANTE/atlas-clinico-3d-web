import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadCaseGeometries } from './loader.js';
import { realMaterial, fresnelMaterial, wireMaterial, holoTime } from './materials.js';
import { glowTexture, ringTexture } from './textures.js';
import { drawCard, drawPill, cardTexture, SRC, normSource } from './cards.js';
import { fbm } from './noise.js';

const HOLO = 0x3fdcff;
const HOLO_SYS = { oseo: 0x9fe6ff, urinario: 0x3fdcff, vascular: 0x4d9dff, digestivo: 0x2fe0c4, muscular: 0x5db4ff, cuerpo: 0x3fdcff, hallazgos: 0xffd58a };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export class Viewer extends EventTarget {
  constructor(stage) {
    super();
    this.stage = stage;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.1;
    r.setClearColor(0x000000, 0);
    stage.appendChild(r.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 1, 5, 6000);
    this.defaultView = { pos: new THREE.Vector3(210, 120, 980), target: new THREE.Vector3(0, -5, 0) };
    this.camera.position.copy(this.defaultView.pos);
    const pm = new THREE.PMREMGenerator(r);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    const key = new THREE.DirectionalLight(0xfff4ea, 2.0); key.position.set(320, 520, 700); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9cc8ff, 1.0); rim.position.set(-500, 150, -400); this.scene.add(rim);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x24303c, 0.5));

    // Jerarquía: escena > anchorRoot (pose del ancla AR) > placeGroup (orientación/offset de colocación) > world (escala/giro) > model
    this.anchorRoot = new THREE.Group(); this.scene.add(this.anchorRoot);
    this.placeGroup = new THREE.Group(); this.anchorRoot.add(this.placeGroup);
    this.world = new THREE.Group(); this.placeGroup.add(this.world);
    this.model = new THREE.Group(); this.world.add(this.model);

    this.controls = new OrbitControls(this.camera, r.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.08, minDistance: 70, maxDistance: 2200, rotateSpeed: 0.8, zoomSpeed: 1.0, screenSpacePanning: true });
    this.controls.target.copy(this.defaultView.target);

    // plataforma (modo real) y rejilla (holográfico)
    const sc = document.createElement('canvas'); sc.width = sc.height = 256;
    const sg = sc.getContext('2d'), gr = sg.createRadialGradient(128, 128, 10, 128, 128, 128);
    gr.addColorStop(0, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); sg.fillStyle = gr; sg.fillRect(0, 0, 256, 256);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(560, 560), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = -284; this.model.add(this.shadow);
    this.grid = new THREE.GridHelper(640, 32, 0x39d7ff, 0x1a6f8a); this.grid.position.y = -284;
    this.grid.material.transparent = true; this.grid.material.opacity = 0.4; this.grid.material.depthWrite = false; this.model.add(this.grid);

    // estado
    this.mode = 'real'; this.markersOn = true; this.labelsOn = true; this.lesionsOn = true; this.seeThrough = true;
    this.isolated = null; this.selected = null; this.explodeT = 0; this.explodeTarget = 0;
    this.organs = new Map(); this.findings = []; this.tween = null; this.hover = null;
    this.rc = new THREE.Raycaster(); this.pillDist = 640; this.insets = [0, 0, 0, 0];
    this.clock = new THREE.Clock();
    this.onFrameHooks = [];
    this._bindPointer(); this._resize();
    new ResizeObserver(() => this._resize()).observe(stage);
    r.setAnimationLoop((t, frame) => this._tick(t, frame));
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  _resize() {
    const w = this.stage.clientWidth || 800, h = this.stage.clientHeight || 600;
    if (this.renderer.xr.isPresenting) return;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix(); this._applyInsets();
    this.narrow = w < 760;
  }

  // ---------- carga ----------
  async loadCase(data, base = '', fetchBuf = null) {
    this.case = data;
    const geos = await loadCaseGeometries(data, base, fetchBuf);
    for (const def of data.model.organs) this._addOrgan(def, geos[def.id]);
    for (const f of data.findings) this._addFinding(f);
    this.refresh();
    this.emit('loaded');
  }
  _addOrgan(def, geo) {
    const group = new THREE.Group(); group.name = def.id;
    const isShell = !!def.shell;
    geo.computeBoundingBox();
    const real = new THREE.Mesh(geo, isShell ? fresnelMaterial({ color: new THREE.Color(def.color), opacity: def.opacity ?? 0.16, scan: 0, base: 0.05, power: 2.4 }) : realMaterial(def));
    real.userData.organId = def.id; real.renderOrder = isShell ? (def.id === 'piel' ? 2 : 1) : 0;
    const hc = HOLO_SYS[def.system] || HOLO;
    const holo = new THREE.Mesh(geo, fresnelMaterial({ color: hc, scan: 1, base: 0.04 })); holo.renderOrder = isShell ? 2 : 1; holo.userData.organId = def.id;
    const wire = new THREE.Mesh(geo, wireMaterial(hc)); wire.renderOrder = 1;
    group.add(real, holo, wire);
    this.model.add(group);
    const center = new THREE.Vector3(); geo.boundingBox.getCenter(center);
    const o = {
      id: def.id, def, label: def.label, system: def.system, group, real, holo, wire, shell: isShell, follows: def.follows || null,
      visible: def.default_visible !== false, holoOverride: null, center, explode: new THREE.Vector3(...(def.explode_mm || [0, 0, 0])),
      pick: def.pick !== false && !isShell, baseOpacity: def.opacity ?? 1, slice_only: !!def.slice_only,
    };
    this.organs.set(o.id, o);
  }

  _addFinding(fd) {
    const host = this.organs.get(fd.organ); if (!host) { console.warn('Hallazgo sin órgano', fd); return; }
    const srcKey = normSource(fd.source), rgb = fd.priority ? '255,92,92' : SRC[srcKey].rgb;
    const f = { data: fd, id: fd.id, host, srcKey, title: fd.title, location: fd.location, note: fd.note, size_mm: fd.size_mm, hu_max: fd.hu_max, hu_mean: fd.hu_mean, size_text: fd.size_text, hu_text: fd.hu_text, priority: !!fd.priority, objs: {} };
    const pos = new THREE.Vector3(...fd.position_mm); f.pos = pos;
    const g = new THREE.Group(); host.group.add(g); f.g = g;
    // lesión 3D automática
    const dims = fd.lesion?.dims_mm || (Array.isArray(fd.size_mm) ? fd.size_mm.map(x => x / 2) : [fd.size_mm / 2, fd.size_mm / 2, fd.size_mm / 2]);
    const rmin = fd.lesion?.kind === 'lipoma' ? 0 : 1.3;
    const lg = new THREE.IcosahedronGeometry(1, 4); const p = lg.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i); const d = v.clone().normalize();
      const s = 1 + 0.18 * (fbm(d.x * 2.2 + fd.position_mm[0], d.y * 2.2, d.z * 2.2, 3) - 0.5) * 2;
      p.setXYZ(i, d.x * Math.max(dims[0], rmin) * s, d.y * Math.max(dims[1], rmin) * s, d.z * Math.max(dims[2], rmin) * s);
    }
    lg.computeVertexNormals();
    f.noLesion = fd.lesion?.kind === 'none';
    const lipoma = fd.lesion?.kind === 'lipoma';
    f.lesionReal = new THREE.Mesh(lg, new THREE.MeshPhysicalMaterial({
      color: lipoma ? 0xf1d778 : 0xf3eee0, roughness: lipoma ? 0.35 : 0.5, clearcoat: 0.5, emissive: lipoma ? 0x5a4a10 : 0xffffff, emissiveIntensity: lipoma ? 0.25 : 0.35,
      transparent: lipoma, opacity: lipoma ? 0.9 : 1 }));
    f.lesionHolo = new THREE.Mesh(lg, fresnelMaterial({ color: srcKey === 'ia' ? 0xffb547 : 0x40d6aa, scan: 0.3, base: 0.35, power: 1.5 }));
    f.lesionReal.position.copy(pos); f.lesionHolo.position.copy(pos);
    f.lesionReal.userData.findingId = f.lesionHolo.userData.findingId = f.id;
    g.add(f.lesionReal, f.lesionHolo);
    // marcador
    const big = Array.isArray(fd.size_mm) ? Math.max(...fd.size_mm) : fd.size_mm;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(rgb), transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.position.copy(pos); glow.scale.setScalar(Math.max(30, big * 1.1)); glow.renderOrder = 20; glow.userData.findingId = f.id;
    const ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture(rgb), transparent: true, depthTest: false, depthWrite: false, opacity: 0.9 }));
    ring.position.copy(pos); ring.scale.setScalar(Math.max(22, big * 0.8)); ring.renderOrder = 21; ring.userData.findingId = f.id;
    f.glow = glow; f.ring = ring; f.ringBase = ring.scale.x; f.glowBase = glow.scale.x;
    // tarjeta + línea guía
    const off = new THREE.Vector3(...(fd.callout?.offset_mm || [100, 40, 40]));
    f.anchor = pos.clone().add(off); f.anchor0 = f.anchor.clone(); f.off = off;
    const lineGeo = new THREE.BufferGeometry().setFromPoints([pos, f.anchor]);
    f.line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(`rgb(${rgb})`), transparent: true, opacity: 0.85, depthTest: false }));
    f.line.renderOrder = 22;
    f.card = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false }));
    f.card.renderOrder = 30; f.card.center.set(off.x >= 0 ? 0 : 1, 0.5); f.card.position.copy(f.anchor); f.card.userData.findingId = f.id;
    g.add(glow, ring, f.line, f.card);
    this.findings.push(f); this._drawCard(f);
  }
  _variant(f) {
    if (this.selected === f.id) return 'expanded';
    if (this.renderer.xr.isPresenting || this.isolated) return 'compact';
    if (this.selected) return 'pill';
    return this.camera.position.distanceTo(this.controls.target) < this.pillDist ? 'compact' : 'pill';
  }
  _drawCard(f) {
    const v = this._variant(f), holo = this.mode === 'holo'; f.variant = v; f.variantMode = this.mode;
    const c = v === 'pill' ? drawPill(f, { holo }) : drawCard(f, { expanded: v === 'expanded', holo, organLabel: f.host.label });
    if (f.card.material.map) f.card.material.map.dispose();
    f.card.material.map = cardTexture(c); f.card.material.needsUpdate = true;
    const w = v === 'expanded' ? 190 : v === 'compact' ? 150 : 92; f.card.scale.set(w, w * c.height / c.width, 1);
  }
  // Reparte las tarjetas (no pastillas) en columnas a cada lado para que no se encimen
  _layoutCards() {
    const vis = this.findings.filter(f => f.card.visible);
    for (const f of this.findings) if (!f.card.visible) this._placeCard(f, f.anchor0.y);
    for (const side of [-1, 1]) {
      const g = vis.filter(f => Math.sign(f.off.x || 1) === side).sort((a, b) => b.pos.y - a.pos.y);
      if (!g.length) continue;
      const hs = g.map(f => f.card.scale.y), gap = 6, total = hs.reduce((a, b) => a + b, 0) + gap * (g.length - 1);
      const mean = g.reduce((a, f) => a + f.pos.y, 0) / g.length;
      let top = mean + total / 2;
      g.forEach((f, i) => { this._placeCard(f, top - hs[i] / 2); top -= hs[i] + gap; });
    }
  }
  _placeCard(f, y) {
    f.anchor.y = y; f.card.position.copy(f.anchor);
    const a = f.line.geometry.attributes.position; a.setXYZ(1, f.anchor.x, f.anchor.y, f.anchor.z); a.needsUpdate = true;
  }
  // márgenes de interfaz (px): desplaza el centro de la vista al espacio libre entre paneles
  setInsets(l, r, t = 0, b = 0) { this.insets = [l, r, t, b]; this._applyInsets(); }
  _applyInsets() {
    const w = this.stage.clientWidth, h = this.stage.clientHeight, [l, r, t, b] = this.insets || [0, 0, 0, 0];
    if (!w || this.renderer.xr.isPresenting) return;
    this.camera.setViewOffset(w, h, -(l - r) / 2, -(t - b) / 2, w, h); this.camera.updateProjectionMatrix();
  }

  // ---------- estado visible ----------
  inIso(o) { return !!this.isolated && (o.id === this.isolated || o.follows === this.isolated); }
  organVisible(o) {
    if (o.slice_only) return false;
    let v = o.visible; if (o.follows) { const p = this.organs.get(o.follows); v = v && p.visible; }
    return v;
  }
  isHolo(o) { return o.holoOverride ?? (this.mode === 'holo'); }
  refresh() {
    const holoG = this.mode === 'holo';
    for (const o of this.organs.values()) {
      const vis = this.organVisible(o), iso = !!this.isolated, mine = this.inIso(o);
      o.group.visible = vis;
      let op = 1;
      if (o.shell) op = iso ? 0 : 1; else if (iso && !mine) op = holoG ? 0.05 : 0.045;
      else if (mine && this.seeThrough && !o.follows && this._hasFindings(o)) op = holoG ? 0.5 : 0.42;
      o.opacity = op;
      const h = this.isHolo(o);
      o.real.visible = !h; o.holo.visible = h; o.wire.visible = h && !o.shell;
      if (!h) {
        if (o.shell) o.real.material.uniforms.uOpacity.value = op; else {
          const m = o.real.material; m.opacity = op; m.transparent = op < 0.999; m.depthWrite = op > 0.99; m.needsUpdate = true;
        }
      } else {
        o.holo.material.uniforms.uOpacity.value = op * (o.shell ? 0.5 : 0.8);
        o.wire.material.opacity = 0.075 * (op > 0.2 ? 1 : 0.4);
      }
      o.holo.renderOrder = (o.shell ? 2 : 1);
    }
    this.shadow.visible = !holoG && !this.isolated; this.grid.visible = holoG;
    for (const f of this.findings) {
      const hv = this.organVisible(f.host) && (!this.isolated || this.inIso(f.host));
      f.g.visible = this.organVisible(f.host) && (!this.isolated || this.inIso(f.host));
      const sel = this.selected === f.id;
      f.glow.visible = f.ring.visible = f.line.visible = this.markersOn;
      f.card.visible = (this.labelsOn || sel) && hv;
      f.line.visible = f.card.visible && this.markersOn || (sel && hv);
      f.lesionReal.visible = !f.noLesion && this.lesionsOn && !this.isHolo(f.host) && hv;
      f.lesionHolo.visible = !f.noLesion && this.lesionsOn && this.isHolo(f.host) && hv;
      f.ring.visible = f.glow.visible = this.markersOn && hv || (sel && hv);
    }
    this._layoutCards();
    this.emit('state');
  }
  _hasFindings(o) { return this.findings.some(f => f.host === o); }

  setMode(m) { this.mode = m; for (const f of this.findings) this._drawCard(f); this.refresh(); }
  setOrganVisible(id, v) { const o = this.organs.get(id); o.visible = v; if (!v && this.isolated === id) this.isolated = null; this.refresh(); }
  setSystemVisible(sys, v) { for (const o of this.organs.values()) if (o.system === sys && !o.slice_only) o.visible = v; this.refresh(); }
  setOrganHolo(id, v) { const o = this.organs.get(id); o.holoOverride = v; this.refresh(); }
  setMarkers(v) { this.markersOn = v; this.refresh(); }
  setLabels(v) { this.labelsOn = v; this.refresh(); }
  setLesions(v) { this.lesionsOn = v; this.refresh(); }
  setSeeThrough(v) { this.seeThrough = v; this.refresh(); }
  setExplode(t) { this.explodeTarget = clamp(t, 0, 1); }
  isolate(id) {
    if (id) { const o = this.organs.get(id); if (!o || o.shell) return; o.visible = true; if (o.follows) { this.organs.get(o.follows).visible = true; } }
    this.isolated = id || null;
    if (id) { const root = this.organs.get(id).follows || id; this.isolated = root; this.organs.get(root).visible = true; }
    this.refresh();
  }
  select(id) {
    const prev = this.selected; this.selected = id;
    for (const f of this.findings) if (f.id === prev || f.id === id) this._drawCard(f);
    this.refresh(); this.emit('select', id);
  }
  showAll() { for (const o of this.organs.values()) { o.visible = o.def.default_visible !== false; o.holoOverride = null; } this.isolated = null; this.refresh(); }

  // ---------- cámara ----------
  worldCenterOf(o) { const c = o.center.clone().add(o.group.position); return c; }
  flyTo(target, dist, ms = 900, dir) {
    const cam = this.camera, from = { p: cam.position.clone(), t: this.controls.target.clone() };
    const d = dir ? dir.clone().normalize() : cam.position.clone().sub(this.controls.target).normalize();
    const toT = target.clone(), toP = toT.clone().add(d.multiplyScalar(dist));
    this.tween = { t0: performance.now(), ms, from, toP, toT };
  }
  fitDist() {
    const W = this.stage.clientWidth || 1000, H = this.stage.clientHeight || 700, [l, r, t, b] = this.insets;
    const th = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)), asp = W / H;
    const dh = (615 * H / Math.max(200, H - t - b)) / (2 * th), dw = (520 * W / Math.max(200, W - l - r)) / (2 * th * asp);
    return Math.max(dh, dw);
  }
  resetView() { this.flyTo(this.defaultView.target, this.fitDist(), 800, this.defaultView.pos.clone().sub(this.defaultView.target)); }
  initView() { const d = this.defaultView.pos.clone().sub(this.defaultView.target).normalize().multiplyScalar(this.fitDist()); this.camera.position.copy(this.defaultView.target).add(d); this.controls.update(); }
  fitRegion(wMM) {
    const W = this.stage.clientWidth || 1000, H = this.stage.clientHeight || 700, [l, r] = this.insets;
    const th = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    return Math.max(480, wMM * (W / Math.max(200, W - l - r)) / (2 * th * (W / H)));
  }
  flyToFinding(id, dist) {
    dist = dist || this.fitRegion(370);
    const f = this.findings.find(x => x.id === id); if (!f) return;
    const sh = this.explodeTarget, ex = f.host.explode.clone().multiplyScalar(sh);
    const side = Math.sign(f.off.x || 1), cardW = 195;
    const cx = (f.pos.x + f.anchor0.x + side * cardW) / 2;
    const tgt = new THREE.Vector3(cx, f.pos.y - 10, f.pos.z).add(ex);
    this.flyTo(tgt, dist, 1000, new THREE.Vector3(side * -0.12, 0.12, 1));
  }
  flyToOrgan(id) {
    const o = this.organs.get(id); if (!o) return;
    const bb = o.real.geometry.boundingBox, size = bb.getSize(new THREE.Vector3()).length();
    this.flyTo(this.worldCenterOf(o), Math.max(200, size * 1.7), 900);
  }

  // ---------- interacción ----------
  _bindPointer() {
    const el = this.renderer.domElement; let down = null;
    el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; this.tween = null; });
    el.addEventListener('pointerup', e => {
      if (!down) return; const d = Math.hypot(e.clientX - down.x, e.clientY - down.y); const t = performance.now() - down.t; down = null;
      if (d < 6 && t < 500) this._click(e);
    });
    el.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch' || e.buttons) return;
      const hit = this._pick(e); const id = hit?.organ || (hit?.finding ? '·' + hit.finding : null);
      if (id !== this.hover) { this.hover = id; el.style.cursor = id ? 'pointer' : 'grab'; this.emit('hover', { organ: hit?.organ ? this.organs.get(hit.organ) : null, x: e.clientX, y: e.clientY, finding: hit?.finding }); }
      else if (id) this.emit('hover', { organ: hit?.organ ? this.organs.get(hit.organ) : null, x: e.clientX, y: e.clientY, finding: hit?.finding });
    });
    el.addEventListener('pointerleave', () => this.emit('hover', { organ: null }));
    el.addEventListener('dblclick', () => this.resetView());
  }
  _pick(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.rc.setFromCamera(ndc, this.camera);
    return this.pickRay();
  }
  pickRay() {
    const sprites = []; for (const f of this.findings) { if (f.card.visible) sprites.push(f.card); if (f.glow.visible) sprites.push(f.glow); }
    const hs = this.rc.intersectObjects(sprites, false);
    if (hs.length) return { finding: hs[0].object.userData.findingId };
    const meshes = []; for (const o of this.organs.values()) if (o.group.visible && o.pick && o.opacity > 0.2) meshes.push(o.real.visible ? o.real : o.holo);
    const hm = this.rc.intersectObjects(meshes, false);
    if (hm.length) return { organ: hm[0].object.userData.organId };
    return null;
  }
  _click(e) {
    const hit = this._pick(e);
    if (hit?.finding) { this.select(this.selected === hit.finding ? null : hit.finding); this.emit('findingclick', hit.finding); }
    else if (hit?.organ) { this.isolate(hit.organ); this.emit('isolate', hit.organ); }
    else if (this.isolated) { this.isolate(null); this.emit('isolate', null); }
    else if (this.selected) this.select(null);
  }

  // ---------- bucle ----------
  _tick(time, frame) {
    const dt = Math.min(0.05, this.clock.getDelta()); const t = this.clock.elapsedTime;
    holoTime.value = t;
    this.explodeT += (this.explodeTarget - this.explodeT) * Math.min(1, dt * 7);
    if (Math.abs(this.explodeT - this.explodeTarget) < 0.0005) this.explodeT = this.explodeTarget;
    for (const o of this.organs.values()) o.group.position.copy(o.explode).multiplyScalar(this.explodeT);
    const pulse = 1 + 0.14 * Math.sin(t * 3.2);
    { let ch = false; for (const f of this.findings) if (f.variant !== this._variant(f)) { this._drawCard(f); ch = true; } if (ch) this._layoutCards(); }
    for (const f of this.findings) { const s = this.selected === f.id ? 1.35 : 1; f.ring.scale.setScalar(f.ringBase * pulse * s); f.glow.scale.setScalar(f.glowBase * (1.05 + 0.1 * Math.sin(t * 3.2 + 1)) * s); }
    if (this.tween) {
      const k = clamp((performance.now() - this.tween.t0) / this.tween.ms, 0, 1), e = k * k * (3 - 2 * k);
      this.camera.position.lerpVectors(this.tween.from.p, this.tween.toP, e);
      this.controls.target.lerpVectors(this.tween.from.t, this.tween.toT, e);
      if (k >= 1) this.tween = null;
    }
    if (!this.renderer.xr.isPresenting) this.controls.update();
    for (const h of this.onFrameHooks) h(frame, time);
    this.renderer.render(this.scene, this.camera);
  }
  // utilidades de captura
  waitFrames(n = 3) { return new Promise(res => { let i = 0; const f = () => (++i >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }); }
}
