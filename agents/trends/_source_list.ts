/**
 * PCB / SMT / EMS information sources — the data file behind Fetch & Merge.
 *
 * This is the "sources.yaml" of the deploy plan (§3) kept in the template's own
 * format (a typed TS constant) so that it ships inside the agent bundle without a
 * YAML dependency. Edit this file to add / disable / re-weight sources; nothing
 * else needs to change.
 *
 * Field guide
 *   type        rss  → fetched with fetch() and parsed by _sources.ts parseFeed()
 *               html → list page; anchors matching linkPattern become candidates
 *                      (sandbox browser when available, plain fetch() otherwise)
 *   lang        language of the source (drives nothing yet; kept for the summariser prompt)
 *   region      where the publisher sits
 *   trust       0–1 weight used when ranking candidates before the Curator
 *   group       plan §3 group (国内优先 / 国内补充 / 海外 / OEM / 展会)
 *   keywordFilter  true → only items matching INDUSTRY_KEYWORDS survive (general-news sites);
 *                  false → vertical sources pass through untouched
 *   mustMatch   extra regex the title/summary must match (e.g. SEMI: packaging/assembly only)
 *   topicHint   default topic when the Curator does not assign one
 *   verified    false until the 5-day trial (plan A5) confirms the URL / pattern works
 */

export type SourceType = 'rss' | 'html';
export type SourceLang = 'zh' | 'en' | 'ja' | 'de';
export type SourceRegion = 'CN' | 'US' | 'EU' | 'JP' | 'KR' | 'GLOBAL';
export type TopicName = '设备' | '材料' | '供应链' | '政策标准' | '展会' | '厂商动态';

export interface TrendSource {
  id: string;
  name: string;
  type: SourceType;
  url: string;
  lang: SourceLang;
  region: SourceRegion;
  trust: number;
  group: string;
  enabled: boolean;
  keywordFilter: boolean;
  /** Regex (string) an anchor href must match to be treated as an article link (html only). */
  linkPattern?: string;
  /** Regex (string) title+summary must match (applied after keywordFilter). */
  mustMatch?: string;
  topicHint?: TopicName;
  verified: boolean;
  notes?: string;
}

/** Bilingual keyword gate for general-news sources (lower-cased substring match). */
export const INDUSTRY_KEYWORDS: string[] = [
  // process / product
  'pcb', 'smt', 'ems', 'smd', 'pcba', 'hdi', 'fpc', 'aoi', 'spi', 'x-ray', 'x射线',
  'reflow', 'solder', 'stencil', 'pick-and-place', 'pick and place', 'placement', 'feeder',
  'reel', 'msd', 'kitting', 'assembly', 'packaging', 'substrate', 'copper clad', 'laminate',
  '电子制造', '贴片', '回流焊', '印刷电路板', '线路板', '电路板', '覆铜板', '载板', '柔性板',
  '焊膏', '锡膏', '钢网', '飞达', '料盘', '料仓', '点料', '湿敏', '元器件', '被动元件', '连接器',
  '装联', '封装', '电子组装', '电子代工', '代工厂',
  // supply chain / policy
  '供应链', '关税', '出口管制', '分销', 'distributor', 'tariff', 'export control', 'supply chain',
  'ipc-', 'ipc standard', 'j-std', '标准', 'cpca',
  // vendors (factual attribution only — never used as category terms)
  'fuji', 'yamaha', 'juki', 'asmpt', 'asm pacific', 'mycronic', 'koh young', 'panasonic connect',
  'hanwha', 'siplace', 'nordson', 'koh-young',
  // shows
  'nepcon', 'productronica', 'apex expo', 'ipc apex', 'smtconnect', 'smt connect', '慕尼黑电子',
];

