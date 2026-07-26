import { put, del } from '@vercel/blob';
import {
  sql, json, bad, methodGuard, readJson, clean,
  ipHash, makeSlug, makeEditToken, hashToken, safeEq, decodeImage
} from './_lib.js';

const MAX_PER_HOUR = 6;
/* ข้อมูลโปรเจกต์ที่ส่งมาพร้อมผลงาน (gzip+base64 จากแอป) — ใหญ่กว่านี้ไม่เก็บลง DB
   แต่ยังฝังอยู่ในไฟล์ PNG ให้ /api/project ไปแกะได้ */
const MAX_PROJECT = 1_200_000;

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST', 'DELETE'])) return;
  try {
    if (req.method === 'DELETE') return await remove(req, res);
    return await create(req, res);
  } catch (e) {
    const msg = e?.message || 'server error';
    const known = /data URL|ไฟล์|payload too large/.test(msg);
    return bad(res, known ? msg : 'server error', known ? 400 : 500);
  }
}

/* ══════════ แชร์ผลงาน ══════════ */
async function create(req, res) {
  const body = await readJson(req);

  const title  = clean(body.title, 48);
  const author = clean(body.author, 24);
  if (!title)  return bad(res, 'ต้องใส่ชื่อผลงาน');
  if (!author) return bad(res, 'ต้องใส่ชื่อผู้สร้าง');

  const width  = int(body.width, 1, 4096);
  const height = int(body.height, 1, 4096);
  const frames = int(body.frames, 1, 512, 1);
  const fps    = int(body.fps, 1, 60, 8);
  if (!width || !height) return bad(res, 'ขนาดภาพไม่ถูกต้อง');

  const { buf, ext, mime } = decodeImage(body.image);
  const kind = ext === 'gif' ? 'gif' : 'sheet';
  const project = cleanProject(body.project);

  const ip = ipHash(req);

  const [{ n }] = await sql`
    SELECT count(*)::int AS n FROM posts
    WHERE ip_hash = ${ip} AND created_at > now() - interval '1 hour'`;
  if (n >= MAX_PER_HOUR) return bad(res, 'แชร์บ่อยเกินไป ลองใหม่ในอีก 1 ชั่วโมง', 429);

  const slug  = makeSlug();
  const path  = `pxloom/${slug}.${ext}`;
  const token = makeEditToken();

  const blob = await put(path, buf, {
    access: 'public',
    contentType: mime,
    addRandomSuffix: false,
    cacheControlMaxAge: 31536000
  });

  const [row] = await sql`
    INSERT INTO posts (slug, title, author, image_url, image_path,
                       width, height, frames, fps, kind, edit_hash, ip_hash, project)
    VALUES (${slug}, ${title}, ${author}, ${blob.url}, ${path},
            ${width}, ${height}, ${frames}, ${fps}, ${kind},
            ${hashToken(token)}, ${ip}, ${project})
    RETURNING id, slug, title, author, image_url, width, height,
              frames, fps, kind, likes, created_at`;

  return json(res, 201, { ok: true, post: shape(row), editToken: token });
}

/* ══════════ ลบผลงานของตัวเอง ══════════ */
async function remove(req, res) {
  const url   = new URL(req.url, 'http://x');
  const body  = req.method === 'DELETE' ? await readJson(req).catch(() => ({})) : {};
  const slug  = clean(url.searchParams.get('slug') || body.slug, 32);
  const token = clean(url.searchParams.get('token') || body.token, 128);
  if (!slug || !token) return bad(res, 'ต้องมี slug และ token');

  const [row] = await sql`
    SELECT id, edit_hash, image_path FROM posts WHERE slug = ${slug} LIMIT 1`;
  if (!row) return bad(res, 'ไม่พบผลงาน', 404);
  if (!safeEq(hashToken(token), row.edit_hash)) return bad(res, 'token ไม่ถูกต้อง', 403);

  await del(row.image_path).catch(() => {});
  await sql`DELETE FROM posts WHERE id = ${row.id}`;
  return json(res, 200, { ok: true });
}

/* ══════════ utils ══════════ */
/* รับเฉพาะรูปแบบที่แอปส่งมา: "gz:<base64>" หรือ "raw:<base64>"
   ค่าอื่นทิ้งเงียบๆ — โพสต์สำคัญกว่าปุ่มรีมิกซ์ */
function cleanProject(v) {
  if (typeof v !== 'string' || !v) return null;
  if (!/^(gz|raw):[A-Za-z0-9+/=]+$/.test(v)) return null;
  if (v.length > MAX_PROJECT) return null;
  return v;
}

function int(v, min, max, dflt = 0) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return n >= min && n <= max ? n : dflt;
}

export function shape(r) {
  return {
    slug: r.slug, title: r.title, author: r.author,
    url: r.image_url, w: r.width, h: r.height,
    frames: r.frames, fps: r.fps, kind: r.kind,
    likes: r.likes, at: r.created_at
  };
}
