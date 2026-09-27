import type { TrendReport } from './types';

export const EMPTY_REPORT: TrendReport = {
  status: 'empty',
  summary: '还没有生成过行业趋势报告。',
  reportMarkdown: '# PCB/SMT 行业趋势日报\n\n点击“手动生成”开始采集 PCB / SMT / EMS 行业公开资讯。',
  trends: [],
  items: [],
};

export function normalizeReport(input: Partial<TrendReport> | null | undefined): TrendReport {
  return {
    ...EMPTY_REPORT,
    ...(input ?? {}),
    status: input?.status ?? EMPTY_REPORT.status,
    reportMarkdown: input?.reportMarkdown ?? EMPTY_REPORT.reportMarkdown,
    trends: Array.isArray(input?.trends) ? input.trends : [],
    items: Array.isArray(input?.items) ? input.items : [],
  };
}
