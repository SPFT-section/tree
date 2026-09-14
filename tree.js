// Entry point: scene, UI, orbit, render loop.
// Geometry/species/forest logic lives in builder.js / species.js / forest.js.
import * as THREE from 'three';
import { wind } from './materials.js';
import { forest, treeNodes, clearForest, populateForest, world, forestRadiusFor } from './forest.js';
import { grassGroup, grassNodes, populateGrass } from './grass.js';
import { prepareTerrain, buildTerrainMesh, groundHeight } from './terrain.js';
import { startGame, stopGame, updateGame, tagTree, isGameActive, toast, GOAL, joy, addLook } from './game/game.js';
import { initDayNight, updateDayNight, dayState, fmtTime } from './daynight.js';
import { PRESETS, applyPreset, randomWorld } from './worldgen.js';
import { isThreatened } from './species.js';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const IS_TOUCH = 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
if (IS_TOUCH) document.body.classList.add('touch');
renderer.setPixelRatio(Math.min(window.devicePixelRatio ?? 1, IS_TOUCH ? 1.5 : 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1622);
scene.fog = new THREE.Fog(0x0b1622, 40, 380);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
camera.position.set(7, 4.5, 9);

const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
sun.position.set(6, 10, 4);
const hemi = new THREE.HemisphereLight(0x9fc5ff, 0x1d2b1a, 0.9);
scene.add(sun, hemi);
initDayNight(scene, sun, hemi); // sun+moon cycle, sky keys, stars
let terrainMesh = null, terrainInfo = { size: 0, seg: 0, tris: 0 }; // rebuilt each regrow
scene.add(forest, grassGroup);

let spin = true, lodOn = true, redlist = false, treeCount = 12, speciesCount = 1000;
let grassCount = 600000, grassInfo = { blades: 0, chunks: 0 };
let frames = 0, fpsT0 = performance.now(), fps = 0;

let regrowToken = 0;
async function regrow() {
  const my = ++regrowToken;
  const seed = +document.getElementById('p-seed').value;
  const depth = +document.getElementById('p-depth').value;
  const spread = +document.getElementById('p-spread').value;
  treeCount = Math.max(1, Math.min(20000, Math.floor(+document.getElementById('n-trees').value) || 1));
  speciesCount = +document.getElementById('p-species').value;
  grassCount = Math.max(0, Math.min(100000, Math.floor(+document.getElementById('p-grass').value) || 0));
  lodOn = document.getElementById('p-lod').checked;
  redlist = document.getElementById('p-redlist').checked;
  wind.strength.value = +document.getElementById('p-wind').value;
  document.getElementById('v-seed').textContent = seed;
  document.getElementById('v-depth').textContent = depth;
  document.getElementById('v-spread').textContent = spread;
  document.getElementById('v-wind').textContent = wind.strength.value.toFixed(2);
  document.getElementById('v-trees').textContent = treeCount;
  document.getElementById('v-grass').textContent = (+grassCount).toLocaleString();
  document.getElementById('n-trees').value = treeCount;
  document.getElementById('p-trees').value = Math.min(treeCount, 2000);
  document.getElementById('v-species').textContent = (+speciesCount).toLocaleString();
  if (treeCount > 200) {
    document.getElementById('stats').innerHTML = `building ${treeCount} trees…`;
    await new Promise(r => setTimeout(r, 30)); // paint before the blocking build
    if (my !== regrowToken) return; // superseded by a newer change
  }
  clearForest();
  prepareTerrain(seed, forestRadiusFor(treeCount)); // before trees/grass sample heights
  const stats = await populateForest(seed, treeCount, speciesCount, depth, spread, redlist ? 'redlist' : 'botanical',
    (p) => { document.getElementById('stats').innerHTML = `building ${treeCount} trees… chunk <b>${p.done}/${p.total}</b>`; },
    () => my !== regrowToken);
  if (my !== regrowToken || stats.cancelled) return;
  // Fresh ground even when the forest itself was refused, so the scene
  // always matches the new seed (never a treeless old world).
  if (terrainMesh) { scene.remove(terrainMesh); terrainMesh.geometry.dispose(); }
  terrainInfo = buildTerrainMesh();
  terrainMesh = terrainInfo.mesh;
  scene.add(terrainMesh);
  grassInfo = populateGrass(seed, world.r, grassCount);
  if (stats.error) {
    document.getElementById('stats').innerHTML = `Build refused: ${stats.error}`;
    return;
  }
  updateStats(seed, stats);
}

function updateStats(seed, stats) {
  const sc = stats.statusCounts;
  const threatened = Object.keys(sc).filter(isThreatened).reduce((a, k) => a + sc[k], 0);
  const q = stats.quality;
  const reqDepth = +document.getElementById('p-depth').value;
  const qNote = (q && (q.depthCap < reqDepth || q.thin < 1))
    ? ` · auto-q: depth≤${q.depthCap} · leaves ${Math.round(q.thin * 100)}%` : '';
  document.getElementById('stats').innerHTML =
    `trees: <b>${treeCount}</b> · species: <b>${stats.unique}/${(+speciesCount).toLocaleString()}</b> in use<br>` +
    `chunks: <b>${stats.chunks}</b> × <b>${stats.chunkSize || ''}</b> · triangles: <b>~${stats.totalTris.toLocaleString()}</b><br>` +
    `build: <b>${stats.buildMs != null ? stats.buildMs.toFixed(0) + 'ms' : '--'}</b> · ~<b>${stats.estMB != null ? stats.estMB.toFixed(0) + 'MB' : '--'}</b> · cache <b>${stats.cached || 0}</b> (+${stats.evictions || 0} evict)${qNote}<br>` +
    `grass: <b>${grassInfo.blades.toLocaleString()}</b> blades · <b>${grassInfo.chunks}</b> chunks<br>` +
    `terrain: <b>${Math.round(terrainInfo.size)}m</b> · <b>~${terrainInfo.tris.toLocaleString()}</b> tris<br>` +
    `Red List in view: <b>${threatened}</b> threatened · <b>${sc.NE || 0}</b> undescribed<br>` +
    `fps: <b id="fps">--</b> · draws: <b id="draws">--</b><br>` +
    `seed: <b>${seed}</b> · LOD: <b>${lodOn ? 'on' : 'off'}</b> · <b>${stats.mode}</b>`;
}

for (const id of ['p-seed', 'p-depth', 'p-spread', 'p-wind', 'p-trees', 'p-species', 'p-grass']) {
  const el = document.getElementById(id);
  let t = 0;
  el.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(regrow, (id === 'p-depth' || id === 'p-seed' || id === 'p-trees' || id === 'p-species') ? 150 : 60);
  });
}
for (const id of ['p-lod', 'p-redlist']) document.getElementById(id).addEventListener('change', regrow);
document.getElementById('p-trees').addEventListener('input', () => {
  document.getElementById('n-trees').value = document.getElementById('p-trees').value;
});
document.getElementById('n-trees').addEventListener('change', () => {
  const v = Math.max(1, Math.min(20000, Math.floor(+document.getElementById('n-trees').value) || 1));
  document.getElementById('n-trees').value = v;
  document.getElementById('p-trees').value = Math.min(v, 2000);
  regrow();
});
document.getElementById('btn-grow').onclick = () => {
  document.getElementById('p-seed').value = 1 + Math.floor(Math.random() * 9998);
  regrow();
};
// World generator presets (worldgen.js drives every control + regrow).
{
  const sel = document.getElementById('p-world');
  for (const [key, p] of Object.entries(PRESETS)) {
    const o = document.createElement('option');
    o.value = key; o.textContent = p.label;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => applyPreset(sel.value, regrow));
  document.getElementById('btn-dice').addEventListener('click', () => randomWorld(regrow));
}
document.getElementById('btn-spin').onclick = (ev) => {
  spin = !spin; ev.target.textContent = `Spin: ${spin ? 'on' : 'off'}`;
};
document.getElementById('btn-cycle').onclick = (ev) => {
  dayState.cycling = !dayState.cycling;
  ev.target.textContent = `Cycle: ${dayState.cycling ? 'on' : 'off'}`;
};
document.getElementById('p-time').addEventListener('input', (ev) => {
  dayState.time = +ev.target.value; // scrubbing pauses the cycle
  if (dayState.cycling) {
    dayState.cycling = false;
    document.getElementById('btn-cycle').textContent = 'Cycle: off';
  }
});

