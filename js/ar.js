// AR sin marcadores: WebXR immersive-ar + hit-test (+ Anchors API si existe). Retícula, tocar para colocar,
// arrastrar = girar, pellizcar = escalar (y torsión de dos dedos = girar). Sin seguimiento de imágenes.
import * as THREE from 'three';

const K0 = 0.0007;               // metros por mm (modelo de ~0.37 m de alto)
const KMIN = 0.00015, KMAX = 0.003;
const YMIN_MM = 275;             // distancia del centro del modelo a su base

export class ARController {
  constructor(viewer, hud) {
    this.v = viewer; this.hud = hud; this.session = null; this.state = 'idle';
    this.k = K0; this.spin = 0; this.anchor = null; this.lastHit = null; this.mode = 'floor';
    this.hitSource = null; this.refSpace = null;
    this.reticle = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.085, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x40e0ff, transparent: true, opacity: 0.95, depthTest: false }));
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.008, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
    this.reticle.add(ring, dot); this.reticle.matrixAutoUpdate = false; this.reticle.visible = false; this.reticle.renderOrder = 100;
    this.v.scene.add(this.reticle);
    this.v.onFrameHooks.push((frame) => this.onFrame(frame));
    this._tmp = { m: new THREE.Matrix4(), p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() };
  }
  static async supported() {
    try { return !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); } catch { return false; }
  }
  setStatus(t) { const el = this.hud.querySelector('[data-ar-status]'); if (el) el.textContent = t; }

  async start() {
    const r = this.v.renderer;
    const init = { requiredFeatures: ['hit-test'], optionalFeatures: ['anchors', 'dom-overlay', 'light-estimation'], domOverlay: { root: this.hud } };
    this.session = await navigator.xr.requestSession('immersive-ar', init);
    r.xr.enabled = true; r.xr.setReferenceSpaceType('local');
    this._saved = { cam: [this.v.camera.near, this.v.camera.far], model: this.v.model.visible };
    this.v.camera.near = 0.01; this.v.camera.far = 30; this.v.camera.updateProjectionMatrix();
    await r.xr.setSession(this.session);
    this.refSpace = r.xr.getReferenceSpace();
    const vs = await this.session.requestReferenceSpace('viewer');
    this.hitSource = await this.session.requestHitTestSource({ space: vs });
    this.hasAnchors = !!this.session.enabledFeatures?.includes?.('anchors') || ('requestAnchor' in XRFrame.prototype) || ('createAnchor' in XRHitTestResult.prototype);
    // modo AR: modelo a escala real pequeña, sin fondo/rejilla
    this.v.world.scale.setScalar(this.k); this.v.controls.enabled = false; this.v.shadow.visible = false; this.v.grid.visible = false;
    this.v.refresh();
    document.body.classList.add('ar-active'); this.hud.hidden = false;
    this.state = 'placing'; this.v.world.visible = false; this.setStatus('Mueve el teléfono para detectar una superficie…');
    this.ctrl = r.xr.getController(0); this.v.scene.add(this.ctrl);
    this.ctrl.addEventListener('select', () => this.onSelect());
    this.session.addEventListener('end', () => this.stop());
    this._bindTouch();
  }
  async stop() {
    if (this.state === 'idle') return;
    this.state = 'idle'; document.body.classList.remove('ar-active'); this.hud.hidden = true;
    try { this.hitSource?.cancel(); } catch { }
    this.anchor?.delete?.(); this.anchor = null; this.hitSource = null;
    const v = this.v; v.renderer.xr.enabled = false;
    v.anchorRoot.matrix.identity(); v.anchorRoot.matrixAutoUpdate = true; v.anchorRoot.position.set(0, 0, 0); v.anchorRoot.quaternion.identity(); v.anchorRoot.scale.set(1, 1, 1);
    v.placeGroup.matrix.identity(); v.placeGroup.matrixAutoUpdate = true; v.placeGroup.position.set(0, 0, 0); v.placeGroup.quaternion.identity();
    v.world.position.set(0, 0, 0); v.world.rotation.set(0, 0, 0); v.world.scale.setScalar(1); v.world.visible = true;
    v.camera.near = this._saved.cam[0]; v.camera.far = this._saved.cam[1]; v.camera.updateProjectionMatrix();
    v.controls.enabled = true; this.reticle.visible = false; if (this.ctrl) v.scene.remove(this.ctrl);
    try { await this.session?.end(); } catch { }
    this.session = null; v._resize(); v.refresh();
  }

  // --- colocación (puro cálculo; se prueba sin dispositivo) ---
  // hit: matriz 4x4 de la pose del impacto (y = normal de la superficie); camPos: posición de la cámara (mundo)
  computePlacement(hitMatrix, camPos) {
    const m = new THREE.Matrix4().fromArray(hitMatrix.elements || hitMatrix), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    m.decompose(p, q, s);
    const n = new THREE.Vector3(0, 1, 0).applyQuaternion(q).normalize();
    const up = new THREE.Vector3(0, 1, 0), floor = Math.abs(n.y) > 0.7;
    let z;
    if (floor) { z = camPos.clone().sub(p); z.y = 0; if (z.lengthSq() < 1e-6) z.set(0, 0, 1); z.normalize(); }
    else { z = n.clone(); z.y = 0; if (z.lengthSq() < 1e-6) z.set(0, 0, 1); z.normalize(); if (z.dot(camPos.clone().sub(p)) < 0) z.negate(); }
    const x = new THREE.Vector3().crossVectors(up, z).normalize();
    const place = new THREE.Matrix4().makeBasis(x, up, z).setPosition(p);
    return { placeWorld: place, floor, normal: n };
  }
  _applyOffset() {
    // base del modelo sobre el suelo, o espalda pegada a la pared
    const w = this.v.world;
    if (this.mode === 'floor') w.position.set(0, YMIN_MM * this.k + 0.02, 0); else w.position.set(0, 0, 110 * this.k + 0.01);
  }
  async place(hitMatrix, camPos, hitResult) {
    const { placeWorld, floor } = this.computePlacement(hitMatrix, camPos);
    this.mode = floor ? 'floor' : 'wall';
    const v = this.v; v.world.visible = true;
    let anchored = false;
    if (hitResult?.createAnchor) {
      try {
        this.anchor = await hitResult.createAnchor(); anchored = !!this.anchor;
        const rel = new THREE.Matrix4().copy(new THREE.Matrix4().fromArray(hitMatrix.elements || hitMatrix)).invert().multiply(placeWorld);
        v.placeGroup.matrixAutoUpdate = false; v.placeGroup.matrix.copy(rel);
        v.anchorRoot.matrixAutoUpdate = false; v.anchorRoot.matrix.fromArray(hitMatrix.elements || hitMatrix);
      } catch (e) { console.warn('Anchors API falló, uso posición fija', e); this.anchor = null; }
    }
    if (!anchored) {
      v.anchorRoot.matrixAutoUpdate = false; v.anchorRoot.matrix.identity();
      v.placeGroup.matrixAutoUpdate = false; v.placeGroup.matrix.copy(placeWorld);
    }
    this._applyOffset(); this.state = 'placed'; this.reticle.visible = false;
    this.setStatus(anchored ? 'Anclado a la superficie · arrastra para girar, pellizca para escalar' : 'Colocado (posición fija, sin API de anclas) · arrastra para girar, pellizca para escalar');
    this.hud.classList.add('placed');
    return { anchored, floor };
  }
  reposition() { this.state = 'placing'; this.anchor?.delete?.(); this.anchor = null; this.v.anchorRoot.matrix.identity(); this.hud.classList.remove('placed'); this.setStatus('Apunta a una superficie y toca para colocar'); }

  onFrame(frame) {
    if (!frame || this.state === 'idle' || !this.hitSource) return;
    const cam = this.v.renderer.xr.getCamera();
    if (this.state === 'placing') {
      const hits = frame.getHitTestResults(this.hitSource);
      if (hits.length) {
        const pose = hits[0].getPose(this.refSpace);
        if (pose) {
          this.lastHit = hits[0]; this.reticle.visible = true; this.reticle.matrix.fromArray(pose.transform.matrix);
          this.lastHitMatrix = new THREE.Matrix4().fromArray(pose.transform.matrix);
          const camPos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
          const { placeWorld, floor } = this.computePlacement(this.lastHitMatrix, camPos);
          this.mode = floor ? 'floor' : 'wall';
          this.v.anchorRoot.matrixAutoUpdate = false; this.v.anchorRoot.matrix.identity();
          this.v.placeGroup.matrixAutoUpdate = false; this.v.placeGroup.matrix.copy(placeWorld);
          this._applyOffset(); this.v.world.visible = true;
          this.setStatus('Toca para colocar el modelo aquí');
        }
      } else { this.reticle.visible = false; this.v.world.visible = false; }
    } else if (this.state === 'placed' && this.anchor) {
      const pose = frame.getPose(this.anchor.anchorSpace, this.refSpace);
      if (pose) this.v.anchorRoot.matrix.fromArray(pose.transform.matrix);
    }
  }
  onSelect() {
    if (this.state === 'placing' && this.lastHit && this.reticle.visible) {
      const cam = this.v.renderer.xr.getCamera(), camPos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
      this.place(this.lastHitMatrix, camPos, this.lastHit);
    } else if (this.state === 'placed') {
      // tocar un marcador/etiqueta para ampliar
      const tm = new THREE.Matrix4().identity().extractRotation(this.ctrl.matrixWorld);
      this.v.rc.ray.origin.setFromMatrixPosition(this.ctrl.matrixWorld);
      this.v.rc.ray.direction.set(0, 0, -1).applyMatrix4(tm);
      this.v.rc.camera = this.v.camera;
      const hit = this.v.pickRay();
      if (hit?.finding) this.v.select(this.v.selected === hit.finding ? null : hit.finding);
    }
  }
  setScale(k) { this.k = Math.min(KMAX, Math.max(KMIN, k)); this.v.world.scale.setScalar(this.k); this._applyOffset(); }
  setSpin(a) { this.spin = a; this.v.world.rotation.y = a; }
  _bindTouch() {
    const el = this.hud; let t0 = null;
    const dist = ts => Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);
    const ang = ts => Math.atan2(ts[1].clientY - ts[0].clientY, ts[1].clientX - ts[0].clientX);
    el.addEventListener('touchstart', e => {
      if (this.state !== 'placed' || e.target.closest('.ar-ui')) return;
      t0 = { n: e.touches.length, x: e.touches[0].clientX, d: e.touches.length > 1 ? dist(e.touches) : 0, a: e.touches.length > 1 ? ang(e.touches) : 0 };
    }, { passive: true });
    el.addEventListener('touchmove', e => {
      if (!t0 || this.state !== 'placed') return;
      if (e.touches.length === 1 && t0.n === 1) { const dx = e.touches[0].clientX - t0.x; t0.x = e.touches[0].clientX; this.setSpin(this.spin + dx * 0.012); }
      else if (e.touches.length >= 2) {
        const d = dist(e.touches), a = ang(e.touches);
        if (t0.d) { this.setScale(this.k * d / t0.d); this.setSpin(this.spin - (a - t0.a)); }
        t0.d = d; t0.a = a; t0.n = 2;
      }
    }, { passive: true });
    el.addEventListener('touchend', () => { t0 = null; }, { passive: true });
  }
}
