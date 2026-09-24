import * as THREE from 'three';
import { hash01, hash32, TAU, clamp, clamp01 } from '../rng.js';
import { BIOME_LABELS, BIOMES, normalAt } from '../terrain.js';
import { RESOURCE_INFO, RESOURCE_TYPES } from '../resources.js';
import { HOTBAR, ITEMS, RECIPES, addItem, canCraft, countItem, inventoryEntries, itemLabel, removeItem, totalWeight } from './items.js';

const SAVE_VERSION = 1;
const EQUIPMENT_SLOTS = Object.freeze({
  stone_axe: 'stone_axe',
  spear: 'spear',
  bow: 'bow',
  hide_jacket: 'jacket',
  hide_boots: 'boots',
});

const ANIMAL_TYPES = {
  rabbit: { health: 20, speed: 4.4, detection: 11, hostile: false, size: 0.42, color: 0x8b7964, drops: { raw_meat: 1 } },
  deer: { health: 62, speed: 5.8, detection: 16, hostile: false, size: 0.95, color: 0x76583c, drops: { raw_meat: 3, hide: 1 } },
  boar: { health: 95, speed: 4.1, detection: 11, hostile: false, size: 0.88, color: 0x4b4035, drops: { raw_meat: 3, hide: 2 } },
  wolf: { health: 64, speed: 4.8, detection: 27, hostile: true, size: 0.78, color: 0x555a58, drops: { raw_meat: 2, hide: 1 } },
  bear: { health: 185, speed: 3.8, detection: 22, hostile: true, size: 1.28, color: 0x3e332a, drops: { raw_meat: 5, hide: 3 } },
};

const sharedGeometry = {
  sphere: new THREE.SphereGeometry(1, 9, 7),
  cylinder: new THREE.CylinderGeometry(1, 1, 1, 7),
  cone: new THREE.ConeGeometry(1, 1, 6),
};
const animalMaterials = {};
for (const [type, definition] of Object.entries(ANIMAL_TYPES)) {
  animalMaterials[type] = new THREE.MeshStandardMaterial({ color: definition.color, roughness: 0.92 });
}
const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x24231f, roughness: 1 });
const woodMaterial = new THREE.MeshStandardMaterial({ color: 0x5b4028, roughness: 1 });
const stoneMaterial = new THREE.MeshStandardMaterial({ color: 0x66645c, roughness: 1 });
const flameMaterial = new THREE.MeshBasicMaterial({ color: 0xff8b2b, transparent: true, opacity: 0.88 });
const shelterMaterial = new THREE.MeshStandardMaterial({ color: 0x6d5538, roughness: 1, side: THREE.DoubleSide });
const npcMaterial = new THREE.MeshStandardMaterial({ color: 0x52685b, roughness: 0.9 });
const skinMaterial = new THREE.MeshStandardMaterial({ color: 0x9b765c, roughness: 0.9 });

let active = false;
let paused = false;
let state = null;
let sceneRef = null;
let cameraRef = null;
let worldRef = null;
let callbacks = {};
let updateAccumulator = 0;
let snapshotAccumulator = 0;
let target = null;
let targetAccumulator = 0;
let hurtFlash = 0;
let hitMarker = 0;
let damageDirection = null;
let cameraShake = 0;
let lastNotice = '';
const entityVisuals = new Map();
const fireVisuals = new Map();
const shelterVisuals = new Map();
const npcVisuals = new Map();
const joy = { x: 0, y: 0 };
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const scratch = new THREE.Vector3();
const scratchLocal = new THREE.Vector3();

function createInitialState(seed, spawn) {
  return {
    schemaVersion: SAVE_VERSION,
    seed: (seed >>> 0) || 1,
    simSeconds: 0,
    rngState: (seed ^ 0x9e3779b9) >>> 0,
    nextEntityId: 1,
    nextStructureId: 1,
    nextWildlifeSpawn: 24,
    phase: 'loading',
    selectedSlot: 0,
    world: {
      hours: 7.5,
      day: 1,
      dayLength: 1200,
      checkpoint: { x: spawn.x, y: spawn.y, z: spawn.z },
      weather: { kind: 'clear', label: 'Clear', intensity: 0, windSpeed: 1.4 },
      nextWeatherAt: 240,
      weatherIndex: 0,
      autosaveAt: 30,
    },
    player: {
      position: { x: spawn.x, y: spawn.y, z: spawn.z },
      velocityY: 0,
      yaw: 0,
      pitch: -0.04,
      grounded: true,
      inWater: false,
      stepDistance: 0,
      crouching: false,
      sprinting: false,
      health: 100,
      hunger: 82,
      thirst: 78,
      stamina: 100,
      warmth: 76,
      bodyTemperature: 36.8,
      wetness: 0,
      sickness: 0,
      bleeding: 0,
      attackCooldown: 0,
      lastDamageAt: -100,
      action: null,
    },
    inventory: {},
    equipment: { jacket: false, boots: false },
    crafting: null,
    dialogue: null,
    structures: { fires: [], shelters: [] },
    entities: [],
    npcs: [{ id: 'npc:elena-ward', name: 'Elena Ward', role: 'Field naturalist', position: { x: spawn.x + 4.5, y: spawn.y, z: spawn.z - 2.5 } }],
    discoveries: { landmarks: {}, wildlife: {} },
    objectives: [
      { id: 'supplies', label: 'Collect 3 wood and 2 stone', progress: 0, target: 1, complete: false },
      { id: 'fire', label: 'Place and light a campfire', progress: 0, target: 1, complete: false },
      { id: 'spear', label: 'Craft a stone spear', progress: 0, target: 1, complete: false },
      { id: 'shelter', label: 'Build a shelter', progress: 0, target: 1, complete: false },
      { id: 'landmark', label: 'Discover a landmark', progress: 0, target: 1, complete: false },
      { id: 'dawn', label: 'Remain alive until dawn', progress: 0, target: 1, complete: false },
    ],
    stats: { deaths: 0, distanceTravelled: 0, wildlifeHarvested: 0, hostilesDefeated: 0, nightsSurvived: 0, resourcesGathered: 0 },
  };
}

