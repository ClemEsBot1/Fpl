// Ready-to-paste Reddit replies built from the team on screen, in a
// casual voice, for admins answering r/FantasyPL questions (shown under
// the team results to admin accounts only). Every one links the site and
// says it's the poster's own: undisclosed self-promotion is against
// Reddit's and r/FantasyPL's rules.
//
// Each reply comes in VARIANTS wordings, and the admin page moves to the
// next after every copy: many near-identical comments linking one site
// look like spam to Reddit's filter.
export const VARIANTS = 10;

// A Markdown link: Reddit shows the words, linked.
const LINKS = ['[FPL Checker](https://fplchecker.co.uk)', '[fplchecker.co.uk](https://fplchecker.co.uk)'];
const DISCLOSURES = [
  '(full disclosure it’s my site lol, but the numbers are the numbers)',
  '(disclaimer: I made the site, so take that how you want)',
  '(it’s my own site btw, just being upfront)',
  '(bias alert, I built it, but the predictions aren’t my opinion)',
  '(fair warning it’s my site, the maths doesn’t care who I support though)',
  '(I run the site, for transparency)',
  '(it’s my site, so yeah I’m biased lol)',
  '(should say I made it, it’s free though)',
  '(full disclosure: it’s my site)',
  '(it’s a site I built, worth saying)',
];

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

const pick = (list, v) => list[((v % list.length) + list.length) % list.length];

