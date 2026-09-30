const axios = require('axios');
const http = require('http');
const https = require('https');
const Bottleneck = require('bottleneck');
const crypto = require('crypto');
const db = require('./db');
const { normalizeApiBaseUrl } = require('./services/api-url');

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 20 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 20 });
axios.defaults.httpAgent = httpAgent;
axios.defaults.httpsAgent = httpsAgent;

const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 1500;
const RETRYABLE_PATTERNS = [
  /no available accounts/i,
  /rate limit/i,
  /too many requests/i,
  /server error/i,
  /internal server error/i,
  /\b5\d\d\b/,
];

// ─── 1) 令牌桶限流：平滑对 AI 接口的请求频率，避免瞬时尖峰 ───
//   minTime：相邻两次请求的最小间隔（毫秒），即平均速率上限 = 1 / minTime req/s
//   maxConcurrent：同时持有的最大并发数
const MIN_TIME_MS = Number(process.env.AI_MIN_TIME_MS || 800);
const MAX_CONCURRENT = Number(process.env.AI_MAX_CONCURRENT || 2);

// 限流器分为「翻译」和「生图」两桶，二者独立计数，避免生图占用全部配额
const chatLimiter = new Bottleneck({ minTime: MIN_TIME_MS, maxConcurrent: MAX_CONCURRENT });
const imageLimiter = new Bottleneck({ minTime: MIN_TIME_MS * 2, maxConcurrent: Math.max(1, Math.floor(MAX_CONCURRENT / 2)) });

// ─── 2) 全局冷却：检测到 429 / 配额耗尽时进入冷却期，所有请求会被同步阻塞 ───
let cooldownUntil = 0;
const COOLDOWN_MS = Number(process.env.AI_COOLDOWN_MS || 30_000);

function parseRetryAfter(err) {
  const ra = err?.response?.headers?.['retry-after'];
  if (!ra) return 0;
  const seconds = Number(ra);
  return Number.isFinite(seconds) ? seconds * 1000 : 0;
}

function enterCooldown(err) {
  const retryAfter = parseRetryAfter(err);
  const duration = Math.max(COOLDOWN_MS, retryAfter);
  cooldownUntil = Date.now() + duration;
  const msg = err?.response?.data?.error?.message || err?.message || '';
  console.warn(`[AI 冷却] 检测到限流 (${err?.response?.status || 'unknown'}: ${msg})，进入 ${Math.round(duration / 1000)}s 冷却期`);
}

async function waitForCooldown() {
  const remaining = cooldownUntil - Date.now();
  if (remaining > 0) {
    await sleep(remaining);
  }
}

// ─── 3) 自适应并发：根据近 60s 的 429 比率动态收紧/放宽令牌桶参数 ───
const adaptiveState = {
  ewma429Ratio: 0,
  totalSamples: 0,
  consecutiveHealthyWindows: 0,
};
const ADAPTIVE_WINDOW_MS = 60_000;
const EWMA_ALPHA = 0.3;
const MIN_TIME_MIN = 300;
const MIN_TIME_MAX = 4000;

function recordOutcome(success, is429) {
  const errorRatio = is429 ? 1 : 0;
  adaptiveState.ewma429Ratio = adaptiveState.totalSamples === 0
    ? errorRatio
    : adaptiveState.ewma429Ratio * (1 - EWMA_ALPHA) + errorRatio * EWMA_ALPHA;
  adaptiveState.totalSamples += 1;

  // 收紧/放宽令牌桶速率
  const ratio = adaptiveState.ewma429Ratio;
  let targetMinTime = MIN_TIME_MS;

  if (ratio > 0.2) {
    targetMinTime = Math.min(MIN_TIME_MAX, currentMinTime() * 1.5);
    adaptiveState.consecutiveHealthyWindows = 0;
  } else if (ratio < 0.05 && adaptiveState.totalSamples > 30) {
    adaptiveState.consecutiveHealthyWindows += 1;
    if (adaptiveState.consecutiveHealthyWindows >= 3) {
      targetMinTime = Math.max(MIN_TIME_MIN, currentMinTime() * 0.85);
    }
  } else {
    adaptiveState.consecutiveHealthyWindows = 0;
  }

  applyMinTime(Math.round(targetMinTime));
}

function currentMinTime() {
  return chatLimiter.minTime || MIN_TIME_MS;
}

