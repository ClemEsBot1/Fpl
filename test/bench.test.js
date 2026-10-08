import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBenchOrder, playProbability, suggestBenchOrder } from '../src/lib/bench.js';

// 4-4-2 with the bench keeper, then three outfield substitutes.
const POS = [1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 1, 2, 3, 4];
function squad({ doubt = null, benchPts = [1, 2, 5] } = {}) {
  return POS.map((positionId, i) => {
    const id = i + 1;
    const isStarting = i < 11;
    const avail = id === doubt ? 0.25 : 1;
    const pts = isStarting ? 4 : i === 11 ? 3 : benchPts[i - 12];
    return { player: { id, positionId, appearanceShare: 1 }, isStarting, nextMatchPredicted: pts * avail, breakdown: { availMult: avail } };
  });
}

test('a regular plays, a doubt mostly does not', () => {
  const s = squad({ doubt: 6 });
  assert.equal(playProbability(s[0]), 1);
  assert.equal(playProbability(s[5]), 0.25);
  assert.equal(playProbability({ player: { appearanceShare: 0.5 }, breakdown: { availMult: 0.8, minutesMult: 0.5 } }), 0.2);
});

test('with a doubtful midfielder the best-scoring substitute goes first', () => {
  const s = squad({ doubt: 6 });
  const tip = suggestBenchOrder(s);
  assert.deepEqual(tip.current.order, [13, 14, 15]);
  assert.equal(tip.order[0], 15);
  assert.ok(tip.gain > 2, `gain ${tip.gain}`);
});

test('when everyone is fit the order changes nothing', () => {
  const tip = suggestBenchOrder(squad());
  assert.equal(tip.gain, 0);
  assert.deepEqual(tip.order, tip.current.order);
});

test('a doubtful defender in a back three can only be covered by a defender', () => {
  // 3-5-2: the starting defenders are 2, 3 and 4.
  const s = squad({ doubt: 2, benchPts: [1, 6, 5] });
  s[4] = { ...s[4], isStarting: false };
  s[12] = { ...s[12], player: { ...s[12].player, positionId: 3 } };
  s[11 + 1] = { ...s[12], isStarting: false };
  const benchDef = { player: { id: 5, positionId: 2, appearanceShare: 1 }, isStarting: false, nextMatchPredicted: 1, breakdown: { availMult: 1 } };
  const lineup = [...s.slice(0, 4), ...s.slice(5, 11), s[11], benchDef, s[13], s[14]];
  lineup.splice(4, 0, { player: { id: 16, positionId: 3, appearanceShare: 1 }, isStarting: true, nextMatchPredicted: 4, breakdown: { availMult: 1 } });
  const tip = suggestBenchOrder(lineup);
  // Only the defender can come on, so every order scores the same.
  assert.equal(tip.gain, 0);
  assert.ok(Math.abs(tip.expected - 0.75) < 0.1, `expected ${tip.expected}`);
});

test('a new bench order keeps the keeper and the XI where they were', () => {
  const s = squad();
  const next = applyBenchOrder(s, [15, 13, 14]);
  assert.deepEqual(next.map(x => x.player.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 13, 14]);
});
