const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

/* Guard canvas gradient functions against non-finite values (NaN/undefined) */
if (typeof CanvasGradient !== 'undefined') {
  const _origAddColorStop = CanvasGradient.prototype.addColorStop;
  CanvasGradient.prototype.addColorStop = function (offset, color) {
    if (typeof offset !== 'number' || !Number.isFinite(offset)) return;
    return _origAddColorStop.call(this, offset, color);
  };
}

const _origCreateLinearGradient = CanvasRenderingContext2D.prototype.createLinearGradient;
CanvasRenderingContext2D.prototype.createLinearGradient = function (x0, y0, x1, y1) {
  if ([x0, y0, x1, y1].some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
    return { addColorStop: () => {} };
  }
  return _origCreateLinearGradient.call(this, x0, y0, x1, y1);
};

const _origCreateRadialGradient = CanvasRenderingContext2D.prototype.createRadialGradient;
CanvasRenderingContext2D.prototype.createRadialGradient = function (x0, y0, r0, x1, y1, r1) {
  if ([x0, y0, r0, x1, y1, r1].some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
    return { addColorStop: () => {} };
  }
  return _origCreateRadialGradient.call(this, x0, y0, r0, x1, y1, r1);
};

const today = () => new Date().toISOString().split('T')[0];

/* Multi-user auth */
let currentUser = null;
let users = [];

function loadGlobal(key, def) {
  try { return JSON.parse(localStorage.getItem(key)) || def; }
  catch { return def; }
}
function saveGlobal(key, data) { localStorage.setItem(key, JSON.stringify(data)); }

function loadUsers() { users = loadGlobal('users', []); }
function saveUsers() { saveGlobal('users', users); }
function loadCurrentUser() { currentUser = loadGlobal('currentUser', null); }
function saveCurrentUser() { saveGlobal('currentUser', currentUser); }

loadUsers();
loadCurrentUser();

const EXPORT_SCALE = Math.min(4, Math.max(1, window.devicePixelRatio || 1));
const EXPORT_WIDTH = 390;
const EXPORT_HEIGHT = 844;

function userKey(key) { return currentUser ? `u_${currentUser.id}_${key}` : key; }

const API_BASE = location.hostname === 'localhost' ? 'http://localhost:8081/api' : '/api';

function load(key, def) {
  try { return JSON.parse(localStorage.getItem(userKey(key))) || def; }
  catch { return def; }
}
function save(key, data) {
  localStorage.setItem(userKey(key), JSON.stringify(data));
  syncToBackend(key, data);
}

async function syncToBackend(key, data, action = 'sync') {
  if (!currentUser || ['users', 'currentUser'].includes(key)) return;
  try {
    await fetch(`${API_BASE}/sync/${currentUser.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, data, action })
    });
  } catch (err) {
    console.error('syncToBackend failed:', key, err.message);
  }
}

async function loadFromBackend() {
  if (!currentUser) return;
  try {
    const res = await fetch(`${API_BASE}/sync/${currentUser.id}`);
    const j = await res.json();
    const data = j.data || {};
    Object.keys(data).forEach((k) => {
      localStorage.setItem(userKey(k), JSON.stringify(data[k]));
    });
  } catch (err) {
    console.error('loadFromBackend failed:', err.message);
  }
}

function sanitizePhone(p) { return p.replace(/\D/g, ''); }

function showAuth() {
  $('authScreen').hidden = false;
  $('appBody').hidden = true;
}

function showApp() {
  $('authScreen').hidden = true;
  $('appBody').hidden = false;
}

function renderForCurrentUser() {
  if (!currentUser) return;
  applyProfile();
  renderDaily();
  renderMeetings();
  renderInspectionCategories();
  renderInspectionHistory();
  renderStaff();
  renderMilestones();
  renderHouses();
}

function initAuth() {
  if (currentUser) {
    showApp();
    loadFromBackend().then(() => {
      openDB().then(() => {
        renderPlans();
        renderForCurrentUser();
      }).catch(() => {});
    }).catch(() => {});
  } else {
    showAuth();
  }
}

$('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const phone = sanitizePhone($('regPhone').value);
  if (!phone) { alert('กรุณากรอกเบอร์โทร'); return; }
  if (users.some((u) => u.phone === phone)) { alert('เบอร์โทรนี้มีผู้ลงทะเบียนแล้ว'); return; }
  const id = 'u_' + phone + '_' + Date.now().toString(36).slice(-4);
  const user = {
    id,
    firstName: $('regFirstName').value.trim(),
    lastName: $('regLastName').value.trim(),
    position: $('regPosition').value.trim(),
    phone,
    project: $('regProject').value.trim() || ''
  };
  try {
    await fetch(`${API_BASE}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user)
    });
  } catch (err) {
    console.error('Backend registration failed (saved locally):', err);
  }
  users.push(user);
  saveUsers();
  currentUser = user;
  saveCurrentUser();
  $('registerForm').reset();
  initAuth();
});

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const phone = sanitizePhone($('loginPhone').value);
  if (!phone) { alert('กรุณากรอกเบอร์โทร'); return; }
  let user = users.find((u) => u.phone === phone);
  if (!user) {
    try {
      const res = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });
      if (!res.ok) { alert('ไม่พบผู้ใช้ กรุณาลงทะเบียน'); return; }
      const j = await res.json();
      const dbUser = j.user;
      if (!dbUser) { alert('ไม่พบผู้ใช้ กรุณาลงทะเบียน'); return; }
      user = {
        id: dbUser.id,
        firstName: dbUser.first_name,
        lastName: dbUser.last_name,
        position: dbUser.position,
        phone: dbUser.phone,
        project: dbUser.project || ''
      };
      users.push(user);
      saveUsers();
    } catch (err) {
      console.error('Backend login failed:', err);
      alert('ไม่พบผู้ใช้ กรุณาลงทะเบียน');
      return;
    }
  }
  currentUser = user;
  saveCurrentUser();
  $('loginForm').reset();
  initAuth();
});

$('showRegister').addEventListener('click', (e) => {
  e.preventDefault();
  $('loginFormView').hidden = true;
  $('registerFormView').hidden = false;
});

$('showLogin').addEventListener('click', (e) => {
  e.preventDefault();
  $('loginFormView').hidden = false;
  $('registerFormView').hidden = true;
});

function logout() {
  currentUser = null;
  saveGlobal('currentUser', null);
  location.reload();
}

if ($('logoutBtn')) {
  $('logoutBtn').addEventListener('click', logout);
}

/* Navigation */
const ADMIN_CODE = '501499';
let adminGateTarget = null;

const views = $$('.view');

const viewTitles = {
  menu: 'เมนูหลัก',
  daily: 'รายงานประจำวัน',
  meeting: 'บันทึกประชุม',
  checklist: 'เช็คลิสต์ตรวจงาน',
  plans: 'แบบแปลน',
  staff: 'ผู้ติดต่อ',
  milestones: 'งวด / ตารางตรวจงาน',
  houses: 'บ้าน / งวดงาน',
  history: 'ประวัติการใช้งาน',
  admin: 'จัดการระบบ (แอดมิน)'
};

function pushHistory(state) {
  if (history.state && history.state.view === state.view && history.state.docId === state.docId && history.state.subId === state.subId) return;
  history.pushState(state, '', '#' + (state.view === 'sub' ? 'sub-' + state.subId : state.view === 'pdf' ? 'pdf' : state.view));
}

function showView(name) {
  if (name === 'admin' && sessionStorage.getItem('adminUnlocked') !== '1') {
    adminGateTarget = 'admin';
    $('adminGate').hidden = false;
    return;
  }
  views.forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  $('inspectionModal').hidden = true;
  closePdf();
  if ($('topTitle')) $('topTitle').textContent = viewTitles[name] || name;
  if (!isPopping && history.state?.view !== name) {
    pushHistory({ view: name });
  }
  if (name === 'history') renderHistory();
}

function handleMenuGridClick(e) {
  const card = e.target.closest('.menu-card');
  if (!card) return;
  const target = card.dataset.view;
  if (target) showView(target);
}

if ($('menuGrid')) {
  $('menuGrid').addEventListener('click', handleMenuGridClick);
}

if ($('adminMenuGrid')) {
  $('adminMenuGrid').addEventListener('click', handleMenuGridClick);
}

if ($('adminGateForm')) {
  $('adminGateForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('adminCode').value;
    if (code !== ADMIN_CODE) {
      alert('รหัสแอดมินไม่ถูกต้อง');
      return;
    }
    sessionStorage.setItem('adminUnlocked', '1');
    $('adminGate').hidden = true;
    $('adminCode').value = '';
    populateAdminCategoryOptions();
    renderAdminDocs();
    showView(adminGateTarget || 'admin');
    adminGateTarget = null;
  });
}

