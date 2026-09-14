// Terrain layer: seeded procedural heightfield replacing the flat ground disc.
//
// - groundHeight(x, z) is analytic (seeded value-noise fbm), so forest.js and
//   grass.js place trees/blades exactly on the surface with no raycasting.
// - prepareTerrain(seed, radius) must be called each regrow BEFORE
//   populateForest / populateGrass; buildTerrainMesh() then creates the
//   visible vertex-colored mesh (resolution adapts to radius for perf).
// - Flattened near the origin so the hero tree and default orbit target
//   never end up under a hill.
import * as THREE from 'three';

const T = { seed: 1, radius: 24, amp: 1.2 };

// Central placement config: terrain is the source of truth for both trees
// and grass (not tree.js / forest.js). forest.js + grass.js import these.
export const treeConfig = {
  minRadius: 24,
  radiusK: 6,
  maxTrees: 20000,
  radiusFor(treeCount) {
    treeCount = Math.max(1, Math.min(this.maxTrees, Math.floor(treeCount) || 1));
    return Math.max(this.minRadius, this.radiusK * Math.sqrt(treeCount));
  },
};

export const grassConfig = {
  MAX: 100000,
  CELLS: 4,
  BLADE_H: 0.55,
};

// Single source of truth for forest radius (moved here from forest.js so
// grass no longer depends on the tree module for its placement radius).
export function forestRadiusFor(treeCount) {
  return treeConfig.radiusFor(treeCount);
}

export function terrainRadius() {
  return T.radius;
}

export function prepareTerrain(seed, radius) {
  T.seed = (seed >>> 0) || 1;
  T.radius = Math.max(8, radius);
  T.amp = Math.min(2.5, Math.max(0.8, T.radius * 0.05));
}

function hash01(ix, iz) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(T.seed, 974711)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function fade(t) { return t * t * (3 - 2 * t); }

function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const a = hash01(ix, iz), b = hash01(ix + 1, iz);
  const c = hash01(ix, iz + 1), d = hash01(ix + 1, iz + 1);
  const ux = fade(fx), uz = fade(fz);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz; // 0..1
}

export function groundHeight(x, z) {
  const s = 1 / 18;
  const n = vnoise(x * s, z * s) * 0.6
    + vnoise(x * s * 2.3 + 7.3, z * s * 2.3 + 3.1) * 0.25
    + vnoise(x * s * 5.1 + 13.7, z * s * 5.1 + 9.2) * 0.15;
  const raw = (n - 0.5) * 2 * T.amp;
  // Flat clearing at the origin (hero tree + orbit target live here).
  const d = Math.hypot(x, z);
  const m = Math.max(0, Math.min(1, (d - 3) / 9));
  return raw * (m * m * (3 - 2 * m));
}

export const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });

const _c = new THREE.Color();
const _low = new THREE.Color(0x0f2c1a), _mid = new THREE.Color(0x1d4227),
      _high = new THREE.Color(0x55632c);

export function buildTerrainMesh() {
  const size = Math.max(120, (T.radius + 50) * 2);
  const seg = Math.max(64, Math.min(192, Math.round(size / 1.2)));
  const g = new THREE.PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = groundHeight(x, z);
    pos.setY(i, h);
    const t = THREE.MathUtils.clamp(h / (T.amp * 2) + 0.5, 0, 1);
    if (t < 0.5) _c.copy(_low).lerp(_mid, t * 2);
    else _c.copy(_mid).lerp(_high, (t - 0.5) * 2);
    const patch = 0.9 + vnoise(x * 0.05 + 31.7, z * 0.05 + 17.3) * 0.2;
    colors[i * 3] = _c.r * patch;
    colors[i * 3 + 1] = _c.g * patch;
    colors[i * 3 + 2] = _c.b * patch;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return { mesh: new THREE.Mesh(g, terrainMat), size, seg, tris: Math.floor(g.index.count / 3) };
}
