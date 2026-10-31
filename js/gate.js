/**
 * gate.js — «дверь» перед календарём.
 *
 * Локальный режим (Supabase не настроен): один секретный код из CONFIG.LOCAL_CODE.
 * ВНИМАНИЕ: в локальном режиме это только фронтовая заглушка для атмосферы,
 * а не реальная защита — код виден любому, кто откроет исходники.
 *
 * Облачный режим: та же «дверь», но внутри настоящий вход Supabase (почта + пароль).
 * Данные защищены на сервере политиками RLS, без входа их не получить.
 */
const Gate = (() => {
  const UNLOCK_KEY = 'our-days-unlocked';

  const els = {
    gate: document.getElementById('gate'),
    form: document.getElementById('gate-form'),
    local: document.getElementById('gate-local'),
    remote: document.getElementById('gate-remote'),
    code: document.getElementById('gate-code'),
    email: document.getElementById('gate-email'),
    password: document.getElementById('gate-password'),
    btn: document.getElementById('gate-btn'),
    error: document.getElementById('gate-error'),
  };

  let onUnlock = () => {};

  function isLocallyUnlocked() {
    try {
      return localStorage.getItem(UNLOCK_KEY) === 'true';
    } catch (err) {
      return false;
    }
  }

  /** Трясём карточку и очищаем поле. */
  function reject(message, field) {
    els.error.textContent = message;
    els.form.classList.remove('is-shaking');
    void els.form.offsetWidth; // перезапуск анимации
    els.form.classList.add('is-shaking');
    if (field) {
      field.value = '';
      field.focus();
    }
  }

  /** Плавно убираем оверлей. */
  function open() {
    els.gate.classList.add('is-leaving');
    setTimeout(() => {
      els.gate.hidden = true;
      els.gate.classList.remove('is-leaving');
    }, 600);
    onUnlock();
  }

  function show() {
    const remote = Api.isConfigured();
    els.local.hidden = remote;
    els.remote.hidden = !remote;
    els.error.textContent = '';
    els.gate.hidden = false;
    els.gate.classList.remove('is-leaving');
    setTimeout(() => (remote ? els.email : els.code).focus(), 50);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    els.error.textContent = '';

    if (!Api.isConfigured()) {
      // Фронтовая проверка кода — НЕ защита, см. комментарий вверху
      if (els.code.value.trim() === CONFIG.LOCAL_CODE) {
        try { localStorage.setItem(UNLOCK_KEY, 'true'); } catch (err) { /* ничего */ }
        open();
      } else {
        reject('Не тот код… попробуй ещё', els.code);
      }
      return;
    }

    const email = els.email.value.trim();
    const password = els.password.value;
    if (!email || !password) {
      reject('Нужны и почта, и пароль', email ? els.password : els.email);
      return;
    }

    els.btn.disabled = true;
    els.btn.textContent = 'Открываю…';
    try {
      await Api.signIn(email, password);
      els.password.value = '';
      open();
    } catch (err) {
      if (err.status === 0) reject('Нет связи. Проверь интернет', null);
      else reject('Не то… попробуй ещё', els.password);
    } finally {
      els.btn.disabled = false;
      els.btn.textContent = 'Войти';
    }
  }

  /**
   * Показывает дверь, если нужно, и вызывает callback, когда можно входить.
   * @param {() => void} callback
   */
  function init(callback) {
    onUnlock = callback;
    els.form.addEventListener('submit', handleSubmit);

    if (Api.isConfigured()) {
      // Сессия есть — пускаем сразу (если токен протух, api.js попросит войти заново)
      if (Api.hasSession()) return onUnlock();
    } else if (isLocallyUnlocked()) {
      return onUnlock();
    }
    show();
  }

  return { init, show };
})();
