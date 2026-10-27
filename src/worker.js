/*
 * 423.rent backend — Cloudflare Worker (no dependencies, no Node APIs)
 *
 * Serves /api/* (auth, users, listings, scores, messages, agreements, reviews,
 * admin login, config, Stripe Checkout + webhook, LiveKit call tokens).
 * Everything else (index.html) is served by the Workers static-assets binding.
 *
 * Storage: Supabase PostgREST with the service-role key (kept as a Worker secret).
 * Tables are prefixed r423_ (the Supabase project is shared with other sites).
 */

const enc = new TextEncoder();
const BODY_LIMIT = 15 * 1024 * 1024;
const ROLES = ['rentee', 'renters', 'rentplus'];

// ---------------- config (from Worker vars/secrets) ----------------
let C = null;
function cfg(env) {
  if (C) return C;
  const g = k => (env[k] === undefined ? '' : String(env[k]));
  C = {
    PUBLIC_URL: (g('PUBLIC_URL') || 'https://423.rent').replace(/\/$/, ''),
    ADMIN_USER: g('ADMIN_USER') || 'admin',
    ADMIN_PASS: g('ADMIN_PASS'),
    SB_URL: g('SUPABASE_URL').replace(/\/$/, ''),
    SB_KEY: g('SUPABASE_SERVICE_KEY') || g('SUPABASE_SERVICE_ROLE_KEY'),
    PREFIX: env.SUPABASE_TABLE_PREFIX === undefined ? 'r423_' : g('SUPABASE_TABLE_PREFIX'),
    STRIPE_KEY: g('STRIPE_SECRET_KEY'),
    STRIPE_WH: g('STRIPE_WEBHOOK_SECRET'),
    LK_URL: g('LIVEKIT_URL'),
    LK_KEY: g('LIVEKIT_API_KEY'),
    LK_SECRET: g('LIVEKIT_API_SECRET'),
  };
  C.LK_READY = !!(C.LK_URL && C.LK_KEY && C.LK_SECRET);
  return C;
}

