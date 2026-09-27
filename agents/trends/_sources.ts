/**
 * Fetch layer — turns the source list (_source_list.ts) into TrendSourceItem candidates.
 *
 *   rss  → fetch() + parseFeed() (RSS 2.0 / Atom, regex based, no dependencies)
 *   html → sandbox browser (goto + evaluate) when available, otherwise fetch() + anchor regex
 *
 * Nothing here calls a model. All network failures degrade to "0 items from that source"
 * and are logged so the 5-day trial (plan A5) can prune the list.
 */

import { INDUSTRY_KEYWORDS, SOURCES, enabledSources, type TopicName, type TrendSource } from './_source_list.js';
import type { TrendSourceItem } from './_types.js';

export const TOPICS: TopicName[] = ['设备', '材料', '供应链', '政策标准', '展会', '厂商动态'];

const TOPIC_KEYWORDS: Record<TopicName, string[]> = {
  设备: ['placement', 'pick-and-place', 'pick and place', 'reflow', 'aoi', 'spi', 'x-ray', 'printer', 'inspection', 'machine', 'equipment', 'feeder', 'mounter', '贴片机', '回流焊', '印刷机', '检测', '设备', 'x射线', '点料', '料仓', '机器'],
  材料: ['solder', 'paste', 'flux', 'laminate', 'copper', 'substrate', 'material', 'stencil', '焊膏', '锡膏', '覆铜板', '材料', '基板', '载板', '钢网', '助焊剂', 'pcb', '线路板', '电路板'],
  供应链: ['supply', 'shortage', 'inventory', 'distributor', 'tariff', 'export control', 'logistics', 'price', 'capacity', '供应链', '缺货', '库存', '分销', '关税', '出口管制', '产能', '涨价', '交期', 'ems', '代工'],
  政策标准: ['ipc-', 'j-std', 'standard', 'regulation', 'policy', 'subsidy', 'directive', 'rohs', 'reach', '标准', '政策', '法规', '补贴', '规范', '指令', '协会'],
  展会: ['expo', 'exhibition', 'show', 'conference', 'summit', 'nepcon', 'productronica', 'apex', 'smtconnect', '展会', '展览', '博览', '论坛', '峰会', '大会'],
  厂商动态: ['launch', 'announce', 'partnership', 'acquire', 'acquisition', 'appoint', 'opens', 'facility', 'invest', '发布', '推出', '合作', '收购', '任命', '投资', '扩产', '新厂', '签约'],
};

function nowIso(): string {
  return new Date().toISOString();
}

export function cleanText(value: unknown): string {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x2F;/g, '/')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isUrlOnly(value: string): boolean {
  const compact = value.trim().toLowerCase();
  return !compact || /^https?:\/\/\S+$/.test(compact);
}

export function normalizeText(item: TrendSourceItem): string {
  return [item.title, item.summary, item.url].filter(Boolean).join(' ').toLowerCase();
}

export function inferTopic(item: TrendSourceItem, fallback: TopicName = '厂商动态'): TopicName {
  const text = normalizeText(item);
  let best: TopicName | null = null;
  let bestHits = 0;
  for (const topic of TOPICS) {
    const hits = TOPIC_KEYWORDS[topic].filter(k => text.includes(k)).length;
    if (hits > bestHits) { best = topic; bestHits = hits; }
  }
  return best ?? fallback;
}

/** Kept for backward compatibility with the template's report helpers. */
export function inferCategory(item: TrendSourceItem): string {
  return inferTopic(item);
}

export function buildFallbackAiSummary(item: TrendSourceItem): string {
  const cleanedSummary = cleanText(item.summary);
  if (cleanedSummary && !isUrlOnly(cleanedSummary) && cleanedSummary.length >= 16) {
    return cleanedSummary.slice(0, 80);
  }
  const title = cleanText(item.title) || '该动态';
  return title.slice(0, 80);
}

export function matchesIndustry(item: TrendSourceItem, keywords: string[] = INDUSTRY_KEYWORDS): boolean {
  const text = normalizeText(item);
  return keywords.some(keyword => text.includes(keyword.toLowerCase()));
}

/**
 * Apply the industry keyword gate + per-source mustMatch, dedupe by URL, attach a topic
 * guess and a code-generated summary fallback. Vertical sources (keywordFilter=false)
 * skip the keyword gate but still get dedupe/topic/summary treatment.
 */