function applyMinTime(ms) {
  if (chatLimiter.minTime !== ms) {
    chatLimiter.updateSettings({ minTime: ms });
  }
  if (imageLimiter.minTime !== ms * 2) {
    imageLimiter.updateSettings({ minTime: ms * 2 });
  }
}

function getSetting(key, defaultValue) {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (row && row.value !== undefined && row.value !== null && row.value.trim() !== '') {
      return row.value.trim();
    }
  } catch (e) {
    // console.warn('Read setting error', e);
  }
  return process.env[key] !== undefined && process.env[key] !== null ? process.env[key].toString().trim() : defaultValue;
}

function isRetryable(err) {
  const data = err?.response?.data;
  const msg = (data?.error?.message || data?.message || err?.message || '').toString();
  if (RETRYABLE_PATTERNS.some((re) => re.test(msg))) return true;
  const status = err?.response?.status;
  if (status === 429 || (status >= 500 && status < 600)) return true;
  return false;
}

function isQuotaExhausted(err) {
  if (err?.response?.status === 429) return true;
  const msg = err?.response?.data?.error?.message || '';
  return /exhausted your capacity|cooling down|quota/i.test(msg);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 通过统一的受限通道执行 AI 请求：
 * 1. 等待冷却期结束
 * 2. 通过对应令牌桶调度（平滑速率 + 并发上限）
 * 3. 命中 429 / 配额耗尽时，进入冷却并解除当前占用
 * 4. 自适应并发观察近窗口的 429 比率，动态调整令牌桶速率
 */
async function runWithGuards(fn, { kind = 'chat' } = {}) {
  await waitForCooldown();
  const limiter = kind === 'image' ? imageLimiter : chatLimiter;
  try {
    const result = await limiter.schedule(fn);
    recordOutcome(true, false);
    return result;
  } catch (e) {
    const quota = isQuotaExhausted(e);
    if (quota) {
      enterCooldown(e);
    }
    recordOutcome(false, quota || e?.response?.status === 429);
    throw e;
  }
}

// ─── 4) 翻译结果 LRU 去重：基于 title+summary 的 SHA1，避免重复翻译 ───
const TRANSLATION_CACHE_LIMIT = 1000;
const translationCache = new Map(); // key -> { title, content }

function cacheKey(title, summary) {
  const input = `${(title || '').trim()}|${(summary || '').trim().slice(0, 200)}`;
  return crypto.createHash('sha1').update(input).digest('hex');
}

function cacheGet(key) {
  const value = translationCache.get(key);
  if (!value) return null;
  // LRU：命中后重新插入到队尾
  translationCache.delete(key);
  translationCache.set(key, value);
  return value;
}

function cacheSet(key, value) {
  if (translationCache.has(key)) translationCache.delete(key);
  translationCache.set(key, value);
  if (translationCache.size > TRANSLATION_CACHE_LIMIT) {
    const firstKey = translationCache.keys().next().value;
    translationCache.delete(firstKey);
  }
}

function cacheKeyFromSource(sourceText) {
  return crypto.createHash('sha1').update((sourceText || '').trim().slice(0, 4000)).digest('hex');
}

function getApiBase() {
  const raw = getSetting('ANTHROPIC_BASE_URL', 'https://api.example.com');
  return normalizeApiBaseUrl(raw);
}

/**
 * 单条翻译：先查缓存，未命中再走 AI
 */
async function callGeminiApi(prompt) {
  const API_URL = getApiBase();
  const AUTH_TOKEN = getSetting('ANTHROPIC_AUTH_TOKEN', '');
  const model = getSetting('GEMINI_CHAT_MODEL', 'gemini-3.8-flash-high');

  // 智能缓存键：若为单篇新闻翻译且包含提取内容，走 sourceText 缓存；否则基于 model + prompt 全文进行独立哈希
  const sourceMatch = prompt.match(/Content:\s*([\s\S]*?)\s*Only output JSON/i);
  const sourceText = sourceMatch ? sourceMatch[1].trim() : '';
  const key = sourceText
    ? crypto.createHash('sha1').update(`trans:${sourceText.slice(0, 4000)}`).digest('hex')
    : crypto.createHash('sha1').update(`gen:${model}:${prompt.trim()}`).digest('hex');

  const cached = cacheGet(key);
  if (cached) {
    console.log(`[AI 缓存] 命中，跳过外部调用 (key=${key.slice(0, 8)})`);
    return cached;
  }

  let lastErr;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await runWithGuards(async () => {
        const response = await axios.post(
          `${API_URL}/chat/completions`,
          { model: model, messages: [{ role: 'user', content: prompt }] },
          {
            timeout: 60000,
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${AUTH_TOKEN}`,
            },
          }
        );
        const textResponse = response.data?.choices?.[0]?.message?.content;
        if (!textResponse) {
          throw new Error('Chat API returned no content: ' + JSON.stringify(response.data));
        }
        // 清理思维链思考标签与 markdown 标记
        const cleanContent = textResponse.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        const jsonStr = cleanContent.replace(/```json/g, '').replace(/```/g, '').trim();

        let parsedResult;
        try {
          parsedResult = JSON.parse(jsonStr);
        } catch {
          // 兜底正则提取首尾大括号或中括号对象
          const match = jsonStr.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
          if (match) {
            parsedResult = JSON.parse(match[1]);
          } else {
            throw new Error('无法从 AI 响应中解析出有效的 JSON: ' + jsonStr.slice(0, 200));
          }
        }
        return parsedResult;
      }, { kind: 'chat' });

      cacheSet(key, result);
      return result;
    } catch (e) {
      lastErr = e;
      const retryable = isRetryable(e);
      console.error(`API 调用错误 (尝试 ${attempt}/${MAX_ATTEMPTS}):`, e.response ? e.response.data : e.message);
      if (!retryable || attempt === MAX_ATTEMPTS) {
        throw new Error('无法连接至 AI 服务，请检查 API 配置。');
      }
      if (!isQuotaExhausted(e)) {
        const wait = BASE_BACKOFF_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
        console.log(`  等待 ${wait}ms 后重试...`);
        await sleep(wait);
      }
    }
  }

  throw lastErr || new Error('无法连接至 AI 服务，请检查 API 配置。');
}

/**
 * 批量翻译：将多条资讯合并为单次 prompt，大幅降低调用次数
 * 输入：[{ sourceText, titleHint }, ...]
 * 输出：与输入等长的数组 [{ title, content }, ...]
 * 失败策略：尽量解析部分返回，缺失项通过逐条回退补齐
 */
async function callGeminiBatch(items) {
  if (!items || items.length === 0) return [];
  if (items.length === 1) {
    const single = await callGeminiApi(items[0].prompt);
    return [single];
  }

  const API_URL = getApiBase();
  const AUTH_TOKEN = getSetting('ANTHROPIC_AUTH_TOKEN', '');
  const model = getSetting('GEMINI_CHAT_MODEL', 'gemini-3.8-flash-high');

  // 构造批量 prompt 与缓存映射
  const unresolved = [];
  const cachedResults = new Array(items.length);
  items.forEach((item, idx) => {
    const key = cacheKeyFromSource(item.sourceText);
    const cached = cacheGet(key);
    if (cached) {
      cachedResults[idx] = cached;
    } else {
      unresolved.push({ idx, sourceText: item.sourceText });
    }
  });

  if (unresolved.length === 0) {
    console.log(`[批量翻译] 全部 ${items.length} 条命中缓存`);
    return cachedResults;
  }

  const batchPrompt = `你是一位专业的科技新闻翻译与分析专家。请将以下 ${unresolved.length} 条英文科技新闻分别进行中文全文翻译（要求全文逐段翻译，严禁摘要缩写，严禁删减内容）。
每条独立输出，输出一个符合格式的 JSON 数组，元素顺序与输入顺序严格一致：
[
  {
    "title": "准确客观且有吸引力的中文标题",
    "summary": "100-150字的核心导读摘要（提炼背景、主体事件与关键影响，用于信息流卡片展示，与正文区分开）",
    "content": "完整的逐段中文全文翻译（忠实原文，逐段完整翻译，保留完整的段落换行 \\n\\n，副标题以 ## 标出，完整保留所有数据、引言、当事人发言与技术细节，严禁删减或缩写）"
  }
]

要求：
1. content 必须是整篇报道的完整全文逐段翻译，忠实原文，严禁擅自删减段落、技术数据、当事人发言或压缩为概括通稿。
2. 保持标准 Markdown 格式分段（段落间必须使用 \\n\\n 分隔，副标题使用 ##）。
3. 语言专业严谨、通顺自然，符合中文科技媒体阅读习惯。
4. summary 字段输出 100~150 字精炼导读摘要。

${unresolved.map((u, i) => `【新闻 ${i + 1}】\n${u.sourceText.slice(0, 20000)}\n`).join('\n')}

仅输出 JSON 数组，不要附加解释。`;

  const parseBatch = (text) => {
    const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const arrStart = cleaned.indexOf('[');
    const arrEnd = cleaned.lastIndexOf(']');
    if (arrStart === -1 || arrEnd === -1) throw new Error('Batch response is not a JSON array');
    return JSON.parse(cleaned.slice(arrStart, arrEnd + 1));
  };

  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const parsed = await runWithGuards(async () => {
        const response = await axios.post(
          `${API_URL}/chat/completions`,
          {
            model,
            messages: [{ role: 'user', content: batchPrompt }],
            temperature: 0.4,
          },
          {
            timeout: 90000,
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${AUTH_TOKEN}`,
            },
          }
        );
        const text = response.data?.choices?.[0]?.message?.content;
        if (!text) {
          throw new Error('Batch Chat API returned no content: ' + JSON.stringify(response.data));
        }
        return parseBatch(text);
      }, { kind: 'chat' });

      // 长度不匹配时按数组截断并对剩余项做单条回退
      const valid = Array.isArray(parsed) ? parsed : [];
      const finalResults = [...cachedResults];

      const fallbacks = [];
      unresolved.forEach((u, i) => {
        if (valid[i] && valid[i].title && valid[i].content) {
          finalResults[u.idx] = {
            title: valid[i].title,
            summary: valid[i].summary || valid[i].content.slice(0, 180) + '...',
            content: valid[i].content,
          };
          cacheSet(cacheKeyFromSource(u.sourceText), finalResults[u.idx]);
        } else {
          fallbacks.push({ idx: u.idx, prompt: items[u.idx].prompt });
        }
      });

      // 部分失败：单条平滑顺序回退，避免突发并发踩爆 429 限流导致全局挂起
      if (fallbacks.length > 0) {
        console.warn(`[批量翻译] ${fallbacks.length}/${unresolved.length} 条平滑回退为单条调用`);
        for (const f of fallbacks) {
          try {
            const single = await callGeminiApi(f.prompt);
            finalResults[f.idx] = single;
          } catch (e) {
            console.error(`[批量翻译] 回退单条失败: ${e.message}`);
          }
        }
      }

      return finalResults;
    } catch (e) {
      lastErr = e;
      const retryable = isRetryable(e);
      console.error(`批量 API 调用错误 (尝试 ${attempt}/${MAX_ATTEMPTS}):`, e.response ? e.response.data : e.message);
      if (!retryable || attempt === MAX_ATTEMPTS) {
        throw new Error('无法连接至 AI 服务，请检查 API 配置。');
      }
      if (!isQuotaExhausted(e)) {
        const wait = BASE_BACKOFF_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
        await sleep(wait);
      }
    }
  }

  throw lastErr || new Error('无法连接至 AI 服务，请检查 API 配置。');
}

