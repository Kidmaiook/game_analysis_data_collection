/* ============================================================
   Multi-language support (English, Thai, Spanish, German).

   - Translations live in js/lang/<code>.js, each assigning
     window.GR_LANG.<code> = { key: 'text', ... }.
   - To add a language: copy js/lang/en.js to js/lang/<code>.js,
     translate the values, add a <script> tag for it on every page,
     and add one entry to GR_LANGS below. Nothing else changes.
   - Static HTML uses data-i18n="key" (plain text), data-i18n-html="key"
     (text that contains tags/links) and data-i18n-attr="placeholder:key".
   - JavaScript uses t('key', { name: value }); {name} placeholders are filled in.
   - Missing keys fall back to English, then to the key itself.
   - Switching language reloads the page (simple and bug-free: every chart is
     re-rendered from scratch in the new language).
   ============================================================ */
window.GR_LANG = window.GR_LANG || {};

const GR_LANGS = [
  { code: 'en', label: 'English', locale: 'en-US' },
  { code: 'th', label: '\u0E44\u0E17\u0E22', locale: 'th-TH-u-nu-latn' },
  { code: 'es', label: 'Espa\u00F1ol', locale: 'es-ES' },
  { code: 'de', label: 'Deutsch', locale: 'de-DE' },
];
const LANG_STORAGE_KEY = 'green-room-lang';

function currentLang() {
  const stored = localStorage.getItem(LANG_STORAGE_KEY);
  if (GR_LANGS.some(l => l.code === stored)) return stored;
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return GR_LANGS.some(l => l.code === nav) ? nav : 'en';
}

const __LANG = currentLang();
const __LOCALE = (GR_LANGS.find(l => l.code === __LANG) || GR_LANGS[0]).locale;

function t(key, vars) {
  const dict = window.GR_LANG[__LANG] || {};
  let s = dict[key];
  if (s === undefined) s = (window.GR_LANG.en || {})[key];
  if (s === undefined) s = key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
  return s;
}

/* Locale-aware names for days and months, so Thai/Spanish/German get real
   weekday and month names without maintaining separate lists. */
function localeDayName(englishDay, style = 'long') {
  const idx = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].indexOf(englishDay);
  if (idx < 0) return englishDay;
  return new Date(Date.UTC(2024, 0, 1 + idx)).toLocaleDateString(__LOCALE, { weekday: style, timeZone: 'UTC' });
}
function localeMonthName(monthIndex0) {
  return new Date(Date.UTC(2024, monthIndex0, 1)).toLocaleDateString(__LOCALE, { month: 'long', timeZone: 'UTC' });
}
function localeNumber(n, opts) {
  return Number(n).toLocaleString(__LOCALE, opts);
}

function applyI18n(root) {
  const scope = root || document;
  scope.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-i18n')); });
  scope.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.getAttribute('data-i18n-html')); });
  scope.querySelectorAll('[data-i18n-attr]').forEach(el => {
    el.getAttribute('data-i18n-attr').split(';').forEach(pair => {
      const [attr, key] = pair.split(':').map(s => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    });
  });
  document.documentElement.setAttribute('lang', __LANG);
  const titleKey = document.documentElement.getAttribute('data-title-key');
  if (titleKey) document.title = t(titleKey);
}

function initLanguageControl() {
  const bar = document.querySelector('.topbar');
  if (!bar || document.getElementById('langControl')) return;
  const holder = document.createElement('div');
  holder.id = 'langControl';
  holder.className = 'lang-control';
  holder.innerHTML = `<label class="sr-only" for="langSelect">${t('lang.label')}</label>
    <select id="langSelect" aria-label="${t('lang.label')}">${GR_LANGS.map(l =>
      `<option value="${l.code}"${l.code === __LANG ? ' selected' : ''}>${l.label}</option>`).join('')}</select>`;
  const theme = document.getElementById('themeToggleControl');
  if (theme && theme.parentNode === bar) bar.insertBefore(holder, theme); else bar.appendChild(holder);
  holder.querySelector('select').addEventListener('change', e => {
    localStorage.setItem(LANG_STORAGE_KEY, e.target.value);
    location.reload();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  applyI18n();
  initLanguageControl();
});
