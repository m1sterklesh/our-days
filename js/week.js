/**
 * week.js — сетка часов: неделя (десктоп) или один день (мобилка).
 * Задачи со временем — блоки по часам, без времени — в строке «весь день».
 * Блоки можно таскать (другой день / время, шаг 15 минут) и растягивать за низ.
 */

const HOUR_PX = 48;
const SNAP_MIN = 15;
const DEFAULT_DURATION = 60;
const DAY_MIN = 24 * 60;

const snap = (min) => Math.round(min / SNAP_MIN) * SNAP_MIN;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const minToPx = (min) => (min / 60) * HOUR_PX;

/** Минуты от начала дня по координате курсора внутри колонки. */
function minutesAt(col, clientY) {
  const y = clientY - col.getBoundingClientRect().top;
  return (y / HOUR_PX) * 60;
}

/** Начало и конец задачи в минутах. */
function taskSpan(task) {
  const start = TimeUtils.toMin(task.time);
  let end = task.endTime ? TimeUtils.toMin(task.endTime) : start + DEFAULT_DURATION;
  if (end <= start) end = start + SNAP_MIN;
  return { start, end: Math.min(end, DAY_MIN) };
}

/**
 * Раскладка пересекающихся задач: каждая получает колонку и общее число колонок в группе,
 * чтобы блоки вставали рядом, а не друг на друга.
 */
function layoutDay(tasks) {
  const items = tasks
    .map((task) => ({ task, ...taskSpan(task) }))
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const groups = [];
  let group = [];
  let groupEnd = -1;
  items.forEach((item) => {
    if (group.length && item.start >= groupEnd) {
      groups.push(group);
      group = [];
      groupEnd = -1;
    }
    group.push(item);
    groupEnd = Math.max(groupEnd, item.end);
  });
  if (group.length) groups.push(group);

  groups.forEach((g) => {
    const colEnds = [];
    g.forEach((item) => {
      let col = colEnds.findIndex((end) => end <= item.start);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(0);
      }
      colEnds[col] = item.end;
      item.col = col;
    });
    g.forEach((item) => { item.cols = colEnds.length; });
  });
  return items;
}

/**
 * Отрисовывает сетку часов.
 * @param {HTMLElement} root
 * @param {{
 *   days: Date[], selectedKey: string, todayKey: string,
 *   getTasks: (key: string) => object[], colorOf: (owner: string) => string,
 *   onSelectDay: (key: string) => void,
 *   onTaskClick: (id: string) => void,
 *   onTaskChange: (id: string, patch: object) => void,
 *   onCreate: (draft: { date: string, time?: string, endTime?: string }) => void,
 *   onCancel: () => void,
 * }} o
 */
function renderTimeGrid(root, o) {
  const oldScroll = root.querySelector('.tg__scroll');
  const prevScrollTop = oldScroll ? oldScroll.scrollTop : null;

  const grid = document.createElement('div');
  grid.className = `tg${o.days.length === 1 ? ' tg--day' : ''}`;
  grid.style.setProperty('--days', o.days.length);

  const head = document.createElement('div');
  head.className = 'tg__head';
  head.appendChild(document.createElement('div'));

  const allday = document.createElement('div');
  allday.className = 'tg__allday';
  const alldayLabel = document.createElement('div');
  alldayLabel.className = 'tg__allday-label';
  alldayLabel.textContent = 'весь день';
  allday.appendChild(alldayLabel);

  const scroll = document.createElement('div');
  scroll.className = 'tg__scroll';
  const body = document.createElement('div');
  body.className = 'tg__body';

  const times = document.createElement('div');
  times.className = 'tg__times';
  for (let h = 1; h < 24; h++) {
    const label = document.createElement('span');
    label.className = 'tg__time';
    label.style.top = `${h * HOUR_PX}px`;
    label.textContent = `${String(h).padStart(2, '0')}:00`;
    times.appendChild(label);
  }
  body.appendChild(times);

  const ctx = { o, scroll };

  o.days.forEach((date) => {
    const key = DateUtils.toKey(date);
    const tasks = o.getTasks(key);

    // Заголовок дня
    const dh = document.createElement('button');
    dh.type = 'button';
    dh.className = 'tg__dayhead';
    dh.dataset.date = key;
    if (key === o.todayKey) dh.classList.add('is-today');
    if (key === o.selectedKey) dh.classList.add('is-selected');
    dh.setAttribute('aria-label', DateUtils.dayTitle(date));
    const wd = document.createElement('span');
    wd.className = 'tg__wd';
    wd.textContent = WEEKDAYS_SHORT[DateUtils.weekdayIndex(date)];
    const num = document.createElement('span');
    num.className = 'tg__num';
    num.textContent = date.getDate();
    dh.append(wd, num);
    dh.addEventListener('click', () => o.onSelectDay(key));
    head.appendChild(dh);

    // «Весь день»
    const cell = document.createElement('div');
    cell.className = 'tg__allday-cell';
    cell.dataset.date = key;
    tasks.filter((t) => !t.time).forEach((task) => cell.appendChild(createAlldayChip(task, ctx)));
    cell.addEventListener('click', (e) => {
      if (e.target === cell && !DragState.active) o.onCreate({ date: key });
    });
    allday.appendChild(cell);

    // Колонка часов
    const col = document.createElement('div');
    col.className = 'tg__col';
    col.dataset.date = key;
    if (key === o.todayKey) {
      col.classList.add('is-today');
      const now = document.createElement('div');
      now.className = 'tg__now';
      col.appendChild(now);
    }
    layoutDay(tasks.filter((t) => t.time)).forEach((item) => col.appendChild(createEvent(item, ctx)));
    attachCreateDrag(col, key, ctx);
    body.appendChild(col);
  });

  scroll.appendChild(body);
  grid.append(head, allday, scroll);
  root.replaceChildren(grid);

  // Выравниваем шапку с колонками с учётом ширины полосы прокрутки
  grid.style.setProperty('--sb', `${scroll.offsetWidth - scroll.clientWidth}px`);
  // При первой отрисовке — к 8 утра, дальше сохраняем позицию
  scroll.scrollTop = prevScrollTop !== null ? prevScrollTop : 8 * HOUR_PX - 12;
  updateNowLine(root);
}

