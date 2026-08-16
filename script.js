/**
 * CocinaApp — script.js (versión final limpia)
 *
 * Funcionalidades:
 *  ✦ Login usuario/contraseña (Firestore)
 *  ✦ Fecha de semana editable manualmente
 *  ✦ 5 estados de asistencia: worked / late25 / late50 / late100 / off
 *  ✦ Descuentos: 0% / 25% / 50% / 100%
 *  ✦ Bono de puntualidad: ≥6 días trabajados + cero retardos
 *  ✦ Fondo de puntualidad con arrastre entre semanas
 *  ✦ Propinas brutas y netas en dashboard
 *  ✦ Historial con eliminación por semana
 *  ✦ Sincronización en tiempo real (Firebase)
 *  ✦ Responsive + soporte móvil
 */

import { initializeApp }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore, doc, getDoc, setDoc, deleteDoc,
  onSnapshot, collection, query, orderBy, getDocs,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getAuth, signInAnonymously, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

/* ─────────────────────────────────────────
   FIREBASE
───────────────────────────────────────── */
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

/* ─────────────────────────────────────────
   CONSTANTES
───────────────────────────────────────── */
const DAYS      = ['L','M','X','J','V','S','D'];
const DAY_NAMES = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];

// Estados de asistencia
const S = { WORKED:'worked', LATE25:'late25', LATE50:'late50', LATE100:'late100', OFF:'off' };
const STATUS_CYCLE = ['worked','late25','late50','late100','off'];
const STATUS_ICON  = { worked:'✓', late25:'!', late50:'!!', late100:'✗', off:'—' };
const STATUS_LABEL = {
  worked:'Trabajó',
  late25:'Tarde +10 min (−25%)',
  late50:'Tarde +30 min (−50%)',
  late100:'Tarde +60 min (−100%)',
  off:'Descanso',
};
const PENALTY = { worked:0, late25:0.25, late50:0.50, late100:1.00, off:0 };

// Para recibir el bono: mínimo 6 días trabajados (sin contar descansos) y cero retardos
const MIN_DAYS_BONUS = 6;

const DEFAULT_EMPLOYEES = ['Angy','Alexander','Hugo','Lili','Eider'];
const SESSION_KEY = 'cocinaapp_ok';

// Rutas Firestore
const P = {
  auth:    () => doc(db,'app','auth'),
  config:  () => doc(db,'app','config'),
  week:    () => doc(db,'app','currentWeek'),
  history: () => collection(db,'history'),
  hDoc:    (id) => doc(db,'history',id),
};

/* ─────────────────────────────────────────
   ESTADO EN MEMORIA
───────────────────────────────────────── */
let st = { employees:[], currentWeek:null, history:[], carryoverFund:0 };
let view          = 'dashboard';
let editEmpId     = null;
let delEmpId      = null;
let delHistId     = null;
let viewHistId    = null;
let saveTimer     = null;
let loggedIn      = false;

/* ─────────────────────────────────────────
   HELPERS DE UI
───────────────────────────────────────── */
const $  = (id) => document.getElementById(id);
const on = (id, ev, fn) => $(id).addEventListener(ev, fn);

function setLoadingText(t) { const e=$('loading-text'); if(e) e.textContent=t; }

function showLoading(t='Cargando…') {
  const e=$('loading-screen');
  e.style.display='flex'; e.classList.remove('hidden'); setLoadingText(t);
}
function hideLoading() {
  const e=$('loading-screen');
  e.classList.add('hidden');
  setTimeout(()=>e.style.display='none', 420);
}

function setSyncState(s) {
  const dot=document.querySelector('.sync-dot');
  const lbl=document.querySelector('.sync-label');
  if(!dot||!lbl) return;
  dot.className=`sync-dot${s==='online'?'':' '+s}`;
  lbl.textContent=s==='online'?'En línea':s==='syncing'?'Guardando…':'Sin conexión';
}

let toastTimer=null;
function toast(msg,dur=2800) {
  const e=$('toast'); e.textContent=msg; e.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>e.classList.remove('show'),dur);
}

function openModal(id)  { $(id)?.classList.add('open'); }
function closeModal(id) { $(id)?.classList.remove('open'); }

function fmtMoney(n) {
  if(n==null||isNaN(n)) return '$0.00';
  return '$'+Number(n).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2});
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString('es-MX',{day:'2-digit',month:'short'});
}
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ─────────────────────────────────────────
   AUTH
