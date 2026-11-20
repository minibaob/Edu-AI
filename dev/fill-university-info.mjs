// 高校基础信息补全（模块5 数据维护工具，可重复运行）：
// 读取 db/import/basic-info-sources/ 下的来源快照，对两省 universities.csv 只补空列、不覆盖已有非空值，
// 备注追加来源与实测说明；「数据来源」列保持原录取数据出处不变。
// 来源：教育部《全国高等学校名单》（截至2026-06-17，roy-tian/cn-universities 镜像）、
// DaoSword/China-Education-Data《高等教育数据宽表v20230118》、掌上高考院校库 static-data.gaokao.cn（2026-11-20 抓取）。
// 网址 https 可达性用 curl（系统信任库）实测，结果缓存于 basic-info-sources/verified.json；--verify 强制重测。
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES = path.join(REPO, 'db', 'import', 'basic-info-sources');
const FORCE_VERIFY = process.argv.includes('--verify');

const PROVINCES = ['北京', '天津', '河北', '山西', '内蒙古', '辽宁', '吉林', '黑龙江', '上海', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南', '广东', '广西', '海南', '重庆', '四川', '贵州', '云南', '西藏', '陕西', '甘肃', '青海', '宁夏', '新疆'];
const TYPES = ['综合', '理工', '农林', '医药', '师范', '语言', '财经', '政法', '体育', '艺术', '军事', '其他'];
const TAGS = ['双一流', '985', '211', '公办', '民办', '中外合作'];

function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { field += '"'; i += 1; } else quoted = false; } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

const csvCell = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

const normProv = (p) => {
  if (!p) return '';
  const t = p.replace(/(壮族自治区|回族自治区|维吾尔自治区|自治区|省|市)$/, '');
  return PROVINCES.includes(t) ? t : '';
};
const mapLevel = (l) => (l === '本科' ? '本科' : l === '专科' || l === '专科（高职）' ? '专科' : '');
const mapType = (t) => {
  if (!t) return '';
  const s = t.replace(/类$/, '');
  if (s === '民族') return '其他';
  return TYPES.includes(s) ? s : '';
};
const mapOwnership = (n) => (n === '公办' || n === '民办' || n === '中外合作' ? n : n === '中外合作办学' ? '中外合作' : '');