function random() {
  state.rngState = (state.rngState + 0x6d2b79f5) | 0;
  let value = state.rngState;
  value = Math.imul(value ^ (value >>> 15), 1 | value);
  value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function emit(type, data = {}) {
  callbacks.onEvent?.({ type, ...data });
}

function getSelectedItem() {
  return HOTBAR[state.selectedSlot];
}

function getItemCount(id) {
  return countItem(state.inventory, id);
}

function giveItem(id, amount = 1) {
  const added = addItem(state.inventory, id, amount);
  if (added < amount) emit('toast', { text: 'Your pack is too heavy.' });
  return added;
}

function takeItem(id, amount = 1) {
  return removeItem(state.inventory, id, amount);
}

function getNearestFire(position = state.player.position, litOnly = true) {
  let nearest = null;
  let distance = Infinity;
  for (const fire of state.structures.fires) {
    if (litOnly && !fire.lit) continue;
    const dx = fire.position.x - position.x;
    const dz = fire.position.z - position.z;
    const candidateDistance = dx * dx + dz * dz;
    if (candidateDistance < distance) {
      distance = candidateDistance;
      nearest = fire;
    }
  }
  return nearest;
}

function getNearestShelter(position = state.player.position) {
  let nearest = null;
  let distance = Infinity;
  for (const shelter of state.structures.shelters) {
    const dx = shelter.position.x - position.x;
    const dz = shelter.position.z - position.z;
    const candidateDistance = dx * dx + dz * dz;
    if (candidateDistance < distance) {
      distance = candidateDistance;
      nearest = shelter;
    }
  }
  return nearest;
}

function isNearFire(recipe) {
  if (recipe.station !== 'fire') return true;
  const fire = getNearestFire();
  return fire && Math.hypot(fire.position.x - state.player.position.x, fire.position.z - state.player.position.z) < 4.5;
}

function addMesh(group, geometry, material, x, y, z, sx = 1, sy = sx, sz = sx) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function createAnimalModel(type) {
  const definition = ANIMAL_TYPES[type];
  const group = new THREE.Group();
  const material = animalMaterials[type];
  const bodyY = type === 'rabbit' ? 0.5 : 0.9;
  addMesh(group, sharedGeometry.sphere, material, 0, bodyY, 0, 0.72 * definition.size, 0.55 * definition.size, 1.05 * definition.size);
  addMesh(group, sharedGeometry.sphere, material, 0, bodyY + 0.38 * definition.size, -0.92 * definition.size, 0.36 * definition.size, 0.4 * definition.size, 0.55 * definition.size);
  const legHeight = type === 'rabbit' ? 0.25 : 0.65;
  for (const x of [-0.38, 0.38]) {
    for (const z of [-0.55, 0.55]) addMesh(group, sharedGeometry.cylinder, material, x * definition.size, legHeight * 0.5, z * definition.size, 0.1 * definition.size, legHeight, 0.1 * definition.size);
  }
  if (type === 'rabbit') {
    addMesh(group, sharedGeometry.cone, material, -0.18, bodyY + 0.85, -0.9, 0.13, 0.65, 0.13);
    addMesh(group, sharedGeometry.cone, material, 0.18, bodyY + 0.85, -0.9, 0.13, 0.65, 0.13);
  } else {
    addMesh(group, sharedGeometry.cone, material, -0.22, bodyY + 0.72, -1.02, 0.1, 0.4, 0.1);
    addMesh(group, sharedGeometry.cone, material, 0.22, bodyY + 0.72, -1.02, 0.1, 0.4, 0.1);
    addMesh(group, sharedGeometry.sphere, darkMaterial, 0, bodyY + 0.37, -1.22 * definition.size, 0.22 * definition.size, 0.16 * definition.size, 0.12 * definition.size);
  }
  return group;
}

function createFireVisual(fire) {
  const group = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const angle = i / 3 * TAU;
    const log = addMesh(group, sharedGeometry.cylinder, woodMaterial, Math.cos(angle) * 0.28, 0.18, Math.sin(angle) * 0.28, 0.11, 1.25, 0.11);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = -angle;
  }
  for (let i = 0; i < 7; i++) {
    const angle = i / 7 * TAU;
    addMesh(group, sharedGeometry.sphere, stoneMaterial, Math.cos(angle) * 0.72, 0.13, Math.sin(angle) * 0.72, 0.18, 0.13, 0.16);
  }
  const flame = new THREE.Group();
  addMesh(flame, sharedGeometry.cone, flameMaterial, 0, 0.7, 0, 0.32, 1.3, 0.32);
  addMesh(flame, sharedGeometry.cone, flameMaterial, 0.15, 0.45, 0.08, 0.18, 0.85, 0.18);
  group.add(flame);
  group.userData.flame = flame;
  sceneRef.add(group);
  fireVisuals.set(fire.id, group);
}

function createShelterVisual(shelter) {
  const group = new THREE.Group();
  const roof = addMesh(group, sharedGeometry.cylinder, shelterMaterial, 0, 1.3, 0, 1.8, 3.8, 0.08);
  roof.rotation.z = Math.PI / 2;
  for (const x of [-1.4, 1.4]) addMesh(group, sharedGeometry.cylinder, woodMaterial, x, 1.1, -1.1, 0.1, 2.2, 0.1);
  addMesh(group, sharedGeometry.cylinder, woodMaterial, 0, 0.15, 0, 1.7, 0.2, 2.2);
  sceneRef.add(group);
  shelterVisuals.set(shelter.id, group);
}

function createNpcVisual(npc) {
  const group = new THREE.Group();
  addMesh(group, sharedGeometry.cylinder, darkMaterial, -0.17, 0.45, 0, 0.13, 0.9, 0.14);
  addMesh(group, sharedGeometry.cylinder, darkMaterial, 0.17, 0.45, 0, 0.13, 0.9, 0.14);
  addMesh(group, sharedGeometry.sphere, npcMaterial, 0, 1.18, 0, 0.48, 0.68, 0.3);
  addMesh(group, sharedGeometry.cylinder, npcMaterial, -0.5, 1.12, 0, 0.11, 0.78, 0.12);
  addMesh(group, sharedGeometry.cylinder, npcMaterial, 0.5, 1.12, 0, 0.11, 0.78, 0.12);
  addMesh(group, sharedGeometry.sphere, skinMaterial, 0, 1.86, -0.02, 0.27, 0.32, 0.27);
  addMesh(group, sharedGeometry.cylinder, darkMaterial, 0, 2.06, 0, 0.36, 0.12, 0.32);
  sceneRef.add(group);
  npcVisuals.set(npc.id, group);
  return group;
}

function syncVisuals() {
  for (const entity of state.entities) {
    let group = entityVisuals.get(entity.id);
    if (!group) {
      group = createAnimalModel(entity.type);
      sceneRef.add(group);
      entityVisuals.set(entity.id, group);
    }
    worldRef.toLocal(scratch.set(entity.position.x, entity.position.y, entity.position.z), scratchLocal);
    group.position.copy(scratchLocal);
    group.rotation.y = entity.yaw;
    const targetRotation = entity.dead ? Math.PI * 0.48 : 0;
    group.rotation.z += (targetRotation - group.rotation.z) * 0.15;
    group.visible = !entity.removeAt || entity.removeAt > state.simSeconds;
  }
  for (const fire of state.structures.fires) {
    let group = fireVisuals.get(fire.id);
    if (!group) createFireVisual(fire);
    worldRef.toLocal(scratch.set(fire.position.x, fire.position.y, fire.position.z), scratchLocal);
    group.position.copy(scratchLocal);
    const flame = group.userData.flame;
    flame.visible = fire.lit && fire.fuel > 0;
    const pulse = fire.lit ? 0.82 + Math.sin(state.simSeconds * 9 + fire.position.x) * 0.15 : 1;
    flame.scale.setScalar(pulse);
  }
  for (const shelter of state.structures.shelters) {
    let group = shelterVisuals.get(shelter.id);
    if (!group) createShelterVisual(shelter);
    worldRef.toLocal(scratch.set(shelter.position.x, shelter.position.y, shelter.position.z), scratchLocal);
    group.position.copy(scratchLocal);
    group.rotation.y = shelter.rotation;
  }
  for (const npc of state.npcs) {
    let group = npcVisuals.get(npc.id);
    if (!group) group = createNpcVisual(npc);
    worldRef.toLocal(scratch.set(npc.position.x, npc.position.y, npc.position.z), scratchLocal);
    group.position.copy(scratchLocal);
    group.rotation.y = Math.atan2(-(state.player.position.x - npc.position.x), -(state.player.position.z - npc.position.z));
  }
}

function clearVisuals() {
  for (const group of entityVisuals.values()) sceneRef.remove(group);
  for (const group of fireVisuals.values()) sceneRef.remove(group);
  for (const group of shelterVisuals.values()) sceneRef.remove(group);
  for (const group of npcVisuals.values()) sceneRef.remove(group);
  entityVisuals.clear();
  fireVisuals.clear();
  shelterVisuals.clear();
  npcVisuals.clear();
}

function findAnimalSpawn(type, minDistance = 25, maxDistance = 85) {
  for (let i = 0; i < 18; i++) {
    const angle = random() * TAU;
    const distance = minDistance + random() * (maxDistance - minDistance);
    const x = state.player.position.x + Math.cos(angle) * distance;
    const z = state.player.position.z + Math.sin(angle) * distance;
    const y = worldRef.heightAt(x, z);
    if (y < 0.6 || normalAt(worldRef.field, x, z).y < 0.7) continue;
    return { x, y, z };
  }
  return null;
}