// ---------------- crypto helpers (Web Crypto) ----------------
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const rand = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha = async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(String(s))));
function ctEq(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const safeEq = async (a, b) => ctEq(await sha(a), await sha(b));
async function hashPass(pw, salt) {
  const k = await crypto.subtle.importKey('raw', enc.encode(String(pw)), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(String(salt)), iterations: 100000 }, k, 256));
}
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(msg));
}
function b64u(input) {
  const bytes = typeof input === 'string' ? enc.encode(input) : new Uint8Array(input);
  let s = ''; bytes.forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// ---------------- Supabase (PostgREST over fetch) ----------------
const eq = v => 'eq.' + v;
const inn = arr => 'in.(' + arr.join(',') + ')';
const PKS = { users: 'id', sessions: 'token_hash', listings: 'id', scores: 'user_id,game', agreements: 'agr_id', reviews: 'agr_id', payments: 'agr_id' };

async function sb(method, table, opts) {
  opts = opts || {};
  const params = new URLSearchParams();
  Object.keys(opts.filters || {}).forEach(k => params.append(k, opts.filters[k]));
  if (opts.order) params.set('order', opts.order);
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.onConflict) params.set('on_conflict', opts.onConflict);
  const headers = { apikey: C.SB_KEY, Authorization: 'Bearer ' + C.SB_KEY, 'Content-Type': 'application/json' };
  if (opts.prefer) headers.Prefer = opts.prefer;
  const qs = params.toString();
  const r = await fetch(C.SB_URL + '/rest/v1/' + C.PREFIX + table + (qs ? '?' + qs : ''), {
    method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await r.text();
  let out = null; try { out = text ? JSON.parse(text) : null; } catch (e) { out = text; }
  if (!r.ok) throw new Error('supabase ' + method + ' ' + table + ' ' + r.status + ': ' + (out && out.message ? out.message : text));
  return out;
}
const db = {
  select: (t, f, o) => sb('GET', t, Object.assign({ filters: f }, o || {})),
  insert: async (t, row) => (await sb('POST', t, { body: row, prefer: 'return=representation' }))[0],
  upsert: async (t, row) => (await sb('POST', t, { body: row, onConflict: PKS[t], prefer: 'resolution=merge-duplicates,return=representation' }))[0],
  update: (t, f, patch) => sb('PATCH', t, { filters: f, body: patch, prefer: 'return=representation' }),
  remove: (t, f) => sb('DELETE', t, { filters: f }),
};

// ---------------- helpers ----------------
function json(code, obj) {
  return new Response(JSON.stringify(obj), { status: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
async function readRaw(req) {
  const buf = await req.arrayBuffer();
  if (buf.byteLength > BODY_LIMIT) throw new Error('too large');
  return buf;
}
async function readBody(req) {
  try { const t = new TextDecoder().decode(await readRaw(req)); return t ? JSON.parse(t) : {}; } catch (e) { return {}; }
}
function publicUser(u) {
  if (!u) return null;
  const x = u.extra || {};
  return {
    id: u.id, email: u.email, name: u.name, role: u.role, bio: u.bio || '', tagline: u.tagline || '',
    avatar: u.avatar || '', location: u.location || x.location || '', phone: x.phone || '',
    cover: x.cover || '', interests: x.interests || [], ratings: u.ratings,
  };
}
async function getUser(id) { const r = await db.select('users', { id: eq(id) }, { limit: 1 }); return r[0] || null; }

async function newSession(userId, admin, ttlMs) {
  const token = rand(24);
  await db.insert('sessions', { token_hash: await sha(token), user_id: userId, admin: !!admin, exp: Date.now() + ttlMs });
  return token;
}
async function getAuth(req) {
  const m = (req.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/);
  if (!m) return null;
  const rows = await db.select('sessions', { token_hash: eq(await sha(m[1])) }, { limit: 1 });
  const s = rows[0];
  if (!s || Number(s.exp) < Date.now()) return null;
  return { userId: s.user_id, admin: !!s.admin, token: m[1] };
}

// brute-force limiter (per isolate, best effort — add a Cloudflare rate-limiting rule for /api/auth too)
const fails = new Map();
function limited(key) { const f = fails.get(key); return !!(f && f.until > Date.now()); }
function failed(key, max) {
  const f = fails.get(key) || { n: 0, until: 0 };
  f.n++; if (f.n >= max) { f.until = Date.now() + 60000; f.n = 0; }
  fails.set(key, f); return f;
}

// ---------------- Stripe (REST) ----------------
async function stripeCheckout(s) {
  if (!C.STRIPE_KEY) return { error: 'stripe_not_configured' };
  const p = new URLSearchParams();
  p.set('mode', 'payment');
  p.set('success_url', s.success_url);
  p.set('cancel_url', s.cancel_url);
  p.set('client_reference_id', s.agrId);
  p.set('metadata[agr_id]', s.agrId);
  p.set('payment_intent_data[metadata][agr_id]', s.agrId);
  p.set('line_items[0][quantity]', '1');
  p.set('line_items[0][price_data][currency]', 'usd');
  p.set('line_items[0][price_data][unit_amount]', String(Math.round(s.total * 100)));
  p.set('line_items[0][price_data][product_data][name]', '423.rent rental — ' + s.title);
  try {
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + C.STRIPE_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: p.toString(),
    });
    const j = await r.json();
    if (r.ok && j.url) return { url: j.url, id: j.id };
    return { error: j.error ? j.error.message : 'stripe_error' };
  } catch (e) { return { error: 'stripe_unreachable' }; }
}
async function stripeVerify(sessionId) {
  if (!C.STRIPE_KEY) return { error: 'stripe_not_configured' };
  try {
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(sessionId), { headers: { Authorization: 'Bearer ' + C.STRIPE_KEY } });
    const j = await r.json();
    if (!r.ok) return { paid: false, error: 'session_not_found' };
    return {
      paid: j.payment_status === 'paid',
      amount: j.amount_total ? j.amount_total / 100 : null,
      agrId: (j.metadata && j.metadata.agr_id) || j.client_reference_id || null,
      sessionId: j.id,
      receiptId: 'TXN-' + String(j.id || '').replace(/[^A-Z0-9]/gi, '').slice(-6).toUpperCase(),
    };
  } catch (e) { return { paid: false, error: 'stripe_unreachable' }; }
}
async function verifyStripeSignature(rawText, header) {
  if (!C.STRIPE_WH || !header) return false;
  const parts = {};
  String(header).split(',').forEach(kv => { const i = kv.indexOf('='); const k = kv.slice(0, i); (parts[k] = parts[k] || []).push(kv.slice(i + 1)); });
  const t = parts.t && parts.t[0]; if (!t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = hex(await hmac(C.STRIPE_WH, t + '.' + rawText));
  return parts.v1.some(sig => ctEq(sig, expected));
}
// idempotent: Stripe return page and webhook can both call this
async function markPaid(agrId, amount, receiptId, sessionId) {
  const a = (await db.select('agreements', { agr_id: eq(agrId) }, { limit: 1 }))[0];
  if (!a) return null;
  if (a.status !== 'Paid') await db.update('agreements', { agr_id: eq(agrId) }, { status: 'Paid', paid_at: Date.now() });
  await db.upsert('payments', { agr_id: agrId, amount, receipt_id: receiptId, session_id: sessionId, paid_at: Date.now() });
  return a;
}

// ---------------- LiveKit (HS256 JWT) ----------------
async function livekitToken(identity, name, room) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({
    iss: C.LK_KEY, sub: identity, name, jti: identity + '-' + rand(4),
    nbf: now - 10, iat: now, exp: now + 3600,
    video: { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
  }));
  return head + '.' + body + '.' + b64u(await hmac(C.LK_SECRET, head + '.' + body));
}
const callRoom = async (a, b) => 'call-' + (await sha([a, b].sort().join('|'))).slice(0, 20);

// ---------------- row <-> API mappers ----------------
const toListing = r => Object.assign({}, r.data || {}, { id: r.id, ownerId: r.owner_id });
const toAgreement = r => ({
  agrId: r.agr_id, listingId: r.listing_id, title: r.title, ownerId: r.owner_id, renterId: r.renter_id,
  renterName: r.renter_name, signedAt: Number(r.signed_at), start: r.start_date, end: r.end_date, qty: r.qty,
  rent: Number(r.rent), fee: Number(r.fee), deposit: Number(r.deposit), total: Number(r.total),
  status: r.status, paidAt: r.paid_at ? Number(r.paid_at) : null,
});
const toReview = r => ({ listingId: r.listing_id, agrId: r.agr_id, rating: r.rating, text: r.text, byName: r.by_name, date: Number(r.date) });
const toMessage = r => ({ from: r.from_id, to: r.to_id, text: r.text, ts: Number(r.ts) });
const num = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };

// ---- community posts ----
const POST_TOPICS = ['tip', 'inspire', 'story', 'question'];
function promoReason(text) {
  const t = String(text || '');
  const stripped = t.replace(/https?:\/\/(www\.)?423\.rent\S*/gi, '').replace(/\b423\.rent\b/gi, '');
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|biz|io|co|us|shop|store|app|me|ly)\b/i.test(stripped)) return 'Links to other sites aren\'t allowed here. You can say "check out my page" instead.';
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(stripped)) return 'Please keep email addresses out of posts.';
  if (/(\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/.test(stripped)) return 'Please keep phone numbers out of posts.';
  if (/\bfor (rent|sale|lease)\b|\bavailable (to rent|for rent|now)\b|\bnow renting\b|\bbook (now|today)\b|\bcall (me|us) (to|for)\b|\b(dm|text|message) me (to|for|about) (rent|book|buy|price|pricing)|\b(venmo|cash ?app|zelle|paypal)\b|\bdiscount\b|\bspecial offer\b|\bper (day|week|month|hour)\b|\$\s?\d/i.test(stripped)) return 'Posts here are for tips and inspiration, not listings or sales. Put rentals in a listing, and say "check out my page" to point people to it.';
  return '';
}
const toPost = (r, authors, me) => {
  const a = authors[r.user_id] || {};
  const likes = Array.isArray(r.likes) ? r.likes : [];
  return {
    id: r.id, userId: r.user_id, topic: r.topic, text: r.text, ts: Number(r.created_at),
    likes: likes.length, liked: !!(me && likes.includes(me)),
    author: { id: r.user_id, name: a.name || (r.user_id === '__admin__' ? '423.rent' : 'Neighbor'), avatar: a.avatar || '', role: a.role || (r.user_id === '__admin__' ? 'rentplus' : 'rentee'), admin: r.user_id === '__admin__' }
  };
};
async function postAuthors(rows) {
  const ids = [...new Set(rows.map(r => r.user_id))].filter(id => id !== '__admin__');
  const out = {};
  if (ids.length) (await db.select('users', { id: inn(ids) })).forEach(u => { out[u.id] = { name: u.name, avatar: u.avatar || '', role: u.role }; });
  return out;
}