if ($('closeAdminGate')) {
  $('closeAdminGate').addEventListener('click', () => {
    $('adminGate').hidden = true;
    $('adminCode').value = '';
    adminGateTarget = null;
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function resizeImage(file, maxWidth = 1200, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / Math.max(img.width, img.height));
        const w = Math.floor(img.width * scale);
        const h = Math.floor(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* Profile */
function openProfileModal() { $('profileModal').hidden = false; }
function closeProfileModal() { $('profileModal').hidden = true; }

function fillProfileToForm() {
  if (!currentUser) return;
  $('pFirstName').value = currentUser.firstName || '';
  $('pLastName').value = currentUser.lastName || '';
  $('pPosition').value = currentUser.position || '';
  $('pProject').value = currentUser.project || '';
}

function applyProfile() {
  if (!currentUser) return;
  $('dailyForeman').value = `${currentUser.firstName} ${currentUser.lastName}`.trim();
  if (currentUser.position) $('dailyForeman').value += ` (${currentUser.position})`;
  if ($('dailyProject')) $('dailyProject').value = currentUser.project || '';
}

$('openProfile').addEventListener('click', () => {
  fillProfileToForm();
  openProfileModal();
});

$('profileForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!currentUser) return;
  currentUser.firstName = $('pFirstName').value.trim();
  currentUser.lastName = $('pLastName').value.trim();
  currentUser.position = $('pPosition').value.trim();
  currentUser.project = $('pProject').value.trim();
  const idx = users.findIndex((u) => u.id === currentUser.id);
  if (idx >= 0) users[idx] = currentUser;
  saveUsers();
  saveCurrentUser();
  applyProfile();
  closeProfileModal();
});

/* Daily Report */
const dailyReports = load('dailyReports', []);
let attachedImages = [];

$('dailyDate').value = today();
applyProfile();

const TRADE_OPTIONS = [
  { value: 'ช่างปูน/ช่างก่อ-ฉาบ', label: 'ช่างปูน / ช่างก่อ-ฉาบ (Mason / Bricklayer / Plasterer)' },
  { value: 'ช่างเหล็ก', label: 'ช่างเหล็ก (Steel Fixer)' },
  { value: 'ช่างไม้แบบ', label: 'ช่างไม้แบบ (Formwork Carpenter)' },
  { value: 'ช่างคอนกรีต', label: 'ช่างคอนกรีต (Concrete Worker)' },
  { value: 'ช่างโครงสร้างเหล็ก', label: 'ช่างโครงสร้างเหล็ก (Structural Steel Fabricator)' },
  { value: 'ช่างกระเบื้อง/ช่างปูพื้น', label: 'ช่างกระเบื้อง / ช่างปูพื้น (Tiler / Flooring Installer)' },
  { value: 'ช่างฝ้าเพดานและผนังเบา', label: 'ช่างฝ้าเพดานและผนังเบา (Ceiling & Drywall Installer)' },
  { value: 'ช่างสี', label: 'ช่างสี (Painter)' },
  { value: 'ช่างอลูมิเนียมและกระจก', label: 'ช่างอลูมิเนียมและกระจก (Aluminum & Glass Installer)' },
  { value: 'ช่างไม้ตกแต่ง/ช่างบิ้วอิน', label: 'ช่างไม้ตกแต่ง / ช่างบิ้วอิน (Finish Carpenter)' },
  { value: 'ช่างกันซึม', label: 'ช่างกันซึม (Waterproofing Specialist)' },
  { value: 'ช่างไฟฟ้า', label: 'ช่างไฟฟ้า (Electrician)' },
  { value: 'ช่างประปาและสุขาภิบาล', label: 'ช่างประปาและสุขาภิบาล (Plumber)' },
  { value: 'ช่างแอร์/ช่างปรับอากาศ', label: 'ช่างแอร์ / ช่างปรับอากาศ (HVAC Technician)' },
  { value: 'ช่างระบบป้องกันอัคคีภัย', label: 'ช่างระบบป้องกันอัคคีภัย (Fire Protection Technician)' },
  { value: 'ช่างลิฟต์', label: 'ช่างลิฟต์ (Elevator Technician)' },
  { value: 'ช่างรั้วและงานภูมิทัศน์', label: 'ช่างรั้วและงานภูมิทัศน์ (Landscaper)' },
  { value: 'ช่างระบบระบายน้ำภายนอก', label: 'ช่างระบบระบายน้ำภายนอก (Drainage Worker)' },
  { value: 'ช่างเชื่อมทั่วไป', label: 'ช่างเชื่อมทั่วไป (General Welder)' },
  { value: 'กรรมกร/แรงงานทั่วไป', label: 'กรรมกร / แรงงานทั่วไป (General Laborer)' }
];

let manpowerRows = [];

function renderManpowerRows() {
  const box = $('manpowerRows');
  box.innerHTML = '';
  const opts = TRADE_OPTIONS.map((t) => `<option value="${t.value}">${t.label}</option>`).join('');
  manpowerRows.forEach((m, i) => {
    const row = document.createElement('div');
    row.className = 'mp-row';
    row.innerHTML = `
      <select class="mp-trade">
        <option value="" ${m.trade ? '' : 'selected'} disabled>เลือกประเภทคนงาน</option>
        ${opts}
      </select>
      <input type="number" class="mp-count" placeholder="จำนวน" min="0" value="${m.count || 0}">
      <button type="button" data-i="${i}" class="remove-manpower del" aria-label="ลบ">×</button>
    `;
    const trade = row.querySelector('.mp-trade');
    if (m.trade) trade.value = m.trade;
    box.appendChild(row);
  });
  updateMpTotal();
}

function syncManpowerRows() {
  const rows = $$('#manpowerRows .mp-row');
  manpowerRows = Array.from(rows).map((row) => ({
    trade: row.querySelector('.mp-trade').value,
    count: Number(row.querySelector('.mp-count').value) || 0
  }));
}

function addManpowerRow() {
  syncManpowerRows();
  manpowerRows.push({ trade: '', count: 0 });
  renderManpowerRows();
}

function collectManpower() {
  const rows = $$('#manpowerRows .mp-row');
  return Array.from(rows).map((row) => ({
    trade: row.querySelector('.mp-trade').value,
    count: Number(row.querySelector('.mp-count').value) || 0
  })).filter((m) => m.trade);
}

function updateMpTotal() {
  const total = collectManpower().reduce((a, m) => a + m.count, 0);
  $('mpTotal').textContent = total;
  return total;
}

$('manpowerRows').addEventListener('input', updateMpTotal);

$('addManpower').addEventListener('click', addManpowerRow);

$('manpowerRows').addEventListener('click', (e) => {
  if (e.target.classList.contains('remove-manpower')) {
    syncManpowerRows();
    manpowerRows.splice(Number(e.target.dataset.i), 1);
    renderManpowerRows();
  }
});

addManpowerRow();

function renderAttachedImages() {
  const box = $('dailyImagePreview');
  box.innerHTML = '';
  attachedImages.forEach((img, i) => {
    const div = document.createElement('div');
    div.className = 'thumb';
    div.innerHTML = `
      <img src="${img}" alt="รูป ${i + 1}">
      <button type="button" data-i="${i}" class="remove-img" aria-label="ลบรูป">×</button>
    `;
    box.appendChild(div);
  });
}

$('dailyImage').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  if (attachedImages.length + files.length > 6) {
    alert('จำกัดสูงสุด 6 รูป');
    e.target.value = '';
    return;
  }
  for (const file of files) {
    try {
      const dataUrl = await resizeImage(file);
      attachedImages.push(dataUrl);
    } catch (err) {
      alert('ไม่สามารถโหลดรูปได้');
    }
  }
  e.target.value = '';
  renderAttachedImages();
});

$('dailyImagePreview').addEventListener('click', (e) => {
  if (e.target.classList.contains('remove-img')) {
    attachedImages.splice(Number(e.target.dataset.i), 1);
    renderAttachedImages();
  }
});

function renderDaily() {
  const list = $('dailyList');
  list.innerHTML = '';
  if (!dailyReports.length) {
    list.innerHTML = '<li class="empty-list">ยังไม่มีรายงาน</li>';
    return;
  }
  dailyReports.forEach((r, i) => {
    const isMpArray = Array.isArray(r.mp);
    const total = isMpArray
      ? (r.mp || []).reduce((a, m) => a + Number(m.count), 0)
      : ((r.mp && Object.values(r.mp).reduce((a, b) => a + Number(b), 0)) || 0);
    const images = (r.images || []).map((src) => `<img src="${src}" class="report-thumb">`).join('');
    const mpList = isMpArray ? (r.mp || []).map((m) => `<li class="mp-summary-item">${escapeHtml(m.trade)}: <b>${m.count}</b> คน</li>`).join('') : '';
    const mpHtml = mpList ? `<div class="manpower-summary"><b>กำลังคน:</b><ul class="mp-summary-list">${mpList}</ul></div>` : '';
    const extraMaterialsHtml = r.extraMaterials ? `<div class="extra-materials-summary"><b>วัสดุที่ขอจัดซื้อ:</b> ${escapeHtml(r.extraMaterials)}</div>` : '';
    const notesHtml = r.notes ? `<div class="notes-summary"><b>โน้ต / หมายเหตุ:</b> ${escapeHtml(r.notes)}</div>` : '';
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="report-content" data-i="${i}">
        <strong>${r.date}</strong> — ${escapeHtml(r.project || '')}<br>
        <small>ผู้รายงาน: ${escapeHtml(r.foreman || '')} | รวมคนงาน: ${total} | อากาศ: ${escapeHtml(r.weather || '')}</small><br>
        <small><b>งานวันนี้:</b> ${escapeHtml(r.work || '')}</small><br>
        ${r.plan ? `<small><b>แผนพรุ่งนี้:</b> ${escapeHtml(r.plan)}</small><br>` : ''}
        ${r.issue ? `<small><b>ปัญหา:</b> ${escapeHtml(r.issue)}</small><br>` : ''}
        ${images ? `<div class="report-thumbs">${images}</div>` : ''}
        ${mpHtml}
        ${extraMaterialsHtml}
        ${notesHtml}
      </div>
      <div class="actions">
        <button data-i="${i}" class="share-report" type="button" title="แชร์รายงาน">แชร่รายงาน</button>
        <button data-i="${i}" class="export-report" type="button" title="ส่งออกรายงาน">ส่งออก</button>
        <button data-i="${i}" class="del" aria-label="ลบ">×</button>
      </div>
    `;
    list.appendChild(li);
  });
}

function generatePlaceholderImage(label, color) {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 420;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color || '#0a1628';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#e5f3ff';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, c.width / 2, c.height / 2 - 12);
  ctx.font = '16px sans-serif';
  ctx.fillStyle = '#7a9bb8';
  ctx.fillText('WD Construction Khon Kaen', c.width / 2, c.height / 2 + 22);
  return c.toDataURL('image/jpeg', 0.8);
}

function fillDemoData() {
  $('dailyDate').value = today();
  $('dailyForeman').value = currentUser ? `${currentUser.firstName} ${currentUser.lastName}` : 'สมชาย ใจดี';
  $('dailyProject').value = 'กาญจนาภิเษก ทาวน์โฮม';
  $('dailyPhase').value = '3';
  $('dailyPhaseFinish').value = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  $('dailyProgressPercent').value = '15';
  $('dailyProgressType').value = 'ช้ากว่าแผน';
  $('dailyWeather').value = 'แจ่มใส';
  $('dailyExtraMaterials').value = 'ขอซื้อปูนซีเมนต์เพิ่ม 10 กระสอบ, ทรายหยาบ 2 ตัน, และเปลี่ยนเหล็กปลอกเป็นขนาด 12 มม.';
  $('dailyNotes').value = 'หมายเหตุ: ช่วงเช้ามีประชุมรายงานความคืบหน้ากับวิศวกรควบคุมงาน ก่อนเริ่มงาน';
  $('dailyWork').value = 'เทพื้นคอนกรีตชั้น 1, ติดตั้งเหล็กเสริมคานคอดิน และเตรียมงานหลังคา';
  $('dailyPlan').value = 'พรุ่งนี้เทคอนกรีตคานชั้นบน ตรวจสอบระดับ และติดตั้งแบบหล่อหลังคา';
  $('dailyIssue').value = 'ฝนตกช่วงบ่าย 1 ชั่วโมง ทำให้หยุดงานชั่วคราว';
  manpowerRows = [
    { trade: 'กรรมกร/แรงงานทั่วไป', count: 8 },
    { trade: 'ช่างไฟฟ้า', count: 3 },
    { trade: 'ช่างปูน/ช่างก่อ-ฉาบ', count: 5 }
  ];
  renderManpowerRows();
  attachedImages = [
    generatePlaceholderImage('Site Photo 1', '#0a1628'),
    generatePlaceholderImage('Site Photo 2', '#0f3a5c')
  ];
  renderAttachedImages();
}

if ($('loadDemo')) {
  $('loadDemo').addEventListener('click', fillDemoData);
}

$('dailyForm').addEventListener('submit', (e) => {
  e.preventDefault();
  try {
    if (!$('dailyWeather').value) {
      alert('กรุณาเลือกสภาพอากาศ');
      return;
    }
    const report = {
      date: $('dailyDate').value,
      foreman: $('dailyForeman').value.trim(),
      project: $('dailyProject').value.trim(),
      phase: $('dailyPhase').value.trim(),
      phaseFinish: $('dailyPhaseFinish').value,
      progressPercent: $('dailyProgressPercent').value,
      progressType: $('dailyProgressType').value,
      mp: collectManpower(),
      work: $('dailyWork').value.trim(),
      plan: $('dailyPlan').value.trim(),
      weather: $('dailyWeather').value,
      issue: $('dailyIssue').value.trim(),
      extraMaterials: $('dailyExtraMaterials').value.trim(),
      notes: $('dailyNotes').value.trim(),
      images: attachedImages
    };
    dailyReports.unshift(report);
    save('dailyReports', dailyReports);
    renderDaily();
    const newItem = $('dailyList').firstElementChild;
    if (newItem) newItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('dailyForm').reset();
    attachedImages = [];
    renderAttachedImages();
    $('dailyDate').value = today();
    applyProfile();
    $('dailyWeather').value = '';
    manpowerRows = [];
    addManpowerRow();
    console.log('Daily report saved:', report);
  } catch (err) {
    console.error('dailyForm save failed:', err);
    alert('บันทึกไม่สำเร็จ: ' + err.message);
  }
});

$('dailyList').addEventListener('click', (e) => {
  const i = Number(e.target.dataset.i);
  if (e.target.classList.contains('del')) {
    dailyReports.splice(i, 1);
    save('dailyReports', dailyReports);
    renderDaily();
  } else if (e.target.classList.contains('export-report')) {
    openExport(i);
  } else if (e.target.classList.contains('share-report')) {
    openExport(i);
    setTimeout(() => $('shareLine').click(), 150);
  }
});

/* Meeting & Task Log */
const meetings = load('meetings', []);
$('meetingDate').value = today();

function renderMeetings() {
  const list = $('meetingList');
  list.innerHTML = '';
  meetings.forEach((m, i) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div>
        <strong>${m.date}</strong> — ${escapeHtml(m.topic)}<br>
        <small>คำสั่ง: ${escapeHtml(m.decision)} | ผู้รับผิดชอบ: ${escapeHtml(m.responsible)}</small>
      </div>
      <button data-i="${i}" class="del" aria-label="ลบ">×</button>
    `;
    list.appendChild(li);
  });
}

$('meetingForm').addEventListener('submit', (e) => {
  e.preventDefault();
  meetings.unshift({
    date: $('meetingDate').value,
    topic: $('meetingTopic').value.trim(),
    decision: $('meetingDecision').value.trim(),
    responsible: $('meetingResponsible').value.trim()
  });
  save('meetings', meetings);
  renderMeetings();
  $('meetingForm').reset();
  $('meetingDate').value = today();
});

$('meetingList').addEventListener('click', (e) => {
  if (e.target.classList.contains('del')) {
    meetings.splice(Number(e.target.dataset.i), 1);
    save('meetings', meetings);
    renderMeetings();
  }
});

/* Comprehensive Site Inspection Checklist */
const INSP_CATEGORIES = [
  {
    id: 'site-prep', label: '1. งานเตรียมพื้นที่และงานดิน', color: '#c9a227',
    subs: [
      { id: 'sp-1-1', label: '1.1 งานเคลียร์ริ่งและรื้อถอน',
        items: [
          { id: 'sp-1-1-01', label: 'การตรวจสอบเอกสารและใบอนุญาตรื้อถอน' },
          { id: 'sp-1-1-02', label: 'การตัดและย้ายระบบสาธารณูปโภค' },
          { id: 'sp-1-1-03', label: 'การสำรวจและวางแผนความปลอดภัย' },
          { id: 'sp-1-1-04', label: 'มาตรการป้องกันฝุ่นและเสียงรบกวน' },
          { id: 'sp-1-1-05', label: 'การตรวจสอบและรักษาสภาพหมุดเขตที่ดิน' },
          { id: 'sp-1-1-06', label: 'ลำดับขั้นตอนการรื้อถอนโครงสร้าง' },
          { id: 'sp-1-1-07', label: 'การคัดแยกและการจัดการขยะก่อสร้าง' },
          { id: 'sp-1-1-08', label: 'การขุดตอไม้และสิ่งกีดขวางใต้ดิน' },
          { id: 'sp-1-1-09', label: 'การปรับระดับดินและบดอัดเบื้องต้น' },
          { id: 'sp-1-1-10', label: 'การบันทึกภาพถ่ายและตรวจรับมอบพื้นที่' }
        ] },
      { id: 'sp-1-2', label: '1.2 งานสำรวจและงานผัง (Site Survey & Setting Out)',
        items: [
          { id: 'sp-1-2-01', label: 'การตรวจสอบหมุดหลักเขตที่ดินและโฉนด' },
          { id: 'sp-1-2-02', label: 'การสำรวจระดับความสูงต่ำของพื้นที่ (Topographic Survey)' },
          { id: 'sp-1-2-03', label: 'การกำหนดแนวแกนหลักของอาคาร (Axis Lines)' },
          { id: 'sp-1-2-04', label: 'การปักผังอาคารและกำหนดตำแหน่งเสาเข็ม (Setting Out / Pile Location)' },
          { id: 'sp-1-2-05', label: 'การทำผังไม้แนวระดับรอบอาคาร (Batter Board)' },
          { id: 'sp-1-2-06', label: 'การตรวจสอบตำแหน่งอ้างอิงระดับน้ำทะเลปานกลางหรือจุด Benchmark (BM)' },
          { id: 'sp-1-2-07', label: 'การตรวจสอบแนวร่นและระยะถอยร่นตามกฎหมายควบคุมอาคาร' },
          { id: 'sp-1-2-08', label: 'การสำรวจแนวท่อระบายน้ำและจุดเชื่อมต่อสาธารณูปโภคภายนอก' },
          { id: 'sp-1-2-09', label: 'การสำรวจสิ่งกีดขวางใต้ดินและบนดิน' },
          { id: 'sp-1-2-10', label: 'การทำบันทึกและส่งมอบหมุดสำรวจให้ผู้รับเหมาช่วงต่อ' }
        ] },
      { id: 'sp-1-3', label: '1.3 งานขุดดินหลุมฐานรากและคานคอดิน',
        items: [
          { id: 'sp-1-3-01', label: 'การตรวจสอบระดับความลึกและขนาดหลุมตามแบบวิศวกรรม' },
          { id: 'sp-1-3-02', label: 'การตรวจสอบชั้นดินและสภาพดินก้นหลุมว่ารับน้ำหนักได้ตามกำหนดหรือไม่' },
          { id: 'sp-1-3-03', label: 'การทำแนวกันดินพังหรือการดามดิน (Shoring/Bracing) กรณีขุดลึก' },
          { id: 'sp-1-3-04', label: 'การกำจัดน้ำขังและการสูบน้ำออกจากหลุมขุด' },
          { id: 'sp-1-3-05', label: 'การขุดแต่งก้นหลุมและปรับผิวหน้าดินให้เรียบ' },
          { id: 'sp-1-3-06', label: 'การทรายหยาบรองก้นหลุมและการบดอัด' },
          { id: 'sp-1-3-07', label: 'การเทคอนกรีตหยาบ (Lean Concrete) ป้องกันดินโคลนก้นหลุม' },
          { id: 'sp-1-3-08', label: 'การตรวจสอบตำแหน่งแนวศูนย์กลาง (Center Line) ของฐานรากก่อนเทคอนกรีต' },
          { id: 'sp-1-3-09', label: 'การขุดดินช่วงแนวคานคอดินและการปรับระดับท้องคาน' },
          { id: 'sp-1-3-10', label: 'การตรวจสอบความสะอาดและการเก็บเคลียร์เศษดินส่วนเกินออกจากพื้นที่' }
        ] },
      { id: 'sp-1-4', label: '1.4 งานถมดินบดอัดและปรับระดับพื้น',
        items: [
          { id: 'sp-1-4-01', label: 'การคัดเลือกและตรวจสอบคุณภาพดินถมให้ปราศจากเศษขยะและอินทรียวัตถุ' },
          { id: 'sp-1-4-02', label: 'การทดสอบค่าความหนาแน่นของดิน (Soil Compaction Test) เป็นระยะ' },
          { id: 'sp-1-4-03', label: 'การแบ่งชั้นถมและบดอัดทีละชั้นตามมาตรฐานวิศวกรรม (ไม่ถมหนาเกินไปต่อชั้น)' },
          { id: 'sp-1-4-04', label: 'การควบคุมความชื้นของดินก่อนและระหว่างการบดอัด' },
          { id: 'sp-1-4-05', label: 'การตรวจสอบระดับความสูงต่ำของพื้นดินให้ตรงตามแบบสถาปัตยกรรมและวิศวกรรม' },
          { id: 'sp-1-4-06', label: 'การใช้เครื่องจักรบดอัดให้เหมาะสมกับพื้นที่ (เช่น รถบดสั่นสะเทือน, แผ่นตบดิน)' },
          { id: 'sp-1-4-07', label: 'การบดอัดบริเวณรอบฐานราก คานคอดิน และแนวท่อใต้ดินอย่างระมัดระวัง' },
          { id: 'sp-1-4-08', label: 'การทดสอบการรับน้ำหนักของดินหลังบดอัดเสร็จ (Plate Bearing Test หรือ Field Density Test)' },
          { id: 'sp-1-4-09', label: 'การปรับแต่งผิวหน้าดินชั้นบนสุดให้เรียบสม่ำเสมอเพื่อเตรียมเทคอนกรีตหรือปูพื้น' },
          { id: 'sp-1-4-10', label: 'การทำความสะอาดและตรวจสอบความเรียบร้อยรอบพื้นที่ก่อนส่งมอบงานฐานรากขั้นต่อไป' }
        ] }
    ]
  },
  {
    id: 'structural', label: '2. งานโครงสร้าง', color: '#c9a227',
    subs: [
      { id: 'st-2-1', label: '2.1 งานเสาเข็ม',
        items: [
          { id: 'st-2-1-01', label: 'การตรวจสอบชนิด ขนาด และความยาวของเสาเข็มให้ตรงตามแบบวิศวกรรม' },
          { id: 'st-2-1-02', label: 'การตรวจสอบใบรับรองคุณภาพโรงงานและผลการทดสอบวัสดุเสาเข็ม' },
          { id: 'st-2-1-03', label: 'การกำหนดและตรวจสอบตำแหน่งจุดตอกหรือจุดเจาะสำรวจเสาเข็มทุกต้น' },
          { id: 'st-2-1-04', label: 'การตรวจสอบความพร้อมของเครื่องจักรและอุปกรณ์ตอกหรือเจาะเสาเข็ม' },
          { id: 'st-2-1-05', label: 'การควบคุมดิ่งและความตั้งฉากของเสาเข็มระหว่างดำเนินการ' },
          { id: 'st-2-1-06', label: 'การบันทึกค่าการจมตัวของเสาเข็ม (Set Record) ตามสูตรการตอก' },
          { id: 'st-2-1-07', label: 'การตรวจสอบความเสียหายของหัวเสาเข็มและตัวเสาเข็มหลังการติดตั้ง' },
          { id: 'st-2-1-08', label: 'การสกัดหัวเสาเข็มให้ได้ระดับความสูงที่ถูกต้องและเหลือเหล็กเส้นตามแบบ' },
          { id: 'st-2-1-09', label: 'การตรวจสอบความสมบูรณ์ของเนื้อเสาเข็ม (Pile Integrity Test)' },
          { id: 'st-2-1-10', label: 'การจัดทำแผนผังแสดงตำแหน่งเสาเข็มจริงหลังติดตั้งเสร็จ (As-built Drawing)' }
        ] },
      { id: 'st-2-2', label: '2.2 คอนกรีตหยาบและทรายหยาบรองก้นหลุม',
        items: [
          { id: 'st-2-2-01', label: 'การตรวจสอบความสะอาดและความแห้งของก้นหลุมก่อนเริ่มงาน' },
          { id: 'st-2-2-02', label: 'การกำหนดความหนาของชั้นทรายหยาบรองก้นหลุมตามแบบวิศวกรรม' },
          { id: 'st-2-2-03', label: 'การเกลี่ยและบดอัดทรายหยาบให้แน่นสม่ำเสมอทั่วก้นหลุม' },
          { id: 'st-2-2-04', label: 'การรดน้ำเพิ่มความชื้นและบดอัดซ้ำกรณีทรายแห้งเกินไป' },
          { id: 'st-2-2-05', label: 'การตรวจสอบระดับความสูงของชั้นทรายรองก้นหลุม' },
          { id: 'st-2-2-06', label: 'การตรวจสอบส่วนผสมและกำลังอัดของคอนกรีตหยาบ (Lean Concrete)' },
          { id: 'st-2-2-07', label: 'การเทคอนกรีตหยาบคลุมทรายเพื่อป้องกันดินโคลนปะปน' },
          { id: 'st-2-2-08', label: 'การเกลี่ยผิวหน้าคอนกรีตหยาบให้เรียบได้ระดับ' },
          { id: 'st-2-2-09', label: 'การบ่มคอนกรีตหยาบให้เซ็ตตัวอย่างถูกวิธี' },
          { id: 'st-2-2-10', label: 'การตรวจสอบความเรียบร้อยและความสะอาดก่อนเริ่มผูกเหล็กฐานราก' }
        ] },
      { id: 'st-2-3', label: '2.3 งานฐานรากและตอม่อ',
        items: [
          { id: 'st-2-3-01', label: 'การตรวจสอบขนาด ตำแหน่ง และระยะความลึกของแบบหล่อฐานรากและตอม่อ' },
          { id: 'st-2-3-02', label: 'การตรวจสอบขนาด ชนิด และระยะเรียงของเหล็กเสริมฐานรากและตอม่อตามแบบวิศวกรรม' },
          { id: 'st-2-3-03', label: 'การตรวจสอบระยะห่างคอนกรีตหุ้มเหล็ก (Concrete Cover) ด้วยลูกปูน' },
          { id: 'st-2-3-04', label: 'การตรวจสอบความสะอาดภายในแบบหล่อก่อนเทคอนกรีต' },
          { id: 'st-2-3-05', label: 'การตรวจสอบส่วนผสม กำลังอัด และการยุบตัว (Slump) ของคอนกรีตผสมเสร็จ' },
          { id: 'st-2-3-06', label: 'การควบคุมการเทและการจี้เขย่าคอนกรีต (Vibrate) เพื่อไม่ให้เกิดโพรง' },
          { id: 'st-2-3-07', label: 'การตรวจสอบระดับศูนย์กลาง (Center Line) และแนวดิ่งของเหล็กเดือย (Dowel Bars) ตอม่อ' },
          { id: 'st-2-3-08', label: 'การถอดแบบหล่อคอนกรีตตามระยะเวลาที่กำหนด' },
          { id: 'st-2-3-09', label: 'การบ่มคอนกรีตฐานรากและตอม่ออย่างถูกวิธีเพื่อป้องกันการแตกร้าว' },
          { id: 'st-2-3-10', label: 'การตรวจสอบความสมบูรณ์ของโครงสร้างหลังถอดแบบก่อนกลบดิน' }
        ] },
      { id: 'st-2-4', label: '2.4 งานคานคอดิน',
        items: [
          { id: 'st-2-4-01', label: 'การตรวจสอบระดับและแนวศูนย์กลางของคานคอดินให้ตรงตามแบบวิศวกรรม' },
          { id: 'st-2-4-02', label: 'การตรวจสอบความสะอาดและการปรับระดับผิวหน้าดินหรือทรายรองใต้ท้องคาน' },
          { id: 'st-2-4-03', label: 'การติดตั้งและค้ำยันแบบหล่อคานให้มั่นคงแข็งแรง ไม่โก่งตัวขณะเทคอนกรีต' },
          { id: 'st-2-4-04', label: 'การตรวจสอบขนาด ชนิด และจำนวนเหล็กเสริมคานคอดิน เหล็กปลอก และระยะทาบเหล็ก' },
          { id: 'st-2-4-05', label: 'การตรวจสอบระยะคอนกรีตหุ้มเหล็ก (Concrete Cover) ด้วยลูกปูนรักษาระยะ' },
          { id: 'st-2-4-06', label: 'การตรวจสอบการติดตั้งท่อหรือช่องลอดผ่านคานสำหรับระบบสุขาภิบาลตามแบบ' },
          { id: 'st-2-4-07', label: 'การควบคุมค่าการยุบตัว (Slump) และคุณภาพของคอนกรีตผสมเสร็จ' },
          { id: 'st-2-4-08', label: 'การเทและการจี้เขย่าคอนกรีต (Vibrate) อย่างทั่วถึงเพื่อป้องกันโพรงอากาศ' },
          { id: 'st-2-4-09', label: 'การถอดแบบหล่อคานคอดินตามระยะเวลาที่กำหนด' },
          { id: 'st-2-4-10', label: 'การบ่มคอนกรีตและตรวจสอบความเรียบร้อยของผิวคอนกรีตหลังถอดแบบ' }
        ] },
      { id: 'st-2-5', label: '2.5 งานพื้นคอนกรีตอัดแรงและพื้นหล่อในที่',
        items: [
          { id: 'st-2-5-01', label: 'การตรวจสอบระดับและความมั่นคงแข็งแรงของค้ำยันและแบบหล่อพื้น' },
          { id: 'st-2-5-02', label: 'การตรวจสอบชนิด ขนาด และระยะเรียงของแผ่นพื้นสำเร็จรูป (กรณีพื้นสำเร็จ)' },
          { id: 'st-2-5-03', label: 'การตรวจสอบเหล็กเสริมอัดแรงและเหล็กตะแกรงวیر์ดเมช (Wire Mesh)' },
          { id: 'st-2-5-04', label: 'การตรวจสอบระยะคอนกรีตหุ้มเหล็กและลูกปูนหนุนพื้น' },
          { id: 'st-2-5-05', label: 'การติดตั้งท่อร้อยสายไฟและระบบสุขาภิบาลในพื้นก่อนเทคอนกรีต' },
          { id: 'st-2-5-06', label: 'การตรวจสอบความสะอาดและการพรมน้ำทำความสะอาดผิวก่อนเท' },
          { id: 'st-2-5-07', label: 'การควบคุมค่าการยุบตัว (Slump) และคุณภาพของคอนกรีตผสมเสร็จ' },
          { id: 'st-2-5-08', label: 'การเท ปาดหน้า และขัดเรียบผิวคอนกรีตให้ได้ระดับตามกำหนด' },
          { id: 'st-2-5-09', label: 'การควบคุมการจี้เขย่าคอนกรีตไม่ให้เหล็กหรือท่อเคลื่อนตัว' },
          { id: 'st-2-5-10', label: 'การบ่มคอนกรีตพื้นอย่างถูกวิธีเพื่อป้องกันการแตกร้าวจากการหดตัว' }
        ] },
      { id: 'st-2-6', label: '2.6 งานเสาชั้น 1 และชั้น 2',
        items: [
          { id: 'st-2-6-01', label: 'การตรวจสอบตำแหน่ง แนวดิ่ง และฉากของเสาให้ตรงตามแบบวิศวกรรม' },
          { id: 'st-2-6-02', label: 'การตรวจสอบขนาด ชนิด และจำนวนเหล็กเสริมเสา รวมถึงระยะทาบเหล็ก' },
          { id: 'st-2-6-03', label: 'การตรวจสอบระยะคอนกรีตหุ้มเหล็ก (Concrete Cover) และการใส่ลูกปูนรักษาระยะ' },
          { id: 'st-2-6-04', label: 'การติดตั้งและค้ำยันแบบหล่อเสาให้มั่นคงแข็งแรง ป้องกันการแบะหรือโก่งตัว' },
          { id: 'st-2-6-05', label: 'การตรวจสอบความสะอาดภายในแบบหล่อเสาก่อนเทคอนกรีต (ช่องทำความสะอาดโคนเสา)' },
          { id: 'st-2-6-06', label: 'การควบคุมค่าการยุบตัว (Slump) และคุณภาพของคอนกรีตผสมเสร็จ' },
          { id: 'st-2-6-07', label: 'การควบคุมการเทและการจี้เขย่าคอนกรีต (Vibrate) ตั้งแต่โคนเสาจนถึงหัวเสาเพื่อป้องกันโพรง' },
          { id: 'st-2-6-08', label: 'การตรวจสอบระดับความสูงและแนวเหล็กเดือย (Dowel Bars) สำหรับเชื่อมต่อโครงสร้างชั้นถัดไป' },
          { id: 'st-2-6-09', label: 'การถอดแบบหล่อเสาตามระยะเวลาที่กำหนดอย่างระมัดระวัง' },
          { id: 'st-2-6-10', label: 'การบ่มคอนกรีตเสาอย่างถูกวิธีเพื่อรักษาing กำลังอัดและป้องกันการแตกร้าว' }
        ] },
      { id: 'st-2-7', label: '2.7 งานคานและพื้นชั้นบน',
        items: [
          { id: 'st-2-7-01', label: 'การตรวจสอบระดับความสูงและความมั่นคงของนั่งร้านและค้ำยันรับน้ำหนักคานและพื้น' },
          { id: 'st-2-7-02', label: 'การตรวจสอบแบบหล่อท้องคานและข้างคานให้ได้ระดับและแนวตรง' },
          { id: 'st-2-7-03', label: 'การตรวจสอบขนาด ชนิด และระยะเรียงของเหล็กเสริมคานและเหล็กเสริมพื้นชั้นบน' },
          { id: 'st-2-7-04', label: 'การตรวจสอบระยะทาบเหล็ก มุมดัด และระยะคอนกรีตหุ้มเหล็ก (Concrete Cover)' },
          { id: 'st-2-7-05', label: 'การติดตั้งท่อร้อยสายไฟ ท่อประปา และช่องเปิดต่างๆ ผ่านคานและพื้นตามแบบงานระบบ' },
          { id: 'st-2-7-06', label: 'การตรวจสอบความสะอาดและการพรมน้ำทำความสะอาดแบบหล่อก่อนเทคอนกรีต' },
          { id: 'st-2-7-07', label: 'การควบคุมค่าการยุบตัว (Slump) และคุณภาพของคอนกรีตผสมเสร็จสำหรับงานคานและพื้น' },
          { id: 'st-2-7-08', label: 'การเทคอนกรีตพร้อมกันอย่างต่อเนื่องและการจี้เขย่า (Vibrate) บริเวณคานและจุดทับหลังพื้น' },
          { id: 'st-2-7-09', label: 'การปาดหน้าและปรับระดับผิวพื้นชั้นบนให้เรียบได้สเปกตามกำหนด' },
          { id: 'st-2-7-10', label: 'การบ่มคอนกรีตคานและพื้นอย่างถูกวิธี และการควบคุมระยะเวลาถอดค้ำยันตามมาตรฐานวิศวกรรม' }
        ] },
      { id: 'st-2-8', label: '2.8 งานโครงหลังคา',
        items: [
          { id: 'st-2-8-01', label: 'การตรวจสอบระดับและความมั่นคงของแนวคานรับโครงหลังคาหรือเพลทเหล็กฝังหัวเสา' },
          { id: 'st-2-8-02', label: 'การตรวจสอบขนาด ชนิด และความหนาของเหล็กโครงสร้างหลังคา (เช่น เหล็กรูปพรรณ หรือโครงสำเร็จรูป) ให้ตรงตามแบบวิศวกรรม' },
          { id: 'st-2-8-03', label: 'การตรวจสอบมาตรฐานและคุณภาพรอยเชื่อมโครงสร้างหลังคาตามหลักวิศวกรรม' },
          { id: 'st-2-8-04', label: 'การตรวจสอบระยะพาด ระยะห่างของจันทันและแป (Akk/Purlin) ให้ถูกต้องตามข้อกำหนดของวัสดุมุงหลังคา' },
          { id: 'st-2-8-05', label: 'การพ่นสีกันสนิมหรือทาน้ำยากัลวาไนซ์เก็บรอยเชื่อมและโครงสร้างเหล็กทั้งหมด' },
          { id: 'st-2-8-06', label: 'การตรวจสอบความลาดเอียงของหลังคาให้เป็นไปตามข้อกำหนดเพื่อป้องกันน้ำรั่วซึม' },
          { id: 'st-2-8-07', label: 'การติดตั้งเหล็กค้ำยันแนวทแยง (Bracing) เพื่อเสริมความแข็งแรงและป้องกันโครงหลังคาบิดตัว' },
          { id: 'st-2-8-08', label: 'การตรวจสอบความแน่นหนาของการยึดโครงหลังคากับโครงสร้างคอนกรีตเสริมเหล็ก' },
          { id: 'st-2-8-09', label: 'การติดตั้งวัสดุกันความร้อนหรือแผ่นสะท้อนความร้อนใต้โครงหลังคา (ถ้ามีในแบบ)' },
          { id: 'st-2-8-10', label: 'การตรวจสอบความเรียบร้อยของโครงหลังคาทั้งหมดก่อนส่งมอบพื้นที่ให้ งานมุงหลังคา ต่อไป' }
        ] }
    ]
  },
  {
    id: 'arch-me', label: '3. งานสถาปัตยกรรมและงานระบบ', color: '#c9a227',
    subs: [
      { id: 'am-3-1', label: '3.1 งานก่อผนัง',
        items: [
          { id: 'am-3-1-01', label: 'การตรวจสอบแนว ระดับ และผังการก่อผนังตามแบบสถาปัตยกรรม' },
          { id: 'am-3-1-02', label: 'การแช่น้ำอิฐมอญหรือทำความสะอาดอิฐมวลเบาก่อนเริ่มก่อ' },
          { id: 'am-3-1-03', label: 'การตรวจสอบชนิดและสัดส่วนปูนก่อให้ตรงกับประเภทของอิฐ (เช่น อิฐมอญ อิฐมวลเบา)' },
          { id: 'am-3-1-04', label: 'การติดตั้งเหล็กหนวดกุ้ง (Wall Tie) เชื่อมระหว่างผนังกับเสาหรือผนังรับแรงทุกระยะชั้น' },
          { id: 'am-3-1-05', label: 'การเว้นระยะช่องเปิดสำหรับติดตั้งวงกบประตูและหน้าต่างตามแบบ' },
          { id: 'am-3-1-06', label: 'การควบคุมแนวดิ่ง ฉาก และความราบเรียบของผนังระหว่างปฏิบัติงาน' },
          { id: 'am-3-1-07', label: 'การติดตั้งทับหลัง (Lintel) คอนกรีตเสริมเหล็กเหนือช่องเปิดประตูและหน้าต่าง' },
          { id: 'am-3-1-08', label: 'การเว้นร่องและการใช้วัสดุยืดหยุ่นอุดรอยต่อระหว่างผนังกับโครงสร้างเสาเอ็น/คานเอ็น' },
          { id: 'am-3-1-09', label: 'การตรวจสอบการฝังท่อร้อยสายไฟและระบบสุขาภิบาลภายในผนังให้เรียบร้อย' },
          { id: 'am-3-1-10', label: 'การรดน้ำบ่มผนังอิฐหลังก่อเสร็จเพื่อป้องกันการแตกร้าวจากการสูญเสียความชื้นเร็วเกินไป' }
        ] },
      { id: 'am-3-2', label: '3.2 งานฉาบปูนผนัง',
        items: [
          { id: 'am-3-2-01', label: 'การทำความสะอาด พรมน้ำ หรือทารองพื้นผิวผนังก่อนฉาบ' },
          { id: 'am-3-2-02', label: 'การสกัดแต่งและอุดซ่อมร่องงานระบบท่อและสายไฟให้เรียบร้อย' },
          { id: 'am-3-2-03', label: 'การติดตั้งลวดตาข่ายกรงไก่บริเวณรอยต่อระหว่างผนังอิฐกับเสาหรือคานเพื่อกันรอยร้าว' },
          { id: 'am-3-2-04', label: 'การตั้งหมุดและตีเส้นกำหนดความหนาและระนาบผนัง (ปะหมุดจับเซี้ยม)' },
          { id: 'am-3-2-05', label: 'การติดตั้งฉากเหล็กตามมุมเสาและขอบวงกบเพื่อให้ได้ฉากและตรงแนว' },
          { id: 'am-3-2-06', label: 'การผสมปูนฉาบให้ถูกสัดส่วนตามประเภทของผนัง (อิฐมอญหรืออิฐมวลเบา)' },
          { id: 'am-3-2-07', label: 'การฉาบปูนรอบแรก (รองพื้น) และการฉาบปูนผิวหน้าให้เรียบเนียน' },
          { id: 'am-3-2-08', label: 'การตรวจสอบแนวดิ่ง ความราบเรียบ และความหนาของชั้นปูนฉาบ' },
          { id: 'am-3-2-09', label: 'การบ่มปูนฉาบด้วยน้ำอย่างต่อเนื่องเพื่อป้องกันการแตกร้าวจากการแห้งเร็วเกินไป' },
          { id: 'am-3-2-10', label: 'การตรวจสอบความเรียบร้อยและซ่อมแซมตำหนิผิวปูนฉาบก่อนส่งมอบงานทาสี' }
        ] },
      { id: 'am-3-3', label: '3.3 งานระบบประปาและสุขาภิบาล',
        items: [
          { id: 'am-3-3-01', label: 'การตรวจสอบแนวท่อและตำแหน่งจุดจ่ายน้ำหรือระบายน้ำตามแบบวิศวกรรมระบบ' },
          { id: 'am-3-3-02', label: 'การเลือกชนิดและขนาดของท่อ (เช่น PVC, PPR, HDPE) ให้ถูกต้องตามมาตรฐานการใช้งาน' },
          { id: 'am-3-3-03', label: 'การตรวจสอบระดับความลาดเอียงของท่อระบายน้ำทิ้งและท่อโสโครกเพื่อป้องกันการอุดตัน' },
          { id: 'am-3-3-04', label: 'การติดตั้งท่อรอดผ่านคานหรือโครงสร้างตามตำแหน่งที่วิศวกรกำหนด' },
          { id: 'am-3-3-05', label: 'การทดสอบแรงดันน้ำในท่อ (Hydrostatic Test) เพื่อตรวจสอบรอยรั่วซึมก่อนปิดงาน' },
          { id: 'am-3-3-06', label: 'การติดตั้งข้อต่อ วาล์ว และอุปกรณ์ยึดจับท่อ (Pipe Hanger/Support) ให้มั่นคงแข็งแรง' },
          { id: 'am-3-3-07', label: 'การติดตั้งถังเก็บน้ำ ปั๊มน้ำ และระบบบายพาส (Bypass) ให้ถูกต้องพร้อมใช้งาน' },
          { id: 'am-3-3-08', label: 'การติดตั้งบ่อดักไขมัน บ่อพักน้ำเสีย และถังบำบัดน้ำเสียสำเร็จรูปตามแบบ' },
          { id: 'am-3-3-09', label: 'การติดตั้งท่ออากาศ (Air Vent) สำหรับระบบสุขาภิบาลเพื่อป้องกันกลิ่นย้อน' },
          { id: 'am-3-3-10', label: 'การทำความสะอาด ทดสอบระบบการไหล และจัดทำแบบ As-built Drawing งานระบบ' }
        ] },
      { id: 'am-3-4', label: '3.4 งานระบบไฟฟ้าและสื่อสาร',
        items: [
          { id: 'am-3-4-01', label: 'การตรวจสอบแบบแปลนตำแหน่งจุดติดตั้งดวงโคม สวิตช์ และเต้ารับ' },
          { id: 'am-3-4-02', label: 'การเลือกใช้สายไฟ ขนาดท่อร้อยสาย และอุปกรณ์ไฟฟ้าตามมาตรฐาน' },
          { id: 'am-3-4-03', label: 'การเดินท่อร้อยสายไฟฝังผนัง ฝังพื้น หรือเดินลอยบนฝ้าอย่างเรียบร้อย' },
          { id: 'am-3-4-04', label: 'การร้อยสายไฟเข้าท่อและการตรวจสอบความต่อเนื่องของวงจรไฟฟ้า' },
          { id: 'am-3-4-05', label: 'การติดตั้งตู้ควบคุมไฟฟ้าหลัก (MDB) และตู้ย่อย (Consumer Unit) พร้อมเบรกเกอร์' },
          { id: 'am-3-4-06', label: 'การติดตั้งระบบสายดิน (Grounding System) และหลักดินตามมาตรฐานวิศวกรรม' },
          { id: 'am-3-4-07', label: 'การติดตั้งอุปกรณ์ป้องกันไฟดูด (RCBO/RCD) ในจุดเปียกชื้นหรือเสี่ยงอันตราย' },
          { id: 'am-3-4-08', label: 'การเดินระบบสายสื่อสาร อินเทอร์เน็ต โทรศัพท์ และสายสัญญาณโทรทัศน์' },
          { id: 'am-3-4-09', label: 'การทดสอบระบบไฟฟ้า วัดค่าความเป็นฉนวน และตรวจสอบการทำงานของวงจร' },
          { id: 'am-3-4-10', label: 'การทำป้ายชื่อวงจรที่ตู้ควบคุมและจัดทำแบบ As-built Drawing งานระบบไฟฟ้า' }
        ] },
      { id: 'am-3-5', label: '3.5 งานมุงหลังคาและฉนวนกันความร้อน',
        items: [
          { id: 'am-3-5-01', label: 'การตรวจสอบความเรียบร้อยของโครงหลังคาก่อนเริ่มมุง' },
          { id: 'am-3-5-02', label: 'การเลือกชนิด สี และขนาดของวัสดุมุงหลังคาให้ตรงตามแบบ' },
          { id: 'am-3-5-03', label: 'การตรวจสอบแนวการเรียงกระเบื้องและความลาดเอียงของหลังคา' },
          { id: 'am-3-5-04', label: 'การติดตั้งแผ่นสะท้อนความร้อนหรือฉนวนกันความร้อนใต้หลังคา' },
          { id: 'am-3-5-05', label: 'การยึดวัสดุมุงหลังคาด้วยตะปูเกลียวหรืออุปกรณ์ยึดตามมาตรฐานผู้ผลิต' },
          { id: 'am-3-5-06', label: 'การติดตั้งอุปกรณ์ประกอบหลังคา เช่น ครอบสันหลังคา ครอบข้าง และครอบตะเข้' },
          { id: 'am-3-5-07', label: 'การตรวจสอบระบบระบายอากาศใต้หลังคา (Roof Ventilation)' },
          { id: 'am-3-5-08', label: 'การป้องกันและการซีลรอยต่อจุดเสี่ยงรั่วซึมด้วยวัสดุกันซึมหรือแฟลชชิ่ง' },
          { id: 'am-3-5-09', label: 'การทำความสะอาดเศษวัสดุบนหลังคาหลังติดตั้งเสร็จ' },
          { id: 'am-3-5-10', label: 'การทดสอบการรั่วซึมของน้ำฝนก่อนส่งมอบงาน' }
        ] },
      { id: 'am-3-6', label: '3.6 งานฝ้าเพดาน',
        items: [
          { id: 'am-3-6-01', label: 'การตรวจสอบระดับความสูงและแนวเส้นอ้างอิงสำหรับติดตั้งโครงคร่าวฝ้าเพดาน' },
          { id: 'am-3-6-02', label: 'การเลือกชนิดและขนาดของวัสดุแผ่นฝ้า (เช่น ยิปซัม, สมาร์ทบอร์ด, อะคูสติก) ให้ตรงตามแบบ' },
          { id: 'am-3-6-03', label: 'การติดตั้งโครงคร่าวหลักและโครงคร่าวซอยด้วยระยะห่างตามมาตรฐานผู้ผลิต' },
          { id: 'am-3-6-04', label: 'การติดตั้งลวดแขวนโครงคร่าวและจุดยึดโครงสร้างด้านบนให้มั่นคงแข็งแรง' },
          { id: 'am-3-6-05', label: 'การตรวจสอบการเดินระบบงานต่างๆ เหนือฝ้าเพดาน (เช่น ท่อแอร์, สายไฟ) ก่อนปิดแผ่น' },
          { id: 'am-3-6-06', label: 'การติดตั้งแผ่นฉนวนกันความร้อนเหนือฝ้าเพดาน (ถ้ามีในแบบ)' },
          { id: 'am-3-6-07', label: 'การยึดแผ่นฝ้าเข้ากับโครงคร่าวด้วยสกรูในระยะที่เหมาะสมและหัวสกรูจมเสมอผิว' },
          { id: 'am-3-6-08', label: 'การเว้นระยะช่องเซอร์วิส (Access Panel) ในจุดที่ต้องบำรุงรักษา' },
          { id: 'am-3-6-09', label: 'การฉาบรอยต่อแผ่นฝ้า ยิปซัมด้วยปูนฉาบยิปซัมพร้อมติดเทปผ้าใยแก้วป้องกันรอยร้าว' },
          { id: 'am-3-6-10', label: 'การขัดแต่งผิวรอยต่อและหัวสกรูให้เรียบเนียนพร้อมสำหรับงานทาสีฝ้าเพดาน' }
        ] },
      { id: 'am-3-7', label: '3.7 งานปูกระเบื้องและพื้นผิว หินต่างๆ',
        items: [
          { id: 'am-3-7-01', label: 'การตรวจสอบความเรียบ ระดับ และความชื้นของพื้นผิวปูนปรับระดับก่อนปู' },
          { id: 'am-3-7-02', label: 'การคัดเลือกชนิด ลวดลาย ขนาด และสีของกระเบื้องหรือหินให้ตรงตามแบบ' },
          { id: 'am-3-7-03', label: 'การตรวจสอบการวางแนว (Layout) และจุดเริ่มต้นของการปูกระเบื้องเพื่อความสวยงาม' },
          { id: 'am-3-7-04', label: 'การเลือกใช้วัสดุกาวซีเมนต์หรือปูนกาวให้เหมาะสมกับชนิดและขนาดของกระเบื้อง/หิน' },
          { id: 'am-3-7-05', label: 'การผสมกาวซีเมนต์ตามสัดส่วนและมาตรฐานของผู้ผลิต' },
          { id: 'am-3-7-06', label: 'การใช้เกรียงหวีปาดกาวซีเมนต์ให้ทั่วถึงเพื่อป้องกันโพรงอากาศใต้กระเบื้อง' },
          { id: 'am-3-7-07', label: 'การเคาะปรับระดับและตรวจสอบความเรียบสม่ำเสมอระหว่างแผ่น' },
          { id: 'am-3-7-08', label: 'การเว้นร่องยาแนว (Joint) ตามขนาดที่เหมาะสมและได้แนวตรงสวยงาม' },
          { id: 'am-3-7-09', label: 'การทำความสะอาดคราบปูนกาวบนผิวกระเบื้อง/หิน และการยาแนวร่องยาแนว' },
          { id: 'am-3-7-10', label: 'การทำความสะอาดรอบสุดท้ายและการป้องกันรอยขีดข่วนหลังปูกระเบื้องเสร็จเรียบร้อย' }
        ] },
      { id: 'am-3-8', label: '3.8 งานติดตั้งวงกบประตูและหน้าต่าง',
        items: [
          { id: 'am-3-8-01', label: 'การตรวจสอบขนาด ตำแหน่ง และระดับของวงกบให้ตรงตามแบบสถาปัตยกรรม' },
          { id: 'am-3-8-02', label: 'การคัดเลือกชนิดและวัสดุของวงกบ (เช่น ไม้, อلومิเนียม, UPVC) ให้ถูกต้องตามสเปก' },
          { id: 'am-3-8-03', label: 'การตรวจสอบความตั้งฉาก แนวดิ่ง และฉากมุมของวงกบก่อนยึดติดตั้ง' },
          { id: 'am-3-8-04', label: 'การติดตั้งเหล็กหนวดกุ้งหรือสมบกยึดวงกบเข้ากับผนังอิฐอย่างแน่นหนา' },
          { id: 'am-3-8-05', label: 'การตรวจสอบการหนุนรองและการค้ำยันวงกบเพื่อป้องกันการบิดตัวขณะเทปูนกั้นหรืออุด' },
          { id: 'am-3-8-06', label: 'การอุดรอยต่อระหว่างวงกบกับผนังด้วยปูนเกราท์หรือวัสดุยืดหยุ่น (Sealant) ป้องกันการรั่วซึม' },
          { id: 'am-3-8-07', label: 'การตรวจสอบระดับความสูงของธรณีประตูและหน้าต่างให้ถูกต้องตามการใช้งาน' },
          { id: 'am-3-8-08', label: 'การติดตั้งทับหลังคอนกรีตเหนือวงกบเพื่อรับน้ำหนักผนังด้านบน' },
          { id: 'am-3-8-09', label: 'การทำความสะอาดคราบปูนหรือวัสดุก่อสร้างบนผิววงกบหลังติดตั้งเสร็จ' },
          { id: 'am-3-8-10', label: 'การตรวจสอบความเรียบร้อยและการเปิด-ปิดทดสอบการทำงานเบื้องต้นก่อนส่งมอบงานฉาบหรือทาสี' }
        ] },
      { id: 'am-3-9', label: '3.9 งานทาสี',
        items: [
          { id: 'am-3-9-01', label: 'การตรวจสอบความแห้งของผิวปูนและวัดค่าความชื้นให้อยู่ในเกณฑ์มาตรฐานก่อนทาสี' },
          { id: 'am-3-9-02', label: 'การทำความสะอาดพื้นผิว ขัดคราบปูน ฝุ่น คราบไขมัน และสิ่งสกปรกออกให้หมด' },
          { id: 'am-3-9-03', label: 'การอุดโป๊วรอยแตกร้าว รอยต่อ และรอยหัวสกรูด้วยวัสดุอุดโป๊วที่เหมาะสม' },
          { id: 'am-3-9-04', label: 'การขัดแต่งผิวบริเวณที่โป๊วให้เรียบเนียนเสมอกับผิวผนังเดิม' },
          { id: 'am-3-9-05', label: 'การทาสีรองพื้นปูนใหม่หรือปูนเก่า (Primer) เพื่อเสริมการยึดเกาะและป้องกันด่าง' },
          { id: 'am-3-9-06', label: 'การคัดเลือกชนิด สี และเฉดสีทาภายใน ภายนอก หรือโครงสร้างอื่นๆ ให้ตรงตามแบบสถาปัตยกรรม' },
          { id: 'am-3-9-07', label: 'การทาสีทับหน้า (Topcoat) ชั้นที่ 1 และทิ้งระยะเวลาให้แห้งสนิทตามข้อกำหนดของผู้ผลิต' },
          { id: 'am-3-9-08', label: 'การตรวจสอบจุดบกพร่องและเก็บงานซ่อมแซมผิวให้เรียบร้อยก่อนทาสีทับหน้ารอบสุดท้าย' },
          { id: 'am-3-9-09', label: 'การป้องกัน คลุม หรือติดเทปกาวในบริเวณที่ไม่ต้องการให้สีเปื้อน (เช่น พื้น วงกบประตูหน้าต่าง บัวเชิงผนัง)' },
          { id: 'am-3-9-10', label: 'การทำความสะอาดพื้นที่หลังงานเสร็จและตรวจสอบความสม่ำเสมอของเฉดสีทั้งหมด' }
        ] },
      { id: 'am-3-10', label: '3.10 งานติดตั้งสุขภัณฑ์และอุปกรณ์ไฟฟ้า',
        items: [
          { id: 'am-3-10-01', label: 'การตรวจสอบตำแหน่งและความพร้อมของจุดจ่ายน้ำ ท่อน้ำทิ้ง และจุดต่อสายไฟตามแบบ' },
          { id: 'am-3-10-02', label: 'การคัดเลือกชนิดและรุ่นของสุขภัณฑ์ (เช่น โถสุขภัณฑ์ อ่างล้างหน้า ก๊อกน้ำ ฝักบัว) ให้ตรงตามแบบ' },
          { id: 'am-3-10-03', label: 'การติดตั้งสุขภัณฑ์อย่างมั่นคงด้วยพุกและสกรูที่แข็งแรง พร้อมยาแนวขอบด้วยซิลิโคนกันน้ำ' },
          { id: 'am-3-10-04', label: 'การทดสอบการรั่วซึมของน้ำดีและระบบระบายน้ำทิ้งของสุขภัณฑ์ทุกจุด' },
          { id: 'am-3-10-05', label: 'การติดตั้งอุปกรณ์ห้องน้ำ เช่น ราวแขวนผ้า กระจกเงา ชั้นวางของ และที่ใส่กระดาษชำระ' },
          { id: 'am-3-10-06', label: 'การตรวจสอบความเรียบร้อยและระดับความสูงของการติดตั้งสวิตช์ เต้ารับ และแผงหน้ากาก' },
          { id: 'am-3-10-07', label: 'การติดตั้งดวงโคม โคมไฟดาวน์ไลท์ โคมไฟภายนอก และอุปกรณ์ส่องสว่างต่างๆ ตามแบบ' },
          { id: 'am-3-10-08', label: 'การต่อสายไฟและตรวจสอบขั้วสาย (Line, Neutral, Ground) ของอุปกรณ์ไฟฟ้าทุกจุดอย่างถูกต้องปลอดภัย' },
          { id: 'am-3-10-09', label: 'การทดสอบการทำงานของสวิตช์ เต้ารับ ระบบไฟแสงสว่าง และอุปกรณ์ไฟฟ้าทั้งหมด' },
          { id: 'am-3-10-10', label: 'การทำความสะอาดเก็บงาน คราบยาแนว และเศษวัสดุให้เรียบร้อยพร้อมส่งมอบบ้าน' }
        ] }
    ]
  },
  {
    id: 'finishing', label: '4. งานตกแต่งและเก็บรายละเอียด', color: '#c9a227',
    subs: [
      { id: 'fi-4-1', label: '4.1 ตรวจสอบ Defect งานสถาปัตย์',
        items: [
          { id: 'fi-4-1-01', label: 'การตรวจสอบรอยแตกร้าว รอยร้าวลายงา หรือผิวปูนฉาบที่ไม่เรียบเนียนตามผนังและเสา' },
          { id: 'fi-4-1-02', label: 'การตรวจสอบแนวดิ่ง ฉาก และความราบเรียบของผนังรวมถึงมุมห้องต่างๆ' },
          { id: 'fi-4-1-03', label: 'การตรวจสอบความเรียบร้อยของกระเบื้องพื้นและผนัง การเคาะหาโพรงใต้กระเบื้อง และความสม่ำเสมอของแนวร่องยาแนว' },
          { id: 'fi-4-1-04', label: 'การตรวจสอบการเปิด-ปิด บานพับ กลอน ลูกบิด และการซีลยาแนวซิลิโคนของประตูและหน้าต่างทุกบาน' },
          { id: 'fi-4-1-05', label: 'การตรวจสอบรอยขีดข่วน คราบกาว หรือรอยร้าวของกระจกประตู หน้าต่าง และบานกระจกเงา' },
          { id: 'fi-4-1-06', label: 'การตรวจสอบความสม่ำเสมอของเฉดสี รอยด่าง รอยเปื้อน หรือรอยคลื่นของสีทาภายในและภายนอก' },
          { id: 'fi-4-1-07', label: 'การตรวจสอบระดับความเรียบร้อย รอยต่อแผ่นฝ้า และช่องเซอร์วิสฝ้าเพดาน' },
          { id: 'fi-4-1-08', label: 'การตรวจสอบความแน่นหนา ความเรียบร้อย และการเก็บรอยต่อของบัวพื้น บัวฝ้า และคิ้วตกแต่ง' },
          { id: 'fi-4-1-09', label: 'การทดสอบการระบายน้ำของพื้นห้องน้ำและระเบียงว่าไม่มีน้ำขัง (Ponding Test)' },
          { id: 'fi-4-1-10', label: 'การทำบันทึกรายการข้อบกพร่อง (Punch List) ทั้งหมดเพื่อประสานงานให้ผู้รับเหมาแก้ไขให้เรียบร้อยก่อนส่งมอบงานงวดสุดท้าย' }
        ] },
      { id: 'fi-4-2', label: '4.2 ตรวจสอบระบบประปาซ้ำก่อนส่งมอบ',
        items: [
          { id: 'fi-4-2-01', label: 'ทดสอบแรงดันน้ำดี (Hydrostatic Test) ทุกจุดจ่ายน้ำเพื่อยืนยันว่าไม่มีรอยซึมตามข้อต่อ วาล์ว หรือเกลียวท่อ' },
          { id: 'fi-4-2-02', label: 'ตรวจสอบอัตราการไหลและความเร็วในการระบายน้ำทิ้งของอ่างล้างหน้า อ่างล้างจาน และพื้นห้องน้ำว่าไม่มีเศษปูนหรือวัสดุก่อสร้างตกค้างอุดตัน' },
          { id: 'fi-4-2-03', label: 'ทดสอบการทำงานจริงของปั๊มน้ำอัตโนมัติ แรงดันการตัดต่อ และระบบสำรองน้ำ (ถังเก็บน้ำและระบบบายพาส)' },
          { id: 'fi-4-2-04', label: 'ตรวจสอบระดับน้ำในฟลอร์เดรน (Floor Drain) และระบบท่ออากาศ (Air Vent) เพื่อป้องกันกลิ่นไม่พึงประสงค์ย้อนเข้าสู่ตัวบ้าน' },
          { id: 'fi-4-2-05', label: 'ตรวจสอบความเรียบร้อยของบ่อดักไขมันและถังบำบัดน้ำเสียว่าติดตั้งได้ระดับ ฝาปิดสนิท และระบบไหลเวียนทำงานสมบูรณ์' }
        ] },
      { id: 'fi-4-3', label: '4.3 ตรวจสอบระบบไฟฟ้าซ้ำก่อนส่งมอบ',
        items: [
          { id: 'fi-4-3-01', label: 'ทดสอบการตัดกระแสไฟฉุกเฉินของเครื่องตัดไฟรั่ว (RCBO / RCD) ในจุดเปียกชื้น เช่น ห้องน้ำและพื้นที่ติดตั้งเครื่องทำน้ำอุ่น' },
          { id: 'fi-4-3-02', label: 'ตรวจสอบค่าความต้านทานหลักดินและความถูกต้องของการต่อสายดิน (Grounding) ครบทุกวงจรเพื่อความปลอดภัยสูงสุด' },
          { id: 'fi-4-3-03', label: 'ตรวจสอบแรงดันไฟฟ้าและทดสอบการทำงานของเต้ารับทุกจุดด้วยเครื่องมือวัดกระแสไฟฟ้าว่ามีไฟมาครบทุกเฟส/ขั้ว' },
          { id: 'fi-4-3-04', label: 'ทดสอบการเปิด-ปิดสวิตช์และระบบแสงสว่างทุกดวงอย่างต่อเนื่องเพื่อตรวจสอบความเสถียรของโคมไฟและหลอดไฟ' },
          { id: 'fi-4-3-05', label: 'ตรวจสอบความถูกต้องและชัดเจนของป้ายสติ๊กเกอร์ระบุชื่อวงจรย่อยในตู้ Consumer Unit เพื่อความสะดวกในการใช้งานของผู้อยู่อาศัย' }
        ] },
      { id: 'fi-4-4', label: '4.4 งานทำความสะอาดใหญ่ก่อนส่งมอบบ้าน (Deep Cleaning)',
        items: [
          { id: 'fi-4-4-01', label: 'การเก็บกวาดเศษวัสดุก่อสร้างชิ้นใหญ่ ขยะ และกล่องบรรจุภัณฑ์ทั้งหมดออกจากตัวบ้านและพื้นที่รอบนอก' },
          { id: 'fi-4-4-02', label: 'การขูดและขจัดคราบปูน คราบกาว สี และซิลิโคนส่วนเกินตามพื้น ผนัง และขอบวงกบต่างๆ' },
          { id: 'fi-4-4-03', label: 'การทำความสะอาดกระจก หน้าต่าง และบานประตู พร้อมทั้งเช็ดรางเลื่อนและขอบยางให้ปราศจากฝุ่นและคราบน้ำยา' },
          { id: 'fi-4-4-04', label: 'การปัดหยากไย่และเช็ดทำความสะอาดฝ้าเพดาน ช่องลมแอร์ และโคมไฟทุกจุดทั่วบ้าน' },
          { id: 'fi-4-4-05', label: 'การเช็ดทำความสะอาดผนังและผิววอลเปเปอร์เพื่อขจัดคราบฝุ่นผงจากการขัดแต่งปูนฉาบหรือสีทา' },
          { id: 'fi-4-4-06', label: 'การทำความสะอาดและขัดล้างสุขภัณฑ์ อ่างล้างหน้า ฉากกั้นอาอาบน้ำ และกระเบื้องห้องน้ำทุกห้องอย่างละเอียด' },
          { id: 'fi-4-4-07', label: 'การทำความสะอาดตู้เคาน์เตอร์ครัวบิ้วอิน ทั้งบริเวณผิวภายนอกและเช็ดกวาดฝุ่นภายในลิ้นชักทุกช่อง' },
          { id: 'fi-4-4-08', label: 'การเช็ดทำความสะอาดหน้ากากสวิตช์ไฟ เต้ารับ ตู้คอนโทรลไฟฟ้า (Consumer Unit) และอุปกรณ์ไฟฟ้าอย่างระมัดระวัง' },
          { id: 'fi-4-4-09', label: 'การดูดฝุ่นและถูทำความสะอาดพื้นผิวทุกประเภท (กระเบื้อง ไม้ ลามิเนต หรือหิน) ด้วยน้ำยาที่เหมาะสมกับวัสดุ' },
          { id: 'fi-4-4-10', label: 'การล้างทำความสะอาดพื้นระเบียง ทางเดินรอบบ้าน และลานจอดรถ เพื่อเตรียมความพร้อมสำหรับนัดหมายตรวจรับบ้านรอบสุดท้าย' }
        ] }
    ]
  },
  {
    id: 'handover', label: '5. งานส่งมอบบ้าน', color: '#c9a227',
    subs: [
      { id: 'ho-5-1', label: '5.1 ตรวจรับงานรอบสุดท้ายและส่งมอบบ้านให้ลูกค้า',
        items: [
          { id: 'ho-5-1-01', label: 'การนำลูกค้าเดินตรวจความเรียบร้อยของบ้านทั้งหมด และยืนยันการแก้ไขข้อบกพร่องจากรอบที่แล้ว (Punch List) จนลูกค้าพึงพอใจ' },
          { id: 'ho-5-1-02', label: 'การสาธิตวิธีการใช้งานระบบต่างๆ ภายในบ้าน เช่น ตู้ควบคุมไฟฟ้า ปั๊มน้ำ ถังสำรองน้ำ และระบบรักษาความปลอดภัย' },
          { id: 'ho-5-1-03', label: 'การทดสอบและส่งมอบชุดกุญแจทั้งหมด คีย์การ์ด หรือการตั้งรหัสผ่านระบบ Smart Lock ร่วมกับลูกค้าพร้อมทำป้ายระบุชัดเจน' },
          { id: 'ho-5-1-04', label: 'การรวบรวมและส่งมอบเอกสารคู่มือการใช้งาน ใบรับประกันสินค้า ของอุปกรณ์ไฟฟ้า สุขภัณฑ์ และวัสดุต่างๆ ให้ลูกค้า' },
          { id: 'ho-5-1-05', label: 'การส่งมอบแบบก่อสร้างจริง (As-built Drawing) ทั้งโครงสร้าง สถาปัตย์ และงานระบบ เพื่อให้ลูกค้าใช้เป็นข้อมูลอ้างอิงในการต่อเติมหรือซ่อมบำรุง' },
          { id: 'ho-5-1-06', label: 'การส่งมอบวัสดุสำรองที่เหลือจากการก่อสร้าง (Spare Parts) เช่น กระเบื้องปูพื้นและผนัง สีทาบ้าน หรือวอลเปเปอร์ เผื่อการซ่อมแซมในอนาคต' },
          { id: 'ho-5-1-07', label: 'การชี้แจงระยะเวลาและเงื่อนไขการรับประกันผลงานก่อสร้าง (เช่น รับประกันโครงสร้าง 5 ปี รับประกันงานสถาปัตย์และงานระบบ 1 ปี)' },
          { id: 'ho-5-1-08', label: 'การแจ้งช่องทางการติดต่อฝ่ายบริการหลังการขาย (After-Sales Service) และขั้นตอนการแจ้งซ่อมในระยะเวลารับประกัน' },
          { id: 'ho-5-1-09', label: 'การส่งมอบเอกสารสำคัญที่เกี่ยวข้อง เช่น ใบอนุญาตก่อสร้าง ทะเบียนบ้าน หรือเอกสารประสานงานการโอนเปลี่ยนชื่อมิเตอร์น้ำ-ไฟ' },
          { id: 'ho-5-1-10', label: 'การให้ลูกค้าลงนามในเอกสารรับมอบงาน (Handover Certificate) อย่างเป็นทางการ พร้อมถ่ายภาพร่วมกันเพื่อปิดจบโครงการ' }
        ] },
      { id: 'ho-5-2', label: '5.2 จัดเตรียมเอกสารคู่มือและใบรับประกันต่างๆ',
        items: [
          { id: 'ho-5-2-01', label: 'การรวบรวมคู่มือการใช้งานเครื่องใช้ไฟฟ้าและอุปกรณ์อิเล็กทรอนิกส์ทั้งหมด เช่น เครื่องปรับอากาศ ปั๊มน้ำ เครื่องทำน้ำอุ่น และเตาไฟฟ้า' },
          { id: 'ho-5-2-02', label: 'การจัดเตรียมใบรับประกันสินค้าและอุปกรณ์ต่างๆ พร้อมระบุวันที่เริ่มรับประกันให้ชัดเจน' },
          { id: 'ho-5-2-03', label: 'การจัดทำคู่มือบำรุงรักษาบ้านประจำปี (Home Maintenance Manual) เช่น วิธีล้างแผ่นกรองแอร์ การเช็ควาล์วน้ำ และการทำความสะอาดถังดักไขมัน' },
          { id: 'ho-5-2-04', label: 'การรวบรวมแคตตาล็อกสีทาบ้าน รหัสสี และตัวอย่างกระเบื้องสำรองเผื่อใช้ซ่อมแซมในอนาคต' },
          { id: 'ho-5-2-05', label: 'การจัดเตรียมแบบ As-built Drawing ของงานโครงสร้าง สถาปัตยกรรม ระบบไฟฟ้า และระบบสุขาภิบาล' },
          { id: 'ho-5-2-06', label: 'การรวบรวมใบรับประกันงานโครงสร้างและงานระบบจากผู้รับเหมาหรือวิศวกรผู้ควบคุมงาน' },
          { id: 'ho-5-2-07', label: 'การรวบรวมเอกสารคู่มือการใช้งานและการตั้งค่าระบบความปลอดภัย เช่น สัญญาณกันขโมย กล้องวงจรปิด หรือดิจิตอลดอร์ล็อก' },
          { id: 'ho-5-2-08', label: 'การจัดเตรียมเอกสารคู่มือและใบรับประกันทั้งหมดใส่แฟ้มหรือจัดทำรูปแบบดิจิทัล (PDF/Cloud) ให้ลูกค้าใช้งานได้สะดวก' },
          { id: 'ho-5-2-09', label: 'การตรวจสอบความครบถ้วนของเอกสารทั้งหมดเทียบกับรายการอุปกรณ์จริงที่ติดตั้งภายในบ้าน' },
          { id: 'ho-5-2-10', label: 'การจัดระเบียบเอกสารให้เรียบร้อย พร้อมส่งมอบให้ลูกค้าในวันนัดหมายตรวจรับบ้านรอบสุดท้าย' }
        ] },
      { id: 'ho-5-3', label: '5.3 ส่งมอบกุญแจและเซ็นเอกสารโอนสิทธิ์ให้ลูกค้า',
        items: [
          { id: 'ho-5-3-01', label: 'การตรวจสอบความครบถ้วนของชุดกุญแจประตู หน้าต่าง และรีโมทประตูรั้ว/โรงรถทั้งหมด พร้อมป้ายระบุตำแหน่ง' },
          { id: 'ho-5-3-02', label: 'การส่งมอบคีย์การ์ด รหัสผ่านดิจิตอลดอร์ล็อก (Digital Door Lock) และการเปลี่ยนรหัสผ่านเริ่มต้นให้เป็นของลูกค้า' },
          { id: 'ho-5-3-03', label: 'การเตรียมเอกสารหนังสือส่งมอบบ้านและใบรับรองการตรวจรับงานงวดสุดท้ายให้พร้อมลงนาม' },
          { id: 'ho-5-3-04', label: 'การลงนามในเอกสารส่งมอบสิทธิ์และการโอนกรรมสิทธิ์ระหว่างผู้รับเหมา/เจ้าของโครงการกับลูกค้าอย่างเป็นทางการ' },
          { id: 'ho-5-3-05', label: 'การทำบันทึกแนบท้ายสัญญาหรือเอกสารยืนยันการเก็บงานเก็บรายละเอียด (ถ้ายังมีค้างเล็กน้อย) พร้อมกำหนดเวลาแล้วเสร็จ' },
          { id: 'ho-5-3-06', label: 'การถ่ายภาพที่ระลึกร่วมกับลูกค้าในการส่งมอบบ้านเพื่อเป็นหลักฐานและแสดงความยินดี' },
          { id: 'ho-5-3-07', label: 'การตรวจสอบการชำระเงินงวดสุดท้ายหรือยอดคงค้างตามสัญญาให้เรียบร้อยสมบูรณ์' },
          { id: 'ho-5-3-08', label: 'การมอบของที่ระลึกแสดงความยินดีในโอกาสขึ้นบ้านใหม่หรือรับมอบบ้านจากโครงการ' },
          { id: 'ho-5-3-09', label: 'การอำลาและแจ้งความพร้อมในการดูแลช่วยเหลือผ่านช่องทางบริการหลังการขาย' },
          { id: 'ho-5-3-10', label: 'การจัดเก็บสำเนาเอกสารทั้งหมดที่ลงนามแล้วเข้าแฟ้มประวัติโครงการเพื่อเป็นหลักฐานอ้างอิงทางกฎหมาย' }
        ] }
    ]
  }
];

let inspectionState = load('inspectionState', {});
let inspectionHistory = load('inspectionHistory', []);
let currentSubId = null;
let isPopping = false;

function subById(subId) {
  for (const cat of INSP_CATEGORIES) {
    for (const sub of cat.subs) {
      if (sub.id === subId) return sub;
    }
  }
  return null;
}

function itemById(itemId) {
  for (const cat of INSP_CATEGORIES) {
    for (const sub of cat.subs) {
      for (const item of sub.items) {
        if (item.id === itemId) return item;
      }
    }
  }
  return null;
}

function itemDocButtons(itemId) {
  if (!adminDocCache) return '';
  const docs = adminDocCache.filter((d) => d.taskId === itemId);
  if (!docs.length) return '';
  return `
    <button type="button" class="view-item-doc" data-itemid="${itemId}">
      📄 เอกสารอ้างอิง (${docs.length})
    </button>
  `;
}

function renderInspectionCategories() {
  const container = $('inspectionCategories');
  container.innerHTML = '';
  INSP_CATEGORIES.forEach((cat) => {
    const card = document.createElement('div');
    card.className = 'insp-category';
    card.innerHTML = `<h3>${escapeHtml(cat.label)}</h3>${categoryDocButtons(cat.id)}`;
    const grid = document.createElement('div');
    grid.className = 'insp-subs';
    cat.subs.forEach((sub) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'insp-sub';
      btn.dataset.sub = sub.id;
      btn.textContent = sub.label;
      grid.appendChild(btn);
    });
    card.appendChild(grid);
    container.appendChild(card);
  });
}

