let allLeaveRequests = [];
let allEmployees     = [];
let teamCalendar;
let empCalendar;
let teamFilter       = 'all';
let selectedEmpId    = null;
let currentSection   = 'approvals';
let currentAdminId   = null;

const AVATAR_COLORS = ['#4f46e5','#7c3aed','#0891b2','#059669','#d97706','#dc2626','#db2777'];

function avatarColor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

// ── Modal helpers ──────────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

window.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('open');
});

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) { window.location.href = '/'; return; }
    const me = await res.json();
    if (me.role !== 'admin') { window.location.href = '/dashboard'; return; }
    currentAdminId = me.id;
    const initials = me.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    document.querySelector('.sidebar-avatar').textContent = initials;
  } catch { window.location.href = '/'; return; }

  populateYearSelect();
  initTeamCalendar();
  await loadAll();
}

function populateYearSelect() {
  const sel = document.getElementById('year-select');
  const cur = new Date().getFullYear();
  for (let y = cur + 1; y >= cur - 2; y--) {
    const opt = document.createElement('option');
    opt.value = y; opt.textContent = y;
    if (y === cur) opt.selected = true;
    sel.appendChild(opt);
  }
}

async function loadAll() {
  const year = document.getElementById('year-select').value;

  const [lrRes, empRes] = await Promise.all([
    fetch(`/api/leave-requests?year=${year}`),
    fetch('/api/employees')
  ]);
  allLeaveRequests = await lrRes.json();
  allEmployees     = await empRes.json();

  updateStats();
  renderApprovals();
  renderEmployeeList();
  renderTeamCalendar();

  // Refresh selected employee calendar if open
  if (selectedEmpId && currentSection === 'employees') {
    const emp = allEmployees.find(e => e.id === selectedEmpId);
    if (emp) selectEmployee(emp);
  }
}

function updateStats() {
  const year = document.getElementById('year-select').value;
  document.getElementById('stat-pending').textContent   = allLeaveRequests.filter(r => r.status === 'pending').length;
  document.getElementById('stat-approved').textContent  = allLeaveRequests.filter(r => r.status === 'approved' && r.type === 'annual').reduce((s,r) => s + r.days_count, 0);
  document.getElementById('stat-medical').textContent   = allLeaveRequests.filter(r => r.type === 'medical').reduce((s,r) => s + r.days_count, 0);
  document.getElementById('stat-employees').textContent = allEmployees.length;
}

// ── Section nav ────────────────────────────────────────────────────────────
function showSection(name) {
  currentSection = name;
  ['approvals','employees','calendar','settings'].forEach(s => {
    document.getElementById(`section-${s}`).classList.toggle('d-none', s !== name);
    document.getElementById(`nav-${s}`).classList.toggle('active', s === name);
  });
  const meta = {
    approvals: ['Pending Approvals',      'Review and action leave requests'],
    employees: ['Staff Leave Calendars',  'Select an employee to view their calendar'],
    calendar:  ['Team Calendar',          'All staff leave at a glance'],
    settings:  ['Settings',               'Manage staff accounts']
  };
  document.getElementById('page-title').textContent = meta[name][0];
  document.getElementById('page-sub').textContent   = meta[name][1];

  if (name === 'calendar') { teamCalendar && teamCalendar.render(); renderTeamCalendar(); }
  if (name === 'settings') loadSettingsUsers();
}

