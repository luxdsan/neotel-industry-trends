/**
 * Listed-company registry for the `listed` collector (plan: cn/trend-brief/PLAN-listed-companies-2026-09-28.md §1, phase 1).
 *
 *  tier        equip = SMT equipment vendors (the readers' suppliers) · ems = EMS/ODM (peers, Neotel's customers)
 *              comp  = components / PCB (upstream)
 *  platform    cninfo (A-share announcements, orgId resolved at runtime) · hkex (HKEXnews title search, stockId resolved)
 *              edgar (SEC EDGAR atom by ticker) · rss · page_fuji · page_cision
 *  competitor  true = list facts only, NEVER a 挚锦解读 (JFE rule / CLAUDE.md)
 */

export type Tier = 'equip' | 'ems' | 'comp';
export type Platform = 'cninfo' | 'hkex' | 'edgar' | 'rss' | 'page_fuji' | 'page_cision';

export interface ListedCompany {
  name: string;
  tier: Tier;
  platform: Platform;
  id: string;            // stock code / ticker / feed or page url
  competitor?: boolean;
  note?: string;
}

export const LISTED_COMPANIES: ListedCompany[] = [
  // ── equipment ──
  { name: 'ASMPT', tier: 'equip', platform: 'hkex', id: '00522', note: 'SMT 解决方案分部（贴片机）' },
  { name: 'Fuji 富士', tier: 'equip', platform: 'page_fuji', id: 'https://www.fuji.co.jp/en/news/', note: '贴片机 NXT' },
  { name: 'Koh Young', tier: 'equip', platform: 'rss', id: 'https://kohyoung.com/en/feed', note: '3D SPI/AOI' },
  // Mycronic (competitor): its Cision newsroom stopped in 2023 and mycronic.com has no feed → phase 2 (needs a page scraper w/ cookie wall)
  { name: 'Nordson', tier: 'equip', platform: 'edgar', id: 'NDSN', note: 'SPI/AOI、点胶' },
  { name: 'Kulicke & Soffa', tier: 'equip', platform: 'edgar', id: 'KLIC', note: '贴片/键合设备' },
  { name: 'Camtek', tier: 'equip', platform: 'edgar', id: 'CAMT', note: '检测' },
  { name: '快克智能', tier: 'equip', platform: 'cninfo', id: '603203', note: '焊接/精密装联设备' },
  { name: '劲拓股份', tier: 'equip', platform: 'cninfo', id: '300400', note: '回流焊/波峰焊' },
  { name: '凯格精机', tier: 'equip', platform: 'cninfo', id: '301338', note: '锡膏印刷机' },   // 301238 = 瑞泰新材 (verified against cninfo list 2026-09-28)
  { name: '矩子科技', tier: 'equip', platform: 'cninfo', id: '300802', note: 'AOI/机器视觉' },
  { name: '华兴源创', tier: 'equip', platform: 'cninfo', id: '688001', note: '检测设备' },
  { name: '大族激光', tier: 'equip', platform: 'cninfo', id: '002008', note: '激光/PCB 设备' },
  { name: '天准科技', tier: 'equip', platform: 'cninfo', id: '688003', note: '视觉检测' },
  // ── EMS / ODM ──
  { name: '工业富联', tier: 'ems', platform: 'cninfo', id: '601138' },
  { name: '环旭电子', tier: 'ems', platform: 'cninfo', id: '601231' },
  { name: '立讯精密', tier: 'ems', platform: 'cninfo', id: '002475' },
  { name: '深科技', tier: 'ems', platform: 'cninfo', id: '000021' },
  { name: '比亚迪电子', tier: 'ems', platform: 'hkex', id: '00285' },
  { name: 'Flex', tier: 'ems', platform: 'edgar', id: 'FLEX' },
  { name: 'Jabil', tier: 'ems', platform: 'edgar', id: 'JBL' },
  { name: 'Sanmina', tier: 'ems', platform: 'edgar', id: 'SANM' },
  { name: 'Celestica', tier: 'ems', platform: 'edgar', id: 'CLS' },
  { name: 'Plexus', tier: 'ems', platform: 'edgar', id: 'PLXS' },
  { name: 'Benchmark', tier: 'ems', platform: 'edgar', id: 'BHE' },
  { name: 'Fabrinet', tier: 'ems', platform: 'edgar', id: 'FN' },
  // ── components / PCB ──
  { name: '深南电路', tier: 'comp', platform: 'cninfo', id: '002916' },
  { name: '沪电股份', tier: 'comp', platform: 'cninfo', id: '002463' },
  { name: '鹏鼎控股', tier: 'comp', platform: 'cninfo', id: '002938' },
  { name: '风华高科', tier: 'comp', platform: 'cninfo', id: '000636' },
  { name: '三环集团', tier: 'comp', platform: 'cninfo', id: '300408' },
  { name: '顺络电子', tier: 'comp', platform: 'cninfo', id: '002138' },
  { name: 'TTM Technologies', tier: 'comp', platform: 'edgar', id: 'TTMI' },
];

export const TIER_LABEL: Record<Tier, string> = { equip: '设备商', ems: 'EMS / ODM', comp: '元器件 / PCB' };

/** Tools a 挚锦解读 may link to (href on www.neotel.tech). The model picks a key or "". */
export const LISTED_TOOLS: Record<string, { href: string; label: string; when: string }> = {
  pandian:  { href: '/pandian',  label: '盘点成本测算表',       when: '库存盘点、账实差异、设备交期变化' },
  sunhao:   { href: '/sunhao',   label: '损耗率与抛料率对照表', when: '物料损耗、抛料、良率成本' },
  xuanxing: { href: '/xuanxing', label: '料仓与料架选型对照表', when: '新厂/新产线/扩产/搬迁' },
  duijie:   { href: '/duijie',   label: 'MES 对接 15 问清单',   when: '数字化、MES/ERP、智能工厂投入' },
  queliao:  { href: '/archives/24813', label: '缺料排查方法',   when: '元器件缺货、涨价、交期拉长' },
  roi:      { href: '/smart-materials-handling-roi-calculator', label: 'ROI 计算器', when: '自动化投资、资本开支' },
};
