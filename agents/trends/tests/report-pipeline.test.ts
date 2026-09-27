/**
 * Unit tests — plain node:assert, compiled by tsconfig.test.json into .test-build/.
 * No network, no model calls. Also writes docs/sample-brief.json (the exact §4 JSON the
 * contract builder produces from a mocked pipeline run).
 */
import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { BRIEF_JSON_MARKER, buildBrief, splitWriterOutput, toShanghaiIso, validateBrief } from '../_contract.js';
import { fingerprintItem, mergeItemLibrary, normalizeUrl } from '../_items.js';
import { loadHistoryFromMemory, loadLatestReportFromMemory, loadReportFromMemory, loadReportsSince, saveReportToMemory } from '../_memory.js';
import { buildOpenAIClientOptions, DEFAULT_MODEL } from '../_model.js';
import { checkNeotelNote, checkSummary, clampSummary, findAbsoluteWords, findComparativeClaim } from '../_policy.js';
import { generateFallbackReport } from '../_report.js';
import { BRIEF_SCHEMA, validateAgainstSchema } from '../_schema.js';
import { SOURCES, sourceById } from '../_source_list.js';
import { buildFallbackAiSummary, cleanText, extractAnchors, filterIndustryItems, inferTopic, parseFeed } from '../_sources.js';
import { loadHistory, loadLatestReport, loadReport, saveReport } from '../_storage.js';
import type { TrendReport, TrendSourceItem } from '../_types.js';
import { buildWeeklyReport } from '../_weekly.js';

class FakeMemory {
  messages: Array<{ messageId: string; content: string; metadata: Record<string, unknown>; createdAt: number }> = [];

  async appendMessage(input: { content: string; metadata?: Record<string, unknown> }) {
    const id = `msg_${this.messages.length + 1}`;
    this.messages.push({ messageId: id, content: input.content, metadata: input.metadata || {}, createdAt: this.messages.length + 1 });
    return id;
  }

  async getMessages(input: { limit?: number; order?: 'asc' | 'desc' }) {
    const items = [...this.messages];
    if (input.order === 'desc') items.reverse();
    return items.slice(0, input.limit || 20);
  }
}

function section(name: string) {
  console.log(`  ✓ ${name}`);
}

