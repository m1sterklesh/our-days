/**
 * main.js — точка входа: состояние, отрисовка, панель дня, формы, синхронизация.
 */

const $ = (id) => document.getElementById(id);

const els = {
  app: $('app'),
  calendar: $('calendar'),
  title: $('title'),
  prevBtn: $('prev-btn'),
  nextBtn: $('next-btn'),
  todayBtn: $('today-btn'),
  addBtn: $('add-btn'),
  weekBtn: $('week-btn'),
  viewBtns: document.querySelectorAll('.segmented__btn'),
  filters: $('filters'),
  modeBadge: $('mode-badge'),
  logoutBtn: $('logout-btn'),
  panel: $('panel'),
  panelTitle: $('panel-title'),
  panelSub: $('panel-sub'),
  panelClose: $('panel-close'),
  panelAdd: $('panel-add'),
  panelEmpty: $('panel-empty'),
  taskList: $('task-list'),
  backdrop: $('sheet-backdrop'),
  taskModal: $('task-modal'),
  taskForm: $('task-form'),
  taskModalTitle: $('task-modal-title'),
  fTitle: $('f-title'),
  fDate: $('f-date'),
  fTime: $('f-time'),
  fEnd: $('f-end'),
  fNote: $('f-note'),
  fRemind: $('f-remind'),
  fRemindHint: $('f-remind-hint'),
  bellBtn: $('bell-btn'),
  notifyModal: $('notify-modal'),
  notifyText: $('notify-text'),
  notifyOn: $('notify-on'),
  notifyOff: $('notify-off'),
  notifyTest: $('notify-test'),
  fOwner: $('f-owner'),
  fError: $('f-error'),
  fMeta: $('f-meta'),
  fDelete: $('f-delete'),
  confirmModal: $('confirm-modal'),
  confirmText: $('confirm-text'),
  confirmOk: $('confirm-ok'),
  toast: $('toast'),
};

const mobileQuery = window.matchMedia('(max-width: 899px)');
const VIEW_KEY = 'our-days-view';
const FILTER_KEY = 'our-days-filter';
const MEMBERS_KEY = 'our-days-members';
const OWNERS = ['a', 'b', 'both'];

const state = {
  view: readStored(VIEW_KEY, 'month') === 'week' ? 'week' : 'month',
  cursor: new Date(), // какой месяц / неделю / день показываем
  selectedKey: DateUtils.todayKey(),
  filter: new Set(readStored(FILTER_KEY, OWNERS)),
  members: { ...CONFIG.DEFAULT_MEMBERS },
  mySlot: null,
  editingId: null,
  formOwner: 'both',
  deleteId: null,
  offline: false,
};

let started = false;
let pendingRender = false;
let syncing = false;
let pollTimer = null;
let toastTimer = null;
let lastToday = DateUtils.todayKey();

// ---------- Утилиты ----------

function readStored(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v === null ? fallback : v;
  } catch (err) {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) { /* ничего */ }
}

const isMobile = () => mobileQuery.matches;

function plural(n, one, few, many) {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}

function ownerInfo(owner) {
  if (owner === 'both') return CONFIG.BOTH;
  return state.members[owner] || CONFIG.DEFAULT_MEMBERS[owner] || CONFIG.BOTH;
}

const colorOf = (owner) => ownerInfo(owner).color;

/** Задачи дня с учётом фильтра «чьи». */
function visibleTasks(key) {
  return Tasks.getDay(key).filter((t) => state.filter.has(t.owner));
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('is-visible'), 3200);
}

function svgIcon(path) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', path);
  svg.appendChild(p);
  return svg;
}

// ---------- Навигация ----------

/** Дни для сетки часов: неделя на десктопе, один день на мобилке. */
function gridDays() {
  if (isMobile()) return [DateUtils.fromKey(DateUtils.toKey(state.cursor))];
  const start = DateUtils.startOfWeek(state.cursor);
  return Array.from({ length: 7 }, (_, i) => DateUtils.addDays(start, i));
}

