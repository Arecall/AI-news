const Database = require('better-sqlite3');
const axios = require('axios');
const { JSDOM } = require('jsdom');
const path = require('path');
const fs = require('fs');
const { generateAiImage } = require('./ai-service');

const db = new Database(path.join(__dirname, 'news.db'));

const FALLBACK_IMAGES = [
    '/images/ogimage.png',
    '/images/banner1.png',
    '/images/meta-img.png',
    '/images/social-v3-deprecations.jpg'
];

/**
 * 辅助方法：使用 axios 自定义下载图片以支持超时与 User-Agent
 * @param {string} url 图片的 URL
 * @param {string} dest 保存到本地的绝对路径
 * @param {string} refererUrl 请求来源 Referer
 * @param {boolean} ignoreBypass 是否忽略 Google 域名的 Bypass 逻辑
 */
async function downloadImage(url, dest, refererUrl, ignoreBypass = false) {
    if (!ignoreBypass && (url.includes('googleusercontent.com') || url.includes('google.com'))) {
        throw new Error('Google CDN urls bypassed to prevent timeout');
    }

    const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        timeout: 10000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            'Referer': refererUrl || '',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9'
        }
    });

    const contentType = response.headers['content-type'] || '';
    if (!contentType.startsWith('image/')) {
        throw new Error(`Invalid content-type: ${contentType}`);
    }

    return new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(dest);
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', (err) => {
            fs.unlink(dest, () => {});
            reject(err);
        });
    });
}

/**
 * 资讯配图治愈与修复逻辑
 * @param {object} customDb 可选，外部测试传入的数据库实例
 */
async function heal(customDb) {
    console.log("Starting healing process for news articles with fallback images...");

    const activeDb = customDb || db;
    const stmt = activeDb.prepare('SELECT id, title, imageUrl, originalUrl FROM news');
    const articles = stmt.all();

    const fallbacks = articles.filter(a => {
        return FALLBACK_IMAGES.some(f => a.imageUrl && a.imageUrl.includes(f));
    });

    console.log(`Found ${fallbacks.length} articles with fallback images out of ${articles.length} total articles.`);

    const updateStmt = activeDb.prepare('UPDATE news SET imageUrl = ? WHERE id = ?');

    for (const article of fallbacks) {
        console.log(`Processing article: "${article.title}"`);
        console.log(`  Current Image: ${article.imageUrl}`);
        console.log(`  Original URL: ${article.originalUrl}`);

        let healed = false;

        // 步骤 1：尝试去原网页面抓取并下载原图
        try {
            const res = await axios.get(article.originalUrl, {
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Upgrade-Insecure-Requests': '1'
                }
            });

            const dom = new JSDOM(res.data, { url: article.originalUrl });
            const document = dom.window.document;

            let imageUrl = document.querySelector('meta[property="og:image"]')?.content ||
                           document.querySelector('meta[name="og:image"]')?.content ||
                           document.querySelector('meta[property="twitter:image"]')?.content ||
                           document.querySelector('meta[name="twitter:image"]')?.content ||
                           document.querySelector('meta[name="thumbnail"]')?.content ||
                           document.querySelector('link[rel="image_src"]')?.href;

            if (imageUrl) {
                try {
                    imageUrl = new URL(imageUrl, article.originalUrl).href;
                } catch (e) {
                    imageUrl = '';
                }
            }

            if (imageUrl) {
                console.log(`  Found cover image URL: ${imageUrl}`);
                const imagesDir = path.join(__dirname, '../frontend/public/images');
                if (!fs.existsSync(imagesDir)){ fs.mkdirSync(imagesDir, { recursive: true }); }
                const imageName = Date.now() + '_' + Math.random().toString(36).substring(2, 11) + '.jpg';
                const savePath = path.join(imagesDir, imageName);

                // 下载时不忽略 Google 域名的 Bypass 规则 (因为原网页可能因网络无法下载该 CDN 图片)
                await downloadImage(imageUrl, savePath, article.originalUrl, false);
                const localPath = `/images/${imageName}`;

                updateStmt.run(localPath, article.id);
                console.log(`  Successfully healed via original image! Saved to: ${localPath}`);
                healed = true;
            } else {
                console.log(`  No cover image metadata found in HTML.`);
            }
        } catch (err) {
            console.warn(`  Attempt to retrieve original cover image failed: ${err.message}`);
        }

        // 步骤 2：若原图抓取失败或找不到封面图，则降级为 AI 重新生成配图
        if (!healed) {
            console.log(`  Original image retrieval/download failed. Generating AI image instead...`);
            try {
                const imagesDir = path.join(__dirname, '../frontend/public/images');
                if (!fs.existsSync(imagesDir)){ fs.mkdirSync(imagesDir, { recursive: true }); }
                const imageName = Date.now() + '_' + Math.random().toString(36).substring(2, 11) + '.jpg';
                const savePath = path.join(imagesDir, imageName);

                // 拼接配置标题的英文 Prompts，生成现代科技风插图
                const prompt = `An editorial graphic illustration for a news article with the title: "${article.title}". Modern technology style, clean digital art, high quality, conceptual design.`;

                console.log(`  Generating AI image using gemini-3.1-flash-image with prompt: "${prompt}"`);
                const result = await generateAiImage(prompt, 'completions');

                if (result.type === 'url') {
                    // AI 生成的图片链接允许忽略 Google Bypass 限制并进行下载
                    await downloadImage(result.data, savePath, '', true);
                } else if (result.type === 'buffer') {
                    await fs.promises.writeFile(savePath, result.data);
                } else {
                    throw new Error('Unknown AI image output structure');
                }

                const localPath = `/images/${imageName}`;
                updateStmt.run(localPath, article.id);
                console.log(`  Successfully healed via AI! Saved to: ${localPath}`);
                healed = true;
            } catch (aiErr) {
                console.error(`  Failed to generate/save AI image for article ${article.id}: ${aiErr.message}`);
            }
        }
    }

    console.log("Healing process completed.");
    if (!customDb) {
        db.close();
    }
}

if (require.main === module) {
    heal().catch(console.error);
}

module.exports = { heal, downloadImage };
