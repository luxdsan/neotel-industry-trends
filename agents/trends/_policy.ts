/**
 * Content policy (plan §4 hard checks + §5 + CLAUDE.md competitor rules), applied in code
 * AFTER the model so that prompt drift can never leak into the published brief.
 *
 *  - absolute / superlative marketing words (广告法): 最…, 第一, 领先, 领导者, 顶级, 唯一, …
 *  - competitor names: allowed ONLY as factual attribution inside item title/source/summary,
 *    never inside `neotelNote`; comparative wording naming anyone is dropped everywhere
 *  - sales words (试用 / POC / 报价 …) are not allowed in neotelNote or highlights
 *  - summaries are clamped to 80 characters (code points)
 *
 * Everything is pure and dependency-free so it is trivially unit-testable.
 */

/** `最` is allowed only in neutral compounds (最新/最近/最终/最后/最初). */
const ABSOLUTE_PATTERNS: RegExp[] = [
  /最(?!新|近|终|后|初)/,
  /第一(?!季度|季|期|批|阶段|步|部分|次|届|天|年|代)/,
  /领先|领导者|领军|顶级|顶尖|唯一|首选|独家|极致|完美|绝对|王牌|全球首|行业首|国家级|世界级|遥遥/,
  /\bno\.?\s?1\b|#1|\bbest[- ]in[- ]class\b|\bworld[- ]leading\b|\bindustry[- ]leading\b|\bleading\b|\bleader\b|\bbest\b|\bunrivalled\b|\bunrivaled\b|\bnumber one\b/i,
];

const COMPARATIVE_PATTERNS: RegExp[] = [
  /优于|领先于|胜过|超越|不同于|相比|相较|比[^，。；]{0,12}更|异于|区别于|碾压|秒杀/,
  /\bvs\.?\b|\bversus\b|\bbetter than\b|\bunlike\b|\bcompared (to|with)\b|\boutperform/i,
];

const SALES_PATTERNS: RegExp[] = [
  /试用|POC|免费体验|限时|立即咨询|联系我们|报价|下单|促销|优惠/i,
];

/**
 * Competitor / vendor names that must never appear in 挚锦解读 (neotelNote).
 * They MAY appear in item titles / sources / factual summaries (attribution only).
 */
export const COMPETITOR_NAMES: string[] = [
  'inovaxe', 'essegi', 'modi', 'jfe', 'jfe商事', 'スマートリールラック', 'totech', 'cogiscan', 'compcontrol',
  'fuji', 'yamaha', 'juki', 'asmpt', 'asm pacific', 'siplace', 'mycronic', 'koh young', 'panasonic',
  'hanwha', 'nordson', 'scienscope', 'creative electron', 'x-tek', 'nikon', 'vjt', 'mek', 'xyztec',
  'storage solutions', 'smart reel rack', 'smartrack', 'wipotec', 'dräger', 'draeger',
];

export interface PolicyViolation {
  rule: 'absolute' | 'comparative' | 'sales' | 'competitor';
  match: string;
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[0];
  }
  return null;
}

export function findAbsoluteWords(text: string): string | null {
  return firstMatch(text, ABSOLUTE_PATTERNS);
}

export function findComparativeClaim(text: string): string | null {
  return firstMatch(text, COMPARATIVE_PATTERNS);
}

export function findSalesWords(text: string): string | null {
  return firstMatch(text, SALES_PATTERNS);
}

export function findCompetitorName(text: string, names: string[] = COMPETITOR_NAMES): string | null {
  const lower = text.toLowerCase();
  for (const name of names) {
    if (lower.includes(name.toLowerCase())) return name;
  }
  return null;
}

/**
 * Check a factual item summary: absolute words and comparative claims are not allowed;
 * vendor names ARE allowed (attribution). Returns [] when clean.
 */
export function checkSummary(text: string): PolicyViolation[] {
  const out: PolicyViolation[] = [];
  const abs = findAbsoluteWords(text);
  if (abs) out.push({ rule: 'absolute', match: abs });
  const cmp = findComparativeClaim(text);
  if (cmp) out.push({ rule: 'comparative', match: cmp });
  return out;
}

/** Highlights are opinions attributed to items — same as summaries plus no sales words. */
export function checkHighlight(text: string): PolicyViolation[] {
  const out = checkSummary(text);
  const sales = findSalesWords(text);
  if (sales) out.push({ rule: 'sales', match: sales });
  return out;
}

/** 挚锦解读: everything above AND no competitor names at all. */
export function checkNeotelNote(text: string): PolicyViolation[] {
  const out = checkHighlight(text);
  const comp = findCompetitorName(text);
  if (comp) out.push({ rule: 'competitor', match: comp });
  return out;
}

/**
 * Clamp a summary to `max` code points, preferring to cut at the last sentence/clause
 * boundary so we never publish a half word. Always returns ≤ max code points.
 */
export function clampSummary(text: string, max = 80): string {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(clean);
  if (chars.length <= max) return clean;
  const head = chars.slice(0, max).join('');
  const boundary = Math.max(head.lastIndexOf('。'), head.lastIndexOf('；'), head.lastIndexOf('，'), head.lastIndexOf('.'), head.lastIndexOf(';'), head.lastIndexOf(','));
  if (boundary >= Math.floor(max * 0.5)) {
    const cut = head.slice(0, boundary);
    return /[。.]$/.test(cut) ? cut : `${cut}。`;
  }
  return `${chars.slice(0, max - 1).join('')}…`;
}

/** Terms that must not be used as category words (registered marks of others). */
export const FORBIDDEN_CATEGORY_TERMS = ['智能料架®', 'スマートリールラック', 'smart reel rack'];