// Game mode: hide the panel, walk the forest, tag threatened trees.
function enterGame() {
  document.getElementById('panel').style.display = 'none';
  document.getElementById('hud').hidden = false;
  document.getElementById('cross').hidden = false;
  if (IS_TOUCH) document.getElementById('touch').hidden = false;
  document.getElementById('hint').textContent = IS_TOUCH
    ? 'survey: left stick moves · drag to look · TAG button tags the tree'
    : 'survey: click canvas to look · WASD move · Shift run · E tag tree · Esc frees mouse';
  startGame(scene, camera, exitGame);
  toast(`Tag ${GOAL} threatened trees (VU / EN / CR). Tip: Red List overlay is your scanner.`, 4000);
}
function exitGame() {
  stopGame();
  if (document.exitPointerLock) document.exitPointerLock();
  document.getElementById('panel').style.display = '';
  document.getElementById('hud').hidden = true;
  document.getElementById('cross').hidden = true;
  document.getElementById('touch').hidden = true;
  document.getElementById('hint').textContent = camMode === 'orbit'
    ? 'orbit: drag = look · wheel = zoom · free: WASD + QE · needs internet once for three.js CDN'
    : 'free: drag = look · WASD move · Q/E or Space/C up/down · Shift fast · wheel dolly · 2-finger touch = forward';
}
document.getElementById('btn-play').onclick = enterGame;
document.getElementById('btn-quit').onclick = exitGame;
document.getElementById('btn-collapse').onclick = (ev) => {
  const p = document.getElementById('panel');
  p.classList.toggle('collapsed');
  ev.target.textContent = p.classList.contains('collapsed') ? '+' : '–';
};
document.getElementById('btn-tag').addEventListener('click', () => { if (isGameActive()) tagTree(camera); });
canvas.addEventListener('click', () => {
  if (IS_TOUCH) return; // touch uses drag-look, no pointer lock
  if (isGameActive() && document.pointerLockElement !== canvas) canvas.requestPointerLock();
});
// Virtual joystick (touch game mode) -> game.js joy vector.
const stick = document.getElementById('stick'), nub = document.getElementById('nub');
let joyId = null;
function joyMove(e) {
  const r = stick.getBoundingClientRect();
  let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
  let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
  const m = Math.hypot(dx, dy) || 1;
  if (m > 1) { dx /= m; dy /= m; }
  joy.x = dx; joy.y = dy;
  nub.style.transform = `translate(calc(-50% + ${dx * 34}px), calc(-50% + ${dy * 34}px))`;
}
stick.addEventListener('pointerdown', (e) => {
  joyId = e.pointerId;
  try { stick.setPointerCapture(e.pointerId); } catch (_) {}
  joyMove(e);
});
stick.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) joyMove(e); });
const joyEnd = (e) => {
  if (e.pointerId === joyId) {
    joyId = null; joy.x = joy.y = 0;
    nub.style.transform = 'translate(-50%,-50%)';
  }
};
stick.addEventListener('pointerup', joyEnd);
stick.addEventListener('pointercancel', joyEnd);

