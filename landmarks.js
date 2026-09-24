import * as THREE from 'three';
import { hash01, TAU } from './rng.js';
import { CHUNK_SIZE, groundHeight, normalAt } from './terrain.js';

const CELL_SIZE = 320;
const stoneMaterial = new THREE.MeshStandardMaterial({ color: 0x696861, roughness: 1 });
const darkStoneMaterial = new THREE.MeshStandardMaterial({ color: 0x4c504b, roughness: 1 });
const woodMaterial = new THREE.MeshStandardMaterial({ color: 0x59432e, roughness: 1 });
const waterMaterial = new THREE.MeshStandardMaterial({ color: 0x4c8992, roughness: 0.22, transparent: true, opacity: 0.82, side: THREE.DoubleSide });
const geometry = {
  rock: new THREE.IcosahedronGeometry(0.75, 1),
  slab: new THREE.BoxGeometry(1.4, 0.5, 0.9),
  column: new THREE.CylinderGeometry(0.42, 0.5, 2.8, 7),
  post: new THREE.BoxGeometry(0.22, 3.8, 0.22),
  beam: new THREE.BoxGeometry(2.8, 0.22, 0.22),
  platform: new THREE.BoxGeometry(3.4, 0.25, 3.4),
  water: new THREE.CircleGeometry(1.65, 24),
};
geometry.water.rotateX(-Math.PI / 2);

const labelByType = Object.freeze({
  spring: 'Fresh spring',
  ruin: 'Weathered ruins',
  lookout: 'High lookout',
  cairn: 'Traveler cairn',
});

function landmarkDefinition(field, x, z) {
  const cellX = Math.floor(x / CELL_SIZE);
  const cellZ = Math.floor(z / CELL_SIZE);
  if (hash01(cellX, cellZ, 0, 741, field.seed) > 0.23) return null;
  const typeRoll = hash01(cellX, cellZ, 0, 742, field.seed);
  const type = typeRoll < 0.3 ? 'spring' : typeRoll < 0.55 ? 'ruin' : typeRoll < 0.76 ? 'lookout' : 'cairn';
  return {
    id: `landmark:${type}:${cellX}:${cellZ}`,
    type,
    label: labelByType[type],
    x,
    z,
    rotation: hash01(cellX, cellZ, 0, 743, field.seed) * TAU,
  };
}

function addMesh(group, geometryValue, material, x, y, z, rotationX = 0, rotationY = 0, rotationZ = 0) {
  const mesh = new THREE.Mesh(geometryValue, material);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rotationX, rotationY, rotationZ);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function buildSpring(group, definition) {
  for (let i = 0; i < 9; i++) {
    const angle = i / 9 * TAU;
    addMesh(group, geometry.rock, i % 2 ? stoneMaterial : darkStoneMaterial, Math.cos(angle) * 1.8, 0.2, Math.sin(angle) * 1.8, 0.1, -angle, 0.08);
  }
  addMesh(group, geometry.water, waterMaterial, 0, 0.08, 0);
  addMesh(group, geometry.post, woodMaterial, 2.4, 0.7, 0.3, 0, 0, 0.12);
  addMesh(group, geometry.beam, woodMaterial, 1.35, 1.25, 0.3, 0, 0, 0.12);
}

function buildRuin(group, definition) {
  const positions = [[-1.4, -1], [1.4, -1], [-1.4, 1.3], [1.4, 1.3]];
  for (let i = 0; i < positions.length; i++) {
    const [x, z] = positions[i];
    addMesh(group, geometry.column, i === 3 ? darkStoneMaterial : stoneMaterial, x, 1.25, z, 0, definition.rotation, i === 2 ? 0.08 : 0);
  }
  addMesh(group, geometry.slab, darkStoneMaterial, 0.5, 0.18, 0.2, 0.06, definition.rotation + 0.4, 0.08);
  addMesh(group, geometry.slab, stoneMaterial, -0.7, 0.15, 0.8, 0.1, definition.rotation - 0.2, -0.05);
}

function buildLookout(group, definition) {
  addMesh(group, geometry.platform, woodMaterial, 0, 2.35, 0);
  for (const [x, z] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) {
    addMesh(group, geometry.post, woodMaterial, x, 1.15, z, 0, definition.rotation, 0);
  }
  for (const z of [-1.4, 1.4]) {
    addMesh(group, geometry.beam, woodMaterial, 0, 2.9, z, 0, definition.rotation, Math.PI / 2);
  }
  addMesh(group, geometry.rock, darkStoneMaterial, 2.8, 0.35, -1.2, 0.1, definition.rotation, 0.1);
}

function buildCairn(group, definition) {
  const heights = [0.5, 0.8, 1.15, 1.5, 1.85];
  for (let i = 0; i < heights.length; i++) {
    addMesh(group, geometry.rock, i % 2 ? stoneMaterial : darkStoneMaterial, Math.sin(i * 2.1) * 0.12, heights[i], Math.cos(i * 1.7) * 0.1, i * 0.1, definition.rotation + i * 0.4, i * 0.08);
  }
}

export function buildLandmarkChunk(field, cx, cz) {
  const group = new THREE.Group();
  const landmarks = [];
  const minX = cx * CHUNK_SIZE;
  const minZ = cz * CHUNK_SIZE;
  for (let oz = -1; oz <= 2; oz++) {
    for (let ox = -1; ox <= 2; ox++) {
      const cellX = Math.floor(minX / CELL_SIZE) + ox;
      const cellZ = Math.floor(minZ / CELL_SIZE) + oz;
      const base = landmarkDefinition(field, cellX * CELL_SIZE, cellZ * CELL_SIZE);
      if (!base) continue;
      const x = cellX * CELL_SIZE + 55 + hash01(cellX, cellZ, 0, 744, field.seed) * 210;
      const z = cellZ * CELL_SIZE + 55 + hash01(cellX, cellZ, 0, 745, field.seed) * 210;
      if (x < minX || x >= minX + CHUNK_SIZE || z < minZ || z >= minZ + CHUNK_SIZE) continue;
      const y = groundHeight(field, x, z);
      if (y < 1 || normalAt(field, x, z).y < 0.76) continue;
      const definition = { ...base, x, y, z };
      const landmarkGroup = new THREE.Group();
      landmarkGroup.position.set(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE);
      if (typeBuilders[definition.type]) typeBuilders[definition.type](landmarkGroup, definition);
      group.add(landmarkGroup);
      landmarks.push(definition);
    }
  }
  return { group, landmarks };
}

const typeBuilders = {
  spring: buildSpring,
  ruin: buildRuin,
  lookout: buildLookout,
  cairn: buildCairn,
};

export function buildGuaranteedLandmark(field, x, z) {
  const y = groundHeight(field, x, z);
  const group = new THREE.Group();
  const landmark = {
    id: `landmark:cache:${Math.floor(x / 8)}:${Math.floor(z / 8)}`,
    type: 'cairn',
    label: "Ranger's cache",
    x,
    y,
    z,
    rotation: hash01(Math.floor(x / 8), Math.floor(z / 8), 0, 746, field.seed) * TAU,
  };
  buildCairn(group, landmark);
  return { group, landmark };
}

export function disposeLandmarkChunk(chunk) {
  if (!chunk) return;
  chunk.group.parent?.remove(chunk.group);
  chunk.group.clear();
  chunk.landmarks.length = 0;
}
