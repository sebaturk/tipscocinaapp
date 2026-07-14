/**
 * CocinaApp v3 — script.js
 * ✦ Login con usuario/contraseña almacenado en Firestore
 * ✦ Fecha de semana editable manualmente
 * ✦ Firebase Auth anónimo + Firestore (multi-dispositivo)
 * ✦ Totalmente responsive
 */

import { initializeApp }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore, doc, getDoc, setDoc, onSnapshot,
  collection, query, orderBy, getDocs
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getAuth, signInAnonymously, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

/* ══════════════════════════════════════════════
   FIREBASE CONFIG
══════════════════════════════════════════════ */
const firebaseConfig = {
  apiKey:            'AIzaSyCdzZO2tAsGNMpuiScFzBS9wmL2B06T0ZA',
  authDomain:        'tipscocinaapp.firebaseapp.com',
  projectId:         'tipscocinaapp',
  storageBucket:     'tipscocinaapp.firebasestorage.app',
  messagingSenderId: '95648418171',
  appId:             '1:95648418171:web:26dd388e73d275697495de',
};

const fbApp = initializeApp(firebaseConfig);
const db    = getFirestore(fbApp);
const auth  = getAuth(fbApp);

/* ══════════════════════════════════════════════
   CONSTANTES
══════════════════════════════════════════════ */
const DAYS        = ['L','M','X','J','V','S','D'];
const DAY_NAMES   = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
const STATUS      = { WORKED: 'worked', LATE: 'late', OFF: 'off' };
const STATUS_NEXT = { worked: 'late', late: 'off', off: 'worked' };
const STATUS_ICON = { worked: '✓', late: '!', off: '—' };
const LATE_PENALTY       = 0.25;
const DEFAULT_EMPLOYEES  = ['Angy','Alexander','Hugo','Lili','Eider'];
const SESSION_KEY        = 'cocinaapp_session'; // sessionStorage key

/* Firestore paths */
const PATH = {
  auth:        () => doc(db, 'app', 'auth'),
  config:      () => doc(db, 'app', 'config'),
  currentWeek: () => doc(db, 'app', 'currentWeek'),
  history:     () => collection(db, 'history'),
  historyDoc:  (id) => doc(db, 'history', id),
};

/* ══════════════════════════════════════════════
   STATE
══════════════════════════════════════════════ */
let state = {
  employees:     [],
  currentWeek:   null,
  history:       [],
  carryoverFund: 0,
};

let currentView   = 'dashboard';
let editingEmpId  = null;
let deletingEmpId = null;
let saveDebounce  = null;
let isLoggedIn    = false;

/* ══════════════════════════════════════════════
   LOADING HELPERS
══════════════════════════════════════════════ */
function setLoadingText(msg) {
  const el = document.getElementById('loading-text');
  if (el) el.textContent = msg;
}

function hideLoading() {
  const el = document.getElementById('loading-screen');
  el.classList.add('hidden');
  setTimeout(() => (el.style.display = 'none'), 420);
}

function showLoading(msg = 'Cargando…') {
  const el = document.getElementById('loading-screen');
  el.style.display = 'flex';
  el.classList.remove('hidden');
  setLoadingText(msg);
}

/* ══════════════════════════════════════════════
   SYNC UI
══════════════════════════════════════════════ */
function setSyncState(s) {
  const dot   = document.querySelector('.sync-dot');
  const label = document.querySelector('.sync-label');
  if (!dot || !label) return;
  dot.className     = `sync-dot${s === 'online' ? '' : ' ' + s}`;
  label.textContent = s === 'online' ? 'En línea' : s === 'syncing' ? 'Guardando…' : 'Sin conexión';
}

/* ══════════════════════════════════════════════
   ╔══════════════════╗
   ║  AUTENTICACIÓN   ║
   ╚══════════════════╝
   Credenciales almacenadas en Firestore (app/auth).
   El login de Firebase es anónimo (solo para autorizar
   las reglas de Firestore). La validación usuario/pass
   es propia de la app.
══════════════════════════════════════════════ */

/** Inicializa auth de Firebase y luego muestra login o app */
function initAuth() {
  setLoadingText('Conectando…');
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      // Firebase anónimo OK → verificar si hay sesión de app
      const session = sessionStorage.getItem(SESSION_KEY);
      if (session === 'ok') {
        await bootApp();
      } else {
        hideLoading();
        showLoginScreen();
      }
    } else {
      setLoadingText('Autenticando…');
      try {
        await signInAnonymously(auth);
        // onAuthStateChanged se dispara de nuevo
      } catch (err) {
        console.error('Auth error:', err);
        hideLoading();
        showLoginScreen();
      }
    }
  });
}

