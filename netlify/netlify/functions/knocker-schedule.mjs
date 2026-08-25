import { getStore } from "@netlify/blobs";

const MAX_ITEMS = 12;
const MAX_FUTURE_MS = 30 * 60 * 60 * 1000;

function json(status, body) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function bearerToken(request) {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/[\r\n\t]+/g, " ").slice(0, maxLength);
  return cleaned || null;
}

function normalizeItem(item, now) {
  if (!item || typeof item !== "object") return null;

  const title = cleanText(item.title, 80);
  const body = cleanText(item.body, 500);
  const kind = cleanText(item.kind, 64) ?? "random-knock";
  const sound = cleanText(item.sound, 40) ?? "minuet";
  const scheduledAt = new Date(item.scheduled_at);

  if (!title || !body || Number.isNaN(scheduledAt.getTime())) return null;
  if (scheduledAt.getTime() < now.getTime() - 60_000) return null;
  if (scheduledAt.getTime() > now.getTime() + MAX_FUTURE_MS) return null;

  return {
    id: crypto.randomUUID(),
    title,
    body,
    kind,
    sound,
    scheduled_at: scheduledAt.toISOString(),
    status: "pending",
    claimed_at: null,
    sent_at: null,
    expired_at: null,
    retry_count: 0,
    last_error: null,
  };
}

export default async (request) => {
  if (request.method !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  const expectedToken = Netlify.env.get("SLEEP_GUARD_SHORTCUT_TOKEN");
  if (!expectedToken || bearerToken(request) !== expectedToken) {
    return json(401, { ok: false, error: "unauthorized" });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json(400, { ok: false, error: "invalid_json" });
  }

  if (!Array.isArray(payload?.items) || payload.items.length < 1 || payload.items.length > MAX_ITEMS) {
    return json(422, { ok: false, error: "invalid_items" });
  }

  const now = new Date();
  const items = payload.items.map((item) => normalizeItem(item, now));
  if (items.some((item) => item === null)) {
    return json(422, { ok: false, error: "invalid_schedule_item" });
  }

  items.sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));

  const schedule = {
    version: 1,
    schedule_id: crypto.randomUUID(),
    source: cleanText(payload.source, 64) ?? "scriptable-xiaoben-knocker",
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    items,
  };

  try {
    const store = getStore({ name: "xiaoben-knocker", consistency: "strong" });
    await store.setJSON("schedule/current", schedule);
  } catch {
    return json(503, { ok: false, error: "schedule_storage_failed" });
  }

  return json(200, {
    ok: true,
    schedule_id: schedule.schedule_id,
    scheduled_count: schedule.items.length,
    first_at: schedule.items[0].scheduled_at,
    last_at: schedule.items.at(-1).scheduled_at,
  });
};

export const config = {
  path: "/api/knocker-schedule",
  method: ["POST"],
};
