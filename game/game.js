// Game mode: "Red List Survey" — walk the forest and tag threatened trees.
//
// Uses the whole project: terrain sets walk height, forest treeRecords are
// the targets, the Red List overlay doubles as a scanner, and grass / wind /
// chunked LOD all keep running underneath.
import * as THREE from 'three';
import { forest, treeRecords, world } from '../forest.js';
import { groundHeight } from '../terrain.js';
import { isThreatened, STATUS_LABEL } from '../species.js';

export const GOAL = 10, TIME = 180;

let active = false;
let yaw = 0, pitch = 0;
const keys = new Set();
// Touch input (written by tree.js joystick / drag-look handlers).
export const joy = { x: 0, y: 0 };
export function addLook(dx, dy) {
  yaw -= dx * 0.0042;
  pitch = Math.max(-1.4, Math.min(1.4, pitch - dy * 0.0042));
}
let timeLeft = TIME, threatenedTotal = 0, hudTick = 0, ended = false;
let gen = 0; // game generation: stale endGame timeouts can't kill a newer session
const tagged = new Set(); // treeRecords indices
const markers = []; // { mesh, baseY, ph }
let sceneRef = null, onExit = null, toastT = 0;

const ray = new THREE.Raycaster();
ray.far = 40;
const markerGeo = new THREE.SphereGeometry(0.18, 12, 8);
const markerMat = new THREE.MeshBasicMaterial({ color: 0xffd92f });

export function isGameActive() { return active; }

export function toast(msg, ms = 2400) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = 1;
  clearTimeout(toastT);
  toastT = setTimeout(() => { el.style.opacity = 0; }, ms);
}

function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function updateHUD() {
  const s = document.getElementById('hud-score');
  if (s) s.textContent = `🌳 ${tagged.size}/${GOAL}`;
  const t = document.getElementById('hud-time');
  if (t) t.textContent = `⏱ ${fmtTime(timeLeft)}`;
  const sub = document.getElementById('hud-sub');
  if (sub) sub.textContent = `${threatenedTotal} threatened in this forest`;
}

export function startGame(scene, camera, exitFn) {
  sceneRef = scene;
  onExit = exitFn;
  gen++;
  active = true; ended = false;
  timeLeft = TIME;
  tagged.clear();
  for (const m of markers) scene.remove(m.mesh);
  markers.length = 0;
  threatenedTotal = treeRecords.filter(r => isThreatened(r.st)).length;
  // Spawn in the flat clearing, facing the hero tree / forest.
  yaw = 0; pitch = -0.02;
  camera.position.set(0, groundHeight(0, 8) + 1.7, 8);
  camera.rotation.order = 'YXZ';
  camera.rotation.set(pitch, yaw, 0);
  updateHUD();
}

export function stopGame() {
  active = false;
  keys.clear();
  joy.x = joy.y = 0;
  if (sceneRef) for (const m of markers) sceneRef.remove(m.mesh);
  markers.length = 0;
  tagged.clear();
}

function endGame(win) {
  if (ended) return;
  ended = true;
  active = false;
  const g = gen;
  toast(win
    ? `✅ Survey complete! ${tagged.size} threatened trees tagged.`
    : `⏱ Time! You tagged ${tagged.size}/${GOAL} threatened trees.`, 3000);
  setTimeout(() => { if (g === gen && onExit) onExit(); }, 2600);
}

// Walk controls: pointer-lock mouse look + WASD, eye 1.7m over the terrain.
addEventListener('mousemove', e => {
  if (!active || document.pointerLockElement == null) return;
  yaw -= e.movementX * 0.0025;
  pitch = Math.max(-1.4, Math.min(1.4, pitch - e.movementY * 0.0025));
});
addEventListener('keydown', e => {
  if (e.target?.tagName === 'INPUT') return;
  if (active && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const _fwd = new THREE.Vector3(), _rgt = new THREE.Vector3();

export function updateGame(dt, camera, elapsed) {
  if (!active) return;
  timeLeft -= dt;
  if (timeLeft <= 0) { timeLeft = 0; updateHUD(); endGame(false); return; }
  const run = (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? 1.8 : 1;
  let ix = ((keys.has('KeyD') || keys.has('ArrowRight')) ? 1 : 0) - ((keys.has('KeyA') || keys.has('ArrowLeft')) ? 1 : 0) + joy.x;
  let iy = ((keys.has('KeyW') || keys.has('ArrowUp')) ? 1 : 0) - ((keys.has('KeyS') || keys.has('ArrowDown')) ? 1 : 0) - joy.y;
  const m = Math.hypot(ix, iy);
  if (m > 1) { ix /= m; iy /= m; }
  const sp = 5 * run * dt;
  _fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  _rgt.set(Math.cos(yaw), 0, -Math.sin(yaw));
  const p = camera.position;
  p.addScaledVector(_fwd, sp * iy);
  p.addScaledVector(_rgt, sp * ix);
  const bound = world.r + 40;
  const r = Math.hypot(p.x, p.z);
  if (r > bound) { p.x *= bound / r; p.z *= bound / r; }
  p.y = groundHeight(p.x, p.z) + 1.7;
  camera.rotation.set(pitch, yaw, 0);
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i];
    m.mesh.position.y = m.baseY + Math.sin(elapsed * 2 + m.ph) * 0.18;
  }
  if (++hudTick % 15 === 0) updateHUD();
}

// Tag the tree under the crosshair: raycast trunks, match nearest record.
export function tagTree(camera) {
  if (!active || ended) return;
  ray.setFromCamera({ x: 0, y: 0 }, camera);
  const trunks = [];
  for (const o of forest.children) if (o.isMesh && !o.isInstancedMesh) trunks.push(o);
  const hits = ray.intersectObjects(trunks, false);
  if (!hits.length) { toast('No tree in range — walk closer.'); return; }
  const hp = hits[0].point;
  let best = -1, bestD = 4 * 4;
  for (let i = 0; i < treeRecords.length; i++) {
    const r = treeRecords[i];
    const dx = r.x - hp.x, dy = (r.y + 2) - hp.y, dz = r.z - hp.z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best < 0) { toast('No tree in range — walk closer.'); return; }
  const rec = treeRecords[best];
  if (tagged.has(best)) { toast('Already surveyed.'); return; }
  if (!isThreatened(rec.st)) {
    toast(`${STATUS_LABEL[rec.st] || rec.st} · species #${rec.species} — not threatened, keep looking.`);
    return;
  }
  tagged.add(best);
  const mesh = new THREE.Mesh(markerGeo, markerMat);
  mesh.position.set(rec.x, rec.y + 4.2, rec.z);
  sceneRef.add(mesh);
  markers.push({ mesh, baseY: rec.y + 4.2, ph: Math.random() * 6.28 });
  updateHUD();
  if (tagged.size >= GOAL) endGame(true);
  else toast(`Tagged! ${STATUS_LABEL[rec.st]} · species #${rec.species} (${tagged.size}/${GOAL})`);
}