/** Muestra la pantalla de login */
function showLoginScreen() {
  document.getElementById('login-screen').classList.add('visible');
  document.getElementById('login-user').focus();
}

/** Oculta la pantalla de login */
function hideLoginScreen() {
  document.getElementById('login-screen').classList.remove('visible');
}

/** Valida credenciales contra Firestore */
async function doLogin() {
  const user = document.getElementById('login-user').value.trim().toLowerCase();
  const pass = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');

  if (!user || !pass) {
    showLoginError('Completa usuario y contraseña.');
    return;
  }

  const btn = document.getElementById('btn-login');
  btn.textContent = 'Verificando…';
  btn.disabled    = true;
  errEl.classList.remove('visible');

  try {
    const authSnap = await getDoc(PATH.auth());

    if (!authSnap.exists()) {
      // Primera vez: crear credenciales por defecto
      await setDoc(PATH.auth(), { username: 'admin', password: 'cocina2024' });
      toast('Primera vez: usuario "admin", contraseña "cocina2024"');
      btn.textContent = 'Entrar';
      btn.disabled    = false;
      return;
    }

    const creds = authSnap.data();
    if (user === creds.username.toLowerCase() && pass === creds.password) {
      sessionStorage.setItem(SESSION_KEY, 'ok');
      hideLoginScreen();
      await bootApp();
    } else {
      showLoginError('Usuario o contraseña incorrectos.');
    }
  } catch (err) {
    console.error('Login error:', err);
    showLoginError('Error de conexión. Verifica tu internet.');
  }

  btn.textContent = 'Entrar';
  btn.disabled    = false;
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.classList.add('visible');
}

/** Cierra sesión */
function doLogout() {
  if (!confirm('¿Cerrar sesión?')) return;
  sessionStorage.removeItem(SESSION_KEY);
  isLoggedIn = false;
  document.getElementById('app-shell').classList.remove('visible');
  showLoginScreen();
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
}

/** Cambia contraseña */
async function doChangePassword() {
  const oldPass     = document.getElementById('old-pass-input').value;
  const newPass     = document.getElementById('new-pass-input').value;
  const confirmPass = document.getElementById('new-pass-confirm').value;
  const errEl       = document.getElementById('change-pass-error');

  errEl.classList.remove('visible');

  if (!oldPass || !newPass || !confirmPass) {
    errEl.textContent = 'Completa todos los campos.';
    errEl.classList.add('visible');
    return;
  }
  if (newPass.length < 6) {
    errEl.textContent = 'La nueva contraseña debe tener al menos 6 caracteres.';
    errEl.classList.add('visible');
    return;
  }
  if (newPass !== confirmPass) {
    errEl.textContent = 'Las contraseñas no coinciden.';
    errEl.classList.add('visible');
    return;
  }

  try {
    const authSnap = await getDoc(PATH.auth());
    const creds    = authSnap.data();
    if (oldPass !== creds.password) {
      errEl.textContent = 'La contraseña actual es incorrecta.';
      errEl.classList.add('visible');
      return;
    }
    await setDoc(PATH.auth(), { ...creds, password: newPass });
    closeModal('modal-change-pass');
    document.getElementById('old-pass-input').value = '';
    document.getElementById('new-pass-input').value = '';
    document.getElementById('new-pass-confirm').value = '';
    toast('Contraseña actualizada');
  } catch (err) {
    errEl.textContent = 'Error al actualizar. Verifica tu conexión.';
    errEl.classList.add('visible');
  }
}

/* ══════════════════════════════════════════════
   BOOT APP (después del login)
══════════════════════════════════════════════ */
async function bootApp() {
  showLoading('Cargando datos…');
  isLoggedIn = true;
  try {
    await initFirestore();
    document.getElementById('app-shell').classList.add('visible');
    navigate('dashboard');
  } catch (err) {
    console.error('Boot error:', err);
    toast('Error cargando datos');
  }
  hideLoading();
}

/* ══════════════════════════════════════════════
   FIRESTORE
══════════════════════════════════════════════ */
async function initFirestore() {
  setSyncState('syncing');

  // Config
  const cfgSnap = await getDoc(PATH.config());
  if (cfgSnap.exists()) {
    const d = cfgSnap.data();
    state.employees     = d.employees     ?? [];
    state.carryoverFund = d.carryoverFund ?? 0;
  } else {
    state.employees     = DEFAULT_EMPLOYEES.map((n, i) => ({ id: `emp_${i + 1}`, name: n }));
    state.carryoverFund = 0;
    await saveConfig();
  }

  // Semana actual
  const wkSnap = await getDoc(PATH.currentWeek());
  if (wkSnap.exists()) {
    state.currentWeek = wkSnap.data();
  } else {
    state.currentWeek = createWeek();
    await saveCurrentWeek();
  }

  // Historial
  await loadHistory();

  // Listeners tiempo real
  onSnapshot(PATH.currentWeek(), snap => {
    if (!isLoggedIn) return;
    if (snap.exists()) { state.currentWeek = snap.data(); refreshUI(); }
  });

  onSnapshot(PATH.config(), snap => {
    if (!isLoggedIn) return;
    if (snap.exists()) {
      const d = snap.data();
      state.employees     = d.employees     ?? [];
      state.carryoverFund = d.carryoverFund ?? 0;
      refreshUI();
    }
  });

  setSyncState('online');
}