───────────────────────────────────────── */
function initAuth() {
  setLoadingText('Conectando…');
  onAuthStateChanged(auth, async user => {
    if (user) {
      if (sessionStorage.getItem(SESSION_KEY)==='ok') { await bootApp(); }
      else { hideLoading(); showLogin(); }
    } else {
      setLoadingText('Autenticando…');
      try { await signInAnonymously(auth); }
      catch(e) { console.error(e); hideLoading(); showLogin(); }
    }
  });
}

function showLogin() { $('login-screen').classList.add('visible'); $('login-user').focus(); }
function hideLogin() { $('login-screen').classList.remove('visible'); }

async function doLogin() {
  const user = $('login-user').value.trim().toLowerCase();
  const pass = $('login-pass').value;
  $('login-error').classList.remove('visible');
  if(!user||!pass) { showLoginErr('Completa usuario y contraseña.'); return; }

  const btn=$('btn-login'); btn.textContent='Verificando…'; btn.disabled=true;
  try {
    const snap = await getDoc(P.auth());
    if(!snap.exists()) {
      await setDoc(P.auth(),{username:'admin',password:'cocina2024'});
      showLoginErr('Primera vez: usuario "admin", contraseña "cocina2024"');
    } else {
      const c=snap.data();
      if(user===c.username.toLowerCase()&&pass===c.password) {
        sessionStorage.setItem(SESSION_KEY,'ok');
        hideLogin();
        await bootApp();
      } else { showLoginErr('Usuario o contraseña incorrectos.'); }
    }
  } catch(e) { console.error(e); showLoginErr('Error de conexión.'); }
  btn.textContent='Entrar'; btn.disabled=false;
}

function showLoginErr(msg) {
  const e=$('login-error'); e.textContent=msg; e.classList.add('visible');
}

function doLogout() {
  if(!confirm('¿Cerrar sesión?')) return;
  sessionStorage.removeItem(SESSION_KEY);
  loggedIn=false;
  $('app-shell').classList.remove('visible');
  showLogin();
  $('login-user').value='';
  $('login-pass').value='';
}

async function doChangePass() {
  const old=$('old-pass-input').value;
  const nw=$('new-pass-input').value;
  const cf=$('new-pass-confirm').value;
  const err=$('change-pass-error');
  err.classList.remove('visible');
  if(!old||!nw||!cf)    { err.textContent='Completa todos los campos.';   err.classList.add('visible'); return; }
  if(nw.length<6)       { err.textContent='Mínimo 6 caracteres.';          err.classList.add('visible'); return; }
  if(nw!==cf)           { err.textContent='Las contraseñas no coinciden.'; err.classList.add('visible'); return; }
  try {
    const c=(await getDoc(P.auth())).data();
    if(old!==c.password){ err.textContent='Contraseña actual incorrecta.'; err.classList.add('visible'); return; }
    await setDoc(P.auth(),{...c,password:nw});
    closeModal('modal-change-pass');
    ['old-pass-input','new-pass-input','new-pass-confirm'].forEach(id=>$(id).value='');
    toast('Contraseña actualizada');
  } catch(e) { err.textContent='Error al actualizar.'; err.classList.add('visible'); }
}

/* ─────────────────────────────────────────
   BOOT (después del login)
───────────────────────────────────────── */
async function bootApp() {
  showLoading('Cargando datos…');
  loggedIn=true;
  try {
    await loadFirestore();
    $('app-shell').classList.add('visible');
    navigate('dashboard');
  } catch(e) { console.error(e); toast('Error cargando datos'); }
  hideLoading();
}

/* ─────────────────────────────────────────
   FIRESTORE
───────────────────────────────────────── */
async function loadFirestore() {
  setSyncState('syncing');

  // Config (empleados + carryoverFund)
  const cfgSnap = await getDoc(P.config());
  if(cfgSnap.exists()) {
    const d=cfgSnap.data();
    st.employees=d.employees??[];
    st.carryoverFund=d.carryoverFund??0;
  } else {
    st.employees=DEFAULT_EMPLOYEES.map((n,i)=>({id:`emp_${i+1}`,name:n}));
    st.carryoverFund=0;
    await saveConfig();
  }

  // Semana actual
  const wkSnap = await getDoc(P.week());
  if(wkSnap.exists()) {
    st.currentWeek=wkSnap.data();
    migrateLateStatus(st.currentWeek);
  } else {
    st.currentWeek=makeWeek();
    await saveWeek();
  }

  // Historial
  await loadHistory();

  // Listeners tiempo real
  onSnapshot(P.week(), snap=>{
    if(!loggedIn||!snap.exists()) return;
    st.currentWeek=snap.data();
    migrateLateStatus(st.currentWeek);
    refreshUI();
  });
  onSnapshot(P.config(), snap=>{
    if(!loggedIn||!snap.exists()) return;
    const d=snap.data();
    st.employees=d.employees??[];
    st.carryoverFund=d.carryoverFund??0;
    refreshUI();
  });

  setSyncState('online');
}

