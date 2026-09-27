import { Agent, OpenAIChatCompletionsModel, run, tool } from '@openai/agents';
import { OpenAI } from 'openai';
import { z } from 'zod';

import { splitWriterOutput, type WriterTail } from './_contract.js';
import type { TrendLibraryItem } from './_items.js';
import { generateFallbackReport, utcNow } from './_report.js';
import { TOPICS } from './_sources.js';

const TOPIC_LIST = TOPICS.join(' / ');
import type {
  CuratorOutput,
  FinishedReport,
  SummarizerOutput,
  TrendAnalysis,
  TrendGroup,
  TrendReport,
  TrendSourceItem,
} from './_types.js';
import {
  ComparePeriodsParamsSchema,
  GetHistoryItemsParamsSchema,
} from './_types.js';

// ── OpenAI client setup (via AI Gateway) ──────────────────────────

/** Default model when neither LLM_MODEL nor AI_GATEWAY_MODEL is set (same as chat.neotel.tech). */
export const DEFAULT_MODEL = '@makers/deepseek-v4.1-flash';

/** Resolve the OpenAI-compatible client options from the env chain (exported for tests). */
export function buildOpenAIClientOptions(env: Record<string, string | undefined>): { apiKey?: string; baseURL?: string; model: string } {
  return {
    apiKey: env.LLM_API_KEY || env.AI_GATEWAY_API_KEY || env.OPENAI_API_KEY,
    baseURL: env.LLM_BASE_URL || env.AI_GATEWAY_BASE_URL || env.OPENAI_BASE_URL,
    model: env.LLM_MODEL || env.AI_GATEWAY_MODEL || DEFAULT_MODEL,
  };
}

function createModel(env: Record<string, string | undefined>): OpenAIChatCompletionsModel {
  const opts = buildOpenAIClientOptions(env);
  const client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL, timeout: 600000 });
  return new OpenAIChatCompletionsModel(client as any, opts.model);
}

// ── JSON parsing helpers ──────────────────────────────────────────

/**
 * Strip <think>...</think> reasoning tags that some models (DeepSeek, etc.)
 * emit in their output. These should never appear in final user-facing content.
 * Handles multiline content and multiple occurrences.
 */
function stripThinkingTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function parseJsonFromText<T>(text: string): T | null {
  // Strip thinking tags first — some models prepend <think>...</think> before JSON
  const cleaned = stripThinkingTags(text);

  // Helper: fix common JSON issues (trailing commas, etc.)
  function tryParse(json: string): T | null {
    // Direct attempt
    try { return JSON.parse(json) as T; } catch { /* continue */ }
    // Fix trailing commas: ,] or ,}
    const fixed = json
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/,\s*$/g, '');
    try { return JSON.parse(fixed) as T; } catch { /* continue */ }
    // Try to fix truncated JSON by closing brackets
    let attempt = fixed;
    const opens = (attempt.match(/[{[]/g) || []).length;
    const closes = (attempt.match(/[}\]]/g) || []).length;
    for (let i = 0; i < opens - closes; i++) {
      // Determine which bracket to close
      const lastOpen = Math.max(attempt.lastIndexOf('{'), attempt.lastIndexOf('['));
      attempt += attempt[lastOpen] === '{' ? '}' : ']';
    }
    try { return JSON.parse(attempt) as T; } catch { /* continue */ }
    return null;
  }

  // Try direct parse
  const direct = tryParse(cleaned);
  if (direct) return direct;

  // Try extracting JSON block from markdown code fence
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    const result = tryParse(fenceMatch[1]);
    if (result) return result;
  }
  // Try extracting first { ... } or [ ... ]
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) {
    const result = tryParse(objMatch[0]);
    if (result) return result;
  }
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    const result = tryParse(arrMatch[0]);
    if (result) return result;
  }
  // Last resort: find the first { and try to parse from there (handles preamble text)
  const firstBrace = cleaned.indexOf('{');
  if (firstBrace > 0) {
    const result = tryParse(cleaned.slice(firstBrace));
    if (result) return result;
  }
  console.warn('[parseJson] all attempts failed, first 200 chars:', cleaned.slice(0, 200));
  return null;
}

// ── Tool definitions ──────────────────────────────────────────────

/**
 * Create a sandbox-powered fetch tool for Agents (用法 A).
 * Uses context.sandbox.commands.run('curl ...') to fetch URL content.
 * Compatible with ChatCompletions API via @openai/agents tool().
 */
function createSandboxFetchTool(sandbox: any) {
  return tool({
    name: 'fetch_url',
    description: '通过沙箱执行 curl 命令获取指定 URL 的网页内容（前 3000 字符）。当你需要了解某篇文章的详细内容以辅助趋势判断时使用此工具。',
    parameters: z.object({
      url: z.string().min(1).describe('要获取内容的完整 URL'),
    }),
    execute: async (input: { url: string }) => {
      console.log(`[fetch_url] Agent called fetch_url: ${input.url}`);
      try {
        const result = await sandbox.commands.run(
          `curl -sL --max-time 10 '${input.url.replace(/'/g, "'\\''")}' | head -c 3000`,
        );
        if (result?.exitCode && result.exitCode !== 0) {
          console.warn(`[fetch_url] curl failed: exit=${result.exitCode}`);
          return JSON.stringify({ error: `curl failed: ${result.stderr || 'unknown error'}` });
        }
        console.log(`[fetch_url] success, ${(result?.stdout || '').length} chars`);
        return result?.stdout || '(empty response)';
      } catch (err: any) {
        console.warn(`[fetch_url] error:`, err?.message);
        return JSON.stringify({ error: err?.message || 'fetch failed' });
      }
    },
  });
}

