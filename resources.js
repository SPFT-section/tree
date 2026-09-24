import * as THREE from 'three';
import { hash01, TAU } from './rng.js';
import { BIOMES, CHUNK_SIZE, biomeAt, groundHeight, normalAt } from './terrain.js';

export const RESOURCE_TYPES = Object.freeze({
  WOOD: 'wood',
  STONE: 'stone',
  BERRY: 'berry',
  FIBER: 'fiber',
});

export const RESOURCE_INFO = Object.freeze({
  [RESOURCE_TYPES.WOOD]: { label: 'Fallen wood', verb: 'Gather', duration: 1.8 },
  [RESOURCE_TYPES.STONE]: { label: 'Stone outcrop', verb: 'Mine', duration: 2.1 },
  [RESOURCE_TYPES.BERRY]: { label: 'Berry bush', verb: 'Forage', duration: 1.1 },
  [RESOURCE_TYPES.FIBER]: { label: 'Wild fiber', verb: 'Harvest', duration: 0.9 },
});

const material = {
  wood: new THREE.MeshStandardMaterial({ color: 0x5a3d28, roughness: 1 }),
  woodEnd: new THREE.MeshStandardMaterial({ color: 0x9a774f, roughness: 1 }),
  stone: new THREE.MeshStandardMaterial({ color: 0x666660, roughness: 0.98 }),
  bush: new THREE.MeshStandardMaterial({ color: 0x365232, roughness: 1 }),
  berry: new THREE.MeshStandardMaterial({ color: 0x8d2630, roughness: 0.65 }),
  fiber: new THREE.MeshStandardMaterial({ color: 0x6f7138, roughness: 1 }),
};

const geometry = {
  wood: new THREE.CylinderGeometry(0.27, 0.34, 1.8, 7),
  stone: new THREE.IcosahedronGeometry(0.62, 1),
  berry: new THREE.IcosahedronGeometry(0.68, 1),
  fruit: new THREE.SphereGeometry(0.09, 6, 5),
  fiber: new THREE.ConeGeometry(0.38, 1.15, 5),
};
geometry.wood.rotateZ(Math.PI / 2);
geometry.fiber.translate(0, 0.52, 0);

const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const scale = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const euler = new THREE.Euler();
const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

function chooseType(field, x, z, biome) {
  const roll = hash01(Math.floor(x / 24), Math.floor(z / 24), 0, 731, field.seed);
  if (biome === BIOMES.DESERT) return roll < 0.52 ? RESOURCE_TYPES.STONE : RESOURCE_TYPES.FIBER;
  if (biome === BIOMES.ALPINE || biome === BIOMES.TUNDRA) return roll < 0.68 ? RESOURCE_TYPES.STONE : RESOURCE_TYPES.FIBER;
  if (biome === BIOMES.WETLAND) return roll < 0.3 ? RESOURCE_TYPES.WOOD : roll < 0.72 ? RESOURCE_TYPES.FIBER : RESOURCE_TYPES.BERRY;
  if (biome === BIOMES.GRASSLAND || biome === BIOMES.SAVANNA) return roll < 0.12 ? RESOURCE_TYPES.WOOD : roll < 0.48 ? RESOURCE_TYPES.BERRY : RESOURCE_TYPES.FIBER;
  return roll < 0.38 ? RESOURCE_TYPES.WOOD : roll < 0.66 ? RESOURCE_TYPES.BERRY : roll < 0.8 ? RESOURCE_TYPES.FIBER : RESOURCE_TYPES.STONE;
}

