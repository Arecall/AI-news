const db = require('../db');
const axios = require('axios');
const RssParser = require('rss-parser');
const { JSDOM } = require('jsdom');
const { callGeminiApi } = require('../ai-service');

const rssParser = new RssParser({
    timeout: 15000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
    }
});

const HTTP_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7'
};

class RssService {
    /**
     * 获取所有订阅数据源（支持 RSS 与 Webpage）
     */
    getAllSources() {
        return db.prepare(`
            SELECT id, name, url, type, direct_rss as directRss, enabled, category, created_at as createdAt
            FROM rss_sources
            ORDER BY id ASC
        `).all().map(s => ({
            ...s,
            type: s.type || 'rss'
        }));
    }

    /**
     * 获取当前处于开启状态的订阅源（供爬虫引擎使用）
     */
    getActiveSources() {
        return db.prepare(`
            SELECT id, name, url, type, direct_rss as directRss, category
            FROM rss_sources
            WHERE enabled = 1
            ORDER BY id ASC
        `).all().map(s => ({
            ...s,
            type: s.type || 'rss'
        }));
    }

    /**
     * 校验 URL 安全性（防 SSRF）
     */
    validateUrl(url) {
        if (!url || typeof url !== 'string') {
            throw new Error('URL 地址不能为空');
        }
        const trimmed = url.trim();
        let parsed;
        try {
            parsed = new URL(trimmed);
        } catch {
            throw new Error('无效的 URL 格式，请输入完整的 http:// 或 https:// 地址');
        }

        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error('仅支持 HTTP 或 HTTPS 协议的网页或 Feed 链接');
        }

        const hostname = parsed.hostname.toLowerCase();
        if (
            hostname === 'localhost' ||
            hostname === '127.0.0.1' ||
            hostname === '::1' ||
            hostname.startsWith('10.') ||
            hostname.startsWith('192.168.') ||
            /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
        ) {
            throw new Error('禁止订阅私有内网或本地回环地址');
        }