function createGetHistoryItemsTool(historyItems: TrendLibraryItem[]) {
  return tool({
    name: 'get_history_items',
    description: '检索历史行业资讯条目（PCB/SMT/EMS），用于对比当前与过去的趋势数据。返回指定时间范围内的历史条目。',
    parameters: GetHistoryItemsParamsSchema,
    execute: async (input: { maxItems?: number; daysBack?: number }) => {
      const maxItems = input.maxItems ?? 50;
      const daysBack = input.daysBack ?? 7;
      const cutoff = new Date(Date.now() - daysBack * 86400000).toISOString();
      const filtered = historyItems
        .filter(item => (item.lastSeenAt || item.firstSeenAt || '') >= cutoff)
        .slice(0, maxItems);
      return JSON.stringify({
        count: filtered.length,
        items: filtered.map(item => ({
          id: item.id, title: item.title, category: item.category,
          source: item.source, seenCount: item.seenCount,
          firstSeenAt: item.firstSeenAt, lastSeenAt: item.lastSeenAt,
          isNew: item.isNew,
        })),
      });
    },
  });
}

function createComparePeriodsTool(
  currentItems: TrendSourceItem[],
  historyItems: TrendLibraryItem[],
) {
  return tool({
    name: 'compare_periods',
    description: '对比当前周期与前一周期的趋势数据差异，按指定维度(count/categories/sources)进行分析。',
    parameters: ComparePeriodsParamsSchema,
    execute: async (input: { currentItemIds: string[]; metric: 'count' | 'categories' | 'sources' }) => {
      const currentSet = new Set(input.currentItemIds);
      const current = currentItems.filter(i => currentSet.has(i.id));
      const previous = historyItems.filter(i => !currentSet.has(i.id));

      const countBy = (items: TrendSourceItem[], key: 'category' | 'source') => {
        const map: Record<string, number> = {};
        for (const i of items) {
          const k = (key === 'category' ? i.category : i.source) || 'Other';
          map[k] = (map[k] || 0) + 1;
        }
        return map;
      };

      if (input.metric === 'count') {
        return JSON.stringify({ currentCount: current.length, previousCount: previous.length, delta: current.length - previous.length });
      }
      if (input.metric === 'categories') {
        return JSON.stringify({ current: countBy(current, 'category'), previous: countBy(previous, 'category') });
      }
      return JSON.stringify({ current: countBy(current, 'source'), previous: countBy(previous, 'source') });
    },
  });
}

// ── Agent factory functions (no outputType — prompt-guided JSON) ──

function createCuratorAgent(env: Record<string, string | undefined>) {
  return new Agent({
    name: 'CuratorAgent',
    instructions: [
      '你是电子制造（PCB / SMT / EMS）行业资讯的策展编辑，为一家 SMT 物料管理设备厂商的内部情报页筛选候选资讯。',
      '',
      '只保留（keep=true）以下范围：',
      '- PCB 制造、SMT 贴装/回流/检测（AOI/SPI/X-ray）、EMS/电子代工产线；',
      '- 电子元器件供应链：缺货/交期/库存/分销/关税/出口管制/产能；',
      '- 设备厂商（贴片机、印刷机、回流焊、检测、料仓/点料/存储设备）的原始公告：新品、扩产、并购、人事；',
      '- 标准与政策：IPC/CPCA/GEA/SEMI 标准、法规、补贴、行业协会通告；',
      '- 展会：NEPCON、productronica、IPC APEX、SMTconnect 等的日程、议题、参展公告。',
      '',
      '丢弃（keep=false）：',
      '- 广告/软文/促销/招聘、转载抄袭、无信息量的概览稿；',
      '- 芯片设计与融资/投资、消费电子新品评测、宏观股市、与电子制造工艺无关的半导体新闻；',
      '- 标题党、无法判断事实的内容、明显过期（>30 天）的旧闻。',
      '',
      `category 只能取以下六个值之一：${TOPIC_LIST}`,
      '- 设备：贴片/印刷/焊接/检测/存储/点料等生产设备的技术与产品',
      '- 材料：PCB/覆铜板/基板/焊料/锡膏/钢网/化学品',
      '- 供应链：元器件供需、价格、交期、分销、贸易政策影响',
      '- 政策标准：标准发布、法规、补贴、协会通告',
      '- 展会：展会/论坛/峰会/研讨会',
      '- 厂商动态：企业级公告（扩产、并购、合作、人事、财报）',
      '',
      'reason 用一句中文说明保留/丢弃理由。竞争对手名称只能作为事实归属出现，不做任何比较。',
      '',
      '你必须只输出 JSON，格式如下（不要包含其他文字）：',
      '{"items":[{"id":"...","title":"...","url":"...","category":"设备","reason":"...","keep":true}],"droppedCount":5,"curatorNotes":"..."}',
    ].join('\n'),
    model: createModel(env),
  });
}