/**
 * 调用 gemini-3.1-flash-image / gpt-image-2 / gpt-image-1.5 生成图片
 * 优先采用 gemini-3.1-flash-image 运行，当遇到 429 配额用尽时，自动降级为 gpt-image-2，若 gpt-image-2 也失败，则降级为 gpt-image-1.5 绘图
 */
async function generateAiImage(prompt, endpointType = 'completions') {
  const API_URL = getApiBase();
  const AUTH_TOKEN = getSetting('ANTHROPIC_AUTH_TOKEN', '');
  const geminiImageModel = getSetting('GEMINI_IMAGE_MODEL', 'gemini-3.1-flash-image');
  let lastErr;

  // 第一阶段：首先尝试用 gemini-3.1-flash-image completions 生成配图
  if (endpointType === 'completions') {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        return await runWithGuards(async () => {
          const response = await axios.post(
            `${API_URL}/chat/completions`,
            {
              model: geminiImageModel,
              messages: [{ role: 'user', content: prompt }]
            },
            {
              timeout: 60000,
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${AUTH_TOKEN}`
              }
            }
          );

          const message = response.data?.choices?.[0]?.message;
          if (!message) {
            throw new Error('Completions API response message is empty');
          }

          if (message.images?.[0]?.image_url?.url) {
            const urlStr = message.images[0].image_url.url;
            if (urlStr.startsWith('data:image/')) {
              const base64Match = urlStr.match(/data:image\/(?:png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)/) ||
                                  urlStr.match(/([A-Za-z0-9+/=]{100,})/);
              if (base64Match) {
                return { type: 'buffer', data: Buffer.from(base64Match[1], 'base64') };
              }
            }
            return { type: 'url', data: urlStr };
          }

          const content = (message.content || '').trim();
          if (content) {
            const base64Match = content.match(/data:image\/(?:png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)/) ||
                                content.match(/([A-Za-z0-9+/=]{100,})/);
            if (base64Match) {
              return { type: 'buffer', data: Buffer.from(base64Match[1], 'base64') };
            }
            const urlMatch = content.match(/!\[.*?\]\((https?:\/\/[^\s\)]+)\)/) || content.match(/(https?:\/\/[^\s]+)/);
            if (urlMatch) {
              return { type: 'url', data: urlMatch[1] };
            }
          }
          throw new Error('No valid image data structure found in completions');
        }, { kind: 'image' });
      } catch (e) {
        lastErr = e;
        const retryable = isRetryable(e);
        console.error(`AI 绘图错误 (尝试 ${attempt}/${MAX_ATTEMPTS}):`, e.response ? e.response.data : e.message);

        if (isQuotaExhausted(e)) {
          console.warn(`${geminiImageModel} 配额已耗尽，正在降级使用 gpt-image-2 生成...`);
          break;
        }

        if (!retryable || attempt === MAX_ATTEMPTS) {
          break;
        }
        const wait = BASE_BACKOFF_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
        console.log(`  等待 ${wait}ms 后重试 AI 绘图...`);
        await sleep(wait);
      }
    }
  }

  // 第二阶段：当 gemini 失败/429 时，或者显式调用 generations 时，依次调用 gpt-image-2 和 gpt-image-1.5 兜底生成
  const fallbackStr = getSetting('FALLBACK_IMAGE_MODELS', 'gpt-image-2,gpt-image-1.5');
  const fallbackModels = fallbackStr.split(',').map(m => m.trim()).filter(Boolean);

  for (const model of fallbackModels) {
    console.log(`尝试使用兜底生图模型: ${model}`);
    let modelErr;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        return await runWithGuards(async () => {
          const response = await axios.post(
            `${API_URL}/images/generations`,
            {
              model: model,
              prompt: prompt,
              n: 1,
              size: '1024x1024',
              response_format: 'b64_json'
            },
            {
              timeout: 60000,
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${AUTH_TOKEN}`
              }
            }
          );

          if (!response.data?.data?.[0]) {
            throw new Error(`${model} response format is invalid`);
          }

          const dataItem = response.data.data[0];
          if (dataItem.b64_json) {
            return { type: 'buffer', data: Buffer.from(dataItem.b64_json, 'base64') };
          } else if (dataItem.url) {
            return { type: 'url', data: dataItem.url };
          }
          throw new Error(`No valid image data in ${model} response`);
        }, { kind: 'image' });
      } catch (e) {
        modelErr = e;
        const retryable = isRetryable(e);
        console.error(`${model} 绘图错误 (尝试 ${attempt}/${MAX_ATTEMPTS}):`, e.response ? e.response.data : e.message);

        if (isQuotaExhausted(e)) {
          console.warn(`${model} 配额已耗尽或请求受限，准备切换到下一个兜底模型...`);
          break;
        }

        if (!retryable || attempt === MAX_ATTEMPTS) {
          break;
        }
        const wait = BASE_BACKOFF_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
        console.log(`  等待 ${wait}ms 后重试 ${model} 绘图...`);
        await sleep(wait);
      }
    }

    lastErr = modelErr;
  }

  throw lastErr || new Error('所有生图服务均不可用。');
}

// ─── 诊断导出 ───
function getAdaptiveStats() {
  return {
    ewma429Ratio: Number(adaptiveState.ewma429Ratio.toFixed(4)),
    totalSamples: adaptiveState.totalSamples,
    minTimeMs: currentMinTime(),
    cooldownRemainingMs: Math.max(0, cooldownUntil - Date.now()),
    cacheSize: translationCache.size,
  };
}

module.exports = { callGeminiApi, callGeminiBatch, generateAiImage, getAdaptiveStats };
