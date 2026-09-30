const test = require('node:test');
const assert = require('node:assert');
const rssService = require('../services/rss-service');
const db = require('../db');

test('RssService initializes with 10 default sources', () => {
    const sources = rssService.getAllSources();
    assert.ok(Array.isArray(sources));
    assert.strictEqual(sources.length, 10);
    const techCrunch = sources.find((s) => s.name === 'TechCrunch AI');
    assert.ok(techCrunch);
    assert.strictEqual(techCrunch.directRss, 1);
    assert.strictEqual(techCrunch.enabled, 1);
});

test('RssService prevents invalid and SSRF URLs', () => {
    assert.throws(() => {
        rssService.addSource({ name: '内网', url: 'http://127.0.0.1:8080/feed' });
    }, /禁止订阅私有内网/);

    assert.throws(() => {
        rssService.addSource({ name: 'localhost', url: 'http://localhost/rss' });
    }, /禁止订阅私有内网/);

    assert.throws(() => {
        rssService.addSource({ name: '非法协议', url: 'ftp://example.com/rss' });
    }, /仅支持 HTTP 或 HTTPS/);

    assert.throws(() => {
        rssService.addSource({ name: '', url: 'https://valid.com/feed' });
    }, /订阅源名称不能为空/);
});

test('RssService CRUD workflow (Add -> Read -> Update -> Delete)', () => {
    const testUrl = 'https://custom-ai-feed-test.org/feed.xml';

    // Add
    const added = rssService.addSource({
        name: '自定义测试媒体',
        url: testUrl,
        directRss: 1,
        category: '测试分类'
    });
    assert.ok(added.id > 0);
    assert.strictEqual(added.name, '自定义测试媒体');
    assert.strictEqual(added.category, '测试分类');

    // Duplicate detection
    assert.throws(() => {
        rssService.addSource({ name: '重复', url: testUrl });
    }, /已存在/);

    // Update
    const updated = rssService.updateSource(added.id, {
        enabled: false,
        name: '更新后的名称'
    });
    assert.strictEqual(updated.enabled, 0);
    assert.strictEqual(updated.name, '更新后的名称');

    // Active sources excludes disabled
    const active = rssService.getActiveSources();
    assert.ok(!active.some((s) => s.id === added.id));

    // Add with type webpage
    const addedWeb = rssService.addSource({
        name: 'AI 前沿网页周刊',
        url: 'https://example-ai-weekly.com/news',
        type: 'webpage',
        directRss: 0,
        category: '行业周刊'
    });
    assert.strictEqual(addedWeb.type, 'webpage');
    assert.strictEqual(addedWeb.category, '行业周刊');
    rssService.deleteSource(addedWeb.id);

    // Delete
    const delResult = rssService.deleteSource(added.id);
    assert.strictEqual(delResult.success, true);
    assert.strictEqual(rssService.getSourceById(added.id), undefined);
});

test('RssService extractWebpageArticles parses HTML and resolves absolute URLs', async () => {
    const mockHtml = `
        <!DOCTYPE html>
        <html>
        <head><title>前沿 AI 资讯网</title></head>
        <body>
            <header><a href="/home">首页导航</a></header>
            <main>
                <article>
                    <a href="/news/2026/09/deepseek-r2-released">DeepSeek-R2 正式开源发布，推理能力破纪录</a>
                </article>
                <article>
                    <a href="/news/2026/09/claude-4-launch">Claude 4.0 旗舰多模态突破，支持百万级上下文</a>
                </article>
            </main>
            <footer><a href="/about">关于我们</a></footer>
        </body>
        </html>
    `;

    const articles = await rssService.extractWebpageArticles(mockHtml, 'https://example-ai-news.org');
    assert.ok(Array.isArray(articles));
    assert.ok(articles.length >= 1);
    assert.ok(articles[0].link.startsWith('https://'));
    assert.ok(articles.some(a => a.title.includes('DeepSeek') || a.title.includes('Claude')));
});

test('RssService resetToDefaultSources restores default preset sources', () => {
    // 模拟删掉一个源
    const sources = rssService.getAllSources();
    const firstId = sources[0].id;
    rssService.deleteSource(firstId);
    assert.strictEqual(rssService.getAllSources().length, 9);

    // 触发重置
    const restored = rssService.resetToDefaultSources();
    assert.strictEqual(restored.length, 10);
    const techCrunch = restored.find((s) => s.name === 'TechCrunch AI');
    assert.ok(techCrunch);
});

test('Admin RSS endpoints integration test with auth check', async () => {
    const app = require('../index');
    const server = app.listen(0);
    try {
        const { port } = server.address();

        // 未授权访问应该 401
        const unauthRes = await fetch(`http://127.0.0.1:${port}/api/admin/crawler/rss`);
        assert.strictEqual(unauthRes.status, 401);

        // 登录获取 token
        const loginRes = await fetch(`http://127.0.0.1:${port}/api/admin/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin123' })
        });
        const loginData = await loginRes.json();
        assert.ok(loginData.token);

        // 带 token 访问列表
        const authRes = await fetch(`http://127.0.0.1:${port}/api/admin/crawler/rss`, {
            headers: { Authorization: `Bearer ${loginData.token}` }
        });
        assert.strictEqual(authRes.status, 200);
        const data = await authRes.json();
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.total, 10);
    } finally {
        const scheduler = require('../scheduler');
        scheduler.stopSchedule();
        await new Promise((resolve) => server.close(resolve));
    }
});