function createSummarizerAgent(env: Record<string, string | undefined>) {
  return new Agent({
    name: 'SummarizerAgent',
    instructions: [
      '你是电子制造行业（PCB / SMT / EMS）资讯的中文摘要编辑。为每条资讯写一条事实摘要。',
      '',
      '硬性要求：',
      '1. 每条摘要不超过 80 个汉字，一句到两句，只写事实：谁、做了什么、数字/时间/地点（如原文有）；',
      '2. 只使用输入里给出的 title 与 summary 中出现的信息，不得补充、推断或编造数字、金额、百分比；原文没有的信息就不写；',
      '3. 英文/日文资讯翻译为简体中文，公司名、产品名、标准号保留原文；',
      '4. 不使用绝对化用语（最、第一、领先、领导者、顶级、唯一等），不做任何厂商之间的比较，不加评价、不加营销语；',
      '5. 不输出 HTML、链接、表情符号，不要写"建议关注/值得注意"这类空话；',
      '6. eventTime：如果 title/summary 中明确写出了事件日期（发布日、展会日期、生效日），填 YYYY-MM-DD；不确定则填空字符串 ""，不要猜。',
      '',
      '你必须只输出 JSON，格式如下（不要包含其他文字）：',
      '{"items":[{"id":"...","aiSummary":"...","eventTime":"2026-09-27"}]}',
    ].join('\n'),
    model: createModel(env),
  });
}

function createAnalystAgent(
  env: Record<string, string | undefined>,
  currentItems: TrendSourceItem[],
  historyItems: TrendLibraryItem[],
  sandbox?: unknown,
) {
  const tools: any[] = [
    createGetHistoryItemsTool(historyItems),
    createComparePeriodsTool(currentItems, historyItems),
  ];
  // Inject sandbox fetch tool if sandbox is available (用法 A: Agent 自主调用沙箱)
  if (sandbox && typeof (sandbox as any)?.commands?.run === 'function') {
    tools.push(createSandboxFetchTool(sandbox));
  }
  return new Agent({
    name: 'AnalystAgent',
    instructions: [
      '你是电子制造行业（PCB / SMT / EMS）分析师，服务对象是 SMT 工厂的生产/物料/设备负责人。根据当前资讯和历史数据，判断每条资讯的重要性并聚类。',
      '',
      '分析要求：',
      '1. 将条目客观分为：',
      '   - new：本次首次采集到（isNew=true）',
      '   - active：连续多次出现（seenCount >= 2）',
      '   - single：仅出现一次但值得记录',
      `2. 按 category 分组，category 只能是：${TOPIC_LIST}；`,
      '3. 使用 get_history_items 工具获取历史数据，判断哪些是持续发酵的事件（同一事件多日出现 → active）；',
      '4. 如果有 fetch_url 工具可用，只对最重要的 2-3 条调用，读取原文后写一句事实性 insight；不要对每条都调用；',
      '5. 所有结论必须基于输入数据或 fetch_url 读到的原文，不编造事实、数字、时间；',
      '6. keyInsight 用一段不超过 80 字的中文，说明今天对 SMT 工厂最有决策价值的 1-2 个事实（例如某元器件交期变化、某标准生效、某设备厂商扩产）。不用绝对化用语，不做厂商比较。',
      '',
      '最终你必须只输出 JSON（不要包含其他文字），格式如下：',
      '{"categories":[{"name":"设备","items":[{"id":"...","title":"...","status":"new|active|single","importance":"high|medium|low"}]}],"deepDives":[{"id":"...","title":"...","insight":"一句事实性分析"}],"keyInsight":"不超过80字","scores":[{"id":"...","score":82}]}',
      '',
      '其中 scores 是为每条保留的资讯打的综合推荐分（0-100），每条都必须有。',
    ].join('\n'),
    model: createModel(env),
    tools,
  });
}