export function filterIndustryItems(items: TrendSourceItem[], source?: TrendSource, keywords: string[] = INDUSTRY_KEYWORDS): TrendSourceItem[] {
  const seen = new Set<string>();
  const must = source?.mustMatch ? new RegExp(source.mustMatch, 'i') : null;
  const filtered: TrendSourceItem[] = [];

  for (const item of items) {
    if (!item.title || !item.url) continue;
    const applyGate = source ? source.keywordFilter : true;
    if (applyGate && !matchesIndustry(item, keywords)) continue;
    if (must && !must.test(`${item.title} ${item.summary || ''}`)) continue;
    const key = String(item.url || item.title || item.id).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const enriched: TrendSourceItem = {
      ...item,
      summary: cleanText(item.summary),
      category: item.category ?? inferTopic(item, source?.topicHint ?? '厂商动态'),
    };
    filtered.push({ ...enriched, aiSummary: buildFallbackAiSummary(enriched) });
  }
  return filtered;
}

// ── RSS / Atom ────────────────────────────────────────────────────────────────

interface FeedEntry { title: string; url: string; publishedAt?: string; summary?: string }

function pick(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1].trim() : '';
}

/** Decode CDATA/entities without stripping URLs (for <link>/<guid> values). */
function rawValue(value: string): string {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/g, '/')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function toIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(cleanText(value));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Parse RSS 2.0 <item> or Atom <entry> blocks. Regex based — good enough for news feeds. */
export function parseFeed(xml: string, baseUrl?: string): FeedEntry[] {
  const blocks = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>|<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi) || [];
  const entries: FeedEntry[] = [];
  for (const block of blocks) {
    const title = cleanText(pick(block, 'title'));
    let url = rawValue(pick(block, 'link'));
    if (!url) {
      const alt = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i) || block.match(/<link[^>]*href=["']([^"']+)["']/i);
      url = alt ? rawValue(alt[1]) : '';
    }
    if (!url) {
      const guid = rawValue(pick(block, 'guid'));
      if (/^https?:\/\//.test(guid)) url = guid;
    }
    if (!title || !url) continue;
    try { url = new URL(url, baseUrl).href; } catch { continue; }
    const publishedAt = toIso(pick(block, 'pubDate') || pick(block, 'published') || pick(block, 'updated') || pick(block, 'dc:date'));
    const summary = cleanText(pick(block, 'description') || pick(block, 'summary') || pick(block, 'content')).slice(0, 300);
    entries.push({ title, url, publishedAt, summary });
  }
  return entries;
}

