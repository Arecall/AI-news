import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import axios from 'axios';
import App, { NewsDetailPage, calculateHotScore, getEngagement } from './App.jsx';

// Mock IntersectionObserver
const mockObserve = vi.fn();
const mockUnobserve = vi.fn();
const mockDisconnect = vi.fn();

window.IntersectionObserver = vi.fn().mockImplementation(function (callback, options) {
  return {
    observe: mockObserve,
    unobserve: mockUnobserve,
    disconnect: mockDisconnect,
  };
});

vi.mock('axios');

const mockNewsResponse = (items = [], total = items.length) => ({
  data: {
    items,
    total,
    page: 1,
    pageSize: 12,
    totalPages: Math.max(1, Math.ceil(total / 12)),
  },
});

const mockCountResponse = (count) => ({
  data: { count },
});

const sampleNews = [
  {
    id: 1,
    title: 'OpenAI 发布新模型',
    summary: '推理能力大幅提升',
    content: '详情内容',
    source: 'OpenAI',
    imageUrl: '/images/test.png',
    createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  },
  {
    id: 2,
    title: 'Claude 升级版发布',
    summary: '上下文支持极大增强',
    content: '详情内容2',
    source: 'Anthropic',
    imageUrl: '/images/test2.png',
    createdAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
  },
];