// =====================================================================
// router
// =====================================================================
async function route(req, env) {
  const c = cfg(env);
  const u = new URL(req.url);
  const p = u.pathname;
  const M = req.method;
  const ip = req.headers.get('cf-connecting-ip') || 'unknown';

  if (!p.startsWith('/api/')) return env.ASSETS.fetch(req);

  if (!c.SB_URL || !c.SB_KEY) return json(503, { error: 'Server is missing SUPABASE_URL / SUPABASE_SERVICE_KEY.' });
  if (!c.ADMIN_PASS && p === '/api/admin-login') return json(503, { error: 'ADMIN_PASS is not set on the server.' });

  // ---- config ----
  if (p === '/api/config' && M === 'GET') {
    return json(200, { prod: true, stripe: !!c.STRIPE_KEY, supabase: true, livekit: c.LK_READY, livekitUrl: c.LK_READY ? c.LK_URL : '' });
  }

  // ---- Stripe webhook (raw body, signature checked) ----
  if (p === '/api/stripe-webhook' && M === 'POST') {
    const raw = new TextDecoder().decode(await readRaw(req));
    if (!(await verifyStripeSignature(raw, req.headers.get('stripe-signature')))) return json(400, { error: 'bad signature' });
    let ev; try { ev = JSON.parse(raw); } catch (e) { return json(400, { error: 'bad json' }); }
    const obj = ev.data && ev.data.object;
    if (ev.type === 'checkout.session.completed' && obj && obj.payment_status === 'paid') {
      const agrId = (obj.metadata && obj.metadata.agr_id) || obj.client_reference_id;
      if (agrId) await markPaid(agrId, obj.amount_total ? obj.amount_total / 100 : null,
        'TXN-' + String(obj.id).replace(/[^A-Z0-9]/gi, '').slice(-6).toUpperCase(), obj.id);
    }
    return json(200, { received: true });
  }

  // ---- listings ----
  if (p === '/api/listings' && M === 'GET') {
    const limit = Math.max(1, Math.min(500, parseInt(u.searchParams.get('limit') || '200', 10)));
    const rows = await db.select('listings', {}, { order: 'created_at.desc', limit });
    return json(200, { listings: rows.map(toListing) });
  }
  if (p === '/api/listings' && M === 'POST') {
    const auth = await getAuth(req); if (!auth) return json(401, { error: 'Login required.' });
    const body = await readBody(req);
    const l = body.listing || body;
    if (!l || !l.id) return json(400, { error: 'Invalid listing.' });
    const id = String(l.id);
    const existing = (await db.select('listings', { id: eq(id) }, { limit: 1 }))[0];
    if (existing && existing.owner_id !== auth.userId) return json(403, { error: 'Not your listing.' });
    const data = Object.assign({}, l); delete data.id; delete data.ownerId;
    await db.upsert('listings', { id, owner_id: auth.userId, data, created_at: existing ? existing.created_at : Date.now() });
    return json(200, { listing: Object.assign({}, data, { id, ownerId: auth.userId }) });
  }
  if (p === '/api/listings' && M === 'DELETE') {
    const auth = await getAuth(req); if (!auth) return json(401, { error: 'Login required.' });
    const id = u.searchParams.get('id');
    const l = (await db.select('listings', { id: eq(id) }, { limit: 1 }))[0];
    if (!l) return json(200, { ok: true });
    if (l.owner_id !== auth.userId && !auth.admin) return json(403, { error: 'Not your listing.' });
    await db.remove('listings', { id: eq(id) });
    return json(200, { ok: true });
  }

  // ---- auth ----
  if (p === '/api/auth' && M === 'POST') {
    if (limited('auth:' + ip)) return json(429, { error: 'Too many attempts. Try again in a minute.' });
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    if (!email || !body.password) return json(400, { error: 'Email and password required.' });
    let user = (await db.select('users', { email: eq(email) }, { limit: 1 }))[0];
    if (user) {
      if (!ctEq(await hashPass(body.password, user.salt), user.pass_hash)) { failed('auth:' + ip, 10); return json(401, { error: 'Incorrect email or password.' }); }
    } else {
      const salt = rand(8);
      user = await db.insert('users', {
        id: 'u' + rand(6), email, salt, pass_hash: await hashPass(body.password, salt),
        name: String(body.name || email.split('@')[0]).slice(0, 80), role: ROLES.includes(body.role) ? body.role : 'rentee',
        bio: '', tagline: '', avatar: '', extra: {}, created_at: Date.now(),
      });
    }
    const token = await newSession(user.id, false, 30 * 24 * 3600 * 1000);
    return json(200, { token, user: publicUser(user) });
  }
  if (p === '/api/auth' && M === 'GET') {
    const auth = await getAuth(req); if (!auth) return json(401, { error: 'Not logged in.' });
    const user = await getUser(auth.userId); if (!user) return json(401, { error: 'Not logged in.' });
    return json(200, { user: publicUser(user) });
  }
  if (p === '/api/logout' && M === 'POST') {
    const auth = await getAuth(req);
    if (auth) await db.remove('sessions', { token_hash: eq(await sha(auth.token)) });
    return json(200, { ok: true });
  }

  // ---- users ----
  if (p === '/api/users' && M === 'GET') {
    const id = u.searchParams.get('id');
    if (id) { const user = await getUser(id); return user ? json(200, { user: publicUser(user) }) : json(404, { error: 'No such user.' }); }
    const rows = await db.select('users', {}, { limit: 500 });
    return json(200, { users: rows.map(publicUser).map(x => { delete x.email; return x; }) });
  }
  if (p === '/api/users' && M === 'PATCH') {
    const auth = await getAuth(req); if (!auth) return json(401, { error: 'Login required.' });
    const user = await getUser(auth.userId); if (!user) return json(401, { error: 'Not logged in.' });
    const body = await readBody(req);
    const patch = {}, extra = Object.assign({}, user.extra || {});
    ['name', 'bio', 'tagline', 'avatar', 'location'].forEach(k => { if (typeof body[k] === 'string') patch[k] = body[k]; });
    if (ROLES.includes(body.role)) patch.role = body.role;
    ['phone', 'cover'].forEach(k => { if (typeof body[k] === 'string') extra[k] = body[k]; });
    if (Array.isArray(body.interests)) extra.interests = body.interests.map(String).slice(0, 12);
    patch.extra = extra;
    const rows = await db.update('users', { id: eq(user.id) }, patch);
    return json(200, { user: publicUser(rows[0] || Object.assign(user, patch)) });
  }

  // ---- scores ----
  if (p === '/api/scores' && M === 'GET') {
    const auth = await getAuth(req);
    const best = {};
    if (auth) (await db.select('scores', { user_id: eq(auth.userId) })).forEach(r => { best[r.game] = r.level; });
    return json(200, { best });
  }
  if (p === '/api/scores' && (M === 'POST' || M === 'PATCH')) {
    const auth = await getAuth(req); if (!auth) return json(401, { error: 'Login required.' });
    const body = await readBody(req);
    const games = body.game ? [[body.game, body.level]] : Object.entries(body.best || {});
    for (const [game, level] of games) {
      if (!['trivia', 'agent', 'keys'].includes(game) || !(Number(level) >= 0)) continue;
      const cur = (await db.select('scores', { user_id: eq(auth.userId), game: eq(game) }, { limit: 1 }))[0];
      if (!cur || Number(level) > cur.level) await db.upsert('scores', { user_id: auth.userId, game, level: Math.floor(Number(level)) });
    }
    const best = {}; (await db.select('scores', { user_id: eq(auth.userId) })).forEach(r => { best[r.game] = r.level; });
    return json(200, { best });
  }

  // ---- messages ----
  if (p === '/api/messages' && M === 'POST') {
    const auth = await getAuth(req); if (!auth) return json(401, { error: 'Login required.' });
    const body = await readBody(req);
    const to = String(body.to || body.toUserId || '');
    const text = String(body.text || '').trim().slice(0, 2000);
    if (!to || !text || to === auth.userId) return json(400, { error: 'Message needs a recipient and text.' });
    // the app can post the same message twice — collapse duplicates sent within 3s
    const recent = await db.select('messages', { from_id: eq(auth.userId), to_id: eq(to) }, { order: 'ts.desc', limit: 3 });
    const dup = recent.find(m => m.text === text && Date.now() - Number(m.ts) < 3000);
    if (dup) return json(200, { message: toMessage(dup) });
    const row = await db.insert('messages', { from_id: auth.userId, to_id: to, text, ts: Date.now(), read: false });
    return json(200, { message: toMessage(row) });
  }
  if (p === '/api/messages' && M === 'GET') {
    const auth = await getAuth(req); if (!auth) return json(401, { error: 'Login required.' });
    const peer = u.searchParams.get('with');
    const sent = await db.select('messages', Object.assign({ from_id: eq(auth.userId) }, peer ? { to_id: eq(peer) } : {}), { order: 'ts.asc', limit: 1000 });
    const got = await db.select('messages', Object.assign({ to_id: eq(auth.userId) }, peer ? { from_id: eq(peer) } : {}), { order: 'ts.asc', limit: 1000 });
    if (peer) {
      if (got.some(m => !m.read)) await db.update('messages', { to_id: eq(auth.userId), from_id: eq(peer), read: eq(false) }, { read: true });
      const all = sent.concat(got).sort((a, b) => Number(a.ts) - Number(b.ts));
      return json(200, { messages: all.map(toMessage) });
    }
    const convos = {};
    sent.concat(got).forEach(m => {
      const other = m.from_id === auth.userId ? m.to_id : m.from_id;
      const cv = convos[other] || (convos[other] = { with: other, unread: 0, last: null });
      if (!cv.last || Number(m.ts) > cv.last.ts) cv.last = toMessage(m);
      if (m.to_id === auth.userId && !m.read) cv.unread++;
    });
    const ids = Object.keys(convos);
    if (ids.length) (await db.select('users', { id: inn(ids) })).forEach(r => { convos[r.id].name = r.name; });
    return json(200, { conversations: Object.values(convos).sort((a, b) => b.last.ts - a.last.ts) });
  }

  // ---- agreements ----
  if (p === '/api/agreements' && M === 'POST') {
    const auth = await getAuth(req); if (!auth) return json(401, { error: 'Login required.' });
    const b = await readBody(req);
    if (!b.agrId || !b.listingId) return json(400, { error: 'Invalid agreement.' });
    const agrId = String(b.agrId);
    const existing = (await db.select('agreements', { agr_id: eq(agrId) }, { limit: 1 }))[0];
    if (existing) return json(200, { agreement: toAgreement(existing) });
    const listing = (await db.select('listings', { id: eq(String(b.listingId)) }, { limit: 1 }))[0];
    const ownerId = listing ? listing.owner_id : String(b.ownerId || '');
    if (ownerId === auth.userId) return json(400, { error: "You can't rent your own listing." });
    const rent = num(b.rent), fee = num(b.fee), deposit = num(b.deposit);
    const total = (rent + fee + deposit) > 0 ? +(rent + fee + deposit).toFixed(2) : num(b.total);
    if (!(total > 0)) return json(400, { error: 'Invalid agreement total.' });
    // demo listings have no real account behind them: those auto-accept so the flow can finish
    const owner = ownerId ? await getUser(ownerId) : null;
    const row = await db.insert('agreements', {
      agr_id: agrId, listing_id: String(b.listingId), owner_id: ownerId, renter_id: auth.userId,
      renter_name: String(b.renterName || '').slice(0, 80), title: String(b.title || 'rental').slice(0, 200),
      rent, fee, deposit, total, start_date: b.start || null, end_date: b.end || null, qty: parseInt(b.qty, 10) || 1,
      status: owner ? 'Sent to lister' : 'Accepted', signed_at: Date.now(), paid_at: null,
    });
    return json(200, { agreement: toAgreement(row) });
  }
  if (p === '/api/agreements' && M === 'GET') {
    const auth = await getAuth(req); if (!auth) return json(401, { error: 'Login required.' });
    const asRenter = await db.select('agreements', { renter_id: eq(auth.userId) }, { order: 'signed_at.desc', limit: 200 });
    const asLister = await db.select('agreements', { owner_id: eq(auth.userId) }, { order: 'signed_at.desc', limit: 200 });
    return json(200, { asRenter: asRenter.map(toAgreement), asLister: asLister.map(toAgreement) });
  }
  const am = p.match(/^\/api\/agreements\/([^/]+)\/(accept|decline|cancel|paid)$/);
  if (am && M === 'POST') {
    const auth = await getAuth(req); if (!auth) return json(401, { error: 'Login required.' });
    const id = decodeURIComponent(am[1]), action = am[2];
    const a = (await db.select('agreements', { agr_id: eq(id) }, { limit: 1 }))[0];
    if (!a) return json(404, { error: 'No such agreement.' });
    let next = null;
    if (action === 'accept' || action === 'decline') {
      if (a.owner_id !== auth.userId) return json(403, { error: 'Only the lister can do that.' });
      if (a.status !== 'Sent to lister') return json(409, { error: 'This request was already answered.' });
      next = action === 'accept' ? 'Accepted' : 'Declined';
    } else if (action === 'cancel') {
      if (a.renter_id !== auth.userId) return json(403, { error: 'Only the renter can cancel.' });
      if (!['Sent to lister', 'Accepted'].includes(a.status)) return json(409, { error: 'Too late to cancel.' });
      next = 'Cancelled';
    } else { // paid — with Stripe configured only Stripe can mark an agreement paid
      if (c.STRIPE_KEY) return json(403, { error: 'Payments are confirmed by Stripe.' });
      if (a.renter_id !== auth.userId || a.status !== 'Accepted') return json(409, { error: 'Not payable.' });
      next = 'Paid';
    }
    const rows = await db.update('agreements', { agr_id: eq(id) }, Object.assign({ status: next }, next === 'Paid' ? { paid_at: Date.now() } : {}));
    return json(200, { agreement: toAgreement(rows[0] || Object.assign(a, { status: next })) });
  }

  // ---- reviews ----
  if (p === '/api/reviews' && M === 'GET') {
    const lid = u.searchParams.get('listingId');
    if (!lid) return json(400, { error: 'listingId required.' });
    const rows = await db.select('reviews', { listing_id: eq(lid) }, { order: 'date.desc', limit: 100 });
    return json(200, { reviews: rows.map(toReview) });
  }
  if (p === '/api/reviews' && M === 'POST') {
    const auth = await getAuth(req); if (!auth) return json(401, { error: 'Login required.' });
    const b = await readBody(req);
    const a = (await db.select('agreements', { agr_id: eq(String(b.agrId || '')) }, { limit: 1 }))[0];
    if (!a || a.renter_id !== auth.userId) return json(403, { error: 'You can only review your own rentals.' });
    if (a.status !== 'Paid') return json(409, { error: 'You can review once the rental is paid.' });
    const rating = Math.round(Number(b.rating)), text = String(b.text || '').trim().slice(0, 1000);
    if (!(rating >= 1 && rating <= 5) || text.length < 3) return json(400, { error: 'Add a star rating and a few words.' });
    if ((await db.select('reviews', { agr_id: eq(a.agr_id) }, { limit: 1 }))[0]) return json(409, { error: 'You already reviewed this rental.' });
    const user = await getUser(auth.userId);
    const row = await db.insert('reviews', { listing_id: a.listing_id, agr_id: a.agr_id, user_id: auth.userId, rating, text, by_name: (user && user.name) || 'Renter', date: Date.now() });
    return json(200, { review: toReview(row) });
  }

  // ---- admin ----
  if (p === '/api/posts' && M === 'GET') {
    const auth = await getAuth(req);
    const me = auth && auth.userId;
    const limit = Math.max(1, Math.min(100, parseInt(u.searchParams.get('limit') || '40', 10)));
    const filters = {};
    const by = u.searchParams.get('user');
    if (by) filters.user_id = eq(by);
    const topic = u.searchParams.get('topic');
    if (topic && POST_TOPICS.includes(topic)) filters.topic = eq(topic);
    filters.promo = eq(false);
    const rows = await db.select('posts', filters, { order: 'created_at.desc', limit });
    const authors = await postAuthors(rows);
    return json(200, { posts: rows.map(r => toPost(r, authors, me)) });
  }
  if (p === '/api/posts' && M === 'POST') {
    const auth = await getAuth(req);
    if (!auth) return json(401, { error: 'Log in to post.' });
    const b = await readBody(req);
    const text = String(b.text || '').trim().slice(0, 1000);
    if (text.length < 3) return json(400, { error: 'Write a few words first.' });
    const topic = POST_TOPICS.includes(b.topic) ? b.topic : 'tip';
    if (!auth.admin) {
      const why = promoReason(text);
      if (why) return json(422, { error: why });
      const recent = await db.select('posts', { user_id: eq(auth.userId), created_at: 'gt.' + (Date.now() - 60000) }, { limit: 6 });
      if (recent.length >= 5) return json(429, { error: 'Slow down a little. Try again in a minute.' });
    }
    const row = await db.insert('posts', { id: 'p' + rand(6), user_id: auth.userId, topic, text, promo: false, likes: [], created_at: Date.now() });
    const authors = await postAuthors([row]);
    return json(200, { post: toPost(row, authors, auth.userId) });
  }
  const pm = p.match(/^\/api\/posts\/([^/]+)\/like$/);
  if (pm && M === 'POST') {
    const auth = await getAuth(req);
    if (!auth) return json(401, { error: 'Log in to like posts.' });
    const id = decodeURIComponent(pm[1]);
    const row = (await db.select('posts', { id: eq(id) }, { limit: 1 }))[0];
    if (!row) return json(404, { error: 'No such post.' });
    const likes = Array.isArray(row.likes) ? row.likes.slice() : [];
    const i = likes.indexOf(auth.userId);
    if (i >= 0) likes.splice(i, 1); else likes.push(auth.userId);
    await db.update('posts', { id: eq(id) }, { likes });
    return json(200, { likes: likes.length, liked: i < 0 });
  }
  if (p === '/api/posts' && M === 'DELETE') {
    const auth = await getAuth(req);
    if (!auth) return json(401, { error: 'Login required.' });
    const id = u.searchParams.get('id');
    const row = (await db.select('posts', { id: eq(String(id || '')) }, { limit: 1 }))[0];
    if (!row) return json(200, { ok: true });
    if (row.user_id !== auth.userId && !auth.admin) return json(403, { error: 'Not your post.' });
    await db.remove('posts', { id: eq(row.id) });
    return json(200, { ok: true });
  }
  if (p === '/api/admin-login' && M === 'POST') {
    if (limited('admin:' + ip)) return json(429, { error: 'Too many attempts. Try again in a minute.' });
    const body = await readBody(req);
    const okUser = await safeEq(String(body.user || ''), c.ADMIN_USER);
    const okPass = await safeEq(String(body.pass || ''), c.ADMIN_PASS);
    if (okUser && okPass) {
      fails.delete('admin:' + ip);
      return json(200, { ok: true, token: await newSession('__admin__', true, 8 * 3600 * 1000) });
    }
    const f = failed('admin:' + ip, 5);
    return json(401, { error: 'Incorrect username or password.', locked: f.until > Date.now() });
  }
  if (p === '/api/admin-verify' && M === 'GET') {
    const auth = await getAuth(req);
    return json(200, { ok: !!(auth && auth.admin) });
  }

  // ---- Stripe Checkout ----
  if (p === '/api/checkout-session' && M === 'POST') {
    const auth = await getAuth(req); if (!auth) return json(401, { error: 'Login required.' });
    const body = await readBody(req);
    const a = (await db.select('agreements', { agr_id: eq(String(body.agrId || '')) }, { limit: 1 }))[0];
    if (!a) return json(404, { error: 'No such agreement.' });
    if (a.renter_id !== auth.userId) return json(403, { error: 'Not your agreement.' });
    if (a.status !== 'Accepted') return json(409, { error: 'The lister has to accept before you can pay.' });
    // amount comes from the stored agreement, never from the browser
    const r = await stripeCheckout({
      agrId: a.agr_id, title: a.title, total: Number(a.total),
      success_url: c.PUBLIC_URL + '/?paid=' + encodeURIComponent(a.agr_id) + '&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: c.PUBLIC_URL + '/?cancelled=' + encodeURIComponent(a.agr_id),
    });
    return r.url ? json(200, r) : json(r.error === 'stripe_not_configured' ? 503 : 502, r);
  }
  if (p === '/api/checkout-verify' && M === 'GET') {
    const sid = u.searchParams.get('session_id');
    if (!sid) return json(400, { error: 'session_id required.' });
    const r = await stripeVerify(sid);
    if (r.paid && r.agrId) await markPaid(r.agrId, r.amount, r.receiptId, r.sessionId);
    return json(200, { paid: r.paid, amount: r.amount, agrId: r.agrId, receiptId: r.receiptId, error: r.error });
  }

  // ---- LiveKit: start / join a 1:1 call ----
  if (p === '/api/livekit-token' && M === 'POST') {
    const auth = await getAuth(req); if (!auth) return json(401, { error: 'Login required.' });
    if (!c.LK_READY) return json(503, { error: 'Calls are not configured on this server.' });
    const b = await readBody(req);
    const peer = String(b.with || '');
    if (!peer || peer === auth.userId) return json(400, { error: 'Pick someone to call.' });
    const [me, other] = await Promise.all([getUser(auth.userId), getUser(peer)]);
    if (!me || !other) return json(404, { error: "That person isn't on a real account yet." });
    const room = await callRoom(auth.userId, peer);
    if (b.invite) {
      const recent = await db.select('messages', { from_id: eq(auth.userId), to_id: eq(peer) }, { order: 'ts.desc', limit: 5 });
      if (!recent.some(m => String(m.text).startsWith('::call::') && Date.now() - Number(m.ts) < 30000)) {
        await db.insert('messages', { from_id: auth.userId, to_id: peer, text: '::call::' + (b.video === false ? 'audio' : 'video'), ts: Date.now(), read: false });
      }
    }
    return json(200, { token: await livekitToken(auth.userId, me.name, room), url: c.LK_URL, room, peerName: other.name });
  }

  return json(404, { error: 'Not found.' });
}

