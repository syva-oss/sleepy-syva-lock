import { getStore } from "@netlify/blobs";

const SCHEDULE_KEY = "schedule/current";
const STALE_AFTER_MS = 20 * 60 * 1000;
const CLAIM_TIMEOUT_MS = 8 * 60 * 1000;

async function mutateSchedule(store, mutate) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const current = await store.getWithMetadata(SCHEDULE_KEY, { type: "json" });
    if (!current?.data || !current.etag) return null;

    const next = structuredClone(current.data);
    const result = mutate(next);
    if (!result) return null;

    next.updated_at = new Date().toISOString();
    const write = await store.setJSON(SCHEDULE_KEY, next, { onlyIfMatch: current.etag });
    if (write.modified) return result;
  }
  throw new Error("schedule_update_conflict");
}

async function claimNextDueItem(store, now) {
  return mutateSchedule(store, (schedule) => {
    if (!Array.isArray(schedule.items)) return null;

    const item = schedule.items.find((candidate) => {
      const scheduledAt = new Date(candidate.scheduled_at).getTime();
      const claimAt = candidate.claimed_at ? new Date(candidate.claimed_at).getTime() : 0;
      const claimExpired = candidate.status === "sending" && now.getTime() - claimAt >= CLAIM_TIMEOUT_MS;
      return scheduledAt <= now.getTime()
        && (candidate.status === "pending" || claimExpired)
        && !candidate.sent_at
        && !candidate.expired_at;
    });

    if (!item) return null;

    const age = now.getTime() - new Date(item.scheduled_at).getTime();
    if (age > STALE_AFTER_MS) {
      item.status = "expired";
      item.expired_at = now.toISOString();
      item.claimed_at = null;
      return { expired: true, id: item.id };
    }

    item.status = "sending";
    item.claimed_at = now.toISOString();
    return { expired: false, item: structuredClone(item) };
  });
}

async function finishItem(store, itemId, ok, error = null) {
  await mutateSchedule(store, (schedule) => {
    const item = schedule.items?.find((candidate) => candidate.id === itemId);
    if (!item) return null;

    item.claimed_at = null;
    if (ok) {
      item.status = "sent";
      item.sent_at = new Date().toISOString();
      item.last_error = null;
    } else {
      item.status = "pending";
      item.retry_count = (item.retry_count ?? 0) + 1;
      item.last_error = error ?? "bark_failed";
    }
    return true;
  });
}

async function pushBark(item) {
  const barkKey = Netlify.env.get("BARK_DEVICE_KEY");
  const barkOrigin = Netlify.env.get("BARK_API_ORIGIN") ?? "https://api.day.app";
  if (!barkKey) throw new Error("bark_not_configured");

  const response = await fetch(new URL(`${barkOrigin.replace(/\/$/, "")}/push`), {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      device_key: barkKey,
      title: item.title,
      body: item.body,
      group: "xiaoben-knocker",
      sound: item.sound || "minuet",
      level: "active",
      isArchive: "1",
    }),
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) throw new Error(`bark_http_${response.status}`);
  const payload = await response.clone().json().catch(() => ({}));
  if (payload.code !== undefined && payload.code !== 200) {
    throw new Error(`bark_code_${payload.code}`);
  }
}

export default async () => {
  const store = getStore({ name: "xiaoben-knocker", consistency: "strong" });
  let sent = 0;
  let expired = 0;

  for (let index = 0; index < 12; index += 1) {
    const claim = await claimNextDueItem(store, new Date());
    if (!claim) break;
    if (claim.expired) {
      expired += 1;
      continue;
    }

    try {
      await pushBark(claim.item);
      await finishItem(store, claim.item.id, true);
      sent += 1;
    } catch (error) {
      await finishItem(store, claim.item.id, false, error instanceof Error ? error.message : "bark_failed");
      console.error(`小笨敲门推送失败：${error instanceof Error ? error.message : error}`);
      // 留到下一次五分钟巡视再重试，避免一次故障连续轰炸 Bark 接口。
      break;
    }
  }

  console.log(`小笨敲门巡视完成：送达 ${sent}，过期 ${expired}。`);
};

export const config = {
  schedule: "*/5 * * * *",
};
