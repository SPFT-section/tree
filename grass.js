// Grass layer: instanced tapered blades with vertex-shader wind.
//
// Technique (standard real-time approach):
// - ONE shared blade geometry (tapered quad: 4 verts, 2 tris) drawn via
//   InstancedMesh, so N blades cost ~1 draw call per chunk, not N.
// - Wind runs fully in the vertex shader (zero per-frame JS): displacement is
//   weighted by blade height so roots stay anchored while tips sway, and the
//   phase comes from world XZ so gusts visibly roll across the field.
//   Reuses the shared wind uniforms from materials.js, so the existing Wind
//   slider drives trees + grass together.
// - Chunked into a 4x4 grid (<=16 draw calls): real bounding spheres give
//   frustum culling per chunk, and tree.js LOD hides far chunks — same
//   pattern as forest.js treeNodes.
// - Color = vertex gradient (dark base -> bright tip) x per-instance tint
//   via instanceColor. No textures, no fragment discard (avoids overdraw cost).
import * as THREE from 'three';
import { mulberry32 } from './rng.js';
import { wind } from './materials.js';
import { groundHeight } from './terrain.js';

export const grassGroup = new THREE.Group();
export const grassNodes = []; // { mesh, pos } per chunk — culling + LOD units
export const BLADE_H = 0.55;
const CELLS = 4;
const MAX_GRASS = 100000;

let bladeGeo = null;
function getBladeGeo() {
  if (bladeGeo) return bladeGeo;
  const w = 0.06, h = BLADE_H;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -w, 0, 0,
     w, 0, 0,
     w * 0.22, h, 0,
    -w * 0.22, h, 0,
  ]), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ]), 3));
  // Dark base -> full-bright tip; multiplies material color x instanceColor.
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array([
    0.32, 0.32, 0.32,
    0.32, 0.32, 0.32,
    1.0, 1.0, 1.0,
    1.0, 1.0, 1.0,
  ]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeBoundingSphere();
  bladeGeo = g;
  return bladeGeo;
}

export const grassMat = new THREE.MeshStandardMaterial({
  color: 0xffffff, roughness: 1, side: THREE.DoubleSide, vertexColors: true,
});
grassMat.onBeforeCompile = (sh) => {
  sh.uniforms.uTime = wind.time;
  sh.uniforms.uWind = wind.strength;
  sh.vertexShader = 'uniform float uTime;\nuniform float uWind;\n' + sh.vertexShader.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
     float gH = clamp(position.y / ${BLADE_H.toFixed(2)}, 0.0, 1.0);
     vec3 gPhase = position;
     #ifdef USE_INSTANCING
       vec4 gW = instanceMatrix * vec4(position, 1.0);
       gPhase = gW.xyz;
     #endif
     float gSway = sin(uTime * 2.2 + gPhase.x * 1.4 + gPhase.z * 1.1) * 0.09 * uWind * gH * gH
                 + sin(uTime * 5.1 + gPhase.z * 3.0 + gPhase.x * 0.7) * 0.02 * uWind * gH;
     transformed.x += gSway; transformed.z += gSway * 0.6;`
  );
};
grassMat.customProgramCacheKey = () => 'wind_grass';

const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion(),
      _e = new THREE.Euler(), _m = new THREE.Matrix4(), _c = new THREE.Color();

export function clearGrass() {
  grassGroup.traverse(o => {
    if (o.isInstancedMesh) o.dispose?.(); // instance buffers only; bladeGeo is shared
  });
  grassGroup.clear();
  grassNodes.length = 0;
}

export function populateGrass(seed, radius, count) {
  clearGrass();
  count = Math.max(0, Math.min(MAX_GRASS, Math.floor(count) || 0));
  if (!count || !(radius > 0)) return { blades: 0, chunks: 0 };
  const rand = mulberry32(((seed ^ 0x51ab3f) >>> 0));

  // Scatter into grid buckets so each chunk is spatially compact.
  const buckets = new Map();
  for (let i = 0; i < count; i++) {
    const ang = rand() * Math.PI * 2;
    const rad = radius * Math.sqrt(rand());
    const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
    _e.set((rand() - 0.5) * 0.35, rand() * Math.PI * 2, (rand() - 0.5) * 0.35);
    _q.setFromEuler(_e);
    _p.set(x, groundHeight(x, z) - 0.02, z);
    const s = 0.7 + rand() * 0.8;
    _s.set(s * (0.8 + rand() * 0.4), s, s * (0.8 + rand() * 0.4));
    _m.compose(_p, _q, _s);
    _c.setHSL(0.23 + rand() * 0.07, 0.45 + rand() * 0.15, 0.30 + rand() * 0.12);
    const cx = Math.max(0, Math.min(CELLS - 1, Math.floor((x / radius * 0.5 + 0.5) * CELLS)));
    const cz = Math.max(0, Math.min(CELLS - 1, Math.floor((z / radius * 0.5 + 0.5) * CELLS)));
    const key = cx * CELLS + cz;
    let b = buckets.get(key);
    if (!b) { b = { mats: [], cols: [], cx, cz }; buckets.set(key, b); }
    b.mats.push(_m.clone());
    b.cols.push(_c.clone());
  }

  const geo = getBladeGeo();
  for (const b of buckets.values()) {
    const im = new THREE.InstancedMesh(geo, grassMat, b.mats.length);
    for (let i = 0; i < b.mats.length; i++) {
      im.setMatrixAt(i, b.mats[i]);
      im.setColorAt(i, b.cols[i]);
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere(); // real bounds => chunk culling works
    grassGroup.add(im);
    grassNodes.push({
      mesh: im,
      pos: new THREE.Vector3(
        ((b.cx + 0.5) / CELLS * 2 - 1) * radius, 0,
        ((b.cz + 0.5) / CELLS * 2 - 1) * radius),
    });
  }
  return { blades: count, chunks: buckets.size };
}