function createWriterAgent(env: Record<string, string | undefined>) {
  return new Agent({
    name: 'WriterAgent',
    instructions: [
      '你是挚锦科技（Neotel，SMT 物料管理设备厂商）内部行业情报页的撰稿编辑。基于结构化分析数据，撰写一份中文 Markdown 日报，并在末尾附一段结构化 JSON。',
      '',
      '报告 Markdown 必须严格遵循以下结构（不要增减章节；没有条目的章节写"本期无"）：',
      '',
      '# {YYYY-MM-DD} PCB/SMT 行业趋势日报',
      '',
      '## 今日要点',
      '（3-5 条，每条一句话事实 + 括号内的来源站名，基于 keyInsight 与 importance=high 的条目）',
      '',
      '## 分主题动态',
      '（按 category 分组：设备 / 材料 / 供应链 / 政策标准 / 展会 / 厂商动态，只列出有条目的主题。每条格式：`- [标题](url) — 摘要（来源 · 事件时间）`）',
      '',
      '## 持续发酵',
      '（status=active 的条目，写明连续出现天数 seenCount；没有则写"本期无"）',
      '',
      '## 原文细读',
      '（基于 deepDives，2-3 条，每条一句事实性 insight；没有则写"本期无"）',
      '',
      '## 挚锦解读',
      '（可为空。只有当某条资讯与 SMT 物料管理——料盘/卷料存储、点料计数、物料注册、MSD 湿敏管控、配料 kitting、料仓/智能仓储——有真实、可说明的关联时才写 1-2 句，指出这条资讯对工厂物料管理意味着什么。没有关联就写"本期无"。绝不提及任何其他厂商名称，绝不做比较，绝不写试用/报价/联系我们。）',
      '',
      '写作要求：',
      '1. 所有来源链接使用 Markdown 超链接 [title](url)，链接必须来自输入数据，不编造来源；',
      '2. 只陈述输入数据中存在的事实；数字、金额、日期必须在输入的 title/summary/aiSummary/insight 中出现过；',
      '3. 禁止绝对化用语（最、第一、领先、领导者、顶级、唯一、全球首等）；竞争对手/其他厂商名称只能作为事实归属出现在其自身公告的条目里，不得写"A 优于/领先于 B"式比较；',
      '4. 风格简洁、克制、面向工厂决策者，全文 800-2000 字；不加免责声明，不加"建议关注"类空话；',
      '5. 先输出完整 Markdown；然后另起一行输出标记 <!--BRIEF-JSON-->，再输出一个 JSON 对象（不要代码块），格式：',
      '{"titleZh":"YYYY-MM-DD PCB/SMT 行业趋势日报","highlights":[{"text":"一句话要点","itemIds":["输入条目的 id"]}],"neotelNote":"挚锦解读原文或空字符串"}',
      '   - highlights 3-5 条，与"今日要点"一致，每条 itemIds 至少一个且必须是输入条目的 id；',
      '   - neotelNote 与"挚锦解读"章节一致；章节为"本期无"时填空字符串 ""。',
    ].join('\n'),
    model: createModel(env),
  });
}

// ── Prompt builders ───────────────────────────────────────────────

function buildItemsJson(items: TrendSourceItem[]): string {
  return JSON.stringify(items.slice(0, 30).map(item => ({
    id: item.id, title: item.title, url: item.url,
    source: item.source, category: item.category,
    sourceScore: item.score ?? 0, // 源站真实互动数据（HN upvotes / DevTo reactions / 0=无数据）
    summary: item.summary,
    isNew: item.isNew ?? false, seenCount: item.seenCount ?? 1,
  })));
}

function buildAnalystPrompt(items: TrendSourceItem[], noNewItems?: boolean): string {
  const lines = [
    '请分析以下电子制造行业（PCB/SMT/EMS）资讯条目，按 category 分组并判断重要性。',
    '先使用 get_history_items 工具获取历史数据，判断哪些条目是持续发酵的事件。',
    '然后只对最重要的 2-3 条使用 fetch_url 读原文。',
    '最后输出分析结果 JSON。',
    '',
    '【重要】你必须为每条保留的资讯打一个 0-100 的综合推荐分（scores 字段）：',
    '  - 决策价值（40%）：对 SMT 工厂的生产计划、物料采购、设备投资、合规是否有直接影响。',
    '  - 来源可信度与原创性（30%）：协会/标准组织/厂商原始公告 > 行业媒体首发 > 二手转述；sourceScore 是来源信任度的代码预估，可参考但不是热度。',
    '  - 相关度（30%）：与 PCB/SMT/EMS 工艺、元器件供应链、设备、标准、展会的直接贴合程度；纯芯片投资/消费电子内容应低分。',
    '',
    '评分参考：',
    '  90-100: 行业级事件（重要标准生效、大范围供应中断、头部厂商重大并购）',
    '  75-89: 对多数 SMT 工厂有直接影响的进展（主要元器件交期/价格变化、主流设备新品、关税/管制变化）',
    '  60-74: 值得记录的行业动态（单一厂商公告、展会议程、区域性政策）',
    '  40-59: 一般资讯/二手转述',
    '  <40: 边缘相关（通常已被 Curator 过滤）',
    '',
  ];
  if (noNewItems) {
    lines.push('⚠️ 本次采集未发现新增内容，请重点分析持续活跃的条目。', '');
  }
  lines.push(`当前资讯条目：${buildItemsJson(items)}`);
  return lines.join('\n');
}

function buildWriterPrompt(items: TrendSourceItem[], analysis: TrendAnalysis | null, noNewItems?: boolean): string {
  const lines: string[] = [];
  if (analysis) {
    lines.push('请基于以下结构化分析数据，严格按照你的报告结构模板撰写报告：', '', `分析数据：${JSON.stringify(analysis)}`);
  } else {
    lines.push('分析师未能生成分析数据，请直接基于以下资讯条目按报告结构模板撰写：');
  }
  // Data source summary for the report header
  const sourceCounts = items.reduce((acc, i) => { const k = i.source || 'unknown'; acc[k] = (acc[k] || 0) + 1; return acc; }, {} as Record<string, number>);
  const newCount = items.filter(i => i.isNew).length;
  lines.push('', `数据源统计：${JSON.stringify(sourceCounts)}，新增 ${newCount} 条`);
  lines.push('', '原始条目（含 url、category、aiSummary，用于填充报告链接和摘要）：', buildItemsJson(items));
  lines.push('', `今天的日期（Asia/Shanghai）：${new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)}，用于报告标题与 titleZh。`);
  if (noNewItems) {
    lines.push('', '⚠️ 本次未发现新增内容。在"今日要点"第一条注明"今日无新增，以下为近期仍值得关注的资讯"。');
  }
  return lines.join('\n');
}