// The replies, each { id, label, text }, in wording `variant` (0 to
// VARIANTS - 1, wrapping); a reply that needs something the team doesn't
// have (no move suggested, say) is left out.
export function redditReplies(data, variant = 0) {
  const d = replyData(data);
  const v = ((Math.trunc(variant) % VARIANTS) + VARIANTS) % VARIANTS;
  const S = pick(LINKS, Math.floor(v / 5));
  const disc = pick(DISCLOSURES, v);
  const out = [];
  const cap = d.captain;
  const m = d.move;
  const news = d.doubt ? d.doubt.news.replace(/\s+$/, '') : '';
  const doubtLine = d.doubt ? '\n\n' + pick([
    `Also keep an eye on ${d.doubt.player.webName}, he’s a doubt (${news}).`,
    `${d.doubt.player.webName} is flagged btw (${news}), so watch the team news.`,
    `One thing, ${d.doubt.player.webName}’s a doubt (${news}). Might want cover on the bench.`,
    `Watch ${d.doubt.player.webName} though, FPL has him as ${news}.`,
    `Heads up on ${d.doubt.player.webName}: ${news}.`,
  ], v) : '';
  if (cap) {
    const vice = d.vice;
    const moveLine = m ? '\n\n' + pick([
      `Only one I’d think about moving is ${m.out.webName}, not much coming over the next few weeks (${fmt(m.outFive)}). ${m.in.webName} at ${money(m.in.price)} looks way better (${fmt(m.inFive)}).`,
      `If you’ve got a free transfer, ${m.out.webName} → ${m.in.webName} (${money(m.in.price)}) is the one. ${fmt(m.outFive)} vs ${fmt(m.inFive)} over the next 5.`,
      `Weak link is probably ${m.out.webName}, only ${fmt(m.outFive)} predicted over 5 GWs. ${m.in.webName} (${money(m.in.price)}) is on ${fmt(m.inFive)}.`,
      `I’d look at swapping ${m.out.webName} for ${m.in.webName}, about ${fmt(m.inFive - m.outFive)} more points over the next five.`,
      `${m.out.webName}’s the one I’d move on. ${m.in.webName} for ${money(m.in.price)} has a much better run (${fmt(m.inFive)} vs ${fmt(m.outFive)}).`,
    ], v) : '\n\n' + pick([
      'Honestly wouldn’t change much, nobody’s really standing out as a problem.',
      'Don’t see an obvious transfer tbh, I’d roll it.',
      'Nothing screaming to be sold, so I’d bank the FT.',
      'No real weak spot, I’d keep it as is.',
      'Wouldn’t burn a transfer on it this week.',
    ], v);
    const viceA = vice ? `, ${vice.player.webName}’s not far off though` : '';
    const viceB = vice ? ` with ${vice.player.webName} (${fmt(vice.pts)}) as vice` : '';
    const rate = [
      `Not bad at all tbh. Ran it through ${S} and your XI’s looking at about ${fmt(d.xiTotal)} this week. I’d stick the armband on ${cap.player.webName} (${fmt(cap.pts)})${viceA}.`,
      `Solid team. ${S} has your XI on roughly ${fmt(d.xiTotal)} this GW, captain ${cap.player.webName} (${fmt(cap.pts)})${viceB}.`,
      `Looks decent to me. I put it into ${S}: about ${fmt(d.xiTotal)} predicted for the XI, and ${cap.player.webName} is the best captain at ${fmt(cap.pts)}.`,
      `Pretty good shape I reckon. Around ${fmt(d.xiTotal)} for your starting 11 according to ${S}, ${cap.player.webName} the clear armband pick (${fmt(cap.pts)}).`,
      `I’d be happy with that. ${S} reckons ${fmt(d.xiTotal)}ish for the XI with ${cap.player.webName} captained (${fmt(cap.pts)})${viceA}.`,
      `Good team tbh. Checked it on ${S}, the XI’s predicted ${fmt(d.xiTotal)} and ${cap.player.webName} comes out top for captain (${fmt(cap.pts)}).`,
      `Not much wrong with it. Predicted about ${fmt(d.xiTotal)} this week on ${S}, armband on ${cap.player.webName} (${fmt(cap.pts)})${viceB}.`,
      `Nice one. Your XI comes out at ~${fmt(d.xiTotal)} on ${S}. ${cap.player.webName} (${fmt(cap.pts)}) for captain${viceA}.`,
      `It’s a good team. Plugged it into ${S} and got ${fmt(d.xiTotal)} for the XI, best captain ${cap.player.webName} on ${fmt(cap.pts)}.`,
      `Fair play, that’s strong. ${S} gives the XI ${fmt(d.xiTotal)} this GW. I’d captain ${cap.player.webName} (${fmt(cap.pts)})${viceB}.`,
    ];
    out.push({ id: 'rate', label: 'Rate my team', text: `${rate[v]}${moveLine}${doubtLine}\n\n${disc}` });

    const fx = cap.fixture ? ` (${cap.fixture})` : '';
    const next = vice ? `, ${vice.player.webName}’s next best on ${fmt(vice.pts)}` : '';
    const capDoubt = d.doubt && d.doubt.player.id === cap.player.id ? ' He’s a bit of a doubt though, so maybe have a backup.' : '';
    const captain = [
      `I’d go ${cap.player.webName} tbh. Ran it through ${S} and he’s on about ${fmt(cap.pts)} this week${fx}${next}.`,
      `${cap.player.webName} for me${fx}. ${S} has him on ${fmt(cap.pts)}${next}.`,
      `Captain ${cap.player.webName}. He’s top of your team on ${S} with ${fmt(cap.pts)}${fx}${next}.`,
      `Has to be ${cap.player.webName}${fx}, predicted ${fmt(cap.pts)} on ${S}${next}.`,
      `I’d armband ${cap.player.webName}. ${fmt(cap.pts)} predicted${fx} according to ${S}${next}.`,
      `${cap.player.webName} is the pick imo${fx}. ${S} puts him on ${fmt(cap.pts)}${next}.`,
      `Going by ${S}, ${cap.player.webName} (${fmt(cap.pts)})${fx}${next}.`,
      `Easy one, ${cap.player.webName}${fx}. He’s on ${fmt(cap.pts)} on ${S}${next}.`,
      `${cap.player.webName}. Checked ${S} and nobody else in your team comes close to his ${fmt(cap.pts)}${fx}.`,
      `I’d back ${cap.player.webName}${fx}, ${S} reckons ${fmt(cap.pts)}${next}.`,
    ];
    out.push({ id: 'captain', label: 'Who to captain', text: `${captain[v]}${capDoubt}\n\n${disc}` });
  }
  if (m) {
    const io = `${m.in.webName} at ${money(m.in.price)}`;
    const transfer = [
      `I’d do it tbh. ${m.out.webName} looks pretty quiet over the next few, ${S} has him on ${fmt(m.outFive)} over 5 GWs, and ${io} is on ${fmt(m.inFive)}. Seems like a decent upgrade.`,
      `Yeah go for it. ${S} has ${m.in.webName} on ${fmt(m.inFive)} over the next 5 vs ${fmt(m.outFive)} for ${m.out.webName}.`,
      `Worth it imo. ${m.out.webName} → ${io} gains about ${fmt(m.inFive - m.outFive)} over five GWs on ${S}.`,
      `I would. ${m.out.webName} looks quiet for a while (${fmt(m.outFive)} over 5 on ${S}), ${m.in.webName} has ${fmt(m.inFive)}.`,
      `Do it. ${io} is predicted ${fmt(m.inFive)} for the next 5 on ${S}, ${m.out.webName} only ${fmt(m.outFive)}.`,
      `Makes sense to me. According to ${S} it’s ${fmt(m.outFive)} (${m.out.webName}) vs ${fmt(m.inFive)} (${m.in.webName}) over five weeks.`,
      `Good move I think. ${S} rates ${io} way higher over the next 5: ${fmt(m.inFive)} to ${fmt(m.outFive)}.`,
      `I’d pull the trigger. ${m.out.webName} ${fmt(m.outFive)}, ${m.in.webName} ${fmt(m.inFive)} over the next 5 on ${S}.`,
      `Yep, ${m.in.webName}’s the better pick for the next few. ${S} has ${fmt(m.inFive)} vs ${fmt(m.outFive)}.`,
      `Ran it on ${S}: ${io} is about ${fmt(m.inFive - m.outFive)} points better than ${m.out.webName} over 5 GWs. I’d make it.`,
    ];
    out.push({ id: 'transfer', label: 'Should I transfer', text: `${transfer[v]}\n\n${disc}` });
  }
  if (d.differentials.length) {
    const [first, ...rest] = d.differentials;
    const f = first.player;
    const others = rest.length ? rest.map(r => `${r.player.webName} (${r.player.selectedBy}%)`).join(' and ') : '';
    const differential = [
      `If you’re after a differential, ${f.webName}’s only ${f.selectedBy}% owned and ${S} has him on ${fmt(first.five)} over the next 5.${others ? ` ${others} look decent too.` : ''}`,
      `${f.webName} is a good shout, ${f.selectedBy}% owned and ${fmt(first.five)} predicted over 5 on ${S}.${others ? ` Also ${others}.` : ''}`,
      `Differential wise I like ${f.webName}: ${f.selectedBy}% ownership, ${fmt(first.five)} over the next five on ${S}.${others ? ` ${others} are options too.` : ''}`,
      `Try ${f.webName}. Barely owned (${f.selectedBy}%) but ${S} has him on ${fmt(first.five)} for the next 5.${others ? ` Or ${others}.` : ''}`,
      `${S} has ${f.webName} (${f.selectedBy}%) as the best low-owned pick, ${fmt(first.five)} over five GWs.${others ? ` ${others} next.` : ''}`,
      `Low owned and decent: ${f.webName}, ${f.selectedBy}% with ${fmt(first.five)} predicted over 5 (${S}).${others ? ` ${others} aren’t bad either.` : ''}`,
      `I’d look at ${f.webName}. Only ${f.selectedBy}% have him and he’s on ${fmt(first.five)} over the next 5 on ${S}.${others ? ` ${others} too.` : ''}`,
      `${f.webName}’s flying under the radar (${f.selectedBy}%), ${S} predicts ${fmt(first.five)} over five.${others ? ` Others: ${others}.` : ''}`,
      `For a punt, ${f.webName}. ${f.selectedBy}% owned, ${fmt(first.five)} next 5 GWs on ${S}.${others ? ` ${others} worth a look.` : ''}`,
      `Best differential on ${S} right now is ${f.webName}, ${f.selectedBy}% owned, ${fmt(first.five)} over the next 5.${others ? ` Then ${others}.` : ''}`,
    ];
    out.push({ id: 'differential', label: 'Differentials', text: `${differential[v]}\n\n${disc}` });
  }
  if (cap) {
    const swap = m ? pick([
      `, and I’d swap ${m.out.webName} for ${m.in.webName} if you’ve got the FT`,
      `, ${m.out.webName} → ${m.in.webName} if you have a transfer`,
      `. ${m.in.webName} in for ${m.out.webName} too`,
      `, plus ${m.out.webName} out for ${m.in.webName}`,
      `. I’d also bring in ${m.in.webName} for ${m.out.webName}`,
    ], v) : '';
    const tag = pick([
      'Checked on {S} (my site lol).',
      'Went off {S}, my own site.',
      'That’s from {S}, which I made.',
      'Via {S} (I built it).',
      'Per {S}, my site btw.',
      'Numbers from {S} (I run it).',
      '{S} says so (my site, fair warning).',
      'Got that from {S}, full disclosure it’s mine.',
      'From {S}, it’s my site.',
      'Off {S}, a site I built.',
    ], v).replace('{S}', S);
    out.push({ id: 'quick', label: 'Quick one', text: `${cap.player.webName} for captain${swap}. ${tag}` });
  }
  return out;
}