async function loadHistory() {
  try {
    const q    = query(PATH.history(), orderBy('startDate', 'desc'));
    const snap = await getDocs(q);
    state.history = snap.docs.map(d => d.data());
  } catch (e) { console.error('History load:', e); }
}

async function saveConfig() {
  try {
    await setDoc(PATH.config(), { employees: state.employees, carryoverFund: state.carryoverFund });
  } catch (e) { console.error('saveConfig:', e); }
}

async function saveCurrentWeek() {
  try {
    await setDoc(PATH.currentWeek(), state.currentWeek);
  } catch (e) { console.error('saveCurrentWeek:', e); }
}

function saveCurrentWeekDebounced() {
  setSyncState('syncing');
  clearTimeout(saveDebounce);
  saveDebounce = setTimeout(async () => {
    await saveCurrentWeek();
    setSyncState('online');
  }, 600);
}

async function saveHistoryEntry(week) {
  try {
    await setDoc(PATH.historyDoc(week.id), week);
  } catch (e) { console.error('saveHistory:', e); }
}

/* ══════════════════════════════════════════════
   ╔═══════════════════╗
   ║  SEMANA · FECHA   ║
   ╚═══════════════════╝
══════════════════════════════════════════════ */

function createWeek(startDate = null) {
  const now   = startDate ? new Date(startDate) : new Date();
  const id    = `week_${Date.now()}`;
  const label = formatWeekLabel(now);

  const attendance = {};
  state.employees.forEach(emp => {
    attendance[emp.id] = {};
    DAYS.forEach((_, i) => { attendance[emp.id][i] = STATUS.WORKED; });
  });

  const tips = {};
  DAYS.forEach((_, i) => { tips[i] = 0; });

  return {
    id,
    label,
    startDate: now.toISOString(),
    status: 'open',
    attendance,
    tips,
    results: null,
  };
}

function formatWeekLabel(date) {
  const d   = new Date(date);
  const end = new Date(d);
  end.setDate(d.getDate() + 6);
  return `Semana ${fmtDate(d)} – ${fmtDate(end)}`;
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
}

/** Abre modal para editar la fecha de inicio de la semana actual */
function openWeekDateModal() {
  const week = state.currentWeek;
  if (!week || week.status === 'closed') {
    toast('No se puede editar una semana cerrada');
    return;
  }

  // Precarga la fecha actual en el input
  const current  = new Date(week.startDate);
  const yyyy     = current.getFullYear();
  const mm       = String(current.getMonth() + 1).padStart(2, '0');
  const dd       = String(current.getDate()).padStart(2, '0');
  const input    = document.getElementById('week-date-input');
  input.value    = `${yyyy}-${mm}-${dd}`;

  updateDatePreview(input.value);
  openModal('modal-week-date');
}

function updateDatePreview(val) {
  const preview = document.getElementById('date-preview');
  if (!val) { preview.classList.remove('visible'); return; }

  const start = new Date(val + 'T12:00:00'); // noon to avoid timezone shifts
  const end   = new Date(start);
  end.setDate(start.getDate() + 6);

  preview.textContent = `📅  ${fmtDate(start)} → ${fmtDate(end)}`;
  preview.classList.add('visible');
}

async function applyWeekDate() {
  const val = document.getElementById('week-date-input').value;
  if (!val) { toast('Selecciona una fecha'); return; }

  const newStart = new Date(val + 'T12:00:00');
  state.currentWeek.startDate = newStart.toISOString();
  state.currentWeek.label     = formatWeekLabel(newStart);

  setSyncState('syncing');
  await saveCurrentWeek();
  setSyncState('online');

  closeModal('modal-week-date');
  toast('Fecha de semana actualizada');
  refreshUI();
}

