var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-DpjVQC/checked-fetch.js
var urls = /* @__PURE__ */ new Set();
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});

// worker.js
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS }
  });
}
__name(json, "json");
function err(msg, status = 400) {
  return json({ error: msg }, status);
}
__name(err, "err");
async function fingerprint(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ua = request.headers.get("User-Agent") || "";
  const raw = ip + ua;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}
__name(fingerprint, "fingerprint");
function looksLikeSpam(text) {
  const lower = text.toLowerCase();
  const spamWords = ["buy now", "click here", "casino", "viagra", "http://", "https://"];
  return spamWords.some((w) => lower.includes(w));
}
__name(looksLikeSpam, "looksLikeSpam");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }
    if (request.method === "GET" && path === "/api/sightings") {
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
    if (request.method === "POST" && path === "/api/sightings") {
      let body;
      try {
        body = await request.json();
      } catch {
        return err("Invalid JSON");
      }
      const { lat, lng, description, nickname, photo_url } = body;
      if (typeof lat !== "number" || typeof lng !== "number") return err("lat and lng must be numbers");
      if (!description || description.trim().length < 5) return err("Description too short");
      if (looksLikeSpam(description)) return err("Submission rejected");
      const nick = (nickname || "Anonymous").slice(0, 40);
      const desc = description.trim().slice(0, 1e3);
      const photo = (photo_url || "").slice(0, 500);
      const result = await env.DB.prepare(`
        INSERT INTO sightings (lat, lng, description, nickname, photo_url)
        VALUES (?, ?, ?, ?, ?)
        RETURNING *
      `).bind(lat, lng, desc, nick, photo).first();
      return json(result, 201);
    }
    if (request.method === "POST" && path === "/api/upload") {
      try {
        const formData = await request.formData();
        const file = formData.get("photo");
        if (!file) return err("No photo provided");
        const ext = file.type === "image/png" ? "png" : "jpg";
        const key = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        await env.PHOTOS.put(key, file.stream(), {
          httpMetadata: { contentType: file.type }
        });
        const photoUrl = `${new URL(request.url).origin}/photos/${key}`;
        return json({ url: photoUrl }, 201);
      } catch (e) {
        return err("Upload failed: " + e.message);
      }
    }
    const photoMatch = path.match(/^\/photos\/(.+)$/);
    if (photoMatch && request.method === "GET") {
      const key = photoMatch[1];
      const object = await env.PHOTOS.get(key);
      if (!object) return new Response("Not found", { status: 404 });
      return new Response(object.body, {
        headers: {
          "Content-Type": object.httpMetadata?.contentType || "image/jpeg",
          "Cache-Control": "public, max-age=31536000",
          ...CORS
        }
      });
    }
    const commentMatch = path.match(/^\/api\/sightings\/(\d+)\/comments$/);
    const upvoteMatch = path.match(/^\/api\/sightings\/(\d+)\/upvote$/);
    if (commentMatch) {
      const id = parseInt(commentMatch[1]);
      if (request.method === "GET") {
        const rows = await env.DB.prepare(
          `SELECT * FROM comments WHERE sighting_id = ? ORDER BY created_at ASC`
        ).bind(id).all();
        return json(rows.results);
      }
      if (request.method === "POST") {
        let body;
        try {
          body = await request.json();
        } catch {
          return err("Invalid JSON");
        }
        const { nickname, body: text } = body;
        if (!text || text.trim().length < 2) return err("Comment too short");
        if (looksLikeSpam(text)) return err("Submission rejected");
        const nick = (nickname || "Anonymous").slice(0, 40);
        const result = await env.DB.prepare(`
          INSERT INTO comments (sighting_id, nickname, body)
          VALUES (?, ?, ?)
          RETURNING *
        `).bind(id, nick, text.trim().slice(0, 500)).first();
        return json(result, 201);
      }
    }
    if (upvoteMatch && request.method === "POST") {
      const id = parseInt(upvoteMatch[1]);
      const fp = await fingerprint(request);
      const existing = await env.DB.prepare(
        `SELECT id FROM upvote_log WHERE sighting_id = ? AND fingerprint = ?`
      ).bind(id, fp).first();
      if (existing) return err("Already upvoted", 409);
      await env.DB.prepare(
        `INSERT INTO upvote_log (sighting_id, fingerprint) VALUES (?, ?)`
      ).bind(id, fp).run();
      const updated = await env.DB.prepare(
        `UPDATE sightings SET upvotes = upvotes + 1 WHERE id = ? RETURNING upvotes`
      ).bind(id).first();
      return json({ upvotes: updated.upvotes });
    }
    return err("Not found", 404);
  }
};

// ../../.nvm/versions/node/v22.22.2/lib/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../.nvm/versions/node/v22.22.2/lib/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-DpjVQC/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../.nvm/versions/node/v22.22.2/lib/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-DpjVQC/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