function spawnAnimal(type, position = null) {
  const definition = ANIMAL_TYPES[type];
  const spawn = position || findAnimalSpawn(type);
  if (!spawn) return null;
  const id = `animal:${state.nextEntityId++}`;
  const entity = {
    id,
    type,
    hostile: definition.hostile,
    position: { x: spawn.x, y: spawn.y, z: spawn.z },
    yaw: random() * TAU,
    health: definition.health,
    maxHealth: definition.health,
    dead: false,
    behavior: 'wander',
    nextDecisionAt: state.simSeconds + 2 + random() * 5,
    attackAt: 0,
    lootReadyAt: 0,
    lootTaken: false,
    removeAt: 0,
    drops: definition.drops,
  };
  state.entities.push(entity);
  if (!state.discoveries.wildlife[type]) {
    state.discoveries.wildlife[type] = { seenAt: state.simSeconds, harvested: 0 };
    emit('discover', { kind: 'wildlife', id: type, label: `${type[0].toUpperCase()}${type.slice(1)} observed` });
  }
  return entity;
}

function seedWildlife() {
  const animals = ['deer', 'rabbit', 'deer', 'boar', 'wolf'];
  for (const type of animals) spawnAnimal(type);
}

function updateWildlife(dt) {
  const player = state.player;
  if (state.simSeconds >= state.nextWildlifeSpawn && state.entities.length < 14) {
    const night = state.world.hours < 6 || state.world.hours > 19;
    const roll = random();
    const type = night && roll < 0.58 ? (roll < 0.22 ? 'bear' : 'wolf') : roll < 0.28 ? 'rabbit' : roll < 0.68 ? 'deer' : 'boar';
    spawnAnimal(type, null);
    state.nextWildlifeSpawn = state.simSeconds + 18 + random() * 24;
  }
  for (let i = state.entities.length - 1; i >= 0; i--) {
    const entity = state.entities[i];
    if (entity.removeAt && entity.removeAt <= state.simSeconds) {
      const group = entityVisuals.get(entity.id);
      if (group) sceneRef.remove(group);
      entityVisuals.delete(entity.id);
      state.entities.splice(i, 1);
      continue;
    }
    if (entity.dead) continue;
    const definition = ANIMAL_TYPES[entity.type];
    const dx = player.position.x - entity.position.x;
    const dz = player.position.z - entity.position.z;
    const distance = Math.hypot(dx, dz);
    let directionX = Math.sin(entity.yaw);
    let directionZ = Math.cos(entity.yaw);
    let speed = definition.speed * 0.28;
    if (entity.hostile && distance < definition.detection) {
      entity.behavior = 'chase';
      directionX = dx / (distance || 1);
      directionZ = dz / (distance || 1);
      speed = definition.speed;
      if (distance < 2.15 + definition.size * 0.35 && state.simSeconds >= entity.attackAt) {
        entity.attackAt = state.simSeconds + 1.35;
        damagePlayer(entity.type === 'bear' ? 29 : 14, entity.type === 'bear' ? 'mauling' : 'bite', entity.id);
      }
    } else if (!entity.hostile && distance < definition.detection) {
      entity.behavior = 'flee';
      directionX = -dx / (distance || 1);
      directionZ = -dz / (distance || 1);
      speed = definition.speed;
    } else if (state.simSeconds >= entity.nextDecisionAt) {
      entity.nextDecisionAt = state.simSeconds + 2.5 + random() * 5;
      entity.yaw = (entity.yaw + (random() - 0.5) * 2.4) % TAU;
      directionX = Math.sin(entity.yaw);
      directionZ = Math.cos(entity.yaw);
    }
    if ((entity.behavior === 'chase' || entity.behavior === 'flee') && distance > 0.01) entity.yaw = Math.atan2(-directionX, -directionZ);
    const nextX = entity.position.x + directionX * speed * dt;
    const nextZ = entity.position.z + directionZ * speed * dt;
    if (worldRef.heightAt(nextX, nextZ) > 0.45 && normalAt(worldRef.field, nextX, nextZ).y > 0.62) {
      entity.position.x = nextX;
      entity.position.z = nextZ;
    } else {
      entity.yaw += 1.6 + random();
    }
    entity.position.y = worldRef.heightAt(entity.position.x, entity.position.z);
    if (Math.hypot(entity.position.x - player.position.x, entity.position.z - player.position.z) > 230) entity.removeAt = state.simSeconds + 1;
  }
}

function nearestTargetInCone(maxDistance, minDot) {
  const yaw = state.player.yaw;
  const directionX = -Math.sin(yaw);
  const directionZ = -Math.cos(yaw);
  let selected = null;
  let selectedDistance = maxDistance;
  for (const entity of state.entities) {
    if (entity.dead) continue;
    const dx = entity.position.x - state.player.position.x;
    const dz = entity.position.z - state.player.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance > selectedDistance) continue;
    const dot = distance < 0.5 ? 1 : (dx * directionX + dz * directionZ) / distance;
    if (dot < minDot) continue;
    selected = entity;
    selectedDistance = distance;
  }
  return selected;
}

function damageEntity(entity, amount) {
  if (!entity || entity.dead) return;
  entity.health -= amount;
  hitMarker = 0.22;
  emit('hit', { amount, critical: false });
  if (entity.health > 0) return;
  entity.dead = true;
  entity.lootTaken = false;
  entity.lootReadyAt = state.simSeconds + 7;
  entity.removeAt = state.simSeconds + 180;
  if (entity.hostile) state.stats.hostilesDefeated++;
  emit('toast', { text: `${entity.type[0].toUpperCase()}${entity.type.slice(1)} defeated. Harvest it after a moment.` });
}

function attack() {
  if (state.player.attackCooldown > 0) return;
  const selectedId = getSelectedItem();
  const selected = getItemCount(selectedId) && state.equipment[selectedId] ? selectedId : null;
  if (selected === 'bow') {
    shoot();
    return;
  }
  const reach = selected === 'spear' ? 3.1 : selected === 'stone_axe' ? 2.45 : 1.65;
  const damage = selected === 'spear' ? 42 : selected === 'stone_axe' ? 25 : 9;
  const entity = nearestTargetInCone(reach, 0.7);
  state.player.attackCooldown = selected === 'spear' ? 0.9 : selected === 'stone_axe' ? 0.68 : 0.48;
  state.player.stamina = Math.max(0, state.player.stamina - (selected === 'spear' ? 12 : selected === 'stone_axe' ? 9 : 4));
  if (entity) damageEntity(entity, damage);
  else emit('swing', { tool: selected || 'hands' });
}

function shoot() {
  if (state.player.attackCooldown > 0) return;
  if (getItemCount('arrow') < 1) {
    emit('toast', { text: 'No stone arrows crafted.' });
    return;
  }
  takeItem('arrow');
  state.player.attackCooldown = 0.75;
  state.player.stamina = Math.max(0, state.player.stamina - 6);
  const entity = nearestTargetInCone(58, 0.975);
  if (entity) damageEntity(entity, 46);
  else emit('toast', { text: 'Arrow fired.' });
}

function damagePlayer(amount, kind, sourceId) {
  if (state.phase !== 'running' || state.simSeconds - state.player.lastDamageAt < 0.25) return;
  state.player.lastDamageAt = state.simSeconds;
  const mitigation = state.equipment.jacket ? 0.72 : 1;
  const applied = amount * mitigation;
  state.player.health = Math.max(0, state.player.health - applied);
  if (kind === 'bite' || kind === 'mauling') state.player.bleeding = Math.min(100, state.player.bleeding + 12);
  hurtFlash = 0.42;
  cameraShake = Math.min(1, 0.25 + applied / 45);
  const source = state.entities.find(entity => entity.id === sourceId);
  if (source) damageDirection = Math.atan2(source.position.x - state.player.position.x, source.position.z - state.player.position.z);
  emit('damage', { amount: applied, kind });
  if (state.player.health <= 0) die();
}

function startAction(type, targetValue, duration, actionTarget) {
  if (state.player.action) return;
  state.player.action = {
    type,
    targetId: typeof targetValue === 'string' ? targetValue : targetValue.id,
    duration,
    elapsed: 0,
    startX: state.player.position.x,
    startZ: state.player.position.z,
    data: actionTarget,
  };
  emit('action', { started: true, type });
}

function cancelAction(reason = 'canceled') {
  if (!state.player.action) return;
  state.player.action = null;
  emit('action', { started: false, reason });
}

