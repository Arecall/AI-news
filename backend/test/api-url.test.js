const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Use an isolated database; never load developer credentials or make AI requests.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'news-api-url-'));
process.env.DB_PATH = path.join(tempDir, 'news.db');
process.env.AI_MIN_TIME_MS = '1';
const db = require('../db');
const axios = require('axios');
const express = require('express');
const ai = require('../ai-service');
const modelsRouter = require('../routes/admin/models');

test('probe, single/batch translation and image generation share versioned API paths', async () => {
    const originalPost = axios.post;
    const calls = [];
    let responseData;
    axios.post = async (url) => {
        calls.push(url);
        return { data: responseData };
    };
    const chatResponse = (value) => ({ choices: [{ message: { content: JSON.stringify(value) } }] });
    const app = express();
    app.use(express.json());
    app.use('/models', modelsRouter);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
        const cases = [
            ['https://example.com', 'https://example.com/v1'],
            ['https://example.com/v1', 'https://example.com/v1'],
            [' https://example.com/v1/ ', 'https://example.com/v1'],
            ['https://example.com/proxy/v1/', 'https://example.com/proxy/v1'],
        ];
        for (const [input, base] of cases) {
            db.prepare('REPLACE INTO settings(key, value) VALUES (?, ?)').run('ANTHROPIC_BASE_URL', input);
            db.prepare('REPLACE INTO settings(key, value) VALUES (?, ?)').run('ANTHROPIC_AUTH_TOKEN', 'test-token');
            const start = calls.length;
            responseData = chatResponse({ title: 'ok', content: 'ok' });
            await ai.callGeminiApi(`single ${input}`);
            responseData = chatResponse([{ title: 'one', content: 'one' }, { title: 'two', content: 'two' }]);
            await ai.callGeminiBatch([{ sourceText: `one ${input}` }, { sourceText: `two ${input}` }]);
            responseData = { choices: [{ message: { images: [{ image_url: { url: 'https://example.com/image.png' } }] } }] };
            await ai.generateAiImage('image', 'completions');
            responseData = { data: [{ url: 'https://example.com/image.png' }] };
            await ai.generateAiImage('image', 'generations');
            responseData = chatResponse('pong');
            const response = await fetch(`http://127.0.0.1:${server.address().port}/models/test`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ baseUrl: input, authToken: 'test-token' }),
            });
            assert.equal(response.status, 200);
            assert.equal((await response.json()).success, true);
            assert.deepEqual(calls.slice(start), [
                `${base}/chat/completions`, `${base}/chat/completions`,
                `${base}/chat/completions`, `${base}/images/generations`,
                `${base}/chat/completions`,
            ]);
        }
    } finally {
        axios.post = originalPost;
        await new Promise(resolve => server.close(resolve));
        db.close();
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
