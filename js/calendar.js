/**
 * calendar.js — работа с датами и отрисовка месячной сетки.
 * Все даты-ключи в формате YYYY-MM-DD, неделя начинается с понедельника.
 */

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WEEKDAYS_FULL = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];

const DateUtils = {
  /** Date → "2026-11-01" (по местному времени, не UTC). */
  toKey(d) {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  },

  /** "2026-11-01" → Date (полночь по местному времени). */
  fromKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  },

  todayKey() {
    return DateUtils.toKey(new Date());
  },

  addDays(date, n) {
    const r = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    r.setDate(r.getDate() + n);
    return r;
  },

  /** Сколько дней в месяце: нулевой день следующего месяца = последний день текущего. */
  daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  },

  /** Номер дня недели, где 0 — понедельник (getDay() считает с воскресенья). */
  weekdayIndex(date) {
    return (date.getDay() + 6) % 7;
  },

  startOfWeek(date) {
    return DateUtils.addDays(date, -DateUtils.weekdayIndex(date));
  },

  /** Дни, которые видны в сетке месяца: с понедельника первой недели до воскресенья последней. */
  monthGrid(viewDate) {
    const y = viewDate.getFullYear();
    const m = viewDate.getMonth();
    const first = new Date(y, m, 1);
    const offset = DateUtils.weekdayIndex(first);
    const rows = Math.ceil((offset + DateUtils.daysInMonth(y, m)) / 7);
    const start = DateUtils.addDays(first, -offset);
    return Array.from({ length: rows * 7 }, (_, i) => DateUtils.addDays(start, i));
  },

  monthTitle(date) {
    return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  },

  /** «среда, 4 ноября» */
  dayTitle(date) {
    return `${WEEKDAYS_FULL[DateUtils.weekdayIndex(date)]}, ${date.getDate()} ${MONTHS_GEN[date.getMonth()]}`;
  },

  /** «4 ноября» */
  dayShort(date) {
    return `${date.getDate()} ${MONTHS_GEN[date.getMonth()]}`;
  },
};

const TimeUtils = {
  /** "09:30" → 570 */
  toMin(t) {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  },

  /** 570 → "09:30"; конец дня ограничиваем 23:59 */
  fromMin(min) {
    const m = Math.max(0, Math.min(min, 1439));
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  },

  /** Подпись времени задачи: «09:00», «09:00–10:30» или пусто. */
  range(task) {
    if (!task.time) return '';
    return task.endTime ? `${task.time}–${task.endTime}` : task.time;
  },
};

/**
 * Отрисовывает месяц.
 * @param {HTMLElement} root
 * @param {{
 *   viewDate: Date, selectedKey: string, todayKey: string,
 *   getTasks: (key: string) => object[], colorOf: (owner: string) => string,
 *   onSelect: (key: string) => void, onCreate: (key: string) => void,
 *   onTaskClick: (id: string) => void, onTaskMove: (id: string, key: string) => void,
 * }} o
 */
function renderMonth(root, o) {
  const month = o.viewDate.getMonth();
  const wrap = document.createElement('div');
  wrap.className = 'month';

  const head = document.createElement('div');
  head.className = 'month__weekdays';
  WEEKDAYS_SHORT.forEach((name) => {
    const cell = document.createElement('div');
    cell.className = 'month__weekday';
    cell.textContent = name;
    head.appendChild(cell);
  });

  const grid = document.createElement('div');
  grid.className = 'month__grid';

  DateUtils.monthGrid(o.viewDate).forEach((date) => {
    const key = DateUtils.toKey(date);
    const tasks = o.getTasks(key);

    const cell = document.createElement('div');
    cell.className = 'day';
    cell.dataset.date = key;
    cell.tabIndex = 0;
    cell.setAttribute('role', 'button');
    cell.setAttribute('aria-label', `${DateUtils.dayTitle(date)}${tasks.length ? `, задач: ${tasks.length}` : ''}`);
    if (date.getMonth() !== month) cell.classList.add('is-other');
    if (key === o.todayKey) cell.classList.add('is-today');
    if (key === o.selectedKey) cell.classList.add('is-selected');

    const num = document.createElement('span');
    num.className = 'day__num';
    num.textContent = date.getDate();
    cell.appendChild(num);

    // Десктоп: до 3 «пилюль» с названиями, как в Google
    const pills = document.createElement('div');
    pills.className = 'day__pills';
    tasks.slice(0, 3).forEach((task) => pills.appendChild(createPill(task, o)));
    cell.appendChild(pills);
    if (tasks.length > 3) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'day__more';
      more.textContent = `ещё ${tasks.length - 3}`;
      cell.appendChild(more);
    }

    // Мобилка: до 3 точек, если больше — «+»
    const dots = document.createElement('div');
    dots.className = 'day__dots';
    tasks.slice(0, 3).forEach((task) => {
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.setProperty('--c', o.colorOf(task.owner));
      dots.appendChild(dot);
    });
    if (tasks.length > 3) {
      const plus = document.createElement('span');
      plus.className = 'day__plus';
      plus.textContent = '+';
      dots.appendChild(plus);
    }
    cell.appendChild(dots);

    cell.addEventListener('click', (e) => {
      if (e.target.closest('.pill')) return;
      o.onSelect(key);
    });
    cell.addEventListener('dblclick', (e) => {
      if (e.target.closest('.pill, .day__more')) return;
      o.onCreate(key);
    });
    cell.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        o.onSelect(key);
      }
    });

    grid.appendChild(cell);
  });

  wrap.append(head, grid);
  root.replaceChildren(wrap);
}

/** «Пилюля» задачи в ячейке месяца; её можно перетащить на другой день. */
function createPill(task, o) {
  const pill = document.createElement('div');
  pill.className = 'pill';
  pill.dataset.id = task.id;
  pill.style.setProperty('--c', o.colorOf(task.owner));
  if (task.done) pill.classList.add('is-done');

  if (task.time) {
    const time = document.createElement('span');
    time.className = 'pill__time';
    time.textContent = task.time;
    pill.appendChild(time);
  }
  const text = document.createElement('span');
  text.className = 'pill__text';
  text.textContent = task.title;
  pill.appendChild(text);

  let ghost = null;
  let target = null;

  makeDraggable(pill, {
    onClick: () => o.onTaskClick(task.id),
    onStart: () => {
      ghost = createGhost(pill);
      pill.classList.add('is-dragging');
    },
    onMove: (e) => {
      ghost.move(e.clientX, e.clientY);
      const cell = hitTest(e.clientX, e.clientY, '.day');
      if (target && target !== cell) target.classList.remove('is-drop');
      if (cell) cell.classList.add('is-drop');
      target = cell;
    },
    onEnd: (e, cancelled) => {
      ghost.remove();
      pill.classList.remove('is-dragging');
      if (target) target.classList.remove('is-drop');
      const key = target && target.dataset.date;
      target = null;
      if (!cancelled && key && key !== task.date) o.onTaskMove(task.id, key);
    },
  });

  return pill;
}
