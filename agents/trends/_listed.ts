/**
 * Listed-company collector (plan §2): public disclosures + official newsrooms only.
 *
 *   cninfo   A-share announcements (POST hisAnnouncement/query with code,orgId) — reports / 预告 / 快报 / capacity+orders
 *   hkex     HKEXnews titleSearchServlet (stockId via prefix.do) — results / reports / voluntary business announcements
 *   edgar    SEC EDGAR atom by ticker — 8-K (Item 2.02 press release EX-99.1 summarised), 10-Q / 10-K listed
 *   rss      newsroom RSS (Koh Young) · page_fuji / page_cision: newsroom HTML anchors
 *
 * Output items feed `buildListedDoc()`; the model is called ONLY for new items with text (8-K exhibits, news bodies),
 * capped per run. Policy (absolute words, competitor names, sales words) is enforced in code after the model.
 */

import { createHash } from 'node:crypto';
import { OpenAI } from 'openai';

import { buildOpenAIClientOptions } from './_model.js';
import { checkNeotelNote, checkSummary, clampSummary } from './_policy.js';
import { cleanText, extractAnchors, parseFeed } from './_sources.js';
import { LISTED_COMPANIES, LISTED_TOOLS, type ListedCompany, type Tier } from './_listed_companies.js';

export type ListedKind = 'report' | 'preview' | 'capacity' | 'news';

export interface ListedItem {
  id: string;
  company: string;
  tier: Tier;
  kind: ListedKind;
  title: string;
  url: string;
  date: string;          // YYYY-MM-DD
  source: string;        // platform label shown on the page (巨潮资讯 / HKEXnews / SEC EDGAR / 官方新闻)
  summaryZh: string;     // ≤ 60 chars, facts only
  note: string;          // 挚锦解读 (≤ 60 chars) or ''
  tool: string;          // key of LISTED_TOOLS or ''
  toolHref?: string;
  toolLabel?: string;
  competitor?: boolean;
  text?: string;         // transient: body text used for the model call (not persisted)
}

export interface ListedDoc {
  kind: 'listed';
  runId: string;
  generatedAt: string;
  windowDays: number;
  companies: number;
  items: ListedItem[];
  bySource: Record<string, number>;
  errors: string[];
  modelCalls: number;
}

const UA = 'Mozilla/5.0 (compatible; NeotelBrief/1.0; +https://www.neotel.tech/blog/industry-news; info@neotel.tech)';
const SOURCE_LABEL: Record<string, string> = { cninfo: '巨潮资讯', hkex: 'HKEXnews', edgar: 'SEC EDGAR', rss: '官方新闻', page_fuji: '官方新闻', page_cision: '官方新闻' };