function discoverLandmark(landmark) {
  if (state.discoveries.landmarks[landmark.id]) return false;
  state.discoveries.landmarks[landmark.id] = { type: landmark.type, x: landmark.x, y: landmark.y, z: landmark.z, discoveredAt: state.simSeconds };
  emit('discover', { kind: 'landmark', id: landmark.id, label: `${landmark.label} discovered` });
  emit('toast', { text: `${landmark.label} added to your field journal.` });
  return true;
}

function openNpcDialogue(npc) {
  const objective = state.objectives.find(item => !item.complete);
  const text = objective
    ? `Keep moving, ${npc.name === 'Elena Ward' ? 'survivor' : 'friend'}. Your field assignment is simple: ${objective.label.toLowerCase()}. Gather wood and stone first, and do not let the cold or wet weather catch you unprepared.`
    : 'Your field assignment is complete. Keep exploring beyond the charted tracks, document landmarks, and return if the weather turns dangerous.';
  state.dialogue = { npcId: npc.id, name: npc.name, role: npc.role, text };
  emit('dialogue', state.dialogue);
}

function harvestResource(node) {
  let added = 0;
  const roll = random();
  if (node.type === RESOURCE_TYPES.WOOD) {
    added += giveItem('wood', 3 + Math.floor(roll * 3));
    added += giveItem('stick', 1 + Math.floor(random() * 3));
  } else if (node.type === RESOURCE_TYPES.STONE) {
    added += giveItem('stone', 2 + Math.floor(roll * 2));
    if (roll > 0.45) added += giveItem('flint', 1);
  } else if (node.type === RESOURCE_TYPES.BERRY) {
    added += giveItem('berry', 2 + Math.floor(roll * 3));
    added += giveItem('fiber', 1 + Math.floor(random() * 2));
  } else {
    added += giveItem('fiber', 2 + Math.floor(roll * 2));
    if (roll > 0.58) added += giveItem('herb', 1);
    if (roll < 0.25) added += giveItem('resin', 1);
  }
  if (added > 0) {
    worldRef.consumeResource(node.id);
    state.stats.resourcesGathered++;
    emit('toast', { text: `${RESOURCE_INFO[node.type].label} gathered.` });
  }
}

function harvestCarcass(entity) {
  let added = 0;
  for (const [id, amount] of Object.entries(entity.drops)) added += giveItem(id, amount);
  if (added > 0) {
    entity.lootTaken = true;
    entity.removeAt = state.simSeconds + 1;
    state.stats.wildlifeHarvested++;
    const discovery = state.discoveries.wildlife[entity.type];
    if (discovery) discovery.harvested++;
    emit('toast', { text: 'Meat and hide recovered.' });
  }
}

function interactWithFire(fire) {
  if (!fire.lit) {
    const fuelId = getItemCount('wood') ? 'wood' : getItemCount('stick') ? 'stick' : null;
    if (!fuelId || (!getItemCount('torch') && !getItemCount('flint'))) {
      emit('toast', { text: 'You need wood plus a torch or flint.' });
      return;
    }
    takeItem(fuelId, 1);
    if (getItemCount('torch')) takeItem('torch', 1);
    fire.fuel = Math.min(1800, fire.fuel + (fuelId === 'wood' ? 150 : 60));
    fire.lit = true;
    fire.wetness = 0;
    emit('toast', { text: 'The campfire catches.' });
    return;
  }
  if (fire.fuel > 1500) {
    emit('toast', { text: 'The fire has plenty of fuel.' });
    return;
  }
  if (getItemCount('wood')) {
    takeItem('wood');
    fire.fuel = Math.min(1800, fire.fuel + 150);
    emit('toast', { text: 'Wood added to the fire.' });
  } else if (getItemCount('stick')) {
    takeItem('stick');
    fire.fuel = Math.min(1800, fire.fuel + 60);
  } else {
    emit('toast', { text: 'No firewood in your pack.' });
  }
}

function completeAction(action) {
  if (action.type === 'gather') {
    if (action.data.kind === 'resource') {
      harvestResource(action.data.node);
      emit('sound', { name: action.data.node.type === RESOURCE_TYPES.STONE ? 'mine' : 'gather' });
    }
    else if (action.data.kind === 'water') {
      giveItem('dirty_water', 1);
      emit('toast', { text: 'Water collected. Purify it at a fire.' });
    } else if (action.data.kind === 'landmark') discoverLandmark(action.data.landmark);
    else if (action.data.kind === 'fire') interactWithFire(action.data.fire);
    else if (action.data.kind === 'shelter') emit('toast', { text: 'Shelter ready. Rest here when you are safe.' });
    else if (action.data.kind === 'carcass') harvestCarcass(action.data.entity);
  } else if (action.type === 'build_fire') {
    if (getItemCount('campfire_kit') < 1) return;
    takeItem('campfire_kit');
    const fire = { id: `fire:${state.nextStructureId++}`, position: { ...action.data.position }, fuel: 0, lit: false, wetness: 0 };
    state.structures.fires.push(fire);
    createFireVisual(fire);
    emit('toast', { text: 'Campfire placed. Add fuel and ignition.' });
  } else if (action.type === 'build_shelter') {
    if (getItemCount('shelter_kit') < 1) return;
    takeItem('shelter_kit');
    const shelter = { id: `shelter:${state.nextStructureId++}`, position: { ...action.data.position }, rotation: state.player.yaw, integrity: 100 };
    state.structures.shelters.push(shelter);
    state.world.checkpoint = { ...shelter.position };
    createShelterVisual(shelter);
    emit('toast', { text: 'Shelter built. This is now your checkpoint.' });
  }
}

function updateAction(dt, movement) {
  const action = state.player.action;
  if (!action) return;
  if ((action.type === 'gather' || action.type.startsWith('build_')) && Math.hypot(state.player.position.x - action.startX, state.player.position.z - action.startZ) > 1.5) {
    cancelAction('You moved away.');
    return;
  }
  action.elapsed += dt;
  if (action.elapsed < action.duration) return;
  state.player.action = null;
  completeAction(action);
  emit('action', { started: false, reason: 'complete' });
}

function getInteractionTarget() {
  const player = state.player;
  const directionX = -Math.sin(player.yaw);
  const directionZ = -Math.cos(player.yaw);
  const candidates = [];
  const addCandidate = (kind, value, label, verb, range = 3.8) => {
    const source = value.position || value;
    const dx = source.x - player.position.x;
    const dz = source.z - player.position.z;
    const distance = Math.hypot(dx, dz);
    if (!Number.isFinite(distance) || distance > range) return;
    const dot = distance < 0.35 ? 1 : (dx * directionX + dz * directionZ) / distance;
    if (dot < 0.18) return;
    candidates.push({ kind, value, label, verb, distance, score: distance + (1 - dot) * 2.2 });
  };
  for (const node of worldRef.getNearbyResources(scratch.set(player.position.x, player.position.y + 1, player.position.z), 4.2)) {
    const resource = { id: node.id, type: node.type, x: node.x, y: node.y, z: node.z, active: node.active };
    addCandidate('resource', resource, RESOURCE_INFO[node.type].label, RESOURCE_INFO[node.type].verb, 3.4);
  }
  for (const landmark of worldRef.getNearbyLandmarks(player.position, 5)) {
    const verb = landmark.type === 'spring' ? 'Collect water' : state.discoveries.landmarks[landmark.id] ? 'Inspect' : 'Discover';
    addCandidate('landmark', landmark, landmark.label, verb, 4.2);
  }
  for (const fire of state.structures.fires) {
    addCandidate('fire', fire, fire.lit ? 'Campfire' : 'Unlit campfire', fire.lit ? 'Manage fire' : 'Light fire', 3.2);
  }
  for (const shelter of state.structures.shelters) {
    addCandidate('shelter', shelter, 'Field shelter', 'Rest here', 3.2);
  }
  for (const npc of state.npcs) {
    addCandidate('npc', npc, npc.name, 'Speak', 3.2);
  }
  for (const entity of state.entities) {
    if (!entity.dead || entity.lootTaken || entity.lootReadyAt > state.simSeconds) continue;
    addCandidate('carcass', { ...entity.position, entity, x: entity.position.x, z: entity.position.z }, `${entity.type[0].toUpperCase()}${entity.type.slice(1)} carcass`, 'Harvest', 3);
  }
  const waterX = player.position.x + directionX * 2.1;
  const waterZ = player.position.z + directionZ * 2.1;
  if (worldRef.isWaterAt(waterX, waterZ)) candidates.push({ kind: 'water', value: { x: waterX, z: waterZ }, label: 'Untreated water', verb: 'Collect', distance: 2.1, score: 2.1 });
  candidates.sort((a, b) => a.score - b.score);
  const selected = candidates[0];
  if (!selected) return null;
  if (selected.kind === 'resource') return { kind: selected.kind, id: selected.value.id, label: selected.label, verb: selected.verb, node: selected.value };
  if (selected.kind === 'landmark') return { kind: selected.kind, id: selected.value.id, label: selected.label, verb: selected.verb, landmark: selected.value };
  if (selected.kind === 'fire') return { kind: selected.kind, id: selected.value.id, label: selected.label, verb: selected.verb, fire: selected.value };
  if (selected.kind === 'shelter') return { kind: selected.kind, id: selected.value.id, label: selected.label, verb: selected.verb, shelter: selected.value };
  if (selected.kind === 'npc') return { kind: selected.kind, id: selected.value.id, label: selected.label, verb: selected.verb, npc: selected.value };
  if (selected.kind === 'carcass') return { kind: selected.kind, id: selected.value.entity.id, label: selected.label, verb: selected.verb, entity: selected.value.entity };
  return { kind: 'water', id: `water:${Math.floor(waterX)}:${Math.floor(waterZ)}`, label: selected.label, verb: selected.verb, x: waterX, z: waterZ };
}

