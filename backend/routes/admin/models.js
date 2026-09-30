const express = require('express');
const axios = require('axios');
const db = require('../../db');
const { normalizeApiBaseUrl } = require('../../services/api-url');

const router = express.Router();

function getSetting(key, defaultValue) {
    try {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
        if (row && row.value !== undefined && row.value !== null && row.value.trim() !== '') {
            return row.value.trim();
        }
    } catch (e) {}
    return process.env[key] !== undefined && process.env[key] !== null ? process.env[key].toString().trim() : defaultValue;
}

function maskToken(token) {
    if (!token) return '';
    if (token.length <= 8) return '********';
    return `${token.slice(0, 4)}****${token.slice(-4)}`;
}

// GET /api/admin/models - 获取模型与密钥配置
router.get('/', (req, res) => {
    try {
        const rawToken = getSetting('ANTHROPIC_AUTH_TOKEN', '');
        res.json({
            ANTHROPIC_BASE_URL: getSetting('ANTHROPIC_BASE_URL', 'https://api.example.com'),
            ANTHROPIC_AUTH_TOKEN: rawToken, // 供管理表单编辑
            ANTHROPIC_AUTH_TOKEN_MASKED: maskToken(rawToken),
            hasAuthToken: Boolean(rawToken),
            GEMINI_CHAT_MODEL: getSetting('GEMINI_CHAT_MODEL', 'gemini-3.8-flash-high'),
            GEMINI_IMAGE_MODEL: getSetting('GEMINI_IMAGE_MODEL', 'gemini-3.1-flash-image'),
            FALLBACK_IMAGE_MODELS: getSetting('FALLBACK_IMAGE_MODELS', 'gpt-image-2,gpt-image-1.5'),
        });
    } catch (e) {
        res.status(500).json({ error: '获取模型配置失败: ' + e.message });
    }
});

// POST /api/admin/models - 更新模型与密钥配置
router.post('/', (req, res) => {
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
            if (ANTHROPIC_BASE_URL !== undefined) {
                stmt.run('ANTHROPIC_BASE_URL', ANTHROPIC_BASE_URL.trim());
            }
            // 如果提供了新的有效 Token（非掩码且非全星号）才更新
            if (ANTHROPIC_AUTH_TOKEN !== undefined) {
                const tokenTrim = ANTHROPIC_AUTH_TOKEN.trim();
                if (!tokenTrim.includes('****')) {
                    stmt.run('ANTHROPIC_AUTH_TOKEN', tokenTrim);
                }
            }
            if (GEMINI_CHAT_MODEL !== undefined) {
                stmt.run('GEMINI_CHAT_MODEL', GEMINI_CHAT_MODEL.trim());
            }
            if (GEMINI_IMAGE_MODEL !== undefined) {
                stmt.run('GEMINI_IMAGE_MODEL', GEMINI_IMAGE_MODEL.trim());
            }
            if (FALLBACK_IMAGE_MODELS !== undefined) {
                stmt.run('FALLBACK_IMAGE_MODELS', FALLBACK_IMAGE_MODELS.trim());
            }
        })();
        res.json({ success: true, message: 'AI 模型配置保存成功' });
    } catch (e) {
        res.status(500).json({ error: '保存模型配置失败: ' + e.message });
    }
});

// POST /api/admin/models/test - 连通性探针测试
router.post('/test', async (req, res) => {
    const baseUrl = (req.body.baseUrl || getSetting('ANTHROPIC_BASE_URL', 'https://api.example.com')).trim().replace(/\/+$/, '');
    let token = req.body.authToken;
    if (!token || token.includes('****')) {
        token = getSetting('ANTHROPIC_AUTH_TOKEN', '');
    }
    const model = (req.body.chatModel || getSetting('GEMINI_CHAT_MODEL', 'gemini-3.8-flash-high')).trim();

    if (!baseUrl) {
        return res.status(400).json({ success: false, error: 'Base URL 不能为空' });
    }
    if (!token) {
        return res.status(400).json({ success: false, error: '未配置 API 授权 Token' });
    }

    const startTs = Date.now();
    try {
        const response = await axios.post(
            `${normalizeApiBaseUrl(baseUrl)}/chat/completions`,
            {
                model,
                messages: [{ role: 'user', content: 'Say "pong" in 1 word' }],
                max_tokens: 10,
            },
            {
                timeout: 15000,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token.trim()}`,
                },
            }
        );

        const latencyMs = Date.now() - startTs;
        const reply = response.data?.choices?.[0]?.message?.content || 'OK';

        res.json({
            success: true,
            latencyMs,
            model,
            reply: reply.trim()
        });
    } catch (err) {
        const latencyMs = Date.now() - startTs;
        const errMsg = err.response?.data?.error?.message || err.response?.data?.message || err.message;
        res.status(502).json({
            success: false,
            latencyMs,
            error: `连通性测试失败 (${err.response?.status || 'Network Error'}): ${errMsg}`
        });
    }
});

module.exports = router;
