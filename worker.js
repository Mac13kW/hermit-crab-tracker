/**
 * Hermit Crab Sightings Tracker — Cloudflare Worker API
 *
 * Routes:
 *   GET  /api/sightings              → list all sightings
 *   POST /api/sightings              → add a new sighting
 *   GET  /api/sightings/:id/comments → get comments for a sighting
 *   POST /api/sightings/:id/comments → add a comment
 *   POST /api/sightings/:id/upvote   → upvote a sighting
 *   POST /api/upload                 → upload a photo to R2
 *   GET  /photos/:key                → serve a photo from R2
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function err(msg, status = 400) {
  return json({ error: msg }, status);
}

async function fingerprint(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ua = request.headers.get('User-Agent') || '';
  const raw = ip + ua;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

function looksLikeSpam(text) {
  const lower = text.toLowerCase();
  const spamWords = ['buy now', 'click here', 'casino', 'viagra', 'http://', 'https://'];
  return spamWords.some(w => lower.includes(w));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    // ── GET /api/sightings ─────────────────────────────────────────────
    if (request.method === 'GET' && path === '/api/sightings') {
      const rows = await env.DB.prepare(`
        SELECT s.*, COUNT(c.id) AS comment_count
        FROM sightings s
        LEFT JOIN comments c ON c.sighting_id = s.id
        GROUP BY s.id
        ORDER BY s.created_at DESC
        LIMIT 500
      `).all();
      return json(rows.results);
    }

    // ── POST /api/sightings ────────────────────────────────────────────
    if (request.method === 'POST' && path === '/api/sightings') {
      let body;
      try { body = await request.json(); } catch { return err('Invalid JSON'); }

      const { lat, lng, description, nickname, photo_url } = body;
      if (typeof lat !== 'number' || typeof lng !== 'number') return err('lat and lng must be numbers');
      if (!description || description.trim().length < 5) return err('Description too short');
      if (looksLikeSpam(description)) return err('Submission rejected');

      const nick  = (nickname || 'Anonymous').slice(0, 40);
      const desc  = description.trim().slice(0, 1000);
      const photo = (photo_url || '').slice(0, 500);

      const result = await env.DB.prepare(`
        INSERT INTO sightings (lat, lng, description, nickname, photo_url)
        VALUES (?, ?, ?, ?, ?)
        RETURNING *
      `).bind(lat, lng, desc, nick, photo).first();

      return json(result, 201);
    }

    // ── POST /api/upload ───────────────────────────────────────────────
    if (request.method === 'POST' && path === '/api/upload') {
      try {
        const formData = await request.formData();
        const file = formData.get('photo');

        if (!file) return err('No photo provided');

        // Generate unique filename
        const ext = file.type === 'image/png' ? 'png' : 'jpg';
        const key = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

        // Save to R2
        await env.PHOTOS.put(key, file.stream(), {
          httpMetadata: { contentType: file.type },
        });

        // Return the URL to access it
        const photoUrl = `${new URL(request.url).origin}/photos/${key}`;
        return json({ url: photoUrl }, 201);
      } catch (e) {
        return err('Upload failed: ' + e.message);
      }
    }

    // ── GET /photos/:key ───────────────────────────────────────────────
    const photoMatch = path.match(/^\/photos\/(.+)$/);
    if (photoMatch && request.method === 'GET') {
      const key = photoMatch[1];
      const object = await env.PHOTOS.get(key);
      if (!object) return new Response('Not found', { status: 404 });
      return new Response(object.body, {
        headers: {
          'Content-Type': object.httpMetadata?.contentType || 'image/jpeg',
          'Cache-Control': 'public, max-age=31536000',
          ...CORS,
        },
      });
    }

    // ── /api/sightings/:id/... ─────────────────────────────────────────
    const commentMatch = path.match(/^\/api\/sightings\/(\d+)\/comments$/);
    const upvoteMatch  = path.match(/^\/api\/sightings\/(\d+)\/upvote$/);

    if (commentMatch) {
      const id = parseInt(commentMatch[1]);

      if (request.method === 'GET') {
        const rows = await env.DB.prepare(
          `SELECT * FROM comments WHERE sighting_id = ? ORDER BY created_at ASC`
        ).bind(id).all();
        return json(rows.results);
      }

      if (request.method === 'POST') {
        let body;
        try { body = await request.json(); } catch { return err('Invalid JSON'); }
        const { nickname, body: text } = body;
        if (!text || text.trim().length < 2) return err('Comment too short');
        if (looksLikeSpam(text)) return err('Submission rejected');
        const nick = (nickname || 'Anonymous').slice(0, 40);
        const result = await env.DB.prepare(`
          INSERT INTO comments (sighting_id, nickname, body)
          VALUES (?, ?, ?)
          RETURNING *
        `).bind(id, nick, text.trim().slice(0, 500)).first();
        return json(result, 201);
      }
    }

    if (upvoteMatch && request.method === 'POST') {
      const id = parseInt(upvoteMatch[1]);
      const fp = await fingerprint(request);

      const existing = await env.DB.prepare(
        `SELECT id FROM upvote_log WHERE sighting_id = ? AND fingerprint = ?`
      ).bind(id, fp).first();
      if (existing) return err('Already upvoted', 409);

      await env.DB.prepare(
        `INSERT INTO upvote_log (sighting_id, fingerprint) VALUES (?, ?)`
      ).bind(id, fp).run();

      const updated = await env.DB.prepare(
        `UPDATE sightings SET upvotes = upvotes + 1 WHERE id = ? RETURNING upvotes`
      ).bind(id).first();

      return json({ upvotes: updated.upvotes });
    }

    return err('Not found', 404);
  },
};
