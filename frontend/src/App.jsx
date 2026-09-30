import { BrowserRouter as Router, Routes, Route, Link, useLocation, useParams, useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { marked } from 'marked';
import './App.css';

const IMAGE_FALLBACK_SRC = '/images/ogimage.png';
const PAGE_SIZE = 50;

const NAV_TABS = [
  { id: 'today', label: '今日看点' },
  { id: 'stream', label: '资讯流' },
  { id: 'model', label: '模型发布' },
  { id: 'industry', label: '产业动态' },
  { id: 'research', label: '研究突破' },
  { id: 'policy', label: '政策安全' },
  { id: 'talent', label: '人才动向' },
];

// Map top-nav tab -> topic id (null means: don't filter, show all)
const NAV_TO_TOPIC = {
  today: null,
  stream: null,
  model: 'model',
  industry: 'industry',
  research: 'research',
  policy: 'policy',
  talent: null,
};

const TOPICS = [
  { id: 'all', label: '全部' },
  { id: 'model', label: '模型发布', keywords: ['模型', 'OpenAI', 'Claude', 'Gemini', 'GPT', 'LLM', '大模型', '推理'] },
  { id: 'industry', label: '产业动态', keywords: ['公司', '微软', '谷歌', '苹果', 'NVIDIA', '英伟达', '企业', '市场', '芯片', '架构'] },
  { id: 'research', label: '研究突破', keywords: ['研究', '论文', '实验室', '算法', '突破', 'Memory', '训练', '数据集'] },
  { id: 'application', label: '产品与应用', keywords: ['应用', '助手', '搜索', '办公', '教育', '医疗', '落地', '工具', '产品'] },
  { id: 'finance', label: '投融资', keywords: ['投资', '融资', '估值', '基金', '资本', '收购', '并购'] },
  { id: 'market', label: '市场观察', keywords: ['股市', '板块', '财报', '市值', '资本', '融资', '市场', '股价'] },
];

const TREND_TOPICS = [
  { tag: 'Claude 3.7 / 4', keyword: 'Claude', heat: '98°', hot: true },
  { tag: 'DeepSeek-R1', keyword: 'DeepSeek', heat: '96°', hot: true },
  { tag: '推理思维链', keyword: '推理', heat: '92°' },
  { tag: '具身机器人', keyword: '机器人', heat: '88°' },
  { tag: 'AI 智能体', keyword: '智能体', heat: '85°' },
  { tag: '算力与芯片', keyword: '算力', heat: '82°' },
];

function Icon({ name, size = 18, filled = false }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };

  if (name === 'search') {
    return (
      <svg {...common}>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.6-3.6" />
      </svg>
    );
  }

  if (name === 'arrow') {
    return (
      <svg {...common}>
        <path d="M5 12h14" />
        <path d="m13 6 6 6-6 6" />
      </svg>
    );
  }

  if (name === 'arrow-up') {
    return (
      <svg {...common}>
        <path d="M12 19V5" />
        <path d="m5 12 7-7 7 7" />
      </svg>
    );
  }

  if (name === 'chevron-down') {
    return (
      <svg {...common}>
        <path d="m6 9 6 6 6-6" />
      </svg>
    );
  }

  if (name === 'chevron-left') {
    return (
      <svg {...common}>
        <path d="m15 6-6 6 6 6" />
      </svg>
    );
  }

  if (name === 'chevron-right') {
    return (
      <svg {...common}>
        <path d="m9 6 6 6-6 6" />
      </svg>
    );
  }

  if (name === 'flame') {
    return (
      <svg {...common}>
        <path d="M12 3s4 4 4 8a4 4 0 0 1-8 0c0-2 1-3 2-4-.5 2 .5 3 2 3 0-3-1-5 0-7Z" fill="currentColor" stroke="none" />
        <path d="M8.5 14.5c0 2 1.6 3.5 3.5 3.5s3.5-1.5 3.5-3.5" />
      </svg>
    );
  }

  if (name === 'arrow-left') {
    return (
      <svg {...common}>
        <path d="M19 12H5" />
        <path d="m11 18-6-6 6-6" />
      </svg>
    );
  }

  if (name === 'external') {
    return (
      <svg {...common}>
        <path d="M14 5h5v5" />
        <path d="m10 14 9-9" />
        <path d="M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1-1-1h4" />
      </svg>
    );
  }

  if (name === 'mail') {
    return (
      <svg {...common}>
        <rect x="4" y="6" width="16" height="12" rx="2" />
        <path d="m4 8 8 5 8-5" />
      </svg>
    );
  }

  if (name === 'bookmark') {
    return (
      <svg {...common}>
        <path
          d="M7 5.5A1.5 1.5 0 0 1 8.5 4h7A1.5 1.5 0 0 1 17 5.5V20l-5-3-5 3Z"
          fill={filled ? 'currentColor' : 'none'}
        />
      </svg>
    );
  }

  if (name === 'refresh') {
    return (
      <svg {...common}>
        <path d="M20 12a8 8 0 1 1-2.35-5.65" />
        <path d="M20 4v6h-6" />
      </svg>
    );
  }

  if (name === 'x') {
    return (
      <svg {...common}>
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </svg>
    );
  }

  if (name === 'sparkles') {
    return (
      <svg {...common}>
        <path d="m12 3 1.9 4.7L18.6 9.6l-4.7 1.9L12 16.2l-1.9-4.7-4.7-1.9 4.7-1.9L12 3Z" fill="currentColor" stroke="none" />
        <path d="M5 3v4M3 5h4M19 15v4M17 17h4" />
      </svg>
    );
  }

  if (name === 'type') {
    return (
      <svg {...common}>
        <polyline points="4 7 4 4 20 4 20 7" />
        <line x1="9" y1="20" x2="15" y2="20" />
        <line x1="12" y1="4" x2="12" y2="20" />
      </svg>
    );
  }

  if (name === 'share') {
    return (
      <svg {...common}>
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
      </svg>
    );
  }

  return null;
}

function ImageWithFallback({ src, alt, ...props }) {
  const handleError = (event) => {
    if (event.currentTarget.src.endsWith(IMAGE_FALLBACK_SRC)) return;
    event.currentTarget.src = IMAGE_FALLBACK_SRC;
  };

  return <img src={src || IMAGE_FALLBACK_SRC} alt={alt || ''} onError={handleError} decoding="async" {...props} />;
}

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    // 禁用浏览器默认的非受控滚动恢复干扰，统一由 SPA 精准管理
    if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
      try {
        window.history.scrollRestoration = 'manual';
      } catch {}
    }

    // 如果返回首页，且存在待恢复的锚点或滚动位置，不在此强制滚动回顶部，交给 HomePage 精准瞬时恢复
    if (pathname === '/') {
      const lastClickedId = sessionStorage.getItem('home.lastClickedId');
      const lastScrollY = sessionStorage.getItem('home.lastScrollY');
      if (lastClickedId || lastScrollY) {
        return;
      }
    }
    // 瞬时归零，杜绝任何新落地页打开时的滑动抽搐过程
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname]);

  return null;
}

function formatDate(value, mode = 'date') {
  if (!value) return '今日';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '今日';

  if (mode === 'time') {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  if (mode === 'full') {
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' }).replace(/\//g, '/');
}

function formatRelativeTime(value) {
  if (!value) return '刚刚';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '刚刚';

  const diff = Date.now() - date.getTime();
  const minutes = Math.max(1, Math.floor(diff / 60000));
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 8) return `${days} 天前`;
  return formatDate(value);
}

function formatTimeOnly(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function getTopicId(item) {
  const text = `${item.title || ''} ${item.summary || ''} ${item.content || ''}`;
  const matched = TOPICS.find((topic) => topic.id !== 'all' && topic.keywords.some((keyword) => text.includes(keyword)));
  return matched?.id || 'industry';
}

function getTopicLabel(item) {
  return TOPICS.find((topic) => topic.id === getTopicId(item))?.label || '产业动态';
}

function getSummary(item, length = 96) {
  const source = (item.summary || item.content || '').replace(/\s+/g, ' ').trim();
  if (!source) return '本条资讯暂未提供摘要，点击进入可查看完整正文与来源链接。';
  if (source.length <= length) return source;
  return `${source.slice(0, length)}...`;
}

const SOURCE_NAME_MAP = {
  'artificialintelligence-news.com': 'AI News',
  'techcrunch.com': 'TechCrunch',
  'theverge.com': 'The Verge',
  'reuters.com': '路透社',
  'bloomberg.com': '彭博社',
  'wired.com': 'WIRED',
  'venturebeat.com': 'VentureBeat',
  'technologyreview.com': 'MIT 科技评论',
  'arstechnica.com': 'Ars Technica',
  'zdnet.com': 'ZDNet',
  'openai.com': 'OpenAI',
  'anthropic.com': 'Anthropic',
  'googleblog.com': 'Google AI',
};

function getSourceLabel(item) {
  if (item.source || item.sourceName || item.publisher) return item.source || item.sourceName || item.publisher;

  try {
    if (item.originalUrl) {
      const host = new URL(item.originalUrl).hostname.replace(/^www\./, '');
      if (SOURCE_NAME_MAP[host]) return SOURCE_NAME_MAP[host];
      if (host.length > 16) {
        const parts = host.split('.');
        if (parts.length >= 2) return parts[0].toUpperCase();
      }
      return host;
    }
  } catch {
    return 'AI News';
  }

  return 'AI News';
}

export function getEngagement(seed) {
  if (typeof seed === 'object' && seed !== null) {
    const item = seed;
    const rawViews = typeof item.views === 'number'
      ? item.views
      : Math.round((((Number(item.id || 1) * 37) % 96) + 24) * 100);
    const comments = typeof item.comments === 'number'
      ? item.comments
      : ((Number(item.id || 1) * 11) % 42) + 3;
    const viewsDisplay = rawViews >= 1000 ? `${(rawViews / 1000).toFixed(1)}k` : String(rawViews);
    return {
      views: viewsDisplay,
      rawViews,
      comments,
    };
  }
  const id = Number(seed) || 1;
  const rawK = (((id * 37) % 96) + 24) / 10;
  const rawViews = Math.round(rawK * 1000);
  const comments = ((id * 11) % 42) + 3;
  return {
    views: `${rawK.toFixed(1)}k`,
    rawViews,
    comments,
  };
}

/**
 * 工业级综合热度评分模型（Hacker News / Reddit 时间衰减加权模型）
 * 综合三个核心维度：
 * 1. 阅读量 (Views) - 广度基础权重 (1.0x)
 * 2. 评论数 (Comments) - 深度互动高倍权重 (20.0x)
 * 3. 发布时效 (Recency) - 重力衰减指数 ((hoursAgo + 2)^1.3)
 */
export function calculateHotScore(item, now = Date.now()) {
  if (!item) return 0;
  const engagement = getEngagement(item);
  const rawViews = engagement.rawViews || 2000;
  const comments = engagement.comments || 5;

  let hoursAgo = 1;
  if (item.createdAt) {
    const pubTime = new Date(item.createdAt).getTime();
    if (!isNaN(pubTime)) {
      hoursAgo = Math.max(0.1, (now - pubTime) / (1000 * 60 * 60));
    }
  }

  // 基础互动分：评论权重设为 20.0，体现深度讨论价值
  const baseScore = rawViews * 1.0 + comments * 20.0;

  // 时间衰减重力因子 (Gravity = 1.3)
  const gravity = 1.3;
  const decay = Math.pow(hoursAgo + 2, gravity);

  return baseScore / decay;
}

// Heuristic: short non-punctuated line -> section heading
function looksLikeHeading(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.length > 32) return false;
  return /[。.!?,;:)）】]$/.test(trimmed) === false;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return isMobile;
}

function GlobalNav({ searchQuery, setSearchQuery, activeNav, setActiveNav }) {
  const inputRef = useRef(null);

  useEffect(() => {
    const handleShortcut = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  return (
    <header className="app-nav">
      <div className="nav-inner">
        <Link to="/" className="brand-link" aria-label="AI 新闻快讯首页">
          <span className="brand-title">AI 新闻快讯</span>
          <span className="brand-sub">全球 AI 资讯速递 · 洞察技术与产业趋势</span>
        </Link>

        <nav className="nav-links" aria-label="主导航">
          {NAV_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={activeNav === tab.id ? 'nav-link active' : 'nav-link'}
              onClick={() => setActiveNav(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <label className="search-shell">
          <Icon name="search" size={15} />
          <input
            ref={inputRef}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setSearchQuery('');
                inputRef.current?.blur();
              }
            }}
            placeholder="搜索 AI 资讯、公司、关键词..."
            type="search"
          />
          {searchQuery ? (
            <button
              type="button"
              className="search-clear-inline"
              onClick={(e) => {
                e.preventDefault();
                setSearchQuery('');
                inputRef.current?.focus();
              }}
              aria-label="清除搜索输入"
            >
              <Icon name="x" size={12} />
            </button>
          ) : (
            <kbd>⌘K</kbd>
          )}
        </label>
      </div>
    </header>
  );
}

function TopicTabs({ activeTopic, setActiveTopic, savedCount = 0 }) {
  return (
    <div className="topic-tabs" aria-label="资讯分类">
      {TOPICS.map((topic) => (
        <button
          key={topic.id}
          className={activeTopic === topic.id ? 'topic-tab active' : 'topic-tab'}
          onClick={() => setActiveTopic(topic.id)}
          type="button"
        >
          {topic.label}
        </button>
      ))}
      <button
        type="button"
        className={activeTopic === 'saved' ? 'topic-tab topic-tab-saved active' : 'topic-tab topic-tab-saved'}
        onClick={() => setActiveTopic(activeTopic === 'saved' ? 'all' : 'saved')}
        aria-label="查看已收藏资讯"
      >
        <Icon name="bookmark" size={12} filled={activeTopic === 'saved'} />
        <span>收藏</span>
        {savedCount > 0 && <span className="saved-badge-pill">{savedCount}</span>}
      </button>
    </div>
  );
}

function Toast({ message }) {
  if (!message) return null;
  return (
    <div className="floating-toast-container" role="status" aria-live="polite">
      <div className="floating-toast-card">
        <span className="toast-check-icon">✓</span>
        <span className="toast-msg-text">{message}</span>
      </div>
    </div>
  );
}

function Pagination({ currentPage, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;

  const pages = [];
  const maxVisible = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
  let endPage = Math.min(totalPages, startPage + maxVisible - 1);

  if (endPage - startPage + 1 < maxVisible) {
    startPage = Math.max(1, endPage - maxVisible + 1);
  }

  for (let i = startPage; i <= endPage; i++) {
    pages.push(i);
  }

  return (
    <nav className="pagination-container" aria-label="新闻分页">
      <button
        type="button"
        className="pagination-btn pagination-prev"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        aria-label="上一页"
      >
        <Icon name="chevron-left" size={14} />
        <span>上一页</span>
      </button>

      {startPage > 1 && (
        <>
          <button
            type="button"
            className="pagination-btn"
            onClick={() => onPageChange(1)}
          >
            1
          </button>
          {startPage > 2 && <span className="pagination-ellipsis">…</span>}
        </>
      )}

      {pages.map((p) => (
        <button
          key={p}
          type="button"
          className={p === currentPage ? 'pagination-btn active' : 'pagination-btn'}
          onClick={() => onPageChange(p)}
        >
          {p}
        </button>
      ))}

      {endPage < totalPages && (
        <>
          {endPage < totalPages - 1 && <span className="pagination-ellipsis">…</span>}
          <button
            type="button"
            className="pagination-btn"
            onClick={() => onPageChange(totalPages)}
          >
            {totalPages}
          </button>
        </>
      )}

      <button
        type="button"
        className="pagination-btn pagination-next"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        aria-label="下一页"
      >
        <span>下一页</span>
        <Icon name="chevron-right" size={14} />
      </button>
    </nav>
  );
}

function NewsRow({ item, index = 0, saved, onToggleSave }) {
  const engagement = getEngagement(item.id);

  const handleItemClick = () => {
    sessionStorage.setItem('home.lastClickedId', String(item.id));
    sessionStorage.setItem('home.lastScrollY', String(window.scrollY));
  };

  return (
    <article
      className="news-row"
      id={`news-item-${item.id}`}
      style={{ '--row-idx': Math.min(index, 12) }}
    >
      <Link
        to={`/news/${item.id}`}
        onClick={handleItemClick}
        className="row-image"
        aria-label={item.title}
      >
        <ImageWithFallback src={item.imageUrl} alt={item.title} loading="lazy" />
      </Link>

      <div className="row-content">
        <div className="row-meta">
          <span className="chip">{getTopicLabel(item)}</span>
          <span>{formatRelativeTime(item.createdAt)}</span>
          <span className="dot" aria-hidden="true" />
          <span>{getSourceLabel(item)}</span>
        </div>
        <h2>
          <Link to={`/news/${item.id}`} onClick={handleItemClick}>
            {item.title}
          </Link>
        </h2>
        <p>{getSummary(item, 80)}</p>
        <div className="row-foot-bar">
          <div className="row-foot-stats">
            <span>{engagement.views} 阅读</span>
            <span className="dot" aria-hidden="true" />
            <span>{engagement.comments} 评论</span>
          </div>
          <button
            className={saved ? 'save-button active' : 'save-button'}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleSave(item.id);
            }}
            aria-label={saved ? '取消收藏' : '收藏资讯'}
            aria-pressed={saved}
          >
            <Icon name="bookmark" size={13} filled={saved} />
          </button>
        </div>
      </div>
    </article>
  );
}

function ParticleNetworkBg() {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return undefined;
    }

    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    let animationFrameId;
    let width = (canvas.width = canvas.offsetWidth);
    let height = (canvas.height = canvas.offsetHeight);

    const particles = [];
    const particleCount = 45;

    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.45,
        vy: (Math.random() - 0.5) * 0.45,
        radius: Math.random() * 1.5 + 0.5,
      });
    }

    const sphere = { x: 120, y: height - 120, radius: 90, angle: 0 };

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = canvas.offsetWidth;
      height = canvas.height = canvas.offsetHeight;
      sphere.y = height - 120;
    };
    window.addEventListener('resize', handleResize);

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      sphere.angle += 0.0025;
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sphere.x, sphere.y, sphere.radius, 0, Math.PI * 2);
      ctx.stroke();

      const points = [];
      const rows = 6;
      const cols = 12;
      for (let r = 1; r < rows; r++) {
        const phi = (Math.PI / rows) * r;
        for (let c = 0; c < cols; c++) {
          const theta = (Math.PI * 2 / cols) * c + sphere.angle;
          const x3d = sphere.radius * Math.sin(phi) * Math.cos(theta);
          const y3d = sphere.radius * Math.cos(phi);
          const z3d = sphere.radius * Math.sin(phi) * Math.sin(theta);
          if (z3d > -30) {
            points.push({
              x: sphere.x + x3d,
              y: sphere.y + y3d,
              opacity: (z3d + sphere.radius) / (sphere.radius * 2),
            });
          }
        }
      }
      points.forEach((pt) => {
        ctx.fillStyle = `rgba(59, 130, 246, ${pt.opacity * 0.4})`;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 1.8, 0, Math.PI * 2);
        ctx.fill();
      });

      particles.forEach((p, idx) => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;

        ctx.fillStyle = 'rgba(59, 130, 246, 0.28)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();

        for (let j = idx + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dx = p.x - p2.x;
          const dy = p.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 130) {
            const alpha = (1 - dist / 130) * 0.16;
            ctx.strokeStyle = `rgba(59, 130, 246, ${alpha})`;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
      });

      animationFrameId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return <canvas ref={canvasRef} className="bottom-particle-canvas" />;
}

