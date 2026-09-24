import * as THREE from 'three';
import { buildTree } from './builder.js';
import { barkMat, leafMat } from './materials.js';
import { mulberry32, hash01, hash32, TAU } from './rng.js';
import { speciesParams } from './species.js';
import { BIOMES, CHUNK_SIZE, biomeAt, forestDensity, groundHeight } from './terrain.js';

export const sharedLeafGeo = new THREE.PlaneGeometry(1, 1);
const templateCache = new Map();
const MAX_TEMPLATES = 256;
const matrix = new THREE.Matrix4();
const leafMatrix = new THREE.Matrix4();
const normalMatrix = new THREE.Matrix3();
const position = new THREE.Vector3();
const scale = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);
const color = new THREE.Color();
const normal = new THREE.Color();
const biomeColor = new THREE.Color();
const speciesCount = 32;

function biomeLeafColor(biome, target) {
  if (biome === BIOMES.RAINFOREST || biome === BIOMES.WETLAND) target.setHSL(0.33, 0.42, 0.19);
  else if (biome === BIOMES.BOREAL_FOREST) target.setHSL(0.36, 0.28, 0.2);
  else if (biome === BIOMES.SAVANNA) target.setHSL(0.19, 0.36, 0.29);
  else if (biome === BIOMES.TUNDRA) target.setHSL(0.25, 0.2, 0.25);
  else if (biome === BIOMES.ALPINE) target.setHSL(0.29, 0.24, 0.23);
  else target.setHSL(0.28, 0.36, 0.24);
  return target;
}

export function getTemplate(speciesId) {
  const key = (speciesId - 1) % 12 + 1;
  let template = templateCache.get(key);
  if (template) {
    templateCache.delete(key);
    templateCache.set(key, template);
    return template;
  }
  const params = speciesParams(speciesId);
  template = buildTree(hash32(speciesId, 0, 0, 701, 1), 2, 0.58, {
    leafScale: params.leafScale,
    slenderness: params.slenderness,
  });
  templateCache.set(key, template);
  while (templateCache.size > MAX_TEMPLATES) {
    const oldestKey = templateCache.keys().next().value;
    const oldest = templateCache.get(oldestKey);
    oldest.trunkGeo.dispose();
    templateCache.delete(oldestKey);
  }
  return template;
}

function buildTreeDefinitions(field, cx, cz, detail) {
  const definitions = [];
  const spacing = detail >= 1 ? 10 : 14;
  const minX = cx * CHUNK_SIZE;
  const minZ = cz * CHUNK_SIZE;
  const startX = Math.floor(minX / spacing);
  const startZ = Math.floor(minZ / spacing);
  const cellsX = Math.ceil((minX + CHUNK_SIZE) / spacing) - startX;
  const cellsZ = Math.ceil((minZ + CHUNK_SIZE) / spacing) - startZ;
  for (let oz = 0; oz < cellsZ; oz++) {
    for (let ox = 0; ox < cellsX; ox++) {
      const cellX = startX + ox;
      const cellZ = startZ + oz;
      if (hash01(cellX, cellZ, 0, 711, field.seed) > 0.94) continue;
      const x = cellX * spacing + spacing * (0.12 + hash01(cellX, cellZ, 0, 712, field.seed) * 0.76);
      const z = cellZ * spacing + spacing * (0.12 + hash01(cellX, cellZ, 0, 713, field.seed) * 0.76);
      if (x < cx * CHUNK_SIZE || x >= (cx + 1) * CHUNK_SIZE || z < cz * CHUNK_SIZE || z >= (cz + 1) * CHUNK_SIZE) continue;
      const y = groundHeight(field, x, z);
      if (y < 0.7) continue;
      const biome = biomeAt(field, x, z, y);
      const density = forestDensity(field, x, z, biome);
      if (hash01(cellX, cellZ, 0, 714, field.seed) > density) continue;
      if (Math.abs(groundHeight(field, x + 1.4, z) - y) > 1.15 || Math.abs(groundHeight(field, x, z + 1.4) - y) > 1.15) continue;
      const speciesId = 1 + Math.floor(hash01(cellX, cellZ, 0, 715, field.seed) * speciesCount);
      const template = getTemplate(speciesId);
      const size = 0.72 + hash01(cellX, cellZ, 0, 716, field.seed) * 0.62;
      definitions.push({
        template,
        speciesId,
        x,
        y: y - 0.08,
        z,
        size,
        rotation: hash01(cellX, cellZ, 0, 717, field.seed) * TAU,
        biome,
        tint: hash01(cellX, cellZ, 0, 718, field.seed),
      });
    }
  }
  return definitions;
}