export default {
  async fetch(req, env) {
    try { const seo = await seoHandle(req, env); if (seo) return seo; return await route(req, env); }
    catch (err) {
      console.error('[error]', req.method, req.url, err && err.message);
      return json(500, { error: 'Server error.' });
    }
  },
};
// ===== 423.rent SEO (paste at the very END of src/worker.js) =====
const seoEsc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const seoPick = (o, keys) => { for (const k of keys) { if (o && o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; } return ''; };

async function seoHandle(req, env) {
  if (req.method !== 'GET') return null;
  const p = new URL(req.url).pathname;
  if (p !== '/robots.txt' && p !== '/sitemap.xml' && !p.startsWith('/listing/')) return null;
  const c = cfg(env);
  const base = c.PUBLIC_URL;

  if (p === '/robots.txt') {
    return new Response('User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\n\nSitemap: ' + base + '/sitemap.xml\n',
      { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
  }
  if (!c.SB_URL || !c.SB_KEY) return null;

  if (p === '/sitemap.xml') {
    const rows = await db.select('listings', {}, { order: 'created_at.desc', limit: 500 });
    const urls = [base + '/'].concat(rows.map((r) => base + '/listing/' + encodeURIComponent(r.id)));
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.map((u) => '  <url><loc>' + seoEsc(u) + '</loc></url>').join('\n') + '\n</urlset>\n';
    return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
  }

  const m = p.match(/^\/listing\/([^/]+)$/);
  if (!m) return null;
  const id = decodeURIComponent(m[1]);
  const row = (await db.select('listings', { id: eq(id) }, { limit: 1 }))[0];
  if (!row) return new Response('Listing not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  const l = toListing(row);
  const title = String(seoPick(l, ['title', 'name']) || 'Rental listing').slice(0, 90);
  const desc = String(seoPick(l, ['description', 'desc', 'details']) || ('Rent ' + title + ' on 423.rent.')).slice(0, 300);
  const price = Number(seoPick(l, ['price', 'rent', 'rate', 'daily', 'perDay']));
  const img = String(seoPick(l, ['image', 'photo', 'img']) || '');
  const imgUrl = /^https?:\/\//.test(img) ? img : '';
  const url = base + '/listing/' + encodeURIComponent(id);
  const ld = { '@context': 'https://schema.org', '@type': 'Product', name: title, description: desc, url };
  if (imgUrl) ld.image = imgUrl;
  if (Number.isFinite(price) && price > 0) ld.offers = { '@type': 'Offer', price: price.toFixed(2), priceCurrency: 'USD', availability: 'https://schema.org/InStock', url };
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + seoEsc(title) + ' | 423.rent</title>' +
    '<meta name="description" content="' + seoEsc(desc) + '">' +
    '<link rel="canonical" href="' + seoEsc(url) + '">' +
    '<meta property="og:title" content="' + seoEsc(title) + '"><meta property="og:description" content="' + seoEsc(desc) + '">' +
    '<meta property="og:type" content="website"><meta property="og:url" content="' + seoEsc(url) + '">' +
    (imgUrl ? '<meta property="og:image" content="' + seoEsc(imgUrl) + '">' : '') +
    '<script type="application/ld+json">' + JSON.stringify(ld).replace(/</g, '\\u003c') + '</script>' +
    '<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:0 auto;padding:16px;line-height:1.5}img{max-width:100%;border-radius:8px}a.btn{display:inline-block;background:#111;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none}</style>' +
    '</head><body><p><a href="/">423.rent</a></p><h1>' + seoEsc(title) + '</h1>' +
    (imgUrl ? '<img src="' + seoEsc(imgUrl) + '" alt="' + seoEsc(title) + '">' : '') +
    (Number.isFinite(price) && price > 0 ? '<p><strong>$' + seoEsc(price.toFixed(2)) + '</strong></p>' : '') +
    '<p>' + seoEsc(desc) + '</p><p><a class="btn" href="/">Rent this on 423.rent</a></p></body></html>';
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=600' } });
      }
