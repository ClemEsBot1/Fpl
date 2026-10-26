// Alerts from the matches being played, for your players: a goal, an
// assist, a red card, and the bonus once FPL confirms it. Sent as phone or
// desktop notifications with the other alerts (src/lib/push.js), which go
// out every 20 minutes. Only matches that kicked off in the last few hours
// count, so switching alerts on mid-gameweek doesn't send the week's
// earlier goals.

import { t } from './i18n.js';

// How long after kickoff a match's events are still sent.
export const RECENT_MS = 4 * 3600 * 1000;

// live: { gwId, elements: event/{gw}/live/'s elements, fixtures: FPL's
// fixtures for that gameweek }. playerIds: your squad. Returns
// [{ id, kind: 'goal' | 'assist' | 'red' | 'bonus', level: 'info', title, body }],
// each id stable, so each event is sent once.
export function liveAlerts(live, playerIds, { playersById, teamsById, now = Date.now(), tr = t } = {}) {
  if (!live || !Array.isArray(live.elements) || !Array.isArray(live.fixtures) || !playerIds || !playerIds.length) return [];
  const mine = new Set(playerIds);
  const fixtureById = new Map(live.fixtures.map(f => [f.id, f]));
  const recent = f => f && f.started && f.kickoff_time && now - new Date(f.kickoff_time).getTime() < RECENT_MS;
  const score = f => {
    const h = teamsById[f.team_h];
    const a = teamsById[f.team_a];
    return `${h ? h.short_name : '?'} ${f.team_h_score ?? 0}–${f.team_a_score ?? 0} ${a ? a.short_name : '?'}`;
  };
  const out = [];
  live.elements.forEach(el => {
    if (!mine.has(el.id)) return;
    const player = playersById[el.id];
    const name = player ? player.webName : `#${el.id}`;
    (el.explain || []).forEach(x => {
      const f = fixtureById.get(x.fixture);
      if (!recent(f)) return;
      const stat = key => (x.stats || []).find(s => s.identifier === key);
      const base = `live-${live.gwId}-${f.id}-${el.id}`;
      const goals = stat('goals_scored');
      for (let n = 1; goals && n <= goals.value; n++) {
        out.push({ id: `${base}-goal-${n}`, kind: 'goal', level: 'info', title: tr('⚽ {name} scored', { name }), body: score(f) });
      }
      const assists = stat('assists');
      for (let n = 1; assists && n <= assists.value; n++) {
        out.push({ id: `${base}-assist-${n}`, kind: 'assist', level: 'info', title: tr('🅰️ Assist for {name}', { name }), body: score(f) });
      }
      const red = stat('red_cards');
      if (red && red.value) out.push({ id: `${base}-red`, kind: 'red', level: 'info', title: tr('🟥 {name} sent off', { name }), body: score(f) });
      const bonus = stat('bonus');
      if (bonus && bonus.value) {
        out.push({ id: `${base}-bonus`, kind: 'bonus', level: 'info', title: tr('⭐ {name} gets {n} bonus', { name, n: bonus.value }), body: score(f) });
      }
    });
  });
  return out;
}