// Migra estado antiguo 'late' → 'late25'
function migrateLateStatus(week) {
  if(!week?.attendance) return;
  let changed=false;
  Object.values(week.attendance).forEach(days=>{
    Object.keys(days).forEach(i=>{
      if(days[i]==='late'){days[i]='late25';changed=true;}
    });
  });
  if(changed) saveWeekDebounced();
}

async function loadHistory() {
  try {
    const q=query(P.history(),orderBy('startDate','desc'));
    st.history=(await getDocs(q)).docs.map(d=>d.data());
  } catch(e){ console.error(e); }
}

async function saveConfig() {
  try { await setDoc(P.config(),{employees:st.employees,carryoverFund:st.carryoverFund}); }
  catch(e){ console.error(e); }
}
async function saveWeek() {
  try { await setDoc(P.week(),st.currentWeek); }
  catch(e){ console.error(e); }
}
function saveWeekDebounced() {
  setSyncState('syncing');
  clearTimeout(saveTimer);
  saveTimer=setTimeout(async()=>{ await saveWeek(); setSyncState('online'); },600);
}
async function saveHistEntry(week) {
  try { await setDoc(P.hDoc(week.id),week); }
  catch(e){ console.error(e); }
}
async function deleteHistEntry(id) {
  await deleteDoc(P.hDoc(id));
  st.history=st.history.filter(w=>w.id!==id);
}

/* ─────────────────────────────────────────
   SEMANA
───────────────────────────────────────── */
function makeWeek(startDate=null) {
  const now=startDate?new Date(startDate):new Date();
  const id=`week_${Date.now()}`;
  const label=weekLabel(now);
  const attendance={};
  st.employees.forEach(emp=>{
    attendance[emp.id]={};
    DAYS.forEach((_,i)=>{ attendance[emp.id][i]=S.WORKED; });
  });
  const tips={};
  DAYS.forEach((_,i)=>{ tips[i]=0; });
  return {id,label,startDate:now.toISOString(),status:'open',attendance,tips,results:null};
}

function weekLabel(date) {
  const d=new Date(date); const e=new Date(d); e.setDate(d.getDate()+6);
  return `Semana ${fmtDate(d)} – ${fmtDate(e)}`;
}

// Modal editar fecha
function openWeekDateModal() {
  if(!st.currentWeek||st.currentWeek.status==='closed'){ toast('Semana cerrada, no editable'); return; }
  const d=new Date(st.currentWeek.startDate);
  $('week-date-input').value=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  updateDatePreview($('week-date-input').value);
  openModal('modal-week-date');
}
function updateDatePreview(val) {
  const p=$('date-preview');
  if(!val){ p.classList.remove('visible'); return; }
  const s=new Date(val+'T12:00:00'); const e=new Date(s); e.setDate(s.getDate()+6);
  p.textContent=`📅  ${fmtDate(s)} → ${fmtDate(e)}`;
  p.classList.add('visible');
}
async function applyWeekDate() {
  const val=$('week-date-input').value;
  if(!val){ toast('Selecciona una fecha'); return; }
  const ns=new Date(val+'T12:00:00');
  st.currentWeek.startDate=ns.toISOString();
  st.currentWeek.label=weekLabel(ns);
  setSyncState('syncing');
  await saveWeek();
  setSyncState('online');
  closeModal('modal-week-date');
  toast('Fecha actualizada');
  refreshUI();
}

