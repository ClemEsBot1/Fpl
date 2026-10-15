// Ready-to-paste Reddit replies built from the team on screen, in a
// casual voice, for admins answering r/FantasyPL questions (shown under
// the team results to admin accounts only). Every one links the site and
// says it's the poster's own: undisclosed self-promotion is against
// Reddit's and r/FantasyPL's rules.

const SITE = 'fplchecker.co.uk';
const DISCLOSURE = '(full disclosure it’s my site lol, but the numbers are the numbers)';

const fmt = n => (Math.round(n * 10) / 10).toFixed(1);
const money = p => `£${p.toFixed(1)}m`;
const nextFive = (predictionsById, id) => {
  const pred = predictionsById[id];
  if (!pred) return 0;
  return Array.isArray(pred.byGw) && pred.byGw.length ? pred.byGw.reduce((s, w) => s + w.points, 0) : pred.predicted * 5;
};

// "CHE (H)", or two for a double gameweek.
function fixtureText(player, gwId, fixturesByTeam, teamsById) {
  const fx = ((fixturesByTeam || {})[player.team] || []).filter(f => f.event === gwId);
  return fx.map(f => `${(teamsById[f.opponent] || {}).short_name || '?'} (${f.isHome ? 'H' : 'A'})`).join(' and ');
}

// Everything the replies are written from: the captain picks, the weakest
// starter and the best swap for him, a doubt, and the best low-owned
// players in the game.
export function replyData(data) {
  const { squad = [], suggestions = [], predictionsById = {}, allPlayers = [], targetEvent, fixturesByTeam, teamsById = {} } = data;
  const gwId = targetEvent ? targetEvent.id : null;
  const starters = squad.filter(s => s.isStarting);
  const byNext = [...starters].sort((a, b) => b.nextMatchPredicted - a.nextMatchPredicted);
  const xiTotal = starters.reduce((s, x) => s + x.nextMatchPredicted, 0) + (byNext[0] ? byNext[0].nextMatchPredicted : 0);
  const move = suggestions[0] || null;
  const doubt = starters.find(s => s.player.status && s.player.status !== 'a' && s.player.news) || null;
  const inSquad = new Set(squad.map(s => s.player.id));
  const differentials = allPlayers
    .filter(p => !inSquad.has(p.id) && p.status === 'a' && (p.selectedBy || 0) < 10 && predictionsById[p.id])
    .map(p => ({ player: p, five: nextFive(predictionsById, p.id) }))
    .sort((a, b) => b.five - a.five)
    .slice(0, 3);
  const fixture = p => (gwId ? fixtureText(p, gwId, fixturesByTeam, teamsById) : '');
  return {
    xiTotal,
    captain: byNext[0] ? { player: byNext[0].player, pts: byNext[0].nextMatchPredicted, fixture: fixture(byNext[0].player) } : null,
    vice: byNext[1] ? { player: byNext[1].player, pts: byNext[1].nextMatchPredicted } : null,
    move: move ? {
      out: move.out.player, outFive: nextFive(predictionsById, move.out.player.id),
      in: move.inPlayer, inFive: nextFive(predictionsById, move.inPlayer.id),
    } : null,
    doubt: doubt ? { player: doubt.player, news: doubt.player.news } : null,
    differentials,
  };
}

const doubtLine = d => (d.doubt ? `\n\nAlso keep an eye on ${d.doubt.player.webName}, he’s a doubt (${d.doubt.news.replace(/\s+$/, '')}).` : '');

// The replies, each { id, label, text }; a reply that needs something the
// team doesn't have (no move suggested, say) is left out.
export function redditReplies(data) {
  const d = replyData(data);
  const out = [];
  const cap = d.captain;
  if (cap) {
    const moveLine = d.move
      ? `\n\nOnly one I’d think about moving is ${d.move.out.webName}, not much coming over the next few weeks (${fmt(d.move.outFive)}). ${d.move.in.webName} at ${money(d.move.in.price)} looks way better (${fmt(d.move.inFive)}).`
      : '\n\nHonestly wouldn’t change much, nobody’s really standing out as a problem.';
    out.push({
      id: 'rate',
      label: 'Rate my team',
      text: `Not bad at all tbh. Ran it through ${SITE} and your XI’s looking at about ${fmt(d.xiTotal)} this week. I’d stick the armband on ${cap.player.webName} (${fmt(cap.pts)})${d.vice ? `, ${d.vice.player.webName}’s not far off though` : ''}.${moveLine}${doubtLine(d)}\n\n${DISCLOSURE}`,
    });
    out.push({
      id: 'captain',
      label: 'Who to captain',
      text: `I’d go ${cap.player.webName} tbh. Ran it through ${SITE} and he’s on about ${fmt(cap.pts)} this week${cap.fixture ? ` (${cap.fixture})` : ''}${d.vice ? `, ${d.vice.player.webName}’s next best on ${fmt(d.vice.pts)}` : ''}.${d.doubt && d.doubt.player.id === cap.player.id ? ' He’s a bit of a doubt though, so maybe have a backup.' : ''}\n\n${DISCLOSURE}`,
    });
  }
  if (d.move) {
    out.push({
      id: 'transfer',
      label: 'Should I transfer',
      text: `I’d do it tbh. ${d.move.out.webName} looks pretty quiet over the next few, ${SITE} has him on ${fmt(d.move.outFive)} over 5 GWs, and ${d.move.in.webName} at ${money(d.move.in.price)} is on ${fmt(d.move.inFive)}. Seems like a decent upgrade.\n\n${DISCLOSURE}`,
    });
  }
  if (d.differentials.length) {
    const [first, ...rest] = d.differentials;
    out.push({
      id: 'differential',
      label: 'Differentials',
      text: `If you’re after a differential, ${first.player.webName}’s only ${first.player.selectedBy}% owned and ${SITE} has him on ${fmt(first.five)} over the next 5.${rest.length ? ` ${rest.map(r => `${r.player.webName} (${r.player.selectedBy}%)`).join(' and ')} look decent too.` : ''}\n\n${DISCLOSURE}`,
    });
  }
  if (cap) {
    out.push({
      id: 'quick',
      label: 'Quick one',
      text: `${cap.player.webName} for captain${d.move ? `, and I’d swap ${d.move.out.webName} for ${d.move.in.webName} if you’ve got the FT` : ''}. Checked on ${SITE} (my site lol).`,
    });
  }
  return out;
}