// cameras: orbit (default) + free fly (WASD/QE, no external controls)
let theta = 0.7, phi = 1.05, radius = 11, dragging = false, px = 0, py = 0;
let camMode = 'orbit', yaw = 0, pitch = 0;
const keys = new Set();
const pointers = new Map(); // active canvas pointers (for 2-finger move on touch)
camera.rotation.order = 'YXZ';
canvas.style.touchAction = 'none';
canvas.addEventListener('pointerdown', e => {
  dragging = true; px = e.clientX; py = e.clientY;
  pointers.set(e.pointerId, true);
  if (document.activeElement?.blur) document.activeElement.blur();
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
});
function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size === 0) dragging = false;
}
addEventListener('pointerup', endPointer);
addEventListener('pointercancel', endPointer);
addEventListener('pointermove', e => {
  if (isGameActive()) {
    // touch drag-to-look (desktop uses pointer-lock mousemove in game.js)
    if (e.pointerType === 'touch' && dragging && pointers.has(e.pointerId)) {
      addLook(e.clientX - px, e.clientY - py);
      px = e.clientX; py = e.clientY;
    }
    return;
  }
  if (!dragging || !pointers.has(e.pointerId)) return;
  const dx = e.clientX - px, dy = e.clientY - py;
  px = e.clientX; py = e.clientY;
  if (camMode === 'orbit') {
    theta -= dx * 0.005; phi -= dy * 0.004;
    phi = Math.max(0.25, Math.min(1.45, phi));
  } else {
    yaw -= dx * 0.004; pitch -= dy * 0.004;
    pitch = Math.max(-1.5, Math.min(1.5, pitch));
  }
});
canvas.addEventListener('wheel', e => {
  if (isGameActive()) return;
  if (camMode === 'orbit') {
    radius = Math.max(4, Math.min(Math.max(40, world.r * 1.6), radius + e.deltaY * 0.01));
  } else {
    // dolly along view direction
    const f = new THREE.Vector3();
    camera.getWorldDirection(f);
    camera.position.addScaledVector(f, -e.deltaY * 0.01);
    clampCamPos();
  }
}, { passive: true });

function clampCamPos() {
  const minY = groundHeight(camera.position.x, camera.position.z) + 0.4;
  camera.position.y = Math.max(minY, Math.min(120, camera.position.y));
  const bound = world.r + 40;
  const r = Math.hypot(camera.position.x, camera.position.z);
  if (r > bound) {
    camera.position.x *= bound / r;
    camera.position.z *= bound / r;
  }
}

