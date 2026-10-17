import { getRedis, getJSON, createJSON, updateJSON } from '../src/lib/redis.js';
import { clientIp, bump, release, reset } from '../src/lib/rateLimit.js';
import {
  validateUsername, validateNewUsername, validatePassword, normalizeEmail,
  hashPassword, verifyPassword, signSessionToken, generateAuthId,
  buildSessionCookie, buildClearedSessionCookie, getSessionFromRequest,
  sessionMatchesRecord, isJsonRequest, readCookie,
  userKeyFor, normalizeUsername, emailKeyFor,
} from '../src/lib/auth.js';
import {
  GOOGLE_STATE_COOKIE, authorizationUrl, clearedStateCookie, exchangeCode, googleConfig, googleKeyFor,
  newState, parseState, redirectUriFor, stateCookie, stateMatches, suggestUsername,
} from '../src/lib/googleAuth.js';
import { CODE_TTL_SECONDS, issueCode, redeemCode } from '../src/lib/emailCodes.js';
import { TERMS_VERSION } from '../src/lib/terms.js';
import { mailerConfigured, sendMail } from '../src/lib/mailer.js';
import { pushHandler } from '../src/lib/push.js';
import { codeEmail } from '../src/lib/emails.js';
import { recordError, clearErrors } from '../src/lib/errorLog.js';
import {
  deleteReport, deleteUser, findUser, healthReport, isAdmin, listReports, refreshBestSquad,
  setReportDone, signOutEverywhere, socialPosts, socialSend, triggerRetrain, userStats, usersCsv,
  deleteUser as deleteAccount,
} from '../src/lib/adminServer.js';
import { markSent } from '../src/lib/social.js';
import { digestHandler } from '../src/lib/digestHandler.js';
import { cleanTeamId } from '../src/lib/digest.js';

// Without a cap, anyone could keep guessing a user's password forever.
// Failed logins are counted per username (protects one account from a
// distributed attack) and per IP (stops one client trying many accounts);
// a successful login clears that username's counter. Every attempt is
// counted before the password is checked, so a burst of parallel guesses
// can't all get in under the limit.
export const LOGIN_WINDOW_SECONDS = 15 * 60;
export const MAX_FAILED_LOGINS_PER_USER = 10;
export const MAX_FAILED_LOGINS_PER_IP = 30;
export const REGISTER_WINDOW_SECONDS = 60 * 60;
export const MAX_REGISTRATIONS_PER_IP = 5;
// Reset emails: capped per IP (stops someone spamming many inboxes) and
// per account (stops someone flooding one inbox).
export const RESET_WINDOW_SECONDS = 60 * 60;
export const MAX_RESET_REQUESTS_PER_IP = 10;
export const MAX_RESET_EMAILS_PER_USER = 3;
// Verification codes: a few resends an hour per account.
export const VERIFY_WINDOW_SECONDS = 60 * 60;
export const MAX_VERIFY_EMAILS_PER_USER = 5;

// The site's address in emails. Fixed rather than taken from the request's
// Host header, which a client controls.
const APP_URL = (process.env.APP_URL || 'https://fplchecker.co.uk').replace(/\/+$/, '');

const EMAIL_TAKEN = 'That email is already used by another account.';
const NO_ACCOUNT = 'No account found with that username or email.';
const NO_EMAIL = "That account doesn't have an email address, so its password can't be reset by email.";
const CODE_INVALID = 'That code is wrong or has expired. Check the latest email, or ask for a new code.';
const NEED_TERMS = 'Please agree to the Terms to create an account.';
const TOO_MANY = 'Too many attempts. Please wait 15 minutes and try again.';
const BAD_LOGIN = 'Incorrect username, email or password.';
const LOG_IN_AGAIN = 'Please log in again.';

// "clem@example.com" -> "c***@example.com": enough for someone to recognise
// their own address without showing the whole thing to whoever typed the
// username.
export function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

function requireSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');
  return secret;
}

// Whether `email` is free for `username` to use (unclaimed, or already theirs).
async function emailAvailable(redis, email, username) {
  const owner = await redis.get(emailKeyFor(email));
  return !owner || owner === normalizeUsername(username);
}

// How emails are sent: the test override, the real mailer, or none.
const mailerFor = mailOverride => mailOverride || (mailerConfigured() ? sendMail : null);

// Emails a fresh verification code to the account's address. Best-effort:
// false when email isn't set up or the send failed, and the person can ask
// for another.
async function sendVerifyCode(redis, secret, send, record) {
  if (!send || !record.email || record.emailVerified) return false;
  try {
    const code = await issueCode(redis, secret, 'verify', record.username, { email: record.email });
    await send({ to: record.email, ...codeEmail({ username: record.username, code, purpose: 'verify', appUrl: APP_URL, expiresMinutes: CODE_TTL_SECONDS / 60 }) });
    return true;
  } catch (e) {
    console.error('verify email failed:', e && e.message);
    return false;
  }
}

