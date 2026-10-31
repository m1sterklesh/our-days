// send-reminders — рассылка push-напоминаний Our Days.
//
// Два режима:
//  1. cron (заголовок x-cron-secret) — раз в минуту: находит задачи, у которых подошёл
//     момент напоминания, и шлёт push на все подписанные устройства обоих участников;
//  2. проверка (JWT пользователя + { test: true }) — тестовое уведомление на устройства
//     этого пользователя, для кнопки «Проверить».
//
// Секреты: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET.
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY Supabase подставляет сам.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:noreply@example.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Subscription = { id: string; endpoint: string; p256dh: string; auth: string };
type Payload = { title: string; body: string; tag: string; url: string };

/** Заголовок уведомления: «Сейчас», «Через 15 минут», «Через час», «Завтра». */
function leadText(minutes: number | null, hasTime: boolean): string {
  const m = minutes ?? 0;
  if (!hasTime) return m >= 1440 ? "Завтра" : "Сегодня";
  if (m === 0) return "Сейчас";
  if (m < 60) return `Через ${m} мин`;
  if (m === 60) return "Через час";
  if (m < 1440) return `Через ${Math.round(m / 60)} ч`;
  if (m === 1440) return "Завтра";
  return `Через ${Math.round(m / 1440)} дн`;
}

/** Шлёт payload на подписки; мёртвые (404/410) удаляет. Возвращает число доставленных. */
async function sendTo(subs: Subscription[], payload: Payload): Promise<number> {
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 3600, urgency: "high" },
      );
      sent++;
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        await db.from("push_subscriptions").delete().eq("id", s.id);
      } else {
        console.error("push failed", code, (err as { body?: string }).body ?? String(err));
      }
    }
  }));
  return sent;
}

/** Режим cron: разослать подошедшие напоминания. */
async function runReminders(): Promise<Response> {
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const { data: due, error } = await db
    .from("tasks")
    .select("id, date, start_time, title, remind_before")
    .is("reminded_at", null)
    .eq("done", false)
    .lte("remind_at", now.toISOString())
    .gt("remind_at", hourAgo.toISOString()) // давно прошедшие не шлём
    .limit(50);
  if (error) return json({ error: error.message }, 500);
  if (!due?.length) return json({ tasks: 0, sent: 0 });

  // Сначала помечаем — чтобы параллельный запуск не отправил то же самое второй раз
  const { data: claimed } = await db
    .from("tasks")
    .update({ reminded_at: now.toISOString() })
    .in("id", due.map((t) => t.id))
    .is("reminded_at", null)
    .select("id");
  const claimedIds = new Set((claimed ?? []).map((r) => r.id));

  const { data: subs } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth");

  let sent = 0;
  for (const t of due.filter((t) => claimedIds.has(t.id))) {
    const time = t.start_time ? String(t.start_time).slice(0, 5) : null;
    sent += await sendTo(subs ?? [], {
      title: leadText(t.remind_before, Boolean(time)),
      body: time ? `${time} · ${t.title}` : t.title,
      tag: t.id,
      url: `./?date=${t.date}`,
    });
  }
  return json({ tasks: claimedIds.size, sent });
}

/** Режим проверки: тестовый push на устройства вошедшего пользователя. */
async function runTest(req: Request): Promise<Response> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "unauthorized" }, 401);

  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) return json({ error: "unauthorized" }, 401);

  const { data: member } = await db.from("members").select("name").eq("user_id", user.id).maybeSingle();
  if (!member) return json({ error: "forbidden" }, 403);

  const { data: subs } = await db
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", user.id);

  const sent = await sendTo(subs ?? [], {
    title: "Our Days",
    body: `${member.name}, уведомления работают`,
    tag: "test",
    url: "./",
  });
  return json({ sent });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const cronHeader = req.headers.get("x-cron-secret");
  if (cronHeader) {
    if (!CRON_SECRET || cronHeader !== CRON_SECRET) return json({ error: "unauthorized" }, 401);
    return runReminders();
  }
  return runTest(req);
});
