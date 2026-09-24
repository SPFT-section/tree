import * as THREE from 'three';
import { TAU, clamp, clamp01, fbm2, hash01, lerp, ridged2, smoothstep, valueNoise2 } from './rng.js';

export const CHUNK_SIZE = 96;
export const TERRAIN_SEGMENTS = 16;
export const SEA_LEVEL = 0;

export const BIOMES = Object.freeze({
  OCEAN: 'ocean',
  LAKE: 'lake',
  RIVER: 'river',
  BEACH: 'beach',
  WETLAND: 'wetland',
  TEMPERATE_FOREST: 'temperate_forest',
  RAINFOREST: 'rainforest',
  BOREAL_FOREST: 'boreal_forest',
  SAVANNA: 'savanna',
  GRASSLAND: 'grassland',
  DESERT: 'desert',
  ALPINE: 'alpine',
  TUNDRA: 'tundra',
});

export const BIOME_LABELS = Object.freeze({
  [BIOMES.OCEAN]: 'Open water',
  [BIOMES.LAKE]: 'Mountain lake',
  [BIOMES.RIVER]: 'River valley',
  [BIOMES.BEACH]: 'Sandy shoreline',
  [BIOMES.WETLAND]: 'Wetland',
  [BIOMES.TEMPERATE_FOREST]: 'Temperate woodland',
  [BIOMES.RAINFOREST]: 'Dense rainforest',
  [BIOMES.BOREAL_FOREST]: 'Boreal forest',
  [BIOMES.SAVANNA]: 'Open savanna',
  [BIOMES.GRASSLAND]: 'Grassland',
  [BIOMES.DESERT]: 'Dry badlands',
  [BIOMES.ALPINE]: 'Alpine ridge',
  [BIOMES.TUNDRA]: 'Tundra',
});

const BIOME_COLORS = Object.freeze({
  [BIOMES.OCEAN]: 0x243c3c,
  [BIOMES.LAKE]: 0x294b50,
  [BIOMES.RIVER]: 0x315252,
  [BIOMES.BEACH]: 0xb9aa78,
  [BIOMES.WETLAND]: 0x48583a,
  [BIOMES.TEMPERATE_FOREST]: 0x405637,
  [BIOMES.RAINFOREST]: 0x294a2d,
  [BIOMES.BOREAL_FOREST]: 0x3d5142,
  [BIOMES.SAVANNA]: 0x827a49,
  [BIOMES.GRASSLAND]: 0x687147,
  [BIOMES.DESERT]: 0xaa8d61,
  [BIOMES.ALPINE]: 0x74766d,
  [BIOMES.TUNDRA]: 0x74796e,
});

export function createTerrainField(seed) {
  return { seed: (Number(seed) >>> 0) || 1 };
}

export function chunkKey(cx, cz) {
  return `${cx},${cz}`;
}

function pointSegmentDistance(x, z, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSquared = dx * dx + dz * dz || 1;
  const t = clamp01(((x - ax) * dx + (z - az) * dz) / lengthSquared);
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}

function riverInfluence(field, x, z) {
  const grid = 384;
  const gx = Math.floor(x / grid);
  const gz = Math.floor(z / grid);
  let best = 0;
  for (let oz = -1; oz <= 1; oz++) {
    for (let ox = -1; ox <= 1; ox++) {
      const nx = gx + ox;
      const nz = gz + oz;
      if (hash01(nx, nz, 0, 401, field.seed) > 0.31) continue;
      const direction = Math.floor(hash01(nx, nz, 0, 402, field.seed) * 4);
      const dx = direction === 0 ? 1 : direction === 1 ? 0 : direction === 2 ? -1 : 0;
      const dz = direction === 0 ? 0 : direction === 1 ? 1 : direction === 2 ? 0 : -1;
      const ax = nx * grid;
      const az = nz * grid;
      const bx = ax + dx * grid;
      const bz = az + dz * grid;
      const bend = (hash01(nx, nz, 0, 403, field.seed) - 0.5) * grid * 0.42;
      const mx = (ax + bx) * 0.5 - dz * bend;
      const mz = (az + bz) * 0.5 + dx * bend;
      const width = 6 + hash01(nx, nz, 0, 404, field.seed) * 9;
      const distance = Math.min(
        pointSegmentDistance(x, z, ax, az, mx, mz),
        pointSegmentDistance(x, z, mx, mz, bx, bz),
      );
      best = Math.max(best, 1 - smoothstep(width, width + 20, distance));
    }
  }
  return best;
}

export function temperatureAt(field, x, z, height = groundHeight(field, x, z)) {
  const latitude = 0.5 + 0.5 * Math.cos(TAU * (z + 1500) / 18000);
  return clamp01(
    0.48 + latitude * 0.34
    + (fbm2(x / 2800, z / 2800, 11, field.seed, 3) - 0.5) * 0.22
    - smoothstep(160, 820, height) * 0.62,
  );
}

