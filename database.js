const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');

const URI     = process.env.MONGODB_URI;
const DB_NAME = 'leave_tracker';

let _db;

async function connectDB() {
  if (_db) return _db;
  const client = new MongoClient(URI);
  await client.connect();
  _db = client.db(DB_NAME);
  console.log('Connected to MongoDB Atlas');
  await seedUsers(_db);
  return _db;
}

async function nextId(db, name) {
  const r = await db.collection('counters').findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  return r.seq;
}

async function seedUsers(db) {
  const count = await db.collection('users').countDocuments();
  if (count > 0) return;

  await db.collection('counters').insertMany([
    { _id: 'userId',  seq: 5 },
    { _id: 'leaveId', seq: 0 }
  ]);

  const defaults = [
    { id: 1, name: 'Admin User', email: 'admin@company.com', password: 'admin123', role: 'admin',    department: 'HR' },
    { id: 2, name: 'Alice Tan',  email: 'alice@company.com', password: 'pass123',  role: 'employee', department: 'Engineering' },
    { id: 3, name: 'Bob Lim',    email: 'bob@company.com',   password: 'pass123',  role: 'employee', department: 'Engineering' },
    { id: 4, name: 'Carol Wong', email: 'carol@company.com', password: 'pass123',  role: 'employee', department: 'Marketing' },
    { id: 5, name: 'David Ng',   email: 'david@company.com', password: 'pass123',  role: 'employee', department: 'Finance' },
  ];

  await db.collection('users').insertMany(defaults.map(u => ({
    ...u,
    password: bcrypt.hashSync(u.password, 10),
    annual_leave_total:  14,
    annual_leave_used:   0,
    medical_leave_total: 14,
    medical_leave_used:  0,
    created_at: new Date().toISOString()
  })));

  console.log('Default users seeded.');
}

module.exports = { connectDB, nextId };
