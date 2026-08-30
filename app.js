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

function showView(name) {
  if (name === 'admin' && sessionStorage.getItem('adminUnlocked') !== '1') {
    adminGateTarget = 'admin';
    $('adminGate').hidden = false;
    return;
  }
  views.forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
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
          { id: 'tree-removal', label: 'ตัด/ขุดย้ายต้นไม้ (Tree removal)' },
          { id: 'site-clearing', label: 'เคลียร์พื้นที่ (Site clearing)' },
          { id: 'demolition', label: 'รื้อถอนโครงสร้างเดิมและกำจัดเศษ (Demolition)' }
        ] },
      { id: 'sp-1-2', label: '1.2 งานสำรวจและปักผัง',
        items: [
          { id: 'setting-out', label: 'ปักหมุดผังอาคาร (Setting out)' },
          { id: 'boundary-survey', label: 'สำรวจขอบเขตที่ดิน (Boundary survey)' },
          { id: 'grid-alignment', label: 'ตรวจแนวเสาและ grid ตรงตามแบบ (Column grid alignment)' }
        ] },
      { id: 'sp-1-3', label: '1.3 งานขุดดินหลุมฐานรากและคานคอดิน',
        items: [
          { id: 'exc-depth', label: 'ความลึกคูขุดตรงตามแบบ (Excavation depth)' },
          { id: 'exc-alignment', label: 'ตำแหน่งและขนาดคูขุดถูกต้อง (Footing and ground beam excavation)' },
          { id: 'exc-clean', label: 'พื้นคูขุดสะอาดพร้อมลงฐาน (Clean and ready)' }
        ] },
      { id: 'sp-1-4', label: '1.4 งานถมดินบดอัดและปรับระดับพื้น',
        items: [
          { id: 'soil-compaction', label: 'บดอัดดินถึงค่าความหนาแน่นที่กำหนด (Soil compaction)' },
          { id: 'backfilling', label: 'ถมดินคืนหลังโครงสร้างเสร็จ (Backfilling)' },
          { id: 'subgrade-level', label: 'ระดับพื้นตอม่อ/พื้นดินถูกต้อง (Subgrade preparation)' }
        ] }
    ]
  },
  {
    id: 'structural', label: '2. งานโครงสร้าง', color: '#c9a227',
    subs: [
      { id: 'st-2-1', label: '2.1 งานเสาเข็ม',
        items: [
          { id: 'pile-driving', label: 'ตำแหน่ง/ขนาด/ความลึกเสาเข็มถูกต้อง (Pile driving / bored piling)' },
          { id: 'pile-cutoff', label: 'ระดับตัดหัวเข็ม (Pile cut-off level)' },
          { id: 'pile-concrete', label: 'คอนกรีตโครงสร้างเทมิด/เข็มไม่รั่ว (Pile integrity)' }
        ] },
      { id: 'st-2-2', label: '2.2 คอนกรีตหยาบและทรายหยาบรองก้นหลุม',
        items: [
          { id: 'lean-concrete', label: 'คอนกรีตหยาบลงหลุมเรียบร้อย (Lean concrete)' },
          { id: 'sand-cushion', label: 'ทรายหยาบรองก้นหลุมหนาถูกต้อง (Sand cushion)' },
          { id: 'blinding-level', label: 'ระดับและความเรียบของบล๊อคดิน (Sub-base level)' }
        ] },
      { id: 'st-2-3', label: '2.3 งานฐานรากและตอม่อ',
        items: [
          { id: 'ft-rebar-size', label: 'ขนาดและระยะเหล็กเสริมฐานรากถูกต้อง (Rebar size/spacing)' },
          { id: 'ft-formwork', label: 'แบบหล่อตั้งฉาก ประกอบแน่น (Formwork)' },
          { id: 'ft-pour', label: 'เทคอนกรีตเรียบร้อย ไม่มี honeycomb (Concrete pouring)' }
        ] },
      { id: 'st-2-4', label: '2.4 งานคานคอดิน',
        items: [
          { id: 'gb-formwork', label: 'แบบหล่อคานคอดินแข็งแรง (Ground beam formwork)' },
          { id: 'gb-rebar', label: 'เหล็กเสริมคานคอดินถูกต้อง (Rebar inspection)' },
          { id: 'gb-waterproofing', label: 'กันซึมบริเวณคานคอดินปิดมิด (Waterproofing application)' }
        ] },
      { id: 'st-2-5', label: '2.5 งานพื้นคอนกรีตอัดแรง / พื้นหล่อในที่',
        items: [
          { id: 'slab-mesh', label: 'ตำแหน่ง wire mesh / เหล็กเสริมพื้นถูกต้อง (Wire mesh/rebar)' },
          { id: 'slab-thickness', label: 'ความหนาพื้นตรงตามแบบ (Slab thickness)' },
          { id: 'slab-level', label: 'ระดับพื้นเรียบและถูกต้อง (Level check)' }
        ] },
      { id: 'st-2-6', label: '2.6 งานเสาชั้น 1 และชั้น 2',
        items: [
          { id: 'col-alignment', label: 'เสาตั้งฉากและอยู่ตำแหน่งถูกต้อง (Vertical alignment)' },
          { id: 'col-formwork', label: 'แบบหล่อเสาประกอบแน่น (Formwork)' },
          { id: 'col-cast', label: 'เทคอนกรีตเสาเรียบร้อย (Concrete casting)' }
        ] },
      { id: 'st-2-7', label: '2.7 งานคานและพื้นชั้นบน',
        items: [
          { id: 'ub-formwork', label: 'แบบหล่อคาน/พื้นชั้นบนแข็งแรง (Beam & slab formwork)' },
          { id: 'ub-rebar', label: 'เหล็กเสริมคานและพื้นชั้นบนถูกต้อง (Rebar)' },
          { id: 'ub-cast', label: 'เทคอนกรีตคาน/พื้นชั้นบนไม่มีปัญหา (Concrete casting)' }
        ] },
      { id: 'st-2-8', label: '2.8 งานโครงหลังคา',
        items: [
          { id: 'truss-alignment', label: 'โครงหลังคาติดตั้งตรงแนว (Steel truss alignment)' },
          { id: 'truss-welding', label: 'งานเชื่อมแข็งแรงและเรียบร้อย (Welding quality)' },
          { id: 'trust-rust', label: 'ทาสี/กันสนิมครบถ้วน (Anti-rust coating)' }
        ] }
    ]
  },
  {
    id: 'arch-me', label: '3. งานสถาปัตยกรรมและงานระบบ', color: '#c9a227',
    subs: [
      { id: 'am-3-1', label: '3.1 งานก่อผนัง',
        items: [
          { id: 'wall-joint', label: 'ขนาดรอยต่ออิฐ/บล็อกถูกต้อง (Joint thickness)' },
          { id: 'wall-verticality', label: 'ผนังตั้งฉากและเรียบ (Verticality)' },
          { id: 'wall-lintel', label: 'คานทับหน้าต่าง/ประตูติดตั้งถูกต้อง (Lintel beams)' }
        ] },
      { id: 'am-3-2', label: '3.2 งานฉาบปูนผนัง',
        items: [
          { id: 'plaster-thickness', label: 'ความหนาฉาบปูนถูกต้อง (Plastering thickness)' },
          { id: 'plaster-curing', label: 'บำรุงรักษาปูน (Curing)' },
          { id: 'plaster-flatness', label: 'พื้นผิวฉาบเรียบ (Surface flatness)' }
        ] },
      { id: 'am-3-3', label: '3.3 งานระบบประปาและสุขาภิบาล',
        items: [
          { id: 'plumbing-pipe', label: 'ตำแหน่งท่อประปา/ท่อน้ำทิ้งถูกต้อง (Pipe installation)' },
          { id: 'plumbing-test', label: 'ทดสอบความดัน/รั่วซึม (Pressure and leakage test)' },
          { id: 'plumbing-drain', label: 'ท่อระบายน้ำลาดเอียงถูกต้อง (Drainage slope)' }
        ] },
      { id: 'am-3-4', label: '3.4 งานระบบไฟฟ้าและสื่อสาร',
        items: [
          { id: 'elec-conduit', label: 'ทางเดินสายไฟ/ท่อลอยเรียบร้อย (Conduit layout)' },
          { id: 'elec-box', label: 'ตำแหน่งกล่องปลั๊ก/สวิตช์ถูกต้อง (Box placement)' },
          { id: 'elec-wire', label: 'การเดินสายไฟเตรียมพร้อม (Wiring preparation)' }
        ] },
      { id: 'am-3-5', label: '3.5 งานมุงหลังคาและฉนวนกันความร้อน',
        items: [
          { id: 'roof-tile', label: 'กระเบื้องหลังคาปูเรียบร้อย (Roofing tiles)' },
          { id: 'roof-flashing', label: 'แผ่นปิดมุม/รอยต่อมิดชิด (Flashing)' },
          { id: 'roof-insulation', label: 'ฉนวนกันความร้อนติดตั้งครบ (Insulation)' }
        ] },
      { id: 'am-3-6', label: '3.6 งานฝ้าเพดาน',
        items: [
          { id: 'ceiling-frame', label: 'โครงฝ้าเพดานเรียงตรง (Ceiling framework)' },
          { id: 'ceiling-gypsum', label: 'แผ่นฝ้าติดตั้งเรียบร้อย (Gypsum board alignment)' },
          { id: 'ceiling-light', label: 'ตำแหน่งช่องไฟ/ลำโพงถูกต้อง (Light and equipment holes)' }
        ] },
      { id: 'am-3-7', label: '3.7 งานปูกระเบื้องและพื้นผิว',
        items: [
          { id: 'tile-layout', label: 'การวางกระเบื้องตรงแนว (Tiling alignment)' },
          { id: 'tile-slope', label: 'พื้นเปียกลาดเอียงระบายน้ำได้ (Slope in wet areas)' },
          { id: 'floor-surface', label: 'พื้น laminate/vinyl ติดตั้งเรียบร้อย (Laminate/vinyl flooring)' }
        ] },
      { id: 'am-3-8', label: '3.8 งานติดตั้งวงกบ ประตู และหน้าต่าง',
        items: [
          { id: 'door-frame', label: 'วงกบประตู/หน้าต่างตั้งฉาก (Frame installation)' },
          { id: 'window-glass', label: 'กระจกติดตั้งมิดชิด (Glass installation)' },
          { id: 'window-seal', label: 'ยาแนวกันซึมรอบกระจก/วงกบ (Waterproofing seal)' }
        ] },
      { id: 'am-3-9', label: '3.9 งานทาสี',
        items: [
          { id: 'paint-surface', label: 'ผิวงานสะอาดก่อนทาสี (Surface preparation)' },
          { id: 'paint-primer', label: 'รองพื้นทาครบถ้วน (Primer coat)' },
          { id: 'paint-finish', label: 'สีทับหน้าสม่ำเสมอ (Finish coats)' }
        ] },
      { id: 'am-3-10', label: '3.10 งานติดตั้งสุขภัณฑ์และอุปกรณ์ไฟฟ้า',
        items: [
          { id: 'sanitary-fix', label: 'อุปกรณ์ห้องน้ำติดตั้งแน่น (Sanitary wares)' },
          { id: 'light-fix', label: 'โคมไฟ/หลอดไฟติดตั้งถูกต้อง (Light fixtures)' },
          { id: 'switch-socket', label: 'สวิตช์/ปลั๊กทำงานปกติ (Switches, sockets)' }
        ] }
    ]
  },
  {
    id: 'finishing', label: '4. งานตกแต่งและเก็บรายละเอียด', color: '#c9a227',
    subs: [
      { id: 'fi-4-1', label: '4.1 ตรวจสอบ Defect งานสถาปัตย์',
        items: [
          { id: 'paint-touchup', label: 'สีแต้มซ่อมเรียบร้อย (Paint touch-ups)' },
          { id: 'door-adjust', label: 'ประตู/หน้าต่างเปิด-ปิดดี (Door/window adjustments)' },
          { id: 'wall-crack', label: 'ไม่มีรอยแตกร้าวผนัง (Wall cracks check)' }
        ] },
      { id: 'fi-4-2', label: '4.2 ตรวจสอบระบบไฟฟ้าและประปาซ้ำ',
        items: [
          { id: 'leak-test', label: 'ทดสอบรั่วซึมอีกครั้ง (Leakage test)' },
          { id: 'socket-power', label: 'ปลั๊ก/สวิตช์มีไฟทุกจุด (Socket power check)' },
          { id: 'me-function', label: 'ระบบไฟฟ้าและประปาใช้งานได้ (M&E final testing)' }
        ] },
      { id: 'fi-4-3', label: '4.3 งานทำความสะอาดใหญ่ก่อนส่งมอบ',
        items: [
          { id: 'clean-glass', label: 'กระจก/กระจกบานเลื่อนสะอาด (Window glass)' },
          { id: 'clean-floor', label: 'พื้นสะอาดไม่มีคราบ (Floors)' },
          { id: 'debris-removal', label: 'เศษวัสดุ/ขยะก่อสร้างเก็บออกหมด (Debris removal)' }
        ] }
    ]
  },
  {
    id: 'handover', label: '5. งานส่งมอบบ้าน', color: '#c9a227',
    subs: [
      { id: 'ho-5-1', label: '5.1 ตรวจรับงานรอบสุดท้ายกับลูกค้า',
        items: [
          { id: 'client-walk', label: 'พาลูกค้าตรวจรับบ้านรอบสุดท้าย (Final walk-through with client)' },
          { id: 'defect-sign', label: 'ลงนาม Defect ที่ต้องแก้ไข (Defect list sign-off)' },
          { id: 'client-approval', label: 'ลูกค้ายืนยันรับงาน (Client approval)' }
        ] },
      { id: 'ho-5-2', label: '5.2 จัดเตรียมเอกสารคู่มือและใบรับประกัน',
        items: [
          { id: 'manuals', label: 'คู่มือบ้าน/อุปกรณ์ครบถ้วน (Manuals)' },
          { id: 'warranties', label: 'ใบรับประกัน/ใบเสร็จ (Warranties)' },
          { id: 'asbuilt', label: 'แบบ as-built หรือแผนผังบ้าน (As-built drawings)' }
        ] },
      { id: 'ho-5-3', label: '5.3 ส่งมอบกุญแจและเซ็นเอกสารโอนสิทธิ์',
        items: [
          { id: 'key-handover', label: 'ส่งมอบกุญแจ/รีโมทครบถ้วน (Key handover)' },
          { id: 'sign-off', label: 'เซ็นเอกสารตรวจรับ/โอนสิทธิ์ (Formal sign-off)' },
          { id: 'handover-complete', label: 'ยืนยันส่งมอบบ้านเรียบร้อย (Handover complete)' }
        ] }
    ]
  }
];

