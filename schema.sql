-- Pixel Loom · แกลเลอรีแชร์ผลงาน
-- รันไฟล์นี้ครั้งเดียวใน Neon SQL Editor (หรือเรียก /api/admin-init)

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
  kind        TEXT NOT NULL DEFAULT 'sheet',   -- 'sheet' | 'gif'
  likes       INT  NOT NULL DEFAULT 0,
  hidden      BOOLEAN NOT NULL DEFAULT FALSE,
  edit_hash   TEXT NOT NULL,
  ip_hash     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS posts_new_idx
  ON posts (created_at DESC, id DESC) WHERE hidden = FALSE;

CREATE INDEX IF NOT EXISTS posts_top_idx
  ON posts (likes DESC, id DESC) WHERE hidden = FALSE;

CREATE INDEX IF NOT EXISTS posts_ip_idx ON posts (ip_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS likes (
  post_id    BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  ip_hash    TEXT   NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, ip_hash)
);