/* ══════════════════════════════════════════════
   CALCULATIONS
══════════════════════════════════════════════ */
function calculateWeek(week, employees, carryoverFund) {
  const perEmployee = {};
  employees.forEach(emp => {
    perEmployee[emp.id] = { id: emp.id, name: emp.name, days: 0, lates: 0, earned: 0, discount: 0, bonus: 0, total: 0 };
  });

  let fundThisWeek = 0;

  DAYS.forEach((_, dayIdx) => {
    const dayTip = Number(week.tips?.[dayIdx]) || 0;
    if (dayTip <= 0) return;

    const workers = employees.filter(emp => {
      const s = week.attendance?.[emp.id]?.[dayIdx];
      return s === STATUS.WORKED || s === STATUS.LATE;
    });
    if (!workers.length) return;

    const share = dayTip / workers.length;
    workers.forEach(emp => {
      const s = week.attendance[emp.id][dayIdx];
      perEmployee[emp.id].days += 1;
      if (s === STATUS.LATE) {
        perEmployee[emp.id].lates    += 1;
        const penalty = share * LATE_PENALTY;
        perEmployee[emp.id].earned   += share - penalty;
        perEmployee[emp.id].discount += penalty;
        fundThisWeek += penalty;
      } else {
        perEmployee[emp.id].earned += share;
      }
    });
  });

  const totalFund = carryoverFund + fundThisWeek;
  const eligibles = employees.filter(e => perEmployee[e.id].days > 0 && perEmployee[e.id].lates === 0);

  let newCarryFund = 0;
  if (eligibles.length > 0 && totalFund > 0) {
    const bonusShare = totalFund / eligibles.length;
    eligibles.forEach(e => { perEmployee[e.id].bonus = bonusShare; });
  } else {
    newCarryFund = totalFund;
  }

  let totalTips = 0;
  employees.forEach(e => {
    const r = perEmployee[e.id];
    r.total   = r.earned + r.bonus;
    totalTips += r.earned;
  });

  return {
    perEmployee:  Object.values(perEmployee),
    totalTips,
    fundThisWeek,
    totalFund,
    newCarryFund,
    eligibles: eligibles.map(e => e.id),
  };
}

/* ══════════════════════════════════════════════
   WEEK OPERATIONS
══════════════════════════════════════════════ */
async function closeWeek() {
  if (!state.currentWeek || state.currentWeek.status !== 'open') return;

  const calc = calculateWeek(state.currentWeek, state.employees, state.carryoverFund);
  state.currentWeek.results = calc;
  state.currentWeek.status  = 'closed';

  await saveHistoryEntry(state.currentWeek);
  state.history.unshift(state.currentWeek);

  state.carryoverFund = calc.newCarryFund;
  await saveConfig();

  const nextDate = new Date(state.currentWeek.startDate);
  nextDate.setDate(nextDate.getDate() + 7);
  state.currentWeek = createWeek(nextDate);
  await saveCurrentWeek();
}

/* ══════════════════════════════════════════════
   EMPLOYEE OPERATIONS
══════════════════════════════════════════════ */
async function addEmployee(name) {
  const id = `emp_${Date.now()}`;
  state.employees.push({ id, name });
  if (state.currentWeek?.status === 'open') {
    if (!state.currentWeek.attendance) state.currentWeek.attendance = {};
    state.currentWeek.attendance[id] = {};
    DAYS.forEach((_, i) => { state.currentWeek.attendance[id][i] = STATUS.WORKED; });
    await saveCurrentWeek();
  }
  await saveConfig();
}

async function editEmployee(id, newName) {
  const emp = state.employees.find(e => e.id === id);
  if (emp) emp.name = newName;
  await saveConfig();
}

async function deleteEmployee(id) {
  state.employees = state.employees.filter(e => e.id !== id);
  if (state.currentWeek?.attendance) delete state.currentWeek.attendance[id];
  await saveConfig();
  await saveCurrentWeek();
}

/* ══════════════════════════════════════════════
   NAVIGATION
══════════════════════════════════════════════ */
function navigate(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`view-${viewId}`)?.classList.add('active');
  document.querySelector(`.nav-item[data-view="${viewId}"]`)?.classList.add('active');
  currentView = viewId;
  renderView(viewId);
}

function renderView(v) {
  switch (v) {
    case 'dashboard': renderDashboard(); break;
    case 'planilla':  renderPlanilla();  break;
    case 'historial': renderHistorial(); break;
    case 'config':    renderConfig();    break;
  }
}

function refreshUI() {
  if (!isLoggedIn) return;
  renderView(currentView);
  updateFondoPill();
}