// The account a "forgot password" form names: by username or by email.
async function recordFor(redis, identifier) {
  if (identifier.includes('@')) {
    const email = normalizeEmail(identifier);
    const owner = email.ok && email.email ? await redis.get(emailKeyFor(email.email)) : null;
    const record = owner ? await getJSON(redis, userKeyFor(owner)) : null;
    return record && record.email === email.email ? record : null;
  }
  return validateUsername(identifier).ok ? getJSON(redis, userKeyFor(identifier)) : null;
}

// What every signed-in response carries: the account and its saved teams,
// so the app doesn't need a second request for the teams.
function account(record) {
  return {
    ok: true, username: record.username, email: record.email || '', teams: Array.isArray(record.teams) ? record.teams : [],
    emailVerified: !!(record.email && record.emailVerified),
    hasPassword: !!record.passwordHash, google: !!record.googleSub, createdAt: record.createdAt || null,
    digestTeamId: record.digest && record.digest.teamId ? record.digest.teamId : null,
    ...(isAdmin(record.username) ? { admin: true } : {}),
  };
}

// The admin page's requests (src/screens/AdminScreen.jsx): only for a
// signed-in admin whose session is still current. `admin` (tests only)
// replaces the network and Blob calls.
async function handleAdmin(req, res, redis, secret, body, admin = {}) {
  const session = getSessionFromRequest(req, secret);
  const record = session ? await getJSON(redis, userKeyFor(session.username)) : null;
  if (!sessionMatchesRecord(session, record)) { res.status(401).json({ error: 'not_logged_in' }); return; }
  if (!isAdmin(record.username)) { res.status(403).json({ error: 'forbidden' }); return; }
  const host = req.headers && req.headers.host;
  const target = typeof body.username === 'string' ? body.username.trim() : '';
  switch (body.op) {
    case 'health':
      res.status(200).json(await healthReport(redis, { host, ...admin }));
      return;
    case 'retrain':
      res.status(200).json(await triggerRetrain(admin));
      return;
    case 'refresh':
      res.status(200).json(await refreshBestSquad(host, admin));
      return;
    case 'social':
      res.status(200).json(await socialPosts(host, admin));
      return;
    case 'social_post': {
      // A one-off post (text) or one of this gameweek's (key).
      if (typeof body.text !== 'string' && typeof body.key !== 'string') break;
      const channels = Array.isArray(body.channels) ? body.channels.filter(c => typeof c === 'string') : undefined;
      res.status(200).json(await socialSend(host, { text: typeof body.key === 'string' ? undefined : body.text, key: typeof body.key === 'string' ? body.key : undefined, channels }, admin));
      return;
    }
    case 'social_x_done':
      // Ticks one of this gameweek's posts off (or back on) as posted on X.
      if (typeof body.key !== 'string') break;
      if (!(await markSent(redis, 'x', body.key, !!body.done))) break;
      res.status(200).json({ ok: true });
      return;
    case 'reports':
      res.status(200).json({ reports: await listReports(redis, admin) });
      return;
    case 'report_done':
      if (typeof body.id !== 'string') break;
      await setReportDone(redis, body.id, !!body.done);
      res.status(200).json({ ok: true });
      return;
    case 'report_delete':
      res.status(200).json({ ok: true, deleted: await deleteReport(redis, body.urls, admin) });
      return;
    case 'users':
      res.status(200).json(await userStats(redis));
      return;
    case 'export_users':
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(await usersCsv(redis));
      return;
    case 'clear_errors':
      await clearErrors(redis);
      res.status(200).json({ ok: true });
      return;
    case 'find_user':
      res.status(200).json({ user: await findUser(redis, body.query) });
      return;
    case 'sign_out_user':
      if (!target) break;
      res.status(200).json({ user: await signOutEverywhere(redis, target) });
      return;
    case 'delete_user':
      if (!target) break;
      // Not your own account from here: that's what logging out is for.
      if (normalizeUsername(target) === normalizeUsername(record.username)) {
        res.status(400).json({ error: "You can't delete your own account here." });
        return;
      }
      res.status(200).json({ ok: await deleteUser(redis, target) });
      return;
    default:
  }
  res.status(400).json({ error: 'unknown_admin_op' });
}

function signIn(res, record, secret, extra = {}) {
  res.setHeader('Set-Cookie', buildSessionCookie(signSessionToken(record.username, secret, record.sessionVersion || 0, record.authId)));
  res.status(200).json({ ...account(record), ...extra });
}

function storageFailed(res, e, redis) {
  // Log the real cause server-side, but don't return it: error messages can
  // carry internal hostnames, connection strings or other infrastructure
  // details that a client has no business seeing. Also record it to the
  // admin error log (best-effort) so it shows up on the admin page.
  console.error('storage_failed:', (e && e.stack) || e);
  recordError(redis, 'auth', e);
  res.status(502).json({ error: 'storage_failed' });
}

