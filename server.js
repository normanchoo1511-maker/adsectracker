require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt  = require('bcryptjs');
const path    = require('path');
const { connectDB, nextId } = require('./database');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'adsec-leave-tracker-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

let db;

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
  const start = new Date(startDate), end = new Date(endDate);
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const d = cur.getDay();
    if (d !== 0 && d !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function safeUser(u) {
  const { password, _id, ...rest } = u;
  return rest;
}

// ── Auth ───────────────────────────────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, department, role } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'Name, email and password are required.' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'Please enter a valid email address.' });

    const existing = await db.collection('users').findOne({ email: email.trim().toLowerCase() });
    if (existing)
      return res.status(409).json({ error: 'An account with this email already exists.' });

    const userRole = ['employee', 'admin'].includes(role) ? role : 'employee';
    const id       = await nextId(db, 'userId');

    const user = {
      id,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password: bcrypt.hashSync(password, 10),
      role: userRole,
      department: (department || '').trim(),
      annual_leave_total:  14,
      annual_leave_used:   0,
      medical_leave_total: 14,
      medical_leave_used:  0,
      created_at: new Date().toISOString()
    };

    await db.collection('users').insertOne(user);
    req.session.userId = user.id;
    req.session.role   = user.role;
    res.status(201).json(safeUser(user));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await db.collection('users').findOne({ email: email?.trim().toLowerCase() });
    if (!user || !bcrypt.compareSync(password, user.password))
      return res.status(401).json({ error: 'Invalid email or password' });
    req.session.userId = user.id;
    req.session.role   = user.role;
    res.json(safeUser(user));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, async (req, res) => {
  try {
    const user = await db.collection('users').findOne({ id: req.session.userId });
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json(safeUser(user));
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Leave requests ─────────────────────────────────────────────────────────

app.get('/api/leave-requests', requireAuth, async (req, res) => {
  try {
    const { userId: targetId, year } = req.query;
    const filter = {};

    if (req.session.role !== 'admin') {
      filter.user_id = req.session.userId;
    } else if (targetId) {
      filter.user_id = parseInt(targetId);
    }

    if (year) filter.start_date = { $regex: `^${year}` };

    const requests = await db.collection('leaveRequests')
      .find(filter)
      .sort({ start_date: -1 })
      .toArray();

    // Enrich with user info
    const userIds = [...new Set(requests.map(r => r.user_id))];
    const users   = await db.collection('users').find({ id: { $in: userIds } }).toArray();
    const userMap = Object.fromEntries(users.map(u => [u.id, u]));

    const enriched = requests.map(lr => {
      const { _id, ...rest } = lr;
      const u  = userMap[lr.user_id]  || {};
      const rv = lr.reviewed_by ? userMap[lr.reviewed_by] : null;
      return { ...rest, user_name: u.name || '', department: u.department || '', reviewer_name: rv?.name || null };
    });

    res.json(enriched);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/leave-requests', requireAuth, async (req, res) => {
  try {
    const { type, start_date, end_date, reason, mc_note } = req.body;
    const userId = req.session.userId;

    if (!type || !start_date || !end_date)
      return res.status(400).json({ error: 'type, start_date, and end_date are required' });
    if (start_date > end_date)
      return res.status(400).json({ error: 'End date must be on or after start date' });

    const days = countWeekdays(start_date, end_date);
    if (days <= 0)
      return res.status(400).json({ error: 'No working days in the selected range' });

    const user = await db.collection('users').findOne({ id: userId });

    if (type === 'annual') {
      const remaining = user.annual_leave_total - user.annual_leave_used;
      if (days > remaining)
        return res.status(400).json({ error: `Insufficient annual leave. You have ${remaining} day(s) left.` });
    } else if (type === 'medical') {
      const remaining = user.medical_leave_total - user.medical_leave_used;
      if (days > remaining)
        return res.status(400).json({ error: `Insufficient medical leave. You have ${remaining} day(s) left.` });
    }

    const overlap = await db.collection('leaveRequests').findOne({
      user_id: userId,
      status:  { $ne: 'rejected' },
      start_date: { $lte: end_date },
      end_date:   { $gte: start_date }
    });
    if (overlap)
      return res.status(400).json({ error: 'You already have a leave request overlapping these dates.' });

    const status = type === 'medical' ? 'approved' : 'pending';
    const id     = await nextId(db, 'leaveId');

    const lr = {
      id, user_id: userId, type, start_date, end_date, days_count: days,
      reason: reason || '', status, mc_note: mc_note || '',
      reviewed_by: null, reviewed_at: null,
      created_at: new Date().toISOString()
    };

    await db.collection('leaveRequests').insertOne(lr);

    if (type === 'medical') {
      await db.collection('users').updateOne({ id: userId }, { $inc: { medical_leave_used: days } });
    }

    res.json({ id, status, days_count: days });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/leave-requests/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const lr = await db.collection('leaveRequests').findOne({ id });
    if (!lr) return res.status(404).json({ error: 'Not found' });
    if (lr.user_id !== req.session.userId && req.session.role !== 'admin')
      return res.status(403).json({ error: 'Forbidden' });

    if (lr.status === 'approved' && lr.type === 'annual')
      await db.collection('users').updateOne({ id: lr.user_id }, { $inc: { annual_leave_used: -lr.days_count } });
    if (lr.type === 'medical')
      await db.collection('users').updateOne({ id: lr.user_id }, { $inc: { medical_leave_used: -lr.days_count } });

    await db.collection('leaveRequests').deleteOne({ id });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Admin review ───────────────────────────────────────────────────────────

app.put('/api/leave-requests/:id/approve', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const lr = await db.collection('leaveRequests').findOne({ id });
    if (!lr) return res.status(404).json({ error: 'Not found' });
    if (lr.status !== 'pending') return res.status(400).json({ error: 'Request is not pending' });

    await db.collection('leaveRequests').updateOne({ id }, {
      $set: { status: 'approved', reviewed_by: req.session.userId, reviewed_at: new Date().toISOString() }
    });
    await db.collection('users').updateOne({ id: lr.user_id }, { $inc: { annual_leave_used: lr.days_count } });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/leave-requests/:id/reject', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const lr = await db.collection('leaveRequests').findOne({ id });
    if (!lr) return res.status(404).json({ error: 'Not found' });
    if (lr.status !== 'pending') return res.status(400).json({ error: 'Request is not pending' });

    await db.collection('leaveRequests').updateOne({ id }, {
      $set: { status: 'rejected', reviewed_by: req.session.userId, reviewed_at: new Date().toISOString() }
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Employees ──────────────────────────────────────────────────────────────

app.get('/api/employees', requireAdmin, async (req, res) => {
  try {
    const employees = await db.collection('users')
      .find({ role: 'employee' })
      .sort({ name: 1 })
      .toArray();
    res.json(employees.map(safeUser));
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/users', requireAdmin, async (req, res) => {
  try {
    const users = await db.collection('users').find().sort({ name: 1 }).toArray();
    res.json(users.map(safeUser));
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/employees/:id/balances', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { annual_leave_total, medical_leave_total } = req.body;
    await db.collection('users').updateOne({ id }, {
      $set: { annual_leave_total: parseInt(annual_leave_total), medical_leave_total: parseInt(medical_leave_total) }
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/employees/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (id === req.session.userId)
      return res.status(400).json({ error: 'You cannot remove your own account.' });
    const user = await db.collection('users').findOne({ id });
    if (!user) return res.status(404).json({ error: 'User not found.' });

    await db.collection('users').deleteOne({ id });
    await db.collection('leaveRequests').deleteMany({ user_id: id });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Pages ──────────────────────────────────────────────────────────────────

app.get('/',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/admin',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ── Start ──────────────────────────────────────────────────────────────────

connectDB().then(database => {
  db = database;
  app.listen(PORT, () => console.log(`Leave Tracker running at http://localhost:${PORT}`));
}).catch(err => {
  console.error('Failed to connect to MongoDB:', err);
  process.exit(1);
});
