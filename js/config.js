/**
 * config.js — настройки.
 *
 * Пока SUPABASE_URL и SUPABASE_ANON_KEY пустые, календарь работает
 * в локальном режиме: данные только в этом браузере, вход по коду LOCAL_CODE.
 * Когда ключи заполнены — общий календарь через Supabase с настоящим входом.
 *
 * Anon/publishable-ключ публичный по замыслу Supabase: данные защищают
 * политики RLS из supabase/schema.sql, а не секретность ключа.
 */
const CONFIG = {
  SUPABASE_URL: 'https://xspsngqfsgxcaowfdrqf.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_E2gxrM5W3mbzMOWtPngr2w_tXa1UThr',

  // Только для локального режима. Это декорация, а не защита.
  LOCAL_CODE: '520',

  // Имена и цвета по умолчанию. В облачном режиме берутся из таблицы members.
  DEFAULT_MEMBERS: {
    a: { name: 'Я', color: '#E8799A' },
    b: { name: 'Ты', color: '#F0A27E' },
  },
  BOTH: { name: 'Вместе', color: '#B39CDB' },

  // Публичный VAPID-ключ для push-уведомлений (приватный — только в секретах Supabase)
  VAPID_PUBLIC_KEY: 'BJZkPaDfgEfjBr45NaJE1eO7kiND8AG9OUAdY25iXaYkC9jhjVIVq3IrBFtvEeD-5dNKa-yiRZTJ9HUwW47uSc4',

  // Как часто подтягивать изменения второго человека (мс)
  SYNC_INTERVAL: 20000,
};