// Sends the browser somewhere else, setting any cookies first.
function redirect(res, location, cookies = []) {
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Location', location);
  res.status(302);
  res.end();
}

const sessionCookieFor = (record, secret) => buildSessionCookie(signSessionToken(record.username, secret, record.sessionVersion || 0, record.authId));

// "Continue with Google" (src/lib/googleAuth.js). Signs in the account
// that Google account is linked to; else links it to the account with the
// same, confirmed, email; else (if the Terms were agreed to) creates an
// account, and the app then offers a username and password as a backup.
// With ?link=1 it links Google to the signed-in account instead. Every
// outcome ends back on the site with ?google=<what happened>.
async function handleGoogle(req, res, redis, secret, google = {}) {
  const config = google.config !== undefined ? google.config : googleConfig();
  const step = req.query.google;
  if (step === 'config') { res.status(200).json({ enabled: !!config }); return; }
  if (!config) { redirect(res, '/?google=unavailable'); return; }
  const redirectUri = redirectUriFor(APP_URL);

  if (step === 'start') {
    const state = newState({ link: req.query.link === '1', terms: req.query.terms === '1' });
    redirect(res, authorizationUrl({ clientId: config.clientId, redirectUri, state }), [stateCookie(state)]);
    return;
  }
  if (step !== 'callback') { res.status(400).json({ error: 'unknown_action' }); return; }

  const cleared = clearedStateCookie();
  const done = (outcome, record) => redirect(res, `/?google=${outcome}`, record ? [cleared, sessionCookieFor(record, secret)] : [cleared]);
  if (req.query.error) { done('cancelled'); return; }
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  if (!stateMatches(state, readCookie(req, GOOGLE_STATE_COOKIE))) { done('error'); return; }
  const { link, terms } = parseState(state) || {};

  let claims;
  try {
    claims = await exchangeCode({ code: req.query.code, ...config, redirectUri, fetchImpl: google.fetchImpl || fetch });
  } catch (e) {
    console.error('google exchange failed:', e && e.message);
  }
  if (!claims) { done('error'); return; }

  try {
    const gKey = googleKeyFor(claims.sub);
    const linkedTo = await redis.get(gKey);
    let linked = linkedTo ? await getJSON(redis, userKeyFor(linkedTo)) : null;
    if (linked && linked.googleSub !== claims.sub) linked = null;

    if (link) {
      const session = getSessionFromRequest(req, secret);
      const record = session ? await getJSON(redis, userKeyFor(session.username)) : null;
      if (!sessionMatchesRecord(session, record)) { done('error'); return; }
      if (linked && normalizeUsername(linked.username) !== normalizeUsername(record.username)) { done('in_use'); return; }
      const updated = await updateJSON(redis, userKeyFor(record.username), r => ({
        ...r, googleSub: claims.sub, ...(claims.emailVerified && r.email === claims.email ? { emailVerified: true } : {}),
      }));
      if (updated === undefined) { done('error'); return; }
      await redis.set(gKey, normalizeUsername(record.username));
      done('linked', updated);
      return;
    }

    if (linked) { done('signed_in', linked); return; }

    // The account that already has this (confirmed) email gets Google
    // linked to it. Only a confirmed one: anyone can type an address in.
    let emailOwner = null;
    if (claims.emailVerified) {
      const owner = await redis.get(emailKeyFor(claims.email));
      emailOwner = owner ? await getJSON(redis, userKeyFor(owner)) : null;
      if (emailOwner && emailOwner.email === claims.email && emailOwner.emailVerified) {
        const updated = await updateJSON(redis, userKeyFor(emailOwner.username), r => ({ ...r, googleSub: claims.sub }));
        if (updated === undefined) { done('error'); return; }
        await redis.set(gKey, normalizeUsername(updated.username));
        done('signed_in', updated);
        return;
      }
    }

    // A new account: only after the Terms were agreed to on the site.
    if (!terms) { done('terms'); return; }
    if (await bump(redis, `ratelimit:register:ip:${clientIp(req)}`, REGISTER_WINDOW_SECONDS) > MAX_REGISTRATIONS_PER_IP) { done('limit'); return; }
    const now = new Date().toISOString();
    let record = null;
    for (let attempt = 0; attempt < 3 && !record; attempt++) {
      const username = await suggestUsername(claims, async name => !!(await redis.get(userKeyFor(name))));
      const candidate = {
        username, passwordHash: null, googleSub: claims.sub, teams: [], sessionVersion: 0, authId: generateAuthId(),
        createdAt: now, termsVersion: TERMS_VERSION, termsAcceptedAt: now,
        ...(claims.emailVerified ? { email: claims.email, emailVerified: true } : {}),
      };
      if (await createJSON(redis, userKeyFor(username), candidate)) record = candidate;
    }
    if (!record) { done('error'); return; }
    await redis.set(gKey, normalizeUsername(record.username));
    if (record.email) {
      // An account that typed this address in but never confirmed it loses
      // it: Google has just shown it's this person's.
      if (emailOwner && emailOwner.email === claims.email) {
        await updateJSON(redis, userKeyFor(emailOwner.username), r => {
          const next = { ...r };
          delete next.email; delete next.emailVerified; delete next.digest;
          return next;
        });
      }
      await redis.set(emailKeyFor(record.email), normalizeUsername(record.username));
    }
    done('new', record);
  } catch (e) {
    console.error('google sign-in failed:', (e && e.stack) || e);
    recordError(redis, 'auth', e);
    done('error');
  }
}