/* ─────────────────────────────────────────
   CÁLCULOS
   Elegible para bono: ≥ MIN_DAYS_BONUS días + 0 retardos
───────────────────────────────────────── */
function calcWeek(week,employees,carryover) {
  const per={};
  employees.forEach(e=>{ per[e.id]={id:e.id,name:e.name,days:0,lates:0,earned:0,discount:0,bonus:0,total:0}; });

  let fundWeek=0, grossTips=0;

  DAYS.forEach((_,di)=>{
    const tip=Number(week.tips?.[di])||0;
    if(!tip) return;
    grossTips+=tip;

    const workers=employees.filter(e=>(week.attendance?.[e.id]?.[di]??S.WORKED)!==S.OFF);
    if(!workers.length) return;

    const share=tip/workers.length;
    workers.forEach(e=>{
      const st2=week.attendance?.[e.id]?.[di]??S.WORKED;
      const pen=PENALTY[st2]??0;
      per[e.id].days++;
      if(pen>0){
        per[e.id].lates++;
        const cut=share*pen;
        per[e.id].earned  +=share-cut;
        per[e.id].discount+=cut;
        fundWeek          +=cut;
      } else {
        per[e.id].earned+=share;
      }
    });
  });

  const totalFund=carryover+fundWeek;

  // Elegibles: días >= MIN_DAYS_BONUS Y cero retardos
  const eligibles=employees.filter(e=>per[e.id].days>=MIN_DAYS_BONUS&&per[e.id].lates===0);

  let carryNew=0;
  if(eligibles.length>0&&totalFund>0){
    const bs=totalFund/eligibles.length;
    eligibles.forEach(e=>{ per[e.id].bonus=bs; });
  } else {
    carryNew=totalFund; // nadie elegible → arrastra
  }

  let netTips=0;
  employees.forEach(e=>{ per[e.id].total=per[e.id].earned+per[e.id].bonus; netTips+=per[e.id].earned; });

  return {
    perEmployee:Object.values(per),
    grossTips, netTips,
    totalTips:netTips, // alias
    fundWeek, totalFund, carryNew,
    eligibles:eligibles.map(e=>e.id),
    minDays:MIN_DAYS_BONUS,
  };
}

/* ─────────────────────────────────────────
   OPERACIONES DE SEMANA
───────────────────────────────────────── */
async function closeWeek() {
  if(!st.currentWeek||st.currentWeek.status!=='open') return;
  const calc=calcWeek(st.currentWeek,st.employees,st.carryoverFund);
  st.currentWeek.results=calc;
  st.currentWeek.status='closed';
  await saveHistEntry(st.currentWeek);
  st.history.unshift(st.currentWeek);
  st.carryoverFund=calc.carryNew;
  await saveConfig();
  const nd=new Date(st.currentWeek.startDate);
  nd.setDate(nd.getDate()+7);
  st.currentWeek=makeWeek(nd);
  await saveWeek();
}

/* ─────────────────────────────────────────
   OPERACIONES DE EMPLEADOS
───────────────────────────────────────── */
async function addEmployee(name) {
  const id=`emp_${Date.now()}`;
  st.employees.push({id,name});
  if(st.currentWeek?.status==='open'){
    if(!st.currentWeek.attendance) st.currentWeek.attendance={};
    st.currentWeek.attendance[id]={};
    DAYS.forEach((_,i)=>{ st.currentWeek.attendance[id][i]=S.WORKED; });
    await saveWeek();
  }
  await saveConfig();
}
async function editEmployee(id,name) {
  const e=st.employees.find(x=>x.id===id); if(e) e.name=name;
  await saveConfig();
}
async function deleteEmployee(id) {
  st.employees=st.employees.filter(e=>e.id!==id);
  if(st.currentWeek?.attendance) delete st.currentWeek.attendance[id];
  await saveConfig(); await saveWeek();
}

/* ─────────────────────────────────────────
   NAVEGACIÓN
───────────────────────────────────────── */
function navigate(v) {
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));
  $(`view-${v}`)?.classList.add('active');
  document.querySelector(`.nav-item[data-view="${v}"]`)?.classList.add('active');
  view=v; renderView(v);
}
function renderView(v) {
  if(v==='dashboard') renderDashboard();
  else if(v==='planilla')  renderPlanilla();
  else if(v==='historial') renderHistorial();
  else if(v==='config')    renderConfig();
}
function refreshUI() {
  if(!loggedIn) return;
  renderView(view);
  updateFondoPill();
}

/* ─────────────────────────────────────────
   DASHBOARD
───────────────────────────────────────── */
function renderDashboard() {
  const wk=st.currentWeek; if(!wk) return;
  const c=calcWeek(wk,st.employees,st.carryoverFund);

  $('dash-week-text').textContent    = wk.label;
  $('sidebar-week-badge').textContent= wk.label;
  $('kpi-gross').textContent         = fmtMoney(c.grossTips);
  $('kpi-net').textContent           = fmtMoney(c.netTips);
  $('kpi-fondo').textContent         = fmtMoney(c.totalFund);
  $('kpi-empleados').textContent     = st.employees.length;
  $('kpi-elegibles').textContent     = c.eligibles.length;
  $('kpi-discount').textContent      = fmtMoney(c.fundWeek);

  const btn=$('btn-close-week');
  btn.textContent=wk.status==='closed'?'Semana cerrada':'Cerrar semana';
  btn.disabled   =wk.status==='closed';

  const wlb=$('dash-week-label');
  wlb.disabled=wk.status==='closed';
  wlb.title   =wk.status==='closed'?'Semana cerrada':'Cambiar fecha de semana';

  renderSummaryTable(c);
}