let inspectionState = load('inspectionState', {});
let inspectionHistory = load('inspectionHistory', []);
let currentSubId = null;

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
    card.innerHTML = `<h3>${escapeHtml(cat.label)}</h3>`;
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

function openInspection(subId) {
  const sub = subById(subId);
  if (!sub) return;
  currentSubId = subId;
  $('inspectionTitle').textContent = sub.label;
  renderInspection(sub);
  $('inspectionModal').hidden = false;
}

function closeInspection() {
  $('inspectionModal').hidden = true;
  currentSubId = null;
}

function renderInspection(sub) {
  const box = $('inspectionList');
  box.innerHTML = '';
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
    openInspection(e.target.dataset.sub);
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
  $('pdfModal').hidden = true;
  $('pdfEmbed').src = '';
  if (currentPdfUrl) URL.revokeObjectURL(currentPdfUrl);
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
  subSel.innerHTML = '<option value="" disabled selected>เลือกหัวข้อย่อย</option>' +
    (cat ? cat.subs.map((s) => `<option value="${s.id}">${escapeHtml(s.label)}</option>`).join('') : '');
  taskSel.innerHTML = '<option value="" disabled selected>เลือกรายการตรวจ</option>';
}

function populateAdminTaskOptions() {
  const catSel = $('adminCategory');
  const subSel = $('adminSub');
  const taskSel = $('adminTask');
  if (!catSel || !subSel || !taskSel) return;
  const cat = INSP_CATEGORIES.find((c) => c.id === catSel.value);
  const sub = cat ? cat.subs.find((s) => s.id === subSel.value) : null;
  taskSel.innerHTML = '<option value="" disabled selected>เลือกรายการตรวจ</option>' +
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

async function viewAdminDocById(id) {
  try {
    const docs = await getAdminDocs();
    const doc = docs.find((d) => d.id === Number(id));
    if (!doc || !doc.file) return;
    if (currentPdfUrl) URL.revokeObjectURL(currentPdfUrl);
    currentPdfUrl = URL.createObjectURL(doc.file);
    $('pdfEmbed').src = currentPdfUrl;
    $('pdfTitle').textContent = doc.title;
    $('pdfModal').hidden = false;
  } catch (err) {
    alert('ไม่สามารถเปิดเอกสารได้');
  }
}

function categoryDocButtons(categoryId) {
  const docs = adminDocCache ? adminDocCache.filter((d) => d.categoryId === categoryId) : [];
  if (!docs.length) return '';
  return `
    <div class="cat-docs">
      <b>เอกสารอ้างอิง:</b>
      <div class="cat-docs-list">
        ${docs.map((d) => `<button type="button" class="view-cat-doc" data-docid="${d.id}">${escapeHtml(d.title)}</button>`).join('')}
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
  const subId = $('adminSub').value;
  const taskId = $('adminTask').value;
  if (!catId || !subId || !taskId) {
    alert('กรุณาเลือกหมวด หัวข้อย่อย และรายการตรวจ');
    return;
  }
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
    await renderAdminDocs();
    await refreshAdminDocCache();
    renderInspectionCategories();
    alert('อัปโหลดเอกสารแล้ว');
  } catch (err) {
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

async function captureOffscreen(el, scale = 2) {
  if (!el) throw new Error('No element provided for capture');
  if (!isElementRenderable(el)) {
    throw new Error(`Element not renderable: ${el.id || 'unknown'} (hidden or zero size)`);
  }
  const clone = el.cloneNode(true);
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.position = 'fixed';
  host.style.left = '0';
  host.style.top = '-9999px';
  host.style.width = '595px';
  host.style.height = '842px';
  host.style.overflow = 'visible';
  host.style.visibility = 'visible';
  host.style.opacity = '1';
  host.style.pointerEvents = 'none';
  host.style.zIndex = '-9999';
  host.appendChild(clone);
  document.body.appendChild(host);
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  await waitForImages(clone);
  try {
    const canvas = await html2canvas(clone, { scale, useCORS: true, backgroundColor: null, logging: false });
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

async function canvasToDataUrl(el, type = 'image/png', quality = 0.95, scale = 2) {
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
  ctx.fillStyle = '#0a1628';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(c1, 0, 0);
  ctx.drawImage(c2, 0, c1.height);
  return canvas;
}

async function downloadCombinedImage(type, ext, quality = 0.95, scale = 2) {
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

async function shareCombinedImage(scale = 2) {
  if (currentExportIndex === null) throw new Error('No report selected for export');
  if (typeof html2canvas !== 'function') throw new Error('html2canvas not loaded');
  const page1 = await captureOffscreen($('exportReport'), scale);
  const page2 = await captureOffscreen($('exportPhotos'), scale);
  const combined = combineCanvases(page1, page2);
  return new Promise((resolve, reject) => {
    combined.toBlob((blob) => {
      if (!blob) return reject(new Error('Combined image toBlob returned null'));
      const file = new File([blob], `daily-report-${dailyReports[currentExportIndex].date}.png`, { type: 'image/png' });
      resolve(file);
    }, 'image/png');
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