/* ══════════════════════════════════════════════
   DASHBOARD
══════════════════════════════════════════════ */
function renderDashboard() {
  const week = state.currentWeek;
  if (!week) return;

  const calc = calculateWeek(week, state.employees, state.carryoverFund);

  document.getElementById('dash-week-text').textContent    = week.label;
  document.getElementById('sidebar-week-badge').textContent = week.label;
  document.getElementById('kpi-tips').textContent           = fmtMoney(calc.totalTips);
  document.getElementById('kpi-fondo').textContent          = fmtMoney(calc.totalFund);
  document.getElementById('kpi-empleados').textContent      = state.employees.length;
  document.getElementById('kpi-elegibles').textContent      = calc.eligibles.length;

  const btn = document.getElementById('btn-close-week');
  btn.textContent = week.status === 'closed' ? 'Semana cerrada' : 'Cerrar semana';
  btn.disabled    = week.status === 'closed';

  // Week label button: disable if closed
  const weekLabelBtn = document.getElementById('dash-week-label');
  weekLabelBtn.disabled = week.status === 'closed';
  weekLabelBtn.title    = week.status === 'closed' ? 'Semana cerrada' : 'Cambiar fecha de semana';

  renderSummaryTable(calc);
}

function renderSummaryTable(calc) {
  const tbody = document.getElementById('summary-tbody');
  const tfoot = document.getElementById('summary-tfoot');

  if (!calc?.perEmployee?.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Sin datos aún.</td></tr>';
    tfoot.innerHTML = '';
    return;
  }

  tbody.innerHTML = calc.perEmployee.map(r => `
    <tr>
      <td style="font-weight:600;color:var(--text-1)">${esc(r.name)}</td>
      <td class="num-neutral">${r.days}</td>
      <td class="${r.lates > 0 ? 'num-negative' : 'num-neutral'}">${r.lates}</td>
      <td class="num-positive">${fmtMoney(r.earned)}</td>
      <td class="${r.discount > 0 ? 'num-negative' : 'num-neutral'}">${r.discount > 0 ? '−' + fmtMoney(r.discount) : '—'}</td>
      <td class="${r.bonus > 0 ? 'num-bonus' : 'num-neutral'}">${r.bonus > 0 ? fmtMoney(r.bonus) : '—'}</td>
      <td style="font-weight:700;color:var(--text-1)">${fmtMoney(r.total)}</td>
    </tr>`).join('');

  const grand = calc.perEmployee.reduce((s, r) => s + r.total, 0);
  tfoot.innerHTML = `<tr><td>TOTAL</td><td></td><td></td><td></td><td></td><td></td><td>${fmtMoney(grand)}</td></tr>`;
}

/* ══════════════════════════════════════════════
   PLANILLA
══════════════════════════════════════════════ */
function renderPlanilla() {
  const week = state.currentWeek;
  if (!week) return;

  const locked = week.status === 'closed';
  document.getElementById('planilla-week-label').textContent = week.label;
  const pill = document.getElementById('planilla-status');
  pill.textContent = locked ? 'Cerrada' : 'Abierta';
  pill.className   = `status-pill${locked ? ' closed' : ''}`;

  renderAttendanceTable(week, locked);
  renderTipsGrid(week, locked);
}

function renderAttendanceTable(week, locked) {
  document.getElementById('attendance-head').innerHTML = `<tr>
    <th class="emp-col">Empleado</th>
    ${DAYS.map((d, i) => `<th title="${DAY_NAMES[i]}">${d}</th>`).join('')}
  </tr>`;

  document.getElementById('attendance-body').innerHTML = state.employees.map(emp => {
    const cells = DAYS.map((_, dayIdx) => {
      const status = week.attendance?.[emp.id]?.[dayIdx] ?? STATUS.WORKED;
      return `<td class="status-cell${locked ? ' locked' : ''}"
                  data-emp="${emp.id}" data-day="${dayIdx}"
                  title="${DAY_NAMES[dayIdx]} — ${statusLabel(status)}">
                <div class="status-dot ${status}">${STATUS_ICON[status]}</div>
              </td>`;
    }).join('');
    return `<tr><td class="emp-name">${esc(emp.name)}</td>${cells}</tr>`;
  }).join('');

  if (!locked) {
    document.querySelectorAll('.status-cell').forEach(cell => {
      cell.addEventListener('click', () =>
        cycleStatus(cell.dataset.emp, parseInt(cell.dataset.day))
      );
    });
  }
}

function cycleStatus(empId, dayIdx) {
  const week = state.currentWeek;
  if (!week || week.status === 'closed') return;
  if (!week.attendance[empId]) week.attendance[empId] = {};
  const current = week.attendance[empId][dayIdx] ?? STATUS.WORKED;
  week.attendance[empId][dayIdx] = STATUS_NEXT[current];
  saveCurrentWeekDebounced();
  renderPlanilla();
  updateFondoPill();
}