function headerTitle() {
  if (state.view === 'week' && !isMobile()) {
    const days = gridDays();
    const a = days[0];
    const b = days[6];
    if (a.getMonth() === b.getMonth()) return DateUtils.monthTitle(a);
    const short = (d) => MONTHS[d.getMonth()].slice(0, 3);
    return `${short(a)} – ${short(b)} ${b.getFullYear()}`;
  }
  return DateUtils.monthTitle(state.cursor);
}

/** Шаг назад/вперёд: месяц, неделя или день — в зависимости от вида. */
function navigate(dir) {
  if (state.view === 'month') {
    state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + dir, 1);
    const today = new Date();
    const sameMonth = today.getFullYear() === state.cursor.getFullYear() && today.getMonth() === state.cursor.getMonth();
    state.selectedKey = DateUtils.toKey(sameMonth ? today : state.cursor);
  } else if (isMobile()) {
    state.cursor = DateUtils.addDays(state.cursor, dir);
    state.selectedKey = DateUtils.toKey(state.cursor);
  } else {
    state.cursor = DateUtils.addDays(state.cursor, dir * 7);
    state.selectedKey = DateUtils.toKey(DateUtils.addDays(DateUtils.fromKey(state.selectedKey), dir * 7));
  }
  render();
  syncNow();
}

function goToday() {
  state.cursor = new Date();
  state.selectedKey = DateUtils.todayKey();
  render();
  syncNow();
}

function setView(view) {
  state.view = view;
  writeStored(VIEW_KEY, view);
  state.cursor = DateUtils.fromKey(state.selectedKey);
  render();
  syncNow();
}

/** Сдвигает вид так, чтобы день был виден (например, после создания задачи на другую дату). */
function ensureVisible(key) {
  const date = DateUtils.fromKey(key);
  if (state.view === 'month') {
    if (date.getMonth() !== state.cursor.getMonth() || date.getFullYear() !== state.cursor.getFullYear()) {
      state.cursor = new Date(date.getFullYear(), date.getMonth(), 1);
    }
  } else {
    const days = gridDays().map(DateUtils.toKey);
    if (!days.includes(key)) state.cursor = date;
  }
}

function selectDay(key) {
  state.selectedKey = key;
  if (state.view === 'month') {
    ensureVisible(key);
  } else if (isMobile()) {
    state.cursor = DateUtils.fromKey(key);
  }
  render();
  if (isMobile() && state.view === 'month') openSheet();
}

// ---------- Отрисовка ----------

