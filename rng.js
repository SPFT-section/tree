export const TAU = Math.PI * 2;

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function clamp01(value) {
  return clamp(value, 0, 1);
}

export function smoothstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / (edge1 - edge0 || 1e-6));
  return t * t * (3 - 2 * t);
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash32(x, y = 0, z = 0, salt = 0, seed = 1) {
  let h = Math.imul((x | 0) ^ (seed | 0), 0x27d4eb2d);
  h ^= Math.imul((y | 0) + 0x9e3779b9, 0x85ebca6b);
  h ^= Math.imul((z | 0) + 0xc2b2ae35, 0x165667b1);
  h ^= Math.imul((salt | 0) + 0x9e3779b9, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export function hash01(x, y = 0, z = 0, salt = 0, seed = 1) {
  return hash32(x, y, z, salt, seed) / 4294967296;
}

export function streamRng(seed, x, z = 0, salt = 0) {
  return mulberry32(hash32(x, z, salt, seed));
}

const fade = value => value * value * (3 - 2 * value);

export function valueNoise2(x, z, salt = 0, seed = 1) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fz = fade(z - iz);
  const a = hash01(ix, iz, 0, salt, seed);
  const b = hash01(ix + 1, iz, 0, salt, seed);
  const c = hash01(ix, iz + 1, 0, salt, seed);
  const d = hash01(ix + 1, iz + 1, 0, salt, seed);
  const top = lerp(a, b, fx);
  const bottom = lerp(c, d, fx);
  return lerp(top, bottom, fz);
}

export function fbm2(x, z, salt = 0, seed = 1, octaves = 4) {
  let value = 0;
  let amplitude = 0.5;
  let total = 0;
  let fx = x;
  let fz = z;
  for (let i = 0; i < octaves; i++) {
    value += valueNoise2(fx, fz, salt + i * 17, seed) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    fx = fx * 2.03 + 11.7;
    fz = fz * 2.03 - 7.9;
  }
  return value / total;
}

export function ridged2(x, z, salt = 0, seed = 1, octaves = 4) {
  let value = 0;
  let amplitude = 0.55;
  let total = 0;
  let fx = x;
  let fz = z;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(valueNoise2(fx, fz, salt + i * 29, seed) * 2 - 1);
    value += n * n * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    fx = fx * 2.01 - 5.3;
    fz = fz * 2.01 + 9.2;
  }
  return value / total;
}
