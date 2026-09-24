import * as THREE from 'three';
import { hash01, TAU } from './rng.js';
import { wind } from './materials.js';
import { BIOMES, CHUNK_SIZE, biomeAt, grassDensity, groundHeight } from './terrain.js';

const height = 0.48;
const bladeGeometry = new THREE.BufferGeometry();
bladeGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
  -0.055, 0, 0,
  0.055, 0, 0,
  0.018, height, 0,
  -0.018, height, 0,
], 3));
bladeGeometry.setAttribute('normal', new THREE.Float32BufferAttribute([
  0, 0, 1,
  0, 0, 1,
  0, 0, 1,
  0, 0, 1,
], 3));
bladeGeometry.setAttribute('color', new THREE.Float32BufferAttribute([
  0.42, 0.42, 0.42,
  0.42, 0.42, 0.42,
  1, 1, 1,
  1, 1, 1,
], 3));
bladeGeometry.setIndex([0, 1, 2, 0, 2, 3]);
bladeGeometry.computeBoundingSphere();

export const grassMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 1,
  side: THREE.DoubleSide,
  vertexColors: true,
});

grassMaterial.onBeforeCompile = shader => {
  shader.uniforms.uTime = wind.time;
  shader.uniforms.uWind = wind.strength;
  shader.vertexShader = 'uniform float uTime; uniform float uWind; ' + shader.vertexShader.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
    float bladeHeight = clamp(position.y / ${height.toFixed(2)}, 0.0, 1.0);
    vec3 phase = position;
    #ifdef USE_INSTANCING
      vec4 grassWorldPosition = instanceMatrix * vec4(position, 1.0);
      phase = grassWorldPosition.xyz;
    #endif
    float gust = sin(uTime * 1.7 + phase.x * 0.16 + phase.z * 0.11) * 0.5
               + sin(uTime * 3.8 + phase.z * 0.31) * 0.18;
    transformed.x += gust * uWind * bladeHeight * bladeHeight;
    transformed.z += gust * 0.55 * uWind * bladeHeight;`,
  );
};
grassMaterial.customProgramCacheKey = () => 'survival_grass_wind';

const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const scale = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const euler = new THREE.Euler();
const color = new THREE.Color();
const baseColor = new THREE.Color();

function grassColor(biome, tint) {
  if (biome === BIOMES.SAVANNA || biome === BIOMES.GRASSLAND) baseColor.setHSL(0.19 + tint * 0.035, 0.38, 0.29 + tint * 0.1);
  else if (biome === BIOMES.TUNDRA || biome === BIOMES.ALPINE) baseColor.setHSL(0.22 + tint * 0.03, 0.2, 0.3 + tint * 0.1);
  else if (biome === BIOMES.DESERT) baseColor.setHSL(0.16, 0.28, 0.35 + tint * 0.09);
  else if (biome === BIOMES.RAINFOREST) baseColor.setHSL(0.32, 0.44, 0.18 + tint * 0.08);
  else baseColor.setHSL(0.27 + tint * 0.04, 0.36, 0.23 + tint * 0.1);
  return baseColor;
}

export function buildGrassChunk(field, cx, cz, detail = 1) {
  const spacing = detail >= 1 ? 3.2 : 4.5;
  const minX = cx * CHUNK_SIZE;
  const minZ = cz * CHUNK_SIZE;
  const startX = Math.floor(minX / spacing);
  const startZ = Math.floor(minZ / spacing);
  const cellsX = Math.ceil((minX + CHUNK_SIZE) / spacing) - startX;
  const cellsZ = Math.ceil((minZ + CHUNK_SIZE) / spacing) - startZ;
  const definitions = [];
  for (let oz = 0; oz < cellsZ; oz++) {
    for (let ox = 0; ox < cellsX; ox++) {
      const cellX = startX + ox;
      const cellZ = startZ + oz;
      const x = cellX * spacing + hash01(cellX, cellZ, 0, 721, field.seed) * spacing;
      const z = cellZ * spacing + hash01(cellX, cellZ, 0, 722, field.seed) * spacing;
      if (x < cx * CHUNK_SIZE || x >= (cx + 1) * CHUNK_SIZE || z < cz * CHUNK_SIZE || z >= (cz + 1) * CHUNK_SIZE) continue;
      const y = groundHeight(field, x, z);
      if (y < 0.35) continue;
      const biome = biomeAt(field, x, z, y);
      const density = grassDensity(field, x, z, biome);
      const tint = hash01(cellX, cellZ, 0, 723, field.seed);
      if (tint > density) continue;
      definitions.push({
        x: x - cx * CHUNK_SIZE,
        y: y - 0.015,
        z: z - cz * CHUNK_SIZE,
        rotation: hash01(cellX, cellZ, 0, 724, field.seed) * TAU,
        size: 0.7 + hash01(cellX, cellZ, 0, 725, field.seed) * 0.8,
        biome,
        tint,
      });
    }
  }
  const mesh = new THREE.InstancedMesh(bladeGeometry, grassMaterial, definitions.length);
  for (let i = 0; i < definitions.length; i++) {
    const definition = definitions[i];
    position.set(definition.x, definition.y, definition.z);
    euler.set((definition.tint - 0.5) * 0.18, definition.rotation, (definition.tint - 0.5) * 0.14);
    quaternion.setFromEuler(euler);
    scale.set(definition.size * 0.8, definition.size, definition.size);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, grassColor(definition.biome, definition.tint));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.receiveShadow = true;
  return { group: mesh, count: definitions.length };
}

export function disposeGrassChunk(chunk) {
  if (!chunk) return;
  chunk.group.dispose?.();
  chunk.group.parent?.remove(chunk.group);
}
