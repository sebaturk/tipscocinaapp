/**
 * CocinaApp v5 — script.js
 * ✦ Eliminar semanas del historial (individual y múltiple)
 * ✦ Dashboard: propinas brutas, netas y total de descuentos
 * ✦ 5 estados de asistencia con 4 niveles de descuento
 * ✦ Login propio · Fecha editable · Firebase Firestore
 */

import { initializeApp }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore, doc, getDoc, setDoc, deleteDoc,
  onSnapshot, collection, query, orderBy, getDocs,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getAuth, signInAnonymously, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

/* ══════════════════════════════════════════
   FIREBASE CONFIG
══════════════════════════════════════════ */
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

/* ══════════════════════════════════════════
   CONSTANTES
══════════════════════════════════════════ */
const DAYS      = ['L','M','X','J','V','S','D'];
const DAY_NAMES = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];

const STATUS = { WORKED:'worked', LATE25:'late25', LATE50:'late50', LATE100:'late100', OFF:'off' };
const STATUS_CYCLE = ['worked','late25','late50','late100','off'];
const STATUS_ICON  = { worked:'✓', late25:'!', late50:'!!', late100:'✗', off:'—' };
const STATUS_LABEL = { worked:'Trabajó', late25:'Tarde +10 min (−25%)', late50:'Tarde +30 min (−50%)', late100:'Tarde +60 min (−100%)', off:'Descanso' };
const PENALTY      = { worked:0, late25:0.25, late50:0.50, late100:1.00, off:0 };

const DEFAULT_EMPLOYEES = ['Angy','Alexander','Hugo','Lili','Eider'];
const SESSION_KEY       = 'cocinaapp_session';

const PATH = {
  auth:        () => doc(db, 'app', 'auth'),
  config:      () => doc(db, 'app', 'config'),
  currentWeek: () => doc(db, 'app', 'currentWeek'),
  history:     () => collection(db, 'history'),
  historyDoc:  (id) => doc(db, 'history', id),
};

/* ══════════════════════════════════════════
   STATE
══════════════════════════════════════════ */
let state = { employees:[], currentWeek:null, history:[], carryoverFund:0 };

let currentView    = 'dashboard';
let editingEmpId   = null;
let deletingEmpId  = null;
let saveDebounce   = null;
let isLoggedIn     = false;

// Historia: modo selección para eliminar
let selectMode        = false;
let selectedHistoryIds = new Set();
// Id único para eliminar semana individual desde el modal de detalle
let pendingDeleteIds  = [];

/* ══════════════════════════════════════════
   LOADING / SYNC
══════════════════════════════════════════ */
function setLoadingText(msg) { const el = document.getElementById('loading-text'); if (el) el.textContent = msg; }
function hideLoading() {
  const el = document.getElementById('loading-screen');
  el.classList.add('hidden');
  setTimeout(() => (el.style.display = 'none'), 420);
}
function showLoading(msg = 'Cargando…') {
  const el = document.getElementById('loading-screen');
  el.style.display = 'flex'; el.classList.remove('hidden'); setLoadingText(msg);
}
function setSyncState(s) {
  const dot   = document.querySelector('.sync-dot');
  const label = document.querySelector('.sync-label');
  if (!dot || !label) return;
  dot.className     = `sync-dot${s === 'online' ? '' : ' ' + s}`;
  label.textContent = s === 'online' ? 'En línea' : s === 'syncing' ? 'Guardando…' : 'Sin conexión';
}

/* ══════════════════════════════════════════
   AUTH
══════════════════════════════════════════ */
function initAuth() {
  setLoadingText('Conectando…');
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      if (sessionStorage.getItem(SESSION_KEY) === 'ok') { await bootApp(); }
      else { hideLoading(); showLoginScreen(); }
    } else {
      setLoadingText('Autenticando…');
      try { await signInAnonymously(auth); }
      catch (err) { console.error(err); hideLoading(); showLoginScreen(); }
    }
  });
}

function showLoginScreen() {
  document.getElementById('login-screen').classList.add('visible');
  document.getElementById('login-user').focus();
}
function hideLoginScreen() { document.getElementById('login-screen').classList.remove('visible'); }

