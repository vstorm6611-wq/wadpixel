import { neon } from '@neondatabase/serverless';
import crypto from 'node:crypto';

const CONN =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.NEON_DATABASE_URL;

if (!CONN) console.warn('[pxloom] ไม่พบ DATABASE_URL / POSTGRES_URL');

export const sql = neon(CONN);

const SALT = process.env.IP_SALT || 'pxloom-dev-salt';

/* ---------- ตอบกลับ ---------- */
export function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!res.getHeader('Cache-Control')) res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
}

export function bad(res, msg, status = 400) {
  return json(res, status, { ok: false, error: msg });
}

/* ---------- จำกัดเมธอด ---------- */
export function methodGuard(req, res, allowed) {
  if (allowed.includes(req.method)) return true;
  res.setHeader('Allow', allowed.join(', '));
  bad(res, 'method not allowed', 405);
  return false;
}

/* ---------- ระบุผู้ใช้แบบไม่เก็บ IP ตรง ---------- */
export function ipHash(req) {
  const fwd = req.headers['x-forwarded-for'] || '';
  const ip = String(fwd).split(',')[0].trim() || req.socket?.remoteAddress || '0';
  return crypto.createHash('sha256').update(SALT + '|' + ip).digest('hex').slice(0, 32);
}

/* ---------- token สำหรับให้เจ้าของลบผลงานเอง ---------- */
export function makeEditToken() {
  return crypto.randomBytes(24).toString('base64url');
}
export function hashToken(t) {
  return crypto.createHash('sha256').update(SALT + '|tok|' + t).digest('hex');
}
export function safeEq(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/* ---------- อ่าน body เป็น JSON (รองรับทั้งที่ Vercel parse แล้วและยังไม่ parse) ---------- */
export async function readJson(req, limitBytes = 6 * 1024 * 1024) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');

  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limitBytes) throw new Error('payload too large');
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

/* ---------- ทำความสะอาดข้อความ ---------- */
export function clean(s, max) {
  return String(s ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);
}

/* ---------- สร้าง slug สั้นๆ ---------- */
export function makeSlug() {
  return crypto.randomBytes(6).toString('base64url').toLowerCase();
}

/* ---------- แปลง data URL -> Buffer + ตรวจชนิดไฟล์จริง ---------- */
export function decodeImage(dataUrl, maxBytes = 3 * 1024 * 1024) {
  const m = /^data:image\/(png|gif);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('รองรับเฉพาะ data URL ของ PNG หรือ GIF');

  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) throw new Error('ไฟล์ว่าง');
  if (buf.length > maxBytes) throw new Error('ไฟล์ใหญ่เกิน ' + Math.round(maxBytes / 1024) + ' KB');

  const isPng = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isGif = buf.subarray(0, 6).toString('ascii') === 'GIF89a' ||
                buf.subarray(0, 6).toString('ascii') === 'GIF87a';
  if (m[1] === 'png' && !isPng) throw new Error('ไฟล์ไม่ใช่ PNG จริง');
  if (m[1] === 'gif' && !isGif) throw new Error('ไฟล์ไม่ใช่ GIF จริง');

  return { buf, ext: m[1], mime: 'image/' + m[1] };
}