document.getElementById('btn-cam').onclick = (ev) => {
  if (camMode === 'orbit') {
    // carry current orbit pose into free look exactly
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    yaw = e.y; pitch = e.x;
    camMode = 'free';
  } else {
    camMode = 'orbit';
  }
  ev.target.textContent = `Cam: ${camMode}`;
  document.getElementById('hint').textContent = camMode === 'orbit'
    ? 'orbit: drag = look · wheel = zoom · free: WASD + QE · needs internet once for three.js CDN'
    : 'free: drag = look · WASD move · Q/E or Space/C up/down · Shift fast · wheel dolly · 2-finger touch = forward';
};

addEventListener('keydown', e => {
  // let range sliders keep their arrows/space
  if (e.target?.tagName === 'INPUT' && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) return;
  if (isGameActive() && e.code === 'KeyE') { tagTree(camera); return; }
  if (camMode === 'free' && e.code === 'Space') e.preventDefault();
  keys.add(e.code);
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const _fwd = new THREE.Vector3(), _rgt = new THREE.Vector3();
function moveFree(dt) {
  const fast = (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? 3 : 1;
  const base = 6 + world.r * 0.12; // keep pace with world size
  const sp = base * fast * dt;
  _fwd.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  _rgt.set(Math.cos(yaw), 0, -Math.sin(yaw));
  if (keys.has('KeyW') || keys.has('ArrowUp')) camera.position.addScaledVector(_fwd, sp);
  if (keys.has('KeyS') || keys.has('ArrowDown')) camera.position.addScaledVector(_fwd, -sp);
  if (keys.has('KeyD') || keys.has('ArrowRight')) camera.position.addScaledVector(_rgt, sp);
  if (keys.has('KeyA') || keys.has('ArrowLeft')) camera.position.addScaledVector(_rgt, -sp);
  if (keys.has('KeyE') || keys.has('Space')) camera.position.y += sp;
  if (keys.has('KeyQ') || keys.has('KeyC')) camera.position.y -= sp;
  if (pointers.size >= 2) camera.position.addScaledVector(_fwd, base * 0.7 * dt); // touch: 2nd finger = forward
  clampCamPos();
  camera.rotation.set(pitch, yaw, 0);
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize(); regrow();

const clock = new THREE.Clock();
let lodTick = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  wind.time.value += dt;
  updateDayNight(scene, dt, camera);
  if (isGameActive()) {
    updateGame(dt, camera, clock.elapsedTime);
  } else if (camMode === 'orbit') {
    if (spin && !dragging) theta += 0.0018;
    camera.position.set(
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi) + 1.5,
      radius * Math.sin(phi) * Math.cos(theta)
    );
    camera.lookAt(0, 2.6, 0);
  } else {
    if (!dragging) moveFree(dt);
    else moveFree(0); // still apply rotation while dragging
  }
  // Distance LOD: hide leaf cards on far chunks (now spatially compact,
  // so this toggles per area — with hysteresis to avoid flicker).
  if (++lodTick % 10 === 0) {
    const far = Math.min(60, 26 + world.r * 0.05), near = far * 0.85;
    for (const n of treeNodes) {
      if (!n.leaves) continue;
      if (!lodOn) { if (!n.leaves.visible) n.leaves.visible = true; continue; }
      const d = camera.position.distanceTo(n.pos);
      if (n.leaves.visible) { if (d > far) n.leaves.visible = false; }
      else if (d < near) n.leaves.visible = true;
    }
    // Grass is ground detail: hide far chunks (with hysteresis vs. popping).
    const gFar = Math.min(70, 30 + world.r * 0.1), gNear = gFar * 0.85;
    for (const n of grassNodes) {
      if (!n.mesh) continue;
      if (!lodOn) { if (!n.mesh.visible) n.mesh.visible = true; continue; }
      const d = camera.position.distanceTo(n.pos);
      if (n.mesh.visible) { if (d > gFar) n.mesh.visible = false; }
      else if (d < gNear) n.mesh.visible = true;
    }
  }
  renderer.render(scene, camera);
  frames++;
  const now = performance.now();
  if (now - fpsT0 >= 500) {
    fps = Math.round(frames * 1000 / (now - fpsT0));
    frames = 0; fpsT0 = now;
    const f = document.getElementById('fps');
    if (f) f.textContent = fps;
    const d = document.getElementById('draws');
    if (d) d.textContent = renderer.info.render.calls;
    const vt = document.getElementById('v-time');
    if (vt) vt.textContent = fmtTime(dayState.time);
    const pt = document.getElementById('p-time');
    if (pt && dayState.cycling && document.activeElement !== pt) pt.value = dayState.time.toFixed(1);
  }
});
