const axios = require('axios');
const http = require('http');
const https = require('https');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const RssParser = require('rss-parser');
const db = require('./db');
const path = require('path');
const fs = require('fs');
const { callGeminiApi, callGeminiBatch, generateAiImage } = require('./ai-service');
const { cleanupNews } = require('./cleaner');
const { optimizeImageInPlace } = require('./image-optimizer');
const jobQueue = require('./job-queue');
const rssService = require('./services/rss-service');

const rssParser = new RssParser({
    timeout: 15000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
});

// 全局 HTTP Agent 开启 Keep-Alive 复用 TCP 连接
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 20 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 20 });
axios.defaults.httpAgent = httpAgent;
axios.defaults.httpsAgent = httpsAgent;

// 单次任务内同时处理的资讯条目数，适度并发加速抓取
const CRAWL_CONCURRENCY = Number(process.env.CRAWL_CONCURRENCY || 5);
// 同一个爬取任务批次里相邻两次生图之间的额外间隔，进一步打散生图并发
const IMAGE_GEN_JITTER_MS = Number(process.env.IMAGE_GEN_JITTER_MS || 4000);
// 每次批量翻译的最大条数，过大易触发上下文超限或 429
const TRANSLATE_BATCH_SIZE = Number(process.env.TRANSLATE_BATCH_SIZE || 3);

/**
 * 静默压缩一张已落盘的图片。失败不影响主流程。
 */
async function compressQuietly(savePath) {
    try {
        const result = await optimizeImageInPlace(savePath);
        if (result.status === 'compressed') {
            console.log(`Image optimized: ${savePath} (${(result.before / 1024).toFixed(1)}KB -> ${(result.after / 1024).toFixed(1)}KB)`);
        } else if (result.status === 'deleted_corrupt') {
            console.log(`Corrupt image deleted: ${savePath}`);
        }
    } catch (optErr) {
        console.warn(`Image optimization failed for ${savePath}: ${optErr.message}`);
    }
}

const FALLBACK_IMAGES = [
    'ogimage.png',
    'banner1.png',
    'meta-img.png',
    'social-v3-deprecations.jpg'
];

