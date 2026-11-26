/**
 * Cloudflare Worker: robot-arm-digital-twin.farukhilmi-lab.workers.dev
 * Edge-caches and serves the serverless 6-DOF Vision Robotic Arm Digital Twin
 * from Cloudflare's global network with Web Serial & Camera Permissions-Policy.
 */

const ORIGIN = "https://raw.githubusercontent.com/quantro11/robot-arm-digital-twin/gh-pages";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
};

function getMime(pathname) {
  const dot = pathname.lastIndexOf(".");
  return dot >= 0 ? (MIME[pathname.slice(dot).toLowerCase()] || "application/octet-stream") : "application/octet-stream";
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const url = new URL(request.url);
    let pathname = url.pathname;
    if (pathname === "/" || pathname === "") pathname = "/index.html";
    if (pathname.includes("..")) return new Response("Bad Request", { status: 400 });

    const cache = caches.default;
    const cacheKey = new Request(url.origin + pathname, { method: "GET" });
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const upstream = await fetch(ORIGIN + pathname, {
      cf: { cacheTtl: pathname.startsWith("/assets/") ? 86400 : 300, cacheEverything: true },
    });

    if (!upstream.ok) {
      return new Response("Not Found", { status: 404 });
    }

    const headers = new Headers();
    headers.set("Content-Type", getMime(pathname));
    headers.set(
      "Cache-Control",
      pathname.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "public, max-age=300"
    );
    headers.set("Permissions-Policy", "serial=(self), camera=(self)");
    headers.set("X-Content-Type-Options", "nosniff");

    const resp = new Response(upstream.body, { status: 200, headers });
    ctx.waitUntil(cache.put(cacheKey, resp.clone()));
    return resp;
  },
};