function AIBriefRadar({ items = [], excludeIds = [], searchQuery, onSelectTag }) {
  const excludeSet = useMemo(() => new Set(excludeIds), [excludeIds]);
  const briefItems = useMemo(() => {
    return items.filter((it) => !excludeSet.has(it.id)).slice(0, 3);
  }, [items, excludeSet]);

  return (
    <aside className="rail-panel ai-radar-panel">
      <div className="radar-header">
        <div className="radar-title-row">
          <span className="radar-pulse-dot" aria-hidden="true" />
          <h3>AI 实时话题雷达</h3>
          <span className="radar-status-badge">LIVE RADAR</span>
        </div>
        <p className="radar-subtitle">全网实时高频热词 · 点击即时检索</p>
      </div>

      <div className="radar-tags-grid">
        {TREND_TOPICS.map(({ tag, keyword, heat, hot }) => {
          const isActive = searchQuery === keyword;
          return (
            <button
              key={tag}
              type="button"
              className={isActive ? 'radar-tag-chip active' : 'radar-tag-chip'}
              onClick={() => onSelectTag(isActive ? '' : keyword)}
              aria-label={`检索 ${tag}`}
            >
              <span className="tag-name">{tag}</span>
              <span className={hot ? 'tag-heat hot' : 'tag-heat'}>{heat}</span>
            </button>
          );
        })}
      </div>

      {briefItems.length > 0 && (
        <div className="radar-brief-section">
          <div className="brief-section-title">
            <span>核心态势速递</span>
            <span className="brief-count">3 MIN READ</span>
          </div>
          <div className="brief-timeline">
            {briefItems.map((item, idx) => (
              <Link to={`/news/${item.id}`} key={item.id} className="brief-timeline-item">
                <span className="timeline-node" aria-hidden="true">
                  <span className="timeline-dot" />
                  {idx < briefItems.length - 1 && <span className="timeline-line" />}
                </span>
                <div className="brief-timeline-content">
                  <h4>{item.title}</h4>
                  <p>{getSummary(item, 44)}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="ai-insight-section">
        <div className="insight-header">
          <h3>行业前沿洞察</h3>
          <span className="quote-mark">”</span>
        </div>
        <p className="insight-quote">“人工智能不会取代人类，但善于使用AI的人将取代不使用AI的人。”</p>
        <div className="insight-author">—— 吴恩达 (Andrew Ng)</div>
      </div>
    </aside>
  );
}

function HotCard({ items }) {
  const [index, setIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const total = items?.length ?? 0;

  // Clamp index when items array shrinks
  if (index > 0 && index >= total) {
    setIndex(0);
  }

  // Reset on items identity change
  const prevItemsRef = useRef(items);
  useEffect(() => {
    if (prevItemsRef.current !== items) {
      setIndex(0);
      prevItemsRef.current = items;
    }
  }, [items]);

  // Auto switch every 3s, pause if hovered
  useEffect(() => {
    if (total <= 1 || isHovered) return;
    const interval = setInterval(() => {
      setIndex((current) => (current + 1) % total);
    }, 3000);
    return () => clearInterval(interval);
  }, [total, isHovered]);

  if (total === 0) return null;

  const go = (delta) => setIndex((current) => (current + delta + total) % total);
  const goTo = (i) => setIndex(i);
  const item = items[index];

  const handleHotItemClick = () => {
    if (!item) return;
    sessionStorage.setItem('home.lastClickedId', String(item.id));
    sessionStorage.setItem('home.lastScrollY', String(window.scrollY));
  };

  return (
    <section
      className="hot-section"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <header className="hot-header">
        <span className="hot-flame" aria-hidden="true"><Icon name="flame" size={14} /></span>
        <h2>热点</h2>
        <span className="hot-count">{String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}</span>
      </header>

      <div className="hot-carousel">
        <div className="hot-slide" key={item.id}>
          <Link
            to={`/news/${item.id}`}
            onClick={handleHotItemClick}
            className="hot-slide-image"
            aria-label={item.title}
          >
            <ImageWithFallback src={item.imageUrl} alt={item.title} />
          </Link>
          <Link
            to={`/news/${item.id}`}
            onClick={handleHotItemClick}
            className="hot-slide-body"
          >
            <div className="row-meta">
              <span className="chip">{getTopicLabel(item)}</span>
              <span>{formatRelativeTime(item.createdAt)}</span>
              <span className="dot" aria-hidden="true" />
              <span>{getSourceLabel(item)}</span>
            </div>
            <h3>{item.title}</h3>
            <p>{getSummary(item, 160)}</p>
            <div className="hot-card-foot">
              <div className="hot-card-stats">
                <span>{getEngagement(item.id).views} 阅读</span>
                <span>{getEngagement(item.id).comments} 评论</span>
              </div>
              <span className="primary-action">
                <span>阅读全文</span>
                <Icon name="arrow" size={14} />
              </span>
            </div>
          </Link>
        </div>

        <button
          type="button"
          className="hot-nav hot-nav-prev"
          onClick={() => go(-1)}
          aria-label="上一条"
        >
          <Icon name="chevron-left" size={18} />
        </button>
        <button
          type="button"
          className="hot-nav hot-nav-next"
          onClick={() => go(1)}
          aria-label="下一条"
        >
          <Icon name="chevron-right" size={18} />
        </button>
      </div>

      <div className="hot-dots" role="tablist" aria-label="热点分页">
        {items.map((it, i) => (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-label={`第 ${i + 1} 条`}
            className={i === index ? 'hot-dot active' : 'hot-dot'}
            onClick={() => goTo(i)}
          />
        ))}
      </div>
    </section>
  );
}

// ─── AI 早晚报工具函数与组件 ─────────────────────────────────────────
function formatBriefingToClipboard(briefing) {
  if (!briefing) return '';
  const isMorning = briefing.type === 'morning';
  const icon = isMorning ? '🌅' : '🌆';
  const lines = [];
  lines.push(`${icon} ${briefing.title}`);
  lines.push('━━━━━━━━━━━━━━━━━━━━');
  if (briefing.summary) {
    lines.push('💡【今日宏观脉搏】');
    lines.push(briefing.summary);
    lines.push('');
  }
  const sections = briefing.data?.sections || [];
  sections.forEach((sec) => {
    lines.push(`📌【${sec.category || '核心板块'}】`);
    (sec.items || []).forEach((item, iIdx) => {
      const num = String(iIdx + 1).padStart(2, '0');
      lines.push(`${num}. ${item.headline}`);
      if (item.facts) lines.push(`• 事实：${item.facts}`);
      if (item.analysis) lines.push(`• 洞察：${item.analysis}`);
      lines.push('');
    });
  });
  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push('🔗 来源：AI 新闻快讯 · 全球资讯速递 (news.shbya.com)');
  return lines.join('\n');
}

function DailyBriefingSection({ onOpenModal, onToast }) {
  const [pairData, setPairData] = useState({
    todayDate: '',
    layout: 'bento',
    morning: null,
    evening: null
  });
  const [loading, setLoading] = useState(true);
  const [activeSegment, setActiveSegment] = useState('morning');
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  useEffect(() => {
    let isMounted = true;
    axios.get('/api/briefings/pair')
      .then(res => {
        if (isMounted && res.data) {
          setPairData(res.data);
          // 如果当前时间晚于 18:00 且晚报存在，默认展示晚报分段
          const currentHour = new Date().getHours();
          if (currentHour >= 18 && res.data.evening) {
            setActiveSegment('evening');
          } else if (res.data.morning) {
            setActiveSegment('morning');
          } else if (res.data.evening) {
            setActiveSegment('evening');
          }
        }
      })
      .catch(err => {
        console.warn('Failed to load briefing pair:', err.message);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });
    return () => { isMounted = false; };
  }, []);

  const handleCopy = (e, targetBriefing) => {
    e.stopPropagation();
    if (!targetBriefing) return;
    const text = formatBriefingToClipboard(targetBriefing);
    navigator.clipboard.writeText(text).then(() => {
      onToast?.('✓ 已复制早晚报全文（适配微信/小红书格式）');
    });
  };

  // 移动端跳全屏独立页，桌面端开弹窗
  const handleOpenBriefing = (briefingItem) => {
    if (!briefingItem) return;
    if (isMobile) {
      sessionStorage.setItem('home.lastScrollY', String(window.scrollY));
      navigate(`/briefing/${briefingItem.id}`);
    } else {
      onOpenModal(briefingItem);
    }
  };

  if (loading || pairData.enabled === false || (!pairData.morning && !pairData.evening)) return null;

  // 方案 B：双子星 Bento 并列卡片（桌面大屏下并排展示；移动端自动折叠为单模块卡片以节省首屏高度）
  if (pairData.layout === 'bento' && !isMobile) {
    return (
      <section className="briefing-bento-grid" aria-label="AI 科技早晚报双子星速览">
        {/* 早报 Bento 卡片 */}
        <div className={`briefing-bento-card morning ${!pairData.morning ? 'empty-state' : ''}`}>
          <div>
            <div className="briefing-banner-top">
              <span className="briefing-tag-chip">
                <span>🌅</span>
                <span>今日 AI 科技早报</span>
              </span>
              <span className="briefing-meta-text">
                {pairData.morning ? `${pairData.morning.date} · 涵盖 ${pairData.morning.articleCount || 0} 篇要闻` : '08:00 发行'}
              </span>
            </div>

            <div className="briefing-title">
              {pairData.morning ? pairData.morning.title : `${pairData.todayDate || '今日'} · AI 科技早报`}
            </div>

            <div className="briefing-summary-preview">
              {pairData.morning
                ? pairData.morning.summary
                : '早报将在每日早晨 08:00 自动聚合前夜未读核心热点资讯。管理员也可在控制台随时手动触发生成。'}
            </div>
          </div>

          <div className="briefing-banner-actions">
            {pairData.morning ? (
              <>
                <button
                  type="button"
                  className="briefing-btn-primary"
                  style={{ background: '#f59e0b' }}
                  onClick={() => handleOpenBriefing(pairData.morning)}
                >
                  <span>⚡ 晨报速读</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="briefing-btn-outline"
                  onClick={(e) => handleCopy(e, pairData.morning)}
                >
                  <span>📋 复制速报</span>
                </button>
              </>
            ) : (
              <span style={{ fontSize: '12px', color: 'var(--label-tertiary)' }}>○ 晨间 08:00 准时提炼</span>
            )}
          </div>
        </div>

        {/* 晚报 Bento 卡片 */}
        <div className={`briefing-bento-card evening ${!pairData.evening ? 'empty-state' : ''}`}>
          <div>
            <div className="briefing-banner-top">
              <span className="briefing-tag-chip">
                <span>🌆</span>
                <span>{pairData.evening?.date && pairData.evening.date < pairData.todayDate ? '昨夜 AI 焦点晚报' : '今日 AI 焦点晚报'}</span>
              </span>
              <span className="briefing-meta-text">
                {pairData.evening ? `${pairData.evening.date} · 涵盖 ${pairData.evening.articleCount || 0} 篇要闻` : '20:00 发行'}
              </span>
            </div>

            <div className="briefing-title">
              {pairData.evening ? pairData.evening.title : `${pairData.todayDate || '今日'} · AI 焦点晚报`}
            </div>

            <div className="briefing-summary-preview">
              {pairData.evening
                ? pairData.evening.summary
                : '晚报将在每日晚上 20:00 自动复盘白天全球科技前沿重大热点。管理员也可在控制台随时手动触发生成。'}
            </div>
          </div>

          <div className="briefing-banner-actions">
            {pairData.evening ? (
              <>
                <button
                  type="button"
                  className="briefing-btn-primary"
                  style={{ background: '#8b5cf6' }}
                  onClick={() => handleOpenBriefing(pairData.evening)}
                >
                  <span>⚡ 晚报速读</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="briefing-btn-outline"
                  onClick={(e) => handleCopy(e, pairData.evening)}
                >
                  <span>📋 复制速报</span>
                </button>
              </>
            ) : (
              <span style={{ fontSize: '12px', color: 'var(--label-tertiary)' }}>○ 晚间 20:00 准时提炼</span>
            )}
          </div>
        </div>
      </section>
    );
  }

  // 方案 A：双态分段流体卡片
  const activeBriefing = activeSegment === 'morning' ? pairData.morning : pairData.evening;
  const isMorning = activeSegment === 'morning';
  const tagClass = isMorning ? 'morning' : 'evening';

  return (
    <div className={`briefing-banner ${tagClass}`} role="region" aria-label="AI 科技早晚报速览">
      <div className="briefing-banner-top">
        {/* iOS 风格分段切换器 */}
        <div className="briefing-segmented-controls" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={isMorning}
            className={`briefing-segment-btn ${isMorning ? 'active morning' : ''}`}
            onClick={() => setActiveSegment('morning')}
          >
            <span>🌅 今日科技早报</span>
            {pairData.morning && <span style={{ fontSize: '11px', opacity: 0.85 }}>●</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={!isMorning}
            className={`briefing-segment-btn ${!isMorning ? 'active evening' : ''}`}
            onClick={() => setActiveSegment('evening')}
          >
            <span>{pairData.evening?.date && pairData.evening.date < pairData.todayDate ? '🌆 昨夜焦点晚报' : '🌆 今日焦点晚报'}</span>
            {pairData.evening && <span style={{ fontSize: '11px', opacity: 0.85 }}>●</span>}
          </button>
        </div>

        <span className="briefing-meta-text">
          {activeBriefing ? `${activeBriefing.date} · 涵盖 ${activeBriefing.articleCount || 0} 篇深度要闻` : (isMorning ? '08:00 自动发行' : '20:00 自动发行')}
        </span>
      </div>

      <div className="briefing-title">
        {activeBriefing ? activeBriefing.title : `${pairData.todayDate || '今日'} · AI ${isMorning ? '科技早报 (待生成)' : '焦点晚报 (待生成)'}`}
      </div>

      <div className="briefing-summary-preview">
        {activeBriefing
          ? activeBriefing.summary
          : (isMorning
              ? '今日早报将在 08:00 自动提炼前夜未读新闻。您也可以在管理后台随时手动点击生成。'
              : '今日晚报将在 20:00 自动复盘白天全网科技热点。您也可以在管理后台随时手动点击生成。')}
      </div>

      <div className="briefing-banner-actions">
        {activeBriefing ? (
          <>
            <button
              type="button"
              className="briefing-btn-primary"
              style={{ background: isMorning ? '#f59e0b' : '#8b5cf6' }}
              onClick={() => handleOpenBriefing(activeBriefing)}
            >
              <span>⚡ {isMorning ? '晨报沉浸速读' : '晚报沉浸速读'}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
            <button
              type="button"
              className="briefing-btn-outline"
              onClick={(e) => handleCopy(e, activeBriefing)}
            >
              <span>📋 复制速报</span>
            </button>
          </>
        ) : (
          <span style={{ fontSize: '12.5px', color: 'var(--label-tertiary)' }}>
            ○ 尚未生成（定时任务将在 {isMorning ? '08:00' : '20:00'} 自动触发）
          </span>
        )}
      </div>
    </div>
  );
}

function DailyBriefingModal({ briefing, onClose, onToast }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!briefing) return null;

  const isMorning = briefing.type === 'morning';
  const icon = isMorning ? '🌅' : '🌆';
  const accentTheme = isMorning ? 'morning' : 'evening';
  const sections = briefing.data?.sections || [];

  const handleCopy = () => {
    const text = formatBriefingToClipboard(briefing);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      onToast?.('✓ 已复制早晚报全文（适配微信/小红书格式）');
      setTimeout(() => setCopied(false), 2400);
    });
  };

  return (
    <div className="briefing-modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className={`briefing-modal-card ${accentTheme}`} onClick={(e) => e.stopPropagation()}>
        {/* Editorial Masthead */}
        <div className="briefing-modal-header">
          <div className="briefing-masthead">
            <div className="briefing-masthead-stamp">
              GLOBAL AI CHRONICLE · {isMorning ? 'MORNING EDITION' : 'EVENING RECAP'}
            </div>
            <div className="briefing-modal-title">
              <span>{icon}</span>
              <span>{briefing.title}</span>
            </div>
            <div className="briefing-badges-row">
              <span className={`editorial-pill ${accentTheme}`}>
                {isMorning ? '🌅 科技晨报' : '🌆 焦点晚报'}
              </span>
              <span className="editorial-pill neutral">
                📅 {briefing.date}
              </span>
              <span className="editorial-pill neutral">
                📰 精炼 {briefing.articleCount || 0} 篇热点
              </span>
              <span className="editorial-pill neutral">
                ⏱️ 约 3 分钟速览
              </span>
              <span className="editorial-pill ai-tag">
                ✦ AI 旗舰模型提炼
              </span>
            </div>
          </div>
          <button
            type="button"
            className="briefing-modal-close-btn"
            onClick={onClose}
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {/* Editorial Body */}
        <div className="briefing-modal-body">
          {/* 宏观脉搏：高规格编者寄语框 */}
          {briefing.summary && (
            <div className={`briefing-macro-quote-box ${accentTheme}`}>
              <div className="quote-mark" aria-hidden="true">“</div>
              <div className="briefing-macro-header">
                <span>✦ 今日宏观洞察 · GLOBAL PULSE</span>
              </div>
              <div className="briefing-macro-content">
                {briefing.summary}
              </div>
            </div>
          )}

          {/* 深度分栏热点 */}
          {sections.map((sec, sIdx) => (
            <div key={sec.category || sIdx} className="briefing-editorial-section">
              <div className="briefing-section-mast">
                <span className="section-symbol">{isMorning ? '⚡' : '🔮'}</span>
                <span className="section-category-name">{sec.category || '核心热点'}</span>
                <div className="section-divider-line" />
              </div>

              <div className="briefing-stream-list">
                {(sec.items || []).map((it, iIdx) => (
                  <article key={it.id || iIdx} className="briefing-stream-item">
                    <div className="item-num-col">
                      <span className={`stream-idx ${accentTheme}`}>
                        {String(iIdx + 1).padStart(2, '0')}
                      </span>
                    </div>

                    <div className="item-body-col">
                      <h4 className="stream-headline">{it.headline}</h4>

                      {it.facts && (
                        <p className="stream-facts">{it.facts}</p>
                      )}

                      {it.analysis && (
                        <div className={`stream-insight-bubble ${accentTheme}`}>
                          <span className="insight-tag">✦ 深度洞察</span>
                          <span className="insight-text">{it.analysis}</span>
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="briefing-modal-footer">
          <button
            type="button"
            className="briefing-btn-primary"
            onClick={handleCopy}
            style={{ background: copied ? '#10b981' : (isMorning ? '#f59e0b' : '#8b5cf6') }}
          >
            <span>{copied ? '✓ 已成功复制到剪贴板' : '📋 复制微信 / 小红书格式'}</span>
          </button>
          <button
            type="button"
            className="briefing-btn-outline"
            onClick={onClose}
          >
            关闭阅读
          </button>
        </div>
      </div>
    </div>
  );
}

function HomePage({
  newsData,
  loading,
  loadingMore,
  loadMoreMobile,
  searchQuery,
  setSearchQuery,
  currentPage,
  setCurrentPage,
  activeTopic,
  setActiveTopic,
  activeNav,
  setActiveNav,
}) {
  const [savedItems, setSavedItems] = useState(() => {
    try {
      const raw = localStorage.getItem('user_saved_news');
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });

  const [selectedBriefing, setSelectedBriefing] = useState(null);
  const [toastMessage, setToastMessage] = useState('');
  const toastTimeoutRef = useRef(null);

  const triggerToast = useCallback((msg) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage(msg);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage('');
    }, 3200);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('user_saved_news', JSON.stringify(Array.from(savedItems)));
    } catch {}
  }, [savedItems]);

  const loadTriggerRef = useRef(null);
  const isMobile = useIsMobile();

  const rawItems = newsData.items || [];
  const displayNews = useMemo(() => {
    if (activeTopic === 'saved') {
      return rawItems.filter((item) => savedItems.has(item.id));
    }
    return rawItems;
  }, [rawItems, activeTopic, savedItems]);

  // 综合热点内容流（基于发布时效衰减 + 阅读量 + 评论数多维加权裁决）
  const hotNews = useMemo(() => {
    if (!displayNews || displayNews.length === 0) return [];
    // 从候选新闻池（前 30 条近况资讯）中按综合热度分降序排序，精选 Top 5 热点
    const candidatePool = displayNews.slice(0, 30);
    return [...candidatePool]
      .sort((a, b) => calculateHotScore(b) - calculateHotScore(a))
      .slice(0, 5);
  }, [displayNews]);

  const totalCount = activeTopic === 'saved' ? displayNews.length : (newsData.total || 0);
  const totalPages = activeTopic === 'saved' ? Math.max(1, Math.ceil(displayNews.length / PAGE_SIZE)) : (newsData.totalPages || 1);
  const hasMoreMobile = currentPage < totalPages;

  // 恢复从详情页返回时的阅读锚点与滚动位置（零滚动动画，瞬时就位）
  const restoredAnchorRef = useRef(false);
  useEffect(() => {
    if (loading || displayNews.length === 0 || restoredAnchorRef.current) return;

    const lastClickedId = sessionStorage.getItem('home.lastClickedId');
    const lastScrollY = sessionStorage.getItem('home.lastScrollY');

    if (lastClickedId || lastScrollY) {
      restoredAnchorRef.current = true;

      // 1. 瞬时恢复离开时的绝对滚动位置（杜绝平滑滚动动画，确保视口第一帧就位）
      if (lastScrollY) {
        window.scrollTo({ top: Number(lastScrollY), left: 0, behavior: 'instant' });
      }

      // 2. 借助 requestAnimationFrame 在渲染帧对焦目标卡片并施加呼吸微光
      requestAnimationFrame(() => {
        if (lastClickedId) {
          const targetEl = document.getElementById(`news-item-${lastClickedId}`);
          if (targetEl) {
            // 若因异步渲染或屏幕微调导致目标卡片完全不在视口内，才进行就近静默纳入（block: 'nearest'，避免暴力居中抽拉）
            const rect = targetEl.getBoundingClientRect();
            if (rect.bottom < 0 || rect.top > window.innerHeight) {
              targetEl.scrollIntoView({ behavior: 'instant', block: 'nearest' });
            }
            // 局部微光聚焦提示
            targetEl.classList.add('brief-anchor-highlight');
            setTimeout(() => targetEl.classList.remove('brief-anchor-highlight'), 1800);
          }
        }
      });

      sessionStorage.removeItem('home.lastClickedId');
      sessionStorage.removeItem('home.lastScrollY');
    }
  }, [loading, displayNews]);

  // 持久化用户当前的筛选状态与分页位置
  useEffect(() => {
    sessionStorage.setItem('home.activeNav', activeNav);
  }, [activeNav]);
  useEffect(() => {
    sessionStorage.setItem('home.activeTopic', activeTopic);
  }, [activeTopic]);
  useEffect(() => {
    sessionStorage.setItem('home.currentPage', String(currentPage));
  }, [currentPage]);

  // 移动端滚动到底部自动加载下一页
  useEffect(() => {
    if (!isMobile) return undefined;
    const target = loadTriggerRef.current;
    if (!target || loadingMore || !hasMoreMobile) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          loadMoreMobile();
        }
      },
      { rootMargin: '260px' }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [isMobile, loadingMore, hasMoreMobile, loadMoreMobile]);

  const handleNavChange = useCallback((navId) => {
    setActiveNav(navId);
    const topic = NAV_TO_TOPIC[navId];
    setActiveTopic(topic ?? 'all');
    setCurrentPage(1);
  }, [setActiveNav, setActiveTopic, setCurrentPage]);

  const handleSearchQueryChange = useCallback((value) => {
    setCurrentPage(1);
    setSearchQuery(value);
  }, [setCurrentPage, setSearchQuery]);

  const handleTopicChange = useCallback((topic) => {
    setCurrentPage(1);
    setActiveTopic(topic);
  }, [setCurrentPage, setActiveTopic]);

  const lastUpdated = displayNews[0]?.createdAt ? formatDate(displayNews[0].createdAt, 'full') : '今日';

  const [showBackToTop, setShowBackToTop] = useState(false);

  useEffect(() => {
    const handleWindowScroll = () => {
      setShowBackToTop(window.scrollY > 420);
    };
    window.addEventListener('scroll', handleWindowScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleWindowScroll);
  }, []);

  const toggleSave = useCallback((id) => {
    setSavedItems((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handlePageChange = (page) => {
    setCurrentPage(page);
    const feedElement = document.getElementById('feed');
    if (feedElement) {
      feedElement.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="app-shell">
      <ParticleNetworkBg />
      <GlobalNav
        searchQuery={searchQuery}
        setSearchQuery={handleSearchQueryChange}
        activeNav={activeNav}
        setActiveNav={handleNavChange}
      />

      <main className="page-frame" id="top">
        <div className="live-bar" role="status" aria-label="实时资讯更新状态">
          <div className="live-bar-left">
            <span className="live-dot" aria-hidden="true" />
            <span className="live-tag">实时追踪</span>
          </div>
          <div className="live-count-pill live-meta">
            <span>已收录</span>
            <strong className="live-count-highlight">{totalCount}</strong>
            <span>条深度要闻</span>
          </div>
        </div>

        <section className="content-grid" id="feed">
          <div className="left-col">
            {!searchQuery && activeTopic !== 'saved' && (
              <DailyBriefingSection onOpenModal={setSelectedBriefing} onToast={triggerToast} />
            )}

            {!searchQuery && activeTopic !== 'saved' && hotNews.length > 0 && (
              <HotCard items={hotNews} />
            )}

            {isMobile && !searchQuery && activeTopic !== 'saved' && (
              <div className="mobile-trend-strip" aria-label="移动端热门话题雷达">
                <div className="mobile-trend-label">
                  <span className="radar-pulse-dot" aria-hidden="true" />
                  <span>热词</span>
                </div>
                <div className="mobile-trend-scroll">
                  {TREND_TOPICS.map(({ tag, keyword, heat, hot }) => (
                    <button
                      key={tag}
                      type="button"
                      className={searchQuery === keyword ? 'mobile-trend-pill active' : 'mobile-trend-pill'}
                      onClick={() => handleSearchQueryChange(searchQuery === keyword ? '' : keyword)}
                    >
                      <span>{tag}</span>
                      <span className={hot ? 'pill-heat hot' : 'pill-heat'}>{heat}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="news-panel">
              <div className="panel-heading news-panel-heading">
                {searchQuery ? (
                  <div className="search-status-bar">
                    <div className="search-status-main">
                      <h2>搜索结果</h2>
                      <span className="search-pill-keyword">“{searchQuery}”</span>
                      <span className="search-count-pill">{totalCount} 条相关</span>
                    </div>
                    <button
                      type="button"
                      className="search-clear-capsule"
                      onClick={() => setSearchQuery('')}
                      aria-label="清除搜索"
                    >
                      <Icon name="x" size={12} />
                      <span>清除搜索</span>
                    </button>
                  </div>
                ) : activeTopic === 'saved' ? (
                  <div className="saved-status-bar">
                    <h2>我的收藏</h2>
                    <span className="saved-count-pill">{savedItems.size} 篇剪藏</span>
                  </div>
                ) : (
                  <div className="feed-heading-title">
                    <span className="feed-pulse-dot" aria-hidden="true" />
                    <h2>最新资讯</h2>
                    <span className="feed-count-pill">{totalCount || newsData.items?.length || 0} 篇要闻</span>
                  </div>
                )}
                <div className="panel-tabs">
                  <TopicTabs
                    activeTopic={activeTopic}
                    setActiveTopic={handleTopicChange}
                    savedCount={savedItems.size}
                  />
                </div>
              </div>

              {loading && displayNews.length === 0 ? (
                <div className="news-list">
                  <NewsSkeletonRow />
                  <NewsSkeletonRow />
                  <NewsSkeletonRow />
                  <NewsSkeletonRow />
                  <NewsSkeletonRow />
                  <NewsSkeletonRow />
                </div>
              ) : activeTopic === 'saved' && displayNews.length === 0 ? (
                <div className="empty-state saved-empty-state">
                  <div className="empty-icon-capsule">
                    <Icon name="bookmark" size={24} />
                  </div>
                  <h2>暂无收藏资讯</h2>
                  <p>在阅读资讯时，点击右侧书签即可将重要内容加入收藏夹。</p>
                  <button
                    type="button"
                    className="primary-action"
                    onClick={() => handleTopicChange('all')}
                  >
                    <span>浏览全部资讯</span>
                    <Icon name="arrow" size={14} />
                  </button>
                </div>
              ) : displayNews.length === 0 ? (
                <div className="empty-state">
                  <h2>没有找到相关资讯</h2>
                  <p>换一个关键词或分类试试。</p>
                  {searchQuery && (
                    <button
                      type="button"
                      className="primary-action"
                      onClick={() => setSearchQuery('')}
                    >
                      <span>清空搜索词</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="news-list">
                  {displayNews.map((item, index) => (
                    <NewsRow
                      key={item.id}
                      item={item}
                      index={index}
                      saved={savedItems.has(item.id)}
                      onToggleSave={toggleSave}
                    />
                  ))}
                </div>
              )}

              {isMobile ? (
                <div className="load-zone mobile-load-zone" ref={loadTriggerRef}>
                  {hasMoreMobile ? (
                    <button className="load-more-button" onClick={loadMoreMobile} disabled={loadingMore} type="button">
                      {loadingMore && <span className="load-spinner" aria-hidden="true" />}
                      <span>{loadingMore ? '正在加载最新资讯...' : '滑动加载更多'}</span>
                    </button>
                  ) : (
                    <div className="feed-end-capsule" role="status" aria-label="已浏览全部资讯">
                      <span className="feed-end-dot" aria-hidden="true">✓</span>
                      <span className="feed-end-text">已读完全部 {totalCount} 条要闻</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="load-zone pc-pagination-zone">
                  <Pagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    onPageChange={handlePageChange}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="right-rail">
            <AIBriefRadar
              items={displayNews}
              excludeIds={hotNews.map((it) => it.id)}
              searchQuery={searchQuery}
              onSelectTag={(tag) => {
                setSearchQuery(tag);
                setCurrentPage(1);
                const feed = document.getElementById('feed');
                if (feed) feed.scrollIntoView({ behavior: 'smooth' });
              }}
            />
          </div>
        </section>

        <footer className="page-footer">
          <div className="page-footer-links">
            <a href="#about">关于我们</a>
            <a href="#contact">联系我们</a>
            <a href="#privacy">隐私政策</a>
            <a href="#terms">使用条款</a>
            <Link to="/admin">后台配置</Link>
          </div>
          <small>© {new Date().getFullYear()} AI 新闻快讯 · 全球 AI 资讯速递平台</small>
        </footer>
      </main>

      {showBackToTop && (
        <button
          type="button"
          className="mobile-back-to-top"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="回到顶部"
        >
          <Icon name="arrow-up" size={14} />
          <span>顶部</span>
        </button>
      )}

      <Toast message={toastMessage} />
      {selectedBriefing && (
        <DailyBriefingModal
          briefing={selectedBriefing}
          onClose={() => setSelectedBriefing(null)}
          onToast={triggerToast}
        />
      )}
    </div>
  );
}

export function NewsDetailPage({ news, searchQuery, setSearchQuery }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const numId = Number(id);
  const item = news.find((entry) => entry.id === numId);
  const bodyRef = useRef(null);
  const mediaRef = useRef(null);
  const progressRef = useRef(null);
  const percentBadgeRef = useRef(null);
  const toastTimeoutRef = useRef(null);
  const [toastMessage, setToastMessage] = useState('');
  const [isScrolled, setIsScrolled] = useState(false);

  // 智能返回：若有历史来源（首页资讯流/早晚报）则精准回退，避免丢弃阅读锚点；否则兜底跳首页
  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  const [fontSize, setFontSize] = useState(() => {
    try {
      return localStorage.getItem('user_reader_font_size') || 'md';
    } catch {
      return 'md';
    }
  });

  const cycleFontSize = useCallback(() => {
    setFontSize((prev) => {
      const next = prev === 'sm' ? 'md' : prev === 'md' ? 'lg' : 'sm';
      try {
        localStorage.setItem('user_reader_font_size', next);
      } catch {}
      triggerToast(next === 'sm' ? '字号：标准紧凑 (16px)' : next === 'md' ? '字号：舒适阅读 (18px)' : '字号：清晰放大 (20px)');
      return next;
    });
  }, []);

  const currentIndex = news.findIndex((entry) => entry.id === numId);
  const nextItem = currentIndex >= 0 && currentIndex < news.length - 1 ? news[currentIndex + 1] : (news[0]?.id !== numId ? news[0] : null);

  const [isSaved, setIsSaved] = useState(() => {
    try {
      const raw = localStorage.getItem('user_saved_news');
      const set = raw ? new Set(JSON.parse(raw)) : new Set();
      return set.has(numId);
    } catch {
      return false;
    }
  });

  const triggerToast = useCallback((msg) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage(msg);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage('');
    }, 3200);
  }, []);

  const toggleSaveCurrent = useCallback(() => {
    try {
      const raw = localStorage.getItem('user_saved_news');
      const set = raw ? new Set(JSON.parse(raw)) : new Set();
      if (set.has(numId)) {
        set.delete(numId);
        setIsSaved(false);
        triggerToast('已从我的收藏移除');
      } else {
        set.add(numId);
        setIsSaved(true);
        triggerToast('✓ 已加入我的收藏');
      }
      localStorage.setItem('user_saved_news', JSON.stringify(Array.from(set)));
    } catch (e) {
      console.warn(e);
    }
  }, [numId, triggerToast]);

  const handleShare = useCallback(() => {
    const shareUrl = window.location.href;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(shareUrl).then(() => {
        triggerToast('✓ 已复制文章链接到剪贴板');
      }).catch(() => {
        triggerToast('链接：' + shareUrl);
      });
    } else {
      triggerToast('链接：' + shareUrl);
    }
  }, [triggerToast]);

  const rawContent = item ? (item.content || item.summary || '') : '';
  const contentHtml = useMemo(() => {
    return marked.parse(rawContent, { breaks: true, gfm: true });
  }, [rawContent]);

  const readingMinutes = useMemo(() => {
    const textLen = (item?.content || item?.summary || '').length;
    return Math.max(1, Math.ceil(textLen / 360));
  }, [item]);

  // AI 核心要点速览计算 (提炼 2~3 个结构化核心事实，提炼精炼短句，避免与正文大面积 verbatim 重复)
  const aiTakeaways = useMemo(() => {
    if (!item) return [];
    const sourceText = item.summary || item.content || '';
    if (!sourceText) return [];
    const parts = sourceText
      .split(/(?<=[。！？；\n])/)
      .map((s) => s.trim().replace(/^[-*•\d.]+\s*/, ''))
      .filter((s) => s.length >= 10);
    if (parts.length >= 2) {
      return parts.slice(0, 3).map((p) => {
        if (p.length > 80) {
          const commaIdx = p.indexOf('，', 55);
          if (commaIdx > 0 && commaIdx < 80) {
            return p.slice(0, commaIdx) + '。';
          }
        }
        return p;
      });
    }
    return [sourceText.slice(0, 120) + (sourceText.length > 120 ? '...' : '')];
  }, [item]);

  // 右侧延伸相关要闻推荐
  const relatedItems = useMemo(() => {
    if (!item || !news || news.length === 0) return [];
    const sameTopic = news.filter((n) => n.id !== numId && n.topic === item.topic);
    const others = news.filter((n) => n.id !== numId && n.topic !== item.topic);
    return [...sameTopic, ...others].slice(0, 3);
  }, [news, item, numId]);

  // 1. 滚动微视差与阅读进度更新 (高性能 RAF 处理，零 React 状态重渲染，杜绝触底回弹闪烁)
  useEffect(() => {
    if (!item) return;

    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          // 视差图层位移 (仅在大屏桌面端执行，移动端跳过以杜绝 GPU 图层重组闪烁)
          if (mediaRef.current && window.innerWidth > 860) {
            const rect = mediaRef.current.getBoundingClientRect();
            const img = mediaRef.current.querySelector('img');
            if (img && rect.top < window.innerHeight && rect.bottom > 0) {
              const totalHeight = window.innerHeight + rect.height;
              const scrollPercent = (window.innerHeight - rect.top) / totalHeight;
              const yPercent = -15 + (scrollPercent * 15);
              img.style.transform = `translate3d(0, ${yPercent}%, 0)`;
            }
          }

          // 实时顶部阅读进度条更新 (DOM Direct update，避免触发 React re-render)
          const docHeight = document.documentElement.scrollHeight - window.innerHeight;
          if (docHeight > 0) {
            const progress = Math.min(1, Math.max(0, window.scrollY / docHeight));
            if (progressRef.current) {
              progressRef.current.style.transform = `scaleX(${progress})`;
            }
            if (percentBadgeRef.current) {
              percentBadgeRef.current.textContent = `${Math.round(progress * 100)}%`;
            }
          }

          // 仅在跨越 200px 阈值变化时触发单次状态更新
          const scrolled = window.scrollY > 200;
          setIsScrolled((prev) => (prev !== scrolled ? scrolled : prev));

          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    setTimeout(handleScroll, 100);

    // 仅在桌面大屏为正文子元素挂载渐显效果；移动端不加 class 避免在触底和滑动中出现文字闪烁
    let observer = null;
    if (window.innerWidth > 860 && bodyRef.current) {
      const children = bodyRef.current.querySelectorAll('.markdown-body > *');
      observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed');
            observer.unobserve(entry.target); // 一旦展现即停止观察，锁定图层
          }
        });
      }, {
        rootMargin: '0px 0px -40px 0px',
        threshold: 0.05
      });

      children.forEach((child) => {
        child.classList.add('reveal-on-scroll');
        observer.observe(child);
      });
    }

    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (observer) {
        observer.disconnect();
      }
    };
  }, [item, contentHtml]);

  if (!item) {
    return (
      <div className="app-shell">
        <GlobalNav searchQuery={searchQuery} setSearchQuery={setSearchQuery} activeNav="today" setActiveNav={() => {}} />
        <main className="detail-shell">
          <div className="empty-state detail-empty">
            <h1>未找到相关资讯</h1>
            <p>这条资讯可能尚未加载，或地址已经变化。</p>
            <Link to="/" className="primary-action">
              返回资讯流
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={`app-shell detail-page-shell font-size-${fontSize}`}>
      <GlobalNav searchQuery={searchQuery} setSearchQuery={setSearchQuery} activeNav="today" setActiveNav={() => {}} />
      <div className="reading-progress-track" aria-hidden="true">
        <div className="reading-progress-bar" ref={progressRef} />
      </div>

      {/* 移动端专属沉浸顶栏 (Mobile Compact Header) */}
      <header className={`mobile-detail-header ${isScrolled ? 'scrolled' : ''}`}>
        <button
          type="button"
          onClick={handleBack}
          className="mobile-header-back"
          aria-label="返回资讯流"
        >
          <Icon name="arrow-left" size={16} />
          <span>资讯</span>
        </button>
        <span className="mobile-header-title">{item.title}</span>
        <div className="mobile-header-actions">
          <button type="button" className="mobile-icon-btn" onClick={handleShare} aria-label="分享文章">
            <Icon name="external" size={15} />
          </button>
        </div>
      </header>

      <main className="detail-shell">
        {/* 核心三列专业杂志舞台 (Desktop 3-Column Stage) */}
        <div className="detail-stage">
          {/* 左侧随动伴侣导轨 (Sticky Companion Rail - Desktop) */}
          <aside className="detail-companion-rail" aria-label="阅读快捷操作">
            <div className="companion-sticky-inner">
              <button
                type="button"
                onClick={handleBack}
                className="companion-action-pill"
                title="返回资讯流"
                aria-label="返回资讯流"
              >
                <Icon name="arrow-left" size={16} />
                <span className="rail-tooltip">返回资讯流</span>
              </button>
              <div className="companion-divider" />
              <button
                type="button"
                className={`companion-action-pill ${isSaved ? 'active' : ''}`}
                onClick={toggleSaveCurrent}
                title={isSaved ? '取消收藏' : '加入收藏'}
                aria-label={isSaved ? '取消收藏' : '加入收藏'}
              >
                <Icon name="bookmark" size={16} filled={isSaved} />
                <span className="rail-tooltip">{isSaved ? '已收藏' : '收藏文章'}</span>
              </button>
              <button
                type="button"
                className="companion-action-pill"
                onClick={cycleFontSize}
                title="调节字号"
                aria-label="调节字号"
              >
                <Icon name="type" size={16} />
                <span className="font-badge">{fontSize === 'sm' ? '小' : fontSize === 'md' ? '中' : '大'}</span>
                <span className="rail-tooltip">字号: {fontSize === 'sm' ? '16px' : fontSize === 'md' ? '18px' : '20px'}</span>
              </button>
              <button
                type="button"
                className="companion-action-pill"
                onClick={handleShare}
                title="分享文章"
                aria-label="分享文章"
              >
                <Icon name="external" size={16} />
                <span className="rail-tooltip">复制分享链接</span>
              </button>
              <div className="companion-divider" />
              <div className="companion-progress-capsule" title="实时阅读进度">
                <span className="progress-value" ref={percentBadgeRef}>0%</span>
              </div>
            </div>
          </aside>

          {/* 中间核心文章主体 */}
          <article className="launch-layout">
            <header className="launch-hero">
              <div className="launch-meta">
                <span className="chip">{getTopicLabel(item)}</span>
                <span className="launch-meta-item">{formatDate(item.createdAt)}</span>
                <span className="dot" aria-hidden="true" />
                <span className="launch-meta-item">{getSourceLabel(item)}</span>
                <span className="dot" aria-hidden="true" />
                <span className="launch-meta-item reading-time-badge">约 {readingMinutes} 分钟阅读</span>
              </div>
              <h1 className="launch-title">{item.title}</h1>
            </header>

            <div className="launch-media" ref={mediaRef}>
              <ImageWithFallback src={item.imageUrl} alt={item.title} />
              <div className="launch-media-overlay" />
            </div>

            {/* AI 核心要点速览胶囊 (TL;DR AI Key Takeaways) */}
            {aiTakeaways.length > 0 && (
              <div className="ai-takeaways-card">
                <div className="ai-takeaways-header">
                  <div className="ai-takeaways-badge">
                    <Icon name="sparkles" size={13} />
                    <span>AI 核心速览 · 30秒掌握</span>
                  </div>
                  <span className="ai-model-tag">Gemini Flash · 语义提炼</span>
                </div>
                <div className="ai-takeaways-list">
                  {aiTakeaways.map((point, idx) => (
                    <div className="ai-takeaway-item" key={idx}>
                      <span className="ai-point-index">0{idx + 1}</span>
                      <p className="ai-point-text">{point}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="article-body-divider-bar">
              <span className="divider-label">资讯正文报道</span>
              <span className="divider-line" />
            </div>

            <div className="launch-body" ref={bodyRef}>
              <div
                className="article-content markdown-body"
                dangerouslySetInnerHTML={{ __html: contentHtml }}
              />

              <footer className="launch-footer">
                <div className="launch-footer-info">
                  <span className="footer-label">本文收录自</span>
                  <span className="footer-source">{getSourceLabel(item)}</span>
                  <span className="footer-notice">本篇资讯经由官方 RSS 聚合抓取与 AI 大模型智能排版呈现，版权归原始发布机构所有。</span>
                </div>
                {item.originalUrl && (
                  <a href={item.originalUrl} target="_blank" rel="noopener noreferrer" className="launch-action-btn">
                    <span>访问官方原文</span>
                    <Icon name="external" size={13} />
                  </a>
                )}
              </footer>

              {nextItem && (
                <div className="up-next-section">
                  <div className="up-next-header">
                    <span className="up-next-label">下一篇连读</span>
                    <span className="up-next-sub">UP NEXT</span>
                  </div>
                  <Link to={`/news/${nextItem.id}`} className="up-next-card">
                    <div className="up-next-media">
                      <ImageWithFallback src={nextItem.imageUrl} alt={nextItem.title} />
                    </div>
                    <div className="up-next-body">
                      <div className="row-meta">
                        <span className="chip">{getTopicLabel(nextItem)}</span>
                        <span>{getSourceLabel(nextItem)}</span>
                        <span className="dot" aria-hidden="true" />
                        <span>{formatRelativeTime(nextItem.createdAt)}</span>
                      </div>
                      <h4>{nextItem.title}</h4>
                      <p>{getSummary(nextItem, 68)}</p>
                      <span className="up-next-cta">
                        <span>继续阅读</span>
                        <Icon name="arrow" size={13} />
                      </span>
                    </div>
                  </Link>
                </div>
              )}
            </div>
          </article>

          {/* 右侧上下文推荐栏 (Sticky Right Context Rail - Desktop) */}
          <aside className="detail-context-rail" aria-label="相关延伸资讯">
            <div className="context-sticky-inner">
              <div className="context-rail-heading">
                <span className="context-pulse-dot" />
                <span>相关要闻推荐</span>
                <span className="context-sub">RELATED</span>
              </div>
              <div className="context-list">
                {relatedItems.map((rel) => (
                  <Link to={`/news/${rel.id}`} key={rel.id} className="context-card">
                    <span className="context-card-topic">{getTopicLabel(rel)}</span>
                    <h4 className="context-card-title">{rel.title}</h4>
                    <div className="context-card-foot">
                      <span>{getSourceLabel(rel)}</span>
                      <span className="dot" aria-hidden="true" />
                      <span>{formatRelativeTime(rel.createdAt)}</span>
                    </div>
                  </Link>
                ))}
              </div>

              {/* 来源机构认证与可信度模块 */}
              <div className="source-trust-box">
                <div className="trust-head">
                  <span className="trust-badge">权威源认证</span>
                  <span className="trust-source-name">{getSourceLabel(item)}</span>
                </div>
                <p className="trust-desc">
                  本站聚合来自全球顶尖科技媒体与 AI 实验室的实时动态，提供结构化快讯与精准研判。
                </p>
                {item.originalUrl && (
                  <a href={item.originalUrl} target="_blank" rel="noopener noreferrer" className="trust-link">
                    <span>阅读官方出处</span>
                    <Icon name="external" size={12} />
                  </a>
                )}
              </div>
            </div>
          </aside>
        </div>
      </main>

      {/* 移动端专属浮动底部操作底栏 (Mobile Floating Bottom Action Bar) */}
      <nav className="mobile-bottom-bar" aria-label="移动端底部操作">
        <button
          type="button"
          onClick={handleBack}
          className="mobile-bar-btn"
          aria-label="返回资讯流"
        >
          <Icon name="arrow-left" size={18} />
          <span>返回</span>
        </button>
        <button
          type="button"
          className={`mobile-bar-btn ${isSaved ? 'active' : ''}`}
          onClick={toggleSaveCurrent}
          aria-label={isSaved ? '取消收藏' : '收藏'}
        >
          <Icon name="bookmark" size={18} filled={isSaved} />
          <span>{isSaved ? '已收藏' : '收藏'}</span>
        </button>
        <button
          type="button"
          className="mobile-bar-btn"
          onClick={cycleFontSize}
          aria-label="调节字号"
        >
          <Icon name="type" size={18} />
          <span>{fontSize === 'sm' ? '小字' : fontSize === 'md' ? '标准' : '大字'}</span>
        </button>
        <button
          type="button"
          className="mobile-bar-btn"
          onClick={handleShare}
          aria-label="分享"
        >
          <Icon name="external" size={18} />
          <span>分享</span>
        </button>
        {item.originalUrl && (
          <a
            href={item.originalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mobile-bar-btn origin-tag"
            aria-label="查看官方原文"
          >
            <span className="mobile-origin-capsule">原文</span>
          </a>
        )}
      </nav>

      <Toast message={toastMessage} />
    </div>
  );
}

// ─── 移动端独立全屏早晚报页面 (Mobile Fullscreen Page) ──────────────
export function DailyBriefingPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [briefing, setBriefing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const toastTimeoutRef = useRef(null);

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  const triggerToast = useCallback((msg) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage(msg);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage('');
    }, 2800);
  }, []);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError('');
    axios.get(`/api/briefings/${id}`)
      .then((res) => {
        if (isMounted) {
          setBriefing(res.data);
          document.title = `${res.data.title} - AI 新闻快讯`;
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err.response?.data?.error || '获取早晚报失败，该内容可能已归档或不存在');
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });
    return () => { isMounted = false; };
  }, [id]);

  const handleCopy = () => {
    if (!briefing) return;
    const text = formatBriefingToClipboard(briefing);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      triggerToast('✓ 已复制早晚报全文（适配微信/小红书格式）');
      setTimeout(() => setCopied(false), 2400);
    });
  };

  if (loading) {
    return (
      <div className="briefing-page-shell">
        <header className="briefing-page-header">
          <button type="button" onClick={handleBack} className="briefing-header-back" aria-label="返回资讯流">
            <Icon name="arrow-left" size={16} />
            <span>资讯流</span>
          </button>
          <span className="briefing-header-title">正在加载早晚报...</span>
        </header>
        <main className="briefing-page-container">
          <div className="admin-loading" style={{ marginTop: '60px' }}>
            正在加载早晚报深度内容...
          </div>
        </main>
      </div>
    );
  }

  if (error || !briefing) {
    return (
      <div className="briefing-page-shell">
        <header className="briefing-page-header">
          <button type="button" onClick={handleBack} className="briefing-header-back" aria-label="返回资讯流">
            <Icon name="arrow-left" size={16} />
            <span>资讯流</span>
          </button>
        </header>
        <main className="briefing-page-container">
          <div className="empty-state" style={{ marginTop: '80px', textAlign: 'center' }}>
            <h2>未找到相关早晚报</h2>
            <p style={{ color: 'var(--label-secondary)', marginTop: '8px' }}>{error || '该期早晚报可能尚未生成或链接已失效'}</p>
            <Link to="/" className="admin-btn primary-btn" style={{ marginTop: '20px', display: 'inline-flex' }}>
              返回新闻首页
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const isMorning = briefing.type === 'morning';
  const icon = isMorning ? '🌅' : '🌆';
  const accentTheme = isMorning ? 'morning' : 'evening';
  const sections = briefing.data?.sections || [];

  return (
    <div className={`briefing-page-shell ${accentTheme}`}>
      {/* 顶部极简毛玻璃顶栏 (全屏沉浸) */}
      <header className="briefing-page-header">
        <button type="button" onClick={handleBack} className="briefing-header-back" aria-label="返回资讯流">
          <Icon name="arrow-left" size={16} />
          <span>资讯流</span>
        </button>
        <span className="briefing-header-title">
          {icon} {briefing.date} {isMorning ? 'AI 晨报' : 'AI 晚报'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="briefing-header-copy-btn"
          aria-label="复制全文"
        >
          <span>{copied ? '已复制' : '复制'}</span>
        </button>
      </header>

      {/* 正文满幅舒展排版 */}
      <main className="briefing-page-container">
        {/* 报头 */}
        <div className="briefing-masthead" style={{ marginTop: '10px' }}>
          <div className="briefing-masthead-stamp">
            GLOBAL AI CHRONICLE · {isMorning ? 'MORNING EDITION' : 'EVENING RECAP'}
          </div>
          <h1 className="briefing-page-main-title">
            <span>{icon}</span>
            <span>{briefing.title}</span>
          </h1>
          <div className="briefing-badges-row" style={{ marginTop: '8px' }}>
            <span className={`editorial-pill ${accentTheme}`}>
              {isMorning ? '🌅 科技晨报' : '🌆 焦点晚报'}
            </span>
            <span className="editorial-pill neutral">
              📅 {briefing.date}
            </span>
            <span className="editorial-pill neutral">
              📰 精炼 {briefing.articleCount || 0} 篇热点
            </span>
            <span className="editorial-pill neutral">
              ⏱️ 约 3 分钟速读
            </span>
            <span className="editorial-pill ai-tag">
              ✦ AI 旗舰模型提炼
            </span>
          </div>
        </div>

        {/* 宏观脉搏：高阶编者寄语金句框 */}
        {briefing.summary && (
          <div className={`briefing-macro-quote-box ${accentTheme}`} style={{ marginTop: '24px' }}>
            <div className="quote-mark" aria-hidden="true">“</div>
            <div className="briefing-macro-header">
              <span>✦ 今日宏观洞察 · GLOBAL PULSE</span>
            </div>
            <div className="briefing-macro-content">
              {briefing.summary}
            </div>
          </div>
        )}

        {/* 深度分栏热点 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', marginTop: '28px' }}>
          {sections.map((sec, sIdx) => (
            <div key={sec.category || sIdx} className="briefing-editorial-section">
              <div className="briefing-section-mast">
                <span className="section-symbol">{isMorning ? '⚡' : '🔮'}</span>
                <span className="section-category-name">{sec.category || '核心热点'}</span>
                <div className="section-divider-line" />
              </div>

              <div className="briefing-stream-list">
                {(sec.items || []).map((it, iIdx) => (
                  <article key={it.id || iIdx} className="briefing-stream-item">
                    <div className="item-num-col">
                      <span className={`stream-idx ${accentTheme}`}>
                        {String(iIdx + 1).padStart(2, '0')}
                      </span>
                    </div>

                    <div className="item-body-col">
                      <h4 className="stream-headline">{it.headline}</h4>

                      {it.facts && (
                        <p className="stream-facts">{it.facts}</p>
                      )}

                      {it.analysis && (
                        <div className={`stream-insight-bubble ${accentTheme}`}>
                          <span className="insight-tag">✦ 深度洞察</span>
                          <span className="insight-text">{it.analysis}</span>
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* 移动端专属浮动底部操作底栏 */}
      <nav className="briefing-page-bottom-bar" aria-label="页面操作底栏">
        <button
          type="button"
          onClick={handleCopy}
          className="briefing-page-action-btn primary"
          style={{ background: copied ? '#10b981' : (isMorning ? '#f59e0b' : '#8b5cf6') }}
        >
          <span>{copied ? '✓ 已复制到剪贴板' : '📋 复制微信 / 小红书格式'}</span>
        </button>
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="briefing-page-action-btn"
        >
          <span>🔝 回到顶部</span>
        </button>
      </nav>

      <Toast message={toastMessage} />
    </div>
  );
}

// ─── 预设候选模型列表 ─────────────────────────────────────────────
const CHAT_MODEL_PRESETS = [
  { value: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash High', provider: 'Google', badge: '系统推荐', desc: '最新旗舰高速推理，极高性价比与高翻译质量' },
  { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite', provider: 'Google', badge: '极速低延迟', desc: '极速响应轻量模型，适合快速导读生成' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'Google', desc: '经典高速通用模型' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'Google', desc: '高智力深度推理，适合长文本技术分析' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'OpenAI', badge: '热门', desc: '兼顾速度与智能度的全能性价比模型' },
  { value: 'gpt-4o', label: 'GPT-4o', provider: 'OpenAI', desc: 'OpenAI 旗舰全能多模态模型' },
  { value: 'o3-mini', label: 'o3-mini', provider: 'OpenAI', desc: '最新强化推理小型模型' },
  { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku', provider: 'Anthropic', badge: '快速', desc: '语言自然流畅，极速输出' },
  { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet', provider: 'Anthropic', desc: '顶级修辞水准与长篇科技新闻专业转译' },
  { value: 'deepseek-chat', label: 'DeepSeek-V3', provider: 'DeepSeek', desc: '开源高智力通用大模型' },
];

const IMAGE_MODEL_PRESETS = [
  { value: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash Image', provider: 'Google', badge: '系统推荐', desc: '官方原生新闻绘图模型，出图迅速' },
  { value: 'gpt-image-2', label: 'GPT Image 2', provider: 'OpenAI 兼容', badge: '热门', desc: '现代概念科技插画风，高保真' },
  { value: 'gpt-image-1.5', label: 'GPT Image 1.5', provider: 'OpenAI 兼容', desc: '稳定性强的商业与新闻配图模型' },
  { value: 'dall-e-3', label: 'DALL·E 3', provider: 'OpenAI', desc: '顶尖画面构图与细节表现力' },
  { value: 'imagen-3.0-generate-002', label: 'Imagen 3', provider: 'Google', desc: '写实与概念数字艺术创作' },
  { value: 'flux-schnell', label: 'Flux Schnell', provider: 'Black Forest', badge: '极速', desc: '新一代高速开源文生图模型' },
];

// ─── 通用 Combobox 组件：模糊匹配搜索 + 下拉选择 + 自由手填 ──────────
function ModelCombobox({ value, onChange, options, placeholder, required = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const wrapperRef = useRef(null);

  // 点击组件外部自动收起下拉面板
  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 模糊搜索：支持对模型名、标签、厂商、描述进行不区分大小写匹配
  const filtered = useMemo(() => {
    const q = (filterQuery || '').trim().toLowerCase();
    if (!q) return options;
    return options.filter((opt) =>
      opt.value.toLowerCase().includes(q) ||
      (opt.label && opt.label.toLowerCase().includes(q)) ||
      (opt.provider && opt.provider.toLowerCase().includes(q)) ||
      (opt.desc && opt.desc.toLowerCase().includes(q))
    );
  }, [options, filterQuery]);

  const handleInputChange = (e) => {
    const val = e.target.value;
    onChange(val);
    setFilterQuery(val);
    if (!isOpen) setIsOpen(true);
  };

  const handleSelectOption = (optValue) => {
    onChange(optValue);
    setFilterQuery('');
    setIsOpen(false);
  };

  return (
    <div className="combobox-wrapper" ref={wrapperRef}>
      <div className="combobox-input-shell">
        <input
          type="text"
          value={value}
          onChange={handleInputChange}
          onFocus={() => {
            setFilterQuery('');
            setIsOpen(true);
          }}
          placeholder={placeholder}
          required={required}
          className="combobox-input"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="切换下拉菜单"
          className={`combobox-chevron-btn ${isOpen ? 'open' : ''}`}
          onClick={() => setIsOpen(!isOpen)}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      {isOpen && (
        <div className="combobox-dropdown-menu">
          {filtered.length > 0 ? (
            filtered.map((opt) => (
              <div
                key={opt.value}
                className={`combobox-item ${opt.value === value ? 'selected' : ''}`}
                onClick={() => handleSelectOption(opt.value)}
              >
                <div className="combobox-item-title-row">
                  <span className="combobox-item-value">{opt.value}</span>
                  {opt.badge && <span className="combobox-badge">{opt.badge}</span>}
                  {opt.provider && <span className="combobox-provider">{opt.provider}</span>}
                </div>
                {opt.desc && <div className="combobox-item-desc">{opt.desc}</div>}
              </div>
            ))
          ) : (
            <div className="combobox-empty-tip">
              未匹配到预设模型。回车或保存将直接使用自定义模型：
              <div className="combobox-custom-val">"{value}"</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Admin 子页面组件：AI 模型与凭据管理 ─────────────────────────
function AdminModelsTab({ onAuthError }) {
  const [config, setConfig] = useState({
    ANTHROPIC_BASE_URL: '',
    ANTHROPIC_AUTH_TOKEN: '',
    GEMINI_CHAT_MODEL: '',
    GEMINI_IMAGE_MODEL: '',
    FALLBACK_IMAGE_MODELS: '',
  });
  const [loading, setLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [showToken, setShowToken] = useState(false);

  // 连通性测试状态
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const fetchConfig = useCallback(async () => {
    const token = localStorage.getItem('admin_token');
    if (!token) return;
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await axios.get('/api/admin/models', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setConfig(res.data);
    } catch (err) {
      console.error(err);
      if (err.response?.status === 401 || err.response?.status === 403) {
        onAuthError?.();
        return;
      }
      setErrorMsg(err.response?.data?.error || '拉取模型配置失败');
    } finally {
      setLoading(false);
    }
  }, [onAuthError]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSuccessMsg('');
    setErrorMsg('');
    setSaveLoading(true);
    const token = localStorage.getItem('admin_token');
    try {
      await axios.post('/api/admin/models', config, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSuccessMsg('AI 模型配置保存成功！');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        onAuthError?.();
        return;
      }
      setErrorMsg(err.response?.data?.error || '保存模型配置失败');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleTestConnection = async () => {
    setTestLoading(true);
    setTestResult(null);
    const token = localStorage.getItem('admin_token');
    try {
      const res = await axios.post('/api/admin/models/test', {
        baseUrl: config.ANTHROPIC_BASE_URL,
        authToken: config.ANTHROPIC_AUTH_TOKEN,
        chatModel: config.GEMINI_CHAT_MODEL
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setTestResult({
        success: true,
        latencyMs: res.data.latencyMs,
        message: `API 连通性正常！响应延迟: ${res.data.latencyMs}ms，模型返回: "${res.data.reply}"`
      });
    } catch (err) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        onAuthError?.();
        return;
      }
      setTestResult({
        success: false,
        latencyMs: err.response?.data?.latencyMs,
        message: err.response?.data?.error || err.message || 'API 连通性测试失败'
      });
    } finally {
      setTestLoading(false);
    }
  };

  if (loading) {
    return <div className="admin-loading">正在拉取模型配置...</div>;
  }

  return (
    <form onSubmit={handleSave} className="admin-config-form">
      {successMsg && <div className="toast-success">{successMsg}</div>}
      {errorMsg && <div className="toast-error">{errorMsg}</div>}

      <div className="form-section">
        <h3>1. API 与授权凭证</h3>
        <div className="form-group">
          <label>
            API 请求 Base URL
            <span className="tooltip-info">（API 代理或官方直连地址）</span>
          </label>
          <input
            type="text"
            value={config.ANTHROPIC_BASE_URL}
            onChange={(e) => setConfig({ ...config, ANTHROPIC_BASE_URL: e.target.value })}
            placeholder="例如 https://api.example.com"
            required
          />
        </div>

        <div className="form-group">
          <label>API Key / 授权令牌 (sk-)</label>
          <div className="password-input-wrapper">
            <input
              type={showToken ? 'text' : 'password'}
              value={config.ANTHROPIC_AUTH_TOKEN}
              onChange={(e) => setConfig({ ...config, ANTHROPIC_AUTH_TOKEN: e.target.value })}
              placeholder="请输入 API 密钥..."
            />
            <button
              type="button"
              onClick={() => setShowToken(!showToken)}
              className="show-pwd-btn"
            >
              {showToken ? '隐藏' : '显示'}
            </button>
          </div>
        </div>

        <div className="api-test-panel">
          <div className="btn-row">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testLoading}
              className="admin-btn outline-btn"
            >
              {testLoading ? '连通性测试中...' : '⚡ 测试 API 连通性'}
            </button>
          </div>
          {testResult && (
            <div className={`api-test-card ${testResult.success ? 'success' : 'error'}`}>
              {testResult.message}
            </div>
          )}
        </div>
      </div>

      <div className="form-section">
        <h3>2. 新闻处理与翻译模型</h3>
        <div className="form-group">
          <label>翻译与重写主模型 (Chat Model)</label>
          <ModelCombobox
            value={config.GEMINI_CHAT_MODEL}
            onChange={(val) => setConfig({ ...config, GEMINI_CHAT_MODEL: val })}
            options={CHAT_MODEL_PRESETS}
            placeholder="输入搜索或选择翻译主模型，如 gemini-3.8-flash-high"
            required
          />
        </div>
      </div>

      <div className="form-section">
        <h3>3. 智能生图与配图模型</h3>
        <div className="form-group">
          <label>主绘图模型 (Image Model)</label>
          <ModelCombobox
            value={config.GEMINI_IMAGE_MODEL}
            onChange={(val) => setConfig({ ...config, GEMINI_IMAGE_MODEL: val })}
            options={IMAGE_MODEL_PRESETS}
            placeholder="输入搜索或选择生图模型，如 gemini-3.1-flash-image"
            required
          />
        </div>

        <div className="form-group">
          <label>
            兜底绘图模型列表 (Fallback Image Models)
            <span className="tooltip-info">（支持多个，使用英文逗号 "," 隔开，依次尝试）</span>
          </label>
          <input
            type="text"
            value={config.FALLBACK_IMAGE_MODELS}
            onChange={(e) => setConfig({ ...config, FALLBACK_IMAGE_MODELS: e.target.value })}
            placeholder="例如 gpt-image-2, gpt-image-1.5"
            required
          />
          <div className="quick-chip-row">
            <span className="quick-chip-label">快捷点选添加兜底:</span>
            {IMAGE_MODEL_PRESETS.map((p) => {
              const currentList = (config.FALLBACK_IMAGE_MODELS || '').split(',').map(s => s.trim()).filter(Boolean);
              const isAlreadyIn = currentList.includes(p.value);
              return (
                <button
                  key={p.value}
                  type="button"
                  disabled={isAlreadyIn}
                  onClick={() => {
                    const current = (config.FALLBACK_IMAGE_MODELS || '').trim();
                    const next = current ? `${current},${p.value}` : p.value;
                    setConfig({ ...config, FALLBACK_IMAGE_MODELS: next });
                  }}
                  className={`quick-model-chip ${isAlreadyIn ? 'added' : ''}`}
                >
                  {isAlreadyIn ? `✓ ${p.value}` : `+ ${p.value}`}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="form-actions">
        <button type="submit" disabled={saveLoading} className="admin-btn primary-btn save-btn">
          {saveLoading ? '正在保存...' : '保存 AI 模型配置'}
        </button>
      </div>
    </form>
  );
}

// ─── Admin 子页面组件：新闻抓取与调度管理 ─────────────────────────
const INTERVAL_PRESETS = [
  { id: '15m', label: '15 分钟', expr: '*/15 * * * *', desc: '极速轮询' },
  { id: '30m', label: '30 分钟', expr: '*/30 * * * *', desc: '高频更新' },
  { id: '1h', label: '1 小时', expr: '0 * * * *', desc: '准实时更新' },
  { id: '2h', label: '2 小时', expr: '0 */2 * * *', desc: '系统推荐' },
  { id: '6h', label: '6 小时', expr: '0 */6 * * *', desc: '低频节约' },
  { id: '12h', label: '12 小时', expr: '0 */12 * * *', desc: '早晚各一次' },
  { id: '24h', label: '24 小时', expr: '0 2 * * *', desc: '每日凌晨2点' },
  { id: 'custom', label: '自定义 Cron', expr: '', desc: '高级表达式' },
];

function AdminCrawlerTab({ onAuthError }) {
  const [crawlerConfig, setCrawlerConfig] = useState({
    enabled: true,
    cronExpr: '0 */2 * * *',
    intervalPreset: '2h',
    isRunning: false,
    lastRunStatus: 'IDLE',
    lastRunStartTime: null,
    lastRunDurationMs: null,
    jobQueue: {}
  });

  const [loading, setLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [triggerLoading, setTriggerLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // 早晚报管理状态
  const [generatingBriefing, setGeneratingBriefing] = useState('');
  const [briefingMsg, setBriefingMsg] = useState('');
  const [briefingStatus, setBriefingStatus] = useState(null);

  // RSS 订阅源管理状态（方案 B：Linear 极简流体列表）
  const [rssSources, setRssSources] = useState([]);
  const [rssLoading, setRssLoading] = useState(false);
  const [rssActionMsg, setRssActionMsg] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newRss, setNewRss] = useState({ name: '', url: '', category: '自定义订阅', directRss: true });
  const [modalProbing, setModalProbing] = useState(false);
  const [modalProbeResult, setModalProbeResult] = useState(null);
  const [itemProbingId, setItemProbingId] = useState(null);
  const [itemProbeResults, setItemProbeResults] = useState({});
  const [removingId, setRemovingId] = useState(null);

  const fetchRssSources = useCallback(async () => {
    const token = localStorage.getItem('admin_token');
    if (!token) return;
    setRssLoading(true);
    try {
      const res = await axios.get('/api/admin/crawler/rss', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.data?.items) {
        setRssSources(res.data.items);
      }
    } catch (err) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        onAuthError?.();
      }
    } finally {
      setRssLoading(false);
    }
  }, [onAuthError]);

  const handleToggleRssEnabled = async (id, currentEnabled) => {
    const token = localStorage.getItem('admin_token');
    if (!token) return;
    const nextEnabled = !currentEnabled;
    setRssSources((prev) => prev.map((s) => (s.id === id ? { ...s, enabled: nextEnabled ? 1 : 0 } : s)));
    try {
      await axios.put(`/api/admin/crawler/rss/${id}`, { enabled: nextEnabled }, {
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (err) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        onAuthError?.();
      } else {
        alert('修改状态失败: ' + (err.response?.data?.error || err.message));
        fetchRssSources();
      }
    }
  };

  const handleDeleteRss = async (id, name) => {
    if (!window.confirm(`确定要移除订阅源「${name}」吗？移除后将不再从该站点采集资讯。`)) {
      return;
    }
    const token = localStorage.getItem('admin_token');
    if (!token) return;
    setRemovingId(id);
    setTimeout(async () => {
      try {
        await axios.delete(`/api/admin/crawler/rss/${id}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setRssSources((prev) => prev.filter((s) => s.id !== id));
        setRssActionMsg(`✓ 已移除订阅源「${name}」`);
        setTimeout(() => setRssActionMsg(''), 3000);
      } catch (err) {
        if (err.response?.status === 401 || err.response?.status === 403) {
          onAuthError?.();
        } else {
          alert('删除订阅源失败: ' + (err.response?.data?.error || err.message));
          fetchRssSources();
        }
      } finally {
        setRemovingId(null);
      }
    }, 180);
  };

  const handleResetDefaultRss = async () => {
    if (!window.confirm('确认重置并恢复官方预设的 10 个核心 RSS 媒体源？自定义添加的源将被保留或重置。')) {
      return;
    }
    const token = localStorage.getItem('admin_token');
    if (!token) return;
    try {
      const res = await axios.post('/api/admin/crawler/rss/reset', {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.data?.items) {
        setRssSources(res.data.items);
      }
      setRssActionMsg('✓ 已重置并恢复官方默认 10 个 RSS 订阅源');
      setTimeout(() => setRssActionMsg(''), 3000);
    } catch (err) {
      alert('重置失败: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleProbeItem = async (source) => {
    const token = localStorage.getItem('admin_token');
    if (!token) return;
    setItemProbingId(source.id);
    setItemProbeResults((prev) => ({ ...prev, [source.id]: null }));
    try {
      const res = await axios.post('/api/admin/crawler/rss/test', {
        url: source.url,
        directRss: Boolean(source.directRss)
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setItemProbeResults((prev) => ({
        ...prev,
        [source.id]: {
          success: true,
          message: `✓ 正常 (${res.data.result?.durationMs}ms)`
        }
      }));
    } catch (err) {
      setItemProbeResults((prev) => ({
        ...prev,
        [source.id]: {
          success: false,
          message: '✕ 探测失败'
        }
      }));
    } finally {
      setItemProbingId(null);
      setTimeout(() => {
        setItemProbeResults((prev) => ({ ...prev, [source.id]: null }));
      }, 4500);
    }
  };

  const handleProbeNewRss = async () => {
    if (!newRss.url.trim()) {
      alert('请先输入 Feed URL 地址');
      return;
    }
    const token = localStorage.getItem('admin_token');
    if (!token) return;
    setModalProbing(true);
    setModalProbeResult(null);
    try {
      const res = await axios.post('/api/admin/crawler/rss/test', {
        url: newRss.url.trim(),
        directRss: newRss.directRss
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const probeData = res.data.result;
      setModalProbeResult({
        success: true,
        data: probeData
      });

      // 智能识别类型：若是网页则切至 webpage，若是 XML 则切至 rss
      const detectedType = probeData.type === 'webpage' ? 'webpage' : 'rss';
      const targetUrl = probeData.suggestedUrl || newRss.url;

      setNewRss((prev) => ({
        ...prev,
        url: targetUrl,
        type: detectedType,
        name: prev.name.trim() ? prev.name : (probeData.title || prev.name)
      }));
    } catch (err) {
      setModalProbeResult({
        success: false,
        error: err.response?.data?.error || err.message
      });
    } finally {
      setModalProbing(false);
    }
  };

  const handleSaveNewRss = async (e) => {
    e.preventDefault();
    if (!newRss.name.trim() || !newRss.url.trim()) return;
    const token = localStorage.getItem('admin_token');
    if (!token) return;
    try {
      const res = await axios.post('/api/admin/crawler/rss', {
        name: newRss.name.trim(),
        url: newRss.url.trim(),
        type: newRss.type || 'rss',
        directRss: newRss.directRss,
        category: newRss.category.trim() || '自定义订阅'
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.data?.item) {
        setRssSources((prev) => [...prev, res.data.item]);
      }
      setShowAddModal(false);
      setNewRss({ name: '', url: '', type: 'rss', category: '自定义订阅', directRss: true });
      setModalProbeResult(null);
      setRssActionMsg(`✓ 成功添加数据源「${res.data.item?.name}」`);
      setTimeout(() => setRssActionMsg(''), 3000);
    } catch (err) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        onAuthError?.();
      } else {
        alert(err.response?.data?.error || err.message || '添加订阅源失败');
      }
    }
  };

  const fetchBriefingStatus = useCallback(async () => {
    const token = localStorage.getItem('admin_token');
    if (!token) return;
    try {
      const res = await axios.get('/api/admin/briefings/status', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setBriefingStatus(res.data);
    } catch {}
  }, []);

  const handleGenerateBriefing = async (type) => {
    setGeneratingBriefing(type);
    setBriefingMsg('');
    const token = localStorage.getItem('admin_token');
    try {
      const res = await axios.post('/api/admin/briefings/generate', { type }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setBriefingMsg(res.data.message || '早晚报生成成功！');
      fetchBriefingStatus();
      setTimeout(() => setBriefingMsg(''), 4000);
    } catch (err) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        onAuthError?.();
        return;
      }
      alert(err.response?.data?.error || err.message || '生成早晚报失败');
    } finally {
      setGeneratingBriefing('');
    }
  };

  const handleUpdateBriefingLayout = async (newLayout) => {
    const token = localStorage.getItem('admin_token');
    setBriefingStatus(prev => ({ ...prev, layout: newLayout }));
    try {
      await axios.post('/api/admin/briefings/config', { layout: newLayout }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setBriefingMsg(`前台展示布局已切换为【${newLayout === 'bento' ? '方案 B：双子星 Bento 并列卡片' : '方案 A：双态分段流体卡片'}】`);
      setTimeout(() => setBriefingMsg(''), 3500);
    } catch (err) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        onAuthError?.();
        return;
      }
      alert('更新早晚报布局风格失败: ' + err.message);
    }
  };

  const handleToggleBriefingEnabled = async (enabled) => {
    const token = localStorage.getItem('admin_token');
    if (!token) return;
    setBriefingStatus((prev) => (prev ? { ...prev, enabled } : { enabled }));
    try {
      const res = await axios.post('/api/admin/briefings/config', { enabled }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setBriefingMsg(res.data.message || (enabled ? '已启用 AI 科技早晚报功能' : '已停用 AI 科技早晚报功能'));
      fetchBriefingStatus();
      setTimeout(() => setBriefingMsg(''), 3500);
    } catch (err) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        onAuthError?.();
        return;
      }
      alert('更新早晚报状态失败: ' + (err.response?.data?.error || err.message));
    }
  };

  const fetchCrawlerConfig = useCallback(async () => {
    const token = localStorage.getItem('admin_token');
    if (!token) return;
    try {
      const res = await axios.get('/api/admin/crawler/config', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setCrawlerConfig(res.data);
    } catch (err) {
      console.error(err);
      if (err.response?.status === 401 || err.response?.status === 403) {
        onAuthError?.();
        return;
      }
      setErrorMsg(err.response?.data?.error || '拉取抓取调度配置失败');
    }
  }, [onAuthError]);

  useEffect(() => {
    setLoading(true);
    fetchCrawlerConfig().finally(() => setLoading(false));
    fetchBriefingStatus();
    fetchRssSources();
  }, [fetchCrawlerConfig, fetchBriefingStatus, fetchRssSources]);

  // 当任务处于运行中时，每 3 秒自动轮询刷新状态
  useEffect(() => {
    let timer = null;
    if (crawlerConfig.isRunning) {
      timer = setInterval(() => {
        fetchCrawlerConfig();
      }, 3000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [crawlerConfig.isRunning, fetchCrawlerConfig]);

  const handlePresetSelect = (preset) => {
    if (preset.id === 'custom') {
      setCrawlerConfig(prev => ({ ...prev, intervalPreset: 'custom' }));
    } else {
      setCrawlerConfig(prev => ({
        ...prev,
        intervalPreset: preset.id,
        cronExpr: preset.expr
      }));
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSuccessMsg('');
    setErrorMsg('');
    setSaveLoading(true);
    const token = localStorage.getItem('admin_token');
    try {
      const res = await axios.post('/api/admin/crawler/config', {
        enabled: crawlerConfig.enabled,
        cronExpr: crawlerConfig.cronExpr,
        intervalPreset: crawlerConfig.intervalPreset
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.data.status) {
        setCrawlerConfig(res.data.status);
      }
      setSuccessMsg('抓取调度配置已更新，并在运行中实时热重载生效！');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        onAuthError?.();
        return;
      }
      setErrorMsg(err.response?.data?.error || '保存抓取调度配置失败');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleTriggerNow = async () => {
    setTriggerLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    const token = localStorage.getItem('admin_token');
    try {
      const res = await axios.post('/api/admin/crawler/trigger', {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSuccessMsg(res.data.message || '手动抓取任务已启动！');
      setCrawlerConfig(prev => ({ ...prev, isRunning: true, lastRunStatus: 'RUNNING' }));
      setTimeout(() => fetchCrawlerConfig(), 1000);
    } catch (err) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        onAuthError?.();
        return;
      }
      setErrorMsg(err.response?.data?.error || '手动触发失败，可能已有任务在运行');
    } finally {
      setTriggerLoading(false);
    }
  };

  if (loading) {
    return <div className="admin-loading">正在拉取调度状态...</div>;
  }

  const isRunning = crawlerConfig.isRunning;
  const statusType = isRunning ? 'running' : (crawlerConfig.lastRunStatus === 'FAILED' ? 'failed' : 'idle');
  const statusText = isRunning
    ? '正在执行采集流水线 (RUNNING)'
    : (crawlerConfig.lastRunStatus === 'FAILED' ? '上次采集异常 (FAILED)' : '空闲就绪 (IDLE)');

  const formatDuration = (ms) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)} 秒`;
  };

  const formatTime = (iso) => {
    if (!iso) return '尚未执行';
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString('zh-CN', { hour12: false });
    } catch {
      return iso;
    }
  };

  return (
    <div className="admin-config-form">
      {successMsg && <div className="toast-success">{successMsg}</div>}
      {errorMsg && <div className="toast-error">{errorMsg}</div>}

      {/* 实时状态看板 */}
      <div className="crawler-status-banner">
        <div className="crawler-status-left">
          <span className={`crawler-pulse ${statusType}`} />
          <div>
            <div className="crawler-status-title">状态：{statusText}</div>
            <div className="crawler-status-sub">
              上次启动时间：{formatTime(crawlerConfig.lastRunStartTime)} · 耗时：{formatDuration(crawlerConfig.lastRunDurationMs)}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={handleTriggerNow}
          disabled={isRunning || triggerLoading}
          className="admin-btn primary-btn"
          style={{ background: isRunning ? '#6b7280' : 'var(--accent)' }}
        >
          {isRunning ? '⏳ 抓取进行中...' : (triggerLoading ? '启动中...' : '⚡ 立即手动抓取')}
        </button>
      </div>

      {/* 队列指标 */}
      <div className="crawler-metrics-row">
        <div className="crawler-metric-box">
          <div className="metric-label">待转译入队 (PENDING)</div>
          <div className="metric-value">{crawlerConfig.jobQueue?.PENDING || 0}</div>
        </div>
        <div className="crawler-metric-box">
          <div className="metric-label">AI 处理中 (PROCESSING)</div>
          <div className="metric-value">{crawlerConfig.jobQueue?.PROCESSING || 0}</div>
        </div>
        <div className="crawler-metric-box">
          <div className="metric-label">失败重试 (FAILED)</div>
          <div className="metric-value">{crawlerConfig.jobQueue?.FAILED || 0}</div>
        </div>
        <div className="crawler-metric-box">
          <div className="metric-label">调度任务状态</div>
          <div className="metric-value" style={{ fontSize: '14px', color: crawlerConfig.enabled ? '#30d158' : 'var(--label-secondary)' }}>
            {crawlerConfig.enabled ? '● 自动轮询已开启' : '○ 已暂停调度'}
          </div>
        </div>
      </div>

      {/* 抓取配置表单 */}
      <form onSubmit={handleSave}>
        <div className="form-section">
          <h3>1. 自动定时抓取开关</h3>
          <div className="switch-label-row">
            <div>
              <div style={{ fontSize: '13.5px', fontWeight: 500, color: 'var(--label)' }}>启用后台定时轮询采集</div>
              <div className="tooltip-info" style={{ marginLeft: 0, marginTop: '2px' }}>
                关闭后将停止周期性后台抓取，但仍支持手动点击“立即抓取”
              </div>
            </div>
            <label className="switch-box">
              <input
                type="checkbox"
                className="switch-input"
                checked={crawlerConfig.enabled}
                onChange={(e) => setCrawlerConfig({ ...crawlerConfig, enabled: e.target.checked })}
              />
            </label>
          </div>
        </div>

        <div className="form-section">
          <h3>2. 抓取周期频率选择</h3>
          <div className="interval-presets-grid">
            {INTERVAL_PRESETS.map((p) => {
              const isActive = crawlerConfig.intervalPreset === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => handlePresetSelect(p)}
                  className={`interval-preset-card ${isActive ? 'active' : ''}`}
                >
                  <span className="preset-time">{p.label}</span>
                  <span className="preset-desc">{p.desc}</span>
                </div>
              );
            })}
          </div>

          <div className="form-group" style={{ marginTop: '16px' }}>
            <label>
              生效的 Cron 表达式
              <span className="tooltip-info">（标准 5 位 Cron 语法：分 时 日 月 周，最小间隔为 5 分钟）</span>
            </label>
            <input
              type="text"
              value={crawlerConfig.cronExpr}
              onChange={(e) => setCrawlerConfig({ ...crawlerConfig, cronExpr: e.target.value, intervalPreset: 'custom' })}
              placeholder="0 */2 * * *"
              required
            />
          </div>
        </div>

        {/* 3. RSS 订阅源池配置与管理 (方案 B：Linear 风格极简无界流体列表) */}
        <div className="form-section rss-section-container">
          <div className="rss-header-row">
            <div className="rss-header-left">
              <h3>
                <span>3. RSS 订阅数据源管理</span>
                <span className="rss-count-pill">
                  共 {rssSources.length} 个数据源 · {rssSources.filter((s) => s.enabled).length} 个生效
                </span>
              </h3>
              <p>配置爬虫聚合资讯采集站点。支持自定义扩充 RSS/Atom 源、即时连通探测、启停切换与删除。</p>
            </div>
            <div className="rss-header-actions">
              <button
                type="button"
                className="rss-btn-add"
                onClick={() => {
                  setNewRss({ name: '', url: '', category: '自定义订阅', directRss: true });
                  setModalProbeResult(null);
                  setShowAddModal(true);
                }}
              >
                <span>＋ 添加自定义源</span>
              </button>
              <button
                type="button"
                className="rss-btn-reset"
                onClick={handleResetDefaultRss}
                title="恢复官方默认预设的 10 个核心源"
              >
                <span>⟲ 恢复默认推荐</span>
              </button>
            </div>
          </div>

          {rssActionMsg && (
            <div className="toast-success" style={{ marginBottom: '12px' }}>
              {rssActionMsg}
            </div>
          )}

          {/* Linear 风格无界流体列表 */}
          <div className="rss-stream-list">
            {rssSources.length === 0 ? (
              <div style={{ padding: '28px', textAlign: 'center', color: 'var(--label-secondary)', fontSize: '13px' }}>
                当前暂无 RSS 订阅源。点击右上角「恢复默认推荐」即可一键导入官方推荐源。
              </div>
            ) : (
              rssSources.map((source) => {
                const isProbing = itemProbingId === source.id;
                const probeRes = itemProbeResults[source.id];
                const isRemoving = removingId === source.id;
                const isDirect = Boolean(source.directRss);
                const isWebpage = source.type === 'webpage';

                return (
                  <div
                    key={source.id}
                    className={`rss-stream-item ${isRemoving ? 'removing' : ''}`}
                  >
                    <div className="rss-item-left">
                      <div className="rss-icon-badge" aria-hidden="true">
                        <span>{isWebpage ? '🌐' : '📡'}</span>
                      </div>
                      <div className="rss-item-meta">
                        <div className="rss-title-row">
                          <span className="rss-item-name">{source.name}</span>
                          <span className="rss-category-tag">{source.category || '订阅源'}</span>
                          <span
                            className="rss-protocol-tag"
                            style={isWebpage ? { background: 'rgba(175, 82, 222, 0.15)', color: '#bf5af2' } : {}}
                          >
                            {isWebpage ? '✦ AI 网页' : (isDirect ? 'Direct XML' : 'Proxy API')}
                          </span>
                        </div>
                        <div className="rss-url-row">
                          <span>🔗</span>
                          <a href={source.url} target="_blank" rel="noopener noreferrer" title="在新标签中打开源地址">
                            {source.url}
                          </a>
                        </div>
                      </div>
                    </div>

                    <div className="rss-item-right">
                      {probeRes ? (
                        <span className={`rss-probe-feedback ${probeRes.success ? 'success' : 'error'}`}>
                          {probeRes.message}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="rss-probe-btn"
                          disabled={isProbing}
                          onClick={() => handleProbeItem(source)}
                          title="在线探测该 Feed 是否可正常解析"
                        >
                          <span>{isProbing ? '⏳ 探测中...' : '⚡ 探测'}</span>
                        </button>
                      )}

                      <span className={`rss-status-badge ${source.enabled ? 'active' : 'disabled'}`}>
                        {source.enabled ? '🟢 活跃' : '⚪ 暂停'}
                      </span>

                      <label className="switch-box" title={source.enabled ? '点击暂停此源采集' : '点击开启此源采集'}>
                        <input
                          type="checkbox"
                          className="switch-input"
                          checked={Boolean(source.enabled)}
                          onChange={() => handleToggleRssEnabled(source.id, Boolean(source.enabled))}
                        />
                      </label>

                      <button
                        type="button"
                        className="rss-delete-btn"
                        onClick={() => handleDeleteRss(source.id, source.name)}
                        title="移除此订阅源"
                        aria-label="移除此订阅源"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="form-section">
          <h3>4. AI 早晚报自动化提炼与调度</h3>
          <div className="briefing-admin-status-box">
            <div className="switch-label-row" style={{ paddingBottom: '16px', borderBottom: '1px solid var(--separator)' }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--label)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>启用 AI 科技早晚报功能</span>
                  <span style={{
                    fontSize: '11px',
                    padding: '2px 7px',
                    borderRadius: '4px',
                    background: (briefingStatus?.enabled ?? true) ? 'rgba(48, 209, 88, 0.15)' : 'rgba(255, 255, 255, 0.08)',
                    color: (briefingStatus?.enabled ?? true) ? '#30d158' : 'var(--label-tertiary)',
                    fontWeight: 500
                  }}>
                    {(briefingStatus?.enabled ?? true) ? '已开启' : '已停用'}
                  </span>
                </div>
                <div className="tooltip-info" style={{ marginLeft: 0, marginTop: '4px', lineHeight: 1.5 }}>
                  开启后前台将展示精炼早晚报板块并支持自动化定时提炼；关闭后前台完全隐藏该板块。
                </div>
              </div>
              <label className="switch-box" style={{ flexShrink: 0, marginLeft: '24px' }}>
                <input
                  type="checkbox"
                  className="switch-input"
                  checked={briefingStatus?.enabled ?? true}
                  onChange={(e) => handleToggleBriefingEnabled(e.target.checked)}
                />
              </label>
            </div>

            <div style={{ marginTop: '14px' }}>
              <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--label)' }}>
                每日早报 (北京时间 08:00) & 晚报 (北京时间 20:00) 定时热点提炼
              </div>
              <div className="tooltip-info" style={{ marginLeft: 0, marginTop: '2px' }}>
                按北京时间 (UTC+8) 自动化触发：早报总结前夜至早晨未读新闻，晚报总结白天热点要闻。支持随时手动触发立即生成。
              </div>
            </div>

            <div className="briefing-admin-grid">
              <div className="crawler-metric-box">
                <div className="metric-label">今日早报状态 (北京时间 08:00)</div>
                <div className="metric-value" style={{ fontSize: '14px', marginTop: '6px' }}>
                  {briefingStatus?.todayMorning ? (
                    <span style={{ color: '#30d158' }}>✓ 已生成 ({briefingStatus.todayMorning.article_count} 篇要闻)</span>
                  ) : (
                    <span style={{ color: 'var(--label-secondary)' }}>○ 今日尚未生成</span>
                  )}
                </div>
              </div>
              <div className="crawler-metric-box">
                <div className="metric-label">今日晚报状态 (北京时间 20:00)</div>
                <div className="metric-value" style={{ fontSize: '14px', marginTop: '6px' }}>
                  {briefingStatus?.todayEvening ? (
                    <span style={{ color: '#30d158' }}>✓ 已生成 ({briefingStatus.todayEvening.article_count} 篇要闻)</span>
                  ) : (
                    <span style={{ color: 'var(--label-secondary)' }}>○ 今日尚未生成</span>
                  )}
                </div>
              </div>
            </div>

            <div className="btn-row" style={{ marginTop: '14px', justifyContent: 'flex-start' }}>
              <button
                type="button"
                onClick={() => handleGenerateBriefing('morning')}
                disabled={!!generatingBriefing}
                className="admin-btn outline-btn"
              >
                {generatingBriefing === 'morning' ? '正在聚合生成早报...' : '🌅 立即手动生成早报'}
              </button>
              <button
                type="button"
                onClick={() => handleGenerateBriefing('evening')}
                disabled={!!generatingBriefing}
                className="admin-btn outline-btn"
              >
                {generatingBriefing === 'evening' ? '正在聚合生成晚报...' : '🌆 立即手动生成晚报'}
              </button>
            </div>

            <div style={{ marginTop: '18px', paddingTop: '14px', borderTop: '1px dashed var(--separator-opaque)' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--label)' }}>
                前台早晚报展示布局风格 (可选切换)
              </div>
              <div className="tooltip-info" style={{ marginLeft: 0, marginTop: '2px' }}>
                支持后台随时切换前台展示形态，切换后前台即刻生效
              </div>

              <div className="layout-selector-grid">
                <div
                  className={`layout-choice-card ${(briefingStatus?.layout || 'bento') === 'segmented' ? 'active' : ''}`}
                  onClick={() => handleUpdateBriefingLayout('segmented')}
                >
                  <div className="layout-choice-title">
                    <span>🎛️</span>
                    <span>方案 A：双态分段流体卡片</span>
                  </div>
                  <div className="layout-choice-desc">
                    单个精致卡片内嵌 iOS 风格毛玻璃分段切换器，平滑切换早晚报，更节省纵向空间。
                  </div>
                </div>

                <div
                  className={`layout-choice-card ${(briefingStatus?.layout || 'bento') === 'bento' ? 'active' : ''}`}
                  onClick={() => handleUpdateBriefingLayout('bento')}
                >
                  <div className="layout-choice-title">
                    <span>🍱</span>
                    <span>方案 B：双子星 Bento 并列卡片</span>
                  </div>
                  <div className="layout-choice-desc">
                    早报与晚报左右并排对称展示，晨曦暖金与暮夜霓虹紫同屏尽览，视觉冲击力极强。
                  </div>
                </div>
              </div>
            </div>

            {briefingMsg && (
              <div className="toast-success" style={{ marginTop: '12px' }}>
                {briefingMsg}
              </div>
            )}
          </div>
        </div>

        <div className="form-actions" style={{ marginTop: '20px' }}>
          <button type="submit" disabled={saveLoading} className="admin-btn primary-btn save-btn">
            {saveLoading ? '正在更新与热重载...' : '保存抓取调度并热重载'}
          </button>
        </div>
      </form>

      {/* 添加自定义 RSS / 网页模态弹窗 */}
      {showAddModal && (
        <div className="rss-modal-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="rss-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="rss-modal-header">
              <h3>
                <span>📡</span>
                <span>接入数据订阅源 (RSS / 任意网页)</span>
              </h3>
              <button
                type="button"
                className="rss-modal-close-btn"
                onClick={() => setShowAddModal(false)}
                aria-label="关闭弹窗"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveNewRss}>
              <div className="form-group">
                <label>
                  订阅站点名称
                  <span className="tooltip-info">（例如：DeepSeek 博客、量子位）</span>
                </label>
                <input
                  type="text"
                  value={newRss.name}
                  onChange={(e) => setNewRss({ ...newRss, name: e.target.value })}
                  placeholder="请输入媒体、博客或站点名称"
                  required
                />
              </div>

              <div className="form-group" style={{ marginTop: '14px' }}>
                <label>
                  订阅源地址 (URL)
                  <span className="tooltip-info">（支持 RSS/Atom XML 链接，亦可直接输入普通网页 URL）</span>
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="url"
                    value={newRss.url}
                    onChange={(e) => {
                      setNewRss({ ...newRss, url: e.target.value });
                      setModalProbeResult(null);
                    }}
                    placeholder="https://example.com/feed.xml 或普通资讯主页"
                    required
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="admin-btn outline-btn"
                    disabled={modalProbing || !newRss.url.trim()}
                    onClick={handleProbeNewRss}
                    style={{ padding: '0 14px', whiteSpace: 'nowrap', fontSize: '13px' }}
                  >
                    {modalProbing ? '智能探测中...' : '⚡ 智能探测'}
                  </button>
                </div>
              </div>

              {/* 探测结果提示 */}
              {modalProbeResult && (
                <div className={`rss-modal-probe-banner ${modalProbeResult.success ? 'success' : 'error'}`}>
                  {modalProbeResult.success ? (
                    <div>
                      <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>
                          {modalProbeResult.data?.feedType === 'ai_webpage'
                            ? '✦ 成功识别为普通网页 (AI 自适应提炼)'
                            : (modalProbeResult.data?.feedType === 'embedded_rss'
                              ? '💡 智能嗅探到网页内嵌官方 RSS 源并自动适配'
                              : '✓ 标准 RSS / XML 订阅源探测成功')}
                        </span>
                        <span style={{ opacity: 0.8, fontSize: '11.5px' }}>
                          ({modalProbeResult.data?.durationMs}ms)
                        </span>
                      </div>
                      {modalProbeResult.data?.title && (
                        <div style={{ opacity: 0.9, marginTop: '3px' }}>
                          识别频道：{modalProbeResult.data.title}（提取到 {modalProbeResult.data?.itemCount || 0} 篇要闻）
                        </div>
                      )}
                      {modalProbeResult.data?.sampleItems?.length > 0 && (
                        <div style={{ opacity: 0.85, marginTop: '4px', fontSize: '12px' }}>
                          最新篇目：{modalProbeResult.data.sampleItems[0]?.title}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontWeight: 600 }}>✕ 探测未通过</div>
                      <div style={{ opacity: 0.9, marginTop: '2px' }}>{modalProbeResult.error}</div>
                    </div>
                  )}
                </div>
              )}

              <div className="form-group" style={{ marginTop: '14px' }}>
                <label>数据源协议类型</label>
                <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                  <button
                    type="button"
                    onClick={() => setNewRss({ ...newRss, type: 'rss' })}
                    className={`quick-model-chip ${newRss.type !== 'webpage' ? 'added' : ''}`}
                    style={{ flex: 1, padding: '7px 10px', textAlign: 'center' }}
                  >
                    📡 标准 RSS / Atom (XML)
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewRss({ ...newRss, type: 'webpage' })}
                    className={`quick-model-chip ${newRss.type === 'webpage' ? 'added' : ''}`}
                    style={{ flex: 1, padding: '7px 10px', textAlign: 'center' }}
                  >
                    🌐 普通网页 (AI 自动提炼)
                  </button>
                </div>
              </div>

              <div className="form-group" style={{ marginTop: '14px' }}>
                <label>分类标签 (选填)</label>
                <input
                  type="text"
                  value={newRss.category}
                  onChange={(e) => setNewRss({ ...newRss, category: e.target.value })}
                  placeholder="例如：大模型前沿、商业洞察、国内社区"
                />
                <div className="quick-chip-row" style={{ marginTop: '6px' }}>
                  <span className="quick-chip-label">快捷标签:</span>
                  {['权威媒体', '官方机构', '开源社区', '国内科技', '学术论文'].map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setNewRss({ ...newRss, category: cat })}
                      className="quick-model-chip"
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rss-modal-actions">
                <button
                  type="button"
                  className="admin-btn outline-btn"
                  onClick={() => setShowAddModal(false)}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="admin-btn primary-btn"
                >
                  确认保存添加
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Admin 子页面组件：管理员安全凭据 ─────────────────────────────
function AdminSecurityTab({ onLogoutRequired }) {
  const [credUsername, setCredUsername] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [credSuccessMsg, setCredSuccessMsg] = useState('');
  const [credErrorMsg, setCredErrorMsg] = useState('');
  const [credLoading, setCredLoading] = useState(false);

  const handleChangeCredentials = async (e) => {
    e.preventDefault();
    setCredSuccessMsg('');
    setCredErrorMsg('');
    setCredLoading(true);
    const token = localStorage.getItem('admin_token');
    try {
      const res = await axios.post('/api/admin/change-credentials', {
        username: credUsername,
        oldPassword,
        newPassword
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setCredSuccessMsg(res.data.message || '凭证修改成功，请使用新密码重新登录！');
      setTimeout(() => {
        onLogoutRequired();
      }, 2000);
    } catch (err) {
      setCredErrorMsg(err.response?.data?.error || '修改凭证失败，请检查原密码是否正确');
    } finally {
      setCredLoading(false);
    }
  };

  return (
    <form onSubmit={handleChangeCredentials} className="admin-config-form">
      {credSuccessMsg && <div className="toast-success">{credSuccessMsg}</div>}
      {credErrorMsg && <div className="toast-error">{credErrorMsg}</div>}

      <div className="form-section">
        <h3>管理员账户与密码设置</h3>

        <div className="form-group">
          <label>新管理员账号 (Username)</label>
          <input
            type="text"
            value={credUsername}
            onChange={(e) => setCredUsername(e.target.value)}
            placeholder="留空则保持现有用户名不变"
          />
        </div>

        <div className="form-group">
          <label>原管理员密码 (Current Password)</label>
          <input
            type="password"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            placeholder="请输入当前旧密码进行身份验证"
            required
          />
        </div>

        <div className="form-group">
          <label>新管理员密码 (New Password)</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="请输入安全可靠的新密码"
            required
          />
        </div>
      </div>

      <div className="form-actions">
        <button type="submit" disabled={credLoading} className="admin-btn primary-btn save-btn" style={{ background: '#10b981' }}>
          {credLoading ? '正在修改...' : '确认更新登录凭证'}
        </button>
      </div>
    </form>
  );
}

// ─── Admin 总控壳体组件 ──────────────────────────────────────────
function AdminPage() {
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!localStorage.getItem('admin_token'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loading, setLoading] = useState(false);

  const location = useLocation();

  // 根据当前路由确定激活的子控制台
  const currentTab = useMemo(() => {
    if (location.pathname.startsWith('/admin/crawler')) return 'crawler';
    if (location.pathname.startsWith('/admin/security')) return 'security';
    return 'models'; // 默认进入模型管理
  }, [location.pathname]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoading(true);
    try {
      const res = await axios.post('/api/admin/login', { username, password });
      if (res.data.success && res.data.token) {
        localStorage.setItem('admin_token', res.data.token);
        setIsLoggedIn(true);
      }
    } catch (err) {
      setLoginError(err.response?.data?.error || '登录失败，账号或密码错误');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('admin_token');
    setIsLoggedIn(false);
    setPassword('');
    setUsername('');
  };

  if (!isLoggedIn) {
    return (
      <div className="admin-standalone-shell">
        <div className="admin-login-card">
          <div className="admin-back-home">
            <Link to="/">← 返回新闻首页</Link>
          </div>
          <h2>管理员后台登录</h2>
          <p className="admin-login-desc">输入账号和密码进行管理员权限验证</p>
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label htmlFor="admin-username">管理员账号</label>
              <input
                id="admin-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入管理员用户名..."
                required
              />
            </div>
            <div className="form-group" style={{ marginTop: '16px' }}>
              <label htmlFor="admin-password">管理员密码</label>
              <input
                id="admin-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入管理员密码..."
                required
              />
            </div>
            {loginError && <p className="error-text" style={{ marginTop: '12px' }}>{loginError}</p>}
            <button type="submit" disabled={loading} className="admin-btn primary-btn" style={{ marginTop: '24px', width: '100%' }}>
              {loading ? '验证中...' : '验证登录'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const tabMeta = {
    models: {
      title: 'AI 大模型与凭据管理',
      desc: '动态配置用于新闻翻译、导读摘要以及智能绘图的 AI 大模型、请求地址和授权 Key'
    },
    crawler: {
      title: '新闻抓取与调度管理',
      desc: '配置 RSS 与站点爬取的时间间隔周期、Cron 规则，监控流水线运行状态并支持手动触发'
    },
    security: {
      title: '系统安全与登录凭证',
      desc: '更新管理员账号与登录密码，保障后台管理控制台访问安全'
    }
  };

  return (
    <div className="admin-standalone-shell">
      <div className="admin-dashboard-container">
        <aside className="admin-sidebar">
          <div>
            <div className="admin-brand">
              <h2>AI 新闻后台控制台</h2>
              <p>管理配置与服务调度</p>
            </div>
            <nav className="admin-sidebar-nav">
              <Link
                to="/admin/models"
                className={`admin-nav-item ${currentTab === 'models' ? 'active' : ''}`}
              >
                <span className="nav-icon">🤖</span>
                <span>AI 模型配置</span>
              </Link>
              <Link
                to="/admin/crawler"
                className={`admin-nav-item ${currentTab === 'crawler' ? 'active' : ''}`}
              >
                <span className="nav-icon">🕷️</span>
                <span>抓取与调度</span>
              </Link>
              <Link
                to="/admin/security"
                className={`admin-nav-item ${currentTab === 'security' ? 'active' : ''}`}
              >
                <span className="nav-icon">🔐</span>
                <span>安全与凭证</span>
              </Link>
            </nav>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <Link to="/" className="sidebar-link">← 返回新闻首页</Link>
            <button onClick={handleLogout} className="admin-btn outline-btn logout-btn">
              安全退出登录
            </button>
          </div>
        </aside>

        <main className="admin-main-content">
          <div className="admin-config-container">
            <div className="admin-config-header">
              <h2>{tabMeta[currentTab]?.title}</h2>
              <p>{tabMeta[currentTab]?.desc}</p>
            </div>

            {currentTab === 'models' && <AdminModelsTab onAuthError={handleLogout} />}
            {currentTab === 'crawler' && <AdminCrawlerTab onAuthError={handleLogout} />}
            {currentTab === 'security' && <AdminSecurityTab onLogoutRequired={handleLogout} onAuthError={handleLogout} />}
          </div>
        </main>
      </div>
    </div>
  );
}

function NewsSkeletonRow() {
  return (
    <div className="news-row news-skeleton-row" aria-hidden="true">
      <span className="row-image-skeleton skeleton-box" />
      <div className="row-content">
        <div className="skeleton-meta">
          <span className="skeleton-chip skeleton-box" />
          <span className="skeleton-text-sm skeleton-box" />
          <span className="skeleton-text-sm skeleton-box" />
        </div>
        <div className="skeleton-title skeleton-box" />
        <div className="skeleton-desc skeleton-box" />
        <div className="row-foot-bar">
          <span className="skeleton-stat skeleton-box" style={{ width: '90px' }} />
          <span className="skeleton-btn skeleton-box" style={{ width: '26px', height: '26px', borderRadius: '50%' }} />
        </div>
      </div>
    </div>
  );
}

function HomeSkeletonScreen() {
  return (
    <div className="app-shell">
      <header className="app-nav" aria-hidden="true">
        <div className="nav-inner">
          <div className="skel-brand">
            <span className="skeleton-box skel-brand-title" />
            <span className="skeleton-box skel-brand-sub" />
          </div>
          <div className="nav-links skel-nav-pills">
            {Array.from({ length: 7 }).map((_, i) => (
              <span key={i} className="skeleton-box skel-nav-pill" />
            ))}
          </div>
          <span className="skeleton-box skel-search" />
        </div>
      </header>

      <main className="page-frame" id="top" aria-busy="true" aria-label="首页加载中">
        <div className="live-bar" aria-hidden="true">
          <div className="live-bar-left">
            <span className="skeleton-box skel-live-dot" />
            <span className="skeleton-box skel-live-tag" />
          </div>
          <span className="skeleton-box skel-live-meta skel-live-count-pill" />
        </div>

        <section className="content-grid">
          <div className="left-col">
            <section className="hot-section skel-hot">
              <header className="hot-header skel-hot-head">
                <span className="skeleton-box skel-hot-icon" />
                <span className="skeleton-box skel-hot-title" />
                <span className="skeleton-box skel-hot-count" />
              </header>
              <div className="skel-hot-carousel">
                <span className="skeleton-box skel-hot-media" />
                <div className="skel-hot-body">
                  <span className="skeleton-box skel-meta-chip" />
                  <span className="skeleton-box skel-hot-headline" />
                  <span className="skeleton-box skel-hot-line" />
                  <span className="skeleton-box skel-hot-line skel-hot-line-short" />
                  <div className="skel-hot-foot">
                    <span className="skeleton-box skel-hot-stats" />
                    <span className="skeleton-box skel-hot-cta" />
                  </div>
                </div>
              </div>
            </section>

            <div className="news-panel" aria-hidden="true">
              <div className="panel-heading news-panel-heading">
                <span className="skeleton-box skel-panel-title" />
                <div className="skel-tabs">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <span key={i} className="skeleton-box skel-tab-pill" />
                  ))}
                </div>
              </div>
              <div className="news-list">
                {Array.from({ length: 6 }).map((_, i) => (
                  <NewsSkeletonRow key={i} />
                ))}
              </div>
            </div>
          </div>

          <div className="right-rail" aria-hidden="true">
            <aside className="rail-panel">
              <div className="panel-heading rail-heading">
                <span className="skeleton-box skel-rail-title" />
              </div>
              <div className="must-read-list">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div className="skel-rail-item" key={i}>
                    <span className="skeleton-box skel-rail-rank" />
                    <div className="skel-rail-copy">
                      <span className="skeleton-box skel-rail-line" />
                      <span className="skeleton-box skel-rail-line skel-rail-line-short" />
                    </div>
                  </div>
                ))}
              </div>
            </aside>

            <aside className="rail-panel">
              <div className="panel-heading rail-heading">
                <span className="skeleton-box skel-ai-title" />
              </div>
              <div className="skel-ai-body">
                <span className="skeleton-box skel-ai-line" />
                <span className="skeleton-box skel-ai-line skel-ai-line-short" />
                <span className="skeleton-box skel-ai-line" />
              </div>
            </aside>
          </div>
        </section>

        <footer className="page-footer skel-footer" aria-hidden="true">
          <div className="page-footer-links">
            {Array.from({ length: 5 }).map((_, i) => (
              <span key={i} className="skeleton-box skel-footer-link" />
            ))}
          </div>
          <span className="skeleton-box skel-footer-copy" />
        </footer>
      </main>
    </div>
  );
}

function App() {
  const [newsData, setNewsData] = useState({ items: [], total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [currentPage, setCurrentPage] = useState(() => {
    if (typeof window === 'undefined') return 1;
    const stored = sessionStorage.getItem('home.currentPage');
    return stored ? Number(stored) || 1 : 1;
  });
  const [activeNav, setActiveNav] = useState(() => {
    if (typeof window === 'undefined') return 'today';
    return sessionStorage.getItem('home.activeNav') || 'today';
  });
  const [activeTopic, setActiveTopic] = useState(() => {
    if (typeof window === 'undefined') return 'all';
    return sessionStorage.getItem('home.activeTopic') || 'all';
  });
  const [searchQuery, setSearchQuery] = useState('');
  const isMobile = useIsMobile();

  // 基于后端纯正分页的数据获取
  useEffect(() => {
    let ignore = false;
    if (currentPage === 1 || !isMobile) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }

    const params = {
      page: currentPage,
      pageSize: 12,
      topic: activeTopic,
      search: searchQuery.trim(),
    };

    axios
      .get('/api/news', { params })
      .then((res) => {
        if (ignore) return;
        const resData = res.data && Array.isArray(res.data.items)
          ? res.data
          : { items: Array.isArray(res.data) ? res.data : [], total: 0, totalPages: 1 };

        if (isMobile && currentPage > 1) {
          setNewsData((prev) => ({
            ...resData,
            items: [...prev.items, ...resData.items],
          }));
        } else {
          setNewsData(resData);
        }
      })
      .catch((err) => {
        if (!ignore) {
          console.error('获取新闻列表失败:', err);
        }
      })
      .finally(() => {
        if (!ignore) {
          setLoading(false);
          setLoadingMore(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [currentPage, activeTopic, searchQuery, isMobile]);

  const loadMoreMobile = useCallback(() => {
    if (loadingMore || currentPage >= newsData.totalPages) return;
    setCurrentPage((prev) => prev + 1);
  }, [loadingMore, currentPage, newsData.totalPages]);

  if (loading && newsData.items.length === 0) return <HomeSkeletonScreen />;

  return (
    <Router>
      <ScrollToTop />
      <Routes>
        <Route
          path="/"
          element={
            <HomePage
              newsData={newsData}
              loading={loading}
              loadingMore={loadingMore}
              loadMoreMobile={loadMoreMobile}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              currentPage={currentPage}
              setCurrentPage={setCurrentPage}
              activeTopic={activeTopic}
              setActiveTopic={setActiveTopic}
              activeNav={activeNav}
              setActiveNav={setActiveNav}
            />
          }
        />
        <Route
          path="/news/:id"
          element={<NewsDetailPage news={newsData.items} searchQuery={searchQuery} setSearchQuery={setSearchQuery} />}
        />
        <Route
          path="/briefing/:id"
          element={<DailyBriefingPage />}
        />
        <Route
          path="/admin/*"
          element={<AdminPage />}
        />
      </Routes>
    </Router>
  );
}

export default App;