function renderSubDetail(sub) {
  const box = $('inspectionList');
  if (!box) return;
  box.innerHTML = subDocButtons(sub.id) || '';
  sub.items.forEach((item) => {
    const itemDocs = (adminDocCache || []).filter((d) => d.taskId === item.id);
    const docBtn = itemDocs.length
      ? `<button type="button" class="view-item-doc" data-itemid="${item.id}">📄 เอกสารอ้างอิง (${itemDocs.length})</button>`
      : '';
    box.innerHTML += `
      <div class="foundation-item">
        <div class="f-item-row">
          <div class="f-item-label">${item.label}</div>
          ${docBtn}
        </div>
      </div>
    `;
  });
}

function openSubDetail(subId, fromPop = false) {
  const sub = subById(subId);
  if (!sub) return;
  currentSubId = subId;
  $('inspectionTitle').textContent = sub.label;
  renderSubDetail(sub);
  if ($('saveInspection')) $('saveInspection').hidden = true;
  $('inspectionModal').hidden = false;
  if (!fromPop) {
    pushHistory({ view: 'sub', subId: sub.id });
  }
  const subDocs = (adminDocCache || []).filter((d) => d.subId === sub.id && !d.taskId);
  if (subDocs.length === 1 && !fromPop) {
    viewAdminDocById(subDocs[0].id);
  }
}

