const express = require('express');
const scheduler = require('../../scheduler');
const rssService = require('../../services/rss-service');

const router = express.Router();

// GET /api/admin/crawler/config - 获取调度规则配置与运行指标
router.get('/config', (req, res) => {
    try {
        const status = scheduler.getStatus();
        res.json(status);
    } catch (e) {
        res.status(500).json({ error: '获取爬虫配置失败: ' + e.message });
    }
});

// GET /api/admin/crawler/status - 获取实时状态 (同 /config 或供轮询)
router.get('/status', (req, res) => {
    try {
        res.json(scheduler.getStatus());
    } catch (e) {
        res.status(500).json({ error: '获取爬虫状态失败: ' + e.message });
    }
});

// POST /api/admin/crawler/config - 更新爬虫调度配置（热重载）
router.post('/config', (req, res) => {
    const { enabled, cronExpr, intervalPreset } = req.body;
    try {
        const updatedStatus = scheduler.updateConfig({
            enabled,
            cronExpr,
            intervalPreset
        });
        res.json({
            success: true,
            message: '抓取调度配置更新成功，已实时生效',
            status: updatedStatus
        });
    } catch (err) {
        const statusCode = err.code === 'INVALID_CRON' ? 400 : 500;
        res.status(statusCode).json({ error: err.message });
    }
});

// POST /api/admin/crawler/trigger - 手动立即触发抓取任务
router.post('/trigger', async (req, res) => {
    try {
        // 异步后台触发，不挂起 HTTP 响应
        scheduler.executeJob('MANUAL_API').catch((err) => {
            console.error('[API Trigger] 异步抓取任务执行失败:', err.message);
        });
        res.json({
            success: true,
            message: '采集任务已在后台启动，您可以实时关注运行状态'
        });
    } catch (err) {
        if (err.code === 'CRAWLER_BUSY' || err.message.includes('CRAWLER_BUSY')) {
            return res.status(409).json({ error: '当前已有抓取任务正在运行中，请勿重复触发' });
        }
        res.status(500).json({ error: '启动抓取任务失败: ' + err.message });
    }
});

// ─── RSS 订阅数据源管理路由 ──────────────────────────────────────────

// GET /api/admin/crawler/rss - 获取所有 RSS 订阅源
router.get('/rss', (req, res) => {
    try {
        const items = rssService.getAllSources();
        res.json({
            success: true,
            total: items.length,
            items
        });
    } catch (e) {
        res.status(500).json({ error: '获取 RSS 订阅源失败: ' + e.message });
    }
});

// POST /api/admin/crawler/rss - 新增自定义订阅源 (支持 RSS 与 Webpage)
router.post('/rss', (req, res) => {
    const { name, url, type, directRss, category } = req.body;
    try {
        const item = rssService.addSource({ name, url, type, directRss, category });
        res.json({
            success: true,
            message: `成功添加数据源「${item.name}」`,
            item
        });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// PUT /api/admin/crawler/rss/:id - 修改或启停订阅源
router.put('/rss/:id', (req, res) => {
    const { id } = req.params;
    const { name, url, type, directRss, enabled, category } = req.body;
    try {
        const item = rssService.updateSource(Number(id), { name, url, type, directRss, enabled, category });
        res.json({
            success: true,
            message: `数据源「${item.name}」更新成功`,
            item
        });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// DELETE /api/admin/crawler/rss/:id - 删除指定 RSS 订阅源
router.delete('/rss/:id', (req, res) => {
    const { id } = req.params;
    try {
        const result = rssService.deleteSource(Number(id));
        res.json({
            success: true,
            message: `已成功删除订阅源「${result.deleted.name}」`,
            deleted: result.deleted
        });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// POST /api/admin/crawler/rss/test - 在线探测 RSS/Atom 连通性
router.post('/rss/test', async (req, res) => {
    const { url, directRss } = req.body;
    try {
        const testResult = await rssService.testFeed(url, directRss ?? true);
        res.json({
            success: true,
            result: testResult
        });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// POST /api/admin/crawler/rss/reset - 一键恢复官方默认推荐预设源
router.post('/rss/reset', (req, res) => {
    try {
        const items = rssService.resetToDefaultSources();
        res.json({
            success: true,
            message: `已重置并恢复 ${items.length} 个官方推荐默认源`,
            total: items.length,
            items
        });
    } catch (e) {
        res.status(500).json({ error: '恢复默认源失败: ' + e.message });
    }
});

module.exports = router;