const moe = fs.readFileSync(path.join(SOURCES, 'universities-moe-2026-06.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const moeBy5 = new Map(); const moeByName = new Map();
for (const m of moe) { if (m.code) moeBy5.set(m.code.slice(-5), m); moeByName.set(m.name, m); }

const wideRows = parseCsv(fs.readFileSync(path.join(SOURCES, 'daosword-wide-table-v20230118.csv'), 'utf8'));
const wh = wideRows[0];
const wcol = (r, n) => (r[wh.indexOf(n)] ?? '').trim();
const wideBy5 = new Map(); const wideByName = new Map();
for (const r of wideRows.slice(1)) {
  const code = wcol(r, '学校标识码').replace(/\.0$/, '');
  const rec = {
    name: wcol(r, '学校名称'), category: wcol(r, '学校类别'), website: wcol(r, '学校官网'),
    province: wcol(r, '所在省份'), city: wcol(r, '所在城市'), level: wcol(r, '办学层次'), nature: wcol(r, '学校性质'),
    f985: parseFloat(wcol(r, '985工程')) === 1, f211: parseFloat(wcol(r, '211工程')) === 1, dfc: parseFloat(wcol(r, '双一流建设')) === 1,
  };
  if (code.length >= 5) wideBy5.set(code.slice(-5), rec);
  if (rec.name) wideByName.set(rec.name, rec);
}

const gk = JSON.parse(fs.readFileSync(path.join(SOURCES, 'gaokao-info-cache.json'), 'utf8'));

// 个别院校在教育部名单/掌上高考中无独立条目或已更名：随主校区或按更名后条目取数，均在备注注明。
const OVERRIDES = {
  19614: { parent: '10614', note: '沙河校区基础信息随主校区，招生网址为全校招生网。' },
  19635: { parent: '10635', note: '荣昌校区基础信息随主校区，招生网址为全校招生网。' },
  11104: { skipSite: true, site: 'https://www.ncist.edu.cn/', siteKind: 'official', note: '教育部2026年名单：华北科技学院与防灾科技学院合并组建应急管理大学。' },
  11775: { moeName: '应急管理大学', skipSite: true, site: 'https://www.ncist.edu.cn/', siteKind: 'official', note: '防灾科技学院并入应急管理大学，基础信息随大学。' },
  12514: { site: 'https://www.xjqg.edu.cn/zsw/', note: '2026年升格新疆工业职业技术大学，招生网址为学校招生信息网。' },
  51060: { moeName: '新疆工业职业技术大学', site: 'https://www.xjqg.edu.cn/zsw/', note: '已升格更名新疆工业职业技术大学，招生网址为学校招生信息网。' },
  14524: { note: '官网www.hmzyedu.cn的https证书不受信任（2026-11-20实测），招生网址留空。' },
  13726: { note: '未检索到https可达的公开官网（2026-11-20实测），招生网址留空。' },
  14416: { note: '未检索到https可达的公开官网（2026-11-20实测），招生网址留空。' },
  10692: { note: '公安院校，无公开官网，招生网址留空。' },
  81006: { city: '香港', note: '港澳高校，省份枚举不含港澳台，所在省份留空；公办标签据掌上高考。' },
  H0007: { city: '香港', note: '港澳高校，省份枚举不含港澳台，所在省份留空；公办标签据掌上高考。' },
  // 2026-11-20 定向检索：新建院校三个快照均无办学类型，按公开信息框登记；口径冲突或未公布者留空。
  14949: { type: '理工', note: '学校类别理工类据百度百科/专业库（公办本科，前身河南理工大学鹤壁工程技术学院）。' },
  14956: { type: '医药', note: '学校类别医药类据百度百科；民办高职据2026年招生章程。' },
  14903: { type: '理工', note: '学校类别理工类据百度百科。' },
  14978: { type: '理工', note: '学校类别理工类据百度百科；民办高职据2026年招生章程。' },
  14902: { type: '理工', note: '学校类别理工类据百度百科。' },
  14953: { type: '综合', note: '学校类别综合类据百度百科。' },
  14952: { type: '医药', note: '学校类别医药类据百度百科。' },
  14970: { type: '医药', note: '学校类别医药类据百度百科。' },
  14987: { site: 'https://www.xjklkju.edu.cn/', siteKind: 'official', note: '教育部2026-06-16函同意设置（民办非营利性本科）；学校类别公开渠道未公布，留空；招生网址为学校官网（载2026年招生章程）。' },
  14951: { note: '百度百科学校类别为「高等职业院校」（无学科类别），办学类型留空；招生网址留空。' },
  14977: { note: '学校类别公开渠道未公布（百科/上大学仅记公办专科），办学类型留空；无独立官网，招生网址留空。' },
  14904: { note: '学校类别公开记录冲突（大学志综合类/福建高考理工类），办学类型留空待官方口径。' },
  14905: { note: '学校类别仅大学志记综合类（与同类校百科口径不一致），办学类型留空待官方口径。' },
  19002: { site: 'https://rdzs.ruc.edu.cn/', note: '苏州校区官网实测不可达；招生信息随全校招生网发布，招生网址填全校招生网。' },
  E103350001: { site: 'https://zdzsc.zju.edu.cn', note: '医学院官网实测不可达；本科招生信息随全校招生网发布，招生网址填全校招生网。' },
};

const union = new Map();
const files = ['henan', 'hebei'].map((d) => path.join(REPO, 'db', 'import', 'filled', d, 'universities.csv'));
for (const file of files) {
  for (const r of parseCsv(fs.readFileSync(file, 'utf8')).slice(1)) {
    const code = r[0].trim();
    if (!union.has(code)) union.set(code, { code, name: r[1].trim() });
  }
}

const drafts = [];
const urlCandidates = new Map();
for (const { code, name } of union.values()) {
  const ovr = OVERRIDES[code] ?? {};
  const m = (code.length === 5 ? moeBy5.get(code) : null) ?? moeByName.get(name) ?? (ovr.moeName ? moeByName.get(ovr.moeName) : null);
  const g = gk[code] ?? (ovr.parent ? gk[ovr.parent] : null);
  const w = wideBy5.get(code) ?? wideByName.get(name);

  const province = normProv(m?.province) || (PROVINCES.includes(g?.province_name) ? g.province_name : '') || normProv(w?.province);
  const city = ovr.city || m?.location || g?.city_name || w?.city || '';
  const level = mapLevel(m?.level) || mapLevel(g?.level_name) || mapLevel(w?.level);

  const f985 = m ? m.is985 : g ? g.f985 === '1' : w?.f985;
  const f211 = m ? m.is211 : g ? g.f211 === '1' : w?.f211;
  const dfc = m ? m.isDoubleFirstClass : g ? ['38000', '38001'].includes(String(g.dual_class)) : w?.dfc;
  const ownership = mapOwnership(m?.ownership || g?.nature_name || w?.nature);
  const tags = [f985 && '985', f211 && '211', dfc && '双一流', ownership].filter(Boolean).join('|');

  const type = ovr.type || mapType(w?.category) || mapType(g?.type_name);

  const cands = [];
  if (ovr.site) cands.push({ url: ovr.site, kind: ovr.siteKind || 'site' });
  if (g?.site && !ovr.skipSite) cands.push({ url: g.site.startsWith('http://') ? 'https://' + g.site.slice(7) : g.site, kind: g.site.startsWith('http://') ? 'upgrade' : 'site' });
  if (g?.school_site) cands.push({ url: g.school_site.startsWith('http://') ? 'https://' + g.school_site.slice(7) : g.school_site, kind: g.school_site.startsWith('http://') ? 'upgrade-official' : 'official' });
  if (w?.website) cands.push({ url: w.website.startsWith('http://') ? 'https://' + w.website.slice(7) : w.website, kind: w.website.startsWith('http://') ? 'upgrade-official' : 'official' });
  for (const c of cands) if (c.url.startsWith('https://')) urlCandidates.set(c.url, true);

  const notes = [];
  if (!m && g) notes.push('教育部名单无独立条目，省市/层次/标签据掌上高考。');
  if (ovr.note) notes.push(ovr.note);
  drafts.push({ code, name, province, city, type, level, tags, cands, notes });
}

const verifiedPath = path.join(SOURCES, 'verified.json');
let verified = {};
if (!FORCE_VERIFY && fs.existsSync(verifiedPath)) verified = JSON.parse(fs.readFileSync(verifiedPath, 'utf8'));
// 旧缓存的 false 可能含 WAF 412 误判，重测；true/'412' 保留。
if (!FORCE_VERIFY) for (const [u, v] of Object.entries(verified)) if (v === false) delete verified[u];
console.log(`并集 ${union.size} 所；候选网址 ${urlCandidates.size} 个（缓存 ${Object.keys(verified).length}）`);
// 按校懒实测：命中第一个可达候选即停；每 300 条落盘缓存，中断不丢进度。
let done = 0; let sinceSave = 0;
const saveCache = () => fs.writeFileSync(verifiedPath, JSON.stringify(verified, null, 1));
const curlCheck = (u) => new Promise((resolve) => {
  // Windows 原生 curl 不认 /dev/null，输出设备须用 NUL，否则写输出失败导致误判不可达。
  const devNull = process.platform === 'win32' ? 'NUL' : '/dev/null';
  execFile('curl', ['-s', '-o', devNull, '-m', '8', '-L', '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', '-w', '%{http_code}', u], { timeout: 10000 }, (err, stdout) => {
    const code = parseInt(stdout, 10);
    // 412 为高校站点 WAF 对非浏览器客户端的挑战响应（TLS 校验通过），视为可达并在备注注明。
    resolve({ ok: !err && ((code >= 200 && code < 400) || code === 403 || code === 412), code });
  });
});
async function resolveUrl(u) {
  if (!FORCE_VERIFY && u in verified) return verified[u];
  const { ok, code } = await curlCheck(u);
  verified[u] = ok ? (code === 412 ? '412' : true) : false;
  done += 1; sinceSave += 1;
  if (done % 300 === 0) console.log(`实测 ${done}`);
  if (sinceSave >= 300) { sinceSave = 0; saveCache(); }
  return ok;
}
for (let i = 0; i < drafts.length; i += 80) {
  await Promise.all(drafts.slice(i, i + 80).map(async (d) => {
    for (const c of d.cands) {
      if (!c.url.startsWith('https://')) continue;
      if (await resolveUrl(c.url)) break;
    }
  }));
}
saveCache();
console.log(`实测完成：本次 ${done} 个，缓存 ${Object.keys(verified).length} 个`);

const BASE_NOTE = '基础信息2026-11-20补全：教育部《全国高等学校名单》（截至2026-06-17）、DaoSword《高等教育数据宽表v20230118》、掌上高考院校库；网址https可达性2026-11-20实测。';
const result = new Map();
const gaps = [];
for (const d of drafts) {
  let website = ''; let kind = '';
  for (const c of d.cands) {
    if (c.url.startsWith('https://') && verified[c.url]) { website = c.url; kind = c.kind; break; }
  }
  const notes = [...d.notes];
  if (website && (kind === 'official' || kind === 'upgrade-official')) notes.push('无独立招生网记录，招生网址栏为学校官网。');
  if (website && kind.startsWith('upgrade')) notes.push('源记录为http，按https规范化。');
  if (website && verified[website] === '412') notes.push('招生网址实测返回412（站点WAF反爬挑战响应，TLS证书校验通过）。');
  if (!website && !notes.some((n) => n.includes('招生网址留空'))) notes.push('招生网址暂未取得实测可达来源，留空。');
  const note = [BASE_NOTE, ...notes].join('');
  result.set(d.code, { ...d, website, note });
  if (!d.province || !d.city || !d.type || !d.level || !website) gaps.push(`${d.code} ${d.name} [省${d.province || '-'} 市${d.city || '-'} 类${d.type || '-'} 层${d.level || '-'} 网${website ? '有' : '-'}]`);
}

for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8');
  const bom = raw.startsWith('﻿');
  const grid = parseCsv(raw);
  const header = grid[0];
  const idx = (n) => header.indexOf(n);
  let filled = 0;
  for (const r of grid.slice(1)) {
    const rec = result.get(r[0].trim());
    if (!rec) continue;
    const put = (col, val) => {
      const i = idx(col);
      if (val && (r[i] ?? '').trim() === '') { r[i] = val; filled++; }
    };
    put('所在省份', rec.province);
    put('所在城市', rec.city);
    put('办学类型', rec.type);
    put('办学层次', rec.level);
    put('标签', rec.tags);
    put('招生网址', rec.website);
    const ni = idx('备注');
    // 重跑时重建追加段（保留原有备注头部），使新增来源/412 说明能落盘。
    const old = r[ni] ?? '';
    const at = old.indexOf('基础信息2026-11-20补全');
    const head = (at >= 0 ? old.slice(0, at) : old).trim();
    r[ni] = [head, rec.note].filter(Boolean).join('');
  }
  const out = grid.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  fs.writeFileSync(file, (bom ? '﻿' : '') + out);
  console.log(`${path.basename(path.dirname(file))}: 补空单元格 ${filled} 个`);
}

console.log(`并集 ${union.size} 所；仍有缺项 ${gaps.length} 所：`);
console.log(gaps.join('\n'));