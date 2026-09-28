/**
 * Listed-company registry for the `listed` collector (plan: cn/trend-brief/PLAN-listed-companies-2026-09-28.md §1, phase 1).
 *
 *  tier        equip = SMT equipment vendors (the readers' suppliers) · ems = EMS/ODM (peers, Neotel's customers)
 *              comp  = components / PCB (upstream)
 *  sector      CSV classification (中国SMT行业上市公司清单.csv 分类) for the 50 mainland/HK SMT-supply-chain listed
 *              companies only: 设备 = SMT设备, EMS = EMS / EMS-PCB, PCB = PCB. Non-CSV entries (Fuji, Koh Young,
 *              Nordson, EDGAR/RSS/DART names, etc.) have no sector.
 *  platform    cninfo (A-share announcements, orgId resolved at runtime) · hkex (HKEXnews title search, stockId resolved)
 *              edgar (SEC EDGAR atom by ticker) · rss · page_fuji · page_cision
 *  competitor  true = list facts only, NEVER a 挚锦解读 (JFE rule / CLAUDE.md)
 */

export type Tier = 'equip' | 'ems' | 'comp';
export type Platform = 'cninfo' | 'hkex' | 'edgar' | 'dart' | 'rss' | 'page_fuji' | 'page_cision';
export type Sector = '设备' | 'EMS' | 'PCB';

/** DART (Korea FSS OpenAPI) corp_code by stock code — resolved once from corpCode.xml on 2026-09-28. Needs env DART_API_KEY. */
export const DART_CORP_CODE: Record<string, string> = { '098460': '00579999', '012450': '00126566', '009150': '00126371' };

export interface ListedCompany {
  name: string;
  tier: Tier;
  platform: Platform;
  id: string;            // stock code / ticker / feed or page url
  competitor?: boolean;
  note?: string;
  sector?: Sector;        // set only for the 50 CSV companies (中国SMT行业上市公司清单.csv)
}