function render() {
  // Пока что-то тащим, не перерисовываем — иначе элемент выдернется из-под пальца
  if (DragState.active) {
    pendingRender = true;
    return;
  }
  pendingRender = false;

  const wide = state.view === 'week' && !isMobile();
  els.app.classList.toggle('is-wide', wide);
  els.weekBtn.textContent = isMobile() ? 'День' : 'Неделя';
  els.viewBtns.forEach((btn) => {
    const active = btn.dataset.view === state.view;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  els.title.textContent = headerTitle();

  const common = {
    selectedKey: state.selectedKey,
    todayKey: DateUtils.todayKey(),
    getTasks: visibleTasks,
    colorOf,
    onTaskClick: openEdit,
  };

  if (state.view === 'month') {
    renderMonth(els.calendar, {
      ...common,
      viewDate: state.cursor,
      onSelect: selectDay,
      onCreate: (key) => openCreate({ date: key }),
      onTaskMove: (id, key) => Tasks.update(id, { date: key }),
    });
  } else {
    renderTimeGrid(els.calendar, {
      ...common,
      days: gridDays(),
      onSelectDay: selectDay,
      onTaskChange: (id, patch) => Tasks.update(id, patch),
      onCreate: openCreate,
      onCancel: render,
    });
  }

  renderFilters();
  renderPanel();
}

function renderFilters() {
  els.filters.replaceChildren(...OWNERS.map((owner) => {
    const info = ownerInfo(owner);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.style.setProperty('--c', info.color);
    chip.setAttribute('aria-pressed', String(state.filter.has(owner)));
    chip.title = state.filter.has(owner) ? `Скрыть: ${info.name}` : `Показать: ${info.name}`;
    const dot = document.createElement('span');
    dot.className = 'dot';
    const name = document.createElement('span');
    name.className = 'chip__name';
    name.textContent = info.name;
    chip.append(dot, name);
    chip.addEventListener('click', () => {
      if (state.filter.has(owner)) state.filter.delete(owner);
      else state.filter.add(owner);
      writeStored(FILTER_KEY, [...state.filter]);
      render();
    });
    return chip;
  }));
}

function renderPanel() {
  const key = state.selectedKey;
  const date = DateUtils.fromKey(key);
  const tasks = visibleTasks(key);
  const hidden = Tasks.getDay(key).length - tasks.length;
  const done = tasks.filter((t) => t.done).length;

  els.panelTitle.textContent = key === DateUtils.todayKey() ? `Сегодня, ${DateUtils.dayShort(date)}` : DateUtils.dayTitle(date);

  const parts = [];
  if (tasks.length) parts.push(`${tasks.length} ${plural(tasks.length, 'задача', 'задачи', 'задач')}`);
  if (done) parts.push(`выполнено ${done}`);
  if (hidden) parts.push(`скрыто фильтром ${hidden}`);
  els.panelSub.textContent = parts.join(' · ');

  els.taskList.replaceChildren(...tasks.map(createTaskItem));
  els.panelEmpty.hidden = tasks.length > 0;
}

/** Элемент списка задач в панели дня. */
function createTaskItem(task) {
  const li = document.createElement('li');
  li.className = `task${task.done ? ' is-done' : ''}`;

  const check = document.createElement('button');
  check.type = 'button';
  check.className = 'task__check';
  check.setAttribute('aria-label', task.done ? 'Вернуть в невыполненные' : 'Отметить выполненной');
  check.setAttribute('aria-pressed', String(task.done));
  check.style.borderColor = task.done ? '' : colorOf(task.owner);
  check.appendChild(svgIcon('M5 12l5 5 9-10'));
  check.addEventListener('click', () => Tasks.update(task.id, { done: !task.done }));

  const body = document.createElement('button');
  body.type = 'button';
  body.className = 'task__body';
  const title = document.createElement('span');
  title.className = 'task__title';
  title.textContent = task.title;
  const meta = document.createElement('span');
  meta.className = 'task__meta';
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.style.setProperty('--c', colorOf(task.owner));
  const metaText = document.createElement('span');
  const time = TimeUtils.range(task);
  metaText.textContent = [ownerInfo(task.owner).name, time || 'весь день'].join(' · ');
  meta.append(dot, metaText);
  if (task.remindBefore !== null && task.remindBefore !== undefined) {
    const bell = svgIcon('M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0');
    bell.classList.add('task__bell');
    bell.setAttribute('aria-label', 'С напоминанием');
    meta.appendChild(bell);
  }
  body.append(title, meta);
  if (task.note) {
    const note = document.createElement('span');
    note.className = 'task__note';
    note.textContent = task.note;
    body.appendChild(note);
  }
  body.addEventListener('click', () => openEdit(task.id));

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'icon-btn task__delete';
  del.setAttribute('aria-label', 'Удалить задачу');
  del.appendChild(svgIcon('M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3'));
  del.addEventListener('click', () => askDelete(task.id));

  li.append(check, body, del);
  return li;
}

// ---------- Bottom sheet (мобилка) ----------

function openSheet() {
  els.panel.classList.add('is-open');
  els.backdrop.classList.add('is-visible');
}

function closeSheet() {
  els.panel.classList.remove('is-open');
  els.backdrop.classList.remove('is-visible');
}

// ---------- Форма задачи ----------

function renderOwnerPick() {
  els.fOwner.replaceChildren(...OWNERS.map((owner) => {
    const info = ownerInfo(owner);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.setAttribute('role', 'radio');
    chip.setAttribute('aria-checked', String(state.formOwner === owner));
    chip.style.setProperty('--c', info.color);
    const dot = document.createElement('span');
    dot.className = 'dot';
    chip.append(dot, document.createTextNode(info.name));
    chip.addEventListener('click', () => {
      state.formOwner = owner;
      renderOwnerPick();
    });
    return chip;
  }));
}

function resetFormErrors() {
  els.fError.textContent = '';
  [els.fTitle, els.fDate, els.fTime, els.fEnd].forEach((f) => f.removeAttribute('aria-invalid'));
}

/** Новая задача; draft может содержать дату и время (из клика по сетке). */
function openCreate(draft = {}) {
  state.editingId = null;
  els.taskModalTitle.textContent = 'Новая задача';
  els.fTitle.value = '';
  els.fDate.value = draft.date || state.selectedKey;
  els.fTime.value = draft.time || '';
  els.fEnd.value = draft.endTime || '';
  els.fNote.value = '';
  els.fMeta.textContent = '';
  els.fDelete.hidden = true;
  // По умолчанию напоминаем за 15 минут, если у задачи есть время
  els.fRemind.value = els.fTime.value ? '15' : '';
  remindTouched = false;
  updateRemindHint();
  state.formOwner = state.mySlot || 'both';
  renderOwnerPick();
  resetFormErrors();
  openModal(els.taskModal, els.fTitle);
}

function openEdit(id) {
  const task = Tasks.getById(id);
  if (!task) return;
  state.editingId = id;
  els.taskModalTitle.textContent = 'Задача';
  els.fTitle.value = task.title;
  els.fDate.value = task.date;
  els.fTime.value = task.time || '';
  els.fEnd.value = task.endTime || '';
  els.fNote.value = task.note || '';
  els.fRemind.value = task.remindBefore === null || task.remindBefore === undefined ? '' : String(task.remindBefore);
  remindTouched = true;
  updateRemindHint();
  const created = new Date(task.createdAt);
  els.fMeta.textContent = Number.isNaN(created.getTime())
    ? ''
    : `Создано ${DateUtils.dayShort(created)} в ${TimeUtils.fromMin(created.getHours() * 60 + created.getMinutes())}`;
  els.fDelete.hidden = false;
  state.formOwner = task.owner;
  renderOwnerPick();
  resetFormErrors();
  openModal(els.taskModal, null);
}

let remindTouched = false;

/** Подсказка под «Напомнить» нужна только задачам без времени. */
function updateRemindHint() {
  els.fRemindHint.hidden = Boolean(els.fTime.value) || els.fRemind.value === '';
}

function formError(message, field) {
  els.fError.textContent = message;
  if (field) {
    field.setAttribute('aria-invalid', 'true');
    field.focus();
  }
}

function handleFormSubmit(e) {
  e.preventDefault();
  resetFormErrors();

  const title = els.fTitle.value.trim();
  const date = els.fDate.value;
  const time = els.fTime.value;
  const endTime = els.fEnd.value;

  if (!title) return formError('Как назовём задачу?', els.fTitle);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return formError('Выбери дату', els.fDate);
  if (endTime && !time) return formError('Укажи, во сколько начало', els.fTime);
  if (time && endTime && endTime <= time) return formError('Окончание должно быть позже начала', els.fEnd);

  const data = {
    title,
    date,
    time: time || null,
    endTime: time && endTime ? endTime : null,
    note: els.fNote.value.trim(),
    owner: state.formOwner,
    remindBefore: els.fRemind.value === '' ? null : Number(els.fRemind.value),
  };

  state.selectedKey = date;
  ensureVisible(date);
  if (!state.filter.has(data.owner)) {
    // Иначе новая задача «пропадёт» из-за фильтра
    state.filter.add(data.owner);
    writeStored(FILTER_KEY, [...state.filter]);
  }

  if (state.editingId) Tasks.update(state.editingId, data);
  else Tasks.add(data);
  closeModal(els.taskModal);
}

// ---------- Удаление ----------

function askDelete(id) {
  const task = Tasks.getById(id);
  if (!task) return;
  state.deleteId = id;
  els.confirmText.textContent = `Удалить «${task.title}»?`;
  openModal(els.confirmModal, els.confirmOk);
}

function confirmDelete() {
  const id = state.deleteId;
  state.deleteId = null;
  closeModal(els.confirmModal);
  if (state.editingId === id) closeModal(els.taskModal);
  if (id) Tasks.remove(id);
}

// ---------- Модалки ----------

let lastFocus = null;

function openModal(modal, focusEl) {
  if (!anyModalOpen()) lastFocus = document.activeElement;
  modal.hidden = false;
  setTimeout(() => (focusEl || modal.querySelector('input, button')).focus(), 30);
}

function closeModal(modal) {
  if (modal.hidden) return;
  modal.hidden = true;
  if (!anyModalOpen() && lastFocus && document.contains(lastFocus)) {
    lastFocus.focus({ preventScroll: true });
  }
}

function anyModalOpen() {
  return !els.taskModal.hidden || !els.confirmModal.hidden || !els.notifyModal.hidden;
}

// ---------- Уведомления ----------

const NOTIFY_TEXTS = {
  on: 'Уведомления включены на этом устройстве. Напоминания о задачах приходят вам обоим.',
  off: 'Включи, чтобы получать напоминания о задачах на это устройство. Время напоминания выбирается в каждой задаче.',
  denied: 'Уведомления запрещены в настройках браузера. Разреши их для этого сайта и открой это окно снова.',
  'ios-home': 'На iPhone уведомления работают только из приложения на экране «Домой»: «Поделиться» → «На экран „Домой“», затем открой Our Days с этой иконки.',
  unsupported: 'Этот браузер не умеет push-уведомления. Попробуй Chrome, Edge, Firefox или Safari.',
};

let notifyStatus = 'unavailable';

async function refreshBell() {
  try {
    notifyStatus = await Push.getStatus();
  } catch (err) {
    notifyStatus = 'unsupported';
  }
  els.bellBtn.hidden = notifyStatus === 'unavailable';
  els.bellBtn.classList.toggle('is-on', notifyStatus === 'on');
  els.bellBtn.title = notifyStatus === 'on' ? 'Уведомления включены' : 'Уведомления';
}

function renderNotifyModal() {
  els.notifyText.textContent = NOTIFY_TEXTS[notifyStatus] || '';
  els.notifyOn.hidden = notifyStatus !== 'off';
  els.notifyTest.hidden = notifyStatus !== 'on';
  els.notifyOff.hidden = notifyStatus !== 'on';
}

async function openNotify() {
  await refreshBell();
  renderNotifyModal();
  openModal(els.notifyModal, null);
}

/** Вызывается прямо из нажатия — иначе iPhone не покажет запрос разрешения. */
function enableNotifications() {
  els.notifyOn.disabled = true;
  Push.enable()
    .then(() => showToast('Уведомления включены'))
    .catch((err) => {
      if (err.code !== 'denied') showToast('Не получилось включить уведомления');
    })
    .finally(async () => {
      els.notifyOn.disabled = false;
      await refreshBell();
      renderNotifyModal();
    });
}

async function disableNotifications() {
  await Push.disable().catch(() => {});
  await refreshBell();
  renderNotifyModal();
  showToast('Уведомления на этом устройстве выключены');
}

async function testNotifications() {
  els.notifyTest.disabled = true;
  try {
    const res = await Push.test();
    showToast(res.sent ? 'Тестовое уведомление отправлено' : 'Нет подписанных устройств');
  } catch (err) {
    showToast('Сервер уведомлений не отвечает');
  } finally {
    els.notifyTest.disabled = false;
  }
}

// ---------- Синхронизация ----------

function updateBadge() {
  if (!Api.isConfigured()) {
    els.modeBadge.hidden = false;
    els.modeBadge.textContent = 'локально';
    els.modeBadge.title = 'Supabase не настроен: данные хранятся только в этом браузере';
    els.modeBadge.classList.remove('is-offline');
    return;
  }
  els.modeBadge.hidden = !state.offline;
  els.modeBadge.textContent = 'нет связи';
  els.modeBadge.title = 'Показываю сохранённое, синхронизирую, когда появится интернет';
  els.modeBadge.classList.add('is-offline');
}

/** Подтягивает изменения второго человека для видимого месяца. */
async function syncNow() {
  if (!Api.isConfigured() || !Api.hasSession() || syncing) return;
  syncing = true;
  const grid = DateUtils.monthGrid(state.cursor);
  try {
    await Tasks.sync(DateUtils.toKey(grid[0]), DateUtils.toKey(grid[grid.length - 1]));
    state.offline = false;
  } catch (err) {
    if (err.status !== 401) state.offline = true;
  } finally {
    syncing = false;
    updateBadge();
  }
}

/** Имена и цвета из таблицы members + какой «слот» у текущего пользователя. */
function applyMembers(rows) {
  rows.forEach((row) => {
    if (row.slot === 'a' || row.slot === 'b') {
      state.members[row.slot] = { name: row.name, color: row.color || CONFIG.DEFAULT_MEMBERS[row.slot].color };
    }
  });
  const me = rows.find((row) => row.user_id === Api.userId());
  state.mySlot = me ? me.slot : null;
}

async function loadMembers() {
  const cached = readStored(MEMBERS_KEY, null);
  if (Array.isArray(cached)) applyMembers(cached);
  try {
    const rows = await Api.fetchMembers();
    applyMembers(rows);
    writeStored(MEMBERS_KEY, rows);
  } catch (err) { /* остаёмся на кеше или именах по умолчанию */ }
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && !DragState.active) syncNow();
  }, CONFIG.SYNC_INTERVAL);
}

