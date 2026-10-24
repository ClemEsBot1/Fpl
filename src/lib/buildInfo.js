// Which pull request a build came from, for the admin page's title. A
// preview build knows its PR (Vercel's VERCEL_GIT_PULL_REQUEST_ID); a build
// of main is a squash merge, whose message ends "(#119)". Read once, when
// vite.config.ts builds the app.
export function prNumberFrom({ prId = '', message = '' } = {}) {
  const id = Number(prId);
  if (Number.isInteger(id) && id > 0) return id;
  const m = String(message || '').split('\n')[0].match(/\(#(\d+)\)\s*$/);
  return m ? Number(m[1]) : null;
}