function interact() {
  if (state.player.action) return;
  target = getInteractionTarget();
  if (!target) {
    emit('toast', { text: 'Nothing within reach.' });
    return;
  }
  if (target.kind === 'resource') startAction('gather', target, RESOURCE_INFO[target.node.type].duration, { kind: 'resource', node: target.node });
  else if (target.kind === 'landmark') startAction('gather', target, 1.4, { kind: 'landmark', landmark: target.landmark });
  else if (target.kind === 'fire') startAction('gather', target, target.fire.lit ? 0.5 : 1.2, { kind: 'fire', fire: target.fire });
  else if (target.kind === 'shelter') emit('toast', { text: 'Use Rest until dawn from the pause menu.' });
  else if (target.kind === 'npc') openNpcDialogue(target.npc);
  else if (target.kind === 'carcass') startAction('gather', target, 1.8, { kind: 'carcass', entity: target.entity });
  else startAction('gather', target, 1, { kind: 'water', x: target.x, z: target.z });
}

function placeStructure() {
  if (state.player.action) return;
  const player = state.player;
  const x = player.position.x - Math.sin(player.yaw) * 2.3;
  const z = player.position.z - Math.cos(player.yaw) * 2.3;
  const y = worldRef.heightAt(x, z);
  if (y < 0.45 || normalAt(worldRef.field, x, z).y < 0.8) {
    emit('toast', { text: 'Choose flatter, dry ground.' });
    return;
  }
  if (getItemCount('campfire_kit') && !getNearestFire({ x, z }, false)) {
    startAction('build_fire', 'shelter', 4, { position: { x, y, z } });
    emit('toast', { text: 'Placing campfire…' });
  } else if (getItemCount('shelter_kit')) {
    startAction('build_shelter', 'shelter', 10, { position: { x, y, z } });
    emit('toast', { text: 'Building shelter…' });
  } else {
    emit('toast', { text: 'Craft a campfire or shelter kit first.' });
  }
}

function craft(recipeId) {
  if (state.crafting) {
    emit('toast', { text: 'Finish your current craft first.' });
    return;
  }
  const recipe = RECIPES[recipeId];
  if (!recipe || !canCraft(state.inventory, recipeId)) {
    emit('toast', { text: 'Missing materials for that recipe.' });
    return;
  }
  if (!isNearFire(recipe)) {
    emit('toast', { text: 'Cooking and purification require a lit campfire.' });
    return;
  }
  for (const [id, amount] of Object.entries(recipe.inputs)) takeItem(id, amount);
  state.crafting = { recipeId, label: recipe.label, elapsed: 0, duration: recipe.duration };
  emit('toast', { text: `Crafting ${recipe.label.toLowerCase()}…` });
}

function updateCrafting(dt) {
  if (!state.crafting) return;
  state.crafting.elapsed += dt;
  if (state.crafting.elapsed < state.crafting.duration) return;
  const recipe = RECIPES[state.crafting.recipeId];
  for (const [id, amount] of Object.entries(recipe.output)) giveItem(id, amount);
  emit('toast', { text: `${recipe.label} crafted.` });
  state.crafting = null;
}

function dropItem(id, amount = 1) {
  const removed = takeItem(id, Math.max(1, Number(amount) || 1));
  if (removed) emit('toast', { text: `${removed} ${itemLabel(id).toLowerCase()} dropped.` });
}

function equipItem(id) {
  const slot = EQUIPMENT_SLOTS[id];
  if (!slot || getItemCount(id) < 1) {
    emit('toast', { text: 'That item cannot be equipped.' });
    return;
  }
  state.equipment[slot] = !state.equipment[slot];
  emit('toast', { text: `${itemLabel(id)} ${state.equipment[slot] ? 'equipped' : 'stowed'}.` });
}

function consumeItem(item) {
  const player = state.player;
  if (!getItemCount(item)) return;
  if (item === 'bandage') {
    if (player.health >= 100 && player.bleeding <= 0) {
      emit('toast', { text: 'You do not need a bandage yet.' });
      return;
    }
    takeItem(item);
    player.health = Math.min(100, player.health + 28);
    player.bleeding = Math.max(0, player.bleeding - 65);
    player.sickness = Math.max(0, player.sickness - 30);
  } else if (item === 'clean_water') {
    takeItem(item);
    player.thirst = Math.min(100, player.thirst + 32);
  } else if (item === 'berry') {
    takeItem(item);
    player.hunger = Math.min(100, player.hunger + 9);
    player.thirst = Math.min(100, player.thirst + 3);
  } else if (item === 'cooked_meat') {
    takeItem(item);
    player.hunger = Math.min(100, player.hunger + 38);
    player.health = Math.min(100, player.health + 5);
  } else if (item === 'raw_meat') {
    takeItem(item);
    player.hunger = Math.min(100, player.hunger + 18);
    player.sickness = Math.min(100, player.sickness + 28);
    emit('toast', { text: 'Raw meat may make you sick.' });
  } else {
    return;
  }
  emit('toast', { text: `${itemLabel(item)} used.` });
}

function useSelected() {
  const item = getSelectedItem();
  const player = state.player;
  if (item === 'bandage' && getItemCount(item)) {
    if (player.health >= 100 && player.bleeding <= 0) {
      emit('toast', { text: 'You do not need a bandage yet.' });
      return;
    }
    takeItem(item);
    player.health = Math.min(100, player.health + 28);
    player.bleeding = Math.max(0, player.bleeding - 65);
    player.sickness = Math.max(0, player.sickness - 30);
  } else if (item === 'clean_water' && getItemCount(item)) {
    takeItem(item);
    player.thirst = Math.min(100, player.thirst + 32);
  } else if (item === 'berry' && getItemCount(item)) {
    takeItem(item);
    player.hunger = Math.min(100, player.hunger + 9);
    player.thirst = Math.min(100, player.thirst + 3);
  } else if (item === 'cooked_meat' && getItemCount(item)) {
    takeItem(item);
    player.hunger = Math.min(100, player.hunger + 38);
    player.health = Math.min(100, player.health + 5);
  } else if (item === 'raw_meat' && getItemCount(item)) {
    takeItem(item);
    player.hunger = Math.min(100, player.hunger + 18);
    player.sickness = Math.min(100, player.sickness + 28);
    emit('toast', { text: 'Raw meat may make you sick.' });
  } else if (['stone_axe', 'spear', 'bow', 'torch'].includes(item) && getItemCount(item)) {
    state.equipment[item] = !state.equipment[item];
    emit('toast', { text: `${itemLabel(item)} ${state.equipment[item] ? 'readied' : 'stowed'}.` });
  } else {
    attack();
  }
}

