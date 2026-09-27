import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export type Locale = 'zh' | 'en';

const translations = {
  zh: {
    // Header
    eyebrow: 'PCB / SMT Industry Radar',
    title: 'PCB/SMT 行业趋势',
    subtitle: '按计划采集 PCB / SMT / EMS 行业公开资讯，沉淀为可追溯的行业趋势报告（AI 摘要，以原文为准）。',
    scheduleHint: '每日 09:00（北京时间）自动采集 · 周五 10:00 周报',
    generate: '手动生成',
    generating: '生成中...',
    stop: '停止',

    // Stats bar
    lastGenerated: '最近生成',
    items: '条资讯',
    topics: '个主题',
    source: '源',

    // Pipeline
    stageFetch: '采集',
    stageFilter: '筛选 & 摘要',
    stageAnalyze: '分析',
    stageWrite: '撰写',

    // Live phase hints
    phaseIdle: '准备开始...',
    phaseFetched: '已采集到候选资讯，正在筛选 & 摘要...',
    phaseCurated: '已筛选有价值的内容，正在生成摘要...',
    phaseSummarized: '筛选 & 摘要完成，正在做趋势分析...',
    phaseAnalyzed: '分析完成，正在撰写最终报告...',
    phaseWriting: '正在撰写报告，即将完成...',
    phaseDone: '报告已就绪',

    // Feed
    feedLabel: 'News Feed',
    feedTitle: '资讯流',
    refresh: '刷新',
    newItems: '新增资讯',
    recurring: '持续关注',
    emptyFeed: '暂无资讯明细，点击"手动生成"后会在这里展示。',
    noNewBanner: '今日无新增，以下为近期仍值得关注的资讯。',
    sourceLabel: '源站',
    score: 'score',

    // Sidebar
    reportsLabel: 'Trend Reports',
    reportsTitle: '趋势报告',
    reportCount: '份',
    latest: '最新',
    viewReport: '查看完整报告',
    noSummary: '无摘要',
    noHistory: '暂无历史报告',
    noHistoryHint: '生成后会在这里保留',
    deleteReport: '删除报告',
    confirmDelete: '确定删除这份报告？',

    // Trigger badge
    triggerSchedule: '定时',
    triggerManual: '手动',

    // Status
    statusEmpty: '待生成',
    statusRunning: '生成中',
    statusSuccess: '已完成',
    statusFailed: '失败',

    // Time
    noTime: '尚未生成',
    unknownTime: '未知时间',

    // Mini typing card
    writingReport: '正在撰写报告',
    chars: '字',
    expandClick: '点击展开 →',

    // Drawer
    liveWriting: 'Live Writing',
    fullReport: 'Full Report',
    writingTitle: '正在撰写报告...',
    reportTitle: '趋势报告',

    // Onboarding
    onboardingTitle: '开始你的第一份行业趋势报告',
    onboardingDesc: '从 CPCA、中国电子报、SMT007、EMSNOW、设备厂商新闻室、展会官网等公开来源聚合 PCB / SMT / EMS 行业资讯，通过 4 步 Agent 流水线（采集 → 策展 → 摘要 → 分析）输出可追溯的趋势报告。',
    onboardingFeature1: '多源采集',
    onboardingFeature2: '智能聚类',
    onboardingFeature3: '持续追踪',
    onboardingCta: '立即生成首份报告',
    onboardingGenerating: '正在生成...',

    // Drawer extras
    liveTag: '实时生成中',
    drawerLoading: '加载报告中...',
    reportItems: '条资讯',
    reportNew: '条新增',
    noMoreHistory: '暂无更多历史报告',
    close: '关闭',

    // Live phase tags
    phaseTagFetched: '采集',
    phaseTagCurated: '已筛选',
    phaseTagSummarized: '已摘要',
    otherCategory: '其他',
    unknownTimeLabel: '未知时间',
    fallbackSummary: '动态',

    // Deploy FAB
    deployButton: '一键部署',
    deployDesc: '使用 {link} 部署你自己的行业趋势监控站点。',
    deployLink: 'EdgeOne Makers',
  },
  en: {
    // Header
    eyebrow: 'PCB / SMT Industry Radar',
    title: 'PCB/SMT Industry Trends',
    subtitle: 'Automatically collect, curate and summarize public PCB / SMT / EMS industry news into traceable trend reports (AI summaries — refer to the source).',
    scheduleHint: 'Daily 09:00 Asia/Shanghai · weekly roll-up Fri 10:00',
    generate: 'Generate',
    generating: 'Generating...',
    stop: 'Stop',

    // Stats bar
    lastGenerated: 'Last generated',
    items: 'items',
    topics: 'topics',
    source: 'Sources',

    // Pipeline
    stageFetch: 'Fetch',
    stageFilter: 'Filter & Summarize',
    stageAnalyze: 'Analyze',
    stageWrite: 'Write',

    // Live phase hints
    phaseIdle: 'Preparing...',
    phaseFetched: 'Collected candidates, filtering & summarizing...',
    phaseCurated: 'Filtered valuable content, generating summaries...',
    phaseSummarized: 'Summaries done, analyzing trends...',
    phaseAnalyzed: 'Analysis complete, writing final report...',
    phaseWriting: 'Writing report, almost done...',
    phaseDone: 'Report ready',

    // Feed
    feedLabel: 'News Feed',
    feedTitle: 'News Feed',
    refresh: 'Refresh',
    newItems: 'New Items',
    recurring: 'Ongoing',
    emptyFeed: 'No items yet. Click "Generate" to start.',
    noNewBanner: 'No new items today. Here are recent items still worth noting.',
    sourceLabel: 'Source',
    score: 'score',

    // Sidebar
    reportsLabel: 'Trend Reports',
    reportsTitle: 'Reports',
    reportCount: '',
    latest: 'Latest',
    viewReport: 'View full report',
    noSummary: 'No summary',
    noHistory: 'No report history',
    noHistoryHint: 'Reports will appear here after generation',
    deleteReport: 'Delete report',
    confirmDelete: 'Delete this report?',

    // Trigger badge
    triggerSchedule: 'Scheduled',
    triggerManual: 'Manual',

    // Status
    statusEmpty: 'Pending',
    statusRunning: 'Running',
    statusSuccess: 'Done',
    statusFailed: 'Failed',

    // Time
    noTime: 'Not generated',
    unknownTime: 'Unknown',

    // Mini typing card
    writingReport: 'Writing report',
    chars: 'chars',
    expandClick: 'Click to expand →',

    // Drawer
    liveWriting: 'Live Writing',
    fullReport: 'Full Report',
    writingTitle: 'Writing report...',
    reportTitle: 'Trend Report',

    // Onboarding
    onboardingTitle: 'Generate Your First Industry Trend Report',
    onboardingDesc: 'Aggregate PCB / SMT / EMS news from CPCA, SMT007, EMSNOW, equipment-vendor newsrooms and trade-show sites through a 4-step Agent pipeline (Collect → Curate → Summarize → Analyze) into a traceable trend report.',
    onboardingFeature1: 'Multi-source',
    onboardingFeature2: 'Smart Clustering',
    onboardingFeature3: 'Continuous Tracking',
    onboardingCta: 'Generate first report',
    onboardingGenerating: 'Generating...',

    // Drawer extras
    liveTag: 'Live generating',
    drawerLoading: 'Loading report...',
    reportItems: 'items',
    reportNew: 'new',
    noMoreHistory: 'No more history',
    close: 'Close',

    // Live phase tags
    phaseTagFetched: 'Fetched',
    phaseTagCurated: 'Curated',
    phaseTagSummarized: 'Summarized',
    otherCategory: 'Other',
    unknownTimeLabel: 'Unknown',
    fallbackSummary: 'update',

    // Deploy FAB
    deployButton: 'Deploy',
    deployDesc: 'Deploy your own industry trend monitor with {link}.',
    deployLink: 'EdgeOne Makers',
  },
} as const;

export type TranslationKey = keyof typeof translations['zh'];

const I18nContext = createContext<{
  locale: Locale;
  t: (key: TranslationKey) => string;
  toggleLocale: () => void;
}>({
  locale: 'zh',
  t: (key) => translations.zh[key],
  toggleLocale: () => {},
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('trends-locale');
      if (saved === 'en' || saved === 'zh') return saved;
    }
    return 'zh';
  });

  const toggleLocale = useCallback(() => {
    setLocale(prev => {
      const next = prev === 'zh' ? 'en' : 'zh';
      localStorage.setItem('trends-locale', next);
      return next;
    });
  }, []);

  const t = useCallback((key: TranslationKey): string => {
    return translations[locale][key] ?? key;
  }, [locale]);

  return (
    <I18nContext.Provider value={{ locale, t, toggleLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
