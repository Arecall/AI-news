const cron = require('node-cron');
const db = require('./db');
const fetchAndProcessNews = require('./crawler');

class SchedulerService {
    constructor() {
        this.task = null;
        this.morningBriefingTask = null;
        this.eveningBriefingTask = null;
        this.isRunning = false;
        this.lastRunStartTime = null;
        this.lastRunDurationMs = null;
        this.lastRunStatus = 'IDLE'; // 'IDLE' | 'RUNNING' | 'SUCCESS' | 'FAILED'
        this.lastError = null;
    }

    getSetting(key, defaultValue) {
        try {
            const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
            if (row && row.value !== undefined && row.value !== null && row.value.trim() !== '') {
                return row.value.trim();
            }
        } catch (e) {}
        return process.env[key] !== undefined && process.env[key] !== null ? process.env[key].toString().trim() : defaultValue;
    }

    setSetting(key, value) {
        const stmt = db.prepare('REPLACE INTO settings (key, value) VALUES (?, ?)');
        stmt.run(key, value !== undefined && value !== null ? String(value).trim() : '');
    }

    /**
     * 校验 cron 表达式是否安全合法，防止间隔过短导致 DDoS/封禁
     */
    validateCron(cronExpr) {
        if (!cronExpr || typeof cronExpr !== 'string') {
            return { valid: false, message: 'Cron 表达式不能为空' };
        }
        const trimmed = cronExpr.trim();
        if (!cron.validate(trimmed)) {
            return { valid: false, message: '无效的 Cron 表达式格式' };
        }

        // 基础防过载校验：检查是否为每秒（6位）或每1分钟（* * * * *）
        const parts = trimmed.split(/\s+/);
        if (parts.length === 6) {
            return { valid: false, message: '不支持秒级调度，最小调度单位为分钟' };
        }
        if (trimmed === '* * * * *' || trimmed.startsWith('*/1 ') || trimmed.startsWith('1 ')) {
            return { valid: false, message: '抓取频率过高，最小安全间隔建议为 5 分钟' };
        }

        return { valid: true, expression: trimmed };
    }

    /**
     * 服务初始化时启动
     */
    init() {
        const enabled = this.getSetting('CRAWLER_ENABLED', 'true') === 'true';
        const cronExpr = this.getSetting('CRAWLER_CRON_EXPR', '0 */2 * * *');

        console.log(`[Scheduler] 初始化调度服务: enabled=${enabled}, cronExpr="${cronExpr}"`);

        if (enabled) {
            const validation = this.validateCron(cronExpr);
            if (validation.valid) {
                this.startSchedule(validation.expression);
            } else {
                console.warn(`[Scheduler] 数据库中的 Cron 表达式非法: ${validation.message}，回退使用默认规则: 0 */2 * * *`);
                this.startSchedule('0 */2 * * *');
            }
        }

        // 启动早晚报自动定时调度
        this.reloadBriefingSchedules();
    }

    /**
     * 加载/热重载早晚报定时调度任务
     */
    reloadBriefingSchedules() {
        if (this.morningBriefingTask) {
            this.morningBriefingTask.stop();
            this.morningBriefingTask = null;
        }
        if (this.eveningBriefingTask) {
            this.eveningBriefingTask.stop();
            this.eveningBriefingTask = null;
        }

        const briefingEnabled = this.getSetting('BRIEFING_ENABLED', 'true') === 'true';
        const autoEnabled = this.getSetting('BRIEFING_AUTO_ENABLED', 'true') === 'true';
        if (!briefingEnabled || !autoEnabled) {
            console.log(`[Scheduler] 早晚报定时调度已停用 (总开关: ${briefingEnabled ? '开启' : '关闭'}, 自动定时: ${autoEnabled ? '开启' : '关闭'})`);
            return;
        }

        const morningCron = this.getSetting('BRIEFING_MORNING_CRON', '0 8 * * *');
        const eveningCron = this.getSetting('BRIEFING_EVENING_CRON', '0 20 * * *');

        const briefingService = require('./services/briefing-service');

        if (cron.validate(morningCron)) {
            this.morningBriefingTask = cron.schedule(morningCron, async () => {
                console.log(`[Scheduler] 触发定时 AI 早报生成 (北京时间): ${new Date().toISOString()}`);
                try {
                    await briefingService.generateBriefing('morning');
                } catch (e) {
                    console.error('[Scheduler] 定时 AI 早报生成失败:', e.message);
                }
            }, {
                scheduled: true,
                timezone: 'Asia/Shanghai'
            });
            console.log(`[Scheduler] 定时 AI 早报已挂载 (北京时间 UTC+8)，规则: "${morningCron}"`);
        }

        if (cron.validate(eveningCron)) {
            this.eveningBriefingTask = cron.schedule(eveningCron, async () => {
                console.log(`[Scheduler] 触发定时 AI 晚报生成 (北京时间): ${new Date().toISOString()}`);
                try {
                    await briefingService.generateBriefing('evening');
                } catch (e) {
                    console.error('[Scheduler] 定时 AI 晚报生成失败:', e.message);
                }
            }, {
                scheduled: true,
                timezone: 'Asia/Shanghai'
            });
            console.log(`[Scheduler] 定时 AI 晚报已挂载 (北京时间 UTC+8)，规则: "${eveningCron}"`);
        }
    }

    startSchedule(cronExpr) {
        if (this.task) {
            this.task.stop();
            this.task = null;
        }

        this.task = cron.schedule(cronExpr, async () => {
            console.log(`[Scheduler] Cron 触发新闻采集任务 (北京时间): ${new Date().toISOString()}`);
            try {
                await this.executeJob('CRON');
            } catch (err) {
                console.error('[Scheduler] Cron 触发执行异常:', err.message);
            }
        }, {
            scheduled: true,
            timezone: 'Asia/Shanghai'
        });
        console.log(`[Scheduler] 动态调度任务已启动 (北京时间 UTC+8)，规则: ${cronExpr}`);
    }

    stopSchedule() {
        if (this.task) {
            this.task.stop();
            this.task = null;
        }
        if (this.morningBriefingTask) {
            this.morningBriefingTask.stop();
            this.morningBriefingTask = null;
        }
        if (this.eveningBriefingTask) {
            this.eveningBriefingTask.stop();
            this.eveningBriefingTask = null;
        }
        console.log('[Scheduler] 动态调度任务已停止');
    }

    /**
     * 执行采集任务，通过 isRunning 互斥锁防止重入
     */
    async executeJob(source = 'MANUAL') {
        if (this.isRunning) {
            const warnMsg = `[Scheduler] 已有采集任务正在执行中，跳过本次来自 [${source}] 的触发`;
            console.warn(warnMsg);
            const error = new Error('CRAWLER_BUSY: 当前已有采集任务正在执行中，请勿重复触发');
            error.code = 'CRAWLER_BUSY';
            throw error;
        }

        this.isRunning = true;
        this.lastRunStatus = 'RUNNING';
        this.lastRunStartTime = new Date().toISOString();
        this.lastError = null;
        const startTime = Date.now();

        try {
            console.log(`[Scheduler] 开始执行新闻抓取任务 [来源: ${source}]...`);
            await fetchAndProcessNews();
            this.lastRunStatus = 'SUCCESS';
            console.log(`[Scheduler] 新闻抓取任务执行成功 [来源: ${source}]`);
        } catch (err) {
            this.lastRunStatus = 'FAILED';
            this.lastError = err.message || String(err);
            console.error(`[Scheduler] 新闻抓取任务执行失败 [来源: ${source}]:`, err);
            throw err;
        } finally {
            this.isRunning = false;
            this.lastRunDurationMs = Date.now() - startTime;
        }
    }

    /**
     * 更新调度配置（持久化并热重载）
     */
    updateConfig({ enabled, cronExpr, intervalPreset }) {
        const isEnabled = enabled !== undefined ? (enabled === true || enabled === 'true') : (this.getSetting('CRAWLER_ENABLED', 'true') === 'true');
        const targetCron = cronExpr ? cronExpr.trim() : this.getSetting('CRAWLER_CRON_EXPR', '0 */2 * * *');
        const targetPreset = intervalPreset || this.getSetting('CRAWLER_INTERVAL_PRESET', '2h');

        const validation = this.validateCron(targetCron);
        if (!validation.valid) {
            const err = new Error(validation.message);
            err.code = 'INVALID_CRON';
            throw err;
        }

        // 原子化落库
        db.transaction(() => {
            this.setSetting('CRAWLER_ENABLED', isEnabled ? 'true' : 'false');
            this.setSetting('CRAWLER_CRON_EXPR', validation.expression);
            this.setSetting('CRAWLER_INTERVAL_PRESET', targetPreset);
        })();

        // 动态热重载任务
        if (isEnabled) {
            this.startSchedule(validation.expression);
        } else {
            this.stopSchedule();
        }

        return this.getStatus();
    }

    /**
     * 获取调度器及队列运行状态
     */
    getStatus() {
        let jobStats = {};
        try {
            const rows = db.prepare('SELECT status, COUNT(*) AS count FROM job_queue GROUP BY status').all();
            jobStats = rows.reduce((acc, r) => {
                acc[r.status] = r.count;
                return acc;
            }, {});
        } catch (e) {}

        const enabled = this.getSetting('CRAWLER_ENABLED', 'true') === 'true';
        const cronExpr = this.getSetting('CRAWLER_CRON_EXPR', '0 */2 * * *');
        const intervalPreset = this.getSetting('CRAWLER_INTERVAL_PRESET', '2h');

        return {
            enabled,
            cronExpr,
            intervalPreset,
            isRunning: this.isRunning,
            lastRunStatus: this.lastRunStatus,
            lastRunStartTime: this.lastRunStartTime,
            lastRunDurationMs: this.lastRunDurationMs,
            lastError: this.lastError,
            scheduledTaskActive: !!this.task,
            jobQueue: jobStats
        };
    }
}

module.exports = new SchedulerService();