/** Сдвигает линию «сейчас». */
function updateNowLine(root) {
  const now = new Date();
  root.querySelectorAll('.tg__now').forEach((line) => {
    line.style.top = `${minToPx(now.getHours() * 60 + now.getMinutes())}px`;
  });
}

/** Блок задачи в сетке. */
function createEvent(item, ctx) {
  const { task } = item;
  const ev = document.createElement('div');
  ev.className = 'ev';
  ev.dataset.id = task.id;
  ev.style.setProperty('--c', ctx.o.colorOf(task.owner));
  ev.style.top = `${minToPx(item.start)}px`;
  ev.style.height = `${Math.max(minToPx(item.end - item.start) - 2, 18)}px`;
  ev.style.left = `calc(${(item.col / item.cols) * 100}% + 2px)`;
  ev.style.width = `calc(${100 / item.cols}% - 5px)`;
  if (task.done) ev.classList.add('is-done');
  if (item.end - item.start <= 30) ev.classList.add('is-short');

  const title = document.createElement('div');
  title.className = 'ev__title';
  title.textContent = task.title;
  const time = document.createElement('div');
  time.className = 'ev__time';
  time.textContent = `${TimeUtils.fromMin(item.start)}–${TimeUtils.fromMin(item.end)}`;
  const handle = document.createElement('div');
  handle.className = 'ev__resize';
  ev.append(title, time, handle);

  attachMoveDrag(ev, item, time, ctx);
  attachResizeDrag(ev, handle, item, time, ctx);
  return ev;
}

/** Перенос блока: по времени, на другой день или в «весь день». */
function attachMoveDrag(ev, item, timeLabel, ctx) {
  const duration = item.end - item.start;
  let grabOffset = 0;
  let target = null;
  let dropCell = null;

  makeDraggable(ev, {
    onClick: () => ctx.o.onTaskClick(item.task.id),
    onStart: (e) => {
      grabOffset = e.clientY - ev.getBoundingClientRect().top;
      ev.classList.add('is-dragging');
    },
    onMove: (e) => {
      autoScroll(ctx.scroll, e.clientY);
      if (dropCell) dropCell.classList.remove('is-drop');
      dropCell = null;

      const cell = hitTest(e.clientX, e.clientY, '.tg__allday-cell');
      if (cell) {
        // Над строкой «весь день» — задача потеряет время
        dropCell = cell;
        cell.classList.add('is-drop');
        ev.classList.add('is-ghosted');
        target = { date: cell.dataset.date, allday: true };
        return;
      }
      const col = hitTest(e.clientX, e.clientY, '.tg__col');
      if (!col) return;
      ev.classList.remove('is-ghosted');
      const start = clamp(snap(minutesAt(col, e.clientY - grabOffset)), 0, DAY_MIN - duration);
      if (ev.parentElement !== col) col.appendChild(ev);
      ev.style.top = `${minToPx(start)}px`;
      ev.style.left = '2px';
      ev.style.width = 'calc(100% - 5px)';
      timeLabel.textContent = `${TimeUtils.fromMin(start)}–${TimeUtils.fromMin(start + duration)}`;
      target = { date: col.dataset.date, start };
    },
    onEnd: (e, cancelled) => {
      if (dropCell) dropCell.classList.remove('is-drop');
      const t = target;
      target = null;
      if (cancelled || !t) return ctx.o.onCancel();
      if (t.allday) {
        return ctx.o.onTaskChange(item.task.id, { date: t.date, time: null, endTime: null });
      }
      if (t.date === item.task.date && t.start === item.start) return ctx.o.onCancel();
      ctx.o.onTaskChange(item.task.id, {
        date: t.date,
        time: TimeUtils.fromMin(t.start),
        endTime: TimeUtils.fromMin(t.start + duration),
      });
    },
  });
}

