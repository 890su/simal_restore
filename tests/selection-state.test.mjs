import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeState,
  addItem,
  setQuantity,
  removeItem,
  toggleFavorite,
  consumeSnapshot,
  STORAGE_KEY,
  LEGACY_KEYS,
  MAX_ITEMS,
} from '../src/lib/selection-state.mjs';

test('migrates archived state without retaining stale or injected product details', () => {
  const state = normalizeState(
    JSON.stringify({
      items: [{ id: '10532', quantity: '2' }],
      favorites: ['10532', '10532'],
      details: { 10532: { title: 'untrusted' } },
    }),
  );
  assert.deepEqual(state, {
    schemaVersion: 1,
    items: [{ id: '10532', quantity: 2 }],
    favorites: ['10532'],
  });
  assert.equal(STORAGE_KEY, 'simal:selection:v1');
  assert.deepEqual(LEGACY_KEYS, ['simal-selection-v1']);
});

test('corrupt storage and unsupported future schemas yield an empty safe state', () => {
  for (const input of [
    '{bad',
    null,
    undefined,
    [],
    8,
    { schemaVersion: 3, items: [{ id: 'a', quantity: 1 }] },
  ])
    assert.deepEqual(normalizeState(input), { schemaVersion: 1, items: [], favorites: [] });
});

test('normalization rejects unsafe IDs and quantities, deduplicates and enforces bounds', () => {
  const state = normalizeState({
    items: [
      { id: '__proto__', quantity: 1 },
      { id: 'constructor', quantity: 1 },
      { id: '<img>', quantity: 1 },
      { id: 12, quantity: 1 },
      { id: 'a', quantity: -2 },
      { id: 'a', quantity: true },
      { id: 'b', quantity: '2junk' },
      { id: 'a', quantity: 9000 },
      { id: 'a', quantity: 2000 },
    ],
    favorites: ['a', '__proto__', 'constructor', '<script>', 'a', 'b'],
  });
  assert.deepEqual(state.items, [{ id: 'a', quantity: 9999 }]);
  assert.deepEqual(state.favorites, ['a', 'b']);
  const full = normalizeState({
    items: Array.from({ length: 80 }, (_, n) => ({ id: `p${n}`, quantity: 1 })),
  });
  assert.equal(full.items.length, MAX_ITEMS);
  assert.equal(addItem(full, 'extra').items.length, MAX_ITEMS);
  assert.equal(addItem(full, 'p0').items[0].quantity, 2);
});

test('basket operations are immutable and wishlist remains independent', () => {
  const original = Object.freeze({
    schemaVersion: 1,
    items: Object.freeze([Object.freeze({ id: 'a', quantity: 2 })]),
    favorites: Object.freeze(['a']),
  });
  const added = addItem(original, 'a', 3);
  assert.equal(added.items[0].quantity, 5);
  assert.equal(original.items[0].quantity, 2);
  assert.equal(setQuantity(added, 'a', 6).items[0].quantity, 6);
  assert.equal(setQuantity(added, 'a', 0).items[0].quantity, 5);
  assert.deepEqual(removeItem(original, 'a').favorites, ['a']);
  assert.deepEqual(toggleFavorite(original, 'a').favorites, []);
  assert.deepEqual(toggleFavorite(original, 'b').favorites, ['a', 'b']);
  assert.deepEqual(toggleFavorite(original, '__proto__').favorites, ['a']);
});

test('successful request consumes only its snapshot and preserves newer additions and wishlist', () => {
  const snapshot = {
    items: [
      { id: 'a', quantity: 2 },
      { id: 'b', quantity: 3 },
    ],
  };
  const current = {
    items: [
      { id: 'a', quantity: 5 },
      { id: 'b', quantity: 1 },
      { id: 'c', quantity: 4 },
    ],
    favorites: ['a'],
  };
  assert.deepEqual(consumeSnapshot(current, snapshot), {
    schemaVersion: 1,
    items: [
      { id: 'a', quantity: 3 },
      { id: 'c', quantity: 4 },
    ],
    favorites: ['a'],
  });
  assert.deepEqual(consumeSnapshot(current, snapshot.items), consumeSnapshot(current, snapshot));
  assert.equal(current.items[0].quantity, 5);
});