function restUntilDawn() {
  const shelter = getNearestShelter();
  if (!shelter || Math.hypot(shelter.position.x - state.player.position.x, shelter.position.z - state.player.position.z) > 4) {
    emit('toast', { text: 'You need to be beside a shelter.' });
    return;
  }
  const current = state.world.hours;
  const crossesMidnight = current >= 6;
  const hours = current < 6 ? 6 - current : 30 - current;
  state.simSeconds += hours * state.world.dayLength / 24;
  if (worldRef) worldRef.elapsed = state.simSeconds;
  state.world.hours = 6;
  if (crossesMidnight) state.world.day++;
  state.player.hunger = Math.max(35, state.player.hunger - hours * 2.1);
  state.player.thirst = Math.max(35, state.player.thirst - hours * 2.6);
  state.player.stamina = 100;
  state.player.health = Math.min(100, state.player.health + 45);
  state.stats.nightsSurvived++;
  emit('toast', { text: 'You rested safely until dawn.' });
}

function die() {
  if (state.phase === 'dead') return;
  state.phase = 'dead';
  state.player.action = null;
  state.crafting = null;
  state.stats.deaths++;
  emit('death', {});
  emit('save');
}

function respawn() {
  const checkpoint = state.world.checkpoint;
  state.player.position = { ...checkpoint };
  state.player.velocityY = 0;
  state.player.health = 38;
  state.player.hunger = Math.max(state.player.hunger, 45);
  state.player.thirst = Math.max(state.player.thirst, 45);
  state.player.stamina = 70;
  state.player.warmth = Math.max(state.player.warmth, 50);
  state.player.bodyTemperature = 36.7;
  state.player.wetness = 0;
  state.player.bleeding = 0;
  state.player.sickness = 0;
  state.phase = 'running';
  state.world.hours = Math.max(state.world.hours, 6);
  emit('respawn', {});
  updateCamera(0, true);
  publishSnapshot(true);
}

function getAmbientTemperature() {
  const daylight = Math.sin((state.world.hours - 8) / 24 * TAU);
  const altitude = Math.max(0, state.player.position.y);
  const biome = worldRef.biomeAt(state.player.position.x, state.player.position.z);
  const biomeOffset = biome === BIOMES.DESERT ? 5 : biome === BIOMES.ALPINE ? -5 : biome === BIOMES.TUNDRA ? -4 : 0;
  return 14 + daylight * 8 + altitude * 0.025 + biomeOffset - state.world.weather.intensity * 1.5;
}

function updateNeeds(dt, movement) {
  const player = state.player;
  const sprinting = player.sprinting && movement;
  player.hunger = Math.max(0, player.hunger - dt * (0.027 + (sprinting ? 0.045 : 0)));
  player.thirst = Math.max(0, player.thirst - dt * (0.047 + (sprinting ? 0.05 : 0) + Math.max(0, getAmbientTemperature() - 22) * 0.002));
  if (sprinting) player.stamina = Math.max(0, player.stamina - dt * 12);
  else if (!movement) player.stamina = Math.min(100, player.stamina + dt * 17);
  else player.stamina = Math.min(100, player.stamina + dt * 7);
  const rain = ['rain', 'storm'].includes(state.world.weather.kind) ? state.world.weather.intensity : 0;
  player.wetness = clamp(player.wetness + (rain > 0 ? dt * rain * 0.025 : -dt * 0.006), 0, 1);
  const fire = getNearestFire();
  const fireDistance = fire ? Math.hypot(fire.position.x - player.position.x, fire.position.z - player.position.z) : Infinity;
  const fireWarmth = fire && fireDistance < 4.2 ? (1 - fireDistance / 4.2) : 0;
  const clothing = (state.equipment.jacket ? 3.5 : 0) + (state.equipment.boots ? 0.8 : 0);
  const effective = getAmbientTemperature() - state.world.weather.windSpeed * 0.28 - player.wetness * 6 + fireWarmth * 11 + clothing;
  const warmthTarget = clamp((effective + 5) * 7, 0, 100);
  player.warmth += (warmthTarget - player.warmth) * Math.min(1, dt * 0.045);
  const targetTemperature = clamp(36.2 + (effective - 16) * 0.035 + fireWarmth * 0.2, 34.5, 38.5);
  player.bodyTemperature += (targetTemperature - player.bodyTemperature) * Math.min(1, dt * 0.012);
  player.bleeding = Math.max(0, player.bleeding - dt * 0.22);
  player.sickness = Math.max(0, player.sickness - dt * 0.07);
  let healthRate = 0;
  if (player.hunger <= 0) healthRate -= 0.35;
  if (player.thirst <= 0) healthRate -= 0.75;
  if (player.bodyTemperature < 35.2) healthRate -= (35.2 - player.bodyTemperature) * 0.32;
  if (player.bodyTemperature > 38.4) healthRate -= (player.bodyTemperature - 38.4) * 0.42;
  healthRate -= player.bleeding * 0.018;
  healthRate -= player.sickness * 0.004;
  if (healthRate === 0 && player.hunger > 25 && player.thirst > 25 && player.bleeding <= 0 && player.sickness <= 0) healthRate = 0.12;
  player.health = clamp(player.health - healthRate * dt, 0, 100);
  if (fire && fire.lit) player.wetness = Math.max(0, player.wetness - dt * fireWarmth * 0.03);
  if (player.health <= 0) die();
}

function chooseWeather() {
  const index = state.world.weatherIndex++;
  const ambient = getAmbientTemperature();
  const roll = hash01(state.seed, index, 0, 981, state.seed);
  let kind = 'clear';
  let intensity = 0;
  let windSpeed = 1.2 + hash01(state.seed, index, 0, 982, state.seed) * 2;
  if (roll > 0.94) {
    kind = ambient < 1 ? 'snow' : 'storm';
    intensity = 0.75 + hash01(state.seed, index, 0, 983, state.seed) * 0.25;
    windSpeed = 7 + hash01(state.seed, index, 0, 984, state.seed) * 8;
  } else if (roll > 0.79) {
    kind = ambient < 1 ? 'snow' : 'rain';
    intensity = 0.38 + hash01(state.seed, index, 0, 985, state.seed) * 0.5;
    windSpeed = 3.5 + hash01(state.seed, index, 0, 986, state.seed) * 5;
  } else if (roll > 0.68) {
    kind = 'fog';
    intensity = 0.55 + hash01(state.seed, index, 0, 987, state.seed) * 0.4;
    windSpeed = 0.7 + hash01(state.seed, index, 0, 988, state.seed) * 2;
  } else if (roll > 0.42) {
    kind = 'cloudy';
    intensity = 0.3 + hash01(state.seed, index, 0, 989, state.seed) * 0.45;
    windSpeed = 2.2 + hash01(state.seed, index, 0, 990, state.seed) * 3.2;
  }
  state.world.weather = { kind, label: BIOME_LABELS[kind] || kind[0].toUpperCase() + kind.slice(1), intensity, windSpeed };
  worldRef.setWeather(kind, intensity, windSpeed);
  state.world.nextWeatherAt = state.simSeconds + 240 + hash01(state.seed, index, 0, 991, state.seed) * 360;
  emit('weather', state.world.weather);
}

function updateTimeAndWeather(dt) {
  state.simSeconds += dt;
  const previousHours = state.world.hours;
  state.world.hours = (state.world.hours + dt * 24 / state.world.dayLength) % 24;
  if (state.world.hours < previousHours) state.world.day++;
  if (state.simSeconds >= state.world.nextWeatherAt) chooseWeather();
}

function updateStructures(dt) {
  const rain = ['rain', 'storm'].includes(state.world.weather.kind) ? state.world.weather.intensity : 0;
  for (const fire of state.structures.fires) {
    if (!fire.lit) continue;
    fire.fuel = Math.max(0, fire.fuel - dt);
    fire.wetness = clamp(fire.wetness + dt * rain * 0.035, 0, 1);
    if (fire.fuel <= 0 || fire.wetness >= 1) {
      fire.lit = false;
      emit('toast', { text: fire.fuel <= 0 ? 'Your campfire burned out.' : 'Rain extinguished your campfire.' });
    }
  }
}