describe('App 首页渲染', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    axios.get.mockImplementation((url) => {
      if (url.includes('/api/news/count')) return Promise.resolve(mockCountResponse(123));
      if (url.includes('/api/news')) return Promise.resolve(mockNewsResponse(sampleNews, 123));
      if (url.includes('/api/briefings/pair')) return Promise.resolve({ data: { morning: null, evening: null, layout: 'bento' } });
      return Promise.reject(new Error(`未 mock 的请求: ${url}`));
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('首页能正常挂载并显示总量信息（不抛 totalCount 错误）', async () => {
    render(<App />);

    // 关键行为 1：HomePage 不再因 totalCount 报错而崩溃，品牌标题挂载成功
    await waitFor(() => {
      expect(screen.getByText('AI 新闻快讯')).toBeInTheDocument();
    });

    // 关键行为 2：count 接口返回 of 123 should be displayed in the list of total count
    await waitFor(() => {
      expect(document.querySelector('.live-meta')).toHaveTextContent(/123/);
    });
  });

  it('轮播图 3s 自动切换', async () => {
    vi.useFakeTimers();

    render(<App />);

    // 推进时间让 axios mock 得到解析并重新渲染
    await act(async () => {
      await vi.runAllTicks();
    });

    const carouselContainer = document.querySelector('.hot-carousel');
    expect(carouselContainer).toHaveTextContent('推理能力大幅提升');
    expect(carouselContainer).not.toHaveTextContent('上下文支持极大增强');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(carouselContainer).toHaveTextContent('上下文支持极大增强');
    expect(carouselContainer).not.toHaveTextContent('推理能力大幅提升');

    // 测试鼠标悬停暂停轮播
    const hotSection = document.querySelector('.hot-section');
    await act(async () => {
      fireEvent.mouseEnter(hotSection);
    });

    // 快进 3 秒
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    // 此时应该依然是当前新闻，不发生切换
    expect(carouselContainer).toHaveTextContent('上下文支持极大增强');
    expect(carouselContainer).not.toHaveTextContent('推理能力大幅提升');

    // 鼠标离开恢复轮播
    await act(async () => {
      fireEvent.mouseLeave(hotSection);
    });

    // 快进 3 秒
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    // 此时应该切换到第一条新闻
    expect(carouselContainer).toHaveTextContent('推理能力大幅提升');
    expect(carouselContainer).not.toHaveTextContent('上下文支持极大增强');
    vi.useRealTimers();
  });
});

describe('NewsDetailPage 详情页渲染与动效', () => {
  const mockNews = [
    {
      id: 99,
      title: '产品发布会震撼来袭',
      summary: '揭秘全新动效设计',
      content: '## 新特性\n\n这是一个极其酷炫的产品级发布详情页。\n\n> 动效改变一切。\n\n- 视差滚动\n- 弹簧阻尼\n- 滚动入场',
      source: 'TechCrunch',
      imageUrl: '/images/launch.png',
      createdAt: '2026-07-20T12:00:00Z',
      originalUrl: 'https://techcrunch.com/launch',
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockObserve.mockClear();
    mockUnobserve.mockClear();
  });

  it('能成功渲染发布会风格的标题、来源、原文链接及悬浮返回胶囊', async () => {
    // 渲染带有路由参数的详情页
    render(
      <MemoryRouter initialEntries={['/news/99']}>
        <Routes>
          <Route
            path="/news/:id"
            element={<NewsDetailPage news={mockNews} searchQuery="" setSearchQuery={() => {}} />}
          />
        </Routes>
      </MemoryRouter>
    );

    // 验证标题和元数据正确渲染
    expect(screen.getAllByText('产品发布会震撼来袭').length).toBeGreaterThan(0);
    expect(screen.getAllByText('TechCrunch').length).toBeGreaterThan(0);

    // 验证返回链接与胶囊存在
    const backBtn = screen.getAllByLabelText('返回资讯流')[0];
    expect(backBtn).toBeInTheDocument();

    // 验证原文链接存在且地址正确
    const originalLink = screen.getByText('访问官方原文').closest('a');
    expect(originalLink).toHaveAttribute('href', 'https://techcrunch.com/launch');
  });

  it('会为所有 markdown 渲染的直接子节点应用滚动渐显类，并注册至 IntersectionObserver', async () => {
    render(
      <MemoryRouter initialEntries={['/news/99']}>
        <Routes>
          <Route
            path="/news/:id"
            element={<NewsDetailPage news={mockNews} searchQuery="" setSearchQuery={() => {}} />}
          />
        </Routes>
      </MemoryRouter>
    );

    // 验证 markdown 解析内容存在
    await waitFor(() => {
      expect(screen.getByText('新特性')).toBeInTheDocument();
    });

    // 验证是否在 markdown 内容的子元素上添加了动效相关的 class: reveal-on-scroll
    const markdownBody = document.querySelector('.markdown-body');
    expect(markdownBody).toBeInTheDocument();

    const children = markdownBody.children;
    expect(children.length).toBeGreaterThan(0);

    // 每一个子元素都应该被附加上 reveal-on-scroll 类
    Array.from(children).forEach((child) => {
      expect(child).toHaveClass('reveal-on-scroll');
    });

    // 验证 intersectionObserver 是否调用了 observe 注册这些元素
    expect(mockObserve).toHaveBeenCalledTimes(children.length);
  });
});

describe('calculateHotScore 综合热度算法', () => {
  it('同等互动量下，更新发布的资讯热度分更高（时效衰减机制）', () => {
    const fixedNow = new Date('2026-06-18T12:00:00Z').getTime();
    const newer = { id: 1, createdAt: '2026-06-18T10:00:00Z', views: 5000, comments: 10 };
    const older = { id: 2, createdAt: '2026-06-17T10:00:00Z', views: 5000, comments: 10 };

    expect(calculateHotScore(newer, fixedNow)).toBeGreaterThan(calculateHotScore(older, fixedNow));
  });

  it('高互动量（爆款）在黄金时间窗口内可超越新入库的冷淡资讯', () => {
    const fixedNow = new Date('2026-06-18T12:00:00Z').getTime();
    // 4 小时前的高互动爆款 (12k 阅读, 50 评论)
    const viral = { id: 1, createdAt: '2026-06-18T08:00:00Z', views: 12000, comments: 50 };
    // 1 小时前的普通冷门资讯 (1k 阅读, 1 评论)
    const coldRecent = { id: 2, createdAt: '2026-06-18T11:00:00Z', views: 1000, comments: 1 };

    expect(calculateHotScore(viral, fixedNow)).toBeGreaterThan(calculateHotScore(coldRecent, fixedNow));
  });

  it('超过 48 小时的历史内容热度自然衰减归低，让位给新生热点', () => {
    const fixedNow = new Date('2026-06-20T12:00:00Z').getTime();
    // 5 天前的高互动老爆款
    const ancient = { id: 1, createdAt: '2026-06-15T12:00:00Z', views: 10000, comments: 30 };
    // 2 小时前的普通新讯
    const fresh = { id: 2, createdAt: '2026-06-20T10:00:00Z', views: 2000, comments: 5 };

    expect(calculateHotScore(ancient, fixedNow)).toBeLessThan(calculateHotScore(fresh, fixedNow));
  });
});
