/** Shared, pure basket/wishlist model. Product data always comes from the catalogue. */
export const STORAGE_KEY = 'simal:selection:v1';
export const LEGACY_KEYS = Object.freeze(['simal-selection-v1']);
export const MAX_ITEMS = 50;
export const MAX_QUANTITY = 9999;
export const MAX_FAVORITES = 500;
const RESERVED_IDS = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'toString',
  'valueOf',
  'hasOwnProperty',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
]);

function validId(id) {
  return (
    typeof id === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(id) &&
    !RESERVED_IDS.has(id)
  );
}

function quantity(value) {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value))
  )
    return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 ? Math.min(MAX_QUANTITY, Math.floor(number)) : null;
}

const empty = () => ({ schemaVersion: 1, items: [], favorites: [] });

/** Also reads the archived {items,favorites,details} shape without trusting stored product details. */
export function normalizeState(raw) {
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return empty();
    }
  }
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    (raw.schemaVersion !== undefined && raw.schemaVersion !== 1)
  )
    return empty();
  const items = new Map();
  for (const item of Array.isArray(raw.items) ? raw.items : []) {
    if (!item || !validId(item.id)) continue;
    const qty = quantity(item.quantity);
    if (qty === null || (!items.has(item.id) && items.size >= MAX_ITEMS)) continue;
    items.set(item.id, Math.min(MAX_QUANTITY, (items.get(item.id) ?? 0) + qty));
  }
  const favorites = [];
  const seen = new Set();
  for (const id of Array.isArray(raw.favorites) ? raw.favorites : []) {
    if (!validId(id) || seen.has(id) || favorites.length >= MAX_FAVORITES) continue;
    seen.add(id);
    favorites.push(id);
  }
  return {
    schemaVersion: 1,
    items: [...items].map(([id, quantity]) => ({ id, quantity })),
    favorites,
  };
}

export function addItem(state, id, count = 1) {
  const next = normalizeState(state);
  const qty = quantity(count);
  if (!validId(id) || qty === null) return next;
  const existing = next.items.find((item) => item.id === id);
  if (existing) existing.quantity = Math.min(MAX_QUANTITY, existing.quantity + qty);
  else if (next.items.length < MAX_ITEMS) next.items.push({ id, quantity: qty });
  return next;
}

export function setQuantity(state, id, count) {
  const next = normalizeState(state);
  const qty = quantity(count);
  if (!validId(id) || qty === null) return next;
  const existing = next.items.find((item) => item.id === id);
  if (existing) existing.quantity = qty;
  return next;
}

export function removeItem(state, id) {
  const next = normalizeState(state);
  next.items = next.items.filter((item) => item.id !== id);
  return next;
}

export function toggleFavorite(state, id) {
  const next = normalizeState(state);
  if (!validId(id)) return next;
  if (next.favorites.includes(id)) next.favorites = next.favorites.filter((entry) => entry !== id);
  else if (next.favorites.length < MAX_FAVORITES) next.favorites.push(id);
  return next;
}

/** Remove exactly the accepted snapshot, preserving items added while the request was in flight. */
export function consumeSnapshot(state, snapshot) {
  const next = normalizeState(state);
  const submitted = normalizeState({
    items: Array.isArray(snapshot) ? snapshot : snapshot?.items,
  }).items;
  const quantities = new Map(submitted.map((item) => [item.id, item.quantity]));
  next.items = next.items.flatMap((item) => {
    const remaining = item.quantity - (quantities.get(item.id) ?? 0);
    return remaining > 0 ? [{ id: item.id, quantity: remaining }] : [];
  });
  return next;
}