        return trimmed;
    }

    /**
     * 新增自定义订阅源（自动或手动指定 type）
     */
    addSource({ name, url, type = 'rss', directRss = 1, category = '自定义订阅' }) {
        if (!name || typeof name !== 'string' || !name.trim()) {
            throw new Error('订阅源名称不能为空');
        }
        const cleanName = name.trim();
        const cleanUrl = this.validateUrl(url);

        const existing = db.prepare('SELECT id FROM rss_sources WHERE url = ?').get(cleanUrl);
        if (existing) {
            throw new Error(`该地址已存在于订阅源列表中 (ID: ${existing.id})`);
        }

        const sourceType = type === 'webpage' ? 'webpage' : 'rss';

        const stmt = db.prepare(`
            INSERT INTO rss_sources (name, url, type, direct_rss, enabled, category)
            VALUES (?, ?, ?, ?, 1, ?)
        `);
        const result = stmt.run(cleanName, cleanUrl, sourceType, directRss ? 1 : 0, category.trim() || '自定义订阅');

        return this.getSourceById(result.lastInsertRowid);
    }

    /**
     * 根据 ID 获取单个源
     */
    getSourceById(id) {
        const row = db.prepare(`
            SELECT id, name, url, type, direct_rss as directRss, enabled, category, created_at as createdAt
            FROM rss_sources
            WHERE id = ?
        `).get(id);
        if (!row) return undefined;
        return {
            ...row,
            type: row.type || 'rss'
        };
    }

    /**
     * 更新指定订阅源
     */
    updateSource(id, { name, url, type, directRss, enabled, category }) {
        const current = this.getSourceById(id);
        if (!current) {
            throw new Error(`未找到 ID 为 ${id} 的订阅源`);
        }

        const newName = name !== undefined ? name.trim() : current.name;
        let newUrl = current.url;
        if (url !== undefined && url.trim() !== current.url) {
            newUrl = this.validateUrl(url);
            const duplicate = db.prepare('SELECT id FROM rss_sources WHERE url = ? AND id != ?').get(newUrl, id);
            if (duplicate) {
                throw new Error(`更新失败：该地址已在其他订阅源中存在 (ID: ${duplicate.id})`);
            }
        }

        const newType = type !== undefined ? (type === 'webpage' ? 'webpage' : 'rss') : current.type;
        const newDirect = directRss !== undefined ? (directRss ? 1 : 0) : current.directRss;
        const newEnabled = enabled !== undefined ? (enabled ? 1 : 0) : current.enabled;
        const newCategory = category !== undefined ? category.trim() : current.category;

        db.prepare(`
            UPDATE rss_sources
            SET name = ?, url = ?, type = ?, direct_rss = ?, enabled = ?, category = ?
            WHERE id = ?
        `).run(newName, newUrl, newType, newDirect, newEnabled, newCategory, id);

        return this.getSourceById(id);
    }

    /**
     * 删除指定订阅源
     */
    deleteSource(id) {
        const source = this.getSourceById(id);
        if (!source) {
            throw new Error(`未找到 ID 为 ${id} 的订阅源`);
        }
        db.prepare('DELETE FROM rss_sources WHERE id = ?').run(id);
        return { success: true, deleted: source };
    }

    /**
     * 基于 JSDOM + Gemini Flash 的自适应普通网页文章列表提炼引擎
     */
    async extractWebpageArticles(html, baseUrl) {
        const dom = new JSDOM(html);
        const doc = dom.window.document;

        // 移除无关噪音标签
        ['script', 'style', 'svg', 'noscript', 'iframe', 'header', 'footer', 'nav'].forEach(tag => {
            doc.querySelectorAll(tag).forEach(el => el.remove());
        });

        const webTitle = (doc.title || '').replace(/\s+/g, ' ').trim() || '未知网页';

        // 收集所有带 href 的 <a> 标签与其可见文本
        const anchors = Array.from(doc.querySelectorAll('a[href]'));
        const candidateLinks = [];
        const seenHrefs = new Set();

        for (const a of anchors) {
            const rawHref = a.getAttribute('href');
            if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) continue;

            const text = (a.textContent || '').replace(/\s+/g, ' ').trim();
            // 过滤极短文本（如菜单/点赞等）
            if (text.length < 5) continue;

            let absUrl;
            try {
                absUrl = new URL(rawHref, baseUrl).href;
            } catch {
                continue;
            }

            if (seenHrefs.has(absUrl)) continue;
            seenHrefs.add(absUrl);

            candidateLinks.push({ title: text, link: absUrl });
            if (candidateLinks.length >= 35) break;
        }

        if (candidateLinks.length === 0) {
            throw new Error('未能在该网页中识别出足够的资讯文章链接');
        }

        // 组装精简链接列表传给 Gemini Flash 进行列表过滤与提炼
        const snippets = candidateLinks.map((item, idx) => `[${idx + 1}] 标题: ${item.title}\n链接: ${item.link}`).join('\n\n');

        const prompt = `
你是一位顶级网络数据抽取专家。以下是从网页《${webTitle}》(${baseUrl})提取出的候选链接列表：

${snippets}

【任务要求】：
请从中甄别出真实属于该网站的“最新科技/AI/产业新闻资讯文章”条目（排除关于我们、商务合作、用户协议、翻页按钮、分类导航等无效页面）。
提取最多 12 条最新文章。

仅输出纯 JSON 数组（严禁包含任何 Markdown 格式或额外说明）：
[
  {
    "title": "清晰规范的文章标题",
    "link": "对应的完整文章网址",
    "pubDate": "发现时间（如 2026-09-29）"
  }
]
`;

        try {
            const rawResp = await callGeminiApi(prompt);
            let parsed = null;
            if (Array.isArray(rawResp)) {
                parsed = rawResp;
            } else if (typeof rawResp === 'string') {
                const cleaned = rawResp.replace(/```json/g, '').replace(/```/g, '').trim();
                parsed = JSON.parse(cleaned);
            }

            if (!Array.isArray(parsed) || parsed.length === 0) {
                // 如果 AI 返回空，回退使用前 6 条候选链接兜底
                return candidateLinks.slice(0, 6).map(it => ({
                    title: it.title,
                    link: it.link,
                    pubDate: new Date().toISOString()
                }));
            }

            // 规范化输出
            return parsed.filter(item => item && item.title && item.link).map(item => ({
                title: String(item.title).trim(),
                link: String(item.link).trim(),
                pubDate: item.pubDate || new Date().toISOString()
            }));
        } catch (e) {
            console.warn('[RssService] AI 网页提炼解析降级兜底:', e.message);
            return candidateLinks.slice(0, 6).map(it => ({
                title: it.title,
                link: it.link,
                pubDate: new Date().toISOString()
            }));
        }
    }

    /**
     * 智能多态探测与嗅探器 (Auto-Sniffing Probe)
     * 支持原生 RSS XML、Proxy API、网页内嵌 RSS 发现、以及自适应 AI 网页列表提炼
     */
    async testFeed(url, directRss = true) {
        const cleanUrl = this.validateUrl(url);
        const startTime = Date.now();

        // 阶段 1：先尝试原生 RSS / Atom XML 解析
        try {
            if (directRss) {
                const feed = await rssParser.parseURL(cleanUrl);
                const durationMs = Date.now() - startTime;
                const items = (feed.items || []).slice(0, 3).map((it) => ({
                    title: it.title || '无标题',
                    pubDate: it.isoDate || it.pubDate || null,
                    link: it.link || null
                }));

                return {
                    success: true,
                    type: 'rss',
                    feedType: 'direct_rss',
                    title: feed.title || '标准 RSS 源',
                    description: feed.description || '',
                    itemCount: feed.items ? feed.items.length : 0,
                    sampleItems: items,
                    durationMs
                };
            }
        } catch (e) {
            // directRss 失败时平滑放行至后续阶段
        }

        // 阶段 2：请求该 URL 的完整响应内容，智能判断是 JSON 代理、网页内嵌 RSS 还是普通网页 HTML
        try {
            const res = await axios.get(cleanUrl, {
                timeout: 15000,
                headers: HTTP_HEADERS
            });
            const durationMs = Date.now() - startTime;

            // 检查是否为 api.rss2json.com 等 JSON 代理
            if (res.data && typeof res.data === 'object' && Array.isArray(res.data.items)) {
                const sampleItems = res.data.items.slice(0, 3).map((it) => ({
                    title: it.title || '无标题',
                    pubDate: it.pubDate || null,
                    link: it.link || null
                }));

                return {
                    success: true,
                    type: 'rss',
                    feedType: 'proxy_api',
                    title: res.data.feed?.title || '代理中转源',
                    description: res.data.feed?.description || '',
                    itemCount: res.data.items.length,
                    sampleItems,
                    durationMs
                };
            }

            // 若响应为 HTML 网页文本
            if (typeof res.data === 'string' && res.data.includes('<html')) {
                const dom = new JSDOM(res.data);
                const doc = dom.window.document;
                const webTitle = (doc.title || '').replace(/\s+/g, ' ').trim() || '自定义网页';

                // 嗅探 1：检查 HTML <head> 是否声明了内嵌官方 RSS 链接
                const rssLinkTag = doc.querySelector('link[type="application/rss+xml"], link[type="application/atom+xml"]');
                if (rssLinkTag && rssLinkTag.getAttribute('href')) {
                    try {
                        const embeddedHref = rssLinkTag.getAttribute('href');
                        const embeddedUrl = new URL(embeddedHref, cleanUrl).href;
                        console.log(`[RssService] 在网页中智能嗅探到内嵌官方 RSS 地址: ${embeddedUrl}`);

                        const feed = await rssParser.parseURL(embeddedUrl);
                        const items = (feed.items || []).slice(0, 3).map((it) => ({
                            title: it.title || '无标题',
                            pubDate: it.isoDate || it.pubDate || null,
                            link: it.link || null
                        }));

                        return {
                            success: true,
                            type: 'rss',
                            feedType: 'embedded_rss',
                            title: feed.title || webTitle,
                            suggestedUrl: embeddedUrl,
                            message: `💡 智能嗅探到该网页内嵌官方 RSS 源，建议直接订阅: ${embeddedUrl}`,
                            itemCount: feed.items ? feed.items.length : 0,
                            sampleItems: items,
                            durationMs: Date.now() - startTime
                        };
                    } catch (e) {
                        // 内嵌 RSS 解析失败，继续降级到 AI 网页提炼
                    }
                }

                // 嗅探 2：普通无 RSS 网页，启动自适应 AI 网页列表提炼
                console.log(`[RssService] 启动 AI 智能网页列表提炼: ${cleanUrl}`);
                const articles = await this.extractWebpageArticles(res.data, cleanUrl);

                return {
                    success: true,
                    type: 'webpage',
                    feedType: 'ai_webpage',
                    title: webTitle,
                    message: `✦ 成功识别为普通网页！AI 自适应提炼到 ${articles.length} 篇最新资讯`,
                    itemCount: articles.length,
                    sampleItems: articles.slice(0, 3),
                    durationMs: Date.now() - startTime
                };
            }

            throw new Error('返回内容既非标准 XML/Atom，也非有效的 HTML 网页文档');
        } catch (err) {
            const durationMs = Date.now() - startTime;
            throw new Error(`探测失败 (${durationMs}ms): ${err.message || '网络超时或内容无法解析'}`);
        }
    }

    /**
     * 爬虫调用：抓取普通网页类型的订阅源
     */
    async crawlWebpageSource(source) {
        console.log(`[Crawler] 正在通过 AI 网页自适应引擎抓取「${source.name}」: ${source.url}`);
        const res = await axios.get(source.url, {
            timeout: 20000,
            headers: HTTP_HEADERS
        });
        if (typeof res.data !== 'string') {
            return [];
        }
        return this.extractWebpageArticles(res.data, source.url);
    }

    /**
     * 一键重置恢复 10 个官方默认推荐预设源
     */
    resetToDefaultSources() {
        db.seedDefaultRssSources(true);
        return this.getAllSources();
    }
}

module.exports = new RssService();
