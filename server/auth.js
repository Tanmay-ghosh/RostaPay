import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const COOKIE = 'rp_session';

export function setSession(res, payload) {
  const token = jwt.sign(payload, SECRET, { expiresIn: '30d' });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 30 * 86400000 });
}

export function clearSession(res) {
  res.clearCookie(COOKIE);
}

export function readSession(req) {
  const t = req.cookies?.[COOKIE];
  if (!t) return null;
  try { return jwt.verify(t, SECRET); } catch { return null; }
}

export function requireOwner(req, res, next) {
  const s = readSession(req);
  if (!s || s.t !== 'owner') return res.status(401).json({ error: 'Please log in as the owner' });
  req.session = s;
  next();
}

export function requireWorker(req, res, next) {
  const s = readSession(req);
  if (!s || s.t !== 'worker') return res.status(401).json({ error: 'Please log in with your phone and PIN' });
  req.session = s;
  next();
}
