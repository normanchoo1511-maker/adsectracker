let calendar;
let currentUser = null;
let allRequests = [];

// ── Modal helpers ──────────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

window.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
  }
});

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) { window.location.href = '/'; return; }
    currentUser = await res.json();
  } catch {
    window.location.href = '/';
    return;
  }

  // Greeting
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  document.getElementById('topbar-greeting').textContent = `${greeting}, ${currentUser.name.split(' ')[0]} 👋`;
  document.getElementById('topbar-sub').textContent = `${currentUser.department} · Leave Dashboard`;

  const initials = currentUser.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('sidebar-avatar').textContent = initials;

  populateYearSelect();
  initCalendar();
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

// ── Load data ──────────────────────────────────────────────────────────────
async function loadAll() {
  const meRes = await fetch('/api/me');
  currentUser = await meRes.json();

  const year = document.getElementById('year-select').value;
  const res = await fetch(`/api/leave-requests?year=${year}`);
  allRequests = await res.json();

  updateStats();
  renderCalendarEvents();
  renderLeaveList();
}

function updateStats() {
  const alUsed  = currentUser.annual_leave_used;
  const alTotal = currentUser.annual_leave_total;
  const mlUsed  = currentUser.medical_leave_used;
  const mlTotal = currentUser.medical_leave_total;

  document.getElementById('al-remaining').textContent = alTotal - alUsed;
  document.getElementById('al-sub').textContent = `${alUsed} used of ${alTotal} days`;
  document.getElementById('al-bar').style.width = `${Math.min(100, (alUsed / alTotal) * 100)}%`;

  document.getElementById('ml-remaining').textContent = mlTotal - mlUsed;
  document.getElementById('ml-sub').textContent = `${mlUsed} used of ${mlTotal} days`;
  document.getElementById('ml-bar').style.width = `${Math.min(100, (mlUsed / mlTotal) * 100)}%`;

  const pending  = allRequests.filter(r => r.status === 'pending').length;
  const approved = allRequests.filter(r => r.status === 'approved' && r.type === 'annual')
                              .reduce((s, r) => s + r.days_count, 0);

  document.getElementById('stat-pending').textContent  = pending;
  document.getElementById('stat-approved').textContent = approved;

  const notice = document.getElementById('pending-notice');
  if (pending > 0) {
    document.getElementById('pending-notice-text').innerHTML =
      `You have <strong>${pending} pending</strong> leave request${pending > 1 ? 's' : ''} awaiting approval.`;
    notice.classList.remove('d-none');
  } else {
    notice.classList.add('d-none');
  }
}

// ── Calendar ───────────────────────────────────────────────────────────────
function initCalendar() {
  calendar = new FullCalendar.Calendar(document.getElementById('calendar'), {
    initialView: 'dayGridMonth',
    headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,dayGridWeek' },
    height: 560,
    eventClick(info) {
      showEventDetail(parseInt(info.event.extendedProps.leaveId));
    },
    dateClick(info) {
      openLeaveModal('annual', info.dateStr);
    }
  });
  calendar.render();
}

function renderCalendarEvents() {
  calendar.removeAllEvents();
  for (const lr of allRequests) {
    if (lr.status === 'rejected') continue;
    let cls;
    if (lr.type === 'medical')            cls = 'medical';
    else if (lr.status === 'approved')    cls = 'annual-approved';
    else                                  cls = 'annual-pending';

    const endExclusive = new Date(lr.end_date);
    endExclusive.setDate(endExclusive.getDate() + 1);

    calendar.addEvent({
      id: String(lr.id),
      title: lr.type === 'medical' ? 'Medical Leave' : (lr.status === 'approved' ? 'Annual Leave' : 'Pending'),
      start: lr.start_date,
      end: endExclusive.toISOString().split('T')[0],
      allDay: true,
      classNames: [cls],
      extendedProps: { leaveId: lr.id }
    });
  }
}

