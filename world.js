import * as THREE from 'three';
import { buildForestChunk, disposeForestChunk } from './forest.js';
import { buildGrassChunk, disposeGrassChunk } from './grass.js';
import { buildGuaranteedLandmark, buildLandmarkChunk, disposeLandmarkChunk } from './landmarks.js';
import { buildResourceChunk, disposeResourceChunk, setResourceNodeActive } from './resources.js';
import {
  BIOMES,
  CHUNK_SIZE,
  buildTerrainChunk,
  buildWaterChunk,
  chunkKey,
  createTerrainField,
  findSpawn,
  groundHeight,
  biomeAt,
  surfaceAt,
} from './terrain.js';
import { createWeather, disposeWeather, setWeather, updateWeather } from './weather.js';

const DEFAULT_RADIUS = 2;
const KEEP_RADIUS = 3;
const REBASE_DISTANCE = 4096;

export function createWorld(scene, seed, options = {}) {
  const field = createTerrainField(seed);
  const root = new THREE.Group();
  root.name = 'survival-world';
  scene.add(root);
  const chunks = new Map();
  const resourceIndex = new Map();
  const resourceStates = new Map();
  const queue = [];
  const queued = new Set();
  const weather = createWeather(scene);
  const world = {
    scene,
    field,
    seed: field.seed,
    root,
    chunks,
    weather,
    spawn: findSpawn(field),
    origin: new THREE.Vector2(),
    logicalPosition: new THREE.Vector3(),
    renderRadius: options.renderRadius ?? DEFAULT_RADIUS,
    detail: options.detail ?? 1,
    elapsed: 0,
    building: 0,
    ready: false,
  };

  function queueAround(x, z) {
    const centerX = Math.floor(x / CHUNK_SIZE);
    const centerZ = Math.floor(z / CHUNK_SIZE);
    const candidates = [];
    const radius = world.renderRadius;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const cx = centerX + dx;
        const cz = centerZ + dz;
        const key = chunkKey(cx, cz);
        if (chunks.has(key) || queued.has(key)) continue;
        candidates.push({ cx, cz, key, distance: dx * dx + dz * dz });
      }
    }
    candidates.sort((a, b) => a.distance - b.distance || a.key.localeCompare(b.key));
    for (const candidate of candidates) {
      queue.push(candidate);
      queued.add(candidate.key);
    }
    world.building = queue.length;
  }

  function buildChunk(cx, cz, key) {
    const group = new THREE.Group();
    group.position.set(cx * CHUNK_SIZE - world.origin.x, 0, cz * CHUNK_SIZE - world.origin.y);
    const terrain = buildTerrainChunk(field, cx, cz, world.detail >= 1 ? 16 : 12);
    group.add(terrain.mesh);
    const water = terrain.minHeight < -0.05 ? buildWaterChunk(cx, cz) : null;
    if (water) group.add(water);
    const forest = buildForestChunk(field, cx, cz, world.detail);
    group.add(forest.group);
    const grass = buildGrassChunk(field, cx, cz, world.detail);
    group.add(grass.group);
    const resources = buildResourceChunk(field, cx, cz);
    group.add(resources.group);
    for (const node of resources.nodes) {
      const saved = resourceStates.get(node.id);
      if (saved && !saved.active) {
        node.depletedAt = saved.depletedAt;
        setResourceNodeActive(node, false);
      }
      resourceIndex.set(node.id, node);
    }
    const landmarks = buildLandmarkChunk(field, cx, cz);
    if (cx === Math.floor(world.spawn.x / CHUNK_SIZE) && cz === Math.floor(world.spawn.z / CHUNK_SIZE) && !landmarks.landmarks.length) {
      const guaranteedX = Math.max(cx * CHUNK_SIZE + 8, Math.min((cx + 1) * CHUNK_SIZE - 8, world.spawn.x + 7));
      const guaranteedZ = Math.max(cz * CHUNK_SIZE + 8, Math.min((cz + 1) * CHUNK_SIZE - 8, world.spawn.z - 5));
      const guaranteed = buildGuaranteedLandmark(field, guaranteedX, guaranteedZ);
      landmarks.group.add(guaranteed.group);
      landmarks.landmarks.push(guaranteed.landmark);
    }
    group.add(landmarks.group);
    const chunk = { key, cx, cz, group, terrain, water, forest, grass, resources, landmarks, version: 0 };
    chunks.set(key, chunk);
    root.add(group);
    queued.delete(key);
    const index = queue.findIndex(item => item.key === key);
    if (index >= 0) queue.splice(index, 1);
    world.building = queue.length;
  }

  function processQueue() {
    const start = performance.now();
    let built = 0;
    while (queue.length && performance.now() - start < 7) {
      const item = queue.shift();
      queued.delete(item.key);
      if (chunks.has(item.key)) continue;
      buildChunk(item.cx, item.cz, item.key);
      built++;
      if (built >= 1) break;
    }
    world.building = queue.length;
    const centerX = Math.floor(world.logicalPosition.x / CHUNK_SIZE);
    const centerZ = Math.floor(world.logicalPosition.z / CHUNK_SIZE);
    world.ready = chunks.has(chunkKey(centerX, centerZ)) && queue.length < 25;
    return built;
  }

  function unloadFarChunks() {
    const centerX = Math.floor(world.logicalPosition.x / CHUNK_SIZE);
    const centerZ = Math.floor(world.logicalPosition.z / CHUNK_SIZE);
    for (const [key, chunk] of chunks) {
      const distance = Math.max(Math.abs(chunk.cx - centerX), Math.abs(chunk.cz - centerZ));
      if (distance <= KEEP_RADIUS) continue;
      resourceIndex.delete(chunk.resources.nodes[0]?.id);
      for (const node of chunk.resources.nodes) resourceIndex.delete(node.id);
      disposeForestChunk(chunk.forest);
      disposeGrassChunk(chunk.grass);
      disposeResourceChunk(chunk.resources);
      disposeLandmarkChunk(chunk.landmarks);
      chunk.terrain.mesh.geometry.dispose();
      chunk.water?.geometry.dispose();
      root.remove(chunk.group);
      chunk.group.clear();
      chunks.delete(key);
    }
  }

  function rebaseIfNeeded(camera) {
    const dx = world.logicalPosition.x - world.origin.x;
    const dz = world.logicalPosition.z - world.origin.y;
    if (Math.hypot(dx, dz) < REBASE_DISTANCE) return;
    if (camera) {
      camera.position.x -= dx;
      camera.position.z -= dz;
    }
    for (const particle of weather.particles) {
      particle.x -= dx;
      particle.z -= dz;
    }
    world.origin.set(world.logicalPosition.x, world.logicalPosition.z);
    for (const chunk of chunks.values()) {
      chunk.group.position.set(chunk.cx * CHUNK_SIZE - world.origin.x, 0, chunk.cz * CHUNK_SIZE - world.origin.y);
    }
  }

  world.update = (dt, camera, simulationSeconds = null) => {
    if (simulationSeconds != null) world.elapsed = simulationSeconds;
    for (const node of resourceIndex.values()) {
      if (!node.active && node.depletedAt && world.elapsed - node.depletedAt > 240) {
        setResourceNodeActive(node, true);
        node.depletedAt = null;
        resourceStates.delete(node.id);
      }
    }
    world.toLogical(camera.position, world.logicalPosition);
    const cx = Math.floor(world.logicalPosition.x / CHUNK_SIZE);
    const cz = Math.floor(world.logicalPosition.z / CHUNK_SIZE);
    queueAround(world.logicalPosition.x, world.logicalPosition.z);
    processQueue();
    unloadFarChunks();
    rebaseIfNeeded(camera);
    updateWeather(weather, dt, camera);
  };

  world.toLogical = (local, target = new THREE.Vector3()) => target.set(local.x + world.origin.x, local.y, local.z + world.origin.y);
  world.toLocal = (logical, target = new THREE.Vector3()) => target.set(logical.x - world.origin.x, logical.y, logical.z - world.origin.y);
  world.heightAt = (x, z) => groundHeight(field, x, z);
  world.surfaceAt = (x, z) => surfaceAt(field, x, z);
  world.biomeAt = (x, z) => biomeAt(field, x, z);
  world.isReady = position => chunks.has(chunkKey(Math.floor(position.x / CHUNK_SIZE), Math.floor(position.z / CHUNK_SIZE)));
  world.isWaterAt = (x, z) => groundHeight(field, x, z) < 0;
  world.setWeather = (kind, intensity, windSpeed) => setWeather(weather, kind, intensity, windSpeed);

  world.getNearbyResources = (position, radius = 4) => {
    const output = [];
    const radiusSquared = radius * radius;
    for (const node of resourceIndex.values()) {
      if (!node.active) continue;
      const dx = node.x - position.x;
      const dz = node.z - position.z;
      const dy = node.y - position.y;
      if (dx * dx + dz * dz + dy * dy * 0.35 > radiusSquared) continue;
      output.push(node);
    }
    return output;
  };

  world.getNearbyLandmarks = (position, radius = 5) => {
    const output = [];
    const radiusSquared = radius * radius;
    for (const chunk of chunks.values()) {
      for (const landmark of chunk.landmarks.landmarks) {
        const dx = landmark.x - position.x;
        const dz = landmark.z - position.z;
        if (dx * dx + dz * dz <= radiusSquared) output.push(landmark);
      }
    }
    return output;
  };

  world.getNearbyTrees = (position, radius = 3) => {
    const output = [];
    const radiusSquared = radius * radius;
    for (const chunk of chunks.values()) {
      for (const tree of chunk.forest.records) {
        const dx = tree.x - position.x;
        const dz = tree.z - position.z;
        if (dx * dx + dz * dz <= radiusSquared) output.push(tree);
      }
    }
    return output;
  };

  world.consumeResource = id => {
    const node = resourceIndex.get(id);
    if (!node || !node.active) return false;
    setResourceNodeActive(node, false);
    node.depletedAt = world.elapsed;
    resourceStates.set(id, { active: false, depletedAt: node.depletedAt });
    return true;
  };

  world.restoreResource = (id, active, depletedAt = null) => {
    if (active) resourceStates.delete(id);
    else resourceStates.set(id, { active: false, depletedAt: depletedAt ?? world.elapsed });
    const node = resourceIndex.get(id);
    if (!node) return;
    setResourceNodeActive(node, active);
    node.depletedAt = active ? null : depletedAt ?? world.elapsed;
  };

  world.getResourceDepletion = id => resourceIndex.get(id)?.depletedAt ?? null;
  world.getResourceStates = () => [...resourceStates.entries()].map(([id, value]) => ({ id, ...value }));
  world.getLoadedLandmarks = () => {
    const output = [];
    for (const chunk of chunks.values()) output.push(...chunk.landmarks.landmarks);
    return output;
  };
  world.getStats = () => ({
    chunks: chunks.size,
    queued: queue.length,
    resources: [...resourceIndex.values()].filter(node => node.active).length,
    origin: { x: world.origin.x, z: world.origin.y },
  });

  world.dispose = () => {
    for (const chunk of chunks.values()) {
      disposeForestChunk(chunk.forest);
      disposeGrassChunk(chunk.grass);
      disposeResourceChunk(chunk.resources);
      disposeLandmarkChunk(chunk.landmarks);
      chunk.terrain.mesh.geometry.dispose();
      chunk.water?.geometry.dispose();
    }
    chunks.clear();
    resourceIndex.clear();
    resourceStates.clear();
    queue.length = 0;
    queued.clear();
    root.clear();
    scene.remove(root);
    disposeWeather(weather);
  };

  queueAround(world.spawn.x, world.spawn.z);
  return world;
}

export { BIOMES, CHUNK_SIZE };