// ── Report assembly helpers ───────────────────────────────────────

function buildTrendGroups(items: TrendSourceItem[]): TrendGroup[] {
  const grouped = new Map<string, TrendSourceItem[]>();
  for (const item of items) {
    const category = item.category || '厂商动态';
    grouped.set(category, [...(grouped.get(category) || []), item]);
  }
  return Array.from(grouped.entries()).map(([category, catItems]) => ({
    category,
    summary: catItems.slice(0, 3).map(i => i.title).join('；'),
    count: catItems.length,
    items: catItems.slice(0, 5),
  }));
}

function assembleReportFromWriter(items: TrendSourceItem[], markdown: string, runId: string, trigger: string): TrendReport {
  const firstLine = markdown.split('\n').find(l => l.trim() && !l.startsWith('#'))?.trim() || '';
  const summary = firstLine.slice(0, 120) || `${items.length} 条 AI 资讯趋势分析`;
  return {
    runId,
    status: 'success',
    trigger,
    generatedAt: utcNow(),
    itemCount: items.length,
    summary,
    reportMarkdown: markdown,
    trends: buildTrendGroups(items),
    items,
  };
}

function assembleReportFromAnalysis(items: TrendSourceItem[], analysis: TrendAnalysis, runId: string, trigger: string): TrendReport {
  const lines = [`# ${new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)} PCB/SMT 行业趋势日报`, '', `> ${analysis.keyInsight}`, ''];

  // Group by category from analyst output
  if (analysis.categories?.length) {
    lines.push('## 分主题动态', '');
    for (const cat of analysis.categories) {
      lines.push(`### ${cat.name}`, '');
      for (const entry of cat.items) {
        const item = items.find(i => i.id === entry.id);
        if (item) {
          lines.push(`- [${item.title}](${item.url}) — ${item.aiSummary || item.summary || entry.status}`);
        }
      }
      lines.push('');
    }
  }

  // Deep dives
  if (analysis.deepDives?.length) {
    lines.push('## 原文细读', '');
    for (const dd of analysis.deepDives) {
      const item = items.find(i => i.id === dd.id);
      const url = item?.url || '';
      lines.push(`- [${dd.title}](${url}) — ${dd.insight}`);
    }
    lines.push('');
  }

  const report = generateFallbackReport(items, runId, trigger);
  report.reportMarkdown = lines.join('\n');
  report.summary = analysis.keyInsight;
  report.agentWarning = 'Writer agent failed; report generated from analyst output';
  return report;
}

// ── Pipeline ──────────────────────────────────────────────────────

export type PipelineStage = 'fetch' | 'curator' | 'summarizer' | 'analyst' | 'writer' | 'complete' | 'error';
export type PipelineStatus = 'running' | 'done' | 'failed' | 'skipped';

export interface PipelineEvent {
  stage: PipelineStage;
  status: PipelineStatus;
  duration?: number;
  detail?: string;
}

/**
 * Generic SSE payload — either the legacy bare-shape stage event or a typed
 * StreamEvent (`{ type: 'stage' | 'items' | 'analysis' | 'token' | ... }`).
 * The handler is responsible for serializing this to a `data:` SSE frame.
 */
export type PipelineEmit = PipelineEvent | { type: string; [key: string]: unknown };

export interface PipelineInput {
  items: TrendSourceItem[];
  historyItems: TrendLibraryItem[];
  runId: string;
  trigger: string;
  env: Record<string, string | undefined>;
  noNewItems?: boolean;
  onProgress?: (event: PipelineEmit) => void;
  /** Sandbox instance (context.sandbox) — used to create sandbox tools for Agent */
  sandbox?: unknown;
  /** AbortSignal from the platform — when triggered, pipeline should stop ASAP */
  signal?: AbortSignal;
}

export interface PipelineStageResult {
  curatorOutput?: CuratorOutput;
  summarizerOutput?: SummarizerOutput;
  analystOutput?: TrendAnalysis;
  writerMarkdown?: string;
  /** Structured tail the Writer appended after <!--BRIEF-JSON--> (null when absent/invalid). */
  writerTail?: WriterTail | null;
  failedStage?: string;
  error?: string;
}

/**
 * Run an agent in streaming mode, emitting `progress` events every few seconds
 * to keep the SSE connection alive (avoids CDN idle-timeout, typically 60s).
 *
 * If the stream fails with a transient error ("terminated", socket closed, etc.),
 * automatically retries once with a non-streaming call so the pipeline isn't
 * blocked by intermittent AI Gateway connection resets.
 *
 * The caller gets the same result shape as non-streaming `run()`.
 */
