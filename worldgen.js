// World generator on the tree engine: one-click biome presets + random
// worlds. A preset is a full parameter vector (seed, forest, grass, species,
// wind, time of day, overlay); applying it sets every control and regrows,
// so one click grows a whole new world.
import { dayState } from './daynight.js';

export const PRESETS = {
  deepforest: { label: '🌲 Deep Forest', trees: 800, depth: 5, spread: 0.5, grass: 15000, species: 2000, wind: 0.5, time: 10, redlist: false },
  savanna: { label: '🌾 Savanna', trees: 60, depth: 3, spread: 0.8, grass: 30000, species: 300, wind: 1.2, time: 13, redlist: false },
  alpine: { label: '🏔 Alpine Meadow', trees: 40, depth: 2, spread: 0.6, grass: 8000, species: 150, wind: 1.6, time: 11, redlist: false },
  night: { label: '🌙 Night Grove', trees: 300, depth: 4, spread: 0.55, grass: 10000, species: 1000, wind: 0.3, time: 0, redlist: false },
  hotspot: { label: '🚨 Red List Hotspot', trees: 500, depth: 4, spread: 0.6, grass: 6000, species: 64074, wind: 0.6, time: 9, redlist: true },
};

const $ = id => document.getElementById(id);

function setWorld(w, regrow) {
  $('p-seed').value = w.seed;
  $('p-depth').value = w.depth;
  $('p-spread').value = w.spread;
  $('n-trees').value = w.trees;
  $('p-grass').value = w.grass;
  $('p-species').value = w.species;
  $('p-wind').value = w.wind;
  $('p-time').value = w.time;
  $('p-redlist').checked = !!w.redlist;
  dayState.time = w.time;
  regrow();
}

export function applyPreset(key, regrow) {
  const p = PRESETS[key];
  if (!p) return false;
  setWorld({ ...p, seed: 1 + Math.floor(Math.random() * 9998) }, regrow);
  return true;
}

export function randomWorld(regrow) {
  setWorld({
    seed: 1 + Math.floor(Math.random() * 9998),
    depth: 2 + Math.floor(Math.random() * 4),
    spread: +(0.3 + Math.random() * 0.6).toFixed(2),
    trees: Math.round(50 * Math.pow(30, Math.random())), // 50..1500 log-uniform
    grass: Math.round(Math.random() * 30) * 1000,
    species: [150, 300, 1000, 2000, 10000][Math.floor(Math.random() * 5)],
    wind: +(Math.random() * 1.5).toFixed(2),
    time: Math.round(Math.random() * 48) / 2,
    redlist: Math.random() < 0.25,
  }, regrow);
}