async function doLogin() {
  const user  = document.getElementById('login-user').value.trim().toLowerCase();
  const pass  = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');
  errEl.classList.remove('visible');
  if (!user || !pass) { showLoginError('Completa usuario y contraseña.'); return; }
  const btn = document.getElementById('btn-login');
  btn.textContent = 'Verificando…'; btn.disabled = true;
  try {
    const snap = await getDoc(PATH.auth());
    if (!snap.exists()) {
      await setDoc(PATH.auth(), { username:'admin', password:'cocina2024' });
      showLoginError('Primera vez: usuario "admin", contraseña "cocina2024"');
    } else {
      const c = snap.data();
      if (user === c.username.toLowerCase() && pass === c.password) {
        sessionStorage.setItem(SESSION_KEY, 'ok');
        hideLoginScreen(); await bootApp();
      } else { showLoginError('Usuario o contraseña incorrectos.'); }
    }
  } catch (err) { console.error(err); showLoginError('Error de conexión.'); }
  btn.textContent = 'Entrar'; btn.disabled = false;
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg; el.classList.add('visible');
}

function doLogout() {
  if (!confirm('¿Cerrar sesión?')) return;
  sessionStorage.removeItem(SESSION_KEY);
  isLoggedIn = false;
  document.getElementById('app-shell').classList.remove('visible');
  showLoginScreen();
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
}

async function doChangePassword() {
  const oldPass = document.getElementById('old-pass-input').value;
  const newPass = document.getElementById('new-pass-input').value;
  const confirm = document.getElementById('new-pass-confirm').value;
  const errEl   = document.getElementById('change-pass-error');
  errEl.classList.remove('visible');
  if (!oldPass || !newPass || !confirm)      { errEl.textContent='Completa todos los campos.';         errEl.classList.add('visible'); return; }
  if (newPass.length < 6)                    { errEl.textContent='Mínimo 6 caracteres.';               errEl.classList.add('visible'); return; }
  if (newPass !== confirm)                   { errEl.textContent='Las contraseñas no coinciden.';      errEl.classList.add('visible'); return; }
  try {
    const snap  = await getDoc(PATH.auth());
    const creds = snap.data();
    if (oldPass !== creds.password)          { errEl.textContent='Contraseña actual incorrecta.';     errEl.classList.add('visible'); return; }
    await setDoc(PATH.auth(), { ...creds, password: newPass });
    closeModal('modal-change-pass');
    ['old-pass-input','new-pass-input','new-pass-confirm'].forEach(id => { document.getElementById(id).value=''; });
    toast('Contraseña actualizada');
  } catch (err) { errEl.textContent='Error al actualizar.'; errEl.classList.add('visible'); }
}

/* ══════════════════════════════════════════
   BOOT
══════════════════════════════════════════ */
async function bootApp() {
  showLoading('Cargando datos…');
  isLoggedIn = true;
  try {
    await initFirestore();
    document.getElementById('app-shell').classList.add('visible');
    navigate('dashboard');
  } catch (err) { console.error(err); toast('Error cargando datos'); }
  hideLoading();
}

/* ══════════════════════════════════════════
   FIRESTORE
══════════════════════════════════════════ */
async function initFirestore() {
  setSyncState('syncing');
  const cfgSnap = await getDoc(PATH.config());
  if (cfgSnap.exists()) {
    const d = cfgSnap.data();
    state.employees     = d.employees     ?? [];
    state.carryoverFund = d.carryoverFund ?? 0;
  } else {
    state.employees     = DEFAULT_EMPLOYEES.map((n,i) => ({ id:`emp_${i+1}`, name:n }));
    state.carryoverFund = 0;
    await saveConfig();
  }
  const wkSnap = await getDoc(PATH.currentWeek());
  if (wkSnap.exists()) { state.currentWeek = wkSnap.data(); migrateWeekStatus(state.currentWeek); }
  else                 { state.currentWeek = createWeek(); await saveCurrentWeek(); }
  await loadHistory();

  onSnapshot(PATH.currentWeek(), snap => {
    if (!isLoggedIn || !snap.exists()) return;
    state.currentWeek = snap.data(); migrateWeekStatus(state.currentWeek); refreshUI();
  });
  onSnapshot(PATH.config(), snap => {
    if (!isLoggedIn || !snap.exists()) return;
    const d = snap.data();
    state.employees     = d.employees     ?? [];
    state.carryoverFund = d.carryoverFund ?? 0;
    refreshUI();
  });
  setSyncState('online');
}

function migrateWeekStatus(week) {
  if (!week?.attendance) return;
  let changed = false;
  Object.values(week.attendance).forEach(days => {
    Object.keys(days).forEach(i => { if (days[i]==='late') { days[i]='late25'; changed=true; } });
  });
  if (changed) saveCurrentWeekDebounced();
}