function openSubPdf(subId) {
  const sub = subById(subId);
  if (!sub) return;
  showView('checklist');
  openSubDetail(subId);
}

function closeInspection() {
  history.back();
}

function renderInspection(sub) {
  const box = $('inspectionList');
  box.innerHTML = subDocButtons(sub.id) || '';
  const subState = inspectionState[sub.id] || {};
  sub.items.forEach((item) => {
    const state = subState[item.id] || { status: '', notes: '' };
    const div = document.createElement('div');
    div.className = 'foundation-item';
    div.dataset.id = item.id;
    div.innerHTML = `
      <div class="f-item-row">
        <div class="f-item-label">${item.label}</div>
        ${itemDocButtons(item.id)}
      </div>
      <div class="f-status-row">
        <button type="button" data-status="pass" class="f-status ${state.status === 'pass' ? 'active' : ''}">ผ่าน</button>
        <button type="button" data-status="fail" class="f-status ${state.status === 'fail' ? 'active' : ''}">ไม่ผ่าน</button>
        <button type="button" data-status="na" class="f-status ${state.status === 'na' ? 'active' : ''}">N/A</button>
      </div>
      <input type="text" class="f-notes" placeholder="บันทึกเพิ่มเติม (ถ้ามี)" value="${escapeHtml(state.notes)}">
    `;
    box.appendChild(div);
  });
}