function renderSummaryTable(c) {
  const tbody=$('summary-tbody'), tfoot=$('summary-tfoot');
  if(!c?.perEmployee?.length){
    tbody.innerHTML='<tr><td colspan="7" class="empty-state">Sin datos aún.</td></tr>';
    tfoot.innerHTML=''; return;
  }
  tbody.innerHTML=c.perEmployee.map(r=>{
    const noElig=
      r.days<MIN_DAYS_BONUS&&r.lates>0?`${r.days}/7d · ${r.lates}ret`:
      r.days<MIN_DAYS_BONUS?`${r.days}/7 días`:
      r.lates>0?`${r.lates} retardo(s)`:'';
    return `<tr>
      <td style="font-weight:600;color:var(--text-1)">${esc(r.name)}</td>
      <td class="${r.days<MIN_DAYS_BONUS?'num-negative':'num-neutral'}">${r.days}</td>
      <td class="${r.lates>0?'num-negative':'num-neutral'}">${r.lates}</td>
      <td class="num-positive">${fmtMoney(r.earned)}</td>
      <td class="${r.discount>0?'num-negative':'num-neutral'}">${r.discount>0?'−'+fmtMoney(r.discount):'—'}</td>
      <td class="${r.bonus>0?'num-bonus':'num-neutral'}" title="${noElig}">${r.bonus>0?fmtMoney(r.bonus):noElig?'✗':'—'}</td>
      <td style="font-weight:700;color:var(--text-1)">${fmtMoney(r.total)}</td>
    </tr>`;
  }).join('');
  const grand=c.perEmployee.reduce((s,r)=>s+r.total,0);
  tfoot.innerHTML=`<tr><td>TOTAL</td><td></td><td></td><td></td><td></td><td></td><td>${fmtMoney(grand)}</td></tr>`;
}

function updateFondoPill() {
  if(!st.currentWeek) return;
  const c=calcWeek(st.currentWeek,st.employees,st.carryoverFund);
  $('topbar-fondo').textContent=`Fondo ${fmtMoney(c.totalFund)}`;
  $('kpi-fondo').textContent   =fmtMoney(c.totalFund);
}

/* ─────────────────────────────────────────
   PLANILLA
───────────────────────────────────────── */
function renderPlanilla() {
  const wk=st.currentWeek; if(!wk) return;
  const locked=wk.status==='closed';
  $('planilla-week-label').textContent=wk.label;
  const pill=$('planilla-status');
  pill.textContent=locked?'Cerrada':'Abierta';
  pill.className=`status-pill${locked?' closed':''}`;
  renderAttendance(wk,locked);
  renderTips(wk,locked);
}

function renderAttendance(wk,locked) {
  $('attendance-head').innerHTML=`<tr>
    <th class="emp-col">Empleado</th>
    ${DAYS.map((d,i)=>`<th title="${DAY_NAMES[i]}">${d}</th>`).join('')}
  </tr>`;
  $('attendance-body').innerHTML=st.employees.map(emp=>{
    const cells=DAYS.map((_,di)=>{
      const s=wk.attendance?.[emp.id]?.[di]??S.WORKED;
      return `<td class="status-cell${locked?' locked':''}"
                  data-emp="${emp.id}" data-day="${di}"
                  title="${DAY_NAMES[di]} — ${STATUS_LABEL[s]??s}">
                <div class="status-dot ${s}">${STATUS_ICON[s]??'?'}</div>
              </td>`;
    }).join('');
    return `<tr><td class="emp-name">${esc(emp.name)}</td>${cells}</tr>`;
  }).join('');

  if(!locked) {
    document.querySelectorAll('.status-cell').forEach(cell=>{
      cell.addEventListener('click',()=>cycleStatus(cell.dataset.emp,parseInt(cell.dataset.day)));
    });
  }
}

function cycleStatus(empId,dayIdx) {
  const wk=st.currentWeek; if(!wk||wk.status==='closed') return;
  if(!wk.attendance[empId]) wk.attendance[empId]={};
  const cur=wk.attendance[empId][dayIdx]??S.WORKED;
  const idx=STATUS_CYCLE.indexOf(cur);
  wk.attendance[empId][dayIdx]=STATUS_CYCLE[(idx+1)%STATUS_CYCLE.length];
  saveWeekDebounced();
  renderPlanilla();
  updateFondoPill();
}