async function fetchText(url: string, timeoutMs = 15000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NeotelTrendBot/1.0; +https://www.neotel.tech)',
        'Accept': 'application/rss+xml, application/atom+xml, text/html;q=0.9, */*;q=0.8',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function itemId(sourceId: string, url: string): string {
  return `${sourceId}_${Buffer.from(url).toString('base64url').slice(0, 24)}`;
}

export async function collectRss(source: TrendSource, limit = 20): Promise<TrendSourceItem[]> {
  try {
    const xml = await fetchText(source.url);
    const entries = parseFeed(xml, source.url).slice(0, limit);
    return entries.map(e => ({
      id: itemId(source.id, e.url),
      source: source.name,
      title: e.title,
      url: e.url,
      score: 0,
      publishedAt: e.publishedAt || nowIso(),
      summary: e.summary || '',
      category: source.topicHint,
    }));
  } catch (error) {
    console.warn(`[rss] ${source.id} failed:`, error instanceof Error ? error.message : error);
    return [];
  }
}

// ── HTML list pages ───────────────────────────────────────────────────────────

interface RawAnchor { title: string; url: string; summary?: string }

/** Extract candidate article anchors from raw HTML (no-sandbox fallback). */
export function extractAnchors(html: string, baseUrl: string, linkPattern?: string, limit = 40): RawAnchor[] {
  const pattern = linkPattern ? new RegExp(linkPattern, 'i') : null;
  const out: RawAnchor[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < limit) {
    const href = m[1].trim();
    const text = cleanText(m[2]);
    if (!text || text.length < 8 || text.length > 140) continue;
    let abs: string;
    try { abs = new URL(href, baseUrl).href; } catch { continue; }
    if (pattern && !pattern.test(abs)) continue;
    if (!pattern && new URL(abs).hostname !== new URL(baseUrl).hostname) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push({ title: text, url: abs });
  }
  return out;
}

/** Browser-side extraction script (runs inside sandbox.browser.evaluate). */
function buildExtractScript(linkPattern: string | undefined, limit: number): string {
  const patternLiteral = JSON.stringify(linkPattern || '');
  return `
    JSON.stringify((() => {
      const pat = ${patternLiteral} ? new RegExp(${patternLiteral}, 'i') : null;
      const seen = new Set();
      const out = [];
      for (const a of Array.from(document.querySelectorAll('a[href]'))) {
        const href = a.href || '';
        if (!href.startsWith('http')) continue;
        if (pat && !pat.test(href)) continue;
        if (!pat && new URL(href).hostname !== location.hostname) continue;
        const text = (a.textContent || '').replace(/\\s+/g, ' ').trim();
        if (text.length < 8 || text.length > 140) continue;
        if (seen.has(href)) continue;
        seen.add(href);
        const parent = a.closest('article, li, div, section') || a.parentElement;
        const descEl = parent ? parent.querySelector('p, [class*="desc"], [class*="summary"], [class*="intro"]') : null;
        const summary = descEl ? (descEl.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200) : '';
        out.push({ title: text, url: href, summary });
        if (out.length >= ${limit}) break;
      }
      return out;
    })())
  `;
}

interface SandboxLike {
  browser?: {
    goto(url: string, opts?: { waitUntil?: string }): Promise<{ success?: boolean; data?: unknown; error?: string }>;
    evaluate(script: string): Promise<{ success?: boolean; data?: unknown; error?: string }>;
  };
}

export async function collectHtml(source: TrendSource, limit = 20, sandbox?: unknown): Promise<TrendSourceItem[]> {
  let anchors: RawAnchor[] = [];
  const sbx = sandbox as SandboxLike | null | undefined;

  if (sbx?.browser && typeof sbx.browser.goto === 'function') {
    try {
      const nav = await sbx.browser.goto(source.url, { waitUntil: 'domcontentloaded' });
      if (nav?.error) throw new Error(nav.error);
      const result = await sbx.browser.evaluate(buildExtractScript(source.linkPattern, limit * 2));
      const d = result?.data;
      const parsed = typeof d === 'string' ? JSON.parse(d) : d;
      if (Array.isArray(parsed)) anchors = parsed as RawAnchor[];
    } catch (error) {
      console.warn(`[html:browser] ${source.id} failed, falling back to fetch:`, error instanceof Error ? error.message : error);
    }
  }

  if (!anchors.length) {
    try {
      const html = await fetchText(source.url);
      anchors = extractAnchors(html, source.url, source.linkPattern, limit * 2);
    } catch (error) {
      console.warn(`[html:fetch] ${source.id} failed:`, error instanceof Error ? error.message : error);
      return [];
    }
  }

  return anchors.slice(0, limit).map(a => ({
    id: itemId(source.id, a.url),
    source: source.name,
    title: cleanText(a.title),
    url: a.url,
    score: 0,
    publishedAt: nowIso(), // list pages rarely expose dates; eventTime is refined by the Summarizer
    summary: a.summary || '',
    category: source.topicHint,
  }));
}

// ── Unified collection ────────────────────────────────────────────────────────

export interface CollectStats { source: string; fetched: number; kept: number; ok: boolean }

/**
 * Collect from the requested sources (ids, or 'all'), apply per-source filters,
 * then allocate `limit` slots by trust (higher trust → more slots), newest first inside a source.
 */
export async function collectSources(
  sources: string[] = ['all'],
  limit = 30,
  sandbox?: unknown,
  list: TrendSource[] = SOURCES,
): Promise<TrendSourceItem[]> {
  const wanted = sources.includes('all') || !sources.length
    ? enabledSources(list)
    : enabledSources(list).filter(s => sources.includes(s.id));

  const perSourceFetch = Math.max(8, Math.ceil(limit / Math.max(1, wanted.length)) * 3);
  const stats: CollectStats[] = [];

  const batches = await Promise.all(wanted.map(async source => {
    const raw = source.type === 'rss'
      ? await collectRss(source, perSourceFetch)
      : await collectHtml(source, perSourceFetch, sandbox);
    const kept = filterIndustryItems(raw, source);
    stats.push({ source: source.id, fetched: raw.length, kept: kept.length, ok: raw.length > 0 });
    return { source, items: kept };
  }));

  console.log('[sources] per-source stats:', JSON.stringify(stats));

  // Trust-weighted allocation with a floor of 1 slot per productive source.
  const productive = batches.filter(b => b.items.length);
  const totalTrust = productive.reduce((acc, b) => acc + b.source.trust, 0) || 1;
  const selected: TrendSourceItem[] = [];
  for (const b of productive) {
    const slots = Math.max(1, Math.round((b.source.trust / totalTrust) * limit));
    const sorted = [...b.items].sort((a, c) => String(c.publishedAt || '').localeCompare(String(a.publishedAt || '')));
    selected.push(...sorted.slice(0, slots).map(i => ({ ...i, score: Math.round(b.source.trust * 50) })));
  }

  // Fill remaining slots round-robin from leftovers (still trust-ordered).
  if (selected.length < limit) {
    const chosen = new Set(selected.map(i => i.id));
    const leftovers = productive
      .sort((a, b) => b.source.trust - a.source.trust)
      .flatMap(b => b.items.filter(i => !chosen.has(i.id)).map(i => ({ ...i, score: Math.round(b.source.trust * 50) })));
    selected.push(...leftovers.slice(0, limit - selected.length));
  }

  return selected.slice(0, limit);
}
