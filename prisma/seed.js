const sqlite3 = require('sqlite3').verbose();
const { randomUUID } = require('crypto');
const path = require('path');

const dbPath = path.join(__dirname, '../dev.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  console.log('? Cleaning old calendar tables...');
  db.run('DELETE FROM LeaveRequest');
  db.run('DELETE FROM User');

  // Generate unique IDs
  const alexId = randomUUID();
  const sarahId = randomUUID();
  const now = new Date().toISOString();

  console.log('? Inserting mock colleagues...');
  // Fixed: User table only takes 'createdAt', no 'updatedAt'
  const insertUser = db.prepare('INSERT INTO User (id, name, email, team, createdAt) VALUES (?, ?, ?, ?, ?)');
  insertUser.run(alexId, 'Alex Johnson', 'alex@company.com', 'Engineering', now);
  insertUser.run(sarahId, 'Sarah Connor', 'sarah@company.com', 'Marketing', now);
  insertUser.finalize();

  console.log('\n? Created mock users. Copy these IDs to test your calendar form:');
  console.log(`Alex's ID: ${alexId}`);
  console.log(`Sarah's ID: ${sarahId}\n`);

  console.log('? Injecting mock vacation ranges...');
  // LeaveRequest takes both 'createdAt' and 'updatedAt'
  const insertLeave = db.prepare('INSERT INTO LeaveRequest (id, userId, startDate, endDate, leaveType, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  
  // June 8 to June 12, 2026
  insertLeave.run(randomUUID(), alexId, new Date('2026-06-08').toISOString(), new Date('2026-06-12').toISOString(), 'vacation', 'approved', now, now);
  // June 10 to June 17, 2026
  insertLeave.run(randomUUID(), sarahId, new Date('2026-06-10').toISOString(), new Date('2026-06-17').toISOString(), 'vacation', 'approved', now, now);
  
  insertLeave.finalize();
  console.log('? Injected mock team holidays into dev.db successfully!');
});

db.close();