async function loadHistory() {
  try {
    const q    = query(PATH.history(), orderBy('startDate','desc'));
    const snap = await getDocs(q);
    state.history = snap.docs.map(d => d.data());
  } catch (e) { console.error('History load:', e); }
}

async function saveConfig() {
  try { await setDoc(PATH.config(), { employees:state.employees, carryoverFund:state.carryoverFund }); }
  catch (e) { console.error('saveConfig:', e); }
}
async function saveCurrentWeek() {
  try { await setDoc(PATH.currentWeek(), state.currentWeek); }
  catch (e) { console.error('saveCurrentWeek:', e); }
}
function saveCurrentWeekDebounced() {
  setSyncState('syncing');
  clearTimeout(saveDebounce);
  saveDebounce = setTimeout(async () => { await saveCurrentWeek(); setSyncState('online'); }, 600);
}
async function saveHistoryEntry(week) {
  try { await setDoc(PATH.historyDoc(week.id), week); }
  catch (e) { console.error('saveHistory:', e); }
}

/* ══════════════════════════════════════════
   DELETE HISTORY ENTRIES
══════════════════════════════════════════ */

/**
 * Elimina una o varias semanas del historial en Firestore
 * y las quita del state local.
 * @param {string[]} ids - array de week.id
 */
async function deleteHistoryEntries(ids) {
  setSyncState('syncing');
  try {
    await Promise.all(ids.map(id => deleteDoc(PATH.historyDoc(id))));
    state.history = state.history.filter(w => !ids.includes(w.id));
    setSyncState('online');
  } catch (e) {
    console.error('deleteHistory:', e);
    setSyncState('offline');
    toast('Error al eliminar. Verifica tu conexión.');
  }
}

/* ══════════════════════════════════════════
   WEEK FACTORY
══════════════════════════════════════════ */
function createWeek(startDate = null) {
  const now   = startDate ? new Date(startDate) : new Date();
  const id    = `week_${Date.now()}`;
  const label = formatWeekLabel(now);
  const attendance = {};
  state.employees.forEach(emp => {
    attendance[emp.id] = {};
    DAYS.forEach((_,i) => { attendance[emp.id][i] = STATUS.WORKED; });
  });
  const tips = {};
  DAYS.forEach((_,i) => { tips[i] = 0; });
  return { id, label, startDate: now.toISOString(), status:'open', attendance, tips, results:null };
}

function formatWeekLabel(date) {
  const d = new Date(date); const end = new Date(d);
  end.setDate(d.getDate() + 6);
  return `Semana ${fmtDate(d)} – ${fmtDate(end)}`;
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString('es-MX', { day:'2-digit', month:'short' });
}