function renderTips(wk,locked) {
  $('tips-grid').innerHTML=DAYS.map((_,i)=>`
    <div class="tip-cell">
      <div class="tip-day">${DAY_NAMES[i].substring(0,3)}</div>
      <input class="tip-input" type="number" inputmode="decimal"
             min="0" step="0.01" placeholder="$0"
             value="${wk.tips?.[i]>0?wk.tips[i]:''}"
             data-day="${i}" ${locked?'disabled':''} />
    </div>`).join('');

  if(!locked){
    document.querySelectorAll('.tip-input').forEach(inp=>{
      inp.addEventListener('input',()=>{
        st.currentWeek.tips[parseInt(inp.dataset.day)]=parseFloat(inp.value)||0;
        saveWeekDebounced();
        updateFondoPill();
        if(view==='dashboard') renderDashboard();
      });
    });
  }
}

/* ─────────────────────────────────────────
   HISTORIAL
───────────────────────────────────────── */
function renderHistorial() {
  const list=$('history-list');
  if(!st.history.length){ list.innerHTML='<div class="empty-state">No hay semanas cerradas aún.</div>'; return; }
  list.innerHTML=st.history.map(wk=>{
    const tot=wk.results?.perEmployee?.reduce((s,r)=>s+r.total,0)??0;
    return `<div class="history-card" data-wid="${wk.id}">
      <div class="history-card-info">
        <div class="history-card-title">${esc(wk.label)}</div>
        <div class="history-card-sub">Cerrada · ${wk.results?.perEmployee?.length??0} empleados</div>
      </div>
      <div class="history-card-right">
        <div class="history-card-amount">${fmtMoney(tot)}</div>
        <button class="history-card-del" data-del="${wk.id}" title="Eliminar">🗑</button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.history-card').forEach(card=>{
    card.addEventListener('click',e=>{
      if(e.target.closest('.history-card-del')) return;
      openHistModal(card.dataset.wid);
    });
  });
  list.querySelectorAll('.history-card-del').forEach(btn=>{
    btn.addEventListener('click',e=>{ e.stopPropagation(); promptDelHist(btn.dataset.del); });
  });
}

function promptDelHist(id) {
  const wk=st.history.find(w=>w.id===id); if(!wk) return;
  delHistId=id;
  $('del-history-label').textContent=wk.label;
  openModal('modal-del-history');
}

function openHistModal(id) {
  const wk=st.history.find(w=>w.id===id); if(!wk?.results) return;
  viewHistId=id;
  $('modal-history-title').textContent=wk.label;
  const c=wk.results;
  const grand=c.perEmployee?.reduce((s,r)=>s+r.total,0)??0;
  const gross=c.grossTips??c.totalTips??0;
  const net  =c.netTips  ??c.totalTips??0;
  const minD =c.minDays  ??MIN_DAYS_BONUS;

  $('modal-history-body').innerHTML=`
    <div class="history-detail-grid">
      <div class="hd-kpi"><div class="hd-kpi-label">Propinas brutas</div><div class="hd-kpi-value">${fmtMoney(gross)}</div></div>
      <div class="hd-kpi"><div class="hd-kpi-label">Propinas netas</div><div class="hd-kpi-value" style="color:var(--green)">${fmtMoney(net)}</div></div>
      <div class="hd-kpi"><div class="hd-kpi-label">Fondo generado</div><div class="hd-kpi-value">${fmtMoney(c.fundWeek??c.fundThisWeek??0)}</div></div>
      <div class="hd-kpi"><div class="hd-kpi-label">Fondo arrastrado</div><div class="hd-kpi-value">${fmtMoney(c.carryNew??c.newCarryFund??0)}</div></div>
    </div>
    <p style="font-size:11px;color:var(--text-3);margin-bottom:14px">Bono: mínimo ${minD} días trabajados + cero retardos</p>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Empleado</th><th>Días</th><th>Ret.</th><th>Ganado</th><th>Desc.</th><th>Bono</th><th>Total</th></tr></thead>
        <tbody>${(c.perEmployee??[]).map(r=>`
          <tr>
            <td style="font-weight:600;color:var(--text-1)">${esc(r.name)}</td>
            <td class="${r.days<minD?'num-negative':''}">${r.days}</td>
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

/* ─────────────────────────────────────────
   CONFIGURACIÓN
───────────────────────────────────────── */
function renderConfig() {
  const list=$('emp-list');
  if(!st.employees.length){ list.innerHTML='<div class="empty-state">No hay empleados.</div>'; return; }
  list.innerHTML=st.employees.map(e=>`
    <div class="emp-row">
      <div class="emp-row-name">${esc(e.name)}</div>
      <div class="emp-row-actions">
        <button class="emp-row-btn" data-edit="${e.id}">Editar</button>
        <button class="emp-row-btn del" data-del="${e.id}">Eliminar</button>
      </div>
    </div>`).join('');

  list.querySelectorAll('[data-edit]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const e=st.employees.find(x=>x.id===btn.dataset.edit); if(!e) return;
      editEmpId=e.id;
      $('modal-emp-title').textContent='Editar empleado';
      $('emp-name-input').value=e.name;
      openModal('modal-emp');
    });
  });
  list.querySelectorAll('[data-del]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const e=st.employees.find(x=>x.id===btn.dataset.del); if(!e) return;
      delEmpId=e.id;
      $('del-emp-name').textContent=e.name;
      openModal('modal-del-emp');
    });
  });
}

/* ─────────────────────────────────────────
   MODAL CERRAR SEMANA
───────────────────────────────────────── */
function openCloseWeekModal() {
  const wk=st.currentWeek; if(!wk||wk.status!=='open') return;
  const c=calcWeek(wk,st.employees,st.carryoverFund);
  const eligNames=c.eligibles.map(id=>st.employees.find(e=>e.id===id)?.name??'?').join(', ');

  const notElig=st.employees.filter(e=>!c.eligibles.includes(e.id)).map(e=>{
    const r=c.perEmployee.find(p=>p.id===e.id);
    if(!r) return null;
    const rs=[];
    if(r.days<MIN_DAYS_BONUS) rs.push(`${r.days}/7 días`);
    if(r.lates>0)             rs.push(`${r.lates} retardo(s)`);
    return rs.length?`${e.name} (${rs.join(', ')})`:null;
  }).filter(Boolean);

  let prev=`Propinas brutas: <strong>${fmtMoney(c.grossTips)}</strong><br>
Propinas netas: <strong>${fmtMoney(c.netTips)}</strong><br>
Fondo de puntualidad: <strong>${fmtMoney(c.totalFund)}</strong><br>`;

  prev += c.eligibles.length>0
    ? `Bono para: <strong>${esc(eligNames)}</strong><br>Cada uno recibe: <strong>${fmtMoney(c.totalFund/c.eligibles.length)}</strong>`
    : `<span style="color:var(--yellow)">⚠ Nadie elegible — el fondo pasa a la siguiente semana.</span>`;

  if(notElig.length)
    prev+=`<br><br><span style="color:var(--text-3);font-size:12px">Sin bono: ${notElig.map(esc).join(' · ')}</span>`;

  $('close-week-preview').innerHTML=prev;
  openModal('modal-close-week');
}

/* ─────────────────────────────────────────
   EXPORT
───────────────────────────────────────── */
function exportCSV() {
  const c=calcWeek(st.currentWeek,st.employees,st.carryoverFund);
  const rows=[
    ['Empleado','Días','Retardos','Ganado','Descuento','Bono','Total'],
    ...c.perEmployee.map(r=>[r.name,r.days,r.lates,r.earned.toFixed(2),r.discount.toFixed(2),r.bonus.toFixed(2),r.total.toFixed(2)]),
  ];
  const blob=new Blob([rows.map(r=>r.map(v=>`"${v}"`).join(',')).join('\n')],{type:'text/csv;charset=utf-8;'});
  dlBlob(blob,`${st.currentWeek.label.replace(/[^a-z0-9]/gi,'_')}.csv`);
  toast('CSV exportado');
}
function exportBackup() {
  dlBlob(new Blob([JSON.stringify(st,null,2)],{type:'application/json'}),`cocinaapp_backup_${Date.now()}.json`);
  toast('Respaldo exportado');
}
function dlBlob(blob,name) {
  const url=URL.createObjectURL(blob);
  const a=Object.assign(document.createElement('a'),{href:url,download:name});
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ─────────────────────────────────────────
   SIDEBAR MOBILE
───────────────────────────────────────── */
function initMobileNav() {
  const sb=$('sidebar'), ov=$('sidebar-overlay');
  const open =()=>{ sb.classList.add('open');    ov.classList.add('open'); };
  const close=()=>{ sb.classList.remove('open'); ov.classList.remove('open'); };
  on('menuBtn','click',open);
  on('sidebar-close','click',close);
  ov.addEventListener('click',close);
  document.querySelectorAll('.nav-item').forEach(it=>{
    it.addEventListener('click',()=>{ if(window.innerWidth<=768) close(); });
  });
}

/* ─────────────────────────────────────────
   BINDINGS DE EVENTOS
───────────────────────────────────────── */
function bindEvents() {
  // Login
  on('btn-login','click',doLogin);
  on('login-pass','keydown',e=>{ if(e.key==='Enter') doLogin(); });
  on('login-user','keydown',e=>{ if(e.key==='Enter') $('login-pass').focus(); });
  on('pass-toggle','click',()=>{
    const i=$('login-pass'); i.type=i.type==='password'?'text':'password';
  });

  // Logout
  on('btn-logout','click',doLogout);

  // Navegación
  document.querySelectorAll('.nav-item').forEach(it=>{
    it.addEventListener('click',()=>navigate(it.dataset.view));
  });

  // Dashboard
  on('btn-close-week','click',openCloseWeekModal);
  on('dash-week-label','click',openWeekDateModal);
  on('btn-confirm-close','click',async()=>{
    closeModal('modal-close-week');
    setSyncState('syncing');
    await closeWeek();
    await loadHistory();
    setSyncState('online');
    toast('Semana cerrada ✓');
    navigate('dashboard');
  });

  // Fecha de semana
  on('week-date-input','input',e=>updateDatePreview(e.target.value));
  on('btn-save-week-date','click',applyWeekDate);

  // Empleados
  on('btn-add-emp','click',()=>{
    editEmpId=null;
    $('modal-emp-title').textContent='Agregar empleado';
    $('emp-name-input').value='';
    openModal('modal-emp');
    setTimeout(()=>$('emp-name-input').focus(),300);
  });
  on('btn-save-emp','click',async()=>{
    const name=$('emp-name-input').value.trim();
    if(!name){ toast('Escribe un nombre'); return; }
    setSyncState('syncing');
    if(editEmpId){ await editEmployee(editEmpId,name); toast(`"${name}" actualizado`); }
    else         { await addEmployee(name);            toast(`"${name}" agregado`); }
    setSyncState('online');
    closeModal('modal-emp'); editEmpId=null;
    renderConfig(); updateFondoPill();
  });
  on('emp-name-input','keydown',e=>{ if(e.key==='Enter') $('btn-save-emp').click(); });

  on('btn-confirm-del-emp','click',async()=>{
    if(!delEmpId) return;
    const name=st.employees.find(e=>e.id===delEmpId)?.name??'';
    setSyncState('syncing');
    await deleteEmployee(delEmpId);
    setSyncState('online');
    toast(`"${name}" eliminado`);
    delEmpId=null; closeModal('modal-del-emp');
    renderConfig(); updateFondoPill();
  });

  // Historial — botón eliminar dentro del modal de detalle
  on('btn-delete-history-entry','click',()=>{
    if(viewHistId) promptDelHist(viewHistId);
  });
  on('btn-confirm-del-history','click',async()=>{
    if(!delHistId) return;
    const label=st.history.find(w=>w.id===delHistId)?.label??'';
    setSyncState('syncing');
    try {
      await deleteHistEntry(delHistId);
      setSyncState('online');
      toast(`${label} eliminada del historial`);
    } catch {
      setSyncState('online');
      toast('Error al eliminar.');
    }
    delHistId=null; viewHistId=null;
    closeModal('modal-del-history'); closeModal('modal-history');
    renderHistorial();
  });

  // Cambiar contraseña
  on('btn-change-pass','click',()=>{
    ['old-pass-input','new-pass-input','new-pass-confirm'].forEach(id=>$(id).value='');
    $('change-pass-error').classList.remove('visible');
    openModal('modal-change-pass');
  });
  on('btn-confirm-change-pass','click',doChangePass);

  // Export / Reset
  on('btn-export-csv','click',exportCSV);
  on('btn-print','click',()=>window.print());
  on('btn-export-backup','click',exportBackup);
  on('btn-reset','click',async()=>{
    if(!confirm('¿Restaurar todos los datos? Esta acción es irreversible.')) return;
    setSyncState('syncing');
    st.employees=DEFAULT_EMPLOYEES.map((n,i)=>({id:`emp_${i+1}`,name:n}));
    st.carryoverFund=0; st.currentWeek=makeWeek(); st.history=[];
    await saveConfig(); await saveWeek();
    setSyncState('online');
    navigate('dashboard'); toast('Datos restaurados');
  });

  // Cerrar modales
  document.querySelectorAll('[data-modal]').forEach(btn=>{
    btn.addEventListener('click',()=>closeModal(btn.dataset.modal));
  });
  document.querySelectorAll('.modal-overlay').forEach(ov=>{
    ov.addEventListener('click',e=>{ if(e.target===ov) closeModal(ov.id); });
  });
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape') document.querySelectorAll('.modal-overlay.open').forEach(m=>closeModal(m.id));
  });

  // Conectividad
  window.addEventListener('online', ()=>setSyncState('online'));
  window.addEventListener('offline',()=>setSyncState('offline'));
}

/* ─────────────────────────────────────────
   INIT
───────────────────────────────────────── */
function init() {
  bindEvents();
  initMobileNav();
  initAuth();
}

init();