function getFallbackImage(title) {
    let hash = 0;
    for (let i = 0; i < title.length; i++) {
        hash = title.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % FALLBACK_IMAGES.length;
    return `/images/${FALLBACK_IMAGES[index]}`;
}

function getImagesDir() {
    return process.env.IMAGES_DIR || path.join(__dirname, '../frontend/public/images');
}

async function downloadImage(url, dest, refererUrl, ignoreBypass = false) {
    if (!ignoreBypass && (url.includes('googleusercontent.com') || url.includes('google.com'))) {
        throw new Error('Google CDN urls bypassed to prevent timeout');
    }

    const response = await axios({
        method: 'GET',
        url,
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
        writer.on('finish', () => {
            // 写入完成后静默压缩（下载流程不阻塞在压缩上）
            compressQuietly(dest).catch(() => {});
            resolve();
        });
        writer.on('error', (err) => {
            fs.unlink(dest, () => {});
            reject(err);
        });
    });
}

async function generateAndSaveCoverImage(title, imageName) {
    const imagesDir = getImagesDir();
    if (!fs.existsSync(imagesDir)) {
        fs.mkdirSync(imagesDir, { recursive: true });
    }
    const savePath = path.join(imagesDir, imageName);
    const prompt = `An editorial graphic illustration for a news article with the title: "${title}". Modern technology style, clean digital art, high quality, conceptual design.`;

    console.log(`Generating cover image for "${title}"...`);
    // 由 ai-service 智能令牌桶 imageLimiter 自动精准控频控速率，避免多余死等
    const result = await generateAiImage(prompt, 'completions');

    if (result.type === 'url') {
        await downloadImage(result.data, savePath, '', true);
        // downloadImage 已会触发压缩，AI url 分支无需重复
    } else if (result.type === 'buffer') {
        await fs.promises.writeFile(savePath, result.data);
        await compressQuietly(savePath);
    } else {
        throw new Error('Unknown AI image output structure');
    }

    return `/images/${imageName}`;
}

const SOURCES = [
    // AI & Machine Learning
    { name: 'Google News AI', url: 'https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fnews.google.com%2Frss%2Fsearch%3Fq%3DAI%2Bwhen%3A1d%26hl%3Den-US%26gl%3DUS%26ceid%3DUS%3Aen' },
    // Top AI Sources (优先使用原生 directRss 极速无拦截抓取，避免第三方 API 429)
    { name: 'TechCrunch AI', directRss: true, url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
    { name: 'Ars Technica AI', directRss: true, url: 'https://feeds.arstechnica.com/arstechnica/index' },
    { name: 'Wired AI', directRss: true, url: 'https://www.wired.com/feed/tag/ai/latest/rss' },
    { name: 'The Verge AI', directRss: true, url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
    { name: 'Hugging Face Blog', directRss: true, url: 'https://huggingface.co/blog/feed.xml' },
    { name: 'OpenAI News', directRss: true, url: 'https://openai.com/news/rss.xml' },
    { name: 'MIT Technology Review', directRss: true, url: 'https://www.technologyreview.com/feed/' },
    { name: 'DeepMind Blog', url: 'https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fdeepmindsafety.substack.com%2Ffeed' },
    { name: 'ArXiv AI', url: 'https://api.rss2json.com/v1/api.json?rss_url=http%3A%2F%2Fexport.arxiv.org%2Frss%2Fcs.AI' },
];

async function scrapeAINewsListing() {
    console.log('Scraping AI News listing page...');
    const url = 'https://www.artificialintelligence-news.com/news/';
    try {
        const response = await axios.get(url, {
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
            }
        });
        const dom = new JSDOM(response.data);
        const links = Array.from(dom.window.document.querySelectorAll('a'));

        const articleUrls = new Set();
        links.forEach((a) => {
            const href = a.href;
            if (href.startsWith('https://www.artificialintelligence-news.com/news/') &&
                !href.includes('/tag/') &&
                !href.includes('/category/') &&
                !href.includes('/author/') &&
                !href.includes('/videos/') &&
                !href.includes('?')) {
                articleUrls.add(href);
            }
        });

        console.log(`Found ${articleUrls.size} possible AI News article links`);
        return Array.from(articleUrls).map((link) => ({
            link,
            title: 'AI News Article',
            pubDate: new Date().toISOString()
        }));
    } catch (error) {
        console.error('Failed to scrape AI News listing:', error.message);
        return [];
    }
}

async function fetchAndProcessNews() {
    console.log('Fetching AI news from multiple sources...');
    let allItems = [];

    // 动态拉取当前处于启用状态的 RSS 订阅源（防空与平滑兜底保护）
    let activeSources = [];
    try {
        activeSources = rssService.getActiveSources();
    } catch (e) {
        console.warn('[Crawler] 读取动态 RSS 订阅源失败，回退默认预设:', e.message);
        activeSources = db.DEFAULT_RSS_SOURCES || SOURCES;
    }

    if (activeSources.length === 0) {
        console.log('[Crawler] 当前无生效启用的 RSS 订阅源，跳过 RSS 并发抓取');
    }

    // RSS 源使用受控小型并发池，既提速，又不会冲撞站点
    const RSS_CONCURRENCY = Math.min(4, Math.max(1, activeSources.length || 1));
    const rssQueue = [...activeSources];

    async function rssWorker() {
        while (rssQueue.length > 0) {
            const source = rssQueue.shift();
            if (!source) break;
            console.log(`Fetching ${source.name}`);
            try {
                if (source.type === 'webpage') {
                    // 自适应 AI 普通网页抓取与提炼
                    const webpageItems = await rssService.crawlWebpageSource(source);
                    if (Array.isArray(webpageItems) && webpageItems.length > 0) {
                        allItems.push(...webpageItems);
                        console.log(`  [AI Webpage] 成功从「${source.name}」提炼 ${webpageItems.length} 篇资讯`);
                    }
                } else if (source.directRss) {
                    const feed = await rssParser.parseURL(source.url);
                    if (feed && feed.items) {
                        const items = feed.items.map((it) => ({
                            title: it.title,
                            link: it.link,
                            pubDate: it.isoDate || it.pubDate || new Date().toISOString(),
                            content: it.content || it.contentSnippet || '',
                        }));
                        allItems.push(...items);
                        console.log(`  Fetched ${items.length} items from ${source.name}`);
                    }
                } else {
                    const response = await axios.get(source.url, { timeout: 15000 });
                    if (response.data && response.data.items) {
                        allItems.push(...response.data.items);
                        console.log(`  Fetched ${response.data.items.length} items from ${source.name}`);
                    }
                }
            } catch (error) {
                console.error(`Failed to fetch ${source.name}:`, error.message);
            }
        }
    }

    await Promise.all(
        Array.from({ length: RSS_CONCURRENCY }, () => rssWorker())
    );

    const scrapedItems = await scrapeAINewsListing();
    allItems = allItems.concat(scrapedItems);

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const filteredItems = allItems.filter((item) => new Date(item.pubDate) >= oneDayAgo);

    console.log(`24h total items filtered: ${filteredItems.length}`);

    const checkUrlStmt = db.prepare('SELECT id FROM news WHERE originalUrl = ?');
    const checkTitleStmt = db.prepare('SELECT id FROM news WHERE title = ?');

    let newlyProcessed = 0;

    const queue = filteredItems.slice();
    let cursor = 0;
    const workerCount = Math.max(1, CRAWL_CONCURRENCY);

    // 阶段一：抓取详情页 + 解析（CPU/IO 密集），不限速
    // 阶段二：将翻译任务推入持久化队列，按 batch size 取出后通过 callGeminiBatch 批量翻译
    // 阶段三：翻译完成后再串行处理图片（生图最贵，单独限流）

    const preparedItems = []; // { item, realUrl, sourceText, imageUrl, imageName, jobId }
    const checkUrl = (link) => checkUrlStmt.get(link);

    async function prepareItem(item) {
        try {
            console.log(`Processing ${item.title}`);
            if (item.link && item.link.includes('news.google.com/rss/articles/')) {
                console.log(`  Skipping Google redirect link: ${item.title}`);
                return;
            }
            if (checkUrl(item.link)) {
                console.log(`  Existing source URL, skipped: ${item.link}`);
                return;
            }

            const initialRes = await axios.get(item.link, {
                timeout: 8000,
                maxRedirects: 5,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Upgrade-Insecure-Requests': '1'
                }
            });

            const realUrl = initialRes.request.res.responseUrl || item.link;
            console.log(`Resolved URL: ${realUrl}`);
            if (checkUrl(realUrl)) {
                console.log(`  Existing resolved URL, skipped: ${realUrl}`);
                return;
            }

            let sourceText = '';
            let imageUrl = '';
            let dom;
            try {
                dom = new JSDOM(initialRes.data, { url: realUrl });
                const reader = new Readability(dom.window.document);
                const article = reader.parse();
                sourceText = article ? article.textContent : item.title;

                const document = dom.window.document;
                imageUrl = document.querySelector('meta[property="og:image"]')?.content ||
                           document.querySelector('meta[name="og:image"]')?.content ||
                           document.querySelector('meta[property="twitter:image"]')?.content ||
                           document.querySelector('meta[name="twitter:image"]')?.content ||
                           document.querySelector('meta[name="thumbnail"]')?.content ||
                           document.querySelector('link[rel="image_src"]')?.href;
            } finally {
                if (dom) dom.window.close();
            }

            if (imageUrl) {
                try {
                    imageUrl = new URL(imageUrl, realUrl).href;
                } catch (e) {
                    imageUrl = '';
                }
            }
            const GENERIC_IMAGE_PATTERNS = [
                /arxiv\.org\/static\//i,
                /arxiv-logo/i,
                /logo\.(png|jpg|svg|webp)/i,
                /\/favicon\./i,
                /default[-_]image/i,
                /placeholder/i,
            ];
            if (imageUrl && GENERIC_IMAGE_PATTERNS.some(p => p.test(imageUrl))) {
                imageUrl = '';
            }

            const imageName = Date.now() + '_' + Math.random().toString(36).substring(2, 11) + '.jpg';

            const prompt = `
你是一位专业的科技新闻翻译与分析专家。请将以下英文科技新闻进行中文全文翻译（要求全文逐段翻译，严禁摘要缩写，严禁删减内容）。
要求：
1. content 必须是整篇报道的完整全文逐段翻译，忠实原文，严禁擅自删减段落、技术细节、当事人发言或简化为概括通稿。
2. 保持标准 Markdown 格式分段（段落间使用 \\n\\n 分隔，副标题以 ## 标注）。
3. title 为准确客观且有吸引力的中文标题。
4. summary 为 100~150 字精炼导读摘要（提炼核心事实，用于信息流卡片展示，与正文区分开）。
5. 语言专业严谨、通顺流畅。

Content:
${sourceText.slice(0, 25000)}

仅输出 JSON 格式：{"title": "...", "summary": "...", "content": "..."}
            `;

            const jobId = jobQueue.enqueue('translate', {
                realUrl,
                sourceText,
                imageUrl,
                imageName,
                prompt,
            });

            preparedItems.push({ jobId, realUrl, imageUrl, imageName });
        } catch (error) {
            console.error(`Failed to prepare ${item.link}:`, error.message);
        }
    }

    // 准备阶段：worker 并发抓取页面（IO 密集，不触发 AI）
    async function prepareWorker() {
        while (newlyProcessed < 30) {
            const current = cursor;
            cursor += 1;
            if (current >= queue.length) return;
            await prepareItem(queue[current]);
        }
    }
    await Promise.all(
        Array.from({ length: workerCount }, () => prepareWorker())
    );

    console.log(`[阶段二] 入队 ${preparedItems.length} 条翻译任务，开始批量翻译...`);

    // 阶段二：批量翻译
    const translated = new Map(); // jobId -> { title, content }
    for (let i = 0; i < preparedItems.length; i += TRANSLATE_BATCH_SIZE) {
        if (newlyProcessed >= 30) break;
        const batchIds = preparedItems.slice(i, i + TRANSLATE_BATCH_SIZE).map(p => p.jobId);
        const batchJobs = batchIds.map((id) => {
            const p = preparedItems.find((it) => it.jobId === id);
            return { id, payload: { sourceText: '', prompt: '', realUrl: p.realUrl, imageUrl: p.imageUrl, imageName: p.imageName } };
        });

        // 从 job_queue 读回 payload
        const stmtGet = db.prepare('SELECT * FROM job_queue WHERE id = ?');
        batchJobs.forEach((b) => {
            const row = stmtGet.get(b.id);
            if (row) b.payload = JSON.parse(row.payload);
        });

        // 标记为 PROCESSING
        batchJobs.forEach((b) => jobQueue.markProcessing(b.id));

        const items = batchJobs.map((b) => ({ sourceText: b.payload.sourceText, prompt: b.payload.prompt }));

        try {
            const results = await callGeminiBatch(items);
            batchJobs.forEach((b, idx) => {
                const r = results[idx];
                if (r && r.title && r.content) {
                    translated.set(b.id, r);
                    jobQueue.markDone(b.id);
                } else {
                    jobQueue.markFailed(b.id, new Error('Batch returned empty result for this item'));
                }
            });
        } catch (e) {
            console.error(`[批量翻译] 批次失败: ${e.message}`);
            // 整批失败时把任务设回 COOLING，留给下次轮询重试
            const retryAt = Date.now() + 60_000;
            batchJobs.forEach((b) => jobQueue.markCooling(b.id, retryAt, e));
        }
    }

    console.log(`[阶段三] 翻译完成 ${translated.size}/${preparedItems.length}，开始处理图片与入库...`);

    // 阶段三：处理图片 + 落库
    for (const prepared of preparedItems) {
        if (newlyProcessed >= 30) break;
        const rewritten = translated.get(prepared.jobId);
        if (!rewritten) continue;

        const duplicateTitle = checkTitleStmt.get(rewritten.title);
        if (duplicateTitle) {
            console.log(`  Existing rewritten title, skipped: ${rewritten.title}`);
            continue;
        }

        let localImagePath = '';
        if (prepared.imageUrl) {
            try {
                console.log(`Found image URL: ${prepared.imageUrl}`);
                const imagesDir = getImagesDir();
                if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
                const savePath = path.join(imagesDir, prepared.imageName);
                await downloadImage(prepared.imageUrl, savePath, prepared.realUrl);
                localImagePath = `/images/${prepared.imageName}`;
                console.log(`Image downloaded: ${localImagePath}`);
            } catch (imgError) {
                console.error('Image download failed:', imgError.message);
                try {
                    localImagePath = await generateAndSaveCoverImage(rewritten.title, prepared.imageName);
                    console.log(`AI image generated: ${localImagePath}`);
                } catch (genError) {
                    console.error('AI image generation failed, using fallback:', genError.message);
                    localImagePath = getFallbackImage(rewritten.title);
                }
            }
        } else {
            console.log('No usable image found in page');
            try {
                localImagePath = await generateAndSaveCoverImage(rewritten.title, prepared.imageName);
                console.log(`AI image generated: ${localImagePath}`);
            } catch (genError) {
                console.error('AI image generation failed, using fallback:', genError.message);
                localImagePath = getFallbackImage(rewritten.title);
            }
        }

        const summaryText = (rewritten.summary || rewritten.content.substring(0, 200) + '...').trim();
        const stmt = db.prepare('INSERT INTO news (title, summary, content, imageUrl, originalUrl) VALUES (?, ?, ?, ?, ?)');
        stmt.run(rewritten.title, summaryText, rewritten.content, localImagePath, prepared.realUrl);
        console.log(`Saved: ${rewritten.title}`);
        newlyProcessed++;
    }

    // 爬取任务完成后，触发新闻清理逻辑（转译失败清理、去重、控制上线在 1500 条以内）
    try {
        cleanupNews();
    } catch (cleanErr) {
        console.error('执行新闻清理逻辑时发生异常:', cleanErr.message);
    }
}

module.exports = fetchAndProcessNews;