export function moistureAt(field, x, z, height = groundHeight(field, x, z)) {
  return clamp01(
    0.5
    + (fbm2(x / 1500, z / 1500, 17, field.seed, 4) - 0.5) * 0.62
    + (fbm2(x / 420, z / 420, 23, field.seed, 3) - 0.5) * 0.2
    + riverInfluence(field, x, z) * 0.12,
  );
}

export function groundHeight(field, x, z) {
  const warpX = x + (fbm2(x / 1700, z / 1700, 29, field.seed, 3) - 0.5) * 240;
  const warpZ = z + (fbm2(x / 1700, z / 1700, 31, field.seed, 3) - 0.5) * 240;
  const continent = fbm2(warpX / 1450, warpZ / 1450, 1, field.seed, 5);
  const rough = fbm2(x / 210, z / 210, 3, field.seed, 4) - 0.5;
  const ridge = ridged2(warpX / 980, warpZ / 980, 5, field.seed, 4);
  const mountainMask = smoothstep(0.59, 0.79, continent) * smoothstep(0.38, 0.78, ridge);
  const mountain = ridge * mountainMask * 150;
  const lakeNoise = fbm2(warpX / 1900, warpZ / 1900, 37, field.seed, 4);
  let height = (continent - 0.5) * 48 + rough * 8 + mountain;
  const lake = smoothstep(0.67, 0.79, lakeNoise) * (1 - smoothstep(30, 95, Math.max(0, height)));
  if (lake > 0) height = lerp(height, Math.min(height, -4 - lake * 8), lake);
  const river = riverInfluence(field, x, z);
  if (river > 0) height = lerp(height, Math.min(height, -2.2 - river * 4.5), river * 0.92);
  return height;
}

export function biomeAt(field, x, z, height = groundHeight(field, x, z), temperature = temperatureAt(field, x, z, height), moisture = moistureAt(field, x, z, height), waterDepth = SEA_LEVEL - height) {
  if (height < SEA_LEVEL) return waterDepth > 10 ? BIOMES.OCEAN : BIOMES.LAKE;
  if (riverInfluence(field, x, z) > 0.3) return BIOMES.RIVER;
  if (height < 1.6) return BIOMES.BEACH;
  if (height > 640 || temperature < 0.25) return height > 640 ? BIOMES.ALPINE : BIOMES.TUNDRA;
  if (temperature < 0.43) return BIOMES.BOREAL_FOREST;
  if (temperature > 0.73 && moisture < 0.39) return BIOMES.DESERT;
  if (moisture > 0.72 && temperature > 0.5) return BIOMES.RAINFOREST;
  if (moisture < 0.38) return BIOMES.SAVANNA;
  if (height < 7 && moisture > 0.58) return BIOMES.WETLAND;
  if (moisture < 0.58) return BIOMES.GRASSLAND;
  return BIOMES.TEMPERATE_FOREST;
}

export function surfaceAt(field, x, z) {
  const height = groundHeight(field, x, z);
  const temperature = temperatureAt(field, x, z, height);
  const moisture = moistureAt(field, x, z, height);
  const biome = biomeAt(field, x, z, height, temperature, moisture, -height);
  return {
    height,
    temperature,
    moisture,
    biome,
    water: height < SEA_LEVEL,
    slope: normalAt(field, x, z).y,
  };
}

export function normalAt(field, x, z) {
  const e = 1.2;
  const left = groundHeight(field, x - e, z);
  const right = groundHeight(field, x + e, z);
  const back = groundHeight(field, x, z - e);
  const front = groundHeight(field, x, z + e);
  return new THREE.Vector3(left - right, 2 * e, back - front).normalize();
}

export function biomeColor(biome) {
  return new THREE.Color(BIOME_COLORS[biome] || BIOME_COLORS[BIOMES.GRASSLAND]);
}

export function forestDensity(field, x, z, biome) {
  const map = {
    [BIOMES.RAINFOREST]: 0.74,
    [BIOMES.TEMPERATE_FOREST]: 0.58,
    [BIOMES.BOREAL_FOREST]: 0.5,
    [BIOMES.WETLAND]: 0.36,
    [BIOMES.SAVANNA]: 0.13,
    [BIOMES.GRASSLAND]: 0.08,
    [BIOMES.BEACH]: 0.035,
    [BIOMES.TUNDRA]: 0.09,
    [BIOMES.ALPINE]: 0.035,
    [BIOMES.DESERT]: 0.012,
  };
  const moisture = moistureAt(field, x, z);
  return clamp01((map[biome] ?? 0) * (0.72 + moisture * 0.48));
}

export function grassDensity(field, x, z, biome) {
  const map = {
    [BIOMES.RAINFOREST]: 0.42,
    [BIOMES.TEMPERATE_FOREST]: 0.48,
    [BIOMES.BOREAL_FOREST]: 0.4,
    [BIOMES.WETLAND]: 0.86,
    [BIOMES.SAVANNA]: 0.7,
    [BIOMES.GRASSLAND]: 0.9,
    [BIOMES.TUNDRA]: 0.35,
    [BIOMES.ALPINE]: 0.38,
    [BIOMES.DESERT]: 0.12,
    [BIOMES.BEACH]: 0.24,
  };
  return clamp01(map[biome] ?? 0);
}

