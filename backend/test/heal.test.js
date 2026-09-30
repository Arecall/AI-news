const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

test('heal_fallback_images correctly falls back to AI image generation on failure', async () => {
    const axios = require('axios');
    const Database = require('better-sqlite3');

    const originalPost = axios.post;
    const originalGet = axios.get;

    // 1. 创建临时的测试数据库
    const testDbPath = path.join(__dirname, 'test_heal.db');
    if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
    }

    const testDb = new Database(testDbPath);
    testDb.exec(`
        CREATE TABLE IF NOT EXISTS news (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            summary TEXT,
            content TEXT,
            imageUrl TEXT,
            originalUrl TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 写入三条用于测试的数据：
    // (1) 原网页中包含 og:image，能够成功下载并治愈的资讯
    testDb.prepare("INSERT INTO news (title, imageUrl, originalUrl) VALUES (?, ?, ?)").run(
        'Success Article',
        '/images/ogimage.png',
        'https://example.com/success'
    );
    // (2) 原网页 HTML 中不包含任何封面元数据，需要降级到 AI 生成的资讯
    testDb.prepare("INSERT INTO news (title, imageUrl, originalUrl) VALUES (?, ?, ?)").run(
        'AI Fallback Article (No Meta)',
        '/images/banner1.png',
        'https://example.com/no-image'
    );
    // (3) 请求原网页直接抛出网络异常，需要降级到 AI 生成的资讯
    testDb.prepare("INSERT INTO news (title, imageUrl, originalUrl) VALUES (?, ?, ?)").run(
        'AI Fallback Article (Network Error)',
        '/images/meta-img.png',
        'https://example.com/fail-get'
    );

    // 2. 模拟 axios.get 拦截
    axios.get = async (url, config) => {
        if (url === 'https://example.com/success') {
            return {
                data: `<html><head><meta property="og:image" content="https://example.com/success.jpg"></head><body></body></html>`
            };
        }
        if (url === 'https://example.com/no-image') {
            return {
                data: `<html><head></head><body>No image metadata inside</body></html>`
            };
        }
        if (url === 'https://example.com/fail-get') {
            throw new Error('Connect timeout or server error');
        }

        // 模拟对获取原图与 AI 配图下载请求的支持 (由于 downloadImage 在 axios 里的 method 强制写死为 GET)
        throw new Error(`Unexpected GET request to: ${url}`);
    };

    // 模拟针对 downloadImage 使用原生 require 挂载时的 axios 导出
    const originalAxios = axios;
    const axiosStub = async (config) => {
        if (config.url === 'https://example.com/success.jpg') {
            const Readable = require('stream').Readable;
            const s = new Readable();
            s.push('fake-original-image-data');
            s.push(null);
            return {
                headers: { 'content-type': 'image/jpeg' },
                data: s
            };
        }
        if (config.url === 'https://test-cdn.google.com/ai-gen-image.png') {
            const Readable = require('stream').Readable;
            const s = new Readable();
            s.push('fake-ai-generated-image-data');
            s.push(null);
            return {
                headers: { 'content-type': 'image/png' },
                data: s
            };
        }
        if (typeof config === 'string') {
            return axiosStub({ url: config, method: 'GET' });
        }
        return originalAxios(config);
    };

    // 拷贝 axios 的其他属性，如 post, get 并修改 require hook
    // 直接赋值方法属性以防对只读属性或 constructor 进行 assign
    for (const key of Object.keys(originalAxios)) {
        try {
            axiosStub[key] = originalAxios[key];
        } catch (e) {}
    }
    axiosStub.get = axios.get;

    // 3. 模拟 axios.post (针对 generateAiImage API 的调用)
    let aiPromptsCalled = [];
    axiosStub.post = async (url, body, config) => {
        if (url.includes('/chat/completions')) {
            aiPromptsCalled.push(body.messages[0].content);
            return {
                data: {
                    choices: [{
                        message: {
                            content: null,
                            images: [{ image_url: { url: 'https://test-cdn.google.com/ai-gen-image.png' } }]
                        }
                    }]
                }
            };
        }
        throw new Error(`Unexpected POST request to: ${url}`);
    };

    // 拦截 axios 的 require
    const Module = require('module');
    const originalRequire = Module.prototype.require;
    Module.prototype.require = function(id) {
        if (id === 'axios') {
            return axiosStub;
        }
        return originalRequire.apply(this, arguments);
    };

    // 4. 重定向文件存储至临时测试目录，防写穿真实资源
    const tempImagesDir = path.join(__dirname, 'temp_images');
    if (!fs.existsSync(tempImagesDir)) {
        fs.mkdirSync(tempImagesDir, { recursive: true });
    }

    const originalExistsSync = fs.existsSync;
    fs.existsSync = (p) => {
        if (p.includes('public/images')) {
            return true;
        }
        return originalExistsSync(p);
    };

    const originalCreateWriteStream = fs.createWriteStream;
    fs.createWriteStream = (p) => {
        if (p.includes('public/images')) {
            const fileName = path.basename(p);
            return originalCreateWriteStream(path.join(tempImagesDir, fileName));
        }
        return originalCreateWriteStream(p);
    };

    const originalWriteFile = fs.promises.writeFile;
    fs.promises.writeFile = async (p, data, options) => {
        if (p.includes('public/images')) {
            const fileName = path.basename(p);
            return originalWriteFile(path.join(tempImagesDir, fileName), data, options);
        }
        return originalWriteFile(p, data, options);
    };

    try {
        process.env.ANTHROPIC_BASE_URL = 'https://api.example.com';
        process.env.ANTHROPIC_AUTH_TOKEN = 'sk-test';

        // 5. 执行治愈流程
        delete require.cache[require.resolve('../heal_fallback_images')];
        const { heal } = require('../heal_fallback_images');

        await heal(testDb);

        // 6. 数据断言校验
        const rows = testDb.prepare('SELECT id, title, imageUrl FROM news ORDER BY id').all();

        // 校验 1: 能够爬取到原图的新闻被成功更新
        assert.ok(rows[0].imageUrl.startsWith('/images/'));
        assert.ok(!rows[0].imageUrl.includes('ogimage.png'));

        // 校验 2: 无原图元数据的新闻已通过 AI 重绘生成
        assert.ok(rows[1].imageUrl.startsWith('/images/'));
        assert.ok(!rows[1].imageUrl.includes('banner1.png'));

        // 校验 3: 请求网页超时报错的新闻已通过 AI 重绘生成
        assert.ok(rows[2].imageUrl.startsWith('/images/'));
        assert.ok(!rows[2].imageUrl.includes('meta-img.png'));

        // 校验 4: 证实 AI 确实接收到了对应的提示词
        assert.strictEqual(aiPromptsCalled.length, 2);
        assert.ok(aiPromptsCalled[0].includes('AI Fallback Article (No Meta)'));
        assert.ok(aiPromptsCalled[1].includes('AI Fallback Article (Network Error)'));

        console.log('✔ All healing logic test assertions passed successfully.');
    } finally {
        // 7. 清理模拟状态与临时测试资源
        axios.post = originalPost;
        axios.get = originalGet;
        fs.existsSync = originalExistsSync;
        fs.createWriteStream = originalCreateWriteStream;
        fs.promises.writeFile = originalWriteFile;
        Module.prototype.require = originalRequire;

        testDb.close();
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
        if (fs.existsSync(tempImagesDir)) {
            fs.rmSync(tempImagesDir, { recursive: true, force: true });
        }
        delete require.cache[require.resolve('../heal_fallback_images')];
    }
});
