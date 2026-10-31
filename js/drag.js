/**
 * drag.js — универсальное перетаскивание на Pointer Events.
 *
 * Мышь: перетаскивание начинается после сдвига на 4px, иначе это клик.
 * Палец: нужно подержать ~0.4 сек (долгое нажатие), иначе это обычный
 * скролл или тап — так перетаскивание не мешает листать календарь.
 */
const DragState = { active: false };

// Пока что-то тащим пальцем — запрещаем странице скроллиться
document.addEventListener('touchmove', (e) => {
  if (DragState.active) e.preventDefault();
}, { passive: false });

/**
 * Делает элемент перетаскиваемым.
 * @param {HTMLElement} el
 * @param {{
 *   onStart?: (e: PointerEvent) => void,
 *   onMove?: (e: PointerEvent) => void,
 *   onEnd?: (e: PointerEvent, cancelled: boolean) => void,
 *   onClick?: (e: PointerEvent) => void,
 *   filter?: (e: PointerEvent) => boolean,
 *   longPressMs?: number,
 * }} opts
 */
function makeDraggable(el, opts) {
  const { onStart, onMove, onEnd, onClick, filter, longPressMs = 400 } = opts;

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (filter && !filter(e)) return;
    // Вложенные перетаскиваемые (ручка ресайза внутри события) не должны будить родителя
    e.stopPropagation();

    const isTouch = e.pointerType === 'touch';
    const pointerId = e.pointerId;
    const sx = e.clientX;
    const sy = e.clientY;
    let dragging = false;
    let cancelled = false;
    const downEvent = e; // точка нажатия — от неё считаем смещение захвата
    let lastEvent = e;
    let timer = null;

    function start() {
      dragging = true;
      DragState.active = true;
      try { el.setPointerCapture(pointerId); } catch (err) { /* не критично */ }
      if (isTouch && navigator.vibrate) navigator.vibrate(12);
      if (onStart) onStart(downEvent);
      if (onMove) onMove(lastEvent);
    }

    function cleanup() {
      clearTimeout(timer);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleCancel);
      if (dragging) {
        dragging = false;
        // Сбрасываем на следующем тике, чтобы клик после отпускания не сработал
        setTimeout(() => { DragState.active = false; }, 0);
      }
    }

    function handleMove(ev) {
      if (ev.pointerId !== pointerId) return;
      lastEvent = ev;
      const dist = Math.hypot(ev.clientX - sx, ev.clientY - sy);
      if (!dragging) {
        if (isTouch) {
          // Палец поехал до долгого нажатия — это скролл, не мешаем
          if (dist > 10) { cancelled = true; cleanup(); }
          return;
        }
        if (dist < 4) return;
        start();
        return;
      }
      if (onMove) onMove(ev);
    }

    function handleUp(ev) {
      if (ev.pointerId !== pointerId) return;
      const wasDragging = dragging;
      cleanup();
      if (wasDragging) {
        if (onEnd) onEnd(ev, false);
      } else if (!cancelled && onClick) {
        onClick(ev);
      }
    }

    function handleCancel(ev) {
      if (ev.pointerId !== pointerId) return;
      const wasDragging = dragging;
      cleanup();
      if (wasDragging && onEnd) onEnd(ev, true);
    }

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleCancel);
    if (isTouch) timer = setTimeout(() => { if (!cancelled) start(); }, longPressMs);
  });

  // Долгое нажатие не должно открывать системное меню
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

/**
 * «Призрак» — копия элемента, которая едет за курсором между ячейками.
 * @param {HTMLElement} source
 * @returns {{ move: (x: number, y: number) => void, remove: () => void }}
 */
function createGhost(source) {
  const rect = source.getBoundingClientRect();
  const ghost = source.cloneNode(true);
  ghost.classList.remove('is-dragging');
  ghost.classList.add('drag-ghost');
  ghost.style.width = `${Math.max(rect.width, 90)}px`;
  document.body.appendChild(ghost);
  return {
    move(x, y) {
      ghost.style.left = `${x + 8}px`;
      ghost.style.top = `${y + 8}px`;
    },
    remove() {
      ghost.remove();
    },
  };
}

/**
 * Автопрокрутка контейнера, когда тащим у его верхнего/нижнего края.
 * @param {HTMLElement} scrollEl
 * @param {number} clientY
 */
function autoScroll(scrollEl, clientY) {
  if (!scrollEl) return;
  const r = scrollEl.getBoundingClientRect();
  const edge = 40;
  if (clientY < r.top + edge) scrollEl.scrollTop -= 10;
  else if (clientY > r.bottom - edge) scrollEl.scrollTop += 10;
}

/** Элемент под точкой с подходящим селектором (тащимый элемент должен иметь pointer-events: none). */
function hitTest(x, y, selector) {
  const target = document.elementFromPoint(x, y);
  return target ? target.closest(selector) : null;
}