// ── HTTP ──────────────────────────────────────────────────────────────────────
async function fetchText(url: string, init: RequestInit = {}, timeoutMs = 20000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { redirect: 'follow', ...init, headers: { 'User-Agent': UA, Accept: '*/*', ...(init.headers as Record<string, string> || {}) }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }
function itemId(platform: string, url: string): string { return `${platform}_${createHash('sha1').update(url).digest('hex').slice(0, 20)}`; }
function ymd(d: Date): string { return d.toISOString().slice(0, 10); }
function daysAgo(n: number): Date { return new Date(Date.now() - n * 86400000); }

// ── classification ───────────────────────────────────────────────────────────
const RE_REPORT = /年度报告|半年度报告|季度报告|年报|半年报|季报|interim report|annual report|quarterly report|10-q|10-k|financial results|results for|quarter results|(quarter|fiscal|annual|full[- ]year)[^.]{0,40}\bresults\b|\bresults\b[^.]{0,20}(quarter|fiscal)|fiscal (first|second|third|fourth) quarter|q[1-4] (fy)?\d{2,4}|earnings|业绩公告|中期业绩|全年业绩|決算/i;
const RE_PREVIEW = /业绩预告|业绩快报|盈利预告|盈利警告|profit warning|guidance/i;
const RE_CAPACITY = /扩产|产能|新建|投资建设|生产基地|项目投产|中标|重大合同|订单|签订|投资协议|收购|战略合作|新工厂|新厂|capacity|expansion|new facility|new plant|acquisition|acquire|contract award|order|investment|opens|opening|groundbreaking|manufacturing site/i;
// A-share announcement noise we never show
const RE_NOISE = /减持|增持计划|股权激励|回购|解除限售|解禁|董事会决议|监事会|股东会|股东大会|独立董事|律师事务所|法律意见|关联交易|担保|理财|募集资金|存放|自查|问询函|回复|简式权益|变更注册资本|公司章程|辞职|聘任|选举|会计政策|审计|议事规则|制度|投资者关系活动|说明会|停牌|复牌|异常波动|风险提示|可转债|转股价|付息|派息|分红|利润分配|除权|质押|冻结|诉讼|仲裁|更名|证券简称|自愿性?信息披露暂缓|重大资产重组进展|专项|监管|处罚|警示|限制性股票|期权|激励对象|自愿性披露|ESG|环境、社会及管治|environmental, social|次第|list of directors|monthly return|翌日披露|next day disclosure|forms? of proxy|notice of (annual|extraordinary) general|circular|通函|代表委任|会议通告|constitution|memorandum/i;

function classify(title: string, platform: string, form?: string): ListedKind | null {
  const t = title || '';
  if (platform === 'cninfo' || platform === 'hkex') {
    if (RE_NOISE.test(t)) return null;
    if (RE_PREVIEW.test(t)) return 'preview';
    if (RE_REPORT.test(t)) return 'report';
    if (RE_CAPACITY.test(t)) return 'capacity';
    return null;             // other announcements are noise for this audience
  }
  if (platform === 'edgar') {
    if (form === '10-Q' || form === '10-K' || form === '20-F' || form === '40-F') return 'report';
    if (form === '8-K') return RE_REPORT.test(t) ? 'report' : (RE_CAPACITY.test(t) ? 'capacity' : 'news');
    return null;
  }
  if (RE_PREVIEW.test(t)) return 'preview';
  if (RE_REPORT.test(t)) return 'report';
  if (RE_CAPACITY.test(t)) return 'capacity';
  return 'news';
}

// ── cninfo ───────────────────────────────────────────────────────────────────
let cninfoOrgIds: Record<string, string> | null = null;
async function cninfoOrgId(code: string): Promise<string | null> {
  if (!cninfoOrgIds) {
    const raw = await fetchText('http://www.cninfo.com.cn/new/data/szse_stock.json');
    const list = (JSON.parse(raw).stockList || []) as Array<{ code: string; orgId: string }>;
    cninfoOrgIds = Object.fromEntries(list.map(s => [s.code, s.orgId]));
  }
  return cninfoOrgIds[code] || null;
}

async function collectCninfo(c: ListedCompany, since: Date, limit = 30): Promise<ListedItem[]> {
  const orgId = await cninfoOrgId(c.id);
  if (!orgId) throw new Error(`cninfo orgId not found for ${c.id}`);
  const column = c.id.startsWith('6') ? 'sse' : 'szse';
  const form = new URLSearchParams({
    pageNum: '1', pageSize: String(limit), column, tabName: 'fulltext', plate: '', stock: `${c.id},${orgId}`,
    searchkey: '', secid: '', category: '', trade: '', seDate: `${ymd(since)}~${ymd(new Date())}`, sortName: '', sortType: '', isHLtitle: 'true',
  });
  const raw = await fetchText('http://www.cninfo.com.cn/new/hisAnnouncement/query', {
    method: 'POST', body: form.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Referer: 'http://www.cninfo.com.cn/' },
  });
  const anns = (JSON.parse(raw).announcements || []) as Array<{ announcementTitle: string; adjunctUrl: string; announcementTime: number }>;
  const out: ListedItem[] = [];
  for (const a of anns) {
    const title = cleanText(a.announcementTitle).replace(/<[^>]+>/g, '');
    if (/摘要$/.test(title)) continue;                          // keep the full report, not its 摘要 twin
    const kind = classify(title, 'cninfo');
    if (!kind) continue;
    const url = `http://static.cninfo.com.cn/${a.adjunctUrl}`;
    out.push({ id: itemId('cninfo', url), company: c.name, tier: c.tier, kind, title, url, date: ymd(new Date(a.announcementTime)),
      source: SOURCE_LABEL.cninfo, summaryZh: '', note: '', tool: '', competitor: !!c.competitor });
  }
  return out;
}

