export const ITEMS = Object.freeze({
  wood: { label: 'Wood', weight: 0.5 },
  stick: { label: 'Stick', weight: 0.1 },
  stone: { label: 'Stone', weight: 0.75 },
  flint: { label: 'Flint', weight: 0.15 },
  fiber: { label: 'Plant fiber', weight: 0.08 },
  herb: { label: 'Medicinal herb', weight: 0.05 },
  berry: { label: 'Wild berries', weight: 0.12 },
  resin: { label: 'Tree resin', weight: 0.08 },
  hide: { label: 'Animal hide', weight: 0.8 },
  raw_meat: { label: 'Raw meat', weight: 1 },
  cooked_meat: { label: 'Cooked meat', weight: 0.8 },
  dirty_water: { label: 'Untreated water', weight: 1 },
  clean_water: { label: 'Clean water', weight: 1 },
  bandage: { label: 'Herbal bandage', weight: 0.1 },
  rope: { label: 'Rope', weight: 0.2 },
  torch: { label: 'Torch', weight: 0.3 },
  stone_axe: { label: 'Stone axe', weight: 2.4 },
  spear: { label: 'Stone spear', weight: 2.2 },
  bow: { label: 'Short bow', weight: 1.5 },
  arrow: { label: 'Stone arrow', weight: 0.05 },
  campfire_kit: { label: 'Campfire kit', weight: 3 },
  shelter_kit: { label: 'Shelter kit', weight: 5 },
  hide_jacket: { label: 'Hide jacket', weight: 2.8 },
  hide_boots: { label: 'Hide boots', weight: 1.7 },
});

export const RECIPES = Object.freeze({
  rope: { label: 'Rope', inputs: { fiber: 3 }, output: { rope: 1 }, duration: 1 },
  torch: { label: 'Torch', inputs: { stick: 1, fiber: 2, resin: 1 }, output: { torch: 1 }, duration: 2 },
  stone_axe: { label: 'Stone axe', inputs: { stone: 2, stick: 1, rope: 1 }, output: { stone_axe: 1 }, duration: 3 },
  spear: { label: 'Stone spear', inputs: { stick: 2, stone: 1, fiber: 2 }, output: { spear: 1 }, duration: 3 },
  bow: { label: 'Short bow', inputs: { stick: 3, fiber: 3, rope: 1 }, output: { bow: 1 }, duration: 5 },
  arrow: { label: 'Stone arrows', inputs: { stick: 1, fiber: 1, stone: 1 }, output: { arrow: 3 }, duration: 2 },
  bandage: { label: 'Herbal bandage', inputs: { fiber: 2, herb: 1 }, output: { bandage: 2 }, duration: 2 },
  campfire_kit: { label: 'Campfire kit', inputs: { stick: 3, wood: 2, stone: 2 }, output: { campfire_kit: 1 }, duration: 3 },
  shelter_kit: { label: 'Shelter kit', inputs: { wood: 8, fiber: 6, rope: 2 }, output: { shelter_kit: 1 }, duration: 6 },
  hide_jacket: { label: 'Hide jacket', inputs: { hide: 4, fiber: 2 }, output: { hide_jacket: 1 }, duration: 6 },
  hide_boots: { label: 'Hide boots', inputs: { hide: 3, fiber: 2 }, output: { hide_boots: 1 }, duration: 5 },
  cooked_meat: { label: 'Cook meat', inputs: { raw_meat: 1 }, output: { cooked_meat: 1 }, duration: 7, station: 'fire' },
  clean_water: { label: 'Purify water', inputs: { dirty_water: 1 }, output: { clean_water: 1 }, duration: 6, station: 'fire' },
});

export const HOTBAR = Object.freeze(['stone_axe', 'spear', 'bow', 'torch', 'bandage', 'clean_water', 'berry', 'cooked_meat']);

export function itemLabel(id) {
  return ITEMS[id]?.label || id;
}

export function itemWeight(id) {
  return ITEMS[id]?.weight || 0;
}

export function countItem(inventory, id) {
  return inventory[id] || 0;
}

export function addItem(inventory, id, amount = 1) {
  if (!ITEMS[id] || amount <= 0) return 0;
  const remainingCapacity = Math.max(0, 35 - totalWeight(inventory));
  const fit = Math.min(amount, Math.floor((remainingCapacity + 1e-6) / itemWeight(id)));
  if (fit <= 0) return 0;
  inventory[id] = (inventory[id] || 0) + fit;
  return fit;
}

export function removeItem(inventory, id, amount = 1) {
  const available = inventory[id] || 0;
  const removed = Math.min(available, amount);
  if (removed <= 0) return 0;
  if (available === removed) delete inventory[id];
  else inventory[id] = available - removed;
  return removed;
}

export function totalWeight(inventory) {
  let weight = 0;
  for (const [id, amount] of Object.entries(inventory)) weight += itemWeight(id) * amount;
  return weight;
}

export function canCraft(inventory, recipeId) {
  const recipe = RECIPES[recipeId];
  if (!recipe) return false;
  return Object.entries(recipe.inputs).every(([id, amount]) => countItem(inventory, id) >= amount);
}

export function inventoryEntries(inventory) {
  return Object.entries(inventory)
    .filter(([, amount]) => amount > 0)
    .map(([id, amount]) => ({ id, amount, label: itemLabel(id), weight: itemWeight(id) * amount }));
}