/** Растягивание за нижний край — меняет время окончания. */
function attachResizeDrag(ev, handle, item, timeLabel, ctx) {
  let newEnd = null;

  makeDraggable(handle, {
    onStart: () => ev.classList.add('is-resizing'),
    onMove: (e) => {
      autoScroll(ctx.scroll, e.clientY);
      const col = ev.parentElement;
      newEnd = clamp(snap(minutesAt(col, e.clientY)), item.start + SNAP_MIN, DAY_MIN);
      ev.style.height = `${minToPx(newEnd - item.start) - 2}px`;
      timeLabel.textContent = `${TimeUtils.fromMin(item.start)}–${TimeUtils.fromMin(newEnd)}`;
    },
    onEnd: (e, cancelled) => {
      const end = newEnd;
      newEnd = null;
      if (cancelled || end === null || end === item.end) return ctx.o.onCancel();
      ctx.o.onTaskChange(item.task.id, { endTime: TimeUtils.fromMin(end) });
    },
  });
}

/** Клик по пустому месту — задача на час; протяжка — задача на выделенный отрезок. */
function attachCreateDrag(col, key, ctx) {
  let anchor = 0;
  let range = null;
  let ghost = null;

  const draw = (start, end) => {
    ghost.style.top = `${minToPx(start)}px`;
    ghost.style.height = `${minToPx(end - start) - 2}px`;
    ghost.textContent = `${TimeUtils.fromMin(start)}–${TimeUtils.fromMin(end)}`;
    range = { start, end };
  };

  makeDraggable(col, {
    filter: (e) => e.target === col,
    onClick: (e) => {
      const start = clamp(Math.floor(minutesAt(col, e.clientY) / 30) * 30, 0, DAY_MIN - 30);
      ctx.o.onCreate({
        date: key,
        time: TimeUtils.fromMin(start),
        endTime: TimeUtils.fromMin(Math.min(start + DEFAULT_DURATION, DAY_MIN)),
      });
    },
    onStart: (e) => {
      anchor = clamp(Math.floor(minutesAt(col, e.clientY) / SNAP_MIN) * SNAP_MIN, 0, DAY_MIN - SNAP_MIN);
      ghost = document.createElement('div');
      ghost.className = 'ev ev--ghost';
      col.appendChild(ghost);
      draw(anchor, anchor + SNAP_MIN * 2);
    },
    onMove: (e) => {
      autoScroll(ctx.scroll, e.clientY);
      const m = clamp(snap(minutesAt(col, e.clientY)), 0, DAY_MIN);
      draw(Math.min(anchor, m), Math.max(anchor + SNAP_MIN, m));
    },
    onEnd: (e, cancelled) => {
      if (ghost) ghost.remove();
      ghost = null;
      if (cancelled || !range) return;
      ctx.o.onCreate({ date: key, time: TimeUtils.fromMin(range.start), endTime: TimeUtils.fromMin(range.end) });
      range = null;
    },
  });
}

/** Чип задачи без времени; его можно перенести на другой день или в сетку часов. */
function createAlldayChip(task, ctx) {
  const chip = document.createElement('div');
  chip.className = 'chip-ev';
  chip.dataset.id = task.id;
  chip.style.setProperty('--c', ctx.o.colorOf(task.owner));
  if (task.done) chip.classList.add('is-done');
  chip.textContent = task.title;

  let ghost = null;
  let target = null;
  let marked = null;

  makeDraggable(chip, {
    onClick: () => ctx.o.onTaskClick(task.id),
    onStart: () => {
      ghost = createGhost(chip);
      chip.classList.add('is-dragging');
    },
    onMove: (e) => {
      ghost.move(e.clientX, e.clientY);
      autoScroll(ctx.scroll, e.clientY);
      if (marked) marked.classList.remove('is-drop');
      marked = null;
      const cell = hitTest(e.clientX, e.clientY, '.tg__allday-cell');
      if (cell) {
        marked = cell;
        cell.classList.add('is-drop');
        target = { date: cell.dataset.date, allday: true };
        return;
      }
      const col = hitTest(e.clientX, e.clientY, '.tg__col');
      if (col) {
        const start = clamp(snap(minutesAt(col, e.clientY)), 0, DAY_MIN - DEFAULT_DURATION);
        target = { date: col.dataset.date, start };
      }
    },
    onEnd: (e, cancelled) => {
      ghost.remove();
      chip.classList.remove('is-dragging');
      if (marked) marked.classList.remove('is-drop');
      const t = target;
      target = null;
      if (cancelled || !t) return;
      if (t.allday) {
        if (t.date !== task.date) ctx.o.onTaskChange(task.id, { date: t.date });
        return;
      }
      ctx.o.onTaskChange(task.id, {
        date: t.date,
        time: TimeUtils.fromMin(t.start),
        endTime: TimeUtils.fromMin(t.start + DEFAULT_DURATION),
      });
    },
  });
  return chip;
}