function saveInspection() {
  if (!currentSubId) return;
  const sub = subById(currentSubId);
  const rows = $$('#inspectionList .foundation-item');
  const subState = {};
  let pass = 0; let fail = 0; let na = 0;
  rows.forEach((row) => {
    const id = row.dataset.id;
    const active = row.querySelector('.f-status.active');
    const status = active ? active.dataset.status : '';
    if (status === 'pass') pass++;
    if (status === 'fail') fail++;
    if (status === 'na') na++;
    const notes = row.querySelector('.f-notes').value.trim();
    subState[id] = { status, notes };
  });
  inspectionState[currentSubId] = subState;
  save('inspectionState', inspectionState);
  inspectionHistory.unshift({ date: today(), subId: currentSubId, label: sub.label, pass, fail, na, total: rows.length });
  save('inspectionHistory', inspectionHistory);
  renderInspectionHistory();
  alert('บันทึกผลการตรวจ ' + sub.label + ' แล้ว');
}

function renderInspectionHistory() {
  const list = $('inspectionHistory');
  list.innerHTML = '';
  inspectionHistory.forEach((h, i) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div>
        <strong>${h.date}</strong><br>
        <small>${escapeHtml(h.label)} — ผ่าน ${h.pass}/${h.total}, ไม่ผ่าน ${h.fail}, N/A ${h.na}</small>
      </div>
      <button data-i="${i}" class="del" aria-label="ลบ">×</button>
    `;
    list.appendChild(li);
  });
}

$('inspectionCategories').addEventListener('click', async (e) => {
  if (e.target.classList.contains('insp-sub')) {
    openSubPdf(e.target.dataset.sub);
  } else if (e.target.classList.contains('view-cat-doc')) {
    await viewAdminDocById(e.target.dataset.docid);
  }
});

$('closeInspection').addEventListener('click', closeInspection);
$('saveInspection').addEventListener('click', saveInspection);

$('inspectionList').addEventListener('click', (e) => {
  if (e.target.classList.contains('f-status')) {
    const row = e.target.closest('.foundation-item');
    row.querySelectorAll('.f-status').forEach((b) => b.classList.remove('active'));
    e.target.classList.add('active');
  } else if (e.target.classList.contains('view-item-doc')) {
    const itemId = e.target.dataset.itemid;
    const docs = (adminDocCache || []).filter((d) => d.taskId === itemId);
    if (docs.length) viewAdminDocById(Number(docs[0].id));
  } else if (e.target.classList.contains('view-sub-doc')) {
    viewAdminDocById(Number(e.target.dataset.docid));
  }
});

$('inspectionHistory').addEventListener('click', (e) => {
  if (e.target.classList.contains('del')) {
    inspectionHistory.splice(Number(e.target.dataset.i), 1);
    save('inspectionHistory', inspectionHistory);
    renderInspectionHistory();
  }
});

/* Plans / PDFs */
let db;
const DB_NAME = 'siteDB';
const DB_VERSION = 2;
const STORE = 'plans';
const ADMIN_STORE = 'adminDocs';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(ADMIN_STORE)) {
        db.createObjectStore(ADMIN_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

function planStore(mode = 'readonly') {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function adminStore(mode = 'readonly') {
  return db.transaction(ADMIN_STORE, mode).objectStore(ADMIN_STORE);
}

function addAdminDoc(record) {
  return new Promise((resolve, reject) => {
    const req = adminStore('readwrite').add(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAdminDocs() {
  return new Promise((resolve, reject) => {
    const req = adminStore('readonly').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function deleteAdminDoc(id) {
  return new Promise((resolve, reject) => {
    const req = adminStore('readwrite').delete(Number(id));
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function addPlan(record) {
  return new Promise((resolve, reject) => {
    const req = planStore('readwrite').add(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAllPlans() {
  return new Promise((resolve, reject) => {
    const req = planStore().getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function deletePlan(id) {
  return new Promise((resolve, reject) => {
    const req = planStore('readwrite').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

$('toggleAdminPlan').addEventListener('click', () => {
  const form = $('planForm');
  form.hidden = !form.hidden;
});

async function renderPlans() {
  const list = $('planList');
  list.innerHTML = '';
  try {
    const plans = await getAllPlans();
    plans.forEach((p) => {
      const size = p.file ? `${(p.file.size / 1024).toFixed(1)} KB` : 'ลิงก์ภายนอก';
      const li = document.createElement('li');
      li.className = 'plan-card';
      li.innerHTML = `
        <div>
          <strong>🏠 ${escapeHtml(p.name)}</strong><br>
          <small>📍 ${escapeHtml(p.location || '')} | 📄 ${size}</small>
        </div>
        <div class="actions">
          <button data-id="${p.id}" class="view-plan">เปิด PDF</button>
          <button data-id="${p.id}" class="del" aria-label="ลบ">×</button>
        </div>
      `;
      list.appendChild(li);
    });
  } catch (err) {
    list.innerHTML = '<li>ไม่สามารถโหลดแบบแปลนได้</li>';
  }
}

let currentPdfUrl;

function closePdf() {
  if ($('pdfModal')) $('pdfModal').hidden = true;
  if ($('pdfEmbed')) $('pdfEmbed').src = '';
  if (currentPdfUrl) {
    URL.revokeObjectURL(currentPdfUrl);
    currentPdfUrl = null;
  }
}

$('planForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = $('planFile').files[0];
  const url = $('planUrl').value.trim();
  const name = $('planName').value.trim();
  const location = $('planLocation').value.trim();

  if (!name || !location) {
    alert('กรุณากรอกชื่อแบบแปลนและสถานที่');
    return;
  }
  if (!file && !url) {
    alert('กรุณาเลือกไฟล์ PDF หรือใส่ URL');
    return;
  }

  const record = { name, location, uploaded: new Date().toISOString() };
  if (file) {
    record.file = file;
  } else {
    record.url = url;
  }
  await addPlan(record);
  $('planForm').reset();
  $('planForm').hidden = true;
  await renderPlans();
});

$('planList').addEventListener('click', async (e) => {
  const id = Number(e.target.dataset.id);
  if (e.target.classList.contains('del')) {
    await deletePlan(id);
    await renderPlans();
  } else if (e.target.classList.contains('view-plan')) {
    const plans = await getAllPlans();
    const p = plans.find((x) => x.id === id);
    if (!p) return;
    if (p.file) {
      currentPdfUrl = URL.createObjectURL(p.file);
      $('pdfEmbed').src = currentPdfUrl;
    } else if (p.url) {
      $('pdfEmbed').src = p.url;
    }
    $('pdfTitle').textContent = p.name;
    $('pdfModal').hidden = false;
  }
});

$('closePdf').addEventListener('click', () => {
  history.back();
});

/* Admin Panel */
function populateAdminCategoryOptions() {
  const sel = $('adminCategory');
  if (!sel) return;
  sel.innerHTML = '<option value="" disabled selected>เลือกหมวด</option>' +
    INSP_CATEGORIES.map((c) => `<option value="${c.id}">${escapeHtml(c.label)}</option>`).join('');
}

function populateAdminSubOptions() {
  const catSel = $('adminCategory');
  const subSel = $('adminSub');
  const taskSel = $('adminTask');
  if (!catSel || !subSel || !taskSel) return;
  const cat = INSP_CATEGORIES.find((c) => c.id === catSel.value);
  subSel.innerHTML = '<option value="" selected>ทั้งหมดในหมวด</option>' +
    (cat ? cat.subs.map((s) => `<option value="${s.id}">${escapeHtml(s.label)}</option>`).join('') : '');
  taskSel.innerHTML = '<option value="" selected>ทั้งหมดในหัวข้อย่อย</option>';
}

function populateAdminTaskOptions() {
  const catSel = $('adminCategory');
  const subSel = $('adminSub');
  const taskSel = $('adminTask');
  if (!catSel || !subSel || !taskSel) return;
  const cat = INSP_CATEGORIES.find((c) => c.id === catSel.value);
  const sub = cat ? cat.subs.find((s) => s.id === subSel.value) : null;
  taskSel.innerHTML = '<option value="" selected>ทั้งหมดในหัวข้อย่อย</option>' +
    (sub ? sub.items.map((i) => `<option value="${i.id}">${escapeHtml(i.label)}</option>`).join('') : '');
}

async function renderAdminDocs() {
  const list = $('adminDocList');
  if (!list) return;
  list.innerHTML = '';
  try {
    const docs = await getAdminDocs();
    docs.forEach((doc) => {
      const item = itemById(doc.taskId);
      const label = item ? item.label : (INSP_CATEGORIES.find((c) => c.id === doc.categoryId)?.label || 'ไม่ระบุรายการ');
      const li = document.createElement('li');
      li.innerHTML = `
        <div>
          <strong>${escapeHtml(doc.title)}</strong><br>
          <small>${escapeHtml(label)}</small>
        </div>
        <div class="actions">
          <button data-id="${doc.id}" class="view-admin-doc" type="button">ดู</button>
          <button data-id="${doc.id}" class="del-admin-doc del" type="button">×</button>
        </div>
      `;
      list.appendChild(li);
    });
  } catch (err) {
    list.innerHTML = '<li>ไม่สามารถโหลดรายการเอกสารได้</li>';
  }
}

async function viewAdminDocById(id, fromPop = false) {
  try {
    const docs = await getAdminDocs();
    const doc = docs.find((d) => d.id === Number(id));
    if (!doc || !doc.file) return;
    closePdf();
    const blob = new Blob([doc.file], { type: doc.type || 'application/pdf' });
    currentPdfUrl = URL.createObjectURL(blob);
    $('pdfEmbed').src = currentPdfUrl;
    $('pdfTitle').textContent = doc.title;
    $('pdfModal').hidden = false;
    if (!fromPop) {
      const state = { view: 'pdf', docId: Number(id) };
      if (doc.subId) state.subId = doc.subId;
      if (doc.categoryId) state.categoryId = doc.categoryId;
      pushHistory(state);
    }
  } catch (err) {
    console.error(err);
    alert('ไม่สามารถเปิดเอกสารได้');
  }
}

function categoryDocButtons(categoryId) {
  const docs = adminDocCache ? adminDocCache.filter((d) => d.categoryId === categoryId && !d.subId && !d.taskId) : [];
  if (!docs.length) return '';
  return `
    <div class="cat-docs">
      <b>เอกสารอ้างอิงหมวด:</b>
      <div class="cat-docs-list">
        ${docs.map((d) => `<button type="button" class="view-cat-doc" data-docid="${d.id}">${escapeHtml(d.title)}</button>`).join('')}
      </div>
    </div>
  `;
}

function subDocButtons(subId) {
  const docs = adminDocCache ? adminDocCache.filter((d) => d.subId === subId && !d.taskId) : [];
  if (!docs.length) return '';
  return `
    <div class="cat-docs">
      <b>เอกสารอ้างอิงหัวข้อ:</b>
      <div class="cat-docs-list">
        ${docs.map((d) => `<button type="button" class="view-sub-doc" data-docid="${d.id}">${escapeHtml(d.title)}</button>`).join('')}
      </div>
    </div>
  `;
}

let adminDocCache = [];

async function refreshAdminDocCache() {
  try {
    adminDocCache = await getAdminDocs();
  } catch (err) {
    adminDocCache = [];
  }
}

$('adminCategory').addEventListener('change', populateAdminSubOptions);
$('adminSub').addEventListener('change', populateAdminTaskOptions);

$('adminDocForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = $('adminDocFile').files[0];
  if (!file) return;
  const catId = $('adminCategory').value;
  if (!catId) {
    alert('กรุณาเลือกหมวดเช็คลิสต์');
    return;
  }
  const subId = $('adminSub').value || null;
  const taskId = $('adminTask').value || null;
  try {
    const buffer = await file.arrayBuffer();
    const record = {
      title: $('adminDocTitle').value.trim(),
      categoryId: catId,
      subId: subId,
      taskId: taskId,
      name: file.name,
      type: file.type || 'application/pdf',
      file: buffer
    };
    await addAdminDoc(record);
    $('adminDocForm').reset();
    populateAdminCategoryOptions();
    populateAdminSubOptions();
    populateAdminTaskOptions();
    await renderAdminDocs();
    await refreshAdminDocCache();
    renderInspectionCategories();
    alert('อัปโหลดเอกสารแล้ว');
  } catch (err) {
    console.error(err);
    alert('อัปโหลดไม่สำเร็จ');
  }
});

$('adminDocList').addEventListener('click', async (e) => {
  const id = Number(e.target.dataset.id);
  if (e.target.classList.contains('del-admin-doc')) {
    await deleteAdminDoc(id);
    await renderAdminDocs();
    await refreshAdminDocCache();
    renderInspectionCategories();
  } else if (e.target.classList.contains('view-admin-doc')) {
    await viewAdminDocById(id);
  }
});

/* Staff Directory */
const staff = load('staff', []);
let staffAttachedImage = '';

const staffCategoryLabels = {
  executive: '⭐ ผู้บริหาร / เจ้าของโครงการ',
  engineering: '👔 ทีมวิศวกร / ผู้จัดการโครงการ',
  foreman: '👷 โฟร์แมนและทีมงานหน้างาน',
  procurement: '📦 ฝ่ายจัดซื้อ / สโตร์วัสดุ',
  subcon: '🧱 ผู้รับเหมาช่วง'
};

function renderStaffImage() {
  const box = $('staffImagePreview');
  if (staffAttachedImage) {
    box.innerHTML = `
      <div class="thumb">
        <img src="${staffAttachedImage}" alt="โปรไฟล์">
        <button type="button" id="removeStaffImg" class="remove-img" aria-label="ลบรูป">×</button>
      </div>
    `;
  } else {
    box.innerHTML = '';
  }
}

$('staffImage').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    staffAttachedImage = await resizeImage(file, 400, 0.8);
    renderStaffImage();
  } catch (err) {
    alert('ไม่สามารถโหลดรูปได้');
  }
  e.target.value = '';
});

$('staffImagePreview').addEventListener('click', (e) => {
  if (e.target.id === 'removeStaffImg') {
    staffAttachedImage = '';
    renderStaffImage();
  }
});

function renderStaff() {
  const list = $('staffList');
  list.innerHTML = '';
  const order = ['executive', 'engineering', 'foreman', 'procurement', 'subcon'];
  order.forEach((cat) => {
    const members = staff.filter((s) => (s.category || 'foreman') === cat);
    if (members.length === 0) return;
    const section = document.createElement('div');
    section.className = 'staff-group';
    section.innerHTML = `<h3>${staffCategoryLabels[cat]}</h3>`;
    const ul = document.createElement('ul');
    ul.className = 'staff-list';
    members.forEach((s, i) => {
      const globalIndex = staff.indexOf(s);
      const img = s.image
        ? `<img src="${s.image}" class="staff-avatar" alt="${escapeHtml(s.name)}">`
        : `<div class="staff-avatar placeholder">${(s.nickname || s.name).charAt(0)}</div>`;
      const li = document.createElement('li');
      li.innerHTML = `
        ${img}
        <div class="staff-info">
          <strong>${escapeHtml(s.name)} ${s.nickname ? `(${escapeHtml(s.nickname)})` : ''}</strong>
          <small>${escapeHtml(s.role || '')}</small>
          <a href="tel:${encodeURIComponent(s.phone)}" class="btn call">📞 โทร ${escapeHtml(s.phone)}</a>
        </div>
        <button data-i="${globalIndex}" class="del" aria-label="ลบ">×</button>
      `;
      ul.appendChild(li);
    });
    section.appendChild(ul);
    list.appendChild(section);
  });
}

$('staffForm').addEventListener('submit', (e) => {
  e.preventDefault();
  staff.unshift({
    category: $('staffCategory').value,
    image: staffAttachedImage,
    name: $('staffName').value.trim(),
    nickname: $('staffNickname').value.trim(),
    role: $('staffRole').value.trim(),
    phone: $('staffPhone').value.trim()
  });
  save('staff', staff);
  renderStaff();
  $('staffForm').reset();
  staffAttachedImage = '';
  renderStaffImage();
});

$('staffList').addEventListener('click', (e) => {
  if (e.target.classList.contains('del')) {
    staff.splice(Number(e.target.dataset.i), 1);
    save('staff', staff);
    renderStaff();
  }
});

/* Milestones */
const milestones = load('milestones', []);
const milestoneStatusLabels = {
  pending: { label: 'รอตรวจรับงวด', color: '🔴', dot: 'red' },
  inprogress: { label: 'กำลังดำเนินการ', color: '🟠', dot: 'orange' },
  passed: { label: 'ผ่านงวดนี้แล้ว', color: '🟢', dot: 'green' }
};

function renderMilestones() {
  const list = $('milestoneList');
  list.innerHTML = '';
  milestones.forEach((m, i) => {
    const s = milestoneStatusLabels[m.status] || milestoneStatusLabels.inprogress;
    const li = document.createElement('li');
    li.className = 'milestone-card';
    li.innerHTML = `
      <div class="milestone-main">
        <div>
          <strong>🏠 ${escapeHtml(m.name)}</strong>
          <small>📍 ${escapeHtml(m.location || '')}</small>
        </div>
        <div class="milestone-meta">
          <span class="milestone-status ${s.dot}">${s.color} ${s.label}</span>
          <span class="milestone-stage">📌 งวด: ${escapeHtml(m.stage || '')}</span>
        </div>
        <div class="progress-wrap">
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${Math.max(0, Math.min(100, m.progress || 0))}%"></div>
          </div>
          <span class="progress-text">${m.progress || 0}%</span>
        </div>
        ${m.remarks ? `<small>📝 ${escapeHtml(m.remarks)}</small>` : ''}
      </div>
      <div class="actions">
        <button data-i="${i}" class="edit-milestone" type="button">แก้ไข</button>
        <button data-i="${i}" class="del" aria-label="ลบ">×</button>
      </div>
    `;
    list.appendChild(li);
  });
}

function fillMilestoneForm(i) {
  const m = milestones[i];
  $('milestoneId').value = i;
  $('milestoneName').value = m.name;
  $('milestoneLocation').value = m.location || '';
  $('milestoneStage').value = m.stage || '';
  $('milestoneProgress').value = m.progress || 0;
  $('milestoneStatus').value = m.status || 'inprogress';
  $('milestoneRemarks').value = m.remarks || '';
  $('milestoneSubmit').textContent = 'บันทึกการแก้ไข';
  $('milestoneCancel').hidden = false;
}

function clearMilestoneForm() {
  $('milestoneForm').reset();
  $('milestoneId').value = '';
  $('milestoneSubmit').textContent = 'เพิ่มรายการ';
  $('milestoneCancel').hidden = true;
}

$('milestoneForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = $('milestoneId').value;
  const record = {
    name: $('milestoneName').value.trim(),
    location: $('milestoneLocation').value.trim(),
    stage: $('milestoneStage').value.trim(),
    progress: Number($('milestoneProgress').value) || 0,
    status: $('milestoneStatus').value,
    remarks: $('milestoneRemarks').value.trim(),
    updated: new Date().toISOString()
  };
  if (id === '') {
    milestones.unshift(record);
  } else {
    milestones[Number(id)] = record;
  }
  save('milestones', milestones);
  renderMilestones();
  clearMilestoneForm();
});

$('milestoneCancel').addEventListener('click', clearMilestoneForm);

$('milestoneList').addEventListener('click', (e) => {
  const i = Number(e.target.dataset.i);
  if (e.target.classList.contains('del')) {
    milestones.splice(i, 1);
    save('milestones', milestones);
    renderMilestones();
  } else if (e.target.classList.contains('edit-milestone')) {
    fillMilestoneForm(i);
  }
});

/* Houses & Payment Phases */
const defaultPhaseLabels = [
  'งวดที่ 1: งานดิน/ฐานราก',
  'งวดที่ 2: โครงสร้างชั้นล่าง',
  'งวดที่ 3: โครงสร้างชั้นบนและหลังคา',
  'งวดที่ 4: งานผนังและฝ้าเพดาน',
  'งวดที่ 5: งานระบบไฟฟ้าและประปา',
  'งวดที่ 6: งานปูพื้นและกระเบื้อง',
  'งวดที่ 7: งานทาสีและตกแต่งภายใน',
  'งวดที่ 8: งานภายนอกและระบบระบายน้ำ',
  'งวดที่ 9: งานสุดท้าย/ทำความสะอาด',
  'งวดที่ 10: ส่งมอบบ้านและเอกสาร'
];

function createDefaultHouse(id) {
  return {
    id,
    name: `House ${id}`,
    phases: defaultPhaseLabels.map((label) => ({ label, status: 'not-started', paid: false, notes: '' }))
  };
}

function loadHouses() {
  const stored = load('houses', null);
  if (stored && Array.isArray(stored)) return stored;
  const houses = Array.from({ length: 10 }, (_, i) => createDefaultHouse(i + 1));
  save('houses', houses);
  return houses;
}

let houses = loadHouses();
let currentHouseId = null;

function isAdminMode() {
  return sessionStorage.getItem('adminUnlocked') === '1';
}

function renderHouses() {
  const list = $('houseList');
  if (!list) return;
  list.innerHTML = '';
  houses.forEach((h) => {
    const done = h.phases.filter((p) => p.status === 'done').length;
    const paid = h.phases.filter((p) => p.paid).length;
    const card = document.createElement('div');
    card.className = 'house-card';
    card.dataset.id = h.id;
    card.innerHTML = `
      <div class="house-icon">🏠</div>
      <div class="house-name">${escapeHtml(h.name)}</div>
      <div class="house-meta">งวดแล้วเสร็จ ${done}/10 · จ่ายแล้ว ${paid}/10</div>
    `;
    card.addEventListener('click', () => openHouseDetail(h.id));
    list.appendChild(card);
  });
}

function openHouseDetail(id) {
  currentHouseId = id;
  const h = houses.find((house) => house.id === id) || createDefaultHouse(id);
  $('houseDetailTitle').textContent = h.name;
  $('houseListView').hidden = true;
  $('houseDetailView').hidden = false;
  $('houseAdminNote').hidden = !isAdminMode();
  $('saveHouseDetail').hidden = !isAdminMode();
  renderPhases(h);
}

function renderPhases(h) {
  const box = $('phaseList');
  const admin = isAdminMode();
  box.innerHTML = '';
  h.phases.forEach((p, idx) => {
    const phaseDiv = document.createElement('div');
    phaseDiv.className = 'phase-card';
    const statusLabels = {
      'not-started': 'ยังไม่เริ่ม',
      'in-progress': 'กำลังดำเนินการ',
      'done': 'แล้วเสร็จ',
      'paid': 'จ่ายงวดแล้ว'
    };
    if (admin) {
      phaseDiv.innerHTML = `
        <div class="phase-row">
          <span class="phase-number">${idx + 1}</span>
          <input type="text" class="phase-label" data-idx="${idx}" value="${escapeHtml(p.label)}" placeholder="ชื่องวด">
        </div>
        <div class="phase-fields">
          <select class="phase-status" data-idx="${idx}">
            ${Object.entries(statusLabels).map(([k, v]) => `<option value="${k}" ${p.status === k ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
          <label class="phase-paid"><input type="checkbox" class="phase-paid-cb" data-idx="${idx}" ${p.paid ? 'checked' : ''}> จ่ายงวดแล้ว</label>
          <textarea class="phase-notes" data-idx="${idx}" rows="2" placeholder="หมายเหตุ / รายละเอียด">${escapeHtml(p.notes)}</textarea>
        </div>
      `;
    } else {
      phaseDiv.innerHTML = `
        <div class="phase-row">
          <span class="phase-number">${idx + 1}</span>
          <strong class="phase-label-readonly">${escapeHtml(p.label)}</strong>
          <span class="phase-status-badge ${p.status}">${statusLabels[p.status] || p.status}</span>
          ${p.paid ? '<span class="phase-paid-badge">จ่ายแล้ว</span>' : ''}
        </div>
        ${p.notes ? `<div class="phase-notes-readonly">${escapeHtml(p.notes)}</div>` : ''}
      `;
    }
    box.appendChild(phaseDiv);
  });
}