export function buildForestChunk(field, cx, cz, detail = 1) {
  const definitions = buildTreeDefinitions(field, cx, cz, detail);
  const group = new THREE.Group();
  const records = [];
  if (!definitions.length) return { group, records };
  let vertexCount = 0;
  let indexCount = 0;
  let leafCount = 0;
  for (const definition of definitions) {
    vertexCount += definition.template.trunkGeo.attributes.position.count;
    indexCount += definition.template.trunkGeo.index.count;
    leafCount += definition.template.leafXforms.length;
  }
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(indexCount);
  const leaves = new THREE.InstancedMesh(sharedLeafGeo, leafMat, leafCount);
  let vertexOffset = 0;
  let indexOffset = 0;
  let leafOffset = 0;
  for (const definition of definitions) {
    position.set(definition.x - cx * CHUNK_SIZE, definition.y, definition.z - cz * CHUNK_SIZE);
    scale.setScalar(definition.size);
    quaternion.setFromAxisAngle(up, definition.rotation);
    matrix.compose(position, quaternion, scale);
    normalMatrix.getNormalMatrix(matrix);
    const source = definition.template.trunkGeo;
    const sourcePositions = source.attributes.position.array;
    const sourceNormals = source.attributes.normal.array;
    const sourceIndices = source.index.array;
    const matrixElements = matrix.elements;
    const normalElements = normalMatrix.elements;
    for (let i = 0; i < sourcePositions.length; i += 3) {
      const x = sourcePositions[i];
      const y = sourcePositions[i + 1];
      const z = sourcePositions[i + 2];
      const output = (vertexOffset * 3) + i;
      positions[output] = matrixElements[0] * x + matrixElements[4] * y + matrixElements[8] * z + matrixElements[12];
      positions[output + 1] = matrixElements[1] * x + matrixElements[5] * y + matrixElements[9] * z + matrixElements[13];
      positions[output + 2] = matrixElements[2] * x + matrixElements[6] * y + matrixElements[10] * z + matrixElements[14];
      const nx = sourceNormals[i];
      const ny = sourceNormals[i + 1];
      const nz = sourceNormals[i + 2];
      let ex = normalElements[0] * nx + normalElements[3] * ny + normalElements[6] * nz;
      let ey = normalElements[1] * nx + normalElements[4] * ny + normalElements[7] * nz;
      let ez = normalElements[2] * nx + normalElements[5] * ny + normalElements[8] * nz;
      const length = Math.hypot(ex, ey, ez) || 1;
      ex /= length;
      ey /= length;
      ez /= length;
      normals[output] = ex;
      normals[output + 1] = ey;
      normals[output + 2] = ez;
    }
    for (let i = 0; i < sourceIndices.length; i++) indices[indexOffset + i] = sourceIndices[i] + vertexOffset;
    vertexOffset += source.attributes.position.count;
    indexOffset += source.index.count;
    biomeLeafColor(definition.biome, biomeColor);
    color.copy(biomeColor).offsetHSL((definition.tint - 0.5) * 0.025, (definition.tint - 0.5) * 0.1, (definition.tint - 0.5) * 0.08);
    for (const leaf of definition.template.leafXforms) {
      position.set(leaf.p.x, leaf.p.y, leaf.p.z);
      quaternion.setFromEuler(new THREE.Euler(leaf.rx, leaf.ry, leaf.rz));
      scale.setScalar(leaf.s);
      leafMatrix.compose(position, quaternion, scale);
      leafMatrix.premultiply(matrix);
      leaves.setMatrixAt(leafOffset, leafMatrix);
      leaves.setColorAt(leafOffset, color);
      leafOffset++;
    }
    records.push({
      id: `tree:${cellId(definition.x, definition.z)}`,
      x: definition.x,
      y: definition.y,
      z: definition.z,
      radius: 0.38 * definition.size,
      height: 7 * definition.size,
    });
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  const trunks = new THREE.Mesh(geometry, barkMat);
  trunks.castShadow = true;
  trunks.receiveShadow = true;
  leaves.instanceMatrix.needsUpdate = true;
  if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
  leaves.computeBoundingSphere();
  leaves.castShadow = true;
  group.add(trunks, leaves);
  return { group, records };
}

function cellId(x, z) {
  return `${Math.floor(x / 10)},${Math.floor(z / 10)}`;
}

export function disposeForestChunk(chunk) {
  if (!chunk) return;
  for (const object of chunk.group.children) {
    if (object.geometry && object.geometry !== sharedLeafGeo) object.geometry.dispose();
    object.dispose?.();
  }
  chunk.group.clear();
  chunk.records.length = 0;
}

export function clearTemplateCache() {
  for (const template of templateCache.values()) template.trunkGeo.dispose();
  templateCache.clear();
}

export function forestCacheSize() {
  return templateCache.size;
}