function movePlayer(dt, input) {
  const player = state.player;
  player.attackCooldown = Math.max(0, player.attackCooldown - dt);
  let moveX = (input?.moveX || 0) + joy.x;
  let moveY = (input?.moveY || 0) - joy.y;
  const magnitude = Math.hypot(moveX, moveY);
  if (magnitude > 1) {
    moveX /= magnitude;
    moveY /= magnitude;
  }
  const movement = magnitude > 0.08;
  player.crouching = !!input?.crouch && !player.inWater;
  const wantsSprint = !!input?.sprint && !player.crouching && movement && player.stamina > 4;
  player.sprinting = wantsSprint;
  const weightFactor = clamp(1 - Math.max(0, totalWeight(state.inventory) - 20) * 0.012, 0.58, 1);
  let speed = player.crouching ? 1.55 : wantsSprint ? 5.4 : 3.15;
  if (player.inWater) speed *= 0.52;
  speed *= weightFactor;
  forward.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  right.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  const previousX = player.position.x;
  const previousZ = player.position.z;
  const nextX = player.position.x + (right.x * moveX + forward.x * moveY) * speed * dt;
  const nextZ = player.position.z + (right.z * moveX + forward.z * moveY) * speed * dt;
  const nextHeight = worldRef.heightAt(nextX, nextZ);
  if (nextHeight >= 0 || normalAt(worldRef.field, nextX, nextZ).y > 0.56) {
    player.position.x = nextX;
    player.position.z = nextZ;
  }
  for (const tree of worldRef.getNearbyTrees({ x: nextX, z: nextZ }, 1.2)) {
    const dx = player.position.x - tree.x;
    const dz = player.position.z - tree.z;
    const distance = Math.hypot(dx, dz);
    const minimum = tree.radius + 0.34;
    if (distance > 0.001 && distance < minimum) {
      player.position.x = tree.x + dx / distance * minimum;
      player.position.z = tree.z + dz / distance * minimum;
    }
  }
  const travelled = Math.hypot(player.position.x - previousX, player.position.z - previousZ);
  state.stats.distanceTravelled += travelled;
  player.stepDistance += travelled;
  if (player.stepDistance > 2.1) {
    player.stepDistance = 0;
    emit('footstep', { surface: player.inWater ? 'water' : nextHeight > 55 ? 'stone' : 'ground', sprinting: player.sprinting });
  }
  const ground = worldRef.heightAt(player.position.x, player.position.z);
  player.inWater = ground < -0.15;
  if (input?.jump) {
    if (player.inWater) player.velocityY = 2.2;
    else if (player.grounded) {
      player.velocityY = 4.6;
      player.stamina = Math.max(0, player.stamina - 8);
      player.grounded = false;
    }
  }
  if (player.inWater) {
    const targetY = Math.max(ground, -1.35);
    player.position.y += (targetY - player.position.y) * Math.min(1, dt * 7);
    player.velocityY *= Math.exp(-dt * 4);
  } else {
    player.velocityY -= 18 * dt;
    player.position.y += player.velocityY * dt;
    if (player.position.y <= ground) {
      player.position.y = ground;
      player.velocityY = 0;
      player.grounded = true;
    } else {
      player.grounded = false;
    }
  }
  updateNeeds(dt, movement && player.sprinting);
  updateAction(dt, movement);
  return movement;
}

function updateCamera(dt, snap = false) {
  const player = state.player;
  const eyeHeight = player.crouching ? 1.2 : player.inWater ? 1.05 : 1.68;
  scratch.set(player.position.x, player.position.y + eyeHeight, player.position.z);
  worldRef.toLocal(scratch, scratchLocal);
  if (cameraShake > 0.01) {
    scratchLocal.x += (Math.random() - 0.5) * cameraShake * 0.06;
    scratchLocal.y += (Math.random() - 0.5) * cameraShake * 0.05;
  }
  if (snap) cameraRef.position.copy(scratchLocal);
  else cameraRef.position.lerp(scratchLocal, Math.min(1, dt * 18));
  cameraRef.rotation.order = 'YXZ';
  cameraRef.rotation.set(player.pitch, player.yaw, 0);
}

function updateDiscoveries() {
  for (const landmark of worldRef.getNearbyLandmarks(state.player.position, 14)) {
    if (!state.discoveries.landmarks[landmark.id]) discoverLandmark(landmark);
  }
}

function objectiveProgress(id) {
  const objective = state.objectives.find(item => item.id === id);
  if (!objective || objective.complete) return;
  let complete = false;
  if (id === 'supplies') complete = getItemCount('wood') >= 3 && getItemCount('stone') >= 2;
  if (id === 'fire') complete = state.structures.fires.some(fire => fire.lit);
  if (id === 'spear') complete = getItemCount('spear') > 0;
  if (id === 'shelter') complete = state.structures.shelters.length > 0;
  if (id === 'landmark') complete = Object.keys(state.discoveries.landmarks).length > 0;
  if (id === 'dawn') complete = state.world.day > 1 && state.player.health > 0;
  if (!complete) return;
  objective.complete = true;
  objective.progress = objective.target;
  emit('objective', { objective });
  emit('toast', { text: `Objective complete: ${objective.label}` });
}

function updateObjectives() {
  for (const objective of state.objectives) objectiveProgress(objective.id);
}

function updateFeedback(dt) {
  hurtFlash = Math.max(0, hurtFlash - dt * 1.9);
  hitMarker = Math.max(0, hitMarker - dt * 3.5);
  cameraShake = Math.max(0, cameraShake - dt * 2.8);
  if (hurtFlash <= 0) damageDirection = null;
}

function getHeading() {
  return ((THREE.MathUtils.radToDeg(-state.player.yaw) % 360) + 360) % 360;
}

function publishSnapshot(force = false) {
  if (!force && snapshotAccumulator < 0.1) return;
  snapshotAccumulator = 0;
  const player = state.player;
  const biome = worldRef.biomeAt(player.position.x, player.position.z);
  const selected = getSelectedItem();
  const activeObjective = state.objectives.find(objective => !objective.complete);
  callbacks.onUpdate?.({
    phase: state.phase,
    paused,
    player: {
      health: player.health,
      hunger: player.hunger,
      thirst: player.thirst,
      stamina: player.stamina,
      warmth: player.warmth,
      temperature: player.bodyTemperature,
      wetness: player.wetness,
      sickness: player.sickness,
      bleeding: player.bleeding,
      position: { ...player.position },
      speed: player.sprinting ? 5.4 : player.crouching ? 1.55 : 3.15,
      inWater: player.inWater,
    },
    world: {
      ...state.world,
      biome,
      biomeLabel: BIOME_LABELS[biome] || 'Wilderness',
      heading: getHeading(),
      nearbyHostiles: state.entities.filter(entity => entity.hostile && !entity.dead && Math.hypot(entity.position.x - player.position.x, entity.position.z - player.position.z) < 55).length,
    },
    target,
    action: player.action ? { ...player.action, progress: player.action.elapsed / player.action.duration } : null,
    crafting: state.crafting ? { ...state.crafting, progress: state.crafting.elapsed / state.crafting.duration } : null,
    selectedSlot: state.selectedSlot,
    selectedItem: selected,
    equipment: { ...state.equipment },
    inventory: inventoryEntries(state.inventory),
    weight: totalWeight(state.inventory),
    capacity: 35,
    hotbar: HOTBAR.map((id, index) => ({ id, index, label: itemLabel(id), amount: getItemCount(id), selected: index === state.selectedSlot })),
    recipes: Object.entries(RECIPES).map(([id, recipe]) => ({ id, label: recipe.label, station: recipe.station || 'hand', available: canCraft(state.inventory, id), fireReady: isNearFire(recipe) })),
    objectives: state.objectives.map(objective => ({ ...objective })),
    activeObjective,
    discoveries: {
      landmarks: Object.entries(state.discoveries.landmarks).map(([id, value]) => ({ id, ...value, label: value.type[0].toUpperCase() + value.type.slice(1) })),
      wildlife: Object.entries(state.discoveries.wildlife).map(([id, value]) => ({ id, ...value, label: id[0].toUpperCase() + id.slice(1) })),
    },
    entities: state.entities.map(entity => ({ id: entity.id, type: entity.type, x: entity.position.x, y: entity.position.y, z: entity.position.z, dead: entity.dead })),
    structures: {
      fires: state.structures.fires.map(fire => ({ ...fire })),
      shelters: state.structures.shelters.map(shelter => ({ ...shelter })),
    },
    feedback: { hurtFlash, hitMarker, damageDirection },
    dialogue: state.dialogue ? { ...state.dialogue } : null,
    npcs: state.npcs.map(npc => ({ id: npc.id, name: npc.name, role: npc.role, x: npc.position.x, y: npc.position.y, z: npc.position.z })),
    stats: { ...state.stats },
  });
}

