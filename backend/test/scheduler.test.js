const test = require('node:test');
const assert = require('node:assert');
const scheduler = require('../scheduler');

test('Scheduler validateCron accepts valid expressions and rejects invalid/dangerous ones', () => {
    // 合法表达式
    assert.strictEqual(scheduler.validateCron('0 */2 * * *').valid, true);
    assert.strictEqual(scheduler.validateCron('*/15 * * * *').valid, true);
    assert.strictEqual(scheduler.validateCron('30 4 * * *').valid, true);

    // 非法格式
    assert.strictEqual(scheduler.validateCron('invalid-cron').valid, false);
    assert.strictEqual(scheduler.validateCron('').valid, false);

    // 过频调度保护（秒级或每分钟）
    assert.strictEqual(scheduler.validateCron('* * * * * *').valid, false); // 6位秒级
    assert.strictEqual(scheduler.validateCron('* * * * *').valid, false); // 每分钟
    assert.strictEqual(scheduler.validateCron('*/1 * * * *').valid, false); // 每分钟
});

test('Scheduler executeJob concurrency mutex lock prevents simultaneous runs', async () => {
    // 模拟运行态
    scheduler.isRunning = true;
    try {
        await scheduler.executeJob('TEST');
        assert.fail('Should have thrown CRAWLER_BUSY error');
    } catch (err) {
        assert.strictEqual(err.code, 'CRAWLER_BUSY');
    } finally {
        scheduler.isRunning = false;
    }
});

test('Scheduler getStatus returns structured runtime metadata', () => {
    const status = scheduler.getStatus();
    assert.strictEqual(typeof status.enabled, 'boolean');
    assert.strictEqual(typeof status.cronExpr, 'string');
    assert.strictEqual(typeof status.intervalPreset, 'string');
    assert.strictEqual(typeof status.isRunning, 'boolean');
    assert.ok('jobQueue' in status);
});

test('Admin routes /api/admin/models and /api/admin/crawler require authentication', async () => {
    const app = require('../index');
    const server = app.listen(0);
    try {
        const { port } = server.address();

        // 未携带 token 应返回 401
        const resModels = await fetch(`http://127.0.0.1:${port}/api/admin/models`);
        assert.strictEqual(resModels.status, 401);

        const resCrawler = await fetch(`http://127.0.0.1:${port}/api/admin/crawler/config`);
        assert.strictEqual(resCrawler.status, 401);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});