export const LISTED_COMPANIES: ListedCompany[] = [
  // ── equipment ──
  { name: 'ASMPT', tier: 'equip', platform: 'hkex', id: '00522', note: 'SMT 解决方案分部（贴片机）' },
  { name: 'Fuji 富士', tier: 'equip', platform: 'page_fuji', id: 'https://www.fuji.co.jp/en/news/', note: '贴片机 NXT' },
  { name: 'Koh Young', tier: 'equip', platform: 'rss', id: 'https://kohyoung.com/en/feed', note: '3D SPI/AOI' },
  { name: 'Koh Young', tier: 'equip', platform: 'dart', id: '098460', note: 'KOSDAQ filings (corp_code 00579999)' },
  // Hanwha Aerospace (012450, corp_code 00126566) dropped 2026-09-28: its DART filings are the parent's defence contracts,
  // not the placement-machine subsidiary (Hanwha Precision Machinery is unlisted) → no signal for SMT readers.
  { name: '三星电机', tier: 'comp', platform: 'dart', id: '009150', note: 'MLCC 等元器件 (corp_code 00126371)' },
  // Mycronic (competitor): its Cision newsroom stopped in 2023 and mycronic.com has no feed → phase 2 (needs a page scraper w/ cookie wall)
  { name: 'Nordson', tier: 'equip', platform: 'edgar', id: 'NDSN', note: 'SPI/AOI、点胶' },
  { name: 'Kulicke & Soffa', tier: 'equip', platform: 'edgar', id: 'KLIC', note: '贴片/键合设备' },
  { name: 'Camtek', tier: 'equip', platform: 'edgar', id: 'CAMT', note: '检测' },
  { name: '快克智能', tier: 'equip', platform: 'cninfo', id: '603203', note: '选择性波峰焊/真空回流焊/TCB', sector: '设备' },
  { name: '劲拓股份', tier: 'equip', platform: 'cninfo', id: '300400', note: '回流焊/波峰焊/AOI', sector: '设备' },
  { name: '凯格精机', tier: 'equip', platform: 'cninfo', id: '301338', note: '锡膏印刷机', sector: '设备' },   // 301238 = 瑞泰新材 (verified against cninfo list 2026-09-28)
  { name: '矩子科技', tier: 'equip', platform: 'cninfo', id: '300802', note: 'AOI/SPI/贴片机', sector: '设备' },
  { name: '华兴源创', tier: 'equip', platform: 'cninfo', id: '688001', note: '检测设备' },
  { name: '大族激光', tier: 'equip', platform: 'cninfo', id: '002008', note: '激光焊接/回流焊(平台型)', sector: '设备' },
  { name: '天准科技', tier: 'equip', platform: 'cninfo', id: '688003', note: 'LDI/AOI/贴片机(在研)', sector: '设备' },
  { name: '思泰克', tier: 'equip', platform: 'cninfo', id: '301568', note: '3D SPI/3D AOI', sector: '设备' },
  { name: '日联科技', tier: 'equip', platform: 'cninfo', id: '688549', note: 'X-ray检测', sector: '设备' },
  { name: '大族数控', tier: 'equip', platform: 'cninfo', id: '301200', note: 'PCB钻孔/曝光/成型', sector: '设备' },
  { name: '芯碁微装', tier: 'equip', platform: 'cninfo', id: '688630', note: 'LDI直写光刻', sector: '设备' },
  { name: '东威科技', tier: 'equip', platform: 'cninfo', id: '688700', note: 'VCP垂直连续电镀', sector: '设备' },
  { name: '正业科技', tier: 'equip', platform: 'cninfo', id: '300410', note: 'PCB检测/激光钻孔', sector: '设备' },
  { name: '鼎泰高科', tier: 'equip', platform: 'cninfo', id: '301377', note: 'PCB钻针', sector: '设备' },
  { name: '中钨高新', tier: 'equip', platform: 'cninfo', id: '000657', note: 'PCB微钻(金洲精工)', sector: '设备' },
  { name: '德龙激光', tier: 'equip', platform: 'cninfo', id: '688170', note: '激光钻孔/切割', sector: '设备' },
  { name: '英诺激光', tier: 'equip', platform: 'cninfo', id: '301021', note: '激光钻孔/分板', sector: '设备' },
  { name: '燕麦科技', tier: 'equip', platform: 'cninfo', id: '688312', note: 'FPC测试设备', sector: '设备' },
  { name: '日东科技', tier: 'equip', platform: 'hkex', id: '00365', note: '贴片机/回流焊/自动化线', sector: '设备' },
  // ── EMS / ODM ──
  { name: '工业富联', tier: 'ems', platform: 'cninfo', id: '601138', note: 'EMS/AI服务器/云计算组装', sector: 'EMS' },
  { name: '环旭电子', tier: 'ems', platform: 'cninfo', id: '601231', note: 'SiP模组/电子组装', sector: 'EMS' },
  { name: '立讯精密', tier: 'ems', platform: 'cninfo', id: '002475', note: 'EMS/精密制造', sector: 'EMS' },
  { name: '深科技', tier: 'ems', platform: 'cninfo', id: '000021' },
  { name: '比亚迪电子', tier: 'ems', platform: 'hkex', id: '00285', note: 'EMS/汽车电子+消费电子', sector: 'EMS' },
  { name: '华勤技术', tier: 'ems', platform: 'cninfo', id: '603296', note: 'ODM手机/笔电/服务器', sector: 'EMS' },
  { name: '歌尔股份', tier: 'ems', platform: 'cninfo', id: '002241', note: '声学/VR/AR/穿戴', sector: 'EMS' },
  { name: '龙旗科技', tier: 'ems', platform: 'cninfo', id: '603341', note: 'ODM手机/平板', sector: 'EMS' },
  { name: '蓝思科技', tier: 'ems', platform: 'cninfo', id: '300433', note: '盖板+组装', sector: 'EMS' },
  { name: '领益智造', tier: 'ems', platform: 'cninfo', id: '002600', note: '精密功能件+组装', sector: 'EMS' },
  { name: '冠捷科技', tier: 'ems', platform: 'cninfo', id: '000727', note: '显示器/电视代工', sector: 'EMS' },
  { name: '闻泰科技', tier: 'ems', platform: 'cninfo', id: '600745', note: '手机ODM+半导体(安世)', sector: 'EMS' },
  { name: '光弘科技', tier: 'ems', platform: 'cninfo', id: '300735', note: 'EMS消费+汽车电子', sector: 'EMS' },
  { name: '共进股份', tier: 'ems', platform: 'cninfo', id: '603118', note: '通信设备EMS', sector: 'EMS' },
  { name: '东山精密', tier: 'ems', platform: 'cninfo', id: '002384', note: 'FPC+PCBA', sector: 'PCB' },
  { name: 'Flex', tier: 'ems', platform: 'edgar', id: 'FLEX' },
  { name: 'Jabil', tier: 'ems', platform: 'edgar', id: 'JBL' },
  { name: 'Sanmina', tier: 'ems', platform: 'edgar', id: 'SANM' },
  { name: 'Celestica', tier: 'ems', platform: 'edgar', id: 'CLS' },
  { name: 'Plexus', tier: 'ems', platform: 'edgar', id: 'PLXS' },
  { name: 'Benchmark', tier: 'ems', platform: 'edgar', id: 'BHE' },
  { name: 'Fabrinet', tier: 'ems', platform: 'edgar', id: 'FN' },
  // ── components / PCB ──
  { name: '深南电路', tier: 'comp', platform: 'cninfo', id: '002916', note: 'PCB+封装基板+电子装联(PCBA)', sector: 'PCB' },
  { name: '沪电股份', tier: 'comp', platform: 'cninfo', id: '002463', note: '高速通信板/汽车板', sector: 'PCB' },
  { name: '鹏鼎控股', tier: 'comp', platform: 'cninfo', id: '002938', note: 'FPC/HDI/通讯板', sector: 'PCB' },
  { name: '风华高科', tier: 'comp', platform: 'cninfo', id: '000636' },
  { name: '三环集团', tier: 'comp', platform: 'cninfo', id: '300408' },
  { name: '顺络电子', tier: 'comp', platform: 'cninfo', id: '002138' },
  { name: '生益科技', tier: 'comp', platform: 'cninfo', id: '600183', note: '覆铜板CCL+PCB', sector: 'PCB' },
  { name: '胜宏科技', tier: 'comp', platform: 'cninfo', id: '300476', note: 'AI服务器HDI/汽车板', sector: 'PCB' },
  { name: '景旺电子', tier: 'comp', platform: 'cninfo', id: '603228', note: '多品类PCB+汽车PCBA', sector: 'PCB' },
  { name: '生益电子', tier: 'comp', platform: 'cninfo', id: '688183', note: '通信设备PCB', sector: 'PCB' },
  { name: '崇达技术', tier: 'comp', platform: 'cninfo', id: '002815', note: '多品种小批量PCB', sector: 'PCB' },
  { name: '弘信电子', tier: 'comp', platform: 'cninfo', id: '300657', note: 'FPC', sector: 'PCB' },
  { name: '兴森科技', tier: 'comp', platform: 'cninfo', id: '002436', note: 'IC封装基板/测试板', sector: 'PCB' },
  { name: '奥士康', tier: 'comp', platform: 'cninfo', id: '002913', note: '服务器/数据中心PCB', sector: 'PCB' },
  { name: '世运电路', tier: 'comp', platform: 'cninfo', id: '603920', note: '汽车PCB出口', sector: 'PCB' },
  { name: '博敏电子', tier: 'comp', platform: 'cninfo', id: '603936', note: '陶瓷/金属基特种PCB', sector: 'PCB' },
  { name: '金禄电子', tier: 'comp', platform: 'cninfo', id: '301282', note: '新能源BMS用PCB', sector: 'PCB' },
  { name: '科翔股份', tier: 'comp', platform: 'cninfo', id: '300903', note: 'HDI/厚铜板', sector: 'PCB' },
  { name: '中京电子', tier: 'comp', platform: 'cninfo', id: '002579', note: '车用板/Mini LED', sector: 'PCB' },
  { name: '超声电子', tier: 'comp', platform: 'cninfo', id: '000823', note: '车载雷达板/PCB', sector: 'PCB' },
  { name: '广东骏亚', tier: 'comp', platform: 'cninfo', id: '603386', note: '刚性板', sector: 'PCB' },
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
