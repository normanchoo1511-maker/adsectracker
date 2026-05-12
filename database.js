const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'data.json');

function load() {
  if (!fs.existsSync(DB_PATH)) return null;
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function save(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function initDB() {
  let db = load();
  if (db) return db;

  db = {
    nextUserId: 6,
    nextLeaveId: 1,
    users: [],
    leaveRequests: []
  };

  const users = [
    { id: 1, name: 'Admin User',  email: 'admin@company.com',  password: 'admin123',  role: 'admin',    department: 'HR' },
    { id: 2, name: 'Alice Tan',   email: 'alice@company.com',  password: 'pass123',   role: 'employee', department: 'Engineering' },
    { id: 3, name: 'Bob Lim',     email: 'bob@company.com',    password: 'pass123',   role: 'employee', department: 'Engineering' },
    { id: 4, name: 'Carol Wong',  email: 'carol@company.com',  password: 'pass123',   role: 'employee', department: 'Marketing' },
    { id: 5, name: 'David Ng',    email: 'david@company.com',  password: 'pass123',   role: 'employee', department: 'Finance' },
  ];

  db.users = users.map(u => ({
    ...u,
    password: bcrypt.hashSync(u.password, 10),
    annual_leave_total: 14,
    annual_leave_used: 0,
    medical_leave_total: 14,
    medical_leave_used: 0,
    created_at: new Date().toISOString()
  }));

  save(db);
  console.log('Database initialised with default users.');
  return db;
}

const db = initDB();
module.exports = { db, save };
