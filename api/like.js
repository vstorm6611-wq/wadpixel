import { sql, json, bad, methodGuard, readJson, clean, ipHash } from './_lib.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  try {
    const body = await readJson(req, 4096);
    const slug = clean(body.slug, 32);
    if (!slug) return bad(res, 'ต้องมี slug');

    const [post] = await sql`
      SELECT id FROM posts WHERE slug = ${slug} AND hidden = FALSE LIMIT 1`;
    if (!post) return bad(res, 'ไม่พบผลงาน', 404);

    const ip = ipHash(req);
    const ins = await sql`
      INSERT INTO likes (post_id, ip_hash) VALUES (${post.id}, ${ip})
      ON CONFLICT DO NOTHING RETURNING post_id`;

    if (!ins.length) {
      const [cur] = await sql`SELECT likes FROM posts WHERE id = ${post.id}`;
      return json(res, 200, { ok: true, likes: cur.likes, already: true });
    }

    const [row] = await sql`
      UPDATE posts SET likes = likes + 1 WHERE id = ${post.id} RETURNING likes`;
    return json(res, 200, { ok: true, likes: row.likes, already: false });
  } catch {
    return bad(res, 'server error', 500);
  }
}