async function logout() {
  clearInterval(pollTimer);
  await Api.signOut();
  Tasks.clear();
  try { localStorage.removeItem(MEMBERS_KEY); } catch (err) { /* ничего */ }
  state.members = { ...CONFIG.DEFAULT_MEMBERS };
  state.mySlot = null;
  closeSheet();
  els.app.hidden = true;
  Gate.show();
}

// ---------- Обработчики ----------

function bindUI() {
  els.prevBtn.addEventListener('click', () => navigate(-1));
  els.nextBtn.addEventListener('click', () => navigate(1));
  els.todayBtn.addEventListener('click', goToday);
  els.viewBtns.forEach((btn) => btn.addEventListener('click', () => setView(btn.dataset.view)));
  els.addBtn.addEventListener('click', () => openCreate());
  els.panelAdd.addEventListener('click', () => openCreate());
  els.panelClose.addEventListener('click', closeSheet);
  els.backdrop.addEventListener('click', closeSheet);
  els.logoutBtn.addEventListener('click', logout);
  els.bellBtn.addEventListener('click', openNotify);
  els.notifyOn.addEventListener('click', enableNotifications);
  els.notifyOff.addEventListener('click', disableNotifications);
  els.notifyTest.addEventListener('click', testNotifications);
  els.fRemind.addEventListener('change', () => {
    remindTouched = true;
    updateRemindHint();
  });
  els.fTime.addEventListener('input', () => {
    // Указали время в новой задаче — предлагаем напоминание за 15 минут
    if (!remindTouched && !state.editingId) els.fRemind.value = els.fTime.value ? '15' : '';
    updateRemindHint();
  });

  els.taskForm.addEventListener('submit', handleFormSubmit);
  els.fDelete.addEventListener('click', () => askDelete(state.editingId));
  els.confirmOk.addEventListener('click', confirmDelete);
  document.querySelectorAll('[data-close]').forEach((el) => {
    el.addEventListener('click', () => closeModal(el.closest('.modal')));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!els.confirmModal.hidden) closeModal(els.confirmModal);
      else if (!els.notifyModal.hidden) closeModal(els.notifyModal);
      else if (!els.taskModal.hidden) closeModal(els.taskModal);
      else closeSheet();
      return;
    }
    // Стрелки листают, если фокус не в поле ввода
    const typing = e.target.closest && e.target.closest('input, textarea, select');
    if (typing || anyModalOpen() || els.app.hidden) return;
    if (e.key === 'ArrowLeft' && e.altKey) navigate(-1);
    if (e.key === 'ArrowRight' && e.altKey) navigate(1);
  });

  // Свайп влево/вправо по календарю на мобилке — соседний месяц/день
  let touchStart = null;
  els.calendar.addEventListener('touchstart', (e) => {
    touchStart = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, blocked: false } : null;
  }, { passive: true });
  els.calendar.addEventListener('touchmove', () => {
    if (touchStart && DragState.active) touchStart.blocked = true;
  }, { passive: true });
  els.calendar.addEventListener('touchend', (e) => {
    if (!touchStart || touchStart.blocked || DragState.active || !isMobile()) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 50) navigate(dx < 0 ? 1 : -1);
  });

  // Свайп панели вниз — закрыть
  let sheetY = null;
  els.panel.addEventListener('touchstart', (e) => {
    sheetY = e.target.closest('.panel__head, .panel__grip') ? e.touches[0].clientY : null;
  }, { passive: true });
  els.panel.addEventListener('touchend', (e) => {
    if (sheetY !== null && e.changedTouches[0].clientY - sheetY > 60) closeSheet();
    sheetY = null;
  });

  mobileQuery.addEventListener('change', () => {
    if (!isMobile()) closeSheet();
    render();
  });

  // Перерисовать отложенное после перетаскивания
  window.addEventListener('pointerup', () => {
    setTimeout(() => { if (pendingRender) render(); }, 10);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow();
  });
  window.addEventListener('online', syncNow);

  // Линия «сейчас» и смена дня в полночь
  setInterval(() => {
    const today = DateUtils.todayKey();
    if (today !== lastToday) {
      lastToday = today;
      render();
    } else {
      updateNowLine(els.calendar);
    }
  }, 60 * 1000);
}

