// Draws a shareable PNG of a squad's predicted points (1080×1350, the
// portrait size Instagram, WhatsApp and Discord all display well) and
// hands it to the phone's share sheet, or downloads it where sharing
// files isn't supported.

const W = 1080;
const H = 1350;
const POS_LABEL = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };

function fmt(n) { return (Math.round(n * 10) / 10).toFixed(1); }

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

// slots: [{ player: { webName, team, positionId }, isStarting, isCaptain,
// isViceCaptain, nextMatchPredicted }]
export async function drawShareCard({ teamName, gwName, total, slots, teamsById, siteUrl }) {
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#04F9FC');
  bg.addColorStop(0.55, '#7573F7');
  bg.addColorStop(1, '#BF1CF0');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = 'rgba(10,8,30,0.72)';
  roundRect(ctx, 48, 48, W - 96, H - 96, 28);
  ctx.fill();

  const display = '"Space Grotesk", "Inter", sans-serif';
  const mono = '"IBM Plex Mono", monospace';

  ctx.fillStyle = '#CEFF10';
  ctx.fillRect(96, 104, 18, 18);
  ctx.fillStyle = '#FBFAFF';
  ctx.font = `700 34px ${display}`;
  ctx.fillText('FPL SQUAD CHECK', 128, 124);

  ctx.font = `700 54px ${display}`;
  ctx.fillText(fitText(ctx, teamName || 'My squad', W - 192), 96, 206);
  ctx.fillStyle = 'rgba(251,250,255,0.72)';
  ctx.font = `500 30px ${mono}`;
  ctx.fillText((gwName || '').toUpperCase(), 96, 252);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#CEFF10';
  ctx.font = `700 96px ${mono}`;
  ctx.fillText(fmt(total), W - 96, 230);
  ctx.fillStyle = 'rgba(251,250,255,0.72)';
  ctx.font = `600 22px ${mono}`;
  ctx.fillText('PREDICTED PTS', W - 96, 266);
  ctx.textAlign = 'left';

  const starters = slots.filter(s => s.isStarting).sort((a, b) => a.player.positionId - b.player.positionId);
  const bench = slots.filter(s => !s.isStarting);
  let y = 330;
  const rowH = 58;
  const drawRow = (s, dim) => {
    ctx.globalAlpha = dim ? 0.6 : 1;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(ctx, 96, y - 40, W - 192, rowH - 10, 10);
    ctx.fill();
    ctx.fillStyle = 'rgba(251,250,255,0.72)';
    ctx.font = `700 22px ${mono}`;
    ctx.fillText(POS_LABEL[s.player.positionId] || '', 116, y - 8);
    ctx.fillStyle = '#FBFAFF';
    ctx.font = `600 32px ${display}`;
    const name = fitText(ctx, s.player.webName, 520);
    ctx.fillText(name, 196, y - 6);
    let x = 196 + ctx.measureText(name).width + 14;
    if (s.isCaptain || s.isViceCaptain) {
      ctx.fillStyle = s.isCaptain ? '#04F9FC' : '#7573F7';
      roundRect(ctx, x, y - 34, 34, 34, 6);
      ctx.fill();
      ctx.fillStyle = '#03132B';
      ctx.font = `700 22px ${mono}`;
      ctx.textAlign = 'center';
      ctx.fillText(s.isCaptain ? 'C' : 'V', x + 17, y - 9);
      ctx.textAlign = 'left';
      x += 46;
    }
    const team = teamsById && teamsById[s.player.team];
    ctx.fillStyle = 'rgba(251,250,255,0.72)';
    ctx.font = `500 24px ${mono}`;
    if (team) ctx.fillText(team.short_name, Math.max(x, 760), y - 8);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#FBFAFF';
    ctx.font = `700 32px ${mono}`;
    ctx.fillText(fmt(s.nextMatchPredicted * (s.isCaptain ? 2 : 1)), W - 116, y - 6);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
    y += rowH;
  };
  starters.forEach(s => drawRow(s, false));
  ctx.fillStyle = 'rgba(251,250,255,0.72)';
  ctx.font = `600 22px ${mono}`;
  ctx.fillText('BENCH', 96, y - 10);
  y += 36;
  bench.forEach(s => drawRow(s, true));

  ctx.fillStyle = 'rgba(251,250,255,0.72)';
  ctx.font = `500 24px ${mono}`;
  ctx.textAlign = 'center';
  ctx.fillText(siteUrl || '', W / 2, H - 84);
  ctx.textAlign = 'left';
  return canvas;
}

// Shares the card as an image where the browser can (most phones), and
// otherwise downloads it. Returns 'shared', 'downloaded' or 'cancelled'.
export async function shareCard(canvas, { title, fileName = 'fpl-squad.png' }) {
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  const file = new File([blob], fileName, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
      // fall through to download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
