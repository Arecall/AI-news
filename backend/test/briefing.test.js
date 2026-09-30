const test = require('node:test');
const assert = require('node:assert');
const briefingService = require('../services/briefing-service');
const db = require('../db');

test('BriefingService calculateTimeWindow returns correct structure and time boundaries', () => {
    const morningWin = briefingService.calculateTimeWindow('morning');
    assert.ok(morningWin.dateStr);
    assert.ok(morningWin.startTime);
    assert.ok(morningWin.endTime);
    assert.ok(morningWin.startTime <= morningWin.endTime);

    const eveningWin = briefingService.calculateTimeWindow('evening');
    assert.ok(eveningWin.dateStr);
    assert.ok(eveningWin.startTime);
    assert.ok(eveningWin.endTime);
    assert.ok(eveningWin.startTime <= eveningWin.endTime);
});

test('BriefingService fetchNewsForBriefing retrieves items with fallback protection', () => {
    const window = briefingService.calculateTimeWindow('morning');
    const { newsList, startTime } = briefingService.fetchNewsForBriefing(window.startTime, window.endTime);
    assert.ok(Array.isArray(newsList));
    assert.ok(startTime);
});

test('Briefings DB CRUD operations work as expected', () => {
    const today = briefingService.getLocalDateString();
    const testTitle = `${today} · 单元测试早报`;
    const testContent = {
        summary: '这是单元测试生成的宏观脉搏导语',
        sections: [
            {
                category: '大模型前沿',
                items: [
                    { id: 1, headline: '测试标题', facts: '测试事实', analysis: '测试分析' }
                ]
            }
        ]
    };

    const stmt = db.prepare(`
        INSERT INTO briefings (
            type, date, title, summary, content,
            article_count, article_ids, time_range_start, time_range_end
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
        'morning',
        today,
        testTitle,
        testContent.summary,
        JSON.stringify(testContent),
        1,
        JSON.stringify([1]),
        '2026-09-29 00:00:00',
        '2026-09-29 08:00:00'
    );

    const newId = result.lastInsertRowid;
    assert.ok(newId > 0);

    const fetched = briefingService.getBriefingById(newId);
    assert.strictEqual(fetched.id, Number(newId));
    assert.strictEqual(fetched.type, 'morning');
    assert.strictEqual(fetched.title, testTitle);
    assert.strictEqual(fetched.data.sections[0].category, '大模型前沿');

    const latest = briefingService.getLatestBriefing();
    assert.strictEqual(latest.id, Number(newId));

    const list = briefingService.listBriefings({ page: 1, pageSize: 5 });
    assert.ok(list.total >= 1);
    assert.ok(list.items.length >= 1);

    // 清理测试数据
    db.prepare('DELETE FROM briefings WHERE id = ?').run(newId);
});

test('BriefingService getTodayBriefingPair respects BRIEFING_ENABLED toggle', () => {
    // 备份现有配置
    const originalSetting = db.prepare("SELECT value FROM settings WHERE key = 'BRIEFING_ENABLED'").get();
    try {
        db.prepare("REPLACE INTO settings (key, value) VALUES ('BRIEFING_ENABLED', 'false')").run();
        const pairDisabled = briefingService.getTodayBriefingPair();
        assert.strictEqual(pairDisabled.enabled, false);
        assert.strictEqual(pairDisabled.morning, null);
        assert.strictEqual(pairDisabled.evening, null);

        db.prepare("REPLACE INTO settings (key, value) VALUES ('BRIEFING_ENABLED', 'true')").run();
        const pairEnabled = briefingService.getTodayBriefingPair();
        assert.strictEqual(pairEnabled.enabled, true);
    } finally {
        if (originalSetting && originalSetting.value !== undefined) {
            db.prepare("REPLACE INTO settings (key, value) VALUES ('BRIEFING_ENABLED', ?)").run(originalSetting.value);
        } else {
            db.prepare("DELETE FROM settings WHERE key = 'BRIEFING_ENABLED'").run();
        }
    }
});

test('BriefingService getTodayBriefingPair staggers morning and evening dates during daytime (< 20:00)', () => {
    const pair = briefingService.getTodayBriefingPair();
    const beijingHour = briefingService.getBeijingHour();
    assert.ok(pair.todayDate);

    if (beijingHour < 20) {
        // 白天时段：若存在昨夜晚报，晚报日期应为昨夜或早于今日
        if (pair.evening) {
            assert.ok(pair.evening.date <= pair.todayDate, '晚报日期不应超前于今日');
        }
    }
});

test('Public endpoint GET /api/briefings/latest returns HTTP 200', async () => {
    const app = require('../index');
    const server = app.listen(0);
    try {
        const { port } = server.address();
        const res = await fetch(`http://127.0.0.1:${port}/api/briefings/latest`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.ok('latest' in data);
    } finally {
        const scheduler = require('../scheduler');
        scheduler.stopSchedule();
        await new Promise((resolve) => server.close(resolve));
    }
});
