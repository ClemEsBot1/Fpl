// The gameweek's best XI as a picture (1200×675 PNG): attached to the
// Bluesky preview post (src/lib/social.js) and used as /fpl-predictions'
// link preview image. Drawn with satori (layout to SVG) and resvg (SVG to
// PNG), server-side only.

import { readFileSync } from 'node:fs';

const WIDTH = 1200;
const HEIGHT = 675;
const LIME = '#CEFF10';
const INK = '#FBFAFF';
const DIM = 'rgba(251,250,255,0.70)';

let fonts = null;
function loadFonts() {
  if (!fonts) {
    const file = name => readFileSync(new URL(`./fonts/${name}`, import.meta.url));
    fonts = [
      { name: 'Inter', data: file('inter-latin-400-normal.woff'), weight: 400, style: 'normal' },
      { name: 'Inter', data: file('inter-latin-700-normal.woff'), weight: 700, style: 'normal' },
      { name: 'Space Grotesk', data: file('space-grotesk-latin-700-normal.woff'), weight: 700, style: 'normal' },
    ];
  }
  return fonts;
}

// satori's element shape, without React.
const h = (style, children) => ({ type: 'div', props: { style: { display: 'flex', ...style }, children } });
const fmt = n => (Math.round(n * 10) / 10).toFixed(1);

function playerChip(p, captain) {
  return h({ flexDirection: 'column', alignItems: 'center', width: 150, padding: '6px 6px 8px', borderRadius: 14, background: 'rgba(10,8,30,0.78)', border: captain ? `3px solid ${LIME}` : '1px solid rgba(255,255,255,0.18)' }, [
    h({ fontFamily: 'Inter', fontWeight: 700, fontSize: 20, color: INK, maxWidth: 138, overflow: 'hidden', whiteSpace: 'nowrap' }, `${p.name}${captain ? ' (C)' : ''}`),
    h({ marginTop: 2, fontFamily: 'Inter', fontSize: 15, color: DIM }, p.team),
    h({ marginTop: 4, padding: '1px 10px', borderRadius: 999, background: LIME, color: '#05041A', fontFamily: 'Inter', fontWeight: 700, fontSize: 18 }, fmt(captain ? p.predicted * 2 : p.predicted)),
  ]);
}

// The picture as satori elements. xi: [{ name, team, positionId, predicted }]
// (eleven), captainId, gwId.
export function bestXiElement({ gwId, xi, captainId, total }) {
  const rows = [4, 3, 2, 1].map(pos => xi.filter(p => p.positionId === pos));
  return h({ width: WIDTH, height: HEIGHT, background: 'linear-gradient(135deg, #04F9FC 0%, #7573F7 55%, #BF1CF0 100%)', padding: 28 }, [
    h({ width: WIDTH - 56 - 68, height: HEIGHT - 56 - 42, flexDirection: 'column', borderRadius: 28, background: 'rgba(10,8,30,0.84)', padding: '22px 34px 20px' }, [
      h({ justifyContent: 'space-between', alignItems: 'center' }, [
        h({ alignItems: 'center' }, [
          h({ width: 18, height: 18, borderRadius: 4, background: LIME, marginRight: 14 }, ''),
          h({ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 38, color: INK }, `GW${gwId} best XI`),
        ]),
        h({ fontFamily: 'Inter', fontSize: 24, color: DIM }, [`Predicted `, h({ color: LIME, fontWeight: 700, margin: '0 8px' }, `${fmt(total)} pts`), ` · £100m`]),
      ]),
      h({ flexGrow: 1, flexDirection: 'column', justifyContent: 'space-around', marginTop: 12, padding: '6px 0', borderRadius: 18, border: '2px solid rgba(255,255,255,0.10)', background: 'rgba(4,249,165,0.06)' },
        rows.map(row => h({ justifyContent: 'center' }, row.map(p => h({ margin: '0 10px' }, [playerChip(p, p.id === captainId)]))))),
      h({ justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }, [
        h({ fontFamily: 'Inter', fontSize: 20, color: DIM }, 'Free FPL points predictor: your team, captain and transfers'),
        h({ padding: '8px 16px', borderRadius: 10, background: LIME, color: '#05041A', fontFamily: 'Inter', fontWeight: 700, fontSize: 22 }, 'fplchecker.co.uk'),
      ]),
    ]),
  ]);
}

// The best XI from the model (src/lib/seoDynamic.js) and the saved best
// squad, as the picture's data; null when there isn't a full XI.
export function bestXiData(model, snap) {
  if (!snap || snap.gwId !== model.event.id || !Array.isArray(snap.startingIds)) return null;
  const xi = snap.startingIds.map(id => model.playerById[id]).filter(p => p && p.predicted !== null);
  if (xi.length !== 11) return null;
  const captain = model.playerById[snap.captainId];
  const total = xi.reduce((s, p) => s + p.predicted, 0) + (captain && captain.predicted !== null ? captain.predicted : 0);
  return { gwId: model.event.id, xi, captainId: snap.captainId, total, alt: `GW${model.event.id} best XI, predicted ${fmt(total)} points: ${xi.map(p => `${p.name}${p.id === snap.captainId ? ' (captain)' : ''}`).join(', ')}.` };
}

export async function bestXiPng(data) {
  const [{ default: satori }, { Resvg }] = await Promise.all([import('satori'), import('@resvg/resvg-js')]);
  const svg = await satori(bestXiElement(data), { width: WIDTH, height: HEIGHT, fonts: loadFonts() });
  return new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng();
}

export const IMAGE_SIZE = { width: WIDTH, height: HEIGHT };
