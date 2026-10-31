/**
 * api.js — общение с Supabase через обычный fetch (без supabase-js).
 * Auth: вход по почте и паролю, обновление токена, выход.
 * REST: задачи (tasks) и участники (members).
 */
const Api = (() => {
  const SESSION_KEY = 'our-days-session';

  let session = readSession();
  let refreshPromise = null;
  let onAuthLost = () => {};

  /** Настроен ли облачный режим. */
  function isConfigured() {
    return Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
  }

  function baseUrl() {
    return CONFIG.SUPABASE_URL.replace(/\/+$/, '');
  }

  function readSession() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY));
    } catch (err) {
      return null;
    }
  }

  function saveSession(data) {
    session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      // expires_at — секунды; если его нет, считаем от expires_in
      expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
      user_id: (data.user && data.user.id) || (session && session.user_id) || null,
    };
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch (err) { /* приватный режим — живём без сохранения */ }
  }

  function clearSession() {
    session = null;
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch (err) { /* ничего */ }
  }

  /** Ошибка с HTTP-статусом, чтобы отличать «нет сети» (status 0) от «не пустили». */
  function httpError(message, status) {
    const err = new Error(message);
    err.status = status;
    return err;
  }

  /** Запрос к Auth API за токеном (grant: password | refresh_token). */
  async function tokenRequest(grant, body) {
    let res;
    try {
      res = await fetch(`${baseUrl()}/auth/v1/token?grant_type=${grant}`, {
        method: 'POST',
        headers: {
          apikey: CONFIG.SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw httpError('Network error', 0);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw httpError(data.error_description || data.msg || 'Auth error', res.status);
    saveSession(data);
    return data;
  }

  /**
   * Вход по почте и паролю.
   * @param {string} email
   * @param {string} password
   */
  async function signIn(email, password) {
    return tokenRequest('password', { email, password });
  }

  /** Обновляет access-токен по refresh-токену (один запрос на всех). */
  function refresh() {
    if (!session || !session.refresh_token) {
      return Promise.reject(httpError('No session', 401));
    }
    if (!refreshPromise) {
      refreshPromise = tokenRequest('refresh_token', { refresh_token: session.refresh_token })
        .catch((err) => {
          // 400/401 — refresh-токен протух или отозван: нужен новый вход
          if (err.status === 400 || err.status === 401) {
            clearSession();
            onAuthLost();
          }
          throw err;
        })
        .finally(() => {
          refreshPromise = null;
        });
    }
    return refreshPromise;
  }

  /** Возвращает живой access-токен, при необходимости обновляя его. */
  async function getAccessToken() {
    if (!session) throw httpError('No session', 401);
    const msLeft = session.expires_at * 1000 - Date.now();
    if (msLeft < 60 * 1000) await refresh();
    return session.access_token;
  }

  /**
   * Запрос к REST API (PostgREST).
   * @param {string} path — например "tasks?select=*"
   * @param {{ method?: string, body?: any, retry?: boolean }} [opts]
   */
  async function rest(path, { method = 'GET', body, retry = true, prefer = 'return=minimal' } = {}) {
    const token = await getAccessToken();
    let res;
    try {
      res = await fetch(`${baseUrl()}/rest/v1/${path}`, {
        method,
        headers: {
          apikey: CONFIG.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Prefer: prefer,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw httpError('Network error', 0);
    }

    // Токен мог протухнуть между проверкой и запросом — пробуем один раз обновить
    if (res.status === 401 && retry) {
      await refresh();
      return rest(path, { method, body, retry: false, prefer });
    }
    if (!res.ok) throw httpError(`REST ${res.status}`, res.status);
    if (method === 'GET') return res.json();
    return null;
  }

  /** Задачи в диапазоне дат (включительно), формат YYYY-MM-DD. */
  function fetchTasks(fromKey, toKey) {
    return rest(`tasks?select=*&date=gte.${fromKey}&date=lte.${toKey}&order=date.asc,start_time.asc`);
  }

  function insertTask(row) {
    return rest('tasks', { method: 'POST', body: row });
  }

  /** Массовая вставка; задачи с уже существующим id пропускаются. */
  function importTasks(rows) {
    return rest('tasks?on_conflict=id', {
      method: 'POST',
      body: rows,
      prefer: 'resolution=ignore-duplicates,return=minimal',
    });
  }

  function updateTask(id, patch) {
    return rest(`tasks?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
  }

  function deleteTask(id) {
    return rest(`tasks?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  /** Сохранить подписку устройства (если такой endpoint уже есть — обновить). */
  function savePushSubscription(row) {
    return rest('push_subscriptions?on_conflict=endpoint', {
      method: 'POST',
      body: row,
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }

  function deletePushSubscription(endpoint) {
    return rest(`push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, { method: 'DELETE' });
  }

  /** Попросить сервер прислать тестовое уведомление на мои устройства. */
  async function sendTestPush() {
    const token = await getAccessToken();
    let res;
    try {
      res = await fetch(`${baseUrl()}/functions/v1/send-reminders`, {
        method: 'POST',
        headers: {
          apikey: CONFIG.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ test: true }),
      });
    } catch (err) {
      throw httpError('Network error', 0);
    }
    if (!res.ok) throw httpError(`Function ${res.status}`, res.status);
    return res.json();
  }

  function fetchMembers() {
    return rest('members?select=user_id,slot,name,color');
  }

  /** Выход: отзываем токен на сервере (если получится) и чистим сессию. */
  async function signOut() {
    if (session) {
      try {
        await fetch(`${baseUrl()}/auth/v1/logout`, {
          method: 'POST',
          headers: { apikey: CONFIG.SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` },
        });
      } catch (err) { /* без сети — просто забываем локально */ }
    }
    clearSession();
  }

  return {
    isConfigured,
    hasSession: () => Boolean(session),
    userId: () => (session ? session.user_id : null),
    setOnAuthLost: (fn) => { onAuthLost = fn; },
    signIn,
    signOut,
    getAccessToken,
    fetchTasks,
    insertTask,
    importTasks,
    updateTask,
    deleteTask,
    fetchMembers,
    savePushSubscription,
    deletePushSubscription,
    sendTestPush,
  };
})();