function createNodes(field, cx, cz) {
  const cellSize = 24;
  const startX = Math.floor(cx * CHUNK_SIZE / cellSize);
  const startZ = Math.floor(cz * CHUNK_SIZE / cellSize);
  const count = CHUNK_SIZE / cellSize;
  const nodes = [];
  for (let oz = 0; oz < count; oz++) {
    for (let ox = 0; ox < count; ox++) {
      const cellX = startX + ox;
      const cellZ = startZ + oz;
      if (hash01(cellX, cellZ, 0, 732, field.seed) > 0.73) continue;
      const x = cellX * cellSize + 2 + hash01(cellX, cellZ, 0, 733, field.seed) * (cellSize - 4);
      const z = cellZ * cellSize + 2 + hash01(cellX, cellZ, 0, 734, field.seed) * (cellSize - 4);
      if (x < cx * CHUNK_SIZE || x >= (cx + 1) * CHUNK_SIZE || z < cz * CHUNK_SIZE || z >= (cz + 1) * CHUNK_SIZE) continue;
      const y = groundHeight(field, x, z);
      if (y < 0.55 || normalAt(field, x, z).y < 0.7) continue;
      const biome = biomeAt(field, x, z, y);
      if (biome === BIOMES.OCEAN || biome === BIOMES.LAKE || biome === BIOMES.RIVER || biome === BIOMES.BEACH) continue;
      const type = chooseType(field, x, z, biome);
      nodes.push({
        id: `resource:${type}:${cellX}:${cellZ}`,
        type,
        x,
        y,
        z,
        chunkX: cx,
        chunkZ: cz,
        rotation: hash01(cellX, cellZ, 0, 735, field.seed) * TAU,
        size: 0.76 + hash01(cellX, cellZ, 0, 736, field.seed) * 0.52,
        tint: hash01(cellX, cellZ, 0, 737, field.seed),
        active: true,
        transforms: [],
      });
    }
  }
  return nodes;
}

function setTransform(node, mesh, index, x, y, z, scaleValue) {
  position.set(node.x - node.chunkX * CHUNK_SIZE + x, node.y + y, node.z - node.chunkZ * CHUNK_SIZE + z);
  euler.set(0, node.rotation + x * 0.7, z * 0.9);
  quaternion.setFromEuler(euler);
  scale.setScalar(scaleValue);
  matrix.compose(position, quaternion, scale);
  mesh.setMatrixAt(index, matrix);
  node.transforms.push({ mesh, index, matrix: matrix.clone() });
}

export function buildResourceChunk(field, cx, cz) {
  const group = new THREE.Group();
  const nodes = createNodes(field, cx, cz);
  const buckets = Object.fromEntries(Object.values(RESOURCE_TYPES).map(type => [type, []]));
  for (const node of nodes) buckets[node.type].push(node);
  const meshes = {};
  for (const type of Object.values(RESOURCE_TYPES)) {
    const entries = buckets[type];
    if (!entries.length) continue;
    const mesh = new THREE.InstancedMesh(geometry[type], material[type], entries.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    for (let i = 0; i < entries.length; i++) {
      const node = entries[i];
      if (type === RESOURCE_TYPES.WOOD) setTransform(node, mesh, i, 0, 0.25, 0, node.size);
      else if (type === RESOURCE_TYPES.STONE) setTransform(node, mesh, i, 0, 0.35, 0, node.size);
      else if (type === RESOURCE_TYPES.BERRY) setTransform(node, mesh, i, 0, 0.58, 0, node.size);
      else setTransform(node, mesh, i, 0, 0, 0, node.size);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    meshes[type] = mesh;
    group.add(mesh);
    if (type === RESOURCE_TYPES.BERRY) {
      const fruit = new THREE.InstancedMesh(geometry.fruit, material.berry, entries.length * 3);
      for (let i = 0; i < entries.length; i++) {
        const node = entries[i];
        for (let j = 0; j < 3; j++) {
          const angle = node.rotation + j / 3 * TAU;
          setTransform(node, fruit, i * 3 + j, Math.cos(angle) * 0.42 * node.size, 0.72 + j * 0.11, Math.sin(angle) * 0.42 * node.size, 1);
        }
      }
      fruit.instanceMatrix.needsUpdate = true;
      fruit.computeBoundingSphere();
      meshes.berryFruit = fruit;
      group.add(fruit);
    }
  }
  return { group, nodes, meshes };
}

export function setResourceNodeActive(node, active) {
  if (!node || node.active === active) return;
  node.active = active;
  for (const transform of node.transforms) {
    transform.mesh.setMatrixAt(transform.index, active ? transform.matrix : hidden);
    transform.mesh.instanceMatrix.needsUpdate = true;
  }
}

export function disposeResourceChunk(chunk) {
  if (!chunk) return;
  for (const mesh of Object.values(chunk.meshes)) {
    mesh.dispose();
    mesh.parent?.remove(mesh);
  }
  chunk.group.clear();
  chunk.nodes.length = 0;
}