async function run() {
  // ── Model env chain ────────────────────────────────────────────────────────
  {
    const opts = buildOpenAIClientOptions({ AI_GATEWAY_API_KEY: 'test-key', AI_GATEWAY_BASE_URL: 'https://gateway.example.com/v1' });
    assert.equal(opts.apiKey, 'test-key');
    assert.equal(opts.baseURL, 'https://gateway.example.com/v1');
    assert.equal(opts.model, '@makers/deepseek-v4.1-flash');
    assert.equal(DEFAULT_MODEL, '@makers/deepseek-v4.1-flash');
    assert.equal(buildOpenAIClientOptions({ AI_GATEWAY_MODEL: '@makers/other' }).model, '@makers/other');
    assert.equal(buildOpenAIClientOptions({ LLM_MODEL: 'gpt-x', AI_GATEWAY_MODEL: '@makers/other' }).model, 'gpt-x');
    section('model default + env override');
  }

  // ── Source list sanity ─────────────────────────────────────────────────────
  {
    const ids = new Set<string>();
    for (const s of SOURCES) {
      assert.ok(!ids.has(s.id), `duplicate source id ${s.id}`);
      ids.add(s.id);
      assert.ok(['rss', 'html'].includes(s.type));
      assert.ok(s.trust > 0 && s.trust <= 1, `trust out of range for ${s.id}`);
      assert.ok(/^https?:\/\//.test(s.url), `bad url for ${s.id}`);
      if (s.linkPattern) new RegExp(s.linkPattern); // must compile
      if (s.mustMatch) new RegExp(s.mustMatch);
    }
    assert.ok(SOURCES.length >= 20);
    assert.equal(sourceById('emsnow')?.type, 'rss');
    section(`source list (${SOURCES.length} sources)`);
  }

  // ── Industry keyword gate + topic inference ────────────────────────────────
  {
    const general = sourceById('elecfans')!;
    const filtered = filterIndustryItems([
      { id: '1', title: '某厂商发布新一代贴片机，回流焊良率提升', url: 'https://example.com/smt', summary: '' },
      { id: '2', title: '某公司完成 B 轮融资，估值翻倍', url: 'https://example.com/vc', summary: '芯片设计初创' },
      { id: '3', title: 'MLCC 交期延长至 20 周，分销商库存承压', url: 'https://example.com/mlcc', summary: '供应链' },
    ], general);
    assert.deepEqual(filtered.map((i: TrendSourceItem) => i.id), ['1', '3']);
    assert.equal(filtered[0].category, '设备');
    assert.equal(filtered[1].category, '供应链');

    // vertical source: passes through without keyword gate
    const vertical = sourceById('emsnow')!;
    const passthrough = filterIndustryItems([{ id: 'x', title: 'Quarterly results announced by an EMS provider', url: 'https://example.com/q' }], vertical);
    assert.equal(passthrough.length, 1);

    // SEMI mustMatch: only packaging / assembly
    const semi = sourceById('semi')!;
    const semiKept = filterIndustryItems([
      { id: 'a', title: 'Advanced packaging capacity expands in 2026', url: 'https://semi.org/a' },
      { id: 'b', title: 'Lithography tool shipments rise', url: 'https://semi.org/b' },
    ], semi);
    assert.deepEqual(semiKept.map(i => i.id), ['a']);

    assert.equal(inferTopic({ id: 't', title: 'IPC-A-610 标准新版发布', url: 'https://x/y' }), '政策标准');
    assert.equal(inferTopic({ id: 't', title: 'productronica 2026 展会议程公布', url: 'https://x/y' }), '展会');
    section('industry keyword gate / mustMatch / topic inference');
  }

  // ── cleanText + fallback summary ───────────────────────────────────────────
  {
    const rawHtml = '<a href="https:&#x2F;&#x2F;example.com&#x2F;a" rel="nofollow">https:&#x2F;&#x2F;example.com&#x2F;a</a> <![CDATA[焊膏 &amp; 钢网]]>';
    const cleaned = cleanText(rawHtml);
    assert.ok(!cleaned.includes('<a'));
    assert.ok(!cleaned.includes('&#x2F;'));
    assert.ok(cleaned.includes('焊膏 & 钢网'));
    const fb = buildFallbackAiSummary({ id: 'h', title: '标题', url: 'https://example.com', summary: rawHtml });
    assert.ok(!fb.includes('<a'));
    assert.ok(Array.from(fb).length <= 80);
    section('cleanText / fallback summary');
  }

  // ── RSS / Atom parsing ─────────────────────────────────────────────────────
  {
    const rss = `<?xml version="1.0"?><rss><channel><title>EMSNOW</title>
      <item><title><![CDATA[EMS provider opens new SMT line in Mexico]]></title>
        <link>https://www.emsnow.com/ems-provider-opens-line/?utm_source=rss</link>
        <pubDate>Fri, 26 Sep 2026 08:00:00 +0000</pubDate>
        <description><![CDATA[<p>The 50,000 sq ft facility adds two SMT lines.</p>]]></description></item>
      <item><title>No link item</title></item>
    </channel></rss>`;
    const entries = parseFeed(rss, 'https://www.emsnow.com/feed/');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].title, 'EMS provider opens new SMT line in Mexico');
    assert.equal(entries[0].publishedAt, '2026-09-26T08:00:00.000Z');
    assert.ok(entries[0].summary?.includes('50,000 sq ft'));

    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>IPC-7711/7721 revision published</title>
      <link rel="alternate" href="/news/ipc-7711"/><updated>2026-09-25T10:00:00Z</updated>
      <summary>Rework and repair standard update.</summary></entry></feed>`;
    const atomEntries = parseFeed(atom, 'https://www.electronics.org/');
    assert.equal(atomEntries[0].url, 'https://www.electronics.org/news/ipc-7711');
    assert.equal(atomEntries[0].publishedAt, '2026-09-25T10:00:00.000Z');
    section('parseFeed RSS 2.0 + Atom');
  }

  // ── HTML anchor extraction ─────────────────────────────────────────────────
  {
    const html = `<html><body>
      <a href="/en/news/2026/new-placement-platform">New placement platform announced</a>
      <a href="/en/news/2026/new-placement-platform">New placement platform announced</a>
      <a href="/en/about">About</a>
      <a href="https://other.example/x">Some external article headline here</a>
      <a href="/en/news/2026/short">short</a>
    </body></html>`;
    const anchors = extractAnchors(html, 'https://www.mycronic.com/en/news/', 'mycronic\\.com/en/news/[^"]+');
    assert.equal(anchors.length, 1);
    assert.equal(anchors[0].url, 'https://www.mycronic.com/en/news/2026/new-placement-platform');
    section('extractAnchors (pattern + dedupe + length gate)');
  }

  // ── Canonical URL / dedupe ─────────────────────────────────────────────────
  {
    assert.equal(normalizeUrl('https://Example.com/post/?utm_source=x&utm_medium=y#section'), 'https://example.com/post');
    assert.equal(normalizeUrl('https://example.com/post?fbclid=abc&id=7'), 'https://example.com/post?id=7');
    assert.equal(normalizeUrl('https://example.com/post?spm=1.2&from=wechat'), 'https://example.com/post');
    assert.equal(normalizeUrl('javascript:alert(1)'), '');
    assert.equal(fingerprintItem({ id: 'a', title: 'T', url: 'https://example.com/post?utm_campaign=z' }), 'https://example.com/post');

    const mergeResult = mergeItemLibrary([
      { id: 'old_1', title: 'MLCC lead times', url: 'https://example.com/post?utm_source=x', score: 3, firstSeenAt: '2026-09-20T00:00:00Z', lastSeenAt: '2026-09-20T00:00:00Z', seenCount: 1, fingerprint: 'https://example.com/post' },
    ], [
      { id: 'new_same', title: 'MLCC lead times', url: 'https://example.com/post/#top', score: 9 },
      { id: 'new_2', title: 'Reflow oven launch', url: 'https://example.com/reflow', score: 4 },
      { id: 'bad', title: 'Bad URL', url: 'javascript:alert(1)', score: 1 },
    ], '2026-09-21T00:00:00Z');
    assert.equal(mergeResult.newItemCount, 2);
    assert.equal(mergeResult.reusedItemCount, 1);
    assert.equal(mergeResult.reusedItems[0].seenCount, 2);
    assert.equal(mergeResult.reusedItems[0].score, 9);
    section('normalizeUrl strips utm_*/trackers/fragment; mergeItemLibrary dedupes');
  }

  // ── Policy ─────────────────────────────────────────────────────────────────
  {
    assert.equal(findAbsoluteWords('最新版 IPC 标准于 9 月发布'), null);
    assert.equal(findAbsoluteWords('第一季度出货量增长'), null);
    assert.ok(findAbsoluteWords('全球最大的贴片机厂商'));
    assert.ok(findAbsoluteWords('行业领先的解决方案'));
    assert.ok(findAbsoluteWords('the industry-leading platform'));
    assert.ok(findComparativeClaim('A 品牌优于 B 品牌'));
    assert.equal(findComparativeClaim('公司宣布扩产'), null);
    assert.equal(checkSummary('Fuji 宣布在越南新建工厂，2027 年投产。').length, 0); // vendor attribution OK
    assert.ok(checkNeotelNote('与 Fuji 的方案相比更适合料仓').length >= 2); // competitor + comparative
    assert.ok(checkNeotelNote('欢迎联系我们试用').length >= 1);
    assert.equal(checkNeotelNote('元器件交期拉长时，料盘注册与点料数据的准确性直接影响补料计划。').length, 0);
    const long = '这是一个非常长的摘要，'.repeat(20);
    assert.ok(Array.from(clampSummary(long, 80)).length <= 80);
    assert.equal(clampSummary('短句。'), '短句。');
    section('policy: absolute / comparative / competitor / sales / clamp');
  }

  // ── Writer output split ────────────────────────────────────────────────────
  {
    const raw = `# 2026-09-27 PCB/SMT 行业趋势日报\n\n## 今日要点\n- 要点一\n\n${BRIEF_JSON_MARKER}\n\`\`\`json\n{"titleZh":"T","highlights":[{"text":"要点一","itemIds":["i1"]}],"neotelNote":""}\n\`\`\``;
    const split = splitWriterOutput(raw);
    assert.ok(split.markdown.endsWith('- 要点一'));
    assert.equal(split.tail?.titleZh, 'T');
    assert.equal(split.tail?.highlights?.[0].itemIds?.[0], 'i1');
    assert.equal(splitWriterOutput('# only markdown').tail, null);
    section('splitWriterOutput');
  }

  // ── Brief assembly + schema validation (mocked pipeline output) ────────────
  const generatedAt = '2026-09-28T01:14:32.000Z'; // 09:14:32+08:00
  const items: TrendSourceItem[] = [
    { id: 'emsnow_a', source: 'EMSNOW', title: 'EMS provider opens second SMT line in Monterrey', url: 'https://www.emsnow.com/ems-monterrey-line/?utm_source=rss', score: 78, category: '厂商动态', publishedAt: '2026-09-26T08:00:00.000Z', aiSummary: '一家 EMS 厂商在墨西哥蒙特雷启用第二条 SMT 产线，面向汽车电子客户。', firstSeenAt: '2026-09-28T01:02:00.000Z', lastSeenAt: '2026-09-28T01:02:00.000Z', seenCount: 1, isNew: true },
    { id: 'esm_b', source: '国际电子商情', title: 'MLCC 交期延长至 20 周', url: 'https://www.esmchina.com/news/12345', score: 85, category: '供应链', publishedAt: '2026-09-27T02:00:00.000Z', aiSummary: '多家分销商反馈车规 MLCC 交期从 12 周延长至 20 周，库存周转承压。', firstSeenAt: '2026-09-27T01:02:00.000Z', lastSeenAt: '2026-09-28T01:02:00.000Z', seenCount: 2 },
    { id: 'gea_c', source: 'Global Electronics Association (formerly IPC)', title: 'IPC-A-610J released', url: 'https://www.electronics.org/news/ipc-a-610j#top', score: 90, category: '政策标准', publishedAt: '2026-09-25T10:00:00.000Z', aiSummary: 'IPC-A-610J 电子组件可接受性标准发布，替代 2020 年的 H 版。', seenCount: 1, isNew: true },
    { id: 'ele_d', source: '电子发烧友', title: '全球最强贴片机发布', url: 'https://www.elecfans.com/news/999.html', score: 55, category: '设备', publishedAt: '2026-09-27T05:00:00.000Z', aiSummary: '某厂商发布号称全球最强的贴片机。', seenCount: 1, isNew: true },
  ];
  const markdown = '# 2026-09-28 PCB/SMT 行业趋势日报\n\n## 今日要点\n- IPC-A-610J 发布（GEA）\n- 车规 MLCC 交期延长至 20 周（国际电子商情）\n\n## 挚锦解读\n本期无';
  const tail = {
    titleZh: '2026-09-28 PCB/SMT 行业趋势日报',
    highlights: [
      { text: 'IPC-A-610J 发布，替代 2020 年的 H 版。', itemIds: ['gea_c'] },
      { text: '车规 MLCC 交期延长至 20 周，库存周转承压。', itemIds: ['esm_b', 'ghost_id'] },
      { text: '只有幽灵 id 的要点', itemIds: ['nope'] },
      { text: '业内领先的方案', itemIds: ['gea_c'] },
    ],
    neotelNote: '交期拉长时，料盘注册与点料数据的准确性直接影响补料计划。',
  };
  const brief = buildBrief({ runId: 'run_test_ab12', items, markdown, tail, generatedAt, windowHours: 24 });
  {
    const v = validateBrief(brief);
    assert.ok(v.ok, `brief schema errors: ${JSON.stringify(v.errors)}`);
    assert.equal(brief.status, 'completed');
    assert.equal(brief.generatedAt, '2026-09-28T09:14:32+08:00');
    assert.equal(brief.window.from, '2026-09-27T09:14:32+08:00');
    assert.equal(brief.items.length, 4);
    assert.ok(brief.items.every(i => /^[0-9a-f]{40}$/.test(i.id)));
    assert.ok(brief.items.every(i => Array.from(i.summaryZh).length <= 80));
    const ems = brief.items.find(i => i.source === 'EMSNOW')!;
    assert.equal(ems.url, 'https://www.emsnow.com/ems-monterrey-line'); // utm stripped, trailing slash dropped
    assert.equal(ems.eventTime, '2026-09-26');
    const gea = brief.items.find(i => i.topic === '政策标准')!;
    assert.equal(gea.url, 'https://www.electronics.org/news/ipc-a-610j'); // fragment stripped
    const absolute = brief.items.find(i => i.source === '电子发烧友')!;
    assert.equal(absolute.summaryZh, '全球最强贴片机发布'); // degraded to title (still needs human eye; title is factual attribution)
    assert.equal(brief.report.highlights.length, 2); // ghost-only + absolute-word highlights dropped
    assert.deepEqual(brief.report.highlights[1].itemIds, [brief.items.find(i => i.topic === '供应链')!.id]);
    // ties are ordered by the topic enum (设备 → 材料 → 供应链 → 政策标准 → 展会 → 厂商动态)
    assert.deepEqual(brief.report.topics.map(t => `${t.name}:${t.count}`), ['设备:1', '供应链:1', '政策标准:1', '厂商动态:1']);
    assert.equal(brief.report.neotelNote, tail.neotelNote);
    assert.equal(brief.report.titleZh, '2026-09-28 PCB/SMT 行业趋势日报');
    section('buildBrief → validateBrief ok (ids, utm/fragment, highlights, topics, note)');

    // competitor name in neotelNote → emptied; absolute word → emptied
    const b2 = buildBrief({ runId: 'r2', items, markdown, tail: { ...tail, neotelNote: '相比 Inovaxe 的方案更好' }, generatedAt });
    assert.equal(b2.report.neotelNote, '');
    const b3 = buildBrief({ runId: 'r3', items, markdown, tail: { ...tail, neotelNote: '行业领先的料仓' }, generatedAt });
    assert.equal(b3.report.neotelNote, '');
    // no tail → highlights derived from top items, still valid
    const b4 = buildBrief({ runId: 'r4', items, markdown, tail: null, generatedAt });
    assert.ok(validateBrief(b4).ok);
    assert.ok(b4.report.highlights.length >= 1);
    // empty run
    const b5 = buildBrief({ runId: 'r5', items: [], markdown: '# empty', generatedAt });
    assert.equal(b5.status, 'empty');
    assert.ok(validateBrief(b5).ok);
    section('buildBrief policy fall-backs');

    // schema validator rejects bad shapes
    const bad = JSON.parse(JSON.stringify(brief));
    bad.items[0].topic = 'AI Agent';
    bad.items[0].score = 120;
    bad.report.highlights[0].itemIds = ['deadbeef'.repeat(5)];
    delete bad.window.to;
    bad.extra = 1;
    const errs = validateBrief(bad).errors.map(e => `${e.path}: ${e.message}`);
    assert.ok(errs.some(e => e.includes('$.items[0].topic')));
    assert.ok(errs.some(e => e.includes('$.items[0].score')));
    assert.ok(errs.some(e => e.includes('$.window.to')));
    assert.ok(errs.some(e => e.includes('$.extra')));
    assert.ok(errs.some(e => e.includes('unknown item id')));
    assert.equal(validateAgainstSchema('x', { type: 'integer' }).length, 1);
    section('validateBrief rejects enum/range/required/additional/unknown-id');

    // schema.json mirror
    const onDisk = JSON.parse(await readFile(resolve(process.cwd(), 'schema.json'), 'utf8'));
    assert.deepEqual(onDisk, JSON.parse(JSON.stringify(BRIEF_SCHEMA)), 'schema.json out of date — run `npm run schema`');
    section('schema.json mirrors BRIEF_SCHEMA');

    await writeFile(resolve(process.cwd(), 'docs', 'sample-brief.json'), `${JSON.stringify(brief, null, 2)}\n`, 'utf8');
  }

  // ── Fallback report ────────────────────────────────────────────────────────
  const report = generateFallbackReport(items.slice(0, 2), 'run_test');
  {
    assert.equal(report.runId, 'run_test');
    assert.equal(report.status, 'success');
    assert.match(report.reportMarkdown, /PCB\/SMT 行业趋势日报/);
    assert.match(report.reportMarkdown, /供应链/);
    assert.match(report.reportMarkdown, /https:\/\/www\.esmchina\.com\/news\/12345/);
    assert.equal(report.trends.length, 2);
    section('generateFallbackReport');
  }

  // ── Memory persistence + kind filter ───────────────────────────────────────
  {
    const fakeContext = { store: new FakeMemory() };
    report.kind = 'daily';
    report.brief = brief;
    report.generatedAt = generatedAt;
    await saveReportToMemory(fakeContext, report);
    const weekly: TrendReport = { ...report, runId: 'weekly_1', kind: 'weekly', generatedAt: '2026-09-28T02:00:00.000Z' };
    await saveReportToMemory(fakeContext, weekly);

    assert.equal((await loadLatestReportFromMemory(fakeContext))?.runId, 'weekly_1');
    assert.equal((await loadLatestReportFromMemory(fakeContext, 'daily'))?.runId, 'run_test');
    assert.equal((await loadLatestReportFromMemory(fakeContext, 'daily'))?.storage, 'memory');
    const history = await loadHistoryFromMemory(fakeContext);
    assert.deepEqual(history.map(h => h.kind), ['weekly', 'daily']);
    assert.equal((await loadReportFromMemory(fakeContext, 'run_test') as TrendReport | null)?.reportMarkdown, report.reportMarkdown);
    assert.equal((await loadReportsSince(fakeContext, '2026-09-21T00:00:00.000Z', 'daily')).length, 1);
    section('memory: save/latest(kind)/history/detail/since');
  }

  // ── Weekly roll-up ─────────────────────────────────────────────────────────
  {
    const day1: TrendReport = { ...report, runId: 'd1', kind: 'daily', status: 'success', generatedAt: '2026-09-26T01:10:00.000Z', items: items.slice(0, 3), brief };
    const day2: TrendReport = { ...report, runId: 'd2', kind: 'daily', status: 'success', generatedAt: '2026-09-27T01:10:00.000Z', items: items.slice(1), brief: { ...brief, report: { ...brief.report, neotelNote: '' } } };
    const failed: TrendReport = { ...report, runId: 'd3', kind: 'daily', status: 'failed', generatedAt: '2026-09-28T01:10:00.000Z', items: [] };
    const weekly = buildWeeklyReport({ runId: 'weekly_test', dailyReports: [day1, day2, failed], generatedAt: '2026-10-02T02:00:00.000Z' });
    assert.equal(weekly.kind, 'weekly');
    assert.equal(weekly.status, 'success');
    assert.equal(weekly.itemCount, 4); // 3 + 3 with 2 overlapping → 4 unique
    assert.equal(weekly.reusedItemCount, 2); // seen on both days
    const wb = weekly.brief as ReturnType<typeof buildBrief>;
    const wv = validateBrief(wb);
    assert.ok(wv.ok, `weekly brief errors: ${JSON.stringify(wv.errors)}`);
    assert.equal(wb.window.to, toShanghaiIso('2026-10-02T02:00:00.000Z'));
    assert.equal(wb.window.from, toShanghaiIso('2026-09-25T02:00:00.000Z'));
    assert.ok(wb.items.some(i => i.seenCount >= 2));
    assert.equal(wb.report.neotelNote, tail.neotelNote); // carried over from day1
    assert.match(weekly.reportMarkdown, /行业趋势周报/);
    assert.match(weekly.reportMarkdown, /工厂决策视角/);
    const empty = buildWeeklyReport({ runId: 'w0', dailyReports: [], generatedAt });
    assert.equal(empty.status, 'empty');
    assert.ok(validateBrief(empty.brief).ok);
    section('weekly roll-up (dedupe, daysSeen, note carry-over, schema ok)');
  }

  // ── File-system fallback storage ───────────────────────────────────────────
  {
    const dir = await mkdtemp(join(tmpdir(), 'trends-node-'));
    try {
      report.newItemCount = 2;
      report.reusedItemCount = 1;
      await saveReport(report, dir);
      assert.equal((await loadLatestReport(dir))?.runId, 'run_test');
      assert.equal((await loadReport('run_test', dir))?.reportMarkdown, report.reportMarkdown);
      assert.equal((await loadHistory(dir))[0]?.runId, 'run_test');
      assert.equal((await loadHistory(dir))[0]?.newItemCount, 2);
      section('file-system fallback storage');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  console.log('\nAll tests passed. Sample brief → docs/sample-brief.json');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
