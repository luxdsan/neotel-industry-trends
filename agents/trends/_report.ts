import type { TrendGroup, TrendReport, TrendSourceItem } from './_types.js';

export function utcNow(): string {
  return new Date().toISOString();
}

function formatReportTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute} UTC`;
}

function summarizeCategory(category: string, items: TrendSourceItem[]): string {
  const titles = items.slice(0, 3).map(item => item.title).filter(Boolean);
  if (!titles.length) return `${category}：本期有少量动态。`;
  return `${category}：${items.length} 条，包括 ${titles.join('；')}。`;
}

export function generateMarkdown(items: TrendSourceItem[], generatedAt: string): { markdown: string; trends: TrendGroup[] } {
  const grouped = new Map<string, TrendSourceItem[]>();
  for (const item of items) {
    const category = item.category || '厂商动态';
    grouped.set(category, [...(grouped.get(category) || []), item]);
  }

  const trends: TrendGroup[] = [];
  const lines = [
    `# ${generatedAt.slice(0, 10)} PCB/SMT 行业趋势日报`,
    '',
    `生成时间：${formatReportTime(generatedAt)}`,
    `分析内容：${items.length} 条候选资讯`,
    '',
    '## 今日要点',
    '',
  ];

  if (!items.length) {
    lines.push('今日无新增，以下为近期仍值得关注的资讯。', '');
    return { markdown: lines.join('\n'), trends };
  }

  Array.from(grouped.entries()).forEach(([category, categoryItems], index) => {
    const summary = summarizeCategory(category, categoryItems);
    trends.push({ category, summary, count: categoryItems.length, items: categoryItems.slice(0, 5) });
    lines.push(`${index + 1}. **${category}**：${summary}`);
  });

  lines.push('', '## 分主题动态', '');
  for (const trend of trends) {
    lines.push(`### ${trend.category}`, '');
    for (const item of trend.items) {
      lines.push(`- [${item.title}](${item.url}) — ${item.aiSummary || item.summary || ''}（${item.source || 'Unknown'}）`);
    }
    lines.push('');
  }

  lines.push(
    '## 挚锦解读',
    '',
    '本期无',
    '',
    '## 说明',
    '',
    '本期为代码兜底版本（模型阶段未成功），条目为原始采集结果的 AI 摘要，以原文为准。',
  );

  return { markdown: lines.join('\n'), trends };
}

export function generateFallbackReport(items: TrendSourceItem[], runId: string, trigger = 'manual'): TrendReport {
  const generatedAt = utcNow();
  const { markdown, trends } = generateMarkdown(items, generatedAt);
  return {
    runId,
    status: 'success',
    trigger,
    generatedAt,
    itemCount: items.length,
    summary: trends[0]?.summary || '今日无新增资讯。',
    reportMarkdown: markdown,
    trends,
    items,
  };
}

// buildAgentPrompt removed — prompt logic moved to _model.ts agent instructions
