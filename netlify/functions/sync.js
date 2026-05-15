import { getStore } from "@netlify/blobs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const store = getStore("slide-sync");
  const url = new URL(req.url);

  if (req.method === "GET") {
    const room = url.searchParams.get("room") || "";
    if (!room || room.length > 8) {
      return new Response(JSON.stringify({ error: "bad room" }), { status: 400, headers: CORS });
    }
    const data = await store.get(room, { type: "json" }).catch(() => null);
    return new Response(JSON.stringify(data ?? { slide: 0 }), { status: 200, headers: CORS });
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: "bad json" }), { status: 400, headers: CORS });
    }
    const { room, slide } = body;
    if (!room || room.length > 8 || typeof slide !== "number") {
      return new Response(JSON.stringify({ error: "bad params" }), { status: 400, headers: CORS });
    }
    await store.set(room, { slide });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
  }

  return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers: CORS });
};

export const config = { path: "/api/sync" };
