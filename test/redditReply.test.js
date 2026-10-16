import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VARIANTS, redditReplies, replyData } from '../src/lib/redditReply.js';

const pl = (id, webName, extra = {}) => ({ id, webName, team: 1, price: 6.0, status: 'a', news: '', selectedBy: 20, ...extra });
const slot = (player, next, starting = true) => ({ player, nextMatchPredicted: next, isStarting: starting });
const salah = pl(1, 'Salah', { price: 13.0 });
const haaland = pl(2, 'Haaland', { team: 2, price: 15.0 });
const flop = pl(3, 'Flop', { price: 5.5 });
const doubt = pl(4, 'Doubt', { status: 'd', news: 'Knock - 75% chance of playing' });
const mbeumo = pl(5, 'Mbeumo', { price: 7.5 });
const diff = pl(6, 'Sleeper', { selectedBy: 3.2 });
const predictionsById = Object.fromEntries([[1, 7.4], [2, 7.0], [3, 2.0], [4, 4.0], [5, 6.0], [6, 5.0]].map(([id, v]) => [id, { predicted: v, byGw: [0, 1, 2, 3, 4].map(k => ({ event: 9 + k, points: v })) }]));
const data = {
  squad: [slot(salah, 7.4), slot(haaland, 7.0), slot(flop, 2.0), slot(doubt, 4.0), slot(pl(7, 'Bench'), 1.0, false)],
  suggestions: [{ out: slot(flop, 2.0), inPlayer: mbeumo }],
  predictionsById, allPlayers: [salah, haaland, flop, doubt, mbeumo, diff],
  targetEvent: { id: 9 }, fixturesByTeam: { 1: [{ event: 9, opponent: 3, isHome: true }] }, teamsById: { 3: { short_name: 'CHE' } },
};

test('the replies are built from the team: captain, the swap, a doubt and differentials', () => {
  const d = replyData(data);
  assert.equal(d.captain.player.webName, 'Salah');
  assert.equal(d.captain.fixture, 'CHE (H)');
  assert.equal(d.vice.player.webName, 'Haaland');
  assert.equal(Math.round(d.xiTotal * 10) / 10, 27.8, 'starters plus the captain again');
  assert.equal(d.move.out.webName, 'Flop');
  assert.equal(d.doubt.player.webName, 'Doubt');
  assert.deepEqual(d.differentials.map(x => x.player.webName), ['Sleeper'], 'low-owned, fit, not already in the team');
});

test('every reply links the site and says it’s ours', () => {
  const replies = redditReplies(data);
  assert.deepEqual(replies.map(r => r.id), ['rate', 'captain', 'transfer', 'differential', 'quick']);
  for (let v = 0; v < VARIANTS; v++) {
    for (const r of redditReplies(data, v)) {
      assert.match(r.text, /\[(FPL Checker|fplchecker\.co\.uk)\]\(https:\/\/fplchecker\.co\.uk\)/, `${r.id} ${v}: a Markdown link, so Reddit links it`);
      assert.match(r.text, /my (own )?site|I (made|built|run)|it’s mine/, `${r.id} ${v}: says it's ours`);
      assert.doesNotMatch(r.text, /undefined|NaN|\{S\}/, `${r.id} ${v}`);
    }
  }
  const rate = replies[0].text;
  assert.match(rate, /^Not bad at all tbh\. Ran it through \[FPL Checker\]\(https:\/\/fplchecker\.co\.uk\) and your XI’s looking at about 27\.8 this week\. I’d stick the armband on Salah \(7\.4\), Haaland’s not far off though\./);
  assert.match(rate, /Only one I’d think about moving is Flop, not much coming over the next few weeks \(10\.0\)\. Mbeumo at £7\.5m looks way better \(30\.0\)\./);
  assert.match(rate, /Also keep an eye on Doubt, he’s a doubt \(Knock - 75% chance of playing\)\./);
  assert.match(replies[1].text, /I’d go Salah tbh\. .* \(CHE \(H\)\), Haaland’s next best on 7\.0\./);
});

test('replies that need a missing piece are left out', () => {
  const ids = redditReplies({ ...data, suggestions: [], allPlayers: [salah] }).map(r => r.id);
  assert.deepEqual(ids, ['rate', 'captain', 'quick']);
  assert.match(redditReplies({ ...data, suggestions: [] })[0].text, /wouldn’t change much/);
  assert.deepEqual(redditReplies({ ...data, squad: [], suggestions: [], allPlayers: [] }), []);
});

test('each reply has ten different wordings, cycling round', () => {
  for (const id of ['rate', 'captain', 'transfer', 'differential', 'quick']) {
    const texts = Array.from({ length: VARIANTS }, (_, v) => redditReplies(data, v).find(r => r.id === id).text);
    assert.equal(new Set(texts).size, VARIANTS, `${id}: all ten differ`);
    assert.equal(redditReplies(data, VARIANTS).find(r => r.id === id).text, texts[0], 'wraps back to the first');
  }
  assert.equal(redditReplies(data, -1)[0].text, redditReplies(data, VARIANTS - 1)[0].text);
  assert.equal(VARIANTS, 10);
});