function renderTipsGrid(week, locked) {
  document.getElementById('tips-grid').innerHTML = DAYS.map((_, i) => `
    <div class="tip-cell">
      <div class="tip-day">${DAY_NAMES[i].substring(0, 3)}</div>
      <input class="tip-input" type="number" inputmode="decimal"
             min="0" step="0.01" placeholder="$0"
             value="${week.tips?.[i] > 0 ? week.tips[i] : ''}"
             data-day="${i}" ${locked ? 'disabled' : ''} />
    </div>`).join('');

  if (!locked) {
    document.querySelectorAll('.tip-input').forEach(input => {
      input.addEventListener('input', () => {
        state.currentWeek.tips[parseInt(input.dataset.day)] = parseFloat(input.value) || 0;
        saveCurrentWeekDebounced();
        updateFondoPill();
        if (currentView === 'dashboard') renderDashboard();
      });
    });
  }
}

function statusLabel(s) {
  return { worked: 'Trabajó', late: 'Retardo', off: 'Descanso' }[s] || s;
}

function updateFondoPill() {
  if (!state.currentWeek) return;
  const calc = calculateWeek(state.currentWeek, state.employees, state.carryoverFund);
  document.getElementById('topbar-fondo').textContent = `Fondo ${fmtMoney(calc.totalFund)}`;
  document.getElementById('kpi-fondo').textContent    = fmtMoney(calc.totalFund);
}

/* ══════════════════════════════════════════════
   HISTORIAL
══════════════════════════════════════════════ */
function renderHistorial() {
  const list = document.getElementById('history-list');
  if (!state.history.length) {
    list.innerHTML = '<div class="empty-state">No hay semanas cerradas aún.</div>';
    return;
  }
  list.innerHTML = state.history.map(week => {
    const total = week.results?.perEmployee?.reduce((s, r) => s + r.total, 0) ?? 0;
    return `<div class="history-card" data-week-id="${week.id}">
      <div class="history-card-info">
        <div class="history-card-title">${esc(week.label)}</div>
        <div class="history-card-sub">Cerrada · ${week.results?.perEmployee?.length ?? 0} empleados</div>
      </div>
      <div class="history-card-amount">${fmtMoney(total)}</div>
    </div>`;
  }).join('');

  list.querySelectorAll('.history-card').forEach(card => {
    card.addEventListener('click', () => openHistoryModal(card.dataset.weekId));
  });
}

