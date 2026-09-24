import * as THREE from 'three';
import { createGameAudio } from './audio.js';
import { wind } from './materials.js';
import { applyDayNight, fmtTime, initDayNight } from './daynight.js';
import { createWorld } from './world.js';
import { addLook, dispatchGameCommand, forceSnapshot, getGameState, getGameWorldTime, getSaveData, isGameActive, isGamePaused, loadSaveData, setGamePaused, setJoystick, startGame, stopGame, updateGame } from './game/game.js';

const $ = id => document.getElementById(id);
const SAVE_KEY = 'wilderness-survival-v1';
const SETTINGS_KEY = 'wilderness-settings-v1';
const IS_TOUCH = 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
const canvas = $('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (error) {
  window.__wildernessBootError?.(`WebGL is unavailable: ${error?.message || error}`);
  throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, IS_TOUCH ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b100d);
scene.fog = new THREE.Fog(0x0b100d, 22, 315);
const camera = new THREE.PerspectiveCamera(72, 1, 0.08, 1500);
camera.rotation.order = 'YXZ';
const sun = new THREE.DirectionalLight(0xffe4ba, 2.1);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -70;
sun.shadow.camera.right = 70;
sun.shadow.camera.top = 70;
sun.shadow.camera.bottom = -70;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 220;
const hemi = new THREE.HemisphereLight(0x9eb9b1, 0x182116, 0.82);
scene.add(sun, hemi);
initDayNight(scene, sun, hemi);
if (IS_TOUCH) document.body.classList.add('touch');

const audio = createGameAudio();
const keys = new Set();
const input = { moveX: 0, moveY: 0, sprint: false, crouch: false, jump: false };
let jumpQueued = false;
let touchJumpQueued = false;
let touchCrouched = false;
let touchSprint = false;
let world = null;
let gameStarted = false;
let currentSeed = 1337;
let snapshot = null;
let modalId = null;
let dialogueOpen = false;
let titleHelpReturn = false;
let titleSettingsReturn = false;
let pointerDown = false;
let lookPointerId = null;
let lookX = 0;
let lookY = 0;
let joystickPointerId = null;
let settings = { renderDistance: 2, quality: 1, sensitivity: 0.0022, invertY: false, audio: true };
let frames = 0;
let fpsTimer = performance.now();
let fps = 0;

function loadJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value || fallback;
  } catch {
    return fallback;
  }
}
function saveJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
function readSettings() {
  const stored = loadJson(SETTINGS_KEY, {});
  settings = { ...settings, ...stored };
  const distance = Number(settings.renderDistance);
  const quality = Number(settings.quality);
  settings.renderDistance = Math.max(2, Math.min(3, Number.isFinite(distance) ? distance : 2));
  settings.quality = Math.max(0, Math.min(1, Number.isFinite(quality) ? quality : 1));
  settings.sensitivity = Math.max(0.0008, Math.min(0.006, Number(settings.sensitivity) || 0.0022));
  settings.invertY = !!settings.invertY;
  settings.audio = settings.audio !== false;
}
function readSave() {
  return loadJson(SAVE_KEY, null);
}
function seedValue(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && Math.abs(numeric) >= 1) return Math.floor(Math.abs(numeric)) >>> 0;
  const text = String(value || '1337');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0) || 1;
}
function requestLock() {
  if (!IS_TOUCH && gameStarted && snapshot?.phase === 'running' && !modalId && !dialogueOpen && document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
}
function releaseLock() {
  if (document.pointerLockElement === canvas) document.exitPointerLock?.();
}
function showToast(text, kind = '') {
  const stack = $('toast-stack');
  const toast = document.createElement('div');
  toast.className = `toast ${kind}`;
  toast.textContent = text;
  stack.appendChild(toast);
  while (stack.children.length > 4) stack.firstElementChild.remove();
  window.setTimeout(() => toast.remove(), 3600);
}
function setHidden(id, hidden) {
  const element = $(id);
  if (element) element.hidden = hidden;
}
function setBar(id, value, maximum = 100) {
  const bar = $(id);
  if (bar) bar.style.width = `${Math.max(0, Math.min(100, value / maximum * 100))}%`;
}
function setValue(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}
function itemIcon(id) {
  return { stone_axe: 'A', spear: 'S', bow: 'B', torch: 'T', bandage: '+', clean_water: 'W', dirty_water: 'W', berry: 'O', cooked_meat: 'C', raw_meat: 'C', wood: '||', stick: '/', stone: '◆', flint: '<', fiber: '~', herb: '*', resin: 'o', hide: 'H', rope: 'R', arrow: '>', campfire_kit: 'F', shelter_kit: 'S', hide_jacket: 'J', hide_boots: 'B' }[id] || '·';
}
function formatDistance(value) {
  return value < 1000 ? `${Math.round(value)} m` : `${(value / 1000).toFixed(1)} km`;
}
function updateVitals(snap) {
  setValue('val-health', Math.round(snap.player.health));
  setValue('val-hunger', Math.round(snap.player.hunger));
  setValue('val-thirst', Math.round(snap.player.thirst));
  setValue('val-stamina', Math.round(snap.player.stamina));
  setValue('val-warmth', Math.round(snap.player.warmth));
  setValue('val-temperature', `${snap.player.temperature.toFixed(1)}°C`);
  setValue('val-wetness', `${Math.round(snap.player.wetness * 100)}%`);
  setBar('bar-health', snap.player.health);
  setBar('bar-hunger', snap.player.hunger);
  setBar('bar-thirst', snap.player.thirst);
  setBar('bar-stamina', snap.player.stamina);
  setBar('bar-warmth', snap.player.warmth);
  $('bar-health').style.background = snap.player.health < 30 ? 'var(--danger)' : 'var(--moss)';
  $('bar-thirst').style.background = snap.player.thirst < 25 ? 'var(--danger)' : 'var(--moss)';
  $('bar-warmth').style.background = snap.player.warmth < 25 ? 'var(--rust)' : 'var(--moss)';
}
function updateCompass(heading) {
  const strip = $('compass-strip');
  const labels = [];
  for (let i = -4; i <= 4; i++) {
    const value = ((heading + i * 45) % 360 + 360) % 360;
    const label = value === 0 ? 'N' : value === 90 ? 'E' : value === 180 ? 'S' : value === 270 ? 'W' : ['NE', 'SE', 'SW', 'NW'][Math.floor((value + 22.5) / 90) % 4];
    labels.push(`<b style="color:${value % 90 === 0 ? 'var(--sand)' : 'var(--muted)'}">${label}</b>`);
  }
  strip.innerHTML = labels.join('<span>·</span>');
  strip.style.transform = `translateX(calc(-50% + ${(heading % 45) * -0.7}px))`;
}
function updateHotbar(snap) {
  $('hotbar').innerHTML = snap.hotbar.map(slot => `<button class="slot ${slot.selected ? 'selected' : ''}" data-hotbar="${slot.index}" aria-label="${slot.label}"><span class="slot-key">${slot.index + 1}</span><span class="slot-icon">${itemIcon(slot.id)}</span><span>${slot.label}</span><span class="slot-amount">${slot.amount || ''}</span></button>`).join('');
}
function updateInventory(snap) {
  setValue('inventory-weight', `· ${snap.weight.toFixed(1)} / ${snap.capacity} kg`);
  const consumable = id => ['bandage', 'clean_water', 'berry', 'cooked_meat', 'raw_meat'].includes(id);
  $('inventory-list').innerHTML = snap.inventory.length ? snap.inventory.map(item => `<div class="item-row"><span class="item-symbol">${itemIcon(item.id)}</span><div class="item-info"><strong>${item.label}</strong><small>${item.amount} · ${item.weight.toFixed(2)} kg</small></div><div class="item-actions">${consumable(item.id) ? `<button class="icon-btn" data-use-item="${item.id}" title="Use">+</button>` : ''}${/hide_jacket|hide_boots|stone_axe|spear|bow/.test(item.id) ? `<button class="icon-btn" data-equip-item="${item.id}" title="Equip">E</button>` : ''}<button class="icon-btn" data-drop-item="${item.id}" title="Drop">−</button></div></div>`).join('') : '<div class="empty">Your pack is empty. Look for fallen wood, stone, and living plants.</div>';
  const equipment = [['stone_axe', 'Stone axe'], ['spear', 'Stone spear'], ['bow', 'Short bow'], ['jacket', 'Hide jacket'], ['boots', 'Hide boots']];
  $('equipment-list').innerHTML = equipment.map(([id, label]) => `<div class="equipment-row"><span>${label}</span><strong>${snap.equipment[id] ? 'Readied' : snap.inventory.some(item => item.id === (id === 'jacket' ? 'hide_jacket' : id === 'boots' ? 'hide_boots' : id)) ? 'In pack' : '—'}</strong></div>`).join('');
}
function updateRecipes(snap) {
  $('recipe-list').innerHTML = snap.recipes.map(recipe => `<div class="recipe"><strong>${recipe.label}</strong><p>${Object.entries(({ rope: { fiber: 3 }, torch: { stick: 1, fiber: 2, resin: 1 }, stone_axe: { stone: 2, stick: 1, rope: 1 }, spear: { stick: 2, stone: 1, fiber: 2 }, bow: { stick: 3, fiber: 3, rope: 1 }, arrow: { stick: 1, fiber: 1, stone: 1 }, bandage: { fiber: 2, herb: 1 }, campfire_kit: { stick: 3, wood: 2, stone: 2 }, shelter_kit: { wood: 8, fiber: 6, rope: 2 }, hide_jacket: { hide: 4, fiber: 2 }, hide_boots: { hide: 3, fiber: 2 }, cooked_meat: { raw_meat: 1 }, clean_water: { dirty_water: 1 } }[recipe.id] || {})).map(([id, amount]) => `${amount} ${id.replace('_', ' ')}`).join(' · ')}${recipe.station === 'fire' ? ' · requires fire' : ''}</p><button class="btn small ${recipe.available && recipe.fireReady ? 'primary' : ''}" data-craft="${recipe.id}" ${recipe.available && recipe.fireReady ? '' : 'disabled'}>${recipe.available ? recipe.fireReady ? 'Craft' : 'Needs fire' : 'Missing materials'}</button></div>`).join('');
}
function updateJournal(snap) {
  $('objective-list').innerHTML = snap.objectives.map(objective => `<div class="objective-row ${objective.complete ? 'done' : ''}"><span class="objective-mark">${objective.complete ? '✓' : '□'}</span><span>${objective.label}</span></div>`).join('');
  const entries = [...snap.discoveries.landmarks.map(item => ({ ...item, detail: 'Landmark' })), ...snap.discoveries.wildlife.map(item => ({ ...item, detail: 'Wildlife' }))];
  $('journal-list').innerHTML = entries.length ? entries.map(item => `<div class="journal-entry"><strong>${item.label || item.type || item.id}</strong><p>${item.detail} · ${item.discoveredAt != null ? `logged day ${Math.floor(item.discoveredAt / 1200) + 1}` : 'observed'}</p></div>`).join('') : '<div class="empty">Your journal is blank. Walk beyond the familiar path.</div>';
}
function drawMap(target, snap, large = false) {
  if (!target || !snap) return;
  const ctx = target.getContext('2d');
  const width = target.width;
  const height = target.height;
  const range = large ? 620 : 170;
  const scale = width / range;
  const px = snap.player.position.x;
  const pz = snap.player.position.z;
  ctx.clearRect(0, 0, width, height);
  const gradient = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width * 0.7);
  gradient.addColorStop(0, '#263b2a');
  gradient.addColorStop(1, '#101b14');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(210,220,184,.08)';
  ctx.lineWidth = 1;
  const grid = large ? 50 : 25;
  for (let x = -(Math.floor(px / grid) * grid); x <= px + range / 2; x += grid) {
    const sx = width / 2 + (x - px) * scale;
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, height); ctx.stroke();
  }
  for (let z = -(Math.floor(pz / grid) * grid); z <= pz + range / 2; z += grid) {
    const sy = height / 2 + (z - pz) * scale;
    ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(width, sy); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(212,185,129,.28)';
  ctx.beginPath(); ctx.arc(width / 2, height / 2, Math.min(width, height) * 0.42, 0, Math.PI * 2); ctx.stroke();
  const point = (x, z) => [width / 2 + (x - px) * scale, height / 2 + (z - pz) * scale];
  for (const landmark of snap.discoveries.landmarks) {
    const [x, y] = point(landmark.x, landmark.z);
    if (x < -8 || x > width + 8 || y < -8 || y > height + 8) continue;
    ctx.fillStyle = '#8fa77c'; ctx.beginPath(); ctx.arc(x, y, large ? 5 : 3, 0, Math.PI * 2); ctx.fill();
    if (large) { ctx.fillStyle = '#cbd5bd'; ctx.font = '11px system-ui'; ctx.fillText(landmark.label || landmark.type, x + 8, y + 4); }
  }
  for (const fire of snap.structures.fires) {
    const [x, y] = point(fire.position.x, fire.position.z);
    ctx.fillStyle = fire.lit ? '#d66d43' : '#8a7250'; ctx.fillRect(x - 3, y - 3, 6, 6);
  }
  for (const shelter of snap.structures.shelters) {
    const [x, y] = point(shelter.position.x, shelter.position.z);
    ctx.strokeStyle = '#d4b981'; ctx.strokeRect(x - 4, y - 4, 8, 8);
  }
  for (const entity of snap.entities) {
    if (!entity.dead && (entity.type === 'wolf' || entity.type === 'bear')) {
      const [x, y] = point(entity.x, entity.z);
      ctx.fillStyle = '#d65c50'; ctx.beginPath(); ctx.arc(x, y, large ? 4 : 2.5, 0, Math.PI * 2); ctx.fill();
    }
  }
  const [x, y] = [width / 2, height / 2];
  ctx.save(); ctx.translate(x, y); ctx.rotate(snap.world.heading * Math.PI / 180);
  ctx.fillStyle = '#f0dfae'; ctx.beginPath(); ctx.moveTo(0, -large ? 10 : 7); ctx.lineTo(large ? -6 : -4, large ? 7 : 5); ctx.lineTo(large ? 6 : 4, large ? 7 : 5); ctx.closePath(); ctx.fill(); ctx.restore();
  if (large) {
    ctx.fillStyle = 'rgba(232,226,212,.7)'; ctx.font = '12px ui-monospace,monospace'; ctx.fillText(`${Math.round(px)}, ${Math.round(pz)}`, 12, 20);
    ctx.fillText('N', width / 2 - 4, 18);
  }
}
function updateMap(snap) {
  drawMap($('minimap'), snap, false);
  drawMap($('world-map'), snap, true);
  setValue('map-coordinates', `· ${Math.round(snap.player.position.x)}, ${Math.round(snap.player.position.z)}`);
}
function updateAction(snap) {
  const action = snap.action;
  setHidden('action', !action);
  if (!action) return;
  const percent = Math.round(Math.max(0, Math.min(1, action.progress)) * 100);
  setValue('action-name', action.type === 'build_fire' ? 'Placing campfire' : action.type === 'build_shelter' ? 'Building shelter' : 'Gathering');
  setValue('action-percent', `${percent}%`);
  $('action-progress').style.width = `${percent}%`;
}
function updateTarget(snap) {
  const interaction = $('interaction');
  if (!snap.target || snap.action) { interaction.hidden = true; return; }
  interaction.hidden = false;
  setValue('interaction-label', snap.target.label);
  setValue('interaction-verb', `${snap.target.verb} · E`);
}
function updateSnapshot(next) {
  const previousPhase = snapshot?.phase;
  snapshot = next;
  if (!gameStarted) return;
  setHidden('hud', false);
  setHidden('boot-screen', next.phase === 'loading');
  if (next.phase === 'loading') $('boot-status').textContent = 'Streaming terrain and field data';
  if (next.phase === 'running' && previousPhase !== 'running' && !modalId && !dialogueOpen) requestLock();
  updateVitals(next);
  updateCompass(next.world.heading);
  setValue('hud-time', fmtTime(next.world.hours));
  setValue('hud-weather', `${next.world.weather.label} / day ${next.world.day}`);
  setValue('hud-seed', `Seed ${currentSeed}`);
  setValue('location', next.world.biomeLabel);
  setValue('objective-text', next.activeObjective?.label || 'All field assignments complete');
  setValue('objective-count', next.objectives.filter(objective => objective.complete).length + ' / ' + next.objectives.length);
  setValue('stat-position', `${Math.round(next.player.position.x)}, ${Math.round(next.player.position.z)}`);
  setValue('stat-distance', formatDistance(next.stats.distanceTravelled));
  setValue('stat-discovered', next.discoveries.landmarks.length + next.discoveries.wildlife.length);
  updateHotbar(next);
  updateTarget(next);
  updateAction(next);
  updateInventory(next);
  updateRecipes(next);
  updateJournal(next);
  updateMap(next);
  $('reticle').classList.toggle('hit', next.feedback.hitMarker > 0);
  $('damage-flash').style.opacity = String(Math.min(1, next.feedback.hurtFlash * 1.8));
  $('low-health').style.opacity = next.player.health < 30 ? String((30 - next.player.health) / 30 * 0.65) : '0';
  setHidden('death-screen', next.phase !== 'dead');
  if (settings.audio) {
    audio.setWeather(next.world.weather.kind, next.world.weather.intensity, next.world.weather.windSpeed);
    audio.setUnderwater(next.player.inWater);
  }
}
function handleEvent(event) {
  if (event.type === 'toast') showToast(event.text, event.text?.toLowerCase().includes('danger') || event.text?.toLowerCase().includes('sick') ? 'warn' : '');
  else if (event.type === 'damage') {
    if (settings.audio) audio.play('damage');
  } else if (event.type === 'hit') {
    if (settings.audio) audio.play('hit');
  } else if (event.type === 'sound') {
    if (settings.audio) audio.play(event.name);
  } else if (event.type === 'footstep') {
    if (settings.audio && event.sprinting) audio.play('step');
  } else if (event.type === 'objective' || event.type === 'discover') {
    if (settings.audio) audio.play(event.type === 'objective' ? 'objective' : 'discover');
  } else if (event.type === 'save') {
    saveGame();
  } else if (event.type === 'death') {
    releaseLock();
  } else if (event.type === 'dialogue') {
    if (event.npcId) {
      dialogueOpen = true;
      setHidden('dialogue-screen', false);
      setValue('dialogue-name', event.name);
      setValue('dialogue-role', event.role);
      setValue('dialogue-text', event.text);
      setGamePaused(true);
      releaseLock();
    } else {
      closeDialogue();
    }
  }
}
function closeDialogue() {
  dialogueOpen = false;
  setHidden('dialogue-screen', true);
  if (gameStarted && !modalId) {
    setGamePaused(false);
    requestLock();
  }
}
function saveGame(showMessage = false) {
  if (!gameStarted || !isGameActive()) return false;
  const data = getSaveData();
  const saved = saveJson(SAVE_KEY, data);
  if (saved && showMessage) showToast('Expedition saved locally.', 'good');
  if (saved) {
    $('btn-continue').disabled = false;
    $('title-save-note').textContent = `Saved ${new Date(data.savedAt).toLocaleString()}`;
  }
  return saved;
}
function disposeWorld() {
  stopGame();
  if (world) world.dispose();
  world = null;
}
function createPreview() {
  world = createWorld(scene, currentSeed, { renderRadius: 0, detail: 0 });
  const spawn = world.spawn;
  camera.position.set(spawn.x, spawn.y + 1.68, spawn.z);
  camera.lookAt(spawn.x + 8, spawn.y + 1.2, spawn.z - 8);
  snapshot = null;
}
function startNew(seed) {
  audio.unlock();
  disposeWorld();
  currentSeed = seedValue(seed);
  world = createWorld(scene, currentSeed, { renderRadius: settings.renderDistance, detail: settings.quality });
  startGame(scene, camera, world, { onUpdate: updateSnapshot, onEvent: handleEvent });
  gameStarted = true;
  dialogueOpen = false;
  titleHelpReturn = false;
  titleSettingsReturn = false;
  setHidden('title-screen', true);
  setHidden('settings-screen', true);
  setHidden('help-screen', true);
  setHidden('boot-screen', false);
  $('boot-status').textContent = 'Streaming terrain and field data';
  setHidden('hud', false);
  setHidden('mobile-controls', !IS_TOUCH);
  $('seed-input').value = currentSeed;
  saveGame();
  requestLock();
}
function continueGame() {
  const data = readSave();
  if (!data?.state) { showToast('No saved expedition found.', 'warn'); return; }
  const seed = seedValue(data.state.seed);
  audio.unlock();
  disposeWorld();
  currentSeed = seed;
  world = createWorld(scene, seed, { renderRadius: settings.renderDistance, detail: settings.quality });
  startGame(scene, camera, world, { onUpdate: updateSnapshot, onEvent: handleEvent });
  if (!loadSaveData(data)) {
    showToast('That save belongs to another world.', 'warn');
    startNew(seed);
    return;
  }
  gameStarted = true;
  titleHelpReturn = false;
  titleSettingsReturn = false;
  setHidden('title-screen', true);
  setHidden('settings-screen', true);
  setHidden('help-screen', true);
  setHidden('boot-screen', false);
  $('boot-status').textContent = 'Restoring the saved expedition';
  setHidden('mobile-controls', !IS_TOUCH);
  requestLock();
}
function returnToTitle() {
  saveGame();
  disposeWorld();
  gameStarted = false;
  dialogueOpen = false;
  modalId = null;
  setHidden('hud', true);
  setHidden('mobile-controls', true);
  setHidden('death-screen', true);
  setHidden('dialogue-screen', true);
  setHidden('inventory-screen', true);
  setHidden('pause-screen', true);
  setHidden('settings-screen', true);
  setHidden('help-screen', true);
  releaseLock();
  createPreview();
  setHidden('title-screen', false);
  $('btn-continue').disabled = !readSave();
  $('title-save-note').textContent = readSave() ? 'Expedition record available' : 'No expedition recorded';
}
function openModal(id, tab = null) {
  if (!gameStarted) return;
  modalId = id;
  setHidden('pause-screen', id !== 'pause-screen');
  setHidden('inventory-screen', id !== 'inventory-screen');
  setHidden('settings-screen', id !== 'settings-screen');
  setHidden('help-screen', id !== 'help-screen');
  if (id === 'inventory-screen' && tab) selectTab(tab);
  if (id === 'settings-screen') renderSettings($('settings-body'));
  if (id === 'pause-screen') saveGame();
  setGamePaused(true);
  releaseLock();
}
function closeModal() {
  if (dialogueOpen) return;
  modalId = null;
  for (const id of ['pause-screen', 'inventory-screen', 'settings-screen', 'help-screen']) setHidden(id, true);
  if (gameStarted) { setGamePaused(false); requestLock(); }
}
function selectTab(name) {
  for (const tab of document.querySelectorAll('.tab')) tab.classList.toggle('active', tab.dataset.tab === name);
  for (const panel of document.querySelectorAll('.tab-panel')) panel.classList.toggle('active', panel.id === `panel-${name}`);
  if (name === 'settings') renderSettings($('settings-content'));
}
function renderSettings(container) {
  container.innerHTML = `<div class="setting-row"><label>World detail<small>Higher detail loads more terrain, plants, and resources.</small></label><select data-setting="quality"><option value="0" ${settings.quality === 0 ? 'selected' : ''}>Performance</option><option value="1" ${settings.quality === 1 ? 'selected' : ''}>Balanced</option></select></div><div class="setting-row"><label>Render distance<small>More distant chunks improve horizon visibility.</small></label><input data-setting="distance" type="range" min="2" max="3" step="1" value="${settings.renderDistance}" /></div><div class="setting-row"><label>Mouse sensitivity</label><input data-setting="sensitivity" type="range" min="0.0008" max="0.006" step="0.0002" value="${settings.sensitivity}" /></div><div class="setting-row"><label>Invert vertical look</label><button data-setting="invert" class="toggle ${settings.invertY ? 'on' : ''}" aria-label="Toggle invert vertical look"></button></div><div class="setting-row"><label>Procedural audio<small>Wind, weather, and field cues.</small></label><button data-setting="audio" class="toggle ${settings.audio ? 'on' : ''}" aria-label="Toggle audio"></button></div>`;
  container.querySelector('[data-setting="quality"]').onchange = event => { settings.quality = Number(event.target.value); if (world) world.detail = settings.quality; saveJson(SETTINGS_KEY, settings); };
  container.querySelector('[data-setting="distance"]').oninput = event => { settings.renderDistance = Number(event.target.value); if (world) world.renderRadius = settings.renderDistance; saveJson(SETTINGS_KEY, settings); };
  container.querySelector('[data-setting="sensitivity"]').oninput = event => { settings.sensitivity = Number(event.target.value); saveJson(SETTINGS_KEY, settings); };
  container.querySelector('[data-setting="invert"]').onclick = () => { settings.invertY = !settings.invertY; renderSettings(container); saveJson(SETTINGS_KEY, settings); };
  container.querySelector('[data-setting="audio"]').onclick = () => { settings.audio = !settings.audio; if (!settings.audio) audio.dispose(); else audio.unlock(); renderSettings(container); saveJson(SETTINGS_KEY, settings); };
}
function showTitleSettings() { titleSettingsReturn = true; setHidden('settings-screen', false); renderSettings($('settings-body')); }
function showTitleHelp() { titleHelpReturn = true; setHidden('help-screen', false); }
function closeTitleSettings() { setHidden('settings-screen', true); titleSettingsReturn = false; }
function closeTitleHelp() { setHidden('help-screen', true); titleHelpReturn = false; }
function updateInput() {
  input.moveX = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  input.moveY = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  input.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight') || touchSprint;
  input.crouch = keys.has('ControlLeft') || keys.has('ControlRight') || touchCrouched;
  input.jump = jumpQueued || touchJumpQueued;
  jumpQueued = false;
  touchJumpQueued = false;
}
function handleKeyDown(event) {
  const tag = event.target?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (event.code === 'Escape') {
    if (dialogueOpen) { closeDialogue(); return; }
    if (modalId) { closeModal(); return; }
    if (gameStarted) openModal('pause-screen');
    return;
  }
  if (dialogueOpen) return;
  if (!gameStarted || snapshot?.phase !== 'running') return;
  if (event.code === 'Tab') { event.preventDefault(); openModal('inventory-screen', 'inventory'); return; }
  if (event.code === 'KeyM') { event.preventDefault(); openModal('inventory-screen', 'map'); return; }
  if (event.code === 'KeyC') { event.preventDefault(); openModal('inventory-screen', 'craft'); return; }
  if (event.code === 'KeyJ') { event.preventDefault(); openModal('inventory-screen', 'journal'); return; }
  if (event.code === 'KeyE') { dispatchGameCommand('interact'); return; }
  if (event.code === 'KeyF') { dispatchGameCommand('place'); return; }
  if (event.code === 'Space') { event.preventDefault(); jumpQueued = true; return; }
  if (/^Digit[1-8]$/.test(event.code)) { dispatchGameCommand('hotbar', Number(event.code.slice(5)) - 1); return; }
  keys.add(event.code);
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
}
function handleKeyUp(event) { keys.delete(event.code); }
function handleMouseMove(event) {
  if (document.pointerLockElement !== canvas || !gameStarted) return;
  addLook(event.movementX, settings.invertY ? -event.movementY : event.movementY, settings.sensitivity);
}
function handleCanvasDown(event) {
  if (!gameStarted || modalId || dialogueOpen) return;
  if (event.pointerType === 'touch') return;
  if (event.button === 0) dispatchGameCommand('attack');
  if (event.button === 2) dispatchGameCommand('use');
}
function setupTouch() {
  const stick = $('stick');
  const nub = $('nub');
  const updateStick = event => {
    const rect = stick.getBoundingClientRect();
    let x = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    let y = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
    const length = Math.hypot(x, y) || 1;
    if (length > 1) { x /= length; y /= length; }
    setJoystick(x, y);
    nub.style.transform = `translate(calc(-50% + ${x * 34}px), calc(-50% + ${y * 34}px))`;
  };
  stick.addEventListener('pointerdown', event => { joystickPointerId = event.pointerId; stick.setPointerCapture(event.pointerId); updateStick(event); });
  stick.addEventListener('pointermove', event => { if (event.pointerId === joystickPointerId) updateStick(event); });
  const endStick = event => { if (event.pointerId === joystickPointerId) { joystickPointerId = null; setJoystick(0, 0); nub.style.transform = 'translate(-50%,-50%)'; } };
  stick.addEventListener('pointerup', endStick); stick.addEventListener('pointercancel', endStick);
  const pad = $('look-pad');
  pad.addEventListener('pointerdown', event => { lookPointerId = event.pointerId; lookX = event.clientX; lookY = event.clientY; pad.setPointerCapture(event.pointerId); });
  pad.addEventListener('pointermove', event => { if (event.pointerId !== lookPointerId) return; addLook(event.clientX - lookX, (settings.invertY ? -1 : 1) * (event.clientY - lookY), settings.sensitivity * 1.15); lookX = event.clientX; lookY = event.clientY; });
  const endLook = event => { if (event.pointerId === lookPointerId) lookPointerId = null; };
  pad.addEventListener('pointerup', endLook); pad.addEventListener('pointercancel', endLook);
  $('touch-interact').onclick = () => dispatchGameCommand('interact');
  $('touch-attack').onclick = () => dispatchGameCommand('attack');
  $('touch-use').onclick = () => dispatchGameCommand('use');
  $('touch-place').onclick = () => dispatchGameCommand('place');
  $('touch-jump').onclick = () => { touchJumpQueued = true; };
  $('touch-menu').onclick = () => openModal('pause-screen');
  $('touch-use').addEventListener('contextmenu', event => event.preventDefault());
  const sprintButton = document.createElement('button');
  sprintButton.id = 'touch-sprint';
  sprintButton.className = 'touch-btn';
  sprintButton.textContent = 'Run';
  sprintButton.style.cssText = 'right:151px;bottom:14px;width:48px;height:48px;font-size:9px';
  $('touch-menu').parentElement.appendChild(sprintButton);
  sprintButton.addEventListener('pointerdown', () => { touchSprint = true; });
  sprintButton.addEventListener('pointerup', () => { touchSprint = false; });
  sprintButton.addEventListener('pointercancel', () => { touchSprint = false; });
}
function bindUi() {
  $('btn-new-game').onclick = () => startNew($('seed-input').value);
  $('btn-continue').onclick = continueGame;
  $('btn-random-seed').onclick = () => { $('seed-input').value = Math.floor(1000 + Math.random() * 899999); };
  $('btn-title-help').onclick = showTitleHelp;
  $('btn-title-settings').onclick = showTitleSettings;
  $('btn-close-help').onclick = () => titleHelpReturn ? closeTitleHelp() : closeModal();
  $('btn-help-done').onclick = () => titleHelpReturn ? closeTitleHelp() : closeModal();
  $('btn-close-settings').onclick = () => titleSettingsReturn ? closeTitleSettings() : closeModal();
  $('btn-settings-done').onclick = () => titleSettingsReturn ? closeTitleSettings() : closeModal();
  $('btn-resume').onclick = closeModal;
  $('btn-pause-save').onclick = () => saveGame(true);
  $('btn-pause-pack').onclick = () => { setHidden('pause-screen', true); openModal('inventory-screen', 'inventory'); };
  $('btn-pause-map').onclick = () => { setHidden('pause-screen', true); openModal('inventory-screen', 'map'); };
  $('btn-pause-settings').onclick = () => { setHidden('pause-screen', true); openModal('settings-screen'); };
  $('btn-pause-help').onclick = () => { setHidden('pause-screen', true); openModal('help-screen'); };
  $('btn-pause-rest').onclick = () => { dispatchGameCommand('rest'); closeModal(); };
  $('btn-pause-title').onclick = returnToTitle;
  $('btn-close-inventory').onclick = closeModal;
  $('btn-inventory-use').onclick = () => dispatchGameCommand('use');
  $('btn-inventory-drop').onclick = () => dispatchGameCommand('drop', { id: snapshot?.hotbar?.[snapshot?.selectedSlot || 0]?.id, amount: 1 });
  $('btn-respawn').onclick = () => dispatchGameCommand('respawn');
  $('btn-death-title').onclick = returnToTitle;
  $('btn-close-dialogue').onclick = closeDialogue;
  for (const tab of document.querySelectorAll('.tab')) tab.onclick = () => selectTab(tab.dataset.tab);
  $('hotbar').onclick = event => { const button = event.target.closest('[data-hotbar]'); if (button) dispatchGameCommand('hotbar', Number(button.dataset.hotbar)); };
  $('inventory-list').onclick = event => {
    const use = event.target.closest('[data-use-item]');
    const equip = event.target.closest('[data-equip-item]');
    const drop = event.target.closest('[data-drop-item]');
    if (use) dispatchGameCommand('consume', use.dataset.useItem);
    if (equip) dispatchGameCommand('equip', equip.dataset.equipItem);
    if (drop) dispatchGameCommand('drop', { id: drop.dataset.dropItem, amount: 1 });
  };
  $('recipe-list').onclick = event => { const button = event.target.closest('[data-craft]'); if (button) dispatchGameCommand('craft', button.dataset.craft); };
  $('world-map').onclick = event => { const rect = $('world-map').getBoundingClientRect(); const x = (event.clientX - rect.left) / rect.width * 900; const y = (event.clientY - rect.top) / rect.height * 580; showToast(`Map reading: ${Math.round(x)}, ${Math.round(y)}`); };
  $('scene').addEventListener('contextmenu', event => event.preventDefault());
  $('scene').addEventListener('mousedown', handleCanvasDown);
  $('scene').addEventListener('click', () => { if (gameStarted && !IS_TOUCH && !modalId && !dialogueOpen) requestLock(); });
  addEventListener('keydown', handleKeyDown);
  addEventListener('keyup', handleKeyUp);
  addEventListener('mousemove', handleMouseMove);
  addEventListener('blur', () => { keys.clear(); setJoystick(0, 0); });
  addEventListener('beforeunload', () => saveGame());
  document.addEventListener('pointerlockchange', () => { if (!IS_TOUCH && gameStarted && document.pointerLockElement !== canvas && getGameState()?.phase === 'running' && !modalId && !dialogueOpen) openModal('pause-screen'); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && gameStarted && !modalId && getGameState()?.phase === 'running') openModal('pause-screen'); });
}
function resize() {
  const width = innerWidth;
  const height = innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
readSettings();
bindUi();
setupTouch();
addEventListener('resize', resize);
resize();
createPreview();
$('btn-continue').disabled = !readSave();
$('title-save-note').textContent = readSave() ? 'Expedition record available' : 'No expedition recorded';
setHidden('title-screen', false);
setHidden('boot-screen', true);
window.__wildernessBooted = true;

const clock = new THREE.Clock();
let previewTime = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  wind.time.value += dt;
  updateInput();
  if (gameStarted && isGameActive()) updateGame(dt, camera, input);
  if (world) world.update(dt, camera, gameStarted && isGameActive() ? getGameState()?.simSeconds : null);
  if (!gameStarted && world) {
    previewTime += dt;
    const spawn = world.spawn;
    const angle = previewTime * 0.012;
    camera.position.set(spawn.x + Math.cos(angle) * 7, spawn.y + 2.1, spawn.z + Math.sin(angle) * 7);
    camera.lookAt(spawn.x, spawn.y + 1.1, spawn.z);
  }
  applyDayNight(scene, gameStarted ? getGameWorldTime() : 10, camera.position);
  renderer.render(scene, camera);
  frames++;
  const now = performance.now();
  if (now - fpsTimer >= 700) {
    fps = Math.round(frames * 1000 / (now - fpsTimer));
    frames = 0;
    fpsTimer = now;
  }
});
