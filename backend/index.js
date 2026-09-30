require('./secure-env')();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const db = require('./db');
const fetchAndProcessNews = require('./crawler');
const { cleanupNews } = require('./cleaner');
const jobQueue = require('./job-queue');
const scheduler = require('./scheduler');
const modelsRouter = require('./routes/admin/models');
const crawlerRouter = require('./routes/admin/crawler');
const briefingsRouter = require('./routes/briefings');
const adminBriefingsRouter = require('./routes/admin/briefings');
const path = require('path');
const crypto = require('crypto');

// 进程启动时将上一次崩溃遗留的 PROCESSING 任务回退为 PENDING，保证任务不丢失
try {
    const recovered = jobQueue.recoverStale();
    if (recovered > 0) console.log(`[JobQueue] Recovered ${recovered} stale PROCESSING jobs from previous run`);
} catch (e) {
    console.warn('[JobQueue] recoverStale failed:', e.message);
}

const app = express();
const PORT = 3003;
const imagesDir = process.env.IMAGES_DIR || path.join(__dirname, '../frontend/public/images');

app.use(cors());
app.use(express.json());
app.use('/images', express.static(imagesDir));
app.use('/images', express.static(path.join(__dirname, '../frontend/public/images')));

// 主题关键词映射（后端）
const TOPIC_KEYWORDS = {
    model: ['模型', 'OpenAI', 'Claude', 'Gemini', 'GPT', 'LLM', '大模型', '推理'],
    industry: ['公司', '微软', '谷歌', '苹果', 'NVIDIA', '英伟达', '企业', '市场', '芯片', '架构'],
    research: ['研究', '论文', '实验室', '算法', '突破', 'Memory', '训练', '数据集'],
    application: ['应用', '助手', '搜索', '办公', '教育', '医疗', '落地', '工具', '产品'],
    finance: ['投资', '融资', '估值', '基金', '资本', '收购', '并购'],
    market: ['股市', '板块', '财报', '市值', '资本', '融资', '市场', '股价']
};

// API 获取新闻 (支持后端分页、主题分类筛选、关键词搜索)
app.get('/api/news', (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.max(1, parseInt(req.query.pageSize || req.query.limit) || 12);
    const offset = req.query.offset !== undefined ? parseInt(req.query.offset) : (page - 1) * pageSize;

    const topic = req.query.topic || 'all';
    const search = (req.query.search || req.query.q || '').trim();

    const whereConditions = [];
    const params = [];

    // 主题分类过滤
    if (topic && topic !== 'all' && TOPIC_KEYWORDS[topic]) {
        const keywords = TOPIC_KEYWORDS[topic];
        const topicConditions = keywords.map(() => '(title LIKE ? OR summary LIKE ? OR content LIKE ?)');
        whereConditions.push(`(${topicConditions.join(' OR ')})`);
        keywords.forEach(kw => {
            const pattern = `%${kw}%`;
            params.push(pattern, pattern, pattern);
        });
    }

    // 关键词搜索过滤
    if (search) {
        whereConditions.push('(title LIKE ? OR summary LIKE ? OR content LIKE ?)');
        const searchPattern = `%${search}%`;
        params.push(searchPattern, searchPattern, searchPattern);
    }

    const whereSql = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // 查询满足条件的总数
    const countStmt = db.prepare(`SELECT COUNT(*) as total FROM news ${whereSql}`);
    const { total } = countStmt.get(...params);

    // 分页查询列表
    const listStmt = db.prepare(`SELECT * FROM news ${whereSql} ORDER BY createdAt DESC LIMIT ? OFFSET ?`);
    const news = listStmt.all(...params, pageSize, offset);

    const items = news.map(item => ({
        ...item,
        createdAt: item.createdAt ? item.createdAt.replace(' ', 'T') + 'Z' : item.createdAt
    }));

    const totalPages = Math.ceil(total / pageSize) || 1;

    // 兼顾旧接口模式：如果指定了 limit 且没有显式传 page/pageSize 结构，直接返回数组，否则返回标准分页结构
    if (req.query.limit && !req.query.page && !req.query.pageSize) {
        return res.json(items);
    }

    res.json({
        items,
        total,
        page,
        pageSize,
        totalPages
    });
});

const SITE_URL = 'https://news.shbya.com';

