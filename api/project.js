import { sql, json, bad, methodGuard, clean } from './_lib.js';

/* ══════════ ดึงข้อมูลโปรเจกต์ของผลงานหนึ่งชิ้น ══════════
   GET /api/project?slug=xxxx  ->  { ok:true, project:"gz:..." }

   ทำไมต้องมี endpoint นี้แยก:
   1. รูปเก็บอยู่บน Vercel Blob ซึ่งเป็นโดเมนอื่น — <img> โหลดได้ แต่ fetch()
      จากเบราว์เซอร์ต้องมี Access-Control-Allow-Origin ซึ่งไม่การันตี
      เรียกผ่าน API ตัวเองเป็น same-origin เสมอ ไม่ต้องพึ่ง CORS
   2. โพสต์ที่แชร์ก่อนจะมีคอลัมน์ project ยังมีข้อมูลฝังอยู่ในไฟล์ PNG
      ตัวนี้ไปแกะออกมาให้ แล้วเขียนกลับลง DB เพื่อไม่ต้องแกะซ้ำอีก
   3. รายการในแกลเลอรีไม่ต้องแบกข้อมูลก้อนนี้ไปทุกการ์ด (โหลดหน้าเร็วกว่า) */

const PNG_KEY = 'wadpixel';
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return;
  try {
    const url  = new URL(req.url, 'http://x');
    const slug = clean(url.searchParams.get('slug'), 32);
    if (!slug) return bad(res, 'ต้องมี slug');

    const [row] = await sql`
      SELECT id, project, image_url, kind
      FROM posts WHERE slug = ${slug} AND hidden = FALSE LIMIT 1`;
    if (!row) return bad(res, 'ไม่พบผลงาน', 404);

    if (row.project) {
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
      return json(res, 200, { ok: true, project: row.project, source: 'db' });
    }

    if (row.kind === 'gif') {
      return bad(res, 'ผลงาน GIF ฝังโปรเจกต์ไว้ไม่ได้', 404);
    }

    /* ไม่มีใน DB — ไปแกะจากไฟล์ PNG ที่เก็บไว้ (ฝั่งเซิร์ฟเวอร์ ไม่ติด CORS) */
    let text = null;
    try {
      const r = await fetch(row.image_url);
      if (r.ok) {
        text = extractChunk(Buffer.from(await r.arrayBuffer()), PNG_KEY);
      }
    } catch {
      /* ปล่อยให้ตกไปที่ 404 ข้างล่าง */
    }

    if (!text) return bad(res, 'ผลงานนี้ไม่มีข้อมูลโปรเจกต์ติดมา', 404);

    /* เก็บไว้ใช้รอบหน้า ล้มเหลวก็ไม่เป็นไร */
    await sql`UPDATE posts SET project = ${text} WHERE id = ${row.id}`.catch(() => {});

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
    return json(res, 200, { ok: true, project: text, source: 'png' });
  } catch (e) {
    return bad(res, 'server error', 500);
  }
}

/* อ่าน tEXt chunk ที่ keyword ตรงกับที่ต้องการ — เดินตามโครงสร้าง PNG ตรงๆ
   (ยาว 4 ไบต์ + ชนิด 4 ไบต์ + ข้อมูล + CRC 4 ไบต์) */
function extractChunk(buf, keyword) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
  let p = 8;
  while (p + 8 <= buf.length) {
    const len  = buf.readUInt32BE(p);
    const type = buf.subarray(p + 4, p + 8).toString('ascii');
    const dataStart = p + 8;
    if (dataStart + len > buf.length) return null;      // ไฟล์ขาด
    if (type === 'tEXt') {
      const data = buf.subarray(dataStart, dataStart + len);
      const nul  = data.indexOf(0);
      if (nul > 0 && data.subarray(0, nul).toString('latin1') === keyword) {
        return data.subarray(nul + 1).toString('latin1');
      }
    }
    if (type === 'IEND') return null;
    p = dataStart + len + 4;
  }
  return null;
}
