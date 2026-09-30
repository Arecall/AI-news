const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const app = require('../index');
const db = require('../db');

test('Admin decoupled APIs: auth, models, crawler and backward compatibility', async () => {
    // 备份现有设置，测试完毕后恢复，避免污染数据库
    const backupSettings = db.prepare('SELECT key, value FROM settings').all();
    const server = app.listen(0);
    try {
        const { port } = server.address();
        const baseUrl = `http://127.0.0.1:${port}`;

        // 1. 获取默认密码进行登录
        const defaultPassword = process.env.ADMIN_PASSWORD || 'admin123';
        const loginRes = await fetch(`${baseUrl}/api/admin/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: defaultPassword })
        });
        assert.strictEqual(loginRes.status, 200, 'Login should succeed');
        const { token } = await loginRes.json();
        assert.ok(token, 'Should receive admin token');

        const authHeaders = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        };

        // 2. 测试 GET /api/admin/models
        const modelsGetRes = await fetch(`${baseUrl}/api/admin/models`, { headers: authHeaders });
        assert.strictEqual(modelsGetRes.status, 200);
        const modelsData = await modelsGetRes.json();
        assert.ok('ANTHROPIC_BASE_URL' in modelsData);
        assert.ok('GEMINI_CHAT_MODEL' in modelsData);
        assert.ok('GEMINI_IMAGE_MODEL' in modelsData);
        assert.ok('FALLBACK_IMAGE_MODELS' in modelsData);

        // 3. 测试 POST /api/admin/models 更新配置
        const modelsPostRes = await fetch(`${baseUrl}/api/admin/models`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
                ANTHROPIC_BASE_URL: 'https://test-tokens.example.com',
                GEMINI_CHAT_MODEL: 'gemini-3.8-flash-test',
                GEMINI_IMAGE_MODEL: 'gemini-3.1-flash-image-test',
                FALLBACK_IMAGE_MODELS: 'gpt-test-1,gpt-test-2'
            })
        });
        assert.strictEqual(modelsPostRes.status, 200);
        const modelsPostResult = await modelsPostRes.json();
        assert.strictEqual(modelsPostResult.success, true);

        // 4. 验证更新已落库
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('GEMINI_CHAT_MODEL');
        assert.strictEqual(row.value, 'gemini-3.8-flash-test');

        // 5. 测试 GET /api/admin/crawler/config
        const crawlerGetRes = await fetch(`${baseUrl}/api/admin/crawler/config`, { headers: authHeaders });
        assert.strictEqual(crawlerGetRes.status, 200);
        const crawlerData = await crawlerGetRes.json();
        assert.strictEqual(typeof crawlerData.enabled, 'boolean');
        assert.ok(crawlerData.cronExpr);

        // 6. 测试 POST /api/admin/crawler/config 更新调度
        const crawlerPostRes = await fetch(`${baseUrl}/api/admin/crawler/config`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
                enabled: true,
                cronExpr: '0 */3 * * *',
                intervalPreset: 'custom'
            })
        });
        assert.strictEqual(crawlerPostRes.status, 200);
        const crawlerPostResult = await crawlerPostRes.json();
        assert.strictEqual(crawlerPostResult.success, true);
        assert.strictEqual(crawlerPostResult.status.cronExpr, '0 */3 * * *');

        // 7. 测试非法 Cron 表达式应返回 400
        const invalidCronRes = await fetch(`${baseUrl}/api/admin/crawler/config`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
                enabled: true,
                cronExpr: '* * * * * *', // 6位秒级非法
                intervalPreset: 'custom'
            })
        });
        assert.strictEqual(invalidCronRes.status, 400);

        // 8. 测试向后兼容接口 GET /api/admin/config
        const legacyGetRes = await fetch(`${baseUrl}/api/admin/config`, { headers: authHeaders });
        assert.strictEqual(legacyGetRes.status, 200);
        const legacyData = await legacyGetRes.json();
        assert.strictEqual(legacyData.GEMINI_CHAT_MODEL, 'gemini-3.8-flash-test');

    } finally {
        const scheduler = require('../scheduler');
        scheduler.stopSchedule();
        await new Promise((resolve) => server.close(resolve));

        // 恢复数据库原有配置
        const restoreStmt = db.prepare('REPLACE INTO settings (key, value) VALUES (?, ?)');
        db.transaction(() => {
            backupSettings.forEach((row) => {
                restoreStmt.run(row.key, row.value);
            });
        })();
    }
});