export function findSpawn(field) {
  for (let radius = 0; radius <= 2400; radius += 16) {
    const samples = radius === 0 ? 1 : Math.max(16, Math.floor(radius / 3));
    for (let i = 0; i < samples; i++) {
      const angle = i / samples * TAU + hash01(radius, i, 0, 881, field.seed) * 0.8;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const height = groundHeight(field, x, z);
      if (height < 3 || height > 38) continue;
      if (normalAt(field, x, z).y < 0.91) continue;
      const biome = biomeAt(field, x, z, height);
      if (biome === BIOMES.OCEAN || biome === BIOMES.LAKE || biome === BIOMES.RIVER) continue;
      return { x, y: height, z };
    }
  }
  return { x: 0, y: Math.max(3, groundHeight(field, 0, 0)), z: 0 };
}

export const terrainMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.98,
  metalness: 0,
});

export const waterMaterial = new THREE.MeshStandardMaterial({
  color: 0x416f78,
  roughness: 0.28,
  metalness: 0.05,
  transparent: true,
  opacity: 0.72,
  depthWrite: false,
  side: THREE.DoubleSide,
});

const color = new THREE.Color();
const beachColor = new THREE.Color(0xb9aa78);
const rockColor = new THREE.Color(0x68675d);
const patchColor = new THREE.Color();

export function buildTerrainChunk(field, cx, cz, segments = TERRAIN_SEGMENTS) {
  const count = (segments + 1) * (segments + 1);
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const indices = new Uint32Array(segments * segments * 6);
  const step = CHUNK_SIZE / segments;
  const extendedSize = segments + 3;
  const heights = new Float32Array(extendedSize * extendedSize);
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  for (let j = -1; j <= segments + 1; j++) {
    for (let i = -1; i <= segments + 1; i++) {
      const x = cx * CHUNK_SIZE + i * step;
      const z = cz * CHUNK_SIZE + j * step;
      const height = groundHeight(field, x, z);
      heights[(j + 1) * extendedSize + i + 1] = height;
      if (i >= 0 && i <= segments && j >= 0 && j <= segments) {
        minHeight = Math.min(minHeight, height);
        maxHeight = Math.max(maxHeight, height);
      }
    }
  }
  for (let j = 0; j <= segments; j++) {
    for (let i = 0; i <= segments; i++) {
      const index = j * (segments + 1) + i;
      const x = cx * CHUNK_SIZE + i * step;
      const z = cz * CHUNK_SIZE + j * step;
      const height = heights[(j + 1) * extendedSize + i + 1];
      const left = heights[(j + 1) * extendedSize + i];
      const right = heights[(j + 1) * extendedSize + i + 2];
      const back = heights[j * extendedSize + i + 1];
      const front = heights[(j + 2) * extendedSize + i + 1];
      const nx = (left - right) / (2 * step);
      const nz = (back - front) / (2 * step);
      const inverseLength = 1 / Math.hypot(nx, 1, nz);
      const biome = biomeAt(field, x, z, height);
      positions[index * 3] = i * step;
      positions[index * 3 + 1] = height;
      positions[index * 3 + 2] = j * step;
      normals[index * 3] = nx * inverseLength;
      normals[index * 3 + 1] = inverseLength;
      normals[index * 3 + 2] = nz * inverseLength;
      color.copy(biomeColor(biome));
      if (height > 80) color.lerp(rockColor, smoothstep(80, 260, height) * 0.72);
      if (height < 2.1) color.lerp(beachColor, 1 - smoothstep(0.3, 2.1, height));
      const patch = 0.9 + valueNoise2(x * 0.12, z * 0.12, 43, field.seed) * 0.2;
      patchColor.copy(color).multiplyScalar(patch);
      colors[index * 3] = patchColor.r;
      colors[index * 3 + 1] = patchColor.g;
      colors[index * 3 + 2] = patchColor.b;
    }
  }
  let cursor = 0;
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * (segments + 1) + i;
      const b = a + 1;
      const c = a + segments + 1;
      const d = c + 1;
      indices[cursor++] = a;
      indices[cursor++] = c;
      indices[cursor++] = b;
      indices[cursor++] = b;
      indices[cursor++] = c;
      indices[cursor++] = d;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, terrainMaterial);
  mesh.receiveShadow = true;
  return { mesh, minHeight, maxHeight };
}

export function buildWaterChunk(cx, cz) {
  const geometry = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, waterMaterial);
  mesh.position.set(CHUNK_SIZE * 0.5, SEA_LEVEL + 0.04, CHUNK_SIZE * 0.5);
  mesh.renderOrder = 2;
  return mesh;
}
