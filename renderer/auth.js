/* =========================================================
   PULSE — Firebase Authentication (email + пароль)
   ---------------------------------------------------------
   1) Создай проект на https://console.firebase.google.com
   2) Authentication → Sign-in method → включи "Email/Password"
   3) Project settings → General → "Your apps" → Web app →
      скопируй объект firebaseConfig и вставь его вместо
      значений ниже.
   4) Готово — npm start, экран входа появится сам.

   Модуль подключён как <script type="module"> и грузит SDK
   прямо с CDN Google (gstatic) — бандлер не нужен. CSP уже
   настроен в index.html под этот домен.
   ========================================================= */

import {
  initializeApp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

// ⬇️ ЗАМЕНИ на конфиг своего проекта из консоли Firebase
const firebaseConfig = {
  apiKey: "AIzaSyBjl3eOTQEQYlHDzgfhDqigMsBHOfatJI4",
  authDomain: "pulse-5ddcf.firebaseapp.com",
  projectId: "pulse-5ddcf",
  storageBucket: "pulse-5ddcf.firebasestorage.app",
  messagingSenderId: "1080541075362",
  appId: "1:1080541075362:web:909f9cb13fb137783b44fb",
  measurementId: "G-T6FYQTBZEE"
};

const isConfigured = firebaseConfig.apiKey && firebaseConfig.apiKey !== "YOUR_API_KEY";

const ERROR_MESSAGES = {
  'auth/email-already-in-use': 'Этот email уже зарегистрирован.',
  'auth/invalid-email': 'Некорректный email.',
  'auth/weak-password': 'Пароль слишком простой (минимум 6 символов).',
  'auth/user-not-found': 'Пользователь с таким email не найден.',
  'auth/wrong-password': 'Неверный пароль.',
  'auth/invalid-credential': 'Неверный email или пароль.',
  'auth/too-many-requests': 'Слишком много попыток. Попробуй позже.',
  'auth/network-request-failed': 'Нет соединения с сетью.',
  'auth/configuration-not-found': 'В консоли Firebase не включён вход по Email/Password.',
  'auth/not-configured': 'Firebase не настроен — вставь firebaseConfig в renderer/auth.js.',
};
function friendlyError(err){
  return ERROR_MESSAGES[err && err.code] || 'Что-то пошло не так. Попробуй ещё раз.';
}

let auth = null;
if (isConfigured) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  setPersistence(auth, browserLocalPersistence).catch(() => {
    // file:// origin иногда не даёт использовать IndexedDB — не критично,
    // сессия просто не переживёт перезапуск приложения.
  });
  onAuthStateChanged(auth, (user) => {
    window.dispatchEvent(new CustomEvent('pulse-auth-changed', { detail: { user, guest: false } }));
  });
} else {
  // Firebase не настроен — сообщаем интерфейсу, чтобы показать предупреждение
  window.dispatchEvent(new CustomEvent('pulse-auth-unconfigured'));
}

window.PulseAuth = {
  isConfigured,

  signIn(email, password) {
    if (!auth) return Promise.reject({ code: 'auth/not-configured', message: friendlyError({code:'auth/not-configured'}) });
    return signInWithEmailAndPassword(auth, email, password).catch(err => {
      throw { code: err.code, message: friendlyError(err) };
    });
  },

  signUp(email, password, name) {
    if (!auth) return Promise.reject({ code: 'auth/not-configured', message: friendlyError({code:'auth/not-configured'}) });
    return createUserWithEmailAndPassword(auth, email, password)
      .then(cred => updateProfile(cred.user, { displayName: name }).then(() => cred))
      .catch(err => { throw { code: err.code, message: friendlyError(err) }; });
  },

  resetPassword(email) {
    if (!auth) return Promise.reject({ code: 'auth/not-configured', message: friendlyError({code:'auth/not-configured'}) });
    return sendPasswordResetEmail(auth, email).catch(err => {
      throw { code: err.code, message: friendlyError(err) };
    });
  },

  signOutUser() {
    if (!auth) {
      // гостевой режим — просто просим интерфейс вернуться к экрану входа
      window.dispatchEvent(new CustomEvent('pulse-auth-changed', { detail: { user: null, guest: false } }));
      return Promise.resolve();
    }
    return signOut(auth);
  },

  friendlyError,
};