// ── HKEX ─────────────────────────────────────────────────────────────────────
async function hkexStockId(code: string): Promise<string | null> {
  const raw = await fetchText(`https://www1.hkexnews.hk/search/prefix.do?callback=callback&lang=EN&type=A&name=${code.replace(/^0+/, '')}&market=SEHK`);
  const m = raw.match(/"stockId":"?(\d+)"?,"code":"(\d+)"/g) || [];
  for (const s of m) {
    const mm = s.match(/"stockId":"?(\d+)"?,"code":"(\d+)"/);
    if (mm && mm[2] === code) return mm[1];
  }
  const first = raw.match(/"stockId":"?(\d+)/);
  return first ? first[1] : null;
}

async function collectHkex(c: ListedCompany, since: Date): Promise<ListedItem[]> {
  const sid = await hkexStockId(c.id);
  if (!sid) throw new Error(`hkex stockId not found for ${c.id}`);
  const fmt = (d: Date) => ymd(d).replace(/-/g, '');
  const q = new URLSearchParams({ sortDir: '0', sortByOptions: 'DateTime', category: '0', market: 'SEHK', stockId: sid, documentType: '-1',
    fromDate: fmt(since), toDate: fmt(new Date()), title: '', searchType: '1', t1code: '-2', t2Gcode: '-2', t2code: '-2', rowRange: '60', lang: 'E' });
  const raw = await fetchText(`https://www1.hkexnews.hk/search/titleSearchServlet.do?${q}`);
  const j = JSON.parse(raw);
  const rows = (typeof j.result === 'string' ? JSON.parse(j.result) : j.result || []) as Array<{ TITLE: string; FILE_LINK: string; DATE_TIME: string }>;
  const out: ListedItem[] = [];
  for (const r of rows) {
    const title = cleanText(r.TITLE);
    const kind = classify(title, 'hkex');
    if (!kind) continue;
    const url = `https://www1.hkexnews.hk${r.FILE_LINK}`;
    const dm = String(r.DATE_TIME || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
    out.push({ id: itemId('hkex', url), company: c.name, tier: c.tier, kind, title, url, date: dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : ymd(new Date()),
      source: SOURCE_LABEL.hkex, summaryZh: '', note: '', tool: '', competitor: !!c.competitor });
  }
  return out;
}

// ── SEC EDGAR ────────────────────────────────────────────────────────────────
const EDGAR_HEADERS = { 'User-Agent': 'Neotel Technology info@neotel.tech (industry brief bot)', Accept: 'application/atom+xml, text/html;q=0.9' };

async function edgarAtom(ticker: string, form: string, count = 8): Promise<Array<{ title: string; url: string; date: string; form: string }>> {
  const raw = await fetchText(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${ticker}&type=${form}&dateb=&owner=include&count=${count}&output=atom`, { headers: EDGAR_HEADERS });
  const entries = raw.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  return entries.map(e => {
    const title = cleanText((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '');
    const url = ((e.match(/<link[^>]*href="([^"]+)"/) || [])[1] || '').replace(/&amp;/g, '&');
    const date = ((e.match(/<updated>([\s\S]*?)<\/updated>/) || [])[1] || '').slice(0, 10);
    const f = (title.match(/^([0-9A-Z-]+)\s/) || [])[1] || form;
    return { title, url, date, form: f };
  }).filter(x => x.url);
}

/** For an 8-K: find the EX-99.1 press release in the filing index and return its visible text (≤ 7000 chars). */
async function edgarPressRelease(indexUrl: string): Promise<{ url: string; text: string } | null> {
  const idx = await fetchText(indexUrl, { headers: EDGAR_HEADERS });
  const rows = idx.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows) {
    if (!/EX-99\.1/i.test(row)) continue;
    const href = (row.match(/href="([^"]+\.htm[l]?)"/i) || [])[1];
    if (!href) continue;
    const url = new URL(href.replace('/ix?doc=', ''), 'https://www.sec.gov').href;
    const html = await fetchText(url, { headers: EDGAR_HEADERS }, 25000);
    const text = cleanText(html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' '))
      .replace(/^EX-99\.\d+\s+\d+\s+\S+\.htm[l]?\s+EX-99\.\d+\s+Document\s*/i, '')   // SEC SGML header line
      .slice(0, 7000);
    return { url, text };
  }
  return null;
}

async function collectEdgar(c: ListedCompany, since: Date): Promise<ListedItem[]> {
  const out: ListedItem[] = [];
  const sinceYmd = ymd(since);
  for (const form of ['8-K', '10-Q', '10-K']) {
    let entries: Array<{ title: string; url: string; date: string; form: string }> = [];
    try { entries = await edgarAtom(c.id, form); } catch (e) { console.warn(`[listed] edgar ${c.id} ${form}:`, e instanceof Error ? e.message : e); continue; }
    for (const e of entries) {
      if (e.date < sinceYmd) continue;
      let kind = classify(e.title, 'edgar', e.form);
      if (!kind) continue;
      let title = form === '8-K' ? `8-K 临时报告` : (form === '10-Q' ? '10-Q 季度报告' : '10-K 年度报告');
      let url = e.url, text = '';
      if (form === '8-K') {
        try {
          const pr = await edgarPressRelease(e.url);
          if (!pr) continue;               // 8-Ks without a press release (e.g. Item 5.02 governance) are skipped
          url = pr.url; text = pr.text;
          const head = cleanText(text.slice(0, 220));
          title = head.length > 20 ? head.slice(0, 110) : title;
          // the atom title is always "8-K - Current report": classify on the press-release headline instead
          if (RE_REPORT.test(head)) kind = 'report'; else if (RE_CAPACITY.test(head)) kind = 'capacity';
        } catch (err) { console.warn(`[listed] edgar exhibit ${c.id}:`, err instanceof Error ? err.message : err); continue; }
        await sleep(350);                   // SEC fair-use: < 10 req/s
      }
      out.push({ id: itemId('edgar', url), company: c.name, tier: c.tier, kind, title, url, date: e.date, source: SOURCE_LABEL.edgar,
        summaryZh: '', note: '', tool: '', competitor: !!c.competitor, text });
    }
    await sleep(350);
  }
  return out;
}

// ── RSS / newsroom pages ─────────────────────────────────────────────────────
async function collectRssCompany(c: ListedCompany, since: Date): Promise<ListedItem[]> {
  const xml = await fetchText(c.id);
  return parseFeed(xml, c.id).filter(e => !e.publishedAt || e.publishedAt.slice(0, 10) >= ymd(since)).slice(0, 15).map(e => {
    const kind = classify(e.title, 'rss') || 'news';
    return { id: itemId('rss', e.url), company: c.name, tier: c.tier, kind, title: e.title, url: e.url, date: (e.publishedAt || new Date().toISOString()).slice(0, 10),
      source: SOURCE_LABEL.rss, summaryZh: '', note: '', tool: '', competitor: !!c.competitor, text: e.summary || '' } as ListedItem;
  });
}

async function collectPage(c: ListedCompany, linkPattern: string, limit = 12): Promise<ListedItem[]> {
  // Fuji's /en/news/ is only an index of year pages → read the current year's list
  const pageUrl = c.platform === 'page_fuji' ? `${c.id.replace(/\/?$/, '/')}${new Date().getFullYear()}/` : c.id;
  const html = await fetchText(pageUrl);
  const anchors = extractAnchors(html, pageUrl, linkPattern, 60).filter(a => !/^\/en\/news\/\d{4}\/?$/.test(new URL(a.url).pathname)).slice(0, limit);
  const out: ListedItem[] = [];
  const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
  for (const a of anchors) {
    let title = a.title, date = '';
    // Fuji anchor text = "Aug 31, 2026 Notices IR Notice of Second Quarter …" → date + category prefix → strip
    const dm = title.match(/^([A-Z][a-z]{2})\.?\s+(\d{1,2}),\s+(20\d{2})\s+(?:(?:Notices|News|Press|IR|Releases?)\s+)*(.+)$/);
    if (dm) { date = `${dm[3]}-${MONTHS[dm[1].toLowerCase()] || '01'}-${dm[2].padStart(2, '0')}`; title = dm[4].trim(); }
    if (!date) {
      const um = a.url.match(/(20\d{2})(\d{2})(\d{2})\.html|\/(20\d{2})[/-](\d{2})(?:[/-](\d{2}))?/);
      date = um ? (um[1] ? `${um[1]}-${um[2]}-${um[3]}` : `${um[4]}-${um[5]}-${um[6] || '01'}`) : ymd(new Date());
    }
    const kind = classify(title, c.platform) || 'news';
    out.push({ id: itemId(c.platform, a.url), company: c.name, tier: c.tier, kind, title, url: a.url, date, source: SOURCE_LABEL[c.platform],
      summaryZh: '', note: '', tool: '', competitor: !!c.competitor, text: '' });
  }
  return out;
}

// ── orchestration ────────────────────────────────────────────────────────────
export async function collectListed(windowDays = 30, companies: ListedCompany[] = LISTED_COMPANIES, onProgress?: (msg: string) => void): Promise<{ items: ListedItem[]; bySource: Record<string, number>; errors: string[] }> {
  const since = daysAgo(windowDays);
  const items: ListedItem[] = []; const errors: string[] = []; const bySource: Record<string, number> = {};
  let n = 0;
  for (const c of companies) {
    n++;
    if (onProgress && (n % 5 === 0 || n === companies.length)) onProgress(`${n}/${companies.length} ${c.name}`);
    try {
      let got: ListedItem[] = [];
      if (c.platform === 'cninfo') got = await collectCninfo(c, since);
      else if (c.platform === 'hkex') got = await collectHkex(c, since);
      else if (c.platform === 'edgar') got = await collectEdgar(c, since);
      else if (c.platform === 'rss') got = await collectRssCompany(c, since);
      else if (c.platform === 'page_fuji') got = await collectPage(c, '/en/news/\\d{4}|/en/news/[a-z0-9_-]+\\.html');
      else if (c.platform === 'page_cision') got = await collectPage(c, 'news\\.cision\\.com/mycronic-ab/r/');
      bySource[c.platform] = (bySource[c.platform] || 0) + got.length;
      items.push(...got);
      await sleep(c.platform === 'cninfo' ? 600 : 300);
    } catch (e) {
      const msg = `${c.name}/${c.platform}: ${e instanceof Error ? e.message : String(e)}`;
      errors.push(msg); console.warn('[listed]', msg);
    }
  }
  const seen = new Set<string>();
  const dedup = items.filter(i => {
    // same URL, or the same disclosure published twice the same day (A-share PDF twins, EN/ZH versions)
    const k1 = i.url.toLowerCase(), k2 = `${i.company}|${i.date}|${i.title.replace(/\s+/g, '').toLowerCase()}`;
    if (seen.has(k1) || seen.has(k2)) return false;
    seen.add(k1); seen.add(k2); return true;
  });
  dedup.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
  return { items: dedup, bySource, errors };
}

// ── model: one JSON call per new item that has text; title-only items get a code summary ──
const SYSTEM = `你是一家 SMT 智能仓储设备公司的行业编辑。读者是电子厂的工艺、物料、采购负责人。
把给你的一条上市公司信息改写成两段：
1. summary：≤70 个汉字的中文事实摘要（一句话，写完整，不要在数字中间断开）。只用原文里有的数字和事实，写明期间与币种（如"2026 上半年，港元"），不要评价，不要形容词。
2. note：只有当这件事与"工厂的物料管理"（库存、盘点、缺料、湿敏、换线、新产线仓储、MES 对接、自动化投资）明确相关时，写一句 ≤50 字的解读，说清"这对读者的仓库意味着什么"，并从工具列表选一个 tool 键；否则 note 留空、tool 留空。
禁止：最/第一/领先/顶级/唯一 等绝对化用语；任何公司之间的比较；试用/报价/联系我们 等销售话术；编造原文没有的数字。
只输出 JSON：{"summary":"…","note":"…","tool":"…"}`;

function fallbackSummary(i: ListedItem): string {
  if (i.kind === 'report') return i.source === '巨潮资讯' || i.source === 'HKEXnews' ? `发布《${i.title}》` : `提交 ${i.title}`;
  if (i.kind === 'preview') return `发布《${i.title}》`;
  return clampSummary(cleanText(i.title), 60);
}

export async function summariseNew(items: ListedItem[], env: Record<string, string | undefined>, maxCalls = 20): Promise<number> {
  const opts = buildOpenAIClientOptions(env);
  const client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL, timeout: 120000 });
  const toolList = Object.entries(LISTED_TOOLS).map(([k, v]) => `${k}：${v.label}（适用：${v.when}）`).join('\n');
  let calls = 0;
  // items with body text first (8-K press releases, news summaries), then title-only
  const order = [...items].sort((a, b) => Number(!!b.text && b.text.length > 200) - Number(!!a.text && a.text.length > 200));
  for (const it of order) {
    if (it.summaryZh) continue;
    const body = (it.text || '').trim();
    if (!body || body.length < 80 || calls >= maxCalls) { it.summaryZh = fallbackSummary(it); continue; }
    try {
      const res = await client.chat.completions.create({
        model: opts.model, temperature: 0.3, response_format: { type: 'json_object' } as any,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content:
          `公司：${it.company}（${it.tier}）\n类型：${it.kind}\n标题：${it.title}\n日期：${it.date}\n原文（截断）：\n${body.slice(0, 6000)}\n\n工具列表：\n${toolList}` }],
      });
      calls++;
      const raw = (res.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as { summary?: string; note?: string; tool?: string };
      let s = clampSummary(cleanText(j.summary || ''), 80);
      if (!s || checkSummary(s).length) s = fallbackSummary(it);
      it.summaryZh = s;
      let note = cleanText(j.note || '').slice(0, 60);
      const tool = j.tool && LISTED_TOOLS[j.tool] ? j.tool : '';
      if (it.competitor || !note || checkNeotelNote(note).length) { note = ''; }
      it.note = note; it.tool = note ? tool : '';
      if (it.tool) { it.toolHref = LISTED_TOOLS[it.tool].href; it.toolLabel = LISTED_TOOLS[it.tool].label; }
    } catch (e) {
      console.warn('[listed] model failed:', e instanceof Error ? e.message : e);
      it.summaryZh = fallbackSummary(it);
    }
  }
  return calls;
}

const CAP: Record<Tier, number> = { equip: 12, ems: 10, comp: 8 };

/** Merge new items with the previous doc (keep `windowDays`), cap per tier, strip transient text. */
export function buildListedDoc(runId: string, fresh: ListedItem[], previous: ListedDoc | null, windowDays: number, bySource: Record<string, number>, errors: string[], modelCalls: number): ListedDoc {
  const since = ymd(daysAgo(windowDays));
  const byId = new Map<string, ListedItem>();
  for (const p of previous?.items || []) if (p.date >= since) byId.set(p.id, p);
  for (const f of fresh) { const prev = byId.get(f.id); byId.set(f.id, { ...f, summaryZh: f.summaryZh || prev?.summaryZh || '', note: f.note || prev?.note || '', tool: f.tool || prev?.tool || '', toolHref: f.toolHref || prev?.toolHref, toolLabel: f.toolLabel || prev?.toolLabel, text: undefined }); }
  const all = [...byId.values()].sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
  const perTier: Record<Tier, number> = { equip: 0, ems: 0, comp: 0 };
  const items = all.filter(i => { if (perTier[i.tier] >= CAP[i.tier]) return false; perTier[i.tier]++; return true; }).map(i => ({ ...i, text: undefined }));
  return { kind: 'listed', runId, generatedAt: new Date().toISOString(), windowDays, companies: LISTED_COMPANIES.length, items, bySource, errors, modelCalls };
}
