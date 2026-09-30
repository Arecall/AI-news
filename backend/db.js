const path = require('path');
const Database = require('better-sqlite3');
const dbPath = process.env.DB_PATH || path.join(__dirname, 'news.db');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    summary TEXT,
    content TEXT,
    imageUrl TEXT,
    originalUrl TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS briefings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    date TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT,
    content TEXT NOT NULL,
    article_count INTEGER DEFAULT 0,
    article_ids TEXT,
    time_range_start DATETIME NOT NULL,
    time_range_end DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_briefings_date_type ON briefings(date, type);
  CREATE INDEX IF NOT EXISTS idx_briefings_created_at ON briefings(created_at);

  CREATE TABLE IF NOT EXISTS rss_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    type TEXT DEFAULT 'rss',                -- 'rss' | 'webpage'
    direct_rss INTEGER DEFAULT 1,
    enabled INTEGER DEFAULT 1,
    category TEXT DEFAULT '自定义订阅',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_rss_sources_enabled ON rss_sources(enabled);
`);

// 数据库平滑演进：向后兼容添加 type 字段
try {
  db.exec("ALTER TABLE rss_sources ADD COLUMN type TEXT DEFAULT 'rss'");
} catch (e) {
  // 列已存在时忽略
}

const DEFAULT_RSS_SOURCES = [
  { name: 'Google News AI', url: 'https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fnews.google.com%2Frss%2Fsearch%3Fq%3DAI%2Bwhen%3A1d%26hl%3Den-US%26gl%3DUS%26ceid%3DUS%3Aen', type: 'rss', directRss: 0, category: '聚合快讯' },
  { name: 'TechCrunch AI', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', type: 'rss', directRss: 1, category: '权威科技媒体' },
  { name: 'Ars Technica AI', url: 'https://feeds.arstechnica.com/arstechnica/index', type: 'rss', directRss: 1, category: '深度技术分析' },
  { name: 'Wired AI', url: 'https://www.wired.com/feed/tag/ai/latest/rss', type: 'rss', directRss: 1, category: '前沿商业洞察' },
  { name: 'The Verge AI', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', type: 'rss', directRss: 1, category: '数字生活与产品' },
  { name: 'Hugging Face Blog', url: 'https://huggingface.co/blog/feed.xml', type: 'rss', directRss: 1, category: '开源模型社区' },
  { name: 'OpenAI News', url: 'https://openai.com/news/rss.xml', type: 'rss', directRss: 1, category: '官方机构动态' },
  { name: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/', type: 'rss', directRss: 1, category: '顶级学术评述' },
  { name: 'DeepMind Blog', url: 'https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fdeepmindsafety.substack.com%2Ffeed', type: 'rss', directRss: 0, category: '安全与前沿研究' },
  { name: 'ArXiv AI', url: 'https://api.rss2json.com/v1/api.json?rss_url=http%3A%2F%2Fexport.arxiv.org%2Frss%2Fcs.AI', type: 'rss', directRss: 0, category: '学术预印本' },
];

function seedDefaultRssSources(forceReset = false) {
  try {
    if (forceReset) {
      db.prepare('DELETE FROM rss_sources').run();
    } else {
      const count = db.prepare('SELECT COUNT(*) as count FROM rss_sources').get().count;
      if (count > 0) return;
    }

    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO rss_sources (name, url, type, direct_rss, enabled, category)
      VALUES (?, ?, ?, ?, 1, ?)
    `);

    const insertMany = db.transaction((sources) => {
      for (const s of sources) {
        insertStmt.run(s.name, s.url, s.type || 'rss', s.directRss ?? 1, s.category || '官方预设');
      }
    });

    insertMany(DEFAULT_RSS_SOURCES);
    console.log(`[DB] 已初始化注入 ${DEFAULT_RSS_SOURCES.length} 个默认官方 RSS 订阅源`);
  } catch (err) {
    console.error('[DB] 初始化默认 RSS 源失败:', err.message);
  }
}

// 自动初始化检查
seedDefaultRssSources(false);

db.DEFAULT_RSS_SOURCES = DEFAULT_RSS_SOURCES;
db.seedDefaultRssSources = seedDefaultRssSources;

module.exports = db;
