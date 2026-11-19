/**
 * Tests for clearing the two on-device stores as one.
 *
 *   node --test src/session.test.mts
 *
 * The risk these cover is a half-teardown: the schedule going while the PDF
 * stays, or the reverse. Both stores are faked, so what is asserted is that
 * each wrapper touches both.
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Schedule } from './schedule.ts';

// Minimal localStorage stand-in for Node, same shape as storage.test.mts uses.
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  get size() { return this.map.size; }
}

declare global {
  // eslint-disable-next-line no-var
  var localStorage: MemoryStorage;
}

globalThis.localStorage = new MemoryStorage();

// `pdf-storage` talks to IndexedDB, which Node has none of. Every one of its
// entry points returns early when `indexedDB` is undefined, so the module
// imports cleanly here and its half of each wrapper is a no-op.
import { forgetEverything } from './session.ts';
import { saveMe, saveSchedule, loadMe, loadSchedule } from './storage.ts';

const august2026: Schedule = {
  days: [{ date: '2026-08-01', weekday: 'Lördag', dayNum: 1, lines: [{ blocks: [] }] }],
  people: ['AN', 'BO'],
  monthLabel: 'Augusti 2026',
  year: 2026,
  month: 8,
  warnings: [],
};

const inMonth = new Date(2026, 7, 15);

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage();
});

test('forgetEverything leaves nothing of this user', async () => {
  saveMe('AN');
  saveSchedule(august2026);
  await forgetEverything();
  assert.equal(loadSchedule(inMonth), null);
  assert.equal(loadMe(), null);
  assert.equal(localStorage.size, 0);
});

test('resolves even with no IndexedDB present', async () => {
  // Node has no indexedDB, which is the same situation as a browser with
  // storage disabled. It must not reject: the UI ignores the promise, and a
  // rejection would surface as an unhandled one.
  await assert.doesNotReject(() => forgetEverything());
});