export function isGameActive() {
  return active;
}

export function isGamePaused() {
  return paused;
}

export function addLook(deltaX, deltaY, sensitivity = 0.0022) {
  if (!active || paused || state.phase !== 'running') return;
  state.player.yaw -= deltaX * sensitivity;
  state.player.pitch = clamp(state.player.pitch - deltaY * sensitivity, -1.48, 1.48);
}

export function setJoystick(x, y) {
  joy.x = clamp(x, -1, 1);
  joy.y = clamp(y, -1, 1);
}

export function startGame(scene, camera, world, nextCallbacks = {}) {
  stopGame();
  sceneRef = scene;
  cameraRef = camera;
  worldRef = world;
  callbacks = nextCallbacks;
  state = createInitialState(world.seed, world.spawn);
  const ranger = state.npcs[0];
  ranger.position.y = world.heightAt(ranger.position.x, ranger.position.z);
  if (ranger.position.y < 0.4) {
    ranger.position.x = world.spawn.x - 4.5;
    ranger.position.z = world.spawn.z - 2.5;
    ranger.position.y = world.heightAt(ranger.position.x, ranger.position.z);
  }
  active = true;
  paused = false;
  target = null;
  updateAccumulator = 0;
  snapshotAccumulator = 0;
  worldRef.setWeather('clear', 0, 1.4);
  updateCamera(0, true);
  seedWildlife();
  publishSnapshot(true);
  return state;
}

export function stopGame() {
  if (sceneRef) clearVisuals();
  active = false;
  paused = false;
  joy.x = joy.y = 0;
  target = null;
  hurtFlash = 0;
  hitMarker = 0;
  cameraShake = 0;
  damageDirection = null;
  state = null;
  sceneRef = null;
  cameraRef = null;
  worldRef = null;
  callbacks = {};
}

export function setGamePaused(value, reason = 'menu') {
  if (!active) return;
  paused = !!value;
  if (paused) {
    joy.x = joy.y = 0;
    updateAccumulator = 0;
    emit('save');
  }
  publishSnapshot(true);
}

export function dispatchGameCommand(command, payload) {
  if (!active || state.phase === 'dead' && command !== 'respawn') return;
  if (command === 'interact') interact();
  else if (command === 'attack') attack();
  else if (command === 'craft') craft(payload);
  else if (command === 'place') placeStructure();
  else if (command === 'equip') equipItem(payload);
  else if (command === 'drop') dropItem(payload?.id, payload?.amount);
  else if (command === 'consume') consumeItem(payload);
  else if (command === 'use') useSelected();
  else if (command === 'rest') restUntilDawn();
  else if (command === 'closeDialogue') {
    state.dialogue = null;
    emit('dialogue', null);
  } else if (command === 'respawn') respawn();
  else if (command === 'hotbar') {
    const index = Number(payload);
    if (Number.isInteger(index) && index >= 0 && index < HOTBAR.length) state.selectedSlot = index;
  } else if (command === 'togglePause') setGamePaused(!paused);
}

export function updateGame(dt, camera, input) {
  if (!active || !state || !worldRef) return;
  snapshotAccumulator += dt;
  targetAccumulator += dt;
  updateFeedback(dt);
  if (paused || state.phase === 'dead') {
    syncVisuals();
    publishSnapshot();
    return;
  }
  if (!worldRef.isReady(state.player.position)) {
    state.phase = 'loading';
    syncVisuals();
    publishSnapshot();
    return;
  }
  if (state.phase === 'loading') {
    state.phase = 'running';
    emit('toast', { text: 'Survey the land, gather supplies, and survive the first night.' });
  }
  updateAccumulator += Math.min(dt, 0.1);
  const step = 1 / 60;
  let steps = 0;
  while (updateAccumulator >= step && steps < 6) {
    updateTimeAndWeather(step);
    movePlayer(step, input);
    updateCrafting(step);
    updateStructures(step);
    updateWildlife(step);
    updateObjectives();
    updateAccumulator -= step;
    steps++;
  }
  if (steps === 6) updateAccumulator = 0;
  if (targetAccumulator >= 0.08) {
    targetAccumulator = 0;
    target = getInteractionTarget();
    if (state.player.action && state.player.action.data?.node?.active === false) cancelAction('Resource depleted');
  }
  updateDiscoveries();
  updateCamera(dt);
  syncVisuals();
  if (state.simSeconds >= state.world.autosaveAt) {
    state.world.autosaveAt = state.simSeconds + 30;
    emit('save');
  }
  publishSnapshot();
}

export function getGameState() {
  return state;
}

export function getSelectedGameItem() {
  return state ? getSelectedItem() : null;
}

export function getSaveData() {
  if (!state) return null;
  const savedState = JSON.parse(JSON.stringify(state));
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    worldElapsed: worldRef?.elapsed || 0,
    state: savedState,
    resources: worldRef?.getResourceStates ? worldRef.getResourceStates() : [],
  };
}

export function loadSaveData(data) {
  if (!data || data.version !== SAVE_VERSION || !data.state || !worldRef) return false;
  if ((Number(data.state.seed) >>> 0) !== (Number(worldRef.seed) >>> 0)) return false;
  clearVisuals();
  state = JSON.parse(JSON.stringify(data.state));
  state.schemaVersion = SAVE_VERSION;
  state.phase = state.phase === 'dead' ? 'dead' : 'running';
  if (state.crafting && !RECIPES[state.crafting.recipeId]) state.crafting = null;
  state.player.action = null;
  state.structures ||= { fires: [], shelters: [] };
  state.entities ||= [];
  state.npcs ||= [];
  state.dialogue = null;
  state.discoveries ||= { landmarks: {}, wildlife: {} };
  worldRef.elapsed = Number(data.worldElapsed) || 0;
  for (const resource of data.resources || []) worldRef.restoreResource(resource.id, !resource.depletedAt, resource.depletedAt);
  for (const fire of state.structures.fires) createFireVisual(fire);
  for (const shelter of state.structures.shelters) createShelterVisual(shelter);
  for (const entity of state.entities) {
    const group = createAnimalModel(entity.type);
    sceneRef.add(group);
    entityVisuals.set(entity.id, group);
  }
  for (const npc of state.npcs) createNpcVisual(npc);
  worldRef.setWeather(state.world.weather.kind, state.world.weather.intensity, state.world.weather.windSpeed);
  updateCamera(0, true);
  syncVisuals();
  publishSnapshot(true);
  return true;
}

export function forceSnapshot() {
  if (active) publishSnapshot(true);
}

export function getGameWorldTime() {
  return state?.world.hours ?? 8;
}

export function getGameDay() {
  return state?.world.day ?? 1;
}

export function currentBiomeLabel() {
  if (!state || !worldRef) return 'Wilderness';
  return BIOME_LABELS[worldRef.biomeAt(state.player.position.x, state.player.position.z)] || 'Wilderness';
}

export function gameTarget() {
  return target;
}

export function gameNotice() {
  return lastNotice;
}

export function playerPosition() {
  return state?.player.position || null;
}

export function playerStats() {
  if (!state) return null;
  const total = Math.max(1, state.stats.distanceTravelled);
  return { ...state.stats, efficiency: clamp01(state.stats.resourcesGathered / total * 100) };
}
