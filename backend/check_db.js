const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const paths = [
    path.join(__dirname, 'news.db'),
    path.join(__dirname, '../news.db'),
    path.join(__dirname, '../frontend/news.db')
];

paths.forEach(p => {
  if (fs.existsSync(p)) {
    try {
      const db = new Database(p);
      const row = db.prepare('SELECT COUNT(*) as count FROM news').get();
      console.log(`${p}: ${row.count} rows`);
      db.close();
    } catch(e) {
      console.log(`${p}: error ${e.message}`);
    }
  } else {
    console.log(`${p}: missing`);
  }
});
