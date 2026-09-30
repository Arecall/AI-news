const express = require('express');
const briefingService = require('../services/briefing-service');

const router = express.Router();

// GET /api/briefings/latest - 获取最新一期早报或晚报
router.get('/latest', (req, res) => {
    try {
        const latest = briefingService.getLatestBriefing();
        res.json({ latest });
    } catch (e) {
        res.status(500).json({ error: '获取最新早晚报失败: ' + e.message });
    }
});

// GET /api/briefings/pair - 获取成对早晚报数据及布局风格配置
router.get('/pair', (req, res) => {
    try {
        const pair = briefingService.getTodayBriefingPair();
        res.json(pair);
    } catch (e) {
        res.status(500).json({ error: '获取早晚报数据失败: ' + e.message });
    }
});

// GET /api/briefings - 分页获取历史早晚报列表
router.get('/', (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const pageSize = Math.max(1, parseInt(req.query.pageSize || req.query.limit) || 10);
        const type = req.query.type || null;

        const result = briefingService.listBriefings({ page, pageSize, type });
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: '获取早晚报列表失败: ' + e.message });
    }
});

// GET /api/briefings/:id - 获取指定期数的早晚报详情
router.get('/:id', (req, res) => {
    try {
        const item = briefingService.getBriefingById(req.params.id);
        if (!item) {
            return res.status(404).json({ error: '未找到指定早晚报' });
        }
        res.json(item);
    } catch (e) {
        res.status(500).json({ error: '获取早晚报详情失败: ' + e.message });
    }
});

module.exports = router;