// ── Approvals ──────────────────────────────────────────────────────────────
function renderApprovals() {
  const pending = allLeaveRequests.filter(r => r.type === 'annual' && r.status === 'pending');
  const el = document.getElementById('approvals-list');

  if (!pending.length) {
    el.innerHTML = `
      <div class="card">
        <div class="empty-state" style="padding:60px 20px">
          <div style="margin-bottom:12px"><svg viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" width="44" height="44"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
          <p style="font-size:14px;font-weight:600;color:var(--text-secondary)">All caught up!</p>
          <p>No pending leave requests to review.</p>
        </div>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:12px">
      ${pending.map(lr => {
        const dateRange = lr.start_date === lr.end_date ? lr.start_date : `${lr.start_date} → ${lr.end_date}`;
        const color = avatarColor(lr.user_name);
        const initials = lr.user_name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
        return `
          <div class="card" style="overflow:visible">
            <div style="padding:16px 20px;display:flex;align-items:center;gap:14px">
              <div class="emp-avatar" style="background:${color}">${initials}</div>
              <div style="flex:1">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
                  <span style="font-weight:700;font-size:14px">${lr.user_name}</span>
                  <span style="font-size:11px;background:#f1f5f9;color:var(--text-muted);padding:2px 8px;border-radius:99px">${lr.department}</span>
                  <span class="badge badge-pending">Pending</span>
                </div>
                <div style="font-size:12px;color:var(--text-muted)">
                  Annual Leave · ${dateRange} · <strong>${lr.days_count}</strong> working day(s)
                  ${lr.reason ? ` · "${lr.reason}"` : ''}
                </div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:2px">Applied ${lr.created_at.slice(0,10)}</div>
              </div>
              <div style="display:flex;gap:8px;flex-shrink:0">
                <button class="btn btn-ghost btn-sm" onclick="doReview(${lr.id},'reject')">Reject</button>
                <button class="btn btn-success btn-sm" onclick="doReview(${lr.id},'approve')" style="display:flex;align-items:center;gap:5px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><polyline points="20 6 9 17 4 12"/></svg>Approve</button>
              </div>
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

function doReview(id, action) {
  const lr = allLeaveRequests.find(r => r.id === id);
  if (!lr) return;

  const dateRange = lr.start_date === lr.end_date ? lr.start_date : `${lr.start_date} → ${lr.end_date}`;
  document.getElementById('review-modal-title').textContent = action === 'approve' ? 'Approve Leave?' : 'Reject Leave?';
  document.getElementById('review-modal-body').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div style="background:#f8fafc;border-radius:10px;padding:14px">
        <div style="font-weight:700;font-size:14px;margin-bottom:4px">${lr.user_name}</div>
        <div style="font-size:13px;color:var(--text-muted)">Annual Leave · ${dateRange}</div>
        <div style="font-size:13px;color:var(--text-muted)"><strong>${lr.days_count}</strong> working day(s)${lr.reason ? ` · "${lr.reason}"` : ''}</div>
      </div>
      ${action === 'approve'
        ? '<p style="font-size:13px;color:var(--text-secondary);margin:0">This will deduct <strong>' + lr.days_count + ' day(s)</strong> from the employee\'s annual leave balance.</p>'
        : '<p style="font-size:13px;color:var(--text-secondary);margin:0">The employee will be notified that their request was not approved.</p>'
      }
    </div>`;

  const approveBtn = document.getElementById('approve-btn');
  const rejectBtn  = document.getElementById('reject-btn');

  approveBtn.classList.toggle('d-none', action !== 'approve');
  rejectBtn.classList.toggle('d-none',  action !== 'reject');

  approveBtn.onclick = async () => {
    await fetch(`/api/leave-requests/${id}/approve`, { method: 'PUT' });
    closeModal('reviewModal');
    await loadAll();
  };
  rejectBtn.onclick = async () => {
    await fetch(`/api/leave-requests/${id}/reject`, { method: 'PUT' });
    closeModal('reviewModal');
    await loadAll();
  };

  openModal('reviewModal');
}

// ── Employee list ──────────────────────────────────────────────────────────
function renderEmployeeList(filter = '') {
  const list = document.getElementById('emp-list');
  const filtered = allEmployees.filter(e =>
    e.name.toLowerCase().includes(filter.toLowerCase()) ||
    e.department.toLowerCase().includes(filter.toLowerCase())
  );

  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state"><p>No employees found.</p></div>';
    return;
  }

  list.innerHTML = filtered.map(emp => {
    const color    = avatarColor(emp.name);
    const initials = emp.name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
    const alLeft   = emp.annual_leave_total  - emp.annual_leave_used;
    const mlLeft   = emp.medical_leave_total - emp.medical_leave_used;
    const selected = emp.id === selectedEmpId ? 'selected' : '';

    return `
      <div class="emp-item ${selected}" onclick="selectEmployee(${JSON.stringify(emp).replace(/"/g,'&quot;')})">
        <div class="emp-avatar" style="background:${color}">${initials}</div>
        <div style="flex:1;min-width:0">
          <div class="emp-name">${emp.name}</div>
          <div class="emp-dept">${emp.department}</div>
          <div class="emp-leave-pills">
            <span class="emp-pill" style="background:#d1fae5;color:#065f46">AL ${alLeft}d</span>
            <span class="emp-pill" style="background:#fee2e2;color:#991b1b">ML ${mlLeft}d</span>
          </div>
        </div>
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="color:var(--text-muted);flex-shrink:0"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
      </div>`;
  }).join('');
}

function filterEmployees() {
  renderEmployeeList(document.getElementById('emp-search').value);
}

async function selectEmployee(emp) {
  // emp may be a stringified object from onclick attr
  if (typeof emp === 'string') emp = JSON.parse(emp);

  selectedEmpId = emp.id;
  renderEmployeeList(document.getElementById('emp-search').value);

  // Show detail panel
  document.getElementById('emp-empty-state').classList.add('d-none');
  document.getElementById('emp-detail').classList.remove('d-none');

  // Fill header
  const color    = avatarColor(emp.name);
  const initials = emp.name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
  document.getElementById('detail-avatar').style.background = color;
  document.getElementById('detail-avatar').textContent = initials;
  document.getElementById('detail-name').textContent   = emp.name;
  document.getElementById('detail-dept').textContent   = emp.department;
  document.getElementById('detail-al').textContent     = emp.annual_leave_total  - emp.annual_leave_used;
  document.getElementById('detail-ml').textContent     = emp.medical_leave_total - emp.medical_leave_used;
  document.getElementById('detail-cal-title').textContent = `${emp.name.split(' ')[0]}'s Leave Calendar`;

  // Load their requests
  const year = document.getElementById('year-select').value;
  const res  = await fetch(`/api/leave-requests?userId=${emp.id}&year=${year}`);
  const requests = await res.json();

  // Init or update employee calendar
  if (!empCalendar) {
    empCalendar = new FullCalendar.Calendar(document.getElementById('emp-calendar'), {
      initialView: 'dayGridMonth',
      headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,dayGridWeek' },
      height: 520,
      eventClick(info) {
        const id = parseInt(info.event.extendedProps.leaveId);
        const lr = requests.find(r => r.id === id);
        if (!lr || lr.status !== 'pending' || lr.type === 'medical') return;
        doReview(id, 'approve');
      }
    });
    empCalendar.render();
  }

  empCalendar.removeAllEvents();
  for (const lr of requests) {
    if (lr.status === 'rejected') continue;
    let cls = lr.type === 'medical' ? 'medical'
            : lr.status === 'approved' ? 'annual-approved' : 'annual-pending';

    const end = new Date(lr.end_date);
    end.setDate(end.getDate() + 1);

    empCalendar.addEvent({
      id: String(lr.id),
      title: lr.type === 'medical' ? 'Medical Leave' : (lr.status === 'approved' ? 'Annual Leave' : 'Pending'),
      start: lr.start_date,
      end: end.toISOString().split('T')[0],
      allDay: true,
      classNames: [cls],
      extendedProps: { leaveId: lr.id }
    });
  }
}

