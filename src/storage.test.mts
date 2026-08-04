/**
 * Tests for on-device caching and its expiry.
 *
 *   npx tsx --test src/storage.test.mts
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Schedule } from './schedule.ts';
import {
  clearSchedule,
  expiryOf,
  forgetAll,
  loadMe,
  loadSchedule,
  saveMe,
  saveSchedule,
} from './storage.ts';

// Minimal localStorage stand-in for Node.
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

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage();
});

const august2026: Schedule = {
  days: [{ date: '2026-08-01', weekday: 'Lördag', dayNum: 1, lines: [{ blocks: [] }] }],
  people: ['ES', 'KA'],
  monthLabel: 'Augusti 2026',
  year: 2026,
  month: 8,
  warnings: [],
};

test('round-trips a schedule within its month', () => {
  saveSchedule(august2026);
  const got = loadSchedule(new Date(2026, 7, 15));
  assert.equal(got?.monthLabel, 'Augusti 2026');
  assert.equal(got?.days.length, 1);
});

test('is still valid on the last day of the month', () => {
  saveSchedule(august2026);
  // 23:00 on 31 August — the month is not over yet.
  assert.notEqual(loadSchedule(new Date(2026, 7, 31, 23, 0)), null);
});

test('expires once the month is over', () => {
  saveSchedule(august2026);
  // Midnight starting 1 September.
  assert.equal(loadSchedule(new Date(2026, 8, 1)), null);
});

test('removes the expired entry rather than leaving it on disk', () => {
  saveSchedule(august2026);
  loadSchedule(new Date(2026, 8, 2));
  assert.equal(localStorage.getItem('rosenbo.schedule'), null);
});

test('discards a cache written by an older version', () => {
  localStorage.setItem(
    'rosenbo.schedule',
    JSON.stringify({ v: 0, schedule: august2026 })
  );
  assert.equal(loadSchedule(new Date(2026, 7, 15)), null);
});

test('survives corrupt JSON without throwing', () => {
  localStorage.setItem('rosenbo.schedule', 'not json{{');
  assert.equal(loadSchedule(new Date(2026, 7, 15)), null);
  assert.equal(localStorage.getItem('rosenbo.schedule'), null);
});

test('clearSchedule keeps the chosen person', () => {
  saveMe('ES');
  saveSchedule(august2026);
  clearSchedule();
  assert.equal(loadSchedule(new Date(2026, 7, 15)), null);
  assert.equal(loadMe(), 'ES');
});

test('forgetAll leaves nothing behind', () => {
  saveMe('ES');
  saveSchedule(august2026);
  forgetAll();
  assert.equal(loadMe(), null);
  assert.equal(loadSchedule(new Date(2026, 7, 15)), null);
  assert.equal(localStorage.size, 0);
});

test('expiry is midnight after the schedule month ends', () => {
  // The PDF store computes its own expiry from this same function, so the two
  // caches can never disagree about which month is current. Asserted directly
  // because a drift here would only show up as a stale PDF weeks later.
  assert.deepEqual(expiryOf(august2026), new Date(2026, 8, 1));
  // December has to roll the year rather than land on month 12.
  assert.deepEqual(
    expiryOf({ ...august2026, year: 2026, month: 12 }),
    new Date(2027, 0, 1)
  );
});

test('the cache dies exactly when expiryOf says it does', () => {
  const expiry = expiryOf(august2026);
  saveSchedule(august2026);
  assert.ok(loadSchedule(new Date(expiry.getTime() - 1)), 'alive a tick before');
  saveSchedule(august2026);
  assert.equal(loadSchedule(expiry), null, 'gone on the boundary itself');
});

test('does not throw when storage is unavailable', () => {
  // Private browsing can make localStorage throw on every access.
  globalThis.localStorage = new Proxy(new MemoryStorage(), {
    get() { throw new Error('storage disabled'); },
  });
  assert.doesNotThrow(() => saveMe('ES'));
  assert.doesNotThrow(() => saveSchedule(august2026));
  assert.doesNotThrow(() => forgetAll());
  assert.equal(loadMe(), null);
  assert.equal(loadSchedule(), null);
});