/* ══════════════════════════════════════════
   WEEK DATE EDITOR
══════════════════════════════════════════ */
function openWeekDateModal() {
  const week = state.currentWeek;
  if (!week || week.status === 'closed') { toast('No se puede editar una semana cerrada'); return; }
  const d  = new Date(week.startDate);
  const input = document.getElementById('week-date-input');
  input.value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  updateDatePreview(input.value);
  openModal('modal-week-date');
}
function updateDatePreview(val) {
  const preview = document.getElementById('date-preview');
  if (!val) { preview.classList.remove('visible'); return; }
  const start = new Date(val + 'T12:00:00');
  const end   = new Date(start); end.setDate(start.getDate() + 6);
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

/* ══════════════════════════════════════════
   CALCULATIONS
══════════════════════════════════════════ */
function calculateWeek(week, employees, carryoverFund) {
  const per = {};
  employees.forEach(emp => {
    per[emp.id] = { id:emp.id, name:emp.name, days:0, lates:0, earned:0, discount:0, bonus:0, total:0 };
  });
  let fundThisWeek = 0;

  DAYS.forEach((_,dayIdx) => {
    const dayTip = Number(week.tips?.[dayIdx]) || 0;
    if (dayTip <= 0) return;
    const workers = employees.filter(emp => (week.attendance?.[emp.id]?.[dayIdx] ?? STATUS.WORKED) !== STATUS.OFF);
    if (!workers.length) return;
    const share = dayTip / workers.length;
    workers.forEach(emp => {
      const s       = week.attendance?.[emp.id]?.[dayIdx] ?? STATUS.WORKED;
      const penalty = PENALTY[s] ?? 0;
      per[emp.id].days += 1;
      if (penalty > 0) {
        per[emp.id].lates    += 1;
        const deducted = share * penalty;
        per[emp.id].earned   += share - deducted;
        per[emp.id].discount += deducted;
        fundThisWeek         += deducted;
      } else {
        per[emp.id].earned += share;
      }
    });
  });

  const totalFund = carryoverFund + fundThisWeek;
  const eligibles = employees.filter(e => per[e.id].days > 0 && per[e.id].lates === 0);
  let newCarryFund = 0;
  if (eligibles.length > 0 && totalFund > 0) {
    const bonusShare = totalFund / eligibles.length;
    eligibles.forEach(e => { per[e.id].bonus = bonusShare; });
  } else { newCarryFund = totalFund; }

  // Propinas brutas (suma de todo lo ingresado en el campo de propinas)
  const grossTips = DAYS.reduce((s,_,i) => s + (Number(week.tips?.[i]) || 0), 0);

  let totalEarned = 0;
  employees.forEach(e => {
    per[e.id].total = per[e.id].earned + per[e.id].bonus;
    totalEarned    += per[e.id].earned;
  });

  return {
    perEmployee:  Object.values(per),
    grossTips,           // suma bruta de propinas ingresadas
    totalEarned,         // neto distribuido (sin descuentos)
    totalDiscounts: fundThisWeek, // total descontado esta semana
    fundThisWeek,
    totalFund,
    newCarryFund,
    eligibles: eligibles.map(e => e.id),
  };
}

/* ══════════════════════════════════════════
   WEEK OPERATIONS
══════════════════════════════════════════ */
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

/* ══════════════════════════════════════════
   EMPLOYEE OPERATIONS
══════════════════════════════════════════ */
async function addEmployee(name) {
  const id = `emp_${Date.now()}`;
  state.employees.push({ id, name });
  if (state.currentWeek?.status === 'open') {
    if (!state.currentWeek.attendance) state.currentWeek.attendance = {};
    state.currentWeek.attendance[id] = {};
    DAYS.forEach((_,i) => { state.currentWeek.attendance[id][i] = STATUS.WORKED; });
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
  await saveConfig(); await saveCurrentWeek();
}

/* ══════════════════════════════════════════
   NAVIGATION
══════════════════════════════════════════ */
function navigate(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`view-${viewId}`)?.classList.add('active');
  document.querySelector(`.nav-item[data-view="${viewId}"]`)?.classList.add('active');
  currentView = viewId;
  // Reset select mode when leaving historial
  if (viewId !== 'historial') exitSelectMode();
  renderView(viewId);
}
function renderView(v) {
  switch(v) {
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

/* ══════════════════════════════════════════
   DASHBOARD
══════════════════════════════════════════ */
function renderDashboard() {
  const week = state.currentWeek;
  if (!week) return;
  const calc = calculateWeek(week, state.employees, state.carryoverFund);

  document.getElementById('dash-week-text').textContent    = week.label;
  document.getElementById('sidebar-week-badge').textContent = week.label;

  // KPI row 1: propinas
  document.getElementById('kpi-tips-gross').textContent = fmtMoney(calc.grossTips);
  document.getElementById('kpi-tips-net').textContent   = fmtMoney(calc.totalEarned);
  document.getElementById('kpi-tips-disc').textContent  = fmtMoney(calc.totalDiscounts);

  // KPI row 2: operativos
  document.getElementById('kpi-fondo').textContent     = fmtMoney(calc.totalFund);
  document.getElementById('kpi-empleados').textContent = state.employees.length;
  document.getElementById('kpi-elegibles').textContent = calc.eligibles.length;

  const statusEl  = document.getElementById('kpi-status');
  const statusSub = document.getElementById('kpi-status-sub');
  if (week.status === 'closed') {
    statusEl.textContent  = 'Cerrada';
    statusEl.className    = 'kpi-value kpi-status closed';
    statusSub.textContent = 'no modificable';
  } else {
    statusEl.textContent  = 'Abierta';
    statusEl.className    = 'kpi-value kpi-status open';
    statusSub.textContent = 'en curso';
  }

  const btn = document.getElementById('btn-close-week');
  btn.textContent = week.status === 'closed' ? 'Semana cerrada' : 'Cerrar semana';
  btn.disabled    = week.status === 'closed';

  const wlBtn = document.getElementById('dash-week-label');
  wlBtn.disabled = week.status === 'closed';
  wlBtn.title    = week.status === 'closed' ? 'Semana cerrada' : 'Cambiar fecha de semana';

  renderSummaryTable(calc);
}

function renderSummaryTable(calc) {
  const tbody = document.getElementById('summary-tbody');
  const tfoot = document.getElementById('summary-tfoot');
  if (!calc?.perEmployee?.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Sin datos aún.</td></tr>';
    tfoot.innerHTML = ''; return;
  }
  tbody.innerHTML = calc.perEmployee.map(r => `
    <tr>
      <td style="font-weight:600;color:var(--text-1)">${esc(r.name)}</td>
      <td class="num-neutral">${r.days}</td>
      <td class="${r.lates > 0 ? 'num-negative' : 'num-neutral'}">${r.lates}</td>
      <td class="num-positive">${fmtMoney(r.earned)}</td>
      <td class="${r.discount > 0 ? 'num-negative' : 'num-neutral'}">${r.discount > 0 ? '−'+fmtMoney(r.discount) : '—'}</td>
      <td class="${r.bonus > 0 ? 'num-bonus' : 'num-neutral'}">${r.bonus > 0 ? fmtMoney(r.bonus) : '—'}</td>
      <td style="font-weight:700;color:var(--text-1)">${fmtMoney(r.total)}</td>
    </tr>`).join('');
  const grand = calc.perEmployee.reduce((s,r) => s + r.total, 0);
  tfoot.innerHTML = `<tr><td>TOTAL</td><td></td><td></td><td></td><td></td><td></td><td>${fmtMoney(grand)}</td></tr>`;
}

/* ══════════════════════════════════════════
   PLANILLA
══════════════════════════════════════════ */
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
    ${DAYS.map((d,i) => `<th title="${DAY_NAMES[i]}">${d}</th>`).join('')}
  </tr>`;
  document.getElementById('attendance-body').innerHTML = state.employees.map(emp => {
    const cells = DAYS.map((_,dayIdx) => {
      const status = week.attendance?.[emp.id]?.[dayIdx] ?? STATUS.WORKED;
      return `<td class="status-cell${locked?' locked':''}"
                  data-emp="${emp.id}" data-day="${dayIdx}"
                  title="${DAY_NAMES[dayIdx]} — ${STATUS_LABEL[status]??status}">
                <div class="status-dot ${status}">${STATUS_ICON[status]??'?'}</div>
              </td>`;
    }).join('');
    return `<tr><td class="emp-name">${esc(emp.name)}</td>${cells}</tr>`;
  }).join('');
  if (!locked) {
    document.querySelectorAll('.status-cell').forEach(cell => {
      cell.addEventListener('click', () => cycleStatus(cell.dataset.emp, parseInt(cell.dataset.day)));
    });
  }
}

function cycleStatus(empId, dayIdx) {
  const week = state.currentWeek;
  if (!week || week.status === 'closed') return;
  if (!week.attendance[empId]) week.attendance[empId] = {};
  const current = week.attendance[empId][dayIdx] ?? STATUS.WORKED;
  const idx     = STATUS_CYCLE.indexOf(current);
  week.attendance[empId][dayIdx] = STATUS_CYCLE[(idx+1) % STATUS_CYCLE.length];
  saveCurrentWeekDebounced();
  renderPlanilla();
  updateFondoPill();
}

function renderTipsGrid(week, locked) {
  document.getElementById('tips-grid').innerHTML = DAYS.map((_,i) => `
    <div class="tip-cell">
      <div class="tip-day">${DAY_NAMES[i].substring(0,3)}</div>
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

function updateFondoPill() {
  if (!state.currentWeek) return;
  const calc = calculateWeek(state.currentWeek, state.employees, state.carryoverFund);
  document.getElementById('topbar-fondo').textContent = `Fondo ${fmtMoney(calc.totalFund)}`;
  document.getElementById('kpi-fondo').textContent    = fmtMoney(calc.totalFund);
}

/* ══════════════════════════════════════════
   HISTORIAL — render con modo selección
══════════════════════════════════════════ */
function renderHistorial() {
  const list          = document.getElementById('history-list');
  const toggleBtn     = document.getElementById('btn-toggle-select');
  const headerActions = document.getElementById('history-header-actions');

  if (!state.history.length) {
    list.innerHTML = '<div class="empty-state">No hay semanas cerradas aún.</div>';
    toggleBtn.style.display     = 'none';
    headerActions.style.display = 'none';
    return;
  }

  // Mostrar botón "Seleccionar" solo si hay elementos
  if (selectMode) {
    toggleBtn.style.display     = 'none';
    headerActions.style.display = 'flex';
  } else {
    toggleBtn.style.display     = 'inline-flex';
    headerActions.style.display = 'none';
  }

  list.innerHTML = state.history.map(week => {
    const total    = week.results?.perEmployee?.reduce((s,r) => s + r.total, 0) ?? 0;
    const checked  = selectedHistoryIds.has(week.id);
    return `
      <div class="history-card${selectMode ? ' selecting' : ''}" data-week-id="${week.id}">
        <div class="history-card-check${selectMode ? ' visible' : ''}${checked ? ' checked' : ''}"
             data-check="${week.id}">${checked ? '✓' : ''}</div>
        <div class="history-card-main" data-week-id="${week.id}">
          <div class="history-card-info">
            <div class="history-card-title">${esc(week.label)}</div>
            <div class="history-card-sub">Cerrada · ${week.results?.perEmployee?.length ?? 0} empleados</div>
          </div>
          <div class="history-card-amount">${fmtMoney(total)}</div>
        </div>
      </div>`;
  }).join('');

  // Bind events
  list.querySelectorAll('.history-card-check').forEach(chk => {
    chk.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = chk.dataset.check;
      if (selectedHistoryIds.has(id)) { selectedHistoryIds.delete(id); }
      else                            { selectedHistoryIds.add(id); }
      renderHistorial();
    });
  });

  list.querySelectorAll('.history-card-main').forEach(main => {
    main.addEventListener('click', () => {
      if (selectMode) {
        // En modo selección, el click en el main también activa el check
        const id = main.dataset.weekId;
        if (selectedHistoryIds.has(id)) { selectedHistoryIds.delete(id); }
        else                            { selectedHistoryIds.add(id); }
        renderHistorial();
      } else {
        openHistoryModal(main.dataset.weekId);
      }
    });
  });

  // Actualizar label del botón de eliminar
  const delBtn = document.getElementById('btn-delete-selected');
  if (selectedHistoryIds.size > 0) {
    delBtn.textContent = `Eliminar (${selectedHistoryIds.size})`;
    delBtn.disabled    = false;
  } else {
    delBtn.textContent = 'Eliminar seleccionadas';
    delBtn.disabled    = true;
  }
}

function enterSelectMode() {
  selectMode = true;
  selectedHistoryIds.clear();
  renderHistorial();
}
function exitSelectMode() {
  selectMode = false;
  selectedHistoryIds.clear();
  if (currentView === 'historial') renderHistorial();
}

function openHistoryModal(weekId) {
  const week = state.history.find(w => w.id === weekId);
  if (!week?.results) return;
  document.getElementById('modal-history-title').textContent = week.label;
  const calc  = week.results;
  const grand = calc.perEmployee?.reduce((s,r) => s + r.total, 0) ?? 0;

  document.getElementById('modal-history-body').innerHTML = `
    <div class="history-detail-grid">
      <div class="hd-kpi"><div class="hd-kpi-label">Propinas brutas</div><div class="hd-kpi-value">${fmtMoney(calc.grossTips ?? calc.totalTips)}</div></div>
      <div class="hd-kpi"><div class="hd-kpi-label">Neto distribuido</div><div class="hd-kpi-value">${fmtMoney(calc.totalEarned ?? calc.totalTips)}</div></div>
      <div class="hd-kpi"><div class="hd-kpi-label">Fondo generado</div><div class="hd-kpi-value">${fmtMoney(calc.fundThisWeek)}</div></div>
      <div class="hd-kpi"><div class="hd-kpi-label">Fondo arrastrado</div><div class="hd-kpi-value">${fmtMoney(calc.newCarryFund)}</div></div>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Empleado</th><th>Días</th><th>Ret.</th><th>Ganado</th><th>Desc.</th><th>Bono</th><th>Total</th></tr></thead>
        <tbody>${(calc.perEmployee??[]).map(r => `
          <tr>
            <td style="font-weight:600;color:var(--text-1)">${esc(r.name)}</td>
            <td>${r.days}</td>
            <td class="${r.lates>0?'num-negative':''}">${r.lates}</td>
            <td class="num-positive">${fmtMoney(r.earned)}</td>
            <td class="${r.discount>0?'num-negative':''}">${r.discount>0?'−'+fmtMoney(r.discount):'—'}</td>
            <td class="${r.bonus>0?'num-bonus':''}">${r.bonus>0?fmtMoney(r.bonus):'—'}</td>
            <td style="font-weight:700;color:var(--text-1)">${fmtMoney(r.total)}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot><tr><td>TOTAL</td><td></td><td></td><td></td><td></td><td></td><td>${fmtMoney(grand)}</td></tr></tfoot>
      </table>
    </div>`;
  openModal('modal-history');
}

/* ══════════════════════════════════════════
   CONFIGURACIÓN
══════════════════════════════════════════ */
function renderConfig() {
  const list = document.getElementById('emp-list');
  if (!state.employees.length) { list.innerHTML='<div class="empty-state">No hay empleados.</div>'; return; }
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

/* ══════════════════════════════════════════
   CLOSE WEEK MODAL
══════════════════════════════════════════ */
function openCloseWeekModal() {
  const week = state.currentWeek;
  if (!week || week.status !== 'open') return;
  const calc      = calculateWeek(week, state.employees, state.carryoverFund);
  const eligNames = calc.eligibles.map(id => state.employees.find(e=>e.id===id)?.name??'?').join(', ');
  let preview = `Propinas brutas: <strong>${fmtMoney(calc.grossTips)}</strong><br>
Neto a distribuir: <strong>${fmtMoney(calc.totalEarned)}</strong><br>
Fondo de puntualidad: <strong>${fmtMoney(calc.totalFund)}</strong><br>`;
  preview += calc.eligibles.length > 0
    ? `Bono para: <strong>${esc(eligNames)}</strong><br>Cada uno recibe: <strong>${fmtMoney(calc.totalFund/calc.eligibles.length)}</strong>`
    : `<span style="color:var(--yellow)">⚠ Nadie elegible — el fondo pasa a la siguiente semana.</span>`;
  document.getElementById('close-week-preview').innerHTML = preview;
  openModal('modal-close-week');
}

/* ══════════════════════════════════════════
   MODALS
══════════════════════════════════════════ */
function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

/* ══════════════════════════════════════════
   EXPORT
══════════════════════════════════════════ */
function exportCSV() {
  const week = state.currentWeek;
  const calc = calculateWeek(week, state.employees, state.carryoverFund);
  const rows = [
    ['Empleado','Días','Retardos','Ganado','Descuento','Bono','Total'],
    ...calc.perEmployee.map(r => [r.name, r.days, r.lates, r.earned.toFixed(2), r.discount.toFixed(2), r.bonus.toFixed(2), r.total.toFixed(2)]),
  ];
  const blob = new Blob([rows.map(r=>r.map(v=>`"${v}"`).join(',')).join('\n')], {type:'text/csv;charset=utf-8;'});
  downloadBlob(blob, `${week.label.replace(/[^a-z0-9]/gi,'_')}.csv`);
  toast('CSV exportado');
}
function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:'application/json'});
  downloadBlob(blob, `cocinaapp_backup_${Date.now()}.json`);
  toast('Respaldo exportado');
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a   = Object.assign(document.createElement('a'), {href:url, download:name});
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

/* ══════════════════════════════════════════
   TOAST
══════════════════════════════════════════ */
let toastTimer = null;
function toast(msg, dur = 2800) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), dur);
}

/* ══════════════════════════════════════════
   UTILS
══════════════════════════════════════════ */
function fmtMoney(n) {
  if (n == null || isNaN(n)) return '$0.00';
  return '$' + Number(n).toLocaleString('es-MX', {minimumFractionDigits:2, maximumFractionDigits:2});
}
function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ══════════════════════════════════════════
   MOBILE SIDEBAR
══════════════════════════════════════════ */
function initMobileNav() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const open  = () => { sidebar.classList.add('open');    overlay.classList.add('open'); };
  const close = () => { sidebar.classList.remove('open'); overlay.classList.remove('open'); };
  document.getElementById('menuBtn').addEventListener('click', open);
  document.getElementById('sidebar-close').addEventListener('click', close);
  overlay.addEventListener('click', close);
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => { if (window.innerWidth <= 768) close(); });
  });
}

/* ══════════════════════════════════════════
   EVENT BINDINGS
══════════════════════════════════════════ */
function bindEvents() {
  /* Login */
  document.getElementById('btn-login').addEventListener('click', doLogin);
  document.getElementById('login-pass').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
  document.getElementById('login-user').addEventListener('keydown', e => { if(e.key==='Enter') document.getElementById('login-pass').focus(); });
  document.getElementById('pass-toggle').addEventListener('click', () => {
    const inp = document.getElementById('login-pass');
    inp.type  = inp.type === 'password' ? 'text' : 'password';
  });

  /* Logout */
  document.getElementById('btn-logout').addEventListener('click', doLogout);

  /* Navigation */
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => navigate(item.dataset.view));
  });

  /* Dashboard */
  document.getElementById('btn-close-week').addEventListener('click', openCloseWeekModal);
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

  /* Week date */
  document.getElementById('week-date-input').addEventListener('input', e => updateDatePreview(e.target.value));
  document.getElementById('btn-save-week-date').addEventListener('click', applyWeekDate);

  /* Historial — selección y eliminación */
  document.getElementById('btn-toggle-select').addEventListener('click', enterSelectMode);

  document.getElementById('btn-cancel-select').addEventListener('click', exitSelectMode);

  document.getElementById('btn-delete-selected').addEventListener('click', () => {
    if (selectedHistoryIds.size === 0) return;
    const count = selectedHistoryIds.size;
    document.getElementById('del-history-text').textContent =
      `¿Eliminar ${count} semana${count>1?'s':''} del historial?`;
    pendingDeleteIds = [...selectedHistoryIds];
    openModal('modal-del-history');
  });

  document.getElementById('btn-confirm-del-history').addEventListener('click', async () => {
    closeModal('modal-del-history');
    if (!pendingDeleteIds.length) return;
    await deleteHistoryEntries(pendingDeleteIds);
    pendingDeleteIds = [];
    exitSelectMode();
    renderHistorial();
    toast(`Semana${pendingDeleteIds.length>1?'s':''} eliminada${pendingDeleteIds.length>1?'s':''} del historial`);
  });

  /* Add/Edit employee */
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
    closeModal('modal-emp'); editingEmpId = null;
    renderConfig(); updateFondoPill();
  });
  document.getElementById('emp-name-input').addEventListener('keydown', e => {
    if (e.key==='Enter') document.getElementById('btn-save-emp').click();
  });

  /* Delete employee */
  document.getElementById('btn-confirm-del-emp').addEventListener('click', async () => {
    if (!deletingEmpId) return;
    const name = state.employees.find(e=>e.id===deletingEmpId)?.name??'';
    setSyncState('syncing');
    await deleteEmployee(deletingEmpId);
    setSyncState('online');
    toast(`"${name}" eliminado`);
    deletingEmpId = null;
    closeModal('modal-del-emp'); renderConfig(); updateFondoPill();
  });

  /* Change password */
  document.getElementById('btn-change-pass').addEventListener('click', () => {
    ['old-pass-input','new-pass-input','new-pass-confirm'].forEach(id=>{document.getElementById(id).value='';});
    document.getElementById('change-pass-error').classList.remove('visible');
    openModal('modal-change-pass');
  });
  document.getElementById('btn-confirm-change-pass').addEventListener('click', doChangePassword);

  /* Export */
  document.getElementById('btn-export-csv').addEventListener('click', exportCSV);
  document.getElementById('btn-print').addEventListener('click', () => window.print());
  document.getElementById('btn-export-backup').addEventListener('click', exportBackup);

  /* Reset */
  document.getElementById('btn-reset').addEventListener('click', async () => {
    if (!confirm('¿Restaurar todos los datos? Esta acción es irreversible.')) return;
    setSyncState('syncing');
    state.employees     = DEFAULT_EMPLOYEES.map((n,i)=>({id:`emp_${i+1}`,name:n}));
    state.carryoverFund = 0;
    state.currentWeek   = createWeek();
    state.history       = [];
    await saveConfig(); await saveCurrentWeek();
    setSyncState('online');
    navigate('dashboard'); toast('Datos restaurados');
  });

  /* Modal close buttons */
  document.querySelectorAll('[data-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.modal));
  });
  document.querySelectorAll('.modal-overlay').forEach(ov => {
    ov.addEventListener('click', e => { if(e.target===ov) closeModal(ov.id); });
  });
  document.addEventListener('keydown', e => {
    if (e.key==='Escape') document.querySelectorAll('.modal-overlay.open').forEach(m => closeModal(m.id));
  });

  /* Connectivity */
  window.addEventListener('online',  () => setSyncState('online'));
  window.addEventListener('offline', () => setSyncState('offline'));
}

/* ══════════════════════════════════════════
   INIT
══════════════════════════════════════════ */
function init() {
  bindEvents();
  initMobileNav();
  initAuth();
}

init();
