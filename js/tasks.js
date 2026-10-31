/**
 * tasks.js — хранилище задач.
 *
 * Локальный кеш в localStorage (ключ our-days-tasks) в формате из ТЗ:
 *   { "2026-11-01": [ { id, title, time, endTime, note, done, owner, createdAt, updatedAt } ] }
 *
 * В облачном режиме каждое изменение сразу применяется локально (интерфейс
 * не ждёт сеть), затем уходит в Supabase. Если сервер ответил ошибкой —
 * изменение откатывается и показывается сообщение.
 */
const Tasks = (() => {
  const STORAGE_KEY = 'our-days-tasks';

  let byDate = readCache();
  let pending = 0; // сколько изменений ещё летит на сервер
  const listeners = new Set();
  let onError = () => {};

  const remote = () => Api.isConfigured();

  function readCache() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch (err) {
      return {};
    }
  }

  function saveCache() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(byDate));
    } catch (err) { /* переполнение или приватный режим */ }
  }

  function emit() {
    listeners.forEach((fn) => fn());
  }

  /** UUID v4: randomUUID есть не везде (например, по file:// в старых браузерах). */
  function uuid() {
    if (window.crypto && crypto.randomUUID) {
      try { return crypto.randomUUID(); } catch (err) { /* ниже запасной вариант */ }
    }
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  /** Сначала задачи без времени, потом по времени, потом по созданию. */
  function sortDay(list) {
    list.sort((a, b) => {
      if (!a.time !== !b.time) return a.time ? 1 : -1;
      return (a.time || '').localeCompare(b.time || '') || a.createdAt.localeCompare(b.createdAt);
    });
  }

  /**
   * Момент напоминания в UTC: локальные дата и время минус «за сколько».
   * Задачи без времени напоминают от 9:00 того дня.
   * @returns {string|null} ISO-строка или null, если напоминание выключено
   */
  function computeRemindAt(key, time, remindBefore) {
    if (remindBefore === null || remindBefore === undefined) return null;
    const [y, m, d] = key.split('-').map(Number);
    const [hh, mm] = (time || '09:00').split(':').map(Number);
    const at = new Date(y, m - 1, d, hh, mm);
    at.setMinutes(at.getMinutes() - remindBefore);
    return at.toISOString();
  }

  function find(id) {
    for (const key of Object.keys(byDate)) {
      const index = byDate[key].findIndex((t) => t.id === id);
      if (index !== -1) return { key, index, task: byDate[key][index] };
    }
    return null;
  }

  function putLocal(key, task) {
    if (!byDate[key]) byDate[key] = [];
    byDate[key].push(task);
    sortDay(byDate[key]);
  }

  function removeLocal(id) {
    const found = find(id);
    if (!found) return null;
    byDate[found.key].splice(found.index, 1);
    if (!byDate[found.key].length) delete byDate[found.key];
    return found;
  }

  // ---------- Преобразование строка БД ⇄ задача ----------

  function toRow(task, key) {
    return {
      id: task.id,
      date: key,
      start_time: task.time || null,
      end_time: task.endTime || null,
      title: task.title,
      note: task.note || null,
      done: task.done,
      owner: task.owner,
      remind_before: task.remindBefore ?? null,
      remind_at: task.remindAt || null,
      created_at: task.createdAt,
      updated_at: task.updatedAt,
    };
  }

  function fromRow(row) {
    return {
      id: row.id,
      title: row.title,
      time: row.start_time ? row.start_time.slice(0, 5) : null,
      endTime: row.end_time ? row.end_time.slice(0, 5) : null,
      note: row.note || '',
      done: Boolean(row.done),
      owner: row.owner,
      remindBefore: row.remind_before ?? null,
      remindAt: row.remind_at || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at || row.created_at,
    };
  }

  /** Патч задачи → патч строки БД (только изменённые поля). */
  function patchToRow(patch) {
    const map = {
      date: 'date', time: 'start_time', endTime: 'end_time', title: 'title', note: 'note',
      done: 'done', owner: 'owner', updatedAt: 'updated_at', remindBefore: 'remind_before', remindAt: 'remind_at',
    };
    const row = {};
    Object.keys(patch).forEach((k) => {
      if (map[k]) row[map[k]] = patch[k] === '' ? null : patch[k];
    });
    return row;
  }

  /** Отправка на сервер с откатом при ошибке. */
  async function pushRemote(request, rollback) {
    if (!remote()) return true;
    pending++;
    try {
      await request();
      return true;
    } catch (err) {
      rollback();
      saveCache();
      emit();
      onError(err);
      return false;
    } finally {
      pending--;
    }
  }

  // ---------- Публичные операции ----------

  /** Задачи дня (копии с полем date). */
  function getDay(key) {
    return (byDate[key] || []).map((t) => ({ ...t, date: key }));
  }

  function getById(id) {
    const found = find(id);
    return found ? { ...found.task, date: found.key } : null;
  }

  /**
   * Создаёт задачу.
   * @param {{ date, title, time?, endTime?, note?, owner }} data
   */
  async function add(data) {
    const now = new Date().toISOString();
    const task = {
      id: uuid(),
      title: data.title.trim(),
      time: data.time || null,
      endTime: data.time && data.endTime ? data.endTime : null,
      note: (data.note || '').trim(),
      done: false,
      owner: data.owner || 'both',
      remindBefore: data.remindBefore ?? null,
      remindAt: computeRemindAt(data.date, data.time || null, data.remindBefore ?? null),
      createdAt: now, // время создания сохраняется автоматически
      updatedAt: now,
    };
    putLocal(data.date, task);
    saveCache();
    emit();
    await pushRemote(() => Api.insertTask(toRow(task, data.date)), () => removeLocal(task.id));
    return task;
  }

  /**
   * Меняет задачу. Если в patch есть date — задача переезжает на другой день.
   * @param {string} id
   * @param {object} patch — любые поля задачи + date
   */
  async function update(id, patch) {
    const found = find(id);
    if (!found) return;
    const before = { ...found.task };
    const beforeKey = found.key;

    const fullPatch = { ...patch, updatedAt: new Date().toISOString() };
    if ('time' in fullPatch && !fullPatch.time) fullPatch.endTime = null;

    removeLocal(id);
    const updated = { ...before, ...fullPatch };
    delete updated.date;
    const newKey = patch.date || beforeKey;

    // Сдвинули дату, время или «за сколько» — пересчитываем момент напоминания
    if ('date' in patch || 'time' in patch || 'remindBefore' in patch) {
      updated.remindAt = computeRemindAt(newKey, updated.time, updated.remindBefore ?? null);
      fullPatch.remindAt = updated.remindAt;
    }
    putLocal(newKey, updated);
    saveCache();
    emit();

    await pushRemote(
      () => Api.updateTask(id, patchToRow(fullPatch)),
      () => {
        removeLocal(id);
        putLocal(beforeKey, before);
      },
    );
  }

  async function remove(id) {
    const found = removeLocal(id);
    if (!found) return;
    saveCache();
    emit();
    await pushRemote(() => Api.deleteTask(id), () => putLocal(found.key, found.task));
  }

  /**
   * Подтягивает задачи диапазона с сервера и заменяет ими кеш этого диапазона.
   * Пока летят наши собственные изменения — не трогаем, чтобы не мигало.
   * @returns {Promise<boolean>} true — синхронизировались, false — нет сети / пропустили
   */
  async function sync(fromKey, toKey) {
    if (!remote() || pending > 0) return false;
    const rows = await Api.fetchTasks(fromKey, toKey);
    if (pending > 0) return false;

    Object.keys(byDate).forEach((key) => {
      if (key >= fromKey && key <= toKey) delete byDate[key];
    });
    rows.forEach((row) => putLocal(row.date, fromRow(row)));
    saveCache();
    emit();
    return true;
  }

  /**
   * Одноразово отправляет в облако задачи, созданные в локальном режиме,
   * чтобы первая синхронизация их не затёрла.
   * @returns {Promise<number>} сколько задач отправлено
   */
  async function importLocal() {
    const rows = [];
    Object.keys(byDate).forEach((key) => byDate[key].forEach((t) => rows.push(toRow(t, key))));
    if (rows.length) await Api.importTasks(rows);
    return rows.length;
  }

  /** Полная очистка кеша (при выходе). */
  function clear() {
    byDate = {};
    saveCache();
    emit();
  }

  return {
    getDay,
    getById,
    add,
    update,
    remove,
    sync,
    importLocal,
    clear,
    onChange: (fn) => listeners.add(fn),
    setOnError: (fn) => { onError = fn; },
  };
})();
