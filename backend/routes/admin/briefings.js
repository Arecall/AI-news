const express = require('express');
const briefingService = require('../../services/briefing-service');
const db = require('../../db');

const router = express.Router();

function getSetting(key, defaultValue) {
    try {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
        if (row && row.value !== undefined && row.value !== null && row.value.trim() !== '') {
            return row.value.trim();
        }
    } catch (e) {}
    return defaultValue;
}

// GET /api/admin/briefings/status - 获取早晚报生成状态与调度配置
router.get('/status', (req, res) => {
    try {
        const todayStr = briefingService.getLocalDateString();
        const todayMorning = db.prepare("SELECT id, type, date, title, article_count, created_at FROM briefings WHERE type = 'morning' AND date = ? ORDER BY created_at DESC LIMIT 1").get(todayStr);
        const todayEvening = db.prepare("SELECT id, type, date, title, article_count, created_at FROM briefings WHERE type = 'evening' AND date = ? ORDER BY created_at DESC LIMIT 1").get(todayStr);
        const latest = briefingService.getLatestBriefing();

        res.json({
            enabled: getSetting('BRIEFING_ENABLED', 'true') === 'true',
            autoEnabled: getSetting('BRIEFING_AUTO_ENABLED', 'true') === 'true',
            timezone: 'Asia/Shanghai',
            morningCron: getSetting('BRIEFING_MORNING_CRON', '0 8 * * *'),
            eveningCron: getSetting('BRIEFING_EVENING_CRON', '0 20 * * *'),
            layout: getSetting('BRIEFING_UI_LAYOUT', 'bento'),
            isGenerating: briefingService.isGenerating,
            todayMorning,
            todayEvening,
            latest
        });
    } catch (e) {
        res.status(500).json({ error: '获取早晚报状态失败: ' + e.message });
    }
});

// POST /api/admin/briefings/generate - 手动触发生成早报或晚报
router.post('/generate', async (req, res) => {
    const { type = 'morning', force = false } = req.body;
    if (type !== 'morning' && type !== 'evening') {
        return res.status(400).json({ error: 'type 必须为 "morning" 或 "evening"' });
    }

    try {
        console.log(`[Admin] 手动触发生成 ${type === 'morning' ? '早报' : '晚报'}...`);
        const briefing = await briefingService.generateBriefing(type, force);
        res.json({
            success: true,
            message: `AI ${type === 'morning' ? '科技早报' : '焦点晚报'}生成成功！`,
            briefing
        });
    } catch (err) {
        if (err.code === 'BRIEFING_BUSY' || err.message.includes('BRIEFING_BUSY')) {
            return res.status(409).json({ error: '当前已有早晚报正在生成中，请稍后刷新' });
        }
        res.status(500).json({ error: '生成早晚报失败: ' + err.message });
    }
});

// POST /api/admin/briefings/config - 更新早晚报调度配置与展示风格
router.post('/config', (req, res) => {
    const { enabled, autoEnabled, morningCron, eveningCron, layout } = req.body;
    const cron = require('node-cron');
    const scheduler = require('../../scheduler');

    if (morningCron && !cron.validate(morningCron.trim())) {
        return res.status(400).json({ error: '早报 Cron 表达式格式不正确' });
    }
    if (eveningCron && !cron.validate(eveningCron.trim())) {
        return res.status(400).json({ error: '晚报 Cron 表达式格式不正确' });
    }

    const stmt = db.prepare('REPLACE INTO settings (key, value) VALUES (?, ?)');
    try {
        db.transaction(() => {
            if (enabled !== undefined) {
                stmt.run('BRIEFING_ENABLED', String(enabled));
            }
            if (autoEnabled !== undefined) {
                stmt.run('BRIEFING_AUTO_ENABLED', String(autoEnabled));
            }
            if (morningCron) {
                stmt.run('BRIEFING_MORNING_CRON', morningCron.trim());
            }
            if (eveningCron) {
                stmt.run('BRIEFING_EVENING_CRON', eveningCron.trim());
            }
            if (layout && (layout === 'bento' || layout === 'segmented')) {
                stmt.run('BRIEFING_UI_LAYOUT', layout);
            }
        })();

        // 重新加载早晚报定时调度
        scheduler.reloadBriefingSchedules();

        res.json({
            success: true,
            message: '早晚报配置及前台展示布局已更新生效'
        });
    } catch (e) {
        res.status(500).json({ error: '保存早晚报配置失败: ' + e.message });
    }
});

module.exports = router;
