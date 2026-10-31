/**
 * push.js — подписка этого устройства на push-уведомления.
 *
 * Сами напоминания отправляет сервер (Supabase Edge Function по расписанию),
 * здесь только: проверить поддержку, спросить разрешение, сохранить подписку.
 */
const Push = (() => {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  let registration = null;

  /**
   * Что можно сделать на этом устройстве:
   * unavailable — нет облака/https (колокольчик не показываем),
   * ios-home — iPhone, но сайт открыт не с экрана «Домой»,
   * unsupported — браузер не умеет push, denied — запрещено в настройках, ok — можно.
   */
  function supportState() {
    if (!Api.isConfigured() || !CONFIG.VAPID_PUBLIC_KEY) return 'unavailable';
    if (!window.isSecureContext || !('serviceWorker' in navigator)) return 'unavailable';
    if (isIOS && !isStandalone()) return 'ios-home';
    if (!('PushManager' in window) || !('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    return 'ok';
  }

  async function register() {
    if (!registration) {
      registration = await navigator.serviceWorker.register('sw.js');
      await navigator.serviceWorker.ready;
    }
    return registration;
  }

  /** Ключ VAPID из base64url в байты — так его ждёт pushManager.subscribe. */
  function keyToBytes(base64url) {
    const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
    const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }

  function toRow(subscription) {
    const json = subscription.toJSON();
    return {
      user_id: Api.userId(),
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent.slice(0, 200),
    };
  }

  /** Текущее состояние с учётом подписки: on / off или причина, почему нельзя. */
  async function getStatus() {
    const state = supportState();
    if (state !== 'ok') return state;
    const reg = await register();
    const sub = await reg.pushManager.getSubscription();
    return sub && Notification.permission === 'granted' ? 'on' : 'off';
  }

  /**
   * Включить уведомления. Вызывать прямо из обработчика нажатия:
   * iPhone показывает запрос разрешения только в ответ на действие пользователя.
   */
  async function enable() {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      const err = new Error('Permission denied');
      err.code = 'denied';
      throw err;
    }
    const reg = await register();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyToBytes(CONFIG.VAPID_PUBLIC_KEY),
      });
    }
    await Api.savePushSubscription(toRow(sub));
  }

  /** Выключить на этом устройстве. */
  async function disable() {
    const reg = await register();
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    try {
      await Api.deletePushSubscription(sub.endpoint);
    } catch (err) { /* без сети — сервер сам удалит мёртвую подписку */ }
    await sub.unsubscribe();
  }

  /** При запуске освежаем подписку на сервере: браузер мог её обновить. */
  async function refresh() {
    if (supportState() !== 'ok' || Notification.permission !== 'granted') return;
    const reg = await register();
    const sub = await reg.pushManager.getSubscription();
    if (sub) await Api.savePushSubscription(toRow(sub)).catch(() => {});
  }

  return {
    supportState,
    getStatus,
    enable,
    disable,
    refresh,
    register,
    test: () => Api.sendTestPush(),
  };
})();