function saveCurrentHouse() {
  const h = houses.find((house) => house.id === currentHouseId);
  if (!h || !isAdminMode()) return;
  const newName = $('houseDetailTitle').textContent.trim() || h.name;
  h.name = newName;
  const rows = $$('#phaseList .phase-card');
  rows.forEach((row, idx) => {
    const label = row.querySelector('.phase-label').value.trim();
    const status = row.querySelector('.phase-status').value;
    const paid = row.querySelector('.phase-paid-cb').checked;
    const notes = row.querySelector('.phase-notes').value.trim();
    h.phases[idx] = { label, status, paid, notes };
  });
  save('houses', houses);
  renderHouses();
  alert('บันทึกข้อมูลบ้านและงวดแล้ว');
}

if ($('backToHouses')) {
  $('backToHouses').addEventListener('click', () => {
    currentHouseId = null;
    $('houseListView').hidden = false;
    $('houseDetailView').hidden = true;
  });
}

if ($('saveHouseDetail')) {
  $('saveHouseDetail').addEventListener('click', saveCurrentHouse);
}

if ($('houseDetailTitle')) {
  $('houseDetailTitle').addEventListener('blur', () => {
    if (!isAdminMode()) {
      const h = houses.find((house) => house.id === currentHouseId);
      if (h) $('houseDetailTitle').textContent = h.name;
    }
  });
}

