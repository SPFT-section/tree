// Tree geometry builder: recursive branches (merged cylinders) + leaf-card transforms.
// Pure geometry — no scene, no materials. Returns data the forest layer instances.
import * as THREE from 'three';
import { mulberry32 } from './rng.js';

export function buildTree(geoSeed, maxDepth, spread, opts = {}) {
  const { leafScale = 1, slenderness = 1 } = opts;
  const rand = mulberry32(geoSeed >>> 0);
  const branchGeos = [];
  const leafXforms = [];
  const up = new THREE.Vector3(0, 1, 0);

  function branch(pos, dir, len, rad, depth) {
    const end = pos.clone().addScaledVector(dir, len);
    const geo = new THREE.CylinderGeometry(rad * 0.62, rad, len, depth > 2 ? 7 : 5, 1);
    geo.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize());
    geo.applyQuaternion(q);
    geo.translate(pos.x, pos.y, pos.z);
    branchGeos.push(geo);

    if (depth <= 0) {
      const n = 3 + Math.floor(rand() * 3);
      for (let i = 0; i < n; i++) {
        leafXforms.push({
          p: end.clone().add(new THREE.Vector3((rand() - .5) * 1.2, (rand() - .5) * .8, (rand() - .5) * 1.2)),
          s: (0.5 + rand() * 0.6) * leafScale,
          rx: (rand() - 0.5) * 1.2, ry: rand() * Math.PI * 2, rz: (rand() - 0.5) * 1.2
        });
      }
      return;
    }
    const kids = depth === maxDepth ? 3 : 2 + (rand() < 0.5 ? 1 : 0);
    for (let i = 0; i < kids; i++) {
      const nd = dir.clone();
      nd.x += (rand() - .5) * 2 * spread;
      nd.z += (rand() - .5) * 2 * spread;
      nd.y += rand() * 0.5;
      nd.normalize();
      branch(end, nd, len * (0.62 + rand() * 0.18), rad * 0.6, depth - 1);
    }
  }

  branch(new THREE.Vector3(0, 0, 0), up.clone(), 2.2 * slenderness, 0.34, maxDepth);

  // Merge branch geometries manually (no BufferGeometryUtils dependency).
  let vCount = 0, iCount = 0;
  for (const g of branchGeos) { vCount += g.attributes.position.count; iCount += g.index.count; }
  const pos = new Float32Array(vCount * 3), norm = new Float32Array(vCount * 3);
  const idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const g of branchGeos) {
    pos.set(g.attributes.position.array, vo * 3);
    norm.set(g.attributes.normal.array, vo * 3);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += g.attributes.position.count; io += gi.length;
    g.dispose();
  }
  const trunkGeo = new THREE.BufferGeometry();
  trunkGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  trunkGeo.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  trunkGeo.setIndex(new THREE.BufferAttribute(idx, 1));
  trunkGeo.computeBoundingSphere();

  const tris = Math.floor(trunkGeo.index.count / 3) + leafXforms.length * 2;
  return { trunkGeo, leafXforms, tris, leaves: leafXforms.length };
}
