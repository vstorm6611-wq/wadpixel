import { sql, json, bad, methodGuard, clean } from './_lib.js';
import { shape } from './share.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return;
  try {
    const url   = new URL(req.url, 'http://x');
    const slug  = clean(url.searchParams.get('slug'), 32);

    /* ดูผลงานชิ้นเดียว (สำหรับลิงก์แชร์ตรง) */
    if (slug) {
      const [row] = await sql`
        SELECT slug, title, author, image_url, width, height, frames, fps, kind, likes, created_at
        FROM posts WHERE slug = ${slug} AND hidden = FALSE LIMIT 1`;
      if (!row) return bad(res, 'ไม่พบผลงาน', 404);
      return json(res, 200, { ok: true, post: shape(row) });
    }

    const sort   = url.searchParams.get('sort') === 'top' ? 'top' : 'new';
    const limit  = Math.min(Math.max(parseInt(url.searchParams.get('limit')) || 24, 1), 48);
    const cursor = parseCursor(url.searchParams.get('cursor'));

    let rows;
    if (sort === 'top') {
      rows = cursor
        ? await sql`
            SELECT id, slug, title, author, image_url, width, height, frames, fps, kind, likes, created_at
            FROM posts
            WHERE hidden = FALSE AND (likes, id) < (${cursor.a}, ${cursor.b})
            ORDER BY likes DESC, id DESC LIMIT ${limit}`
        : await sql`
            SELECT id, slug, title, author, image_url, width, height, frames, fps, kind, likes, created_at
            FROM posts
            WHERE hidden = FALSE
            ORDER BY likes DESC, id DESC LIMIT ${limit}`;
    } else {
      rows = cursor
        ? await sql`
            SELECT id, slug, title, author, image_url, width, height, frames, fps, kind, likes, created_at
            FROM posts
            WHERE hidden = FALSE AND id < ${cursor.b}
            ORDER BY id DESC LIMIT ${limit}`
        : await sql`
            SELECT id, slug, title, author, image_url, width, height, frames, fps, kind, likes, created_at
            FROM posts
            WHERE hidden = FALSE
            ORDER BY id DESC LIMIT ${limit}`;
    }

    const last = rows[rows.length - 1];
    const next = rows.length === limit && last
      ? (sort === 'top' ? `${last.likes}.${last.id}` : `0.${last.id}`)
      : null;

    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=60');
    return json(res, 200, {
      ok: true,
      sort,
      items: rows.map(shape),
      nextCursor: next
    });
  } catch (e) {
    return bad(res, 'server error', 500);
  }
}

function parseCursor(c) {
  if (!c) return null;
  const m = /^(\d+)\.(\d+)$/.exec(String(c));
  if (!m) return null;
  return { a: parseInt(m[1]), b: parseInt(m[2]) };
}