// `redisOverride` and `mailOverride` are never passed in production
// (Vercel always calls `handler(req, res)`) — they exist purely so tests
// can inject an in-memory Redis and capture emails instead of sending them.
export default async function handler(req, res, redisOverride, mailOverride, adminOverride, googleOverride) {
  // Push notifications live here too (src/lib/push.js), so they don't need
  // a serverless function of their own.
  if (req.query && req.query.push) return pushHandler(req, res, redisOverride ? { redis: redisOverride } : {});

  let secret;
  try {
    secret = requireSecret();
  } catch {
    res.status(500).json({ error: 'server_misconfigured', detail: 'JWT_SECRET is not set' });
    return;
  }

  // The deadline email (src/lib/digest.js): the scheduled send and the
  // unsubscribe link.
  if (req.query && req.query.digest) return digestHandler(req, res, { redis: redisOverride || getRedis(), secret, ...(mailOverride ? { send: mailOverride } : {}) });

  if (req.query && req.query.google) {
    let redis;
    try { redis = redisOverride || getRedis(); } catch { redirect(res, '/?google=unavailable'); return; }
    await handleGoogle(req, res, redis, secret, googleOverride);
    return;
  }

  if (req.method === 'GET') {
    const session = getSessionFromRequest(req, secret);
    if (!session) { res.status(401).json({ error: 'not_logged_in' }); return; }
    let record;
    try {
      record = await getJSON(redisOverride || getRedis(), userKeyFor(session.username));
    } catch {
      // Storage is down: still report the session (without the extras).
      res.status(200).json({ ok: true, username: session.username, email: '' });
      return;
    }
    if (!sessionMatchesRecord(session, record)) {
      // The account is gone, or its password was reset since this session
      // started.
      res.setHeader('Set-Cookie', buildClearedSessionCookie());
      res.status(401).json({ error: 'not_logged_in' });
      return;
    }
    res.status(200).json(account(record));
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  if (!isJsonRequest(req)) {
    res.status(415).json({ error: 'Send this request as JSON.' });
    return;
  }

  const body = req.body || {};
  const action = body.action;

  if (action === 'logout') {
    res.setHeader('Set-Cookie', buildClearedSessionCookie());
    res.status(200).json({ ok: true });
    return;
  }

  let redis;
  try {
    redis = redisOverride || getRedis();
  } catch {
    res.status(500).json({ error: 'server_misconfigured', detail: 'REDIS_URL is not set' });
    return;
  }

  if (action === 'admin') {
    try {
      await handleAdmin(req, res, redis, secret, body, adminOverride);
    } catch (e) {
      storageFailed(res, e, redis);
    }
    return;
  }

  if (action === 'register') {
    const { password } = body;
    // A stray space (a phone keyboard, a paste) isn't part of the name.
    const username = typeof body.username === 'string' ? body.username.trim() : body.username;
    const usernameCheck = validateNewUsername(username);
    if (!usernameCheck.ok) { res.status(400).json({ error: usernameCheck.error }); return; }
    const passwordCheck = validatePassword(password, username);
    if (!passwordCheck.ok) { res.status(400).json({ error: passwordCheck.error }); return; }
    const emailCheck = normalizeEmail(body.email);
    if (!emailCheck.ok) { res.status(400).json({ error: emailCheck.error }); return; }
    if (body.acceptTerms !== true) { res.status(400).json({ error: NEED_TERMS }); return; }

    // Only accounts actually created count towards the per-network limit:
    // an attempt that fails below hands its place back.
    const registerKey = `ratelimit:register:ip:${clientIp(req)}`;
    let counted = false;
    try {
      counted = true;
      if (await bump(redis, registerKey, REGISTER_WINDOW_SECONDS) > MAX_REGISTRATIONS_PER_IP) {
        res.status(429).json({ error: 'Too many new accounts from this network. Please try again later.' });
        return;
      }
    } catch { counted = false; /* limiter unavailable — don't block sign-ups */ }
    const giveBack = () => (counted ? release(redis, registerKey, REGISTER_WINDOW_SECONDS).catch(() => {}) : null);

    const key = userKeyFor(username);
    try {
      if (await redis.get(key)) {
        await giveBack();
        res.status(409).json({ error: 'That username is already taken.' });
        return;
      }
      if (emailCheck.email && !(await emailAvailable(redis, emailCheck.email, username))) {
        await giveBack();
        res.status(409).json({ error: EMAIL_TAKEN });
        return;
      }
      const now = new Date().toISOString();
      const record = { username, passwordHash: await hashPassword(password), teams: [], sessionVersion: 0, authId: generateAuthId(), createdAt: now, termsVersion: TERMS_VERSION, termsAcceptedAt: now };
      if (emailCheck.email) { record.email = emailCheck.email; record.emailVerified = false; }
      // Created only if the username is still free: two sign-ups racing
      // for the same name can't overwrite one another.
      if (!(await createJSON(redis, key, record))) {
        await giveBack();
        res.status(409).json({ error: 'That username is already taken.' });
        return;
      }
      if (emailCheck.email) await redis.set(emailKeyFor(emailCheck.email), normalizeUsername(username));
      const codeSent = await sendVerifyCode(redis, secret, mailerFor(mailOverride), record);
      signIn(res, record, secret, emailCheck.email ? { codeSent } : {});
    } catch (e) {
      await giveBack();
      storageFailed(res, e, redis);
    }
    return;
  }

  if (action === 'login') {
    const { password } = body;
    if (typeof body.username !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'Username or email and password are required.' });
      return;
    }
    const identifier = body.username.trim();
    const ipLimitKey = `ratelimit:login:ip:${clientIp(req)}`;
    try {
      // The network is checked first: once it's blocked, its guesses don't
      // count against (and so can't lock out) the accounts it targets.
      if (await bump(redis, ipLimitKey, LOGIN_WINDOW_SECONDS) > MAX_FAILED_LOGINS_PER_IP) {
        res.status(429).json({ error: TOO_MANY });
        return;
      }
      // Either a username or the account's email. An email is swapped for
      // the username that owns it. A name no account could have can't
      // match; it only counts against the network, which also stops huge
      // made-up "usernames" becoming Redis keys.
      let username = identifier;
      if (identifier.includes('@')) {
        const email = normalizeEmail(identifier);
        username = email.ok && email.email ? await redis.get(emailKeyFor(email.email)) : null;
      }
      if (!username || !validateUsername(username).ok) {
        res.status(401).json({ error: BAD_LOGIN });
        return;
      }
      const userLimitKey = `ratelimit:login:user:${normalizeUsername(username)}`;
      if (await bump(redis, userLimitKey, LOGIN_WINDOW_SECONDS) > MAX_FAILED_LOGINS_PER_USER) {
        res.status(429).json({ error: TOO_MANY });
        return;
      }

      const record = await getJSON(redis, userKeyFor(username));
      const match = record ? await verifyPassword(password, record.passwordHash) : false;
      if (!match) {
        res.status(401).json({ error: BAD_LOGIN });
        return;
      }
      // A successful login wipes the account's failures and doesn't count
      // against the network.
      await Promise.all([reset(redis, userLimitKey), release(redis, ipLimitKey, LOGIN_WINDOW_SECONDS)]);
      // Accounts that added an email before resets existed have no lookup
      // entry yet; add it so "forgot password" works by email too.
      if (record.email) {
        try { await redis.set(emailKeyFor(record.email), normalizeUsername(record.username), 'NX'); } catch { /* best-effort */ }
      }
      signIn(res, record, secret);
    } catch (e) {
      storageFailed(res, e, redis);
    }
    return;
  }

  // Add, change or (with an empty email) remove the logged-in user's email.
  // Deadline emails on (for this FPL team) or off: { teamId } or { teamId: null }.
  if (action === 'set_digest') {
    const session = getSessionFromRequest(req, secret);
    if (!session) { res.status(401).json({ error: LOG_IN_AGAIN }); return; }
    const teamId = body.teamId === null ? null : cleanTeamId(body.teamId);
    if (body.teamId !== null && !teamId) { res.status(400).json({ error: 'That isn’t an FPL team ID.' }); return; }
    try {
      let problem = null;
      const updated = await updateJSON(redis, userKeyFor(session.username), record => {
        if (!sessionMatchesRecord(session, record)) { problem = 'signed_out'; return null; }
        if (teamId && !record.email) { problem = 'no_email'; return null; }
        if (teamId && !record.emailVerified) { problem = 'unverified'; return null; }
        const next = { ...record };
        if (teamId) next.digest = { teamId };
        else delete next.digest;
        return next;
      });
      if (problem === 'no_email') { res.status(400).json({ error: 'Add an email address to your account first.' }); return; }
      if (problem === 'unverified') { res.status(400).json({ error: 'Confirm your email address first: enter the code we emailed you.' }); return; }
      if (updated === undefined || problem) { res.status(401).json({ error: LOG_IN_AGAIN }); return; }
      res.status(200).json(account(updated));
    } catch (e) {
      storageFailed(res, e, redis);
    }
    return;
  }

  if (action === 'set_email') {
    const session = getSessionFromRequest(req, secret);
    if (!session) { res.status(401).json({ error: LOG_IN_AGAIN }); return; }
    const emailCheck = normalizeEmail(body.email);
    if (!emailCheck.ok) { res.status(400).json({ error: emailCheck.error }); return; }
    const key = userKeyFor(session.username);
    try {
      if (emailCheck.email && !(await emailAvailable(redis, emailCheck.email, session.username))) {
        res.status(409).json({ error: EMAIL_TAKEN });
        return;
      }
      let signedOut = false;
      let oldEmail;
      const updated = await updateJSON(redis, key, record => {
        if (!sessionMatchesRecord(session, record)) { signedOut = true; return null; }
        oldEmail = record.email;
        const next = { ...record };
        if (emailCheck.email && emailCheck.email !== record.email) { next.email = emailCheck.email; next.emailVerified = false; }
        else if (!emailCheck.email) { delete next.email; delete next.emailVerified; delete next.digest; }
        return next;
      });
      if (updated === undefined || signedOut) { res.status(401).json({ error: LOG_IN_AGAIN }); return; }
      if (oldEmail && oldEmail !== emailCheck.email && (await emailAvailable(redis, oldEmail, updated.username))) {
        await redis.del(emailKeyFor(oldEmail));
      }
      if (emailCheck.email) await redis.set(emailKeyFor(emailCheck.email), normalizeUsername(updated.username));
      const changed = emailCheck.email && emailCheck.email !== oldEmail;
      const codeSent = changed ? await sendVerifyCode(redis, secret, mailerFor(mailOverride), updated) : false;
      res.status(200).json({ ...account(updated), ...(changed ? { codeSent } : {}) });
    } catch (e) {
      storageFailed(res, e, redis);
    }
    return;
  }

  // Deletes the logged-in user's account for good: the record, its saved
  // teams and settings, its email and Google lookups and any pending codes.
  // Needs the word "delete" typed out, and the password again (counted like
  // a login so it can't be used to guess it). An account made with Google
  // that never set a password has none to give.
  if (action === 'delete_account') {
    const session = getSessionFromRequest(req, secret);
    if (!session) { res.status(401).json({ error: LOG_IN_AGAIN }); return; }
    if (typeof body.confirm !== 'string' || body.confirm.trim().toLowerCase() !== 'delete') { res.status(400).json({ error: 'Type DELETE to confirm.' }); return; }
    try {
      const record = await getJSON(redis, userKeyFor(session.username));
      if (!sessionMatchesRecord(session, record)) { res.status(401).json({ error: LOG_IN_AGAIN }); return; }
      const userLimitKey = `ratelimit:login:user:${normalizeUsername(record.username)}`;
      if (record.passwordHash) {
        if (typeof body.password !== 'string' || !body.password) { res.status(400).json({ error: 'Enter your password to delete your account.' }); return; }
        if (await bump(redis, userLimitKey, LOGIN_WINDOW_SECONDS) > MAX_FAILED_LOGINS_PER_USER) { res.status(429).json({ error: TOO_MANY }); return; }
        if (!(await verifyPassword(body.password, record.passwordHash))) { res.status(401).json({ error: 'That password isn’t right.' }); return; }
      }
      await deleteAccount(redis, record.username);
      const name = normalizeUsername(record.username);
      await Promise.all(['verify', 'reset'].flatMap(p => [redis.del(`code:${p}:${name}`), redis.del(`code:${p}:${name}:tries`)]).concat(reset(redis, userLimitKey)));
      res.setHeader('Set-Cookie', buildClearedSessionCookie());
      res.status(200).json({ ok: true, deleted: true });
    } catch (e) {
      storageFailed(res, e, redis);
    }
    return;
  }

  // A username and password for an account made with Google, so it can
  // also log in without it. The username may stay as it is or change to a
  // free one; changing it moves the account (and its lookups) to the new
  // name and signs this session in under it.
  if (action === 'set_credentials') {
    const session = getSessionFromRequest(req, secret);
    if (!session) { res.status(401).json({ error: LOG_IN_AGAIN }); return; }
    const wanted = typeof body.username === 'string' ? body.username.trim() : '';
    try {
      const record = await getJSON(redis, userKeyFor(session.username));
      if (!sessionMatchesRecord(session, record)) { res.status(401).json({ error: LOG_IN_AGAIN }); return; }
      if (record.passwordHash) { res.status(400).json({ error: 'This account already has a password. Change it from your profile.' }); return; }
      const username = wanted || record.username;
      const renaming = normalizeUsername(username) !== normalizeUsername(record.username);
      if (renaming || username !== record.username) {
        const check = validateNewUsername(username);
        if (!check.ok) { res.status(400).json({ error: check.error }); return; }
      }
      const passwordCheck = validatePassword(body.password, username);
      if (!passwordCheck.ok) { res.status(400).json({ error: passwordCheck.error }); return; }
      const passwordHash = await hashPassword(body.password);
      if (!renaming) {
        const updated = await updateJSON(redis, userKeyFor(record.username), r => (r.passwordHash ? null : { ...r, username, passwordHash }));
        if (!updated || updated.passwordHash !== passwordHash) { res.status(409).json({ error: 'This account already has a password. Change it from your profile.' }); return; }
        signIn(res, updated, secret);
        return;
      }
      const moved = { ...record, username, passwordHash };
      if (!(await createJSON(redis, userKeyFor(username), moved))) { res.status(409).json({ error: 'That username is already taken.' }); return; }
      await redis.del(userKeyFor(record.username));
      const name = normalizeUsername(username);
      if (record.email && (await redis.get(emailKeyFor(record.email))) === normalizeUsername(record.username)) await redis.set(emailKeyFor(record.email), name);
      if (record.googleSub) await redis.set(googleKeyFor(record.googleSub), name);
      signIn(res, moved, secret);
    } catch (e) {
      storageFailed(res, e, redis);
    }
    return;
  }

  // A new password, given the current one. Signs out every other session.
  if (action === 'change_password') {
    const session = getSessionFromRequest(req, secret);
    if (!session) { res.status(401).json({ error: LOG_IN_AGAIN }); return; }
    try {
      const record = await getJSON(redis, userKeyFor(session.username));
      if (!sessionMatchesRecord(session, record)) { res.status(401).json({ error: LOG_IN_AGAIN }); return; }
      if (!record.passwordHash) { res.status(400).json({ error: 'Set a username and password first.' }); return; }
      const userLimitKey = `ratelimit:login:user:${normalizeUsername(record.username)}`;
      if (await bump(redis, userLimitKey, LOGIN_WINDOW_SECONDS) > MAX_FAILED_LOGINS_PER_USER) { res.status(429).json({ error: TOO_MANY }); return; }
      if (typeof body.currentPassword !== 'string' || !(await verifyPassword(body.currentPassword, record.passwordHash))) { res.status(401).json({ error: 'Your current password isn’t right.' }); return; }
      const passwordCheck = validatePassword(body.password, record.username);
      if (!passwordCheck.ok) { res.status(400).json({ error: passwordCheck.error }); return; }
      const passwordHash = await hashPassword(body.password);
      const updated = await updateJSON(redis, userKeyFor(record.username), r => ({ ...r, passwordHash, sessionVersion: (r.sessionVersion || 0) + 1 }));
      if (updated === undefined) { res.status(401).json({ error: LOG_IN_AGAIN }); return; }
      await reset(redis, userLimitKey);
      signIn(res, updated, secret);
    } catch (e) {
      storageFailed(res, e, redis);
    }
    return;
  }

  // Email a new code to confirm the logged-in user's address.
  if (action === 'send_verify') {
    const session = getSessionFromRequest(req, secret);
    if (!session) { res.status(401).json({ error: LOG_IN_AGAIN }); return; }
    const send = mailerFor(mailOverride);
    if (!send) { res.status(503).json({ error: "Emails aren't set up on this site yet." }); return; }
    try {
      const record = await getJSON(redis, userKeyFor(session.username));
      if (!sessionMatchesRecord(session, record)) { res.status(401).json({ error: LOG_IN_AGAIN }); return; }
      if (!record.email) { res.status(400).json({ error: 'Add an email address to your account first.' }); return; }
      if (record.emailVerified) { res.status(200).json(account(record)); return; }
      if (await bump(redis, `ratelimit:verify:user:${normalizeUsername(record.username)}`, VERIFY_WINDOW_SECONDS) > MAX_VERIFY_EMAILS_PER_USER) {
        res.status(429).json({ error: "We've sent several codes already. Check your inbox and spam folder, or try again in an hour." });
        return;
      }
      if (!(await sendVerifyCode(redis, secret, send, record))) { res.status(502).json({ error: "Couldn't send the email right now. Please try again later." }); return; }
      res.status(200).json({ ...account(record), codeSent: true, message: `We've sent a 6-digit code to ${maskEmail(record.email)}.` });
    } catch (e) {
      storageFailed(res, e, redis);
    }
    return;
  }

  // The code from that email: marks the address confirmed. It must be the
  // address the code went to, not one changed to since.
  if (action === 'verify_email') {
    const session = getSessionFromRequest(req, secret);
    if (!session) { res.status(401).json({ error: LOG_IN_AGAIN }); return; }
    try {
      const record = await getJSON(redis, userKeyFor(session.username));
      if (!sessionMatchesRecord(session, record)) { res.status(401).json({ error: LOG_IN_AGAIN }); return; }
      if (!record.email) { res.status(400).json({ error: 'Add an email address to your account first.' }); return; }
      if (record.emailVerified) { res.status(200).json(account(record)); return; }
      const entry = await redeemCode(redis, secret, 'verify', record.username, body.code);
      if (!entry || entry.email !== record.email) { res.status(400).json({ error: CODE_INVALID }); return; }
      let signedOut = false;
      const updated = await updateJSON(redis, userKeyFor(session.username), r => {
        if (!sessionMatchesRecord(session, r) || r.email !== entry.email) { signedOut = true; return null; }
        return { ...r, emailVerified: true };
      });
      if (updated === undefined || signedOut) { res.status(400).json({ error: CODE_INVALID }); return; }
      res.status(200).json(account(updated));
    } catch (e) {
      storageFailed(res, e, redis);
    }
    return;
  }

  // Step 1 of a reset: email a one-time code to the account's address.
  // Says plainly when no account matches or it has no email, so people
  // aren't left waiting for an email that will never come. (That does let
  // someone check whether a username or email has an account; the per-IP
  // limit keeps that slow.)
  if (action === 'forgot_password') {
    const identifier = typeof body.identifier === 'string' ? body.identifier.trim() : '';
    if (!identifier) { res.status(400).json({ error: 'Enter your username or email.' }); return; }
    const send = mailerFor(mailOverride);
    if (!send) {
      res.status(503).json({ error: "Password reset by email isn't set up on this site yet." });
      return;
    }
    try {
      if (await bump(redis, `ratelimit:reset:ip:${clientIp(req)}`, RESET_WINDOW_SECONDS) > MAX_RESET_REQUESTS_PER_IP) {
        res.status(429).json({ error: 'Too many reset requests. Please try again in an hour.' });
        return;
      }
      const record = await recordFor(redis, identifier);
      if (!record) { res.status(404).json({ error: NO_ACCOUNT }); return; }
      if (!record.email) { res.status(400).json({ error: NO_EMAIL }); return; }

      if (await bump(redis, `ratelimit:reset:user:${normalizeUsername(record.username)}`, RESET_WINDOW_SECONDS) > MAX_RESET_EMAILS_PER_USER) {
        res.status(429).json({ error: "We've already sent several reset emails to this account. Check your inbox and spam folder, or try again in an hour." });
        return;
      }
      const code = await issueCode(redis, secret, 'reset', record.username, { email: record.email });
      await send({ to: record.email, ...codeEmail({ username: record.username, code, purpose: 'reset', appUrl: APP_URL, expiresMinutes: CODE_TTL_SECONDS / 60 }) });
      res.status(200).json({ ok: true, message: `We've sent a 6-digit code to ${maskEmail(record.email)}. It expires in ${CODE_TTL_SECONDS / 60} minutes; check your spam folder if it doesn't arrive.` });
    } catch (e) {
      console.error('forgot_password failed:', e && e.message);
      res.status(502).json({ error: "Couldn't send the reset email right now. Please try again later." });
    }
    return;
  }

  // Step 2: the same username or email, the emailed code and a new
  // password. The code works once, and every session from before the reset
  // is signed out. Getting the code also proves the email is theirs.
  if (action === 'reset_password') {
    const identifier = typeof body.identifier === 'string' ? body.identifier.trim() : '';
    const { password } = body;
    if (!identifier || identifier.length > 254) { res.status(400).json({ error: CODE_INVALID }); return; }
    try {
      const record = await recordFor(redis, identifier);
      if (!record || !record.email) { res.status(400).json({ error: CODE_INVALID }); return; }
      // Checked before the code, so a password that fails the rules can be
      // fixed and sent again with the same code.
      const passwordCheck = validatePassword(password, record.username);
      if (!passwordCheck.ok) { res.status(400).json({ error: passwordCheck.error }); return; }
      const entry = await redeemCode(redis, secret, 'reset', record.username, body.code);
      if (!entry || entry.email !== record.email) { res.status(400).json({ error: CODE_INVALID }); return; }

      // Hash before touching the record, so the read-modify-write below is
      // quick.
      const passwordHash = await hashPassword(password);
      const updated = await updateJSON(redis, userKeyFor(record.username), r => ({
        ...r, passwordHash, sessionVersion: (r.sessionVersion || 0) + 1, ...(r.email === entry.email ? { emailVerified: true } : {}),
      }));
      if (updated === undefined) { res.status(400).json({ error: CODE_INVALID }); return; }
      // A forgotten password often comes after failed guesses; don't leave
      // the account locked now that it has a new one.
      await reset(redis, `ratelimit:login:user:${normalizeUsername(record.username)}`);
      signIn(res, updated, secret);
    } catch (e) {
      storageFailed(res, e, redis);
    }
    return;
  }

  res.status(400).json({ error: 'unknown_action' });
}