/* Export Daily Report */
let currentExportIndex = null;

function populateExportData(i) {
  const r = dailyReports[i];
  const isMpArray = Array.isArray(r.mp);
  const mpTotal = isMpArray
    ? (r.mp || []).reduce((a, m) => a + Number(m.count), 0)
    : ((r.mp && Object.values(r.mp).reduce((a, b) => a + Number(b), 0)) || 0);
  const mpRows = isMpArray
    ? (r.mp || []).map((m) => `
      <tr>
        <td>${escapeHtml(m.trade)}</td>
        <td style="text-align:center">${m.count}</td>
      </tr>`).join('')
    : '';
  const progressLabel = r.progressType
    ? `${r.progressPercent || '0'}% ${r.progressType}`
    : '-';

  $('exportReport').innerHTML = `
    <div class="ex-page ex-navy">
      <div class="ex-header">
        <div class="ex-brand">
          <div class="ex-logo">WD</div>
          <div class="ex-title">
            <div class="ex-company">WD Construction</div>
            <div class="ex-location">Khon Kaen</div>
          </div>
        </div>
        <div class="ex-doc-title">
          <div class="ex-doc-sub">DAILY REPORT</div>
          <div class="ex-doc-main">รายงานประจำวัน</div>
        </div>
      </div>

      <div class="ex-meta">
        <div class="ex-meta-box"><span>วันที่</span><b>${r.date || '-'}</b></div>
        <div class="ex-meta-box"><span>Site</span><b>${escapeHtml(r.project || '-')}</b></div>
        <div class="ex-meta-box"><span>Project</span><b>${escapeHtml(r.project || '-')}</b></div>
        <div class="ex-meta-box"><span>Reporter</span><b>${escapeHtml(r.foreman || '-')}</b></div>
        <div class="ex-meta-box"><span>Weather</span><b>${escapeHtml(r.weather || '-')}</b></div>
      </div>

      <div class="ex-meta phase-meta">
        <div class="ex-meta-box"><span>อยู่ระหว่างก่อสร้างงวดที่</span><b>${escapeHtml(r.phase || '-')}</b></div>
        <div class="ex-meta-box"><span>คาดแล้วเสร็จ</span><b>${r.phaseFinish || '-'}</b></div>
      </div>

      <div class="ex-body">
        <div class="ex-card ex-progress-card">
          <div class="ex-card-head">ความคืบหน้าเทียบกับแผนงาน</div>
          <div class="ex-text ex-progress-text">${progressLabel}</div>
        </div>

        <div class="ex-card">
          <div class="ex-card-head"><span class="ex-icon">👷</span> กำลังคน</div>
          ${mpRows ? `
          <table class="ex-table">
            <thead><tr><th>ประเภท</th><th style="width:50px;text-align:center">จำนวน</th></tr></thead>
            <tbody>${mpRows}</tbody>
            <tfoot><tr><td>รวม</td><td style="text-align:center">${mpTotal}</td></tr></tfoot>
          </table>` : '<p class="ex-empty">ไม่ระบุข้อมูลกำลังคน</p>'}
        </div>

        <div class="ex-row-2">
          <div class="ex-card">
            <div class="ex-card-head">งานที่ทำวันนี้</div>
            <div class="ex-text">${(r.work || '-').replace(/\n/g, '<br>')}</div>
          </div>
          <div class="ex-card">
            <div class="ex-card-head">แผนงานถัดไป</div>
            <div class="ex-text">${(r.plan || '-').replace(/\n/g, '<br>')}</div>
          </div>
        </div>

        ${r.extraMaterials ? `
        <div class="ex-card">
          <div class="ex-card-head">วัสดุที่ขอจัดซื้อ</div>
          <div class="ex-text">${escapeHtml(r.extraMaterials).replace(/\n/g, '<br>')}</div>
        </div>` : ''}

        ${r.issue ? `
        <div class="ex-card ex-issue">
          <div class="ex-card-head">อุปสรรค / ปัญหาหน้างาน</div>
          <div class="ex-text">${escapeHtml(r.issue).replace(/\n/g, '<br>')}</div>
        </div>` : ''}

        ${r.notes ? `
        <div class="ex-card">
          <div class="ex-card-head">โน้ต / หมายเหตุ</div>
          <div class="ex-text">${escapeHtml(r.notes).replace(/\n/g, '<br>')}</div>
        </div>` : ''}
      </div>
    </div>
  `;

  const images = (r.images || []).slice(0, 6);
  const photoSlots = Array.from({ length: 6 }, (_, idx) => {
    const src = images[idx];
    if (src) {
      return `
      <div class="ex-photo">
        <img src="${src}" alt="Photo ${idx + 1}">
        <div class="ex-photo-label">รูปภาพประกอบ ${idx + 1}</div>
      </div>`;
    }
    return `
      <div class="ex-photo ex-photo-empty">
        <div class="ex-photo-box">ภาพที่ ${idx + 1}</div>
        <div class="ex-photo-label">-</div>
      </div>`;
  });
  const photoBoxes = photoSlots.join('');

  $('exportPhotos').innerHTML = `
    <div class="ex-page ex-navy">
      <div class="ex-header">
        <div class="ex-brand">
          <div class="ex-logo">WD</div>
          <div class="ex-title">
            <div class="ex-company">WD Construction</div>
            <div class="ex-location">Khon Kaen</div>
          </div>
        </div>
        <div class="ex-doc-title">
          <div class="ex-doc-sub">SITE PHOTOS</div>
          <div class="ex-doc-main">รูปภาพประกอบ</div>
        </div>
      </div>
      <div class="ex-photos-grid">
        ${photoBoxes}
      </div>
    </div>
  `;
}