function openHistoryModal(weekId) {
  const week = state.history.find(w => w.id === weekId);
  if (!week?.results) return;

  document.getElementById('modal-history-title').textContent = week.label;
  const calc  = week.results;
  const grand = calc.perEmployee?.reduce((s, r) => s + r.total, 0) ?? 0;

  document.getElementById('modal-history-body').innerHTML = `
    <div class="history-detail-grid">
      <div class="hd-kpi"><div class="hd-kpi-label">Propinas</div><div class="hd-kpi-value">${fmtMoney(calc.totalTips)}</div></div>
      <div class="hd-kpi"><div class="hd-kpi-label">Fondo generado</div><div class="hd-kpi-value">${fmtMoney(calc.fundThisWeek)}</div></div>
      <div class="hd-kpi"><div class="hd-kpi-label">Total distribuido</div><div class="hd-kpi-value">${fmtMoney(grand)}</div></div>
      <div class="hd-kpi"><div class="hd-kpi-label">Fondo arrastrado</div><div class="hd-kpi-value">${fmtMoney(calc.newCarryFund)}</div></div>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Empleado</th><th>Días</th><th>Ret.</th><th>Ganado</th><th>Desc.</th><th>Bono</th><th>Total</th></tr></thead>
        <tbody>${(calc.perEmployee ?? []).map(r => `
          <tr>
            <td style="font-weight:600;color:var(--text-1)">${esc(r.name)}</td>
            <td>${r.days}</td>
            <td class="${r.lates > 0 ? 'num-negative' : ''}">${r.lates}</td>
            <td class="num-positive">${fmtMoney(r.earned)}</td>
            <td class="${r.discount > 0 ? 'num-negative' : ''}">${r.discount > 0 ? '−' + fmtMoney(r.discount) : '—'}</td>
            <td class="${r.bonus > 0 ? 'num-bonus' : ''}">${r.bonus > 0 ? fmtMoney(r.bonus) : '—'}</td>
            <td style="font-weight:700;color:var(--text-1)">${fmtMoney(r.total)}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot><tr><td>TOTAL</td><td></td><td></td><td></td><td></td><td></td><td>${fmtMoney(grand)}</td></tr></tfoot>
      </table>
    </div>`;

  openModal('modal-history');
}

/* ══════════════════════════════════════════════
   CONFIGURACIÓN
══════════════════════════════════════════════ */
function renderConfig() {
  const list = document.getElementById('emp-list');
  if (!state.employees.length) {
    list.innerHTML = '<div class="empty-state">No hay empleados.</div>';
    return;
  }
  list.innerHTML = state.employees.map(emp => `
    <div class="emp-row">
      <div class="emp-row-name">${esc(emp.name)}</div>
      <div class="emp-row-actions">
        <button class="emp-row-btn" data-edit="${emp.id}">Editar</button>
        <button class="emp-row-btn del" data-del="${emp.id}">Eliminar</button>
      </div>
    </div>`).join('');

  list.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const emp = state.employees.find(e => e.id === btn.dataset.edit);
      if (!emp) return;
      editingEmpId = emp.id;
      document.getElementById('modal-emp-title').textContent = 'Editar empleado';
      document.getElementById('emp-name-input').value        = emp.name;
      openModal('modal-emp');
    });
  });

  list.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      const emp = state.employees.find(e => e.id === btn.dataset.del);
      if (!emp) return;
      deletingEmpId = emp.id;
      document.getElementById('del-emp-name').textContent = emp.name;
      openModal('modal-del-emp');
    });
  });
}

/* ══════════════════════════════════════════════
   CLOSE WEEK MODAL
══════════════════════════════════════════════ */
function openCloseWeekModal() {
  const week = state.currentWeek;
  if (!week || week.status !== 'open') return;

  const calc      = calculateWeek(week, state.employees, state.carryoverFund);
  const eligNames = calc.eligibles
    .map(id => state.employees.find(e => e.id === id)?.name ?? '?')
    .join(', ');

  let preview = `Total propinas: <strong>${fmtMoney(calc.totalTips)}</strong><br>
Fondo de puntualidad: <strong>${fmtMoney(calc.totalFund)}</strong><br>`;

  preview += calc.eligibles.length > 0
    ? `Bono para: <strong>${esc(eligNames)}</strong><br>Cada uno recibe: <strong>${fmtMoney(calc.totalFund / calc.eligibles.length)}</strong>`
    : `<span style="color:var(--yellow)">⚠ Nadie elegible — el fondo pasa a la siguiente semana.</span>`;

  document.getElementById('close-week-preview').innerHTML = preview;
  openModal('modal-close-week');
}

/* ══════════════════════════════════════════════
   MODALS
══════════════════════════════════════════════ */
function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

/* ══════════════════════════════════════════════
   EXPORT
══════════════════════════════════════════════ */
function exportCSV() {
  const week = state.currentWeek;
  const calc = calculateWeek(week, state.employees, state.carryoverFund);
  const rows = [
    ['Empleado','Días trabajados','Retardos','Ganado','Descuento','Bono','Total'],
    ...calc.perEmployee.map(r => [
      r.name, r.days, r.lates,
      r.earned.toFixed(2), r.discount.toFixed(2),
      r.bonus.toFixed(2),  r.total.toFixed(2),
    ]),
  ];
  const blob = new Blob(
    [rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n')],
    { type: 'text/csv;charset=utf-8;' }
  );
  downloadBlob(blob, `${week.label.replace(/[^a-z0-9]/gi, '_')}.csv`);
  toast('CSV exportado');
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `cocinaapp_backup_${Date.now()}.json`);
  toast('Respaldo exportado');
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a   = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ══════════════════════════════════════════════
   TOAST
══════════════════════════════════════════════ */
let toastTimer = null;
function toast(msg, dur = 2800) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), dur);
}

/* ══════════════════════════════════════════════
   UTILS
══════════════════════════════════════════════ */
function fmtMoney(n) {
  if (n == null || isNaN(n)) return '$0.00';
  return '$' + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ══════════════════════════════════════════════
   MOBILE SIDEBAR
══════════════════════════════════════════════ */
function initMobileNav() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  const openSidebar  = () => { sidebar.classList.add('open'); overlay.classList.add('open'); };
  const closeSidebar = () => { sidebar.classList.remove('open'); overlay.classList.remove('open'); };

  document.getElementById('menuBtn').addEventListener('click', openSidebar);
  document.getElementById('sidebar-close').addEventListener('click', closeSidebar);
  overlay.addEventListener('click', closeSidebar);

  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      if (window.innerWidth <= 768) closeSidebar();
    });
  });
}

/* ══════════════════════════════════════════════
   EVENT BINDINGS
══════════════════════════════════════════════ */
function bindEvents() {
  /* ─ Login ─ */
  document.getElementById('btn-login').addEventListener('click', doLogin);
  document.getElementById('login-pass').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
  document.getElementById('login-user').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('login-pass').focus();
  });

  // Toggle password visibility
  document.getElementById('pass-toggle').addEventListener('click', () => {
    const input = document.getElementById('login-pass');
    input.type  = input.type === 'password' ? 'text' : 'password';
  });

  /* ─ Logout ─ */
  document.getElementById('btn-logout').addEventListener('click', doLogout);

  /* ─ Navigation ─ */
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => navigate(item.dataset.view));
  });

  /* ─ Dashboard ─ */
  document.getElementById('btn-close-week').addEventListener('click', openCloseWeekModal);

  // Click on week label → edit date
  document.getElementById('dash-week-label').addEventListener('click', openWeekDateModal);

  document.getElementById('btn-confirm-close').addEventListener('click', async () => {
    closeModal('modal-close-week');
    setSyncState('syncing');
    await closeWeek();
    await loadHistory();
    setSyncState('online');
    toast('Semana cerrada correctamente ✓');
    navigate('dashboard');
  });

  /* ─ Week Date Modal ─ */
  document.getElementById('week-date-input').addEventListener('input', e => {
    updateDatePreview(e.target.value);
  });
  document.getElementById('btn-save-week-date').addEventListener('click', applyWeekDate);

  /* ─ Add / Edit Employee ─ */
  document.getElementById('btn-add-emp').addEventListener('click', () => {
    editingEmpId = null;
    document.getElementById('modal-emp-title').textContent = 'Agregar empleado';
    document.getElementById('emp-name-input').value        = '';
    openModal('modal-emp');
    setTimeout(() => document.getElementById('emp-name-input').focus(), 300);
  });

  document.getElementById('btn-save-emp').addEventListener('click', async () => {
    const name = document.getElementById('emp-name-input').value.trim();
    if (!name) { toast('Escribe un nombre'); return; }
    setSyncState('syncing');
    if (editingEmpId) { await editEmployee(editingEmpId, name); toast(`"${name}" actualizado`); }
    else              { await addEmployee(name);                toast(`"${name}" agregado`); }
    setSyncState('online');
    closeModal('modal-emp');
    editingEmpId = null;
    renderConfig();
    updateFondoPill();
  });

  document.getElementById('emp-name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-save-emp').click();
  });

  /* ─ Delete Employee ─ */
  document.getElementById('btn-confirm-del-emp').addEventListener('click', async () => {
    if (!deletingEmpId) return;
    const name = state.employees.find(e => e.id === deletingEmpId)?.name ?? '';
    setSyncState('syncing');
    await deleteEmployee(deletingEmpId);
    setSyncState('online');
    toast(`"${name}" eliminado`);
    deletingEmpId = null;
    closeModal('modal-del-emp');
    renderConfig();
    updateFondoPill();
  });

  /* ─ Change Password ─ */
  document.getElementById('btn-change-pass').addEventListener('click', () => {
    document.getElementById('old-pass-input').value  = '';
    document.getElementById('new-pass-input').value  = '';
    document.getElementById('new-pass-confirm').value = '';
    document.getElementById('change-pass-error').classList.remove('visible');
    openModal('modal-change-pass');
  });
  document.getElementById('btn-confirm-change-pass').addEventListener('click', doChangePassword);

  /* ─ Export / Reset ─ */
  document.getElementById('btn-export-csv').addEventListener('click', exportCSV);
  document.getElementById('btn-print').addEventListener('click', () => window.print());
  document.getElementById('btn-export-backup').addEventListener('click', exportBackup);

  document.getElementById('btn-reset').addEventListener('click', async () => {
    if (!confirm('¿Restaurar todos los datos? Esta acción es irreversible.')) return;
    setSyncState('syncing');
    state.employees     = DEFAULT_EMPLOYEES.map((n, i) => ({ id: `emp_${i + 1}`, name: n }));
    state.carryoverFund = 0;
    state.currentWeek   = createWeek();
    state.history       = [];
    await saveConfig();
    await saveCurrentWeek();
    setSyncState('online');
    navigate('dashboard');
    toast('Datos restaurados');
  });

  /* ─ Modal close buttons ─ */
  document.querySelectorAll('[data-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.modal));
  });
  document.querySelectorAll('.modal-overlay').forEach(ov => {
    ov.addEventListener('click', e => { if (e.target === ov) closeModal(ov.id); });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape')
      document.querySelectorAll('.modal-overlay.open').forEach(m => closeModal(m.id));
  });

  /* ─ Connection status ─ */
  window.addEventListener('online',  () => setSyncState('online'));
  window.addEventListener('offline', () => setSyncState('offline'));
}

/* ══════════════════════════════════════════════
   INIT
══════════════════════════════════════════════ */
function init() {
  bindEvents();
  initMobileNav();
  initAuth(); // Decide: mostrar login o cargar app
}

init();
