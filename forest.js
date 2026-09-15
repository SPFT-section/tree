// Forest layer: on-demand species template cache + chunked merged rendering.
//
// Library model (why 73,274 species fit in memory):
// - A species is only a parametric vector (species.js, ~bytes).
// - Trunk geometry is built ONLY for species assigned to a visible tree,
//   then shared by every tree of that species.
// - All species share ONE leaf-card geometry; per-species color comes from
//   instanceColor, and per-tree placement from the instance matrix.
// So library size (73,274) costs ~nothing; only instantiated species cost GPU.
//
// Scaling model (why tree count is uncapped):
// - Trees are generated in Morton-order spatial chunks of chunkSizeFor(N)
//   trees: ONE trunk mesh + ONE leaf InstancedMesh per chunk => 2 draw
//   calls per 64-256 trees, not 2 per tree.
// - Generation is async per chunk: the UI stays alive with progress, and a
//   superseded build cancels instead of piling on.
// - LOD + frustum culling operate per compact chunk (bounding spheres are real).
// - Auto-quality (depth cap first, then leaf thinning) fits big forests into
//   the memory budget instead of refusing the build.
import * as THREE from 'three';
import { mulberry32 } from './rng.js';
import { barkMat, leafMat } from './materials.js';
import { speciesParams, speciesStatus, STATUS_COLORS, WORLD_TREES } from './species.js';
import { buildTree } from './builder.js';
import { groundHeight, treeConfig } from './terrain.js';

export const forest = new THREE.Group();
export const treeNodes = []; // { leaves, pos } per chunk — LOD + culling units
export const treeRecords = []; // { x, y, z, species, st } per tree — game targets, stats
export const sharedLeafGeo = new THREE.PlaneGeometry(1, 1);
export const world = { r: 24 }; // forest radius, grows with tree count
export const CHUNK = 64; // base size; chunkSizeFor() grows it for big forests

// Fewer draws for big forests: 20k trees => 79 chunks x 2 draws, not 626.
export function chunkSizeFor(treeCount) {
  if (treeCount > 8000) return 256;
  if (treeCount > 2000) return 128;
  return CHUNK;
}

// Single source of truth for forest radius lives in terrain.js (treeConfig).
// Re-exported here for compat; new code should import from terrain.js.
export function forestRadiusFor(treeCount) {
  return treeConfig.radiusFor(treeCount);
}

const templateCache = new Map(); // key -> { trunkGeo, leafXforms, tris, leaves, color }
const MAX_CACHE = 1024; // ~100 MB worst case at depth 4; avoids thrash at 1000 species
let cacheEvictions = 0; // reset per build, reported in stats

// scratch objects (no per-tree garbage during populate)
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _nm = new THREE.Matrix3();
const _tmpP = new THREE.Vector3(), _tmpS = new THREE.Vector3(),
      _tmpE = new THREE.Euler(), _leafM = new THREE.Matrix4(),
      _leafQ = new THREE.Quaternion(), _worldM = new THREE.Matrix4(),
      _col = new THREE.Color(), _statusCol = new THREE.Color();

function evictIfNeeded() {
  while (templateCache.size > MAX_CACHE) {
    const oldest = templateCache.keys().next().value;
    templateCache.get(oldest).trunkGeo.dispose?.();
    templateCache.delete(oldest);
    cacheEvictions++;
  }
}

// Stable species template: geometry RNG is seeded from speciesId (not forest
// seed), so the library looks identical on every load; the forest seed only
// controls layout + which species each tree gets.
export function getTemplate(speciesId, depth, spread, depthCap = 5) {
  const sp = speciesParams(speciesId);
  const effDepth = Math.max(2, Math.min(depthCap, depth + sp.dDepth));
  const effSpread = Math.max(0.15, Math.min(1.2, spread * sp.spreadMul));
  const key = speciesId + '|' + effDepth + '|' + effSpread.toFixed(3);
  let tpl = templateCache.get(key);
  if (!tpl) {
    const geoSeed = ((speciesId * 2654435761) ^ 0x85ebca6b) >>> 0;
    const built = buildTree(geoSeed, effDepth, effSpread,
      { leafScale: sp.leafScale, slenderness: sp.slenderness });
    tpl = { ...built, color: new THREE.Color().setHSL(sp.hue, sp.sat, sp.light) };
    templateCache.set(key, tpl);
    evictIfNeeded();
  }
  return tpl;
}