function openExport(i) {
  try {
    if (i === null || i === undefined || !dailyReports[i]) {
      throw new Error('Invalid report index for export: ' + i);
    }
    currentExportIndex = i;
    populateExportData(i);
    $('exportModal').hidden = false;
  } catch (err) {
    currentExportIndex = null;
    console.error('openExport failed:', err);
    alert('เปิดหน้าส่งออกไม่ได้: ' + err.message);
  }
}

function closeExport() {
  $('exportModal').hidden = true;
  currentExportIndex = null;
}

function isCanvasValid(canvas) {
  return canvas && typeof canvas.toDataURL === 'function' && canvas.width > 0 && canvas.height > 0;
}

function isElementRenderable(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return el.offsetParent !== null && rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
}

function waitForImages(clone, timeoutMs = 5000) {
  const imgs = Array.from(clone.querySelectorAll('img'));
  const promises = imgs.map((img) => {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    return new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = resolve;
    });
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, timeoutMs));
  return Promise.race([Promise.all(promises), timeout]);
}

async function safeHtml2Canvas(el, scale = 2) {
  if (typeof html2canvas !== 'function') {
    throw new Error('html2canvas library not loaded');
  }
  if (!isElementRenderable(el)) {
    throw new Error(`Element not renderable: ${el ? el.id : 'null'} (hidden or zero size)`);
  }
  try {
    const canvas = await html2canvas(el, { scale, useCORS: true, backgroundColor: null, logging: false });
    if (!isCanvasValid(canvas)) throw new Error('html2canvas returned invalid canvas');
    return canvas;
  } catch (err) {
    console.warn('html2canvas failed at scale', scale, err);
    try {
      const canvas = await html2canvas(el, { scale: 1, useCORS: true, backgroundColor: null, logging: false });
      if (!isCanvasValid(canvas)) throw new Error('html2canvas fallback returned invalid canvas');
      return canvas;
    } catch (err2) {
      console.error('html2canvas fallback failed:', err2);
      throw err2;
    }
  }
}

async function captureOffscreen(el, scale = EXPORT_SCALE) {
  if (!el) throw new Error('No element provided for capture');
  if (!isElementRenderable(el)) {
    throw new Error(`Element not renderable: ${el.id || 'unknown'} (hidden or zero size)`);
  }
  const clone = el.cloneNode(true);
  clone.style.width = `${EXPORT_WIDTH}px`;
  clone.style.height = `${EXPORT_HEIGHT}px`;
  clone.style.minWidth = `${EXPORT_WIDTH}px`;
  clone.style.minHeight = `${EXPORT_HEIGHT}px`;
  clone.style.maxWidth = `${EXPORT_WIDTH}px`;
  clone.style.maxHeight = `${EXPORT_HEIGHT}px`;
  clone.style.overflow = 'hidden';
  clone.style.position = 'relative';
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.position = 'fixed';
  host.style.left = '0';
  host.style.top = '-9999px';
  host.style.width = `${EXPORT_WIDTH}px`;
  host.style.height = `${EXPORT_HEIGHT}px`;
  host.style.maxWidth = `${EXPORT_WIDTH}px`;
  host.style.maxHeight = `${EXPORT_HEIGHT}px`;
  host.style.overflow = 'hidden';
  host.style.visibility = 'visible';
  host.style.opacity = '1';
  host.style.pointerEvents = 'none';
  host.style.zIndex = '-9999';
  host.appendChild(clone);
  document.body.appendChild(host);
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 50)));
  await waitForImages(clone);
  try {
    const canvas = await html2canvas(clone, {
      scale,
      useCORS: true,
      backgroundColor: null,
      logging: false,
      width: EXPORT_WIDTH,
      height: EXPORT_HEIGHT,
      windowWidth: EXPORT_WIDTH,
      windowHeight: EXPORT_HEIGHT,
      x: 0,
      y: 0
    });
    if (!isCanvasValid(canvas)) throw new Error('html2canvas returned invalid canvas');
    return canvas;
  } catch (err) {
    console.warn('Offscreen html2canvas failed at scale', scale, err);
    try {
      const canvas = await html2canvas(clone, { scale: 1, useCORS: true, backgroundColor: null, logging: false });
      if (!isCanvasValid(canvas)) throw new Error('html2canvas fallback returned invalid canvas');
      return canvas;
    } catch (err2) {
      console.error('Offscreen html2canvas fallback failed:', err2);
      throw err2;
    }
  } finally {
    document.body.removeChild(host);
  }
}

async function canvasToBlob(el, scale = 2) {
  const canvas = await captureOffscreen(el, scale);
  if (!isCanvasValid(canvas)) throw new Error('Canvas invalid for toBlob');
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

async function canvasToDataUrl(el, type = 'image/png', quality = 0.95, scale = EXPORT_SCALE) {
  const canvas = await captureOffscreen(el, scale);
  if (!isCanvasValid(canvas)) throw new Error('Canvas invalid for toDataURL');
  return canvas.toDataURL(type, type === 'image/jpeg' ? quality : undefined);
}

$('closeExport').addEventListener('click', closeExport);

function combineCanvases(c1, c2) {
  const width = Math.max(c1.width, c2.width);
  const height = c1.height + c2.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D context for combined canvas');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(c1, 0, 0);
  ctx.drawImage(c2, 0, c1.height);
  return canvas;
}

async function downloadCombinedImage(type, ext, quality = 0.95, scale = EXPORT_SCALE) {
  if (currentExportIndex === null) throw new Error('No report selected for export');
  if (typeof html2canvas !== 'function') throw new Error('html2canvas not loaded');
  const page1 = await captureOffscreen($('exportReport'), scale);
  const page2 = await captureOffscreen($('exportPhotos'), scale);
  const combined = combineCanvases(page1, page2);
  const dataUrl = combined.toDataURL(type, type === 'image/jpeg' ? quality : undefined);
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `daily-report-${dailyReports[currentExportIndex].date}.${ext}`;
  a.click();
}

async function shareCombinedImage(scale = EXPORT_SCALE) {
  if (currentExportIndex === null) throw new Error('No report selected for export');
  if (typeof html2canvas !== 'function') throw new Error('html2canvas not loaded');
  const page1 = await captureOffscreen($('exportReport'), scale);
  const page2 = await captureOffscreen($('exportPhotos'), scale);
  const combined = combineCanvases(page1, page2);
  return new Promise((resolve, reject) => {
    combined.toBlob((blob) => {
      if (!blob) return reject(new Error('Combined image toBlob returned null'));
      const file = new File([blob], `daily-report-${dailyReports[currentExportIndex].date}.jpg`, { type: 'image/jpeg' });
      resolve(file);
    }, 'image/jpeg', 0.92);
  });
}

async function buildExportPdf() {
  if (currentExportIndex === null) throw new Error('No report selected for export');
  if (typeof html2canvas !== 'function') throw new Error('html2canvas not loaded');
  if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF not loaded');
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4', putOnlyUsedFonts: true, floatPrecision: 16 });
  const page1 = await canvasToDataUrl($('exportReport'), 'image/png', undefined, 2);
  const page2 = await canvasToDataUrl($('exportPhotos'), 'image/png', undefined, 2);
  const a4w = 595;
  const a4h = 842;
  pdf.addImage(page1, 'PNG', 0, 0, a4w, a4h);
  pdf.addPage();
  pdf.addImage(page2, 'PNG', 0, 0, a4w, a4h);
  return pdf;
}

$('exportPng').addEventListener('click', async () => {
  try {
    await downloadCombinedImage('image/png', 'png');
    console.log('PNG export completed');
  } catch (err) {
    console.error('PNG export failed:', err);
    alert('ไม่สามารถสร้าง PNG ได้: ' + err.message);
  }
});

$('exportPdf').addEventListener('click', async () => {
  try {
    const pdf = await buildExportPdf();
    pdf.save(`daily-report-${dailyReports[currentExportIndex].date}.pdf`);
    console.log('PDF export completed');
  } catch (err) {
    console.error('PDF export failed:', err);
    alert('ไม่สามารถสร้าง PDF ได้: ' + err.message);
  }
});

$('shareLine').addEventListener('click', async () => {
  const title = 'รายงานประจำวัน';
  const text = 'รายงานประจำวัน WD Construction Khon Kaen';
  try {
    const file = await shareCombinedImage();

    // 1) Native file share (best for LINE)
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title, text });
      return;
    }

    // 2) Plain text share for browsers without file sharing
    if (navigator.share && !navigator.canShare) {
      await navigator.share({ title, text });
      return;
    }

    // 3) Upload to get a public link, then share/copy
    let url = null;
    if (currentUser && currentUser.id) {
      try {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch(`${API_BASE}/upload/${currentUser.id}`, { method: 'POST', body: form });
        if (res.ok) {
          const data = await res.json();
          url = data.file && data.file.url ? data.file.url : null;
        }
      } catch (uploadErr) {
        console.error('Upload fallback failed:', uploadErr);
      }
    }

    const shareText = url ? `${text}\n${url}` : text;

    // 4) Share text or link if supported
    if (navigator.share) {
      await navigator.share({ title, text: shareText });
      return;
    }

    // 5) Copy to clipboard
    try {
      await navigator.clipboard.writeText(shareText);
      alert(url ? 'คัดลอกลิงก์รายงานแล้ว กรุณาวางลงในแอปแชร์' : 'คัดลอกข้อความรายงานแล้ว กรุณาวางลงในแอปแชร์');
      return;
    } catch (clipErr) {
      console.error('Clipboard fallback failed:', clipErr);
    }

    // 6) Last resort: download file
    const a = document.createElement('a');
    const blobUrl = URL.createObjectURL(file);
    a.href = blobUrl;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
    alert('อุปกรณ์นี้ไม่รองรับการแชร์โดยตรง ไฟล์ถูกดาวน์โหลดแล้ว กรุณาเปิดแอปแชร์แล้วเลือกภาพจากแกลเลอรี');
  } catch (err) {
    if (err.name === 'AbortError' || err.message === 'AbortError') return;
    console.error('LINE share failed:', err);
    alert('ไม่สามารถแชร์ได้: ' + err.message);
  }
});

/* Install prompt */
const installBtn = $('installBtn');
const installBanner = $('installBanner');
const installAccept = $('installAccept');
const installDismiss = $('installDismiss');
const installDismissed = localStorage.getItem('installBannerDismissed') === '1';

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.matchMedia('(display-mode: fullscreen)').matches ||
         (navigator.standalone === true) ||
         installDismissed;
}

function showInstallBanner() {
  if (installBanner) installBanner.hidden = false;
  if (installBtn) installBtn.hidden = false;
}

function hideInstallBanner() {
  if (installBanner) installBanner.hidden = true;
  if (installBtn) installBtn.hidden = true;
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.deferredPrompt = e;
  showInstallBanner();
});

async function runInstallPrompt() {
  if (window.deferredPrompt && typeof window.deferredPrompt.prompt === 'function') {
    window.deferredPrompt.prompt();
    await window.deferredPrompt.userChoice;
    window.deferredPrompt = null;
    hideInstallBanner();
  } else {
    console.log('Install prompt is not ready yet');
  }
}

function dismissInstallBanner() {
  localStorage.setItem('installBannerDismissed', '1');
  hideInstallBanner();
}

if (installAccept) installAccept.addEventListener('click', runInstallPrompt);
if (installBtn) installBtn.addEventListener('click', runInstallPrompt);
if (installDismiss) installDismiss.addEventListener('click', dismissInstallBanner);

window.addEventListener('appinstalled', () => {
  window.deferredPrompt = null;
  localStorage.setItem('installBannerDismissed', '1');
  hideInstallBanner();
});

function handlePop(e) {
  const state = e.state || {};
  if (!state.view) return;
  isPopping = true;
  if (state.view === 'pdf' && state.docId) {
    if (state.subId) openSubDetail(state.subId, true);
    else showView('checklist', true);
    viewAdminDocById(Number(state.docId), true);
  } else if (state.view === 'sub' && state.subId) {
    showView('checklist', true);
    openSubDetail(state.subId, true);
  } else {
    showView(state.view, true);
  }
  isPopping = false;
}

window.addEventListener('popstate', handlePop);

if ($('navBack')) {
  $('navBack').addEventListener('click', () => history.back());
}
if ($('navForward')) {
  $('navForward').addEventListener('click', () => history.forward());
}

if (history.state && history.state.view) {
  handlePop({ state: history.state });
} else {
  history.replaceState({ view: 'menu' }, '', '#menu');
  showView('menu');
}

if (!isStandalone()) {
  showInstallBanner();
} else {
  hideInstallBanner();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w.addEventListener('statechange', () => {
        if (w.state === 'activated') {
          window.location.reload();
        }
      });
    });
    reg.update();
  });
}

/* History Dashboard */
let currentHistoryFilter = 'all';

async function renderHistory() {
  const list = $('historyList');
  if (!list) return;
  list.innerHTML = '<li>กำลังโหลด...</li>';
  try {
    const res = await fetch(`${API_BASE}/history/${currentUser.id}?limit=200`);
    const j = await res.json();
    let logs = j.logs || [];
    if (currentHistoryFilter !== 'all') {
      logs = logs.filter((l) => l.entity === currentHistoryFilter);
    }
    if (!logs.length) {
      list.innerHTML = '<li>ไม่พบประวัติ</li>';
      return;
    }
    list.innerHTML = '';
    logs.forEach((l) => {
      const li = document.createElement('li');
      const time = new Date(l.created_at).toLocaleString('th-TH');
      li.innerHTML = `
        <div class="history-item">
          <div class="history-time">${time}</div>
          <div class="history-action"><b>${actionLabel(l.action)}</b> ${entityLabel(l.entity)}</div>
          <div class="history-user">${escapeHtml(l.user_id)}</div>
        </div>
      `;
      list.appendChild(li);
    });
  } catch (err) {
    list.innerHTML = '<li>ไม่สามารถโหลดประวัติได้</li>';
  }
}

function actionLabel(a) {
  const map = { sync: 'บันทึก', create: 'สร้าง', update: 'แก้ไข', delete: 'ลบ', upload: 'อัปโหลด' };
  return map[a] || a;
}

function entityLabel(e) {
  const map = {
    dailyReports: 'รายงานประจำวัน',
    meetings: 'รายงานประชุม',
    staff: 'ผู้ติดต่อ',
    milestones: 'งวดงาน',
    inspectionHistory: 'เช็คลิสต์',
    plans: 'แบบแปลน',
    adminDocs: 'เอกสารแอดมิน'
  };
  return map[e] || e;
}

$('historyFilter').addEventListener('click', (e) => {
  if (e.target.classList.contains('filter-btn')) {
    $$('#historyFilter .filter-btn').forEach((b) => b.classList.remove('active'));
    e.target.classList.add('active');
    currentHistoryFilter = e.target.dataset.filter;
    renderHistory();
  }
});

/* Init */
initAuth();
