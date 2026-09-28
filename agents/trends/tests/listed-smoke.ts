/**
 * Smoke test for the listed-company collectors against the REAL sources (network), no model calls.
 *   npm run schema   (compiles to .test-build) then:  node .test-build/trends/tests/listed-smoke.js [name,name,...]
 */
import { buildListedDoc, collectListed, summariseNew } from '../_listed.js';
import { LISTED_COMPANIES } from '../_listed_companies.js';

const arg = process.argv[2];
const names = arg ? arg.split(',') : ['快克智能', '环旭电子', 'ASMPT', 'Nordson', 'Koh Young', 'Fuji 富士', 'Mycronic'];
const companies = LISTED_COMPANIES.filter(c => names.includes(c.name));

const t0 = Date.now();
const { items, bySource, errors } = await collectListed(60, companies, undefined, process.env as Record<string, string | undefined>);
// SMOKE_MODEL_CALLS=n → run the summariser for up to n items with text (needs LLM_API_KEY/LLM_BASE_URL/LLM_MODEL in env)
const modelCalls = Number(process.env.SMOKE_MODEL_CALLS || 0);
const calls = modelCalls > 0 ? await summariseNew(items, process.env as Record<string, string | undefined>, modelCalls) : 0;
const doc = buildListedDoc('smoke', items, null, 60, bySource, errors, calls);
console.log(JSON.stringify({ companies: companies.length, items: items.length, kept: doc.items.length, bySource, errors, ms: Date.now() - t0 }, null, 1));
for (const i of doc.items.slice(0, 40)) {
  console.log(`${i.date} [${i.tier}] ${i.company} · ${i.kind} · ${i.title.slice(0, 70)} · ${i.source} · text=${(items.find(x => x.id === i.id)?.text || '').length}`);
  console.log(`      ${i.url}`);
  if (i.summaryZh) console.log(`      摘要: ${i.summaryZh}${i.note ? `\n      解读: ${i.note}${i.toolLabel ? ` → ${i.toolLabel}` : ''}` : ''}`);
}
