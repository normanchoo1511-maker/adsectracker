const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const { db, save } = require('./database');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'adsec-leave-tracker-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  next();
}

function countWeekdays(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function safeUser(u) {
  const { password, ...rest } = u;
  return rest;
}

function enrichLeave(lr) {
  const user = db.users.find(u => u.id === lr.user_id) || {};
  const reviewer = lr.reviewed_by ? db.users.find(u => u.id === lr.reviewed_by) : null;
  return {
    ...lr,
    user_name: user.name || '',
    department: user.department || '',
    reviewer_name: reviewer ? reviewer.name : null
  };
}

// ── Auth ───────────────────────────────────────────────────────────────────

app.post('/api/auth/register', (req, res) => {
  const { name, email, password, department, role } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (db.users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }
  const allowedRoles = ['employee', 'admin'];
  const userRole = allowedRoles.includes(role) ? role : 'employee';

  const id = db.nextUserId++;
  const user = {
    id,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    password: bcrypt.hashSync(password, 10),
    role: userRole,
    department: (department || '').trim(),
    annual_leave_total: 14,
    annual_leave_used: 0,
    medical_leave_total: 14,
    medical_leave_used: 0,
    created_at: new Date().toISOString()
  };
  db.users.push(user);
  save(db);

  req.session.userId = user.id;
  req.session.role = user.role;
  res.status(201).json(safeUser(user));
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.users.find(u => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  req.session.userId = user.id;
  req.session.role = user.role;
  res.json(safeUser(user));
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json(safeUser(user));
});

// ── Leave requests ─────────────────────────────────────────────────────────

app.get('/api/leave-requests', requireAuth, (req, res) => {
  const { userId: targetId, year } = req.query;

  let requests = db.leaveRequests;

  if (req.session.role !== 'admin') {
    requests = requests.filter(r => r.user_id === req.session.userId);
  } else if (targetId) {
    requests = requests.filter(r => r.user_id === parseInt(targetId));
  }

  if (year) {
    requests = requests.filter(r => r.start_date.startsWith(year));
  }

  requests = [...requests].sort((a, b) => b.start_date.localeCompare(a.start_date));
  res.json(requests.map(enrichLeave));
});

app.post('/api/leave-requests', requireAuth, (req, res) => {
  const { type, start_date, end_date, reason, mc_note } = req.body;
  const userId = req.session.userId;

  if (!type || !start_date || !end_date) {
    return res.status(400).json({ error: 'type, start_date, and end_date are required' });
  }
  if (start_date > end_date) {
    return res.status(400).json({ error: 'End date must be on or after start date' });
  }

  const days = countWeekdays(start_date, end_date);
  if (days <= 0) return res.status(400).json({ error: 'No working days in the selected range' });

  const user = db.users.find(u => u.id === userId);

  if (type === 'annual') {
    const remaining = user.annual_leave_total - user.annual_leave_used;
    if (days > remaining) return res.status(400).json({ error: `Insufficient annual leave. You have ${remaining} day(s) left.` });
  } else if (type === 'medical') {
    const remaining = user.medical_leave_total - user.medical_leave_used;
    if (days > remaining) return res.status(400).json({ error: `Insufficient medical leave. You have ${remaining} day(s) left.` });
  }

  // Overlap check
  const overlap = db.leaveRequests.find(r =>
    r.user_id === userId &&
    r.status !== 'rejected' &&
    r.start_date <= end_date &&
    r.end_date >= start_date
  );
  if (overlap) return res.status(400).json({ error: 'You already have a leave request overlapping these dates.' });

  const status = type === 'medical' ? 'approved' : 'pending';
  const id = db.nextLeaveId++;

  const lr = {
    id,
    user_id: userId,
    type,
    start_date,
    end_date,
    days_count: days,
    reason: reason || '',
    status,
    mc_note: mc_note || '',
    reviewed_by: null,
    reviewed_at: null,
    created_at: new Date().toISOString()
  };

  db.leaveRequests.push(lr);

  if (type === 'medical') {
    user.medical_leave_used += days;
  }

  save(db);
  res.json({ id, status, days_count: days });
});

app.delete('/api/leave-requests/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const idx = db.leaveRequests.findIndex(r => r.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  const lr = db.leaveRequests[idx];
  if (lr.user_id !== req.session.userId && req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const user = db.users.find(u => u.id === lr.user_id);
  if (lr.status === 'approved' && lr.type === 'annual') user.annual_leave_used -= lr.days_count;
  if (lr.type === 'medical') user.medical_leave_used -= lr.days_count;

  db.leaveRequests.splice(idx, 1);
  save(db);
  res.json({ ok: true });
});

// ── Admin review ───────────────────────────────────────────────────────────

app.put('/api/leave-requests/:id/approve', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const lr = db.leaveRequests.find(r => r.id === id);
  if (!lr) return res.status(404).json({ error: 'Not found' });
  if (lr.status !== 'pending') return res.status(400).json({ error: 'Request is not pending' });

  lr.status = 'approved';
  lr.reviewed_by = req.session.userId;
  lr.reviewed_at = new Date().toISOString();

  const user = db.users.find(u => u.id === lr.user_id);
  user.annual_leave_used += lr.days_count;

  save(db);
  res.json({ ok: true });
});

app.put('/api/leave-requests/:id/reject', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const lr = db.leaveRequests.find(r => r.id === id);
  if (!lr) return res.status(404).json({ error: 'Not found' });
  if (lr.status !== 'pending') return res.status(400).json({ error: 'Request is not pending' });

  lr.status = 'rejected';
  lr.reviewed_by = req.session.userId;
  lr.reviewed_at = new Date().toISOString();

  save(db);
  res.json({ ok: true });
});

// ── Employees ──────────────────────────────────────────────────────────────

app.get('/api/employees', requireAdmin, (req, res) => {
  const employees = db.users
    .filter(u => u.role === 'employee')
    .map(safeUser)
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json(employees);
});

app.put('/api/employees/:id/balances', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const user = db.users.find(u => u.id === id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  user.annual_leave_total = parseInt(req.body.annual_leave_total) || user.annual_leave_total;
  user.medical_leave_total = parseInt(req.body.medical_leave_total) || user.medical_leave_total;
  save(db);
  res.json({ ok: true });
});

app.delete('/api/employees/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.session.userId) {
    return res.status(400).json({ error: 'You cannot remove your own account.' });
  }
  const idx = db.users.findIndex(u => u.id === id);
  if (idx === -1) return res.status(404).json({ error: 'User not found.' });

  db.users.splice(idx, 1);
  // Also remove their leave requests
  db.leaveRequests = db.leaveRequests.filter(r => r.user_id !== id);
  save(db);
  res.json({ ok: true });
});

// Return all users (admin + employees) for settings page
app.get('/api/users', requireAdmin, (req, res) => {
  const users = db.users
    .map(safeUser)
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json(users);
});

// ── Pages ──────────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.listen(PORT, () => console.log(`Leave Tracker running at http://localhost:${PORT}`));