export function clearForest() {
  forest.traverse(o => {
    if (o.geometry && o.geometry !== sharedLeafGeo) o.geometry.dispose?.();
    if (o.isInstancedMesh) o.dispose?.(); // per-chunk instance buffers
  });
  forest.clear(); // template cache persists for fast re-seed
  treeNodes.length = 0;
  treeRecords.length = 0;
}

// Measured per-template cost by effDepth (spread 0.55) — used to pick
// auto-quality BEFORE building any geometry.
const COST = { 2: { v: 374, l: 28 }, 3: { v: 1168, l: 86 }, 4: { v: 3040, l: 224 }, 5: { v: 8248, l: 572 } };
const clampD = d => Math.max(2, Math.min(5, d));
export const MEM_TARGET = 500, MEM_HARD = 600;
export function estimateMB(treeCount, depth, thin = 1) {
  let v = 0, l = 0;
  for (const off of [-1, 0, 1]) { const c = COST[clampD(depth + off)]; v += c.v; l += c.l; }
  return treeCount * ((v / 3) * 28 + (l / 3) * 76 * thin) / 1048576;
}
// Auto-quality: fit ~MEM_TARGET so big forests build (slightly simpler)
// instead of refusing. Depth cap first (verts dominate), then leaf thinning.
export function pickQuality(treeCount, depth) {
  let depthCap = depth, thin = 1;
  for (let i = 0; i < 4; i++) {
    const est = estimateMB(treeCount, depthCap, thin);
    if (est <= MEM_TARGET) return { depthCap, thin, estMB: est };
    if (depthCap > 2) { depthCap--; continue; }
    thin = Math.max(0.15, (MEM_TARGET / est) * thin);
  }
  return { depthCap, thin, estMB: estimateMB(treeCount, depthCap, thin) };
}
// Deterministic leaf thinning: keep pct per 100 (periodic, stable across builds).
function keptCount(n, pct) {
  if (pct >= 100) return n;
  if (pct <= 0) return 0;
  return Math.floor(n / 100) * pct + Math.min(n % 100, pct);
}
// Morton (Z-order) code for 16-bit cell coords — sorting by it keeps each
// chunk spatially compact, so culling/LOD work per chunk.
function morton16(x, y) {
  x &= 0xffff; y &= 0xffff;
  let z = 0;
  for (let i = 0; i < 16; i++) z |= (((x >>> i) & 1) << (2 * i)) | (((y >>> i) & 1) << (2 * i + 1));
  return z >>> 0;
}
const tick = () => new Promise(r => setTimeout(r, 0)); // yield to UI between chunks

