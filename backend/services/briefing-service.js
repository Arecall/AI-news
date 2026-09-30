const db = require('../db');
const { callGeminiApi } = require('../ai-service');

class BriefingService {
    constructor() {
        this.isGenerating = false;
    }

    formatSqliteDate(dateObj) {
        const d = new Date(dateObj);
        const pad = (n) => String(n).padStart(2, '0');
        const yyyy = d.getUTCFullYear();
        const mm = pad(d.getUTCMonth() + 1);
        const dd = pad(d.getUTCDate());
        const hh = pad(d.getUTCHours());
        const min = pad(d.getUTCMinutes());
        const ss = pad(d.getUTCSeconds());
        return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
    }

    getLocalDateString(dateObj = new Date()) {
        const d = new Date(dateObj);
        return new Intl.DateTimeFormat('zh-CN', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(d).replace(/\//g, '-');
    }

    /**
     * 获取当前北京时间的小时数 (0 ~ 23)
     */
    getBeijingHour(dateObj = new Date()) {
        const d = new Date(dateObj);
        const parts = new Intl.DateTimeFormat('zh-CN', {
            timeZone: 'Asia/Shanghai',
            hour: 'numeric',
            hour12: false,
            hourCycle: 'h23'
        }).formatToParts(d);
        const hourPart = parts.find(p => p.type === 'hour');
        return hourPart ? parseInt(hourPart.value, 10) : ((d.getUTCHours() + 8) % 24);
    }

    /**
     * 计算早报/晚报的水位线时间窗口
     */
    calculateTimeWindow(type, now = new Date()) {
        const todayStr = this.getLocalDateString(now);
        const nowSqlite = this.formatSqliteDate(now);
        let startSqlite = null;

        if (type === 'morning') {
            // 早报：优先寻找前一次晚报的结束时刻
            const prevEvening = db.prepare(`
                SELECT time_range_end FROM briefings
                WHERE type = 'evening' AND created_at < ?
                ORDER BY created_at DESC LIMIT 1
            `).get(nowSqlite);

            if (prevEvening && prevEvening.time_range_end) {
                startSqlite = prevEvening.time_range_end;
            } else {
                // 无历史晚报，默认回溯 14 小时（昨日 18:00 ~ 今日 08:00 左右）
                startSqlite = this.formatSqliteDate(new Date(now.getTime() - 14 * 60 * 60 * 1000));
            }
        } else {
            // 晚报：优先寻找今日早报的结束时刻
            const todayMorning = db.prepare(`
                SELECT time_range_end FROM briefings
                WHERE type = 'morning' AND (date = ? OR created_at < ?)
                ORDER BY created_at DESC LIMIT 1
            `).get(todayStr, nowSqlite);

            if (todayMorning && todayMorning.time_range_end) {
                startSqlite = todayMorning.time_range_end;
            } else {
                // 无早报记录，默认回溯 12 小时
                startSqlite = this.formatSqliteDate(new Date(now.getTime() - 12 * 60 * 60 * 1000));
            }
        }

        return {
            dateStr: todayStr,
            startTime: startSqlite,
            endTime: nowSqlite
        };
    }

    /**
     * 获取窗口内的新闻资讯
     */
    fetchNewsForBriefing(startTime, endTime) {
        let newsList = db.prepare(`
            SELECT id, title, summary, createdAt
            FROM news
            WHERE createdAt >= ? AND createdAt <= ?
            ORDER BY createdAt DESC
            LIMIT 30
        `).all(startTime, endTime);

        // 防饥饿容错：若窗口内少于 3 条（如非活跃时段），自动回溯延伸至近 24 小时
        let actualStartTime = startTime;
        if (newsList.length < 3) {
            console.log(`[BriefingService] 窗口内新闻数较少 (${newsList.length} 条)，自动拓展至 24 小时回溯...`);
            const fallbackStart = this.formatSqliteDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
            newsList = db.prepare(`
                SELECT id, title, summary, createdAt
                FROM news
                WHERE createdAt >= ?
                ORDER BY createdAt DESC
                LIMIT 30
            `).all(fallbackStart);
            actualStartTime = fallbackStart;
        }

        return {
            newsList,
            startTime: actualStartTime
        };
    }

    /**
     * 生成早报或晚报
     */
    async generateBriefing(type = 'morning', forceOverwrite = false) {
        if (this.isGenerating) {
            const err = new Error('BRIEFING_BUSY: 当前已有早晚报生成任务正在进行中');
            err.code = 'BRIEFING_BUSY';
            throw err;
        }

        this.isGenerating = true;
        const now = new Date();
        const typeLabel = type === 'morning' ? '早报' : '晚报';
        console.log(`[BriefingService] 开始生成 AI ${typeLabel}...`);

        try {
            const window = this.calculateTimeWindow(type, now);
            const { newsList, startTime } = this.fetchNewsForBriefing(window.startTime, window.endTime);

            if (newsList.length === 0) {
                throw new Error('当前时间窗口内没有可供总结的新闻数据');
            }

            const title = `${window.dateStr} · 全球 AI 科技${typeLabel}`;
            const articleIds = newsList.map(n => n.id);

            // 构造精简提炼文本传递给 AI
            const newsSnippets = newsList.slice(0, 20).map((n, idx) => {
                const cleanSummary = (n.summary || '').replace(/\s+/g, ' ').slice(0, 150);
                return `[ID: ${n.id}] 标题: ${n.title}\n导读: ${cleanSummary}`;
            }).join('\n\n');

            const prompt = `
你是一位顶级科技新闻总编辑与前沿 AI 产业观察家。请基于以下最近收录的 ${newsList.length} 条新闻资讯，精选并提炼撰写一份高信息密度、极具专业洞察力的《${title}》。

Content:
${newsSnippets}

【撰写要求】：
1. summary：用 80~120 字撰写今日宏观脉搏（提炼本时段全球 AI 界最核心的技术突破、巨头博弈或重大行业风向）。
2. sections：将新闻提炼归类为 3~4 个主题板块（如：大模型与架构前沿、商业巨头与算力、Agent 与产业落地、政策安全与投融资）。
3. 每个板块包含 2~4 条要闻 items，每条 item 结构必须包含：
   - id: 对应的原新闻 ID（必须严格使用输入中的真实数字 ID，以便用户点击溯源）
   - headline: 提炼的核心标题（客观精炼，杜绝标题党，20字以内）
   - facts: 核心事实要点（1 句话讲清谁发布了什么或发生了什么事实）
   - analysis: 深度影响或商业意义（1 句话点出其技术价值或行业风向）

仅输出 JSON 格式（严禁包含任何前缀、解释或 Markdown 代码块标记）：
{
  "summary": "...",
  "sections": [
    {
      "category": "大模型与架构前沿",
      "items": [
        {
          "id": 1,
          "headline": "...",
          "facts": "...",
          "analysis": "..."
        }
      ]
    }
  ]
}
`;

            const rawResponse = await callGeminiApi(prompt);
            let parsed = null;

            if (typeof rawResponse === 'object' && rawResponse !== null) {
                parsed = rawResponse;
            } else if (typeof rawResponse === 'string') {
                const cleaned = rawResponse.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```json/g, '').replace(/```/g, '').trim();
                try {
                    parsed = JSON.parse(cleaned);
                } catch {
                    const match = cleaned.match(/\{[\s\S]*\}/);
                    if (match) {
                        parsed = JSON.parse(match[0]);
                    }
                }
            }

            // 多层级自适应递归解包（防止大模型在最外层包裹 briefing / data / result 键）
            if (parsed && typeof parsed === 'object') {
                if (!parsed.sections) {
                    parsed = parsed.briefing || parsed.data || parsed.result || parsed;
                }
            }

            if (!parsed || !parsed.sections || !Array.isArray(parsed.sections)) {
                console.error('[BriefingService] 非法数据结构 dump:', JSON.stringify(rawResponse).slice(0, 300));
                throw new Error('AI 返回的数据结构不符合早晚报格式规范');
            }

            // 保存到 briefings 表
            const stmt = db.prepare(`
                INSERT INTO briefings (
                    type, date, title, summary, content,
                    article_count, article_ids, time_range_start, time_range_end
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const insertResult = stmt.run(
                type,
                window.dateStr,
                title,
                parsed.summary || `${title}已生成`,
                JSON.stringify(parsed),
                newsList.length,
                JSON.stringify(articleIds),
                startTime,
                window.endTime
            );

            console.log(`[BriefingService] AI ${typeLabel}已成功落库，ID: ${insertResult.lastInsertRowid}`);
            return this.getBriefingById(insertResult.lastInsertRowid);
        } finally {
            this.isGenerating = false;
        }
    }

    /**
     * 获取最新一份早报或晚报
     */
    getLatestBriefing() {
        const row = db.prepare(`
            SELECT * FROM briefings
            ORDER BY created_at DESC LIMIT 1
        `).get();
        return this.formatBriefingRow(row);
    }

    /**
     * 获取早晚报成对数据及前台布局配置
     */
    getTodayBriefingPair() {
        const todayStr = this.getLocalDateString();
        // 优先获取今日早报，若无则回退取最近一期早报
        let morning = db.prepare("SELECT * FROM briefings WHERE type = 'morning' AND date = ? ORDER BY created_at DESC LIMIT 1").get(todayStr);
        if (!morning) {
            morning = db.prepare("SELECT * FROM briefings WHERE type = 'morning' ORDER BY created_at DESC LIMIT 1").get();
        }

        // 方案 1：时钟感知智能时序流转
        // 晚报获取规则：
        // - 若当前北京时间 < 20:00 (白天)：今日晚报尚未到出刊时间，优先取昨夜/前一日焦点晚报 (date < todayStr)
        // - 若当前北京时间 >= 20:00 (夜间)：今日晚报已正式出刊，优先取今日晚报 (date = todayStr)
        const beijingHour = this.getBeijingHour();
        let evening = null;
        if (beijingHour >= 20) {
            // 夜间：优先取今日晚报
            evening = db.prepare("SELECT * FROM briefings WHERE type = 'evening' AND date = ? ORDER BY created_at DESC LIMIT 1").get(todayStr);
            if (!evening) {
                // 若今晚尚未生成，回退取最近一期晚报
                evening = db.prepare("SELECT * FROM briefings WHERE type = 'evening' ORDER BY created_at DESC LIMIT 1").get();
            }
        } else {
            // 白天：今日晚报未到出刊时间，取昨夜晚报 (date < todayStr)
            evening = db.prepare("SELECT * FROM briefings WHERE type = 'evening' AND date < ? ORDER BY created_at DESC LIMIT 1").get(todayStr);
            if (!evening) {
                // 兜底：若历史上无早前日期的晚报，则取最近一期晚报
                evening = db.prepare("SELECT * FROM briefings WHERE type = 'evening' ORDER BY created_at DESC LIMIT 1").get();
            }
        }

        let enabled = true;
        try {
            const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('BRIEFING_ENABLED');
            if (row && row.value !== undefined && row.value !== null) {
                enabled = row.value.trim() === 'true';
            }
        } catch {}

        let layout = 'bento';
        try {
            const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('BRIEFING_UI_LAYOUT');
            if (row && row.value) layout = row.value.trim();
        } catch {}

        if (!enabled) {
            return {
                enabled: false,
                todayDate: todayStr,
                layout,
                morning: null,
                evening: null
            };
        }

        return {
            enabled: true,
            todayDate: todayStr,
            layout, // 'bento' (方案B) | 'segmented' (方案A)
            morning: this.formatBriefingRow(morning),
            evening: this.formatBriefingRow(evening)
        };
    }

    /**
     * 根据 ID 获取早晚报详情
     */
    getBriefingById(id) {
        const row = db.prepare('SELECT * FROM briefings WHERE id = ?').get(id);
        return this.formatBriefingRow(row);
    }

    /**
     * 分页查询历史早晚报列表
     */
    listBriefings({ page = 1, pageSize = 10, type = null } = {}) {
        const offset = (Math.max(1, page) - 1) * pageSize;
        const whereClause = type ? 'WHERE type = ?' : '';
        const params = type ? [type] : [];

        const countRow = db.prepare(`SELECT COUNT(*) as total FROM briefings ${whereClause}`).get(...params);
        const rows = db.prepare(`
            SELECT id, type, date, title, summary, article_count, time_range_start, time_range_end, created_at
            FROM briefings ${whereClause}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `).all(...params, pageSize, offset);

        return {
            items: rows,
            total: countRow.total,
            page,
            pageSize,
            totalPages: Math.ceil(countRow.total / pageSize) || 1
        };
    }

    /**
     * 格式化输出数据行
     */
    formatBriefingRow(row) {
        if (!row) return null;
        let contentObj = null;
        let articleIds = [];
        try {
            contentObj = JSON.parse(row.content);
        } catch {
            contentObj = { raw: row.content };
        }
        try {
            articleIds = JSON.parse(row.article_ids || '[]');
        } catch {}

        return {
            id: row.id,
            type: row.type,
            date: row.date,
            title: row.title,
            summary: row.summary,
            data: contentObj,
            articleCount: row.article_count,
            articleIds,
            timeRangeStart: row.time_range_start,
            timeRangeEnd: row.time_range_end,
            createdAt: row.created_at
        };
    }
}

module.exports = new BriefingService();