// SEO: 文章详情页 SSR
app.get('/ssr/news/:id', (req, res) => {
    const item = db.prepare('SELECT * FROM news WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).send('Not Found');

    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>${item.title} - AI 新闻快讯</title>
    <meta name="description" content="${item.summary}">
    <link rel="canonical" href="${SITE_URL}/news/${item.id}">
    <meta property="og:title" content="${item.title}">
    <meta property="og:description" content="${item.summary}">
    <meta property="og:image" content="${SITE_URL}${item.imageUrl}">
    <meta property="og:url" content="${SITE_URL}/news/${item.id}">
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      "headline": "${item.title.replace(/"/g, '\\"')}",
      "image": ["${SITE_URL}${item.imageUrl}"],
      "datePublished": "${item.createdAt.replace(' ', 'T') + 'Z'}",
      "description": "${item.summary.replace(/"/g, '\\"')}"
    }
    </script>
</head>
<body>
    <h1>${item.title}</h1>
    <p>${item.content.replace(/\n/g, '<br>')}</p>
</body>
</html>
    `;
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
});

// SEO: Sitemap
app.get('/sitemap.xml', (req, res) => {
    const news = db.prepare('SELECT id, createdAt FROM news ORDER BY createdAt DESC').all();
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    news.forEach(item => {
        xml += `  <url><loc>${SITE_URL}/news/${item.id}</loc><lastmod>${item.createdAt.split(' ')[0]}</lastmod></url>\n`;
    });
    xml += '</urlset>';
    res.setHeader('Content-Type', 'application/xml');
    res.send(xml);
});

// SEO: Robots
app.get('/robots.txt', (req, res) => {
    res.setHeader('Content-Type', 'text/plain');
    res.send(`User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml`);
});

// Admin 配置相关
let currentAdminToken = null;

function getSetting(key, defaultValue) {
    try {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
        if (row && row.value !== undefined && row.value !== null && row.value.trim() !== '') {
            return row.value.trim();
        }
    } catch (e) {}
    return process.env[key] !== undefined && process.env[key] !== null ? process.env[key].toString().trim() : defaultValue;
}

function getAdminCredentials() {
    const defaultUsername = 'admin';
    const defaultPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const defaultPasswordHash = crypto.createHash('sha256').update(defaultPassword).digest('hex');

    const username = getSetting('ADMIN_USERNAME', defaultUsername);
    const passwordHash = getSetting('ADMIN_PASSWORD_HASH', defaultPasswordHash);

    return { username, passwordHash };
}

const adminAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing token' });
    }
    const token = authHeader.split(' ')[1];
    const { passwordHash } = getAdminCredentials();

    if (token !== currentAdminToken && token !== passwordHash) {
        return res.status(403).json({ error: 'Forbidden: Invalid token' });
    }
    next();
};

app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    const { username: targetUsername, passwordHash: targetPasswordHash } = getAdminCredentials();

    if (!username || !password) {
        return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    const inputPasswordHash = crypto.createHash('sha256').update(password).digest('hex');

    if (username === targetUsername && inputPasswordHash === targetPasswordHash) {
        currentAdminToken = crypto.randomBytes(32).toString('hex');
        res.json({ success: true, token: currentAdminToken });
    } else {
        res.status(400).json({ error: '用户名或密码错误' });
    }
});

app.post('/api/admin/change-credentials', adminAuth, (req, res) => {
    const { username, oldPassword, newPassword } = req.body;
    const { passwordHash: currentPasswordHash } = getAdminCredentials();

    if (!oldPassword || !newPassword) {
        return res.status(400).json({ error: '原密码和新密码不能为空' });
    }

    const oldHash = crypto.createHash('sha256').update(oldPassword).digest('hex');
    if (oldHash !== currentPasswordHash) {
        return res.status(400).json({ error: '原密码错误，修改失败' });
    }

    const stmt = db.prepare('REPLACE INTO settings (key, value) VALUES (?, ?)');
    try {
        db.transaction(() => {
            if (username && username.trim() !== '') {
                stmt.run('ADMIN_USERNAME', username.trim());
            }
            const newHash = crypto.createHash('sha256').update(newPassword).digest('hex');
            stmt.run('ADMIN_PASSWORD_HASH', newHash);
        })();
        currentAdminToken = null; // 密码修改成功，废除当前 Token 强制重新登录
        res.json({ success: true, message: '账号凭证修改成功，请使用新凭证重新登录' });
    } catch (e) {
        res.status(500).json({ error: '修改凭证失败：' + e.message });
    }
});

app.get('/api/admin/config', adminAuth, (req, res) => {
    res.json({
        ANTHROPIC_BASE_URL: getSetting('ANTHROPIC_BASE_URL', 'https://api.example.com'),
        ANTHROPIC_AUTH_TOKEN: getSetting('ANTHROPIC_AUTH_TOKEN', ''),
        GEMINI_CHAT_MODEL: getSetting('GEMINI_CHAT_MODEL', 'gemini-3.8-flash-high'),
        GEMINI_IMAGE_MODEL: getSetting('GEMINI_IMAGE_MODEL', 'gemini-3.1-flash-image'),
        FALLBACK_IMAGE_MODELS: getSetting('FALLBACK_IMAGE_MODELS', 'gpt-image-2,gpt-image-1.5'),
    });
});

app.post('/api/admin/config', adminAuth, (req, res) => {
    const {
        ANTHROPIC_BASE_URL,
        ANTHROPIC_AUTH_TOKEN,
        GEMINI_CHAT_MODEL,
        GEMINI_IMAGE_MODEL,
        FALLBACK_IMAGE_MODELS
    } = req.body;

    const stmt = db.prepare('REPLACE INTO settings (key, value) VALUES (?, ?)');

    try {
        db.transaction(() => {
            stmt.run('ANTHROPIC_BASE_URL', ANTHROPIC_BASE_URL || '');
            stmt.run('ANTHROPIC_AUTH_TOKEN', ANTHROPIC_AUTH_TOKEN || '');
            stmt.run('GEMINI_CHAT_MODEL', GEMINI_CHAT_MODEL || '');
            stmt.run('GEMINI_IMAGE_MODEL', GEMINI_IMAGE_MODEL || '');
            stmt.run('FALLBACK_IMAGE_MODELS', FALLBACK_IMAGE_MODELS || '');
        })();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: '保存配置失败：' + e.message });
    }
});

// 挂载拆分后的模块化 Admin 路由
app.use('/api/admin/models', adminAuth, modelsRouter);
app.use('/api/admin/crawler', adminAuth, crawlerRouter);
app.use('/api/admin/briefings', adminAuth, adminBriefingsRouter);

// 前台早晚报公共路由
app.use('/api/briefings', briefingsRouter);

app.get('/api/news/count', (req, res) => {
    const row = db.prepare('SELECT COUNT(*) AS count FROM news').get();
    res.json({ count: row.count });
});

app.post('/api/crawl', async (req, res) => {
    try {
        console.log('[API] 手动触发新闻爬取任务 (兼容接口)...');
        scheduler.executeJob('API_LEGACY').catch(err => console.error('Manual fetch error:', err.message));
        res.json({ success: true, message: '抓取任务已在后台启动' });
    } catch (e) {
        if (e.code === 'CRAWLER_BUSY' || e.message.includes('CRAWLER_BUSY')) {
            return res.status(409).json({ error: '当前已有抓取任务正在运行中，请勿重复触发' });
        }
        res.status(500).json({ error: e.message });
    }
});

// 诊断接口：返回 AI 限流/冷却/缓存等实时状态（便于排查 429 问题）
app.get('/api/admin/diagnostics', adminAuth, (req, res) => {
    const { getAdaptiveStats } = require('./ai-service');
    const stats = getAdaptiveStats();
    const jobStats = db.prepare(`
        SELECT status, COUNT(*) AS count
        FROM job_queue
        GROUP BY status
    `).all();
    res.json({
        ai: stats,
        jobs: jobStats.reduce((acc, r) => { acc[r.status] = r.count; return acc; }, {}),
    });
});

// 服务启动与定时调度
if (require.main === module) {
    // 启动动态爬虫调度引擎（自动读取数据库 CRAWLER_CRON_EXPR 与 CRAWLER_ENABLED）
    scheduler.init();

    // 每天凌晨 3:00 强制执行一次数据维保清理
    cron.schedule('0 3 * * *', () => {
        console.log('[Cron] 触发每日 3:00 定时数据维保清理任务...');
        cleanupNews();
    });

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Backend server running on http://127.0.0.1:${PORT}`);
        // 首次启动时先执行一次数据清理，确保失效数据及多余老数据被移除
        cleanupNews();
        // 首次启动时异步运行抓取（受互斥锁保护，不阻塞服务器启动）
        scheduler.executeJob('SERVER_BOOT').catch(err => console.error("Initial fetch failed:", err.message));
    });
}

module.exports = app;