// ---------- Старт ----------

/** Открыли из уведомления: ?date=YYYY-MM-DD — показываем этот день. */
function applyDateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const date = params.get('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  state.selectedKey = date;
  state.cursor = DateUtils.fromKey(date);
  window.history.replaceState(null, '', window.location.pathname);
}

function startApp() {
  els.app.hidden = false;
  applyDateFromUrl();
  if (!started) {
    started = true;
    bindUI();
    Tasks.onChange(render);
    Tasks.setOnError((err) => {
      if (err.status === 401) return;
      showToast(err.status === 0 ? 'Нет связи — изменение не сохранилось' : 'Не получилось сохранить, попробуй ещё раз');
    });
  }
  els.logoutBtn.hidden = !Api.isConfigured();
  updateBadge();
  render();

  if (Api.isConfigured()) {
    loadMembers().then(render);
    importLocalOnce().then(syncNow, () => {});
    startPolling();
    refreshBell().then(() => Push.refresh()).catch(() => {});
  }
}

/**
 * Если на этом устройстве календарём пользовались в локальном режиме
 * (до подключения Supabase), один раз переносим эти задачи в облако.
 */
async function importLocalOnce() {
  if (readStored('our-days-unlocked', false) !== true) return;
  try {
    const count = await Tasks.importLocal();
    localStorage.removeItem('our-days-unlocked');
    if (count) showToast(`Перенесено в облако задач: ${count}`);
  } catch (err) {
    // Не вышло (нет сети) — попробуем при следующем запуске, кеш не трогаем
    state.offline = true;
    updateBadge();
    throw err;
  }
}

Api.setOnAuthLost(() => {
  clearInterval(pollTimer);
  closeSheet();
  els.app.hidden = true;
  showToast('Сессия закончилась — войди заново');
  Gate.show();
});

Gate.init(startApp);