async function streamWithProgress(
  agent: Agent<unknown>,
  prompt: string,
  stage: string,
  emit: (event: PipelineEmit) => void,
  intervalMs = 8000,
  signal?: AbortSignal,
): Promise<{ finalOutput: string }> {
  try {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    let accumulated = '';
    let tokenCount = 0;
    let lastEmitAt = Date.now();

    const result = await run(agent, prompt, { stream: true, signal });

    for await (const event of result.toStream() as AsyncIterable<unknown>) {
      if (signal?.aborted) break;
      const ev = event as { type?: string; data?: { type?: string; delta?: unknown } };
      if (ev.type === 'raw_model_stream_event' && ev.data?.type === 'output_text_delta') {
        const delta = String(ev.data.delta || '');
        if (delta) {
          accumulated += delta;
          tokenCount++;
          // Emit progress periodically to keep the SSE alive and show activity.
          if (Date.now() - lastEmitAt >= intervalMs) {
            emit({ type: 'progress', stage, tokenCount, chars: accumulated.length });
            lastEmitAt = Date.now();
          }
        }
      }
    }

    // SDK's finalOutput is preferred (it strips internal framing if any).
    const finalOutput = (result as { finalOutput?: string }).finalOutput;
    const raw = typeof finalOutput === 'string' ? finalOutput : accumulated;
    return { finalOutput: stripThinkingTags(raw) };
  } catch (streamError) {
    // If aborted, rethrow immediately — don't retry
    if (signal?.aborted || (streamError instanceof Error && streamError.name === 'AbortError')) {
      throw streamError;
    }
    // Transient failures (AI Gateway connection reset, "terminated", socket closed)
    // → retry once without streaming. The pipeline keeps going.
    const msg = streamError instanceof Error ? streamError.message : String(streamError);
    console.warn(`[pipeline] ${stage} stream failed (${msg}), retrying without stream`);
    console.warn(`[pipeline] ${stage} full error:`, streamError);
    const retryResult = await run(agent, prompt, { signal });
    return { finalOutput: stripThinkingTags(String(retryResult.finalOutput || '')) };
  }
}

