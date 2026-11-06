const db = require('./database');

try {
  db.prepare("ALTER TABLE vehicles ADD COLUMN start_trip_time TEXT DEFAULT '08:00'").run();
  console.log('Added start_trip_time to vehicles');
} catch (e) {}

try {
  db.prepare("ALTER TABLE vehicles ADD COLUMN end_trip_time TEXT DEFAULT '18:00'").run();
  console.log('Added end_trip_time to vehicles');
} catch (e) {}

try {
  db.prepare("ALTER TABLE vehicles ADD COLUMN total_toll_fee REAL DEFAULT 340").run();
  console.log('Added total_toll_fee to vehicles');
} catch (e) {}

try {
  db.prepare("ALTER TABLE vehicles ADD COLUMN stoppages_count INTEGER DEFAULT 2").run();
  console.log('Added stoppages_count to vehicles');
} catch (e) {}

console.log('Columns in vehicles:', db.prepare('PRAGMA table_info(vehicles)').all().map(c => c.name));

