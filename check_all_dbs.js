const fs = require('fs');
const path = require('path');
const Database = require('./backend/node_modules/better-sqlite3');

const paths = [
  path.join(__dirname, 'news.db'),
  path.join(__dirname, 'backend', 'news.db'),
  path.join(__dirname, 'frontend', 'news.db')
];

paths.forEach(p => {
  console.log(`Checking database at: ${p}`);
  if (!fs.existsSync(p)) {
    console.log('  File does not exist.\n');
    return;
  }
  try {
    const db = new Database(p);
    const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='news'").get();
    if (!tableCheck) {
      console.log('  Table "news" does not exist in this database.\n');
      return;
    }
    const count = db.prepare('SELECT COUNT(*) as count FROM news').get();
    console.log(`  Table "news" exists. Row count: ${count.count}`);
    if (count.count > 0) {
      const latest = db.prepare('SELECT id, title, createdAt FROM news ORDER BY id DESC LIMIT 2').all();
      console.log('  Latest entries:', JSON.stringify(latest, null, 2));
    }
    db.close();
  } catch (err) {
    console.log(`  Error reading database: ${err.message}`);
  }
  console.log();
});
