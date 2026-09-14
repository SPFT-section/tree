// Species library: each species is a compact parametric vector (~bytes).
// No geometry is stored per species until a tree actually uses it (see forest.js).
// Same id => same shape/color/status on every load (deterministic).
//
// Real-world grounding (not invented numbers):
// - WORLD_TREES = 73,274: conservative global estimate, Cazzolla Gatti et al.,
//   PNAS 2022 (ground-sourced data, ~38M trees, 100+ scientists).
// - DESCRIBED ≈ 64,074 documented; UNDISCOVERED ≈ 9,200 yet to be described
//   (~40% of them expected in South America).
// - Status weights below are ILLUSTRATIVE, modeled on the first Global Tree
//   Assessment (IUCN Red List, Oct 2024): 16,425 of 47,282 assessed species
//   threatened (~1 in 3). CR is in the low thousands globally (BGCI), not hundreds.
import { mulberry32 } from './rng.js';

export const WORLD_TREES = 73274;
export const DESCRIBED = 64074;
export const UNDISCOVERED = 9200;

export const STATUS_COLORS = {
  LC: 0x4daf4a, NT: 0xa6d854, VU: 0xffd92f, EN: 0xff7f00,
  CR: 0xe41a1c, EX: 0x333333, DD: 0x999999, NE: 0xdddddd,
};
export const STATUS_LABEL = {
  LC: 'Least Concern', NT: 'Near Threatened', VU: 'Vulnerable',
  EN: 'Endangered', CR: 'Critically Endangered', EX: 'Extinct',
  DD: 'Data Deficient', NE: 'Undescribed (~9,200 await discovery)',
};
// Illustrative weights over described species: VU+EN+CR = 33.5% (~1 in 3, GTA 2024).
const STATUS_W = [
  ['LC', 55.5], ['NT', 6], ['DD', 4.5], ['VU', 15], ['EN', 12.5], ['CR', 6], ['EX', 0.5],
];

export function speciesParams(speciesId) {
  const r = mulberry32(((speciesId * 2654435761) ^ 0x85ebca6b) >>> 0);
  return {
    dDepth: Math.floor(r() * 3) - 1,   // -1..+1 around the global depth slider
    spreadMul: 0.6 + r() * 0.9,        // 0.6..1.5 x global spread slider
    leafScale: 0.6 + r() * 1.0,        // 0.6..1.6 x leaf card size
    slenderness: 0.85 + r() * 0.3,     // 0.85..1.15 x branch length
    hue: 0.24 + r() * 0.14,            // green .. yellow-green
    sat: 0.40 + r() * 0.25,
    light: 0.28 + r() * 0.14,
  };
}

export function speciesStatus(speciesId) {
  if (speciesId > DESCRIBED) return 'NE'; // science hasn't described it yet
  const r = mulberry32(((speciesId * 40503) ^ 0x9e3779b9) >>> 0)();
  let acc = 0;
  for (const [code, w] of STATUS_W) {
    acc += w;
    if (r * 100 < acc) return code;
  }
  return 'LC';
}

export function isThreatened(status) {
  return status === 'VU' || status === 'EN' || status === 'CR';
}
