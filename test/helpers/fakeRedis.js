import assert from 'node:assert/strict';
import { COMPARE_AND_SET_SCRIPT } from '../../src/lib/redis.js';

// In-memory stand-in for the ioredis calls the handlers use: plain
// commands, SET's NX flag, MULTI transactions and the compare-and-set
// script in src/lib/redis.js.
export function fakeRedis() {
  const data = new Map();
  const commands = {
    get(k) { return data.has(k) ? data.get(k) : null; },
    set(k, v, ...opts) {
      if (opts.includes('NX') && data.has(k)) return null;
      data.set(k, String(v));
      return 'OK';
    },
    incr(k) { const n = Number(data.get(k) || 0) + 1; data.set(k, String(n)); return n; },
    decr(k) { const n = Number(data.get(k) || 0) - 1; data.set(k, String(n)); return n; },
    del(k) { return data.delete(k) ? 1 : 0; },
  };
  const redis = {
    async keys() { return data.keys(); },
    // One page with every match: ['0', keys]. Only `prefix*` patterns.
    async scan(cursor, match, pattern) {
      const prefix = String(pattern || '*').replace(/\*$/, '');
      return ['0', [...data.keys()].filter(k => k.startsWith(prefix))];
    },
    async eval(script, numKeys, key, expected, next) {
      assert.equal(script, COMPARE_AND_SET_SCRIPT);
      if (data.get(key) !== expected) return 0;
      data.set(key, next);
      return 1;
    },
    multi() {
      const queued = [];
      const tx = {
        exec: async () => queued.map(([name, args]) => [null, commands[name](...args)]),
      };
      Object.keys(commands).forEach(name => { tx[name] = (...args) => { queued.push([name, args]); return tx; }; });
      return tx;
    },
  };
  Object.entries(commands).forEach(([name, fn]) => { redis[name] = async (...args) => fn(...args); });
  return redis;
}