// ── Team calendar ──────────────────────────────────────────────────────────
function initTeamCalendar() {
  teamCalendar = new FullCalendar.Calendar(document.getElementById('team-calendar'), {
    initialView: 'dayGridMonth',
    headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,dayGridWeek' },
    height: 600,
    eventClick(info) {
      const id = parseInt(info.event.extendedProps.leaveId);
      const lr = allLeaveRequests.find(r => r.id === id);
      if (!lr || lr.status !== 'pending') return;
      doReview(id, 'approve');
    }
  });
  teamCalendar.render();
}

function setTeamFilter(f, btn) {
  teamFilter = f;
  document.querySelectorAll('.tab-pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderTeamCalendar();
}

function renderTeamCalendar() {
  if (!teamCalendar) return;
  teamCalendar.removeAllEvents();

  for (const lr of allLeaveRequests) {
    if (lr.status === 'rejected') continue;
    if (teamFilter === 'pending'  && !(lr.type === 'annual'   && lr.status === 'pending'))  continue;
    if (teamFilter === 'approved' && !(lr.type === 'annual'   && lr.status === 'approved')) continue;
    if (teamFilter === 'medical'  && lr.type !== 'medical')                                  continue;

    let cls = lr.type === 'medical' ? 'medical'
            : lr.status === 'approved' ? 'annual-approved' : 'annual-pending';

    const end = new Date(lr.end_date);
    end.setDate(end.getDate() + 1);

    teamCalendar.addEvent({
      id: String(lr.id),
      title: lr.user_name,
      start: lr.start_date,
      end: end.toISOString().split('T')[0],
      allDay: true,
      classNames: [cls],
      extendedProps: { leaveId: lr.id }
    });
  }
}

// ── Settings ───────────────────────────────────────────────────────────────
let allUsers = [];

async function loadSettingsUsers() {
  const res = await fetch('/api/users');
  allUsers = await res.json();
  document.getElementById('settings-search').value = '';
  renderSettingsUsers(allUsers);
}

function filterSettingsUsers() {
  const q = document.getElementById('settings-search').value.toLowerCase();
  renderSettingsUsers(q ? allUsers.filter(u =>
    u.name.toLowerCase().includes(q) ||
    u.email.toLowerCase().includes(q) ||
    (u.department || '').toLowerCase().includes(q)
  ) : allUsers);
}

function renderSettingsUsers(users) {
  const el = document.getElementById('settings-user-list');
  const countEl = document.getElementById('settings-user-count');
  countEl.textContent = `${allUsers.length} account${allUsers.length !== 1 ? 's' : ''}`;

  if (!users.length) {
    el.innerHTML = '<div class="empty-state"><p>No accounts found.</p></div>';
    return;
  }

  el.innerHTML = users.map(u => {
    const color    = avatarColor(u.name);
    const initials = u.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const isMe     = u.id === currentAdminId;
    const roleColor = u.role === 'admin' ? '#7c3aed' : '#059669';
    const roleBg    = u.role === 'admin' ? '#ede9fe'  : '#d1fae5';

    return `
      <div style="display:flex;align-items:center;gap:12px;padding:10px 8px;border-radius:10px;transition:background 0.15s" onmouseenter="this.style.background='#f8fafc'" onmouseleave="this.style.background=''">
        <div class="emp-avatar" style="background:${color};width:40px;height:40px;border-radius:10px;font-size:14px;flex-shrink:0">${initials}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:13px;font-weight:600;color:var(--text-primary)">${u.name}</span>
            <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;background:${roleBg};color:${roleColor}">${u.role.toUpperCase()}</span>
            ${isMe ? '<span style="font-size:10px;background:#f1f5f9;color:var(--text-muted);padding:2px 8px;border-radius:99px">You</span>' : ''}
          </div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:1px">${u.email}${u.department ? ' · ' + u.department : ''}</div>
        </div>
        ${isMe ? `
          <div style="width:80px;text-align:center">
            <span style="font-size:11px;color:var(--text-muted)">Current user</span>
          </div>
        ` : `
          <button onclick="confirmRemoveUser(${u.id}, '${u.name.replace(/'/g, "\\'")}')"
            style="display:flex;align-items:center;gap:5px;padding:6px 12px;border:1.5px solid #fca5a5;border-radius:8px;background:white;color:#dc2626;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.15s;flex-shrink:0"
            onmouseenter="this.style.background='#fee2e2'" onmouseleave="this.style.background='white'">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            Remove
          </button>
        `}
      </div>`;
  }).join('');
}

function confirmRemoveUser(id, name) {
  openModal('removeModal');
  document.getElementById('remove-modal-name').textContent = name;
  document.getElementById('confirm-remove-btn').onclick = () => removeUser(id);
}

async function removeUser(id) {
  const res = await fetch(`/api/employees/${id}`, { method: 'DELETE' });
  const data = await res.json();
  closeModal('removeModal');
  if (!res.ok) {
    alert(data.error);
    return;
  }
  await loadSettingsUsers();
  // Refresh employee list if on staff section
  allEmployees = allEmployees.filter(e => e.id !== id);
  updateStats();
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/';
}

init();