function showEventDetail(id) {
  const lr = allRequests.find(r => r.id === id);
  if (!lr) return;

  const typeLabel   = lr.type === 'medical' ? 'Medical Leave' : 'Annual Leave';
  const dateRange   = lr.start_date === lr.end_date ? lr.start_date : `${lr.start_date} → ${lr.end_date}`;
  const canCancel   = lr.status === 'pending' || lr.type === 'medical';
  const statusColor = lr.status === 'approved' ? 'var(--green)' : lr.status === 'pending' ? 'var(--amber)' : 'var(--red)';

  document.getElementById('event-modal-title').textContent = typeLabel;
  document.getElementById('event-modal-body').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;align-items:center;gap:8px">
        <span class="badge badge-${lr.status}">${lr.status.charAt(0).toUpperCase() + lr.status.slice(1)}</span>
        ${lr.type === 'medical' ? '<span class="badge badge-medical">Medical</span>' : ''}
      </div>
      <div style="background:#f8fafc;border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;justify-content:space-between;font-size:13px">
          <span style="color:var(--text-muted)">Date(s)</span>
          <span style="font-weight:600">${dateRange}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:13px">
          <span style="color:var(--text-muted)">Duration</span>
          <span style="font-weight:600">${lr.days_count} working day(s)</span>
        </div>
        ${lr.reason ? `<div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--text-muted)">Reason</span><span style="font-weight:600;text-align:right;max-width:200px">${lr.reason}</span></div>` : ''}
        ${lr.mc_note ? `<div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--text-muted)">MC</span><span style="font-weight:600">${lr.mc_note}</span></div>` : ''}
        ${lr.reviewer_name ? `<div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--text-muted)">Reviewed by</span><span style="font-weight:600">${lr.reviewer_name}</span></div>` : ''}
      </div>
    </div>
  `;

  const cancelBtn = document.getElementById('cancel-leave-btn');
  cancelBtn.classList.toggle('d-none', !canCancel);
  cancelBtn.onclick = () => { closeModal('eventModal'); cancelLeave(id); };

  openModal('eventModal');
}

// ── Leave form ─────────────────────────────────────────────────────────────
function openLeaveModal(type, prefillDate = null) {
  document.getElementById('leave-type').value = type;
  document.getElementById('form-error').classList.add('d-none');

  const isAnnual = type === 'annual';
  document.getElementById('modal-title').textContent    = isAnnual ? 'Apply Annual Leave' : 'Record Medical Leave';
  document.getElementById('submit-btn').textContent     = isAnnual ? 'Submit Request' : 'Record Leave';
  document.getElementById('reason-group').classList.toggle('d-none', !isAnnual);
  document.getElementById('mc-group').classList.toggle('d-none', isAnnual);

  const remaining = isAnnual
    ? currentUser.annual_leave_total - currentUser.annual_leave_used
    : currentUser.medical_leave_total - currentUser.medical_leave_used;

  const infoEl = document.getElementById('leave-info');
  infoEl.className = isAnnual ? 'info-box' : 'info-box-red';
  infoEl.innerHTML = `You have <strong>${remaining} ${isAnnual ? 'annual' : 'medical'} leave</strong> day(s) remaining this year.`;
  infoEl.style.marginBottom = '16px';

  if (prefillDate) {
    document.getElementById('leave-start').value = prefillDate;
    document.getElementById('leave-end').value   = prefillDate;
    updateDaysPreview();
  } else {
    document.getElementById('leave-start').value = '';
    document.getElementById('leave-end').value   = '';
    document.getElementById('days-preview-wrap').classList.add('d-none');
  }

  document.getElementById('leave-reason').value = '';
  document.getElementById('mc-note').value = '';
  openModal('leaveModal');
}

function countWeekdays(start, end) {
  const s = new Date(start), e = new Date(end);
  let count = 0, cur = new Date(s);
  while (cur <= e) {
    const d = cur.getDay();
    if (d !== 0 && d !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function updateDaysPreview() {
  const s = document.getElementById('leave-start').value;
  const e = document.getElementById('leave-end').value;
  const wrap = document.getElementById('days-preview-wrap');
  const txt  = document.getElementById('days-preview-text');
  if (s && e && s <= e) {
    const days = countWeekdays(s, e);
    txt.textContent = `${days} working day${days !== 1 ? 's' : ''}`;
    wrap.classList.remove('d-none');
  } else {
    wrap.classList.add('d-none');
  }
}

document.getElementById('leave-start').addEventListener('change', () => {
  const s = document.getElementById('leave-start').value;
  const e = document.getElementById('leave-end').value;
  if (!e || e < s) document.getElementById('leave-end').value = s;
  updateDaysPreview();
});
document.getElementById('leave-end').addEventListener('change', updateDaysPreview);

async function submitLeave() {
  const errEl = document.getElementById('form-error');
  errEl.classList.add('d-none');

  const payload = {
    type:       document.getElementById('leave-type').value,
    start_date: document.getElementById('leave-start').value,
    end_date:   document.getElementById('leave-end').value,
    reason:     document.getElementById('leave-reason').value,
    mc_note:    document.getElementById('mc-note').value,
  };

  if (!payload.start_date || !payload.end_date) {
    errEl.textContent = 'Please select both start and end dates.';
    errEl.classList.remove('d-none');
    return;
  }

  const res  = await fetch('/api/leave-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();

  if (!res.ok) {
    errEl.textContent = data.error;
    errEl.classList.remove('d-none');
    return;
  }

  closeModal('leaveModal');
  await loadAll();
}

// ── Leave list ─────────────────────────────────────────────────────────────
function renderLeaveList() {
  const el = document.getElementById('leave-list');
  document.getElementById('history-sub').textContent =
    `${allRequests.length} request${allRequests.length !== 1 ? 's' : ''} in ${document.getElementById('year-select').value}`;

  if (!allRequests.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>No leave records for this year.</p></div>';
    return;
  }

  el.innerHTML = allRequests.map(lr => {
    const barColor = lr.type === 'medical' ? 'var(--red)'
                   : lr.status === 'approved' ? 'var(--green)' : 'var(--amber)';
    const typeLabel = lr.type === 'medical' ? 'Medical Leave' : 'Annual Leave';
    const dateRange = lr.start_date === lr.end_date ? lr.start_date : `${lr.start_date} → ${lr.end_date}`;
    const canCancel = lr.status === 'pending' || lr.type === 'medical';

    return `
      <div class="leave-item">
        <div class="leave-type-bar" style="background:${barColor}"></div>
        <div class="leave-meta flex-1">
          <div style="display:flex;align-items:center;gap:8px">
            <span class="title">${typeLabel}</span>
            <span class="badge badge-${lr.status}">${lr.status}</span>
          </div>
          <div class="dates">${dateRange} · <strong>${lr.days_count}</strong> working day(s)${lr.reason ? ` · ${lr.reason}` : ''}</div>
        </div>
        ${canCancel ? `<button class="btn btn-ghost btn-sm" onclick="cancelLeave(${lr.id})" style="flex-shrink:0">Cancel</button>` : ''}
      </div>
    `;
  }).join('');
}

async function cancelLeave(id) {
  if (!confirm('Cancel this leave request?')) return;
  await fetch(`/api/leave-requests/${id}`, { method: 'DELETE' });
  await loadAll();
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/';
}

init();
