// In-memory store — sufficient for a 60-min class session.
const rooms = new Map();

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

function res(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  if (event.httpMethod === "GET") {
    const room = (event.queryStringParameters || {}).room || "";
    if (!room || room.length > 8) return res(400, { error: "bad room" });
    // -1 = room not initialized yet (deck should not jump)
    return res(200, rooms.get(room) ?? { slide: -1 });
  }

  if (event.httpMethod === "POST") {
    let body;
    try { body = JSON.parse(event.body); } catch { return res(400, { error: "bad json" }); }
    const { room, slide } = body;
    if (!room || room.length > 8 || typeof slide !== "number") return res(400, { error: "bad params" });
    rooms.set(room, { slide });
    return res(200, { ok: true });
  }

  return res(405, { error: "method not allowed" });
};