export async function runAgentPipeline(input: PipelineInput): Promise<{
  report: TrendReport;
  stages: PipelineStageResult;
}> {
  const { items, historyItems, runId, trigger, env, noNewItems, onProgress, sandbox, signal } = input;
  const stages: PipelineStageResult = {};
  const emit = onProgress ?? (() => {});

  // ── Stage 1+2: Curator & Summarizer (parallel) ─────────────────
  let curatedItems: TrendSourceItem[] = items;
  let enrichedItems: TrendSourceItem[] = items;

  try {
    const t0 = Date.now();
    console.log('[pipeline] Stage 1+2 (Curator+Summarizer) start');
    emit({ stage: 'curator', status: 'running' });
    emit({ stage: 'summarizer', status: 'running' });
    const curatorAgent = createCuratorAgent(env);
    const summarizerAgent = createSummarizerAgent(env);
    const itemsJson = buildItemsJson(items);

    const [curatorResult, summarizerResult] = await Promise.allSettled([
      streamWithProgress(curatorAgent, `请策展以下候选内容：\n${itemsJson}`, 'curator', emit, 8000, signal),
      streamWithProgress(summarizerAgent, `请为以下资讯生成中文摘要：\n${itemsJson}`, 'summarizer', emit, 8000, signal),
    ]);
    console.log(`[pipeline] Stage 1+2 done (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    const stage12Duration = (Date.now() - t0) / 1000;

    // Process Curator
    if (curatorResult.status === 'fulfilled') {
      const raw = String(curatorResult.value.finalOutput || '');
      const parsed = parseJsonFromText<CuratorOutput>(raw);
      if (parsed?.items?.length) {
        stages.curatorOutput = parsed;
        const keepIds = new Set(parsed.items.filter(i => i.keep).map(i => i.id));
        const curatorMap = new Map(parsed.items.map(i => [i.id, i]));
        curatedItems = items
          .filter(item => keepIds.has(item.id))
          .map(item => {
            const curated = curatorMap.get(item.id);
            return curated ? { ...item, category: curated.category } : item;
          });
        if (!curatedItems.length) curatedItems = items;
        const detail = `kept ${curatedItems.length}/${items.length}`;
        console.log(`[pipeline] Curator: ${detail}`);
        // Log dropped items with reasons
        const dropped = parsed.items.filter(i => !i.keep);
        if (dropped.length) {
          console.log(`[pipeline] Curator dropped (explicit):`, dropped.map(i => `${i.id}: ${i.reason}`).join(' | '));
        }
        // Log items omitted entirely by curator (not mentioned in output)
        const mentionedIds = new Set(parsed.items.map(i => i.id));
        const omitted = items.filter(i => !mentionedIds.has(i.id));
        if (omitted.length) {
          console.log(`[pipeline] Curator omitted ${omitted.length} items (not in output):`, omitted.map(i => `[${i.source}] ${i.title?.slice(0, 30)}`).join(' | '));
        }
        emit({ stage: 'curator', status: 'done', duration: stage12Duration, detail });
        // Phase 2 of progressive content: emit kept items so frontend can
        // fade out the dropped ones. We send only the items that survived
        // curation; frontend computes droppedIds = previousIds − newIds.
        emit({ type: 'items', phase: 'curated', items: curatedItems });
      } else {
        console.log('[pipeline] Curator: output parse failed, using all items');
        emit({ stage: 'curator', status: 'failed', duration: stage12Duration, detail: 'parse failed' });
      }
    } else {
      console.log('[pipeline] Curator failed:', curatorResult.reason);
      emit({ stage: 'curator', status: 'failed', duration: stage12Duration, detail: 'agent error' });
    }

    // Process Summarizer
    if (summarizerResult.status === 'fulfilled') {
      const raw = String(summarizerResult.value.finalOutput || '');
      const parsed = parseJsonFromText<SummarizerOutput>(raw);
      if (parsed?.items?.length) {
        stages.summarizerOutput = parsed;
        const summaryMap = new Map(
          parsed.items.filter(i => i.id && i.aiSummary).map(i => [i.id, i.aiSummary]),
        );
        // eventTime (YYYY-MM-DD) is only accepted when the model saw it in the text.
        const eventMap = new Map(
          parsed.items
            .filter(i => i.id && typeof i.eventTime === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(i.eventTime))
            .map(i => [i.id, i.eventTime as string]),
        );
        enrichedItems = curatedItems.map(item => {
          const ev = eventMap.get(item.id);
          return {
            ...item,
            aiSummary: summaryMap.get(item.id) || item.aiSummary,
            publishedAt: ev && !Number.isNaN(new Date(ev).getTime()) ? new Date(`${ev}T00:00:00+08:00`).toISOString() : item.publishedAt,
          };
        });
        const detail = `${summaryMap.size} summaries`;
        console.log(`[pipeline] Summarizer: ${detail}`);
        emit({ stage: 'summarizer', status: 'done', duration: stage12Duration, detail });
        // Phase 3 of progressive content: emit items with aiSummary filled in.
        // Frontend merges by id and fades the summary text in.
        emit({ type: 'items', phase: 'summarized', items: enrichedItems });
      } else {
        enrichedItems = curatedItems;
        console.log('[pipeline] Summarizer: output parse failed, no summaries');
        emit({ stage: 'summarizer', status: 'failed', duration: stage12Duration, detail: 'parse failed' });
      }
    } else {
      enrichedItems = curatedItems;
      console.log('[pipeline] Summarizer failed:', summarizerResult.reason);
      emit({ stage: 'summarizer', status: 'failed', duration: stage12Duration, detail: 'agent error' });
    }
  } catch (error) {
    // If aborted, rethrow to skip remaining stages
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      console.log('[pipeline] Stage 1+2 aborted by user');
      throw error;
    }
    stages.failedStage = 'curator+summarizer';
    stages.error = error instanceof Error ? error.message : String(error);
    console.log('[pipeline] Stage 1+2 error:', stages.error);
  }

  // ── Abort check between stages ──
  if (signal?.aborted) {
    console.log('[pipeline] Aborted before Stage 3');
    throw new DOMException('Aborted', 'AbortError');
  }

  // ── Stage 3: Analyst ────────────────────────────────────────────
  let analysis: TrendAnalysis | null = null;

  try {
    const t1 = Date.now();
    console.log('[pipeline] Stage 3 (Analyst) start');
    emit({ stage: 'analyst', status: 'running' });
    const analystAgent = createAnalystAgent(env, enrichedItems, historyItems, sandbox);
    const analystResult = await streamWithProgress(analystAgent, buildAnalystPrompt(enrichedItems, noNewItems), 'analyst', emit, 8000, signal);
    const raw = String(analystResult.finalOutput || '');
    const parsed = parseJsonFromText<TrendAnalysis>(raw);
    const d1 = +(((Date.now() - t1) / 1000).toFixed(1));
    if (parsed?.keyInsight || parsed?.categories?.length) {
      analysis = parsed;
      stages.analystOutput = analysis;
      // Write back Analyst scores (0-100) to enrichedItems for sorting and display.
      if (analysis.scores?.length) {
        const scoreMap = new Map(analysis.scores.map(s => [s.id, s.score]));
        enrichedItems = enrichedItems.map(item => {
          const aiScore = scoreMap.get(item.id);
          return aiScore != null ? { ...item, score: aiScore } : item;
        });
      }
      const categoryCount = analysis.categories?.length || 0;
      const deepDiveCount = analysis.deepDives?.length || 0;
      const detail = `${categoryCount} categories, ${deepDiveCount} deep dives`;
      console.log(`[pipeline] Analyst done (${d1}s): ${detail}`);
      emit({ stage: 'analyst', status: 'done', duration: d1, detail });
      // Phase 4 of progressive content: emit categories + scored items so
      // frontend can re-group, show keyInsight, and update displayed scores.
      emit({
        type: 'analysis',
        categories: analysis.categories || [],
        deepDives: analysis.deepDives || [],
        keyInsight: analysis.keyInsight,
      });
      // Re-emit items with Analyst scores so frontend LiveFeed picks up 0-100 scores.
      emit({ type: 'items', phase: 'summarized', items: enrichedItems });
    } else {
      console.log(`[pipeline] Analyst done (${d1}s): output parse failed`);
      console.log(`[pipeline] Analyst raw output (first 500 chars):`, raw.slice(0, 500));
      emit({ stage: 'analyst', status: 'failed', duration: d1, detail: 'parse failed' });
    }
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      console.log('[pipeline] Stage 3 aborted by user');
      throw error;
    }
    stages.failedStage = stages.failedStage || 'analyst';
    stages.error = stages.error || (error instanceof Error ? error.message : String(error));
    console.log('[pipeline] Analyst error:', stages.error);
    emit({ stage: 'analyst', status: 'failed', detail: stages.error });
  }

  // ── Abort check between stages ──
  if (signal?.aborted) {
    console.log('[pipeline] Aborted before Stage 4');
    throw new DOMException('Aborted', 'AbortError');
  }

  // ── Stage 4: Writer (token-streaming with non-stream fallback) ───
  try {
    const t2 = Date.now();
    console.log('[pipeline] Stage 4 (Writer) start — streaming');
    emit({ stage: 'writer', status: 'running' });
    const writerAgent = createWriterAgent(env);
    const writerPrompt = buildWriterPrompt(enrichedItems, analysis, noNewItems);

    let markdown = '';

    try {
      // Primary path: stream tokens to the client for live-typing UX.
      let accumulated = '';
      let insideThink = false; // Track if we're inside <think>...</think>
      let thinkBuffer = '';    // Buffer to detect partial <think> or </think> tags
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const writerStreamResult = await run(writerAgent, writerPrompt, { stream: true, signal });

      for await (const event of writerStreamResult.toStream() as AsyncIterable<unknown>) {
        if (signal?.aborted) break;
        const ev = event as { type?: string; data?: { type?: string; delta?: unknown } };
        if (ev.type === 'raw_model_stream_event' && ev.data?.type === 'output_text_delta') {
          const delta = String(ev.data.delta || '');
          if (delta) {
            accumulated += delta;
            // Filter out <think>...</think> from live stream
            thinkBuffer += delta;
            if (insideThink) {
              const closeIdx = thinkBuffer.indexOf('</think>');
              if (closeIdx !== -1) {
                insideThink = false;
                const afterClose = thinkBuffer.slice(closeIdx + 8);
                thinkBuffer = '';
                if (afterClose) emit({ type: 'token', delta: afterClose });
              }
              // else: still inside think, swallow token
            } else {
              const openIdx = thinkBuffer.indexOf('<think>');
              if (openIdx !== -1) {
                insideThink = true;
                const beforeOpen = thinkBuffer.slice(0, openIdx);
                thinkBuffer = thinkBuffer.slice(openIdx + 7);
                if (beforeOpen) emit({ type: 'token', delta: beforeOpen });
              } else if (thinkBuffer.length > 7) {
                // Safe to flush — no partial <think> tag possible
                const safe = thinkBuffer.slice(0, -7);
                thinkBuffer = thinkBuffer.slice(-7);
                emit({ type: 'token', delta: safe });
              }
            }
          }
        }
      }
      // Flush remaining buffer (if not inside think)
      if (!insideThink && thinkBuffer) {
        emit({ type: 'token', delta: thinkBuffer });
      }

      const finalOutput = (writerStreamResult as { finalOutput?: string }).finalOutput;
      markdown = stripThinkingTags(
        (typeof finalOutput === 'string' && finalOutput.trim())
          ? finalOutput.trim()
          : accumulated.trim()
      );
    } catch (streamError) {
      // If aborted, rethrow — don't retry
      if (signal?.aborted || (streamError instanceof Error && streamError.name === 'AbortError')) {
        throw streamError;
      }
      // Fallback: if streaming fails ("terminated", connection reset, etc.),
      // retry without streaming. User won't see live-typing but still gets the report.
      const msg = streamError instanceof Error ? streamError.message : String(streamError);
      console.warn(`[pipeline] Writer stream failed (${msg}), retrying without stream`);
      console.warn(`[pipeline] Writer full error:`, streamError);
      const writerResult = await run(writerAgent, writerPrompt, { signal });
      markdown = stripThinkingTags(String(writerResult.finalOutput || '').trim());
    }

    const d2 = +(((Date.now() - t2) / 1000).toFixed(1));
    // Separate the human-readable Markdown from the structured <!--BRIEF-JSON--> tail.
    const split = splitWriterOutput(markdown);
    markdown = split.markdown;
    stages.writerTail = split.tail;
    if (markdown && markdown.length > 50) {
      stages.writerMarkdown = markdown;
      const detail = `${markdown.length} chars${split.tail ? ', brief tail ok' : ', no brief tail'}`;
      console.log(`[pipeline] Writer done (${d2}s): ${detail}`);
      emit({ stage: 'writer', status: 'done', duration: d2, detail });
      return { report: assembleReportFromWriter(enrichedItems, markdown, runId, trigger), stages };
    }
    console.log(`[pipeline] Writer done (${d2}s): output too short`);
    emit({ stage: 'writer', status: 'failed', duration: d2, detail: 'output too short' });
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      console.log('[pipeline] Stage 4 aborted by user');
      throw error;
    }
    stages.failedStage = stages.failedStage || 'writer';
    stages.error = stages.error || (error instanceof Error ? error.message : String(error));
    console.log('[pipeline] Writer error:', stages.error);
    emit({ stage: 'writer', status: 'failed', detail: stages.error });
  }

  // ── Fallback from Analyst output ────────────────────────────────
  if (analysis) {
    console.log('[pipeline] Falling back to analyst-based report');
    return { report: assembleReportFromAnalysis(enrichedItems, analysis, runId, trigger), stages };
  }

  // ── Ultimate fallback ───────────────────────────────────────────
  console.log('[pipeline] All agents failed, using code-generated fallback');
  const fallback = generateFallbackReport(enrichedItems, runId, trigger);
  fallback.agentWarning = stages.error || 'All agents failed';
  return { report: fallback, stages };
}