export async function populateForest(seed, treeCount, speciesCount, depth, spread, mode = 'botanical', onProgress = null, isCancelled = null) {
  const t0 = performance.now();
  cacheEvictions = 0;
  // Records/meshes pushed below belong to THIS build; on error or cancel
  // we roll them back so a refused/superseded build can't leave phantom
  // tag targets or stray chunks behind in the shared forest group.
  const recordBase = treeRecords.length;
  const forestBase = forest.children.length;
  const nodesBase = treeNodes.length;
  function rollbackPartial() {
    if (treeRecords.length > recordBase) treeRecords.length = recordBase;
    if (treeNodes.length > nodesBase) treeNodes.length = nodesBase;
    while (forest.children.length > forestBase) {
      const o = forest.children[forest.children.length - 1];
      forest.remove(o);
      if (o.geometry && o.geometry !== sharedLeafGeo) o.geometry.dispose?.();
      if (o.isInstancedMesh) o.dispose?.();
    }
  }
  treeCount = Math.max(1, Math.min(20000, Math.floor(treeCount) || 1));
  speciesCount = Math.max(1, Math.min(WORLD_TREES, Math.floor(speciesCount) || 1));
  const quality = pickQuality(treeCount, depth);
  const { depthCap, thin } = quality;
  const thinPct = Math.round(thin * 100);
  const placeRand = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  world.r = forestRadiusFor(treeCount);
  const cell = Math.max(8, Math.min(32, world.r / 16));

  // Phase 1: species assignment + transforms (no geometry yet).
  const trees = [];
  const used = new Set();
  const statusCounts = {};
  const upY = new THREE.Vector3(0, 1, 0);
  const _pp = new THREE.Vector3(), _qq = new THREE.Quaternion(), _ss = new THREE.Vector3();
  for (let t = 0; t < treeCount; t++) {
    const speciesId = 1 + Math.floor(placeRand() * speciesCount);
    used.add(speciesId);
    const st = speciesStatus(speciesId);
    statusCounts[st] = (statusCounts[st] || 0) + 1;
    const tpl = getTemplate(speciesId, depth, spread, depthCap);
    const ang = placeRand() * Math.PI * 2;
    const rad = t === 0 ? 0 : world.r * Math.sqrt(placeRand());
    const px = Math.cos(ang) * rad, pz = Math.sin(ang) * rad;
    _pp.set(px, groundHeight(px, pz) - 0.2, pz);
    _qq.setFromAxisAngle(upY, placeRand() * Math.PI * 2);
    _ss.setScalar(0.7 + placeRand() * 0.7);
    const m = new THREE.Matrix4().compose(_pp, _qq, _ss);
    const gx = Math.floor(px / cell) + 256, gz = Math.floor(pz / cell) + 256;
    trees.push({ tpl, m, st, key: morton16(gx, gz) });
    treeRecords.push({ x: px, y: _pp.y, z: pz, species: speciesId, st });
    if ((t & 4095) === 4095) {
      if (isCancelled?.()) { rollbackPartial(); return { cancelled: true }; }
      await tick();
    }
  }

  // Memory guard: merged buffers scale with tree count — estimate BEFORE
  // allocating, and refuse with a message instead of crashing the tab.
  // (Auto-quality above makes this rare: it only triggers past 20k-scale loads.)
  let estV = 0, estL = 0;
  for (const { tpl } of trees) {
    estV += tpl.trunkGeo.attributes.position.count;
    estL += keptCount(tpl.leafXforms.length, thinPct);
  }
  const estMB = (estV * 28 + estL * 76) / 1048576;
  if (estMB > MEM_HARD) {
    rollbackPartial();
    return { error: `needs ~${Math.round(estMB)} MB, over the ${MEM_HARD} MB budget — lower Trees or Depth`, unique: used.size, totalTris: 0, cached: templateCache.size, evictions: cacheEvictions, chunks: 0, statusCounts, mode, buildMs: performance.now() - t0, estMB, quality, treeCount };
  }

  // Phase 2: merge into chunks (2 draw calls per chunk). Morton order makes
  // each chunk spatially compact: culling + LOD work per chunk.
  trees.sort((a, b) => a.key - b.key);
  const chunkSize = chunkSizeFor(treeCount);
  const nChunks = Math.ceil(trees.length / chunkSize);
  let totalTris = 0;
  for (let c = 0; c < trees.length; c += chunkSize) {
    if (isCancelled?.()) { rollbackPartial(); return { cancelled: true }; }
    const slice = trees.slice(c, c + chunkSize);
    let vC = 0, iC = 0, leafTotal = 0, trisAdd = 0;
    const kept = new Array(slice.length);
    for (let s = 0; s < slice.length; s++) {
      const tpl = slice[s].tpl;
      vC += tpl.trunkGeo.attributes.position.count;
      iC += tpl.trunkGeo.index.count;
      const k = keptCount(tpl.leafXforms.length, thinPct);
      kept[s] = k;
      leafTotal += k;
      trisAdd += tpl.trunkGeo.index.count / 3 + k * 2;
    }
    totalTris += trisAdd;
    const center = new THREE.Vector3();
    for (const { m } of slice) {
      const me = m.elements;
      center.x += me[12]; center.y += me[13]; center.z += me[14];
    }
    center.divideScalar(slice.length);

    const pos = new Float32Array(vC * 3), norm = new Float32Array(vC * 3);
    const idx = new Uint32Array(iC);
    let vo = 0, io = 0;
    for (const { tpl, m } of slice) {
      const pa = tpl.trunkGeo.attributes.position.array;
      const na = tpl.trunkGeo.attributes.normal.array;
      const ia = tpl.trunkGeo.index.array;
      _nm.getNormalMatrix(m);
      const me = m.elements, ne = _nm.elements;
      for (let i = 0; i < pa.length; i += 3) {
        const x = pa[i], y = pa[i + 1], z = pa[i + 2];
        pos[(vo * 3) + i] = me[0] * x + me[4] * y + me[8] * z + me[12];
        pos[(vo * 3) + i + 1] = me[1] * x + me[5] * y + me[9] * z + me[13];
        pos[(vo * 3) + i + 2] = me[2] * x + me[6] * y + me[10] * z + me[14];
        const nx = na[i], ny = na[i + 1], nz = na[i + 2];
        const ex = ne[0] * nx + ne[3] * ny + ne[6] * nz;
        const ey = ne[1] * nx + ne[4] * ny + ne[7] * nz;
        const ez = ne[2] * nx + ne[5] * ny + ne[8] * nz;
        const il = 1 / (Math.hypot(ex, ey, ez) || 1);
        norm[(vo * 3) + i] = ex * il;
        norm[(vo * 3) + i + 1] = ey * il;
        norm[(vo * 3) + i + 2] = ez * il;
      }
      for (let i = 0; i < ia.length; i++) idx[io + i] = ia[i] + vo;
      vo += tpl.trunkGeo.attributes.position.count; io += ia.length;
    }
    const trunkGeo = new THREE.BufferGeometry();
    trunkGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    trunkGeo.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
    trunkGeo.setIndex(new THREE.BufferAttribute(idx, 1));
    trunkGeo.computeBoundingSphere();
    forest.add(new THREE.Mesh(trunkGeo, barkMat));

    let leaves = null;
    if (leafTotal > 0) {
      leaves = new THREE.InstancedMesh(sharedLeafGeo, leafMat, leafTotal);
      let li = 0;
      for (let s = 0; s < slice.length; s++) {
        const { tpl, m, st } = slice[s];
        if (kept[s] === 0) continue;
        _statusCol.setHex(STATUS_COLORS[st]);
        const arr = tpl.leafXforms;
        let w = 0;
        for (let k = 0; k < arr.length && w < kept[s]; k++) {
          if ((k % 100) >= thinPct) continue;
          const L = arr[k];
          _tmpE.set(L.rx, L.ry, L.rz); _leafQ.setFromEuler(_tmpE);
          _tmpP.copy(L.p); _tmpS.setScalar(L.s);
          _leafM.compose(_tmpP, _leafQ, _tmpS);
          _worldM.multiplyMatrices(m, _leafM);
          leaves.setMatrixAt(li, _worldM);
          if (mode === 'redlist') _col.copy(_statusCol).offsetHSL(0, 0, (placeRand() - 0.5) * 0.04);
          else _col.copy(tpl.color).offsetHSL(0, (placeRand() - 0.5) * 0.05, (placeRand() - 0.5) * 0.08);
          leaves.setColorAt(li, _col);
          li++; w++;
        }
      }
      leaves.instanceMatrix.needsUpdate = true;
      if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
      leaves.computeBoundingSphere(); // real bounds => chunk culling works
      forest.add(leaves);
    }
    treeNodes.push({ leaves, pos: center });
    onProgress?.({ done: treeNodes.length, total: nChunks });
    await tick();
  }
  const buildMs = performance.now() - t0;
  return { unique: used.size, totalTris, cached: templateCache.size, evictions: cacheEvictions, chunks: treeNodes.length, chunkSize, statusCounts, mode, buildMs, estMB, quality, treeCount };
}
