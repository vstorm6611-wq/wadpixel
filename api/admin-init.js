import { sql, json, bad, methodGuard } from './_lib.js';

/* เรียกครั้งเดียวหลัง deploy:
   curl -X POST "https://<โดเมน>/api/admin-init?key=<ADMIN_KEY>"
   แล้วลบไฟล์นี้ทิ้งได้ (หรือปล่อยไว้ก็ได้ เพราะ CREATE ... IF NOT EXISTS) */
export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;

  const key = new URL(req.url, 'http://x').searchParams.get('key');
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY)
    return bad(res, 'unauthorized', 401);

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS posts (
        id          BIGSERIAL PRIMARY KEY,
        slug        TEXT UNIQUE NOT NULL,
        title       TEXT NOT NULL,
        author      TEXT NOT NULL,
        image_url   TEXT NOT NULL,
        image_path  TEXT NOT NULL,
        width       INT  NOT NULL,
        height      INT  NOT NULL,
        frames      INT  NOT NULL DEFAULT 1,
        fps         INT  NOT NULL DEFAULT 8,
        kind        TEXT NOT NULL DEFAULT 'sheet',
        likes       INT  NOT NULL DEFAULT 0,
        hidden      BOOLEAN NOT NULL DEFAULT FALSE,
        edit_hash   TEXT NOT NULL,
        ip_hash     TEXT,
        project     TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
    /* ตารางที่สร้างไว้ก่อนหน้านี้ยังไม่มีคอลัมน์ project — เติมให้ตอนรีรัน */
    await sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS project TEXT`;
    await sql`CREATE INDEX IF NOT EXISTS posts_new_idx ON posts (created_at DESC, id DESC) WHERE hidden = FALSE`;
    await sql`CREATE INDEX IF NOT EXISTS posts_top_idx ON posts (likes DESC, id DESC) WHERE hidden = FALSE`;
    await sql`CREATE INDEX IF NOT EXISTS posts_ip_idx ON posts (ip_hash, created_at DESC)`;
    await sql`
      CREATE TABLE IF NOT EXISTS likes (
        post_id    BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        ip_hash    TEXT   NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (post_id, ip_hash)
      )`;
    return json(res, 200, { ok: true, message: 'schema พร้อมใช้งาน' });
  } catch (e) {
    return json(res, 500, { ok: false, error: e.message });
  }
}