export const SOURCES: TrendSource[] = [
  // ── 国内优先 ──────────────────────────────────────────────────────────────
  {
    id: 'cpca', name: 'CPCA 中国电子电路行业协会', type: 'html', url: 'http://www.cpca.org.cn/',
    lang: 'zh', region: 'CN', trust: 0.9, group: '国内优先', enabled: true, keywordFilter: false,
    linkPattern: '/(news|xhdt|hyxx|zxzx|info)[^"]*\\.(html|shtml)|/[a-z]+/\\d+\\.html', topicHint: '政策标准',
    verified: false, notes: '未确认 RSS；列表页结构待试跑确认',
  },
  {
    id: 'cena', name: '中国电子报', type: 'html', url: 'https://www.cena.com.cn/',
    lang: 'zh', region: 'CN', trust: 0.85, group: '国内优先', enabled: true, keywordFilter: true,
    linkPattern: 'cena\\.com\\.cn/.+/\\d{4}[-/]\\d{2}[-/]\\d{2}/.+\\.html|cena\\.com\\.cn/[a-z]+/\\d+\\.html',
    verified: false, notes: 'epaper.cena.com.cn 为电子报版面，暂用门户站',
  },
  // ── 国内补充 ──────────────────────────────────────────────────────────────
  {
    id: 'elecfans', name: '电子发烧友', type: 'html', url: 'https://www.elecfans.com/news/',
    lang: 'zh', region: 'CN', trust: 0.6, group: '国内补充', enabled: true, keywordFilter: true,
    linkPattern: 'elecfans\\.com/[a-z]+/\\d+\\.html', verified: false, notes: '厂商稿多，依赖 Curator 过滤',
  },
  {
    id: 'ijiwei', name: '集微网', type: 'html', url: 'https://www.ijiwei.com/',
    lang: 'zh', region: 'CN', trust: 0.65, group: '国内补充', enabled: true, keywordFilter: true,
    linkPattern: '(ijiwei|laoyaoba)\\.com/(n|news)/\\d+', verified: false, notes: '芯片投资稿多，Curator 丢弃',
  },
  {
    id: 'semiinsights', name: '半导体行业观察', type: 'html', url: 'https://www.semiinsights.com/',
    lang: 'zh', region: 'CN', trust: 0.6, group: '国内补充', enabled: true, keywordFilter: true,
    linkPattern: 'semiinsights\\.com/s/[^"]+', verified: false, notes: '仅取封装/装联/设备相关',
  },
  {
    id: 'esmchina', name: '国际电子商情', type: 'html', url: 'https://www.esmchina.com/news',
    lang: 'zh', region: 'CN', trust: 0.7, group: '国内补充', enabled: true, keywordFilter: true,
    linkPattern: 'esmchina\\.com/news/\\d+', topicHint: '供应链', verified: false,
  },
  // ── 海外 ──────────────────────────────────────────────────────────────────
  {
    id: 'smt007', name: 'SMT007 (I-Connect007)', type: 'html', url: 'https://smt.iconnect007.com/',
    lang: 'en', region: 'US', trust: 0.9, group: '海外', enabled: true, keywordFilter: false,
    linkPattern: 'iconnect007\\.com/(article|index\\.php/article)/\\d+', verified: false,
    notes: 'RSS 在登录墙后 → 网页',
  },
  {
    id: 'pcb007', name: 'PCB007 (I-Connect007)', type: 'html', url: 'https://pcb.iconnect007.com/',
    lang: 'en', region: 'US', trust: 0.85, group: '海外', enabled: true, keywordFilter: false,
    linkPattern: 'iconnect007\\.com/(article|index\\.php/article)/\\d+', topicHint: '材料', verified: false,
  },
  {
    id: 'emsnow', name: 'EMSNOW', type: 'rss', url: 'https://www.emsnow.com/feed/',
    lang: 'en', region: 'US', trust: 0.85, group: '海外', enabled: true, keywordFilter: false, verified: false,
  },
  {
    id: 'evertiq', name: 'Evertiq', type: 'rss', url: 'https://evertiq.com/rss',
    lang: 'en', region: 'EU', trust: 0.8, group: '海外', enabled: true, keywordFilter: false, verified: false,
    notes: 'RSS 地址待确认；失败则改 html https://evertiq.com/',
  },
  {
    id: 'gea', name: 'Global Electronics Association (formerly IPC)', type: 'html',
    url: 'https://www.electronics.org/news', lang: 'en', region: 'GLOBAL', trust: 0.9, group: '海外',
    enabled: true, keywordFilter: false, linkPattern: 'electronics\\.org/(news|press|blog)/[^"]+',
    topicHint: '政策标准', verified: false, notes: '原 ipc.org；旧域名可能 301',
  },
  {
    id: 'semi', name: 'SEMI', type: 'html', url: 'https://www.semi.org/en/news-media-press-releases',
    lang: 'en', region: 'GLOBAL', trust: 0.75, group: '海外', enabled: true, keywordFilter: false,
    linkPattern: 'semi\\.org/en/(news-media-press|blogs|news)[^"]*',
    mustMatch: 'packag|assembl|substrate|advanced packaging|封装|装联', topicHint: '供应链', verified: false,
    notes: '仅封装/装联',
  },
  // ── OEM 新闻室（只取原始公告，名称仅作事实归属）──────────────────────────────
  {
    id: 'fuji', name: 'Fuji Corporation', type: 'html', url: 'https://www.fuji.co.jp/en/news/',
    lang: 'en', region: 'JP', trust: 0.8, group: 'OEM', enabled: true, keywordFilter: false,
    linkPattern: 'fuji\\.co\\.jp/en/news/[^"]+', topicHint: '厂商动态', verified: false,
  },
  {
    id: 'yamaha', name: 'Yamaha Motor Robotics (SMT)', type: 'html',
    url: 'https://global.yamaha-motor.com/business/smt/news/', lang: 'en', region: 'JP', trust: 0.8, group: 'OEM',
    enabled: true, keywordFilter: false, linkPattern: 'yamaha-motor\\.com/business/smt/news/[^"]+',
    topicHint: '厂商动态', verified: false,
  },
  {
    id: 'juki', name: 'JUKI Automation', type: 'html', url: 'https://www.jukiautomation.com/news/',
    lang: 'en', region: 'JP', trust: 0.75, group: 'OEM', enabled: true, keywordFilter: false,
    linkPattern: 'jukiautomation\\.com/[^"]*news[^"]*', topicHint: '厂商动态', verified: false,
  },
  {
    id: 'asmpt', name: 'ASMPT SMT Solutions', type: 'html', url: 'https://smt.asmpt.com/en/news/',
    lang: 'en', region: 'EU', trust: 0.8, group: 'OEM', enabled: true, keywordFilter: false,
    linkPattern: 'asmpt\\.com/en/news/[^"]+', topicHint: '厂商动态', verified: false,
  },
  {
    id: 'mycronic', name: 'Mycronic', type: 'html', url: 'https://www.mycronic.com/en/news/',
    lang: 'en', region: 'EU', trust: 0.8, group: 'OEM', enabled: true, keywordFilter: false,
    linkPattern: 'mycronic\\.com/en/news/[^"]+', topicHint: '厂商动态', verified: false,
  },
  {
    id: 'kohyoung', name: 'Koh Young', type: 'html', url: 'https://kohyoung.com/en/news/',
    lang: 'en', region: 'KR', trust: 0.75, group: 'OEM', enabled: true, keywordFilter: false,
    linkPattern: 'kohyoung\\.com/en/[^"]*news[^"]*', topicHint: '厂商动态', verified: false,
  },
  // ── 展会（事件时间字段必填 → Summarizer 提示词要求）────────────────────────
  {
    id: 'nepcon', name: 'NEPCON China / Asia', type: 'html', url: 'https://www.nepconchina.com/',
    lang: 'zh', region: 'CN', trust: 0.7, group: '展会', enabled: true, keywordFilter: false,
    linkPattern: 'nepcon(china|asia)\\.com/[^"]*(news|press|zh|en)[^"]*', topicHint: '展会', verified: false,
  },
  {
    id: 'productronica', name: 'productronica', type: 'html', url: 'https://productronica.com/en/newsroom/',
    lang: 'en', region: 'EU', trust: 0.75, group: '展会', enabled: true, keywordFilter: false,
    linkPattern: 'productronica\\.com/en/[^"]+', topicHint: '展会', verified: false,
  },
  {
    id: 'ipcapex', name: 'IPC APEX EXPO', type: 'html', url: 'https://www.ipcapexexpo.org/',
    lang: 'en', region: 'US', trust: 0.75, group: '展会', enabled: true, keywordFilter: false,
    linkPattern: 'ipcapexexpo\\.org/[^"]+', topicHint: '展会', verified: false,
  },
];

export function enabledSources(list: TrendSource[] = SOURCES): TrendSource[] {
  return list.filter(s => s.enabled);
}

export function sourceById(id: string, list: TrendSource[] = SOURCES): TrendSource | undefined {
  return list.find(s => s.id === id);
}
