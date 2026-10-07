#!/usr/bin/env node
/**
 * screen.js —— 三条件「主力洗盘 · 拉升前夜」筛选引擎（模板）
 *
 * 这是**可改用的模板**：CFG 与三个条件段是你要动的地方，其余是脚手架。
 * 换策略时改 §CFG 和 §条件段，不要改取数/评分骨架。
 *
 * 用法:  node screen.js            # 读 ./_cache/kline.json（由 fetch_all.js 生成）
 *        CACHE=/path/kline.json node screen.js
 *
 * 输出:  result.json      完整结构化结果
 *        result.json.js   window.STRATEGY_RESULT = {...}   供页面离线加载
 *
 * 口径:  获利筹码 = 成交量加权近似（含时间衰减），必须标注为估算值。见 SKILL.md §4
 */
'use strict';
const fs = require('fs');
const path = require('path');

const CACHE = process.env.CACHE || path.join(__dirname, '_cache', 'kline.json');
const OUT = process.env.OUTDIR || __dirname;

/* ══════════════ CFG：策略参数，按需改 ══════════════ */
const CFG = {
  chipWindow: 90,          // 筹码分布回溯窗口（交易日）
  decay: 0.6,              // 时间衰减强度（0 = 不衰减；>0 防单边上涨恒 100%）
  cond1: { days: 3, maxGain: 7, minChip: 70 },
  cond2: { days: 2, topN: 100, minChip: 70 },
  cond3: { lookback: 90, minLimitUp: 3, minListDays: 30, minChip: 80 },
  limitPct: { main: 9.8, gem: 19.5, bj: 29.5 },
  stLimit: 4.7,            // ST 股涨停阈值
  limitTol: 0.3,           // 涨停判定容差
  minRecords: 60,          // 参与筛选所需最少记录数
  stocksOnly: true,        // 只保留股票（剔除 ETF/LOF/REIT/可转债）
};

if (!fs.existsSync(CACHE)) {
  console.error(`找不到 ${CACHE} —— 请先运行 fetch_all.js`);
  process.exit(2);
}
const rawData = JSON.parse(fs.readFileSync(CACHE, 'utf8'));

/* ══════════════ 标的池过滤（见 SKILL.md §3） ══════════════ */
/**
 * 防御性过滤。若 kline.json 由 fetch_all.js 用前缀法（0*、3*、6*、920*）生成，
 * 池本身已是纯股票，本函数不会剔除任何东西。
 *
 * ⚠ 不要写 `9[0-9]{5}` —— 那会把 920xxx 北交所全部误杀（实测 308 只），
 *   而北交所应保留（SKILL.md §3 白名单含 920）。B 股只有 900xxx。
 */
function isStock(code, name) {
  if (/^(159|16[0-9]|18[0-9]|50[0-9]|51[0-9]|52[0-9]|55[0-9]|56[0-9]|58[0-9]|11[0-9]|12[0-9]|204|900)/.test(code)) return false;
  if (/ETF|LOF|REIT|基金|转债|债/i.test(name || '')) return false;
  return true;
}
const data = {};
for (const [code, rows] of Object.entries(rawData)) {
  const nm = rows.length ? rows[rows.length - 1].n : '';
  if (CFG.stocksOnly && !isStock(code, nm)) continue;
  data[code] = rows;
}
const codes = Object.keys(data);
console.log(`原始 ${Object.keys(rawData).length} 只 → 股票池 ${codes.length} 只（已剔除 ETF/基金/可转债等）`);

// 记录长度诊断：窗口太短会让所有条件静默返回 0，这是最常见的「看起来正常但没结果」
const lens = codes.map((c) => data[c].length).sort((a, b) => a - b);
if (lens.length) {
  const med = lens[Math.floor(lens.length / 2)];
  console.log(`[诊断] 记录数 中位 ${med} / 最小 ${lens[0]} / 最大 ${lens[lens.length - 1]}；`
    + `minRecords=${CFG.minRecords}，条件三需 ${CFG.cond3.lookback} 日、筹码需 ${CFG.chipWindow} 日`);
  if (med < CFG.minRecords) {
    console.warn(`⚠ 中位记录数 ${med} < minRecords ${CFG.minRecords} —— 几乎所有标的会被过滤掉。`
      + `\n  取数窗口太短：请用更大的 DAYS 重跑 fetch_all.js（建议 ≥${CFG.cond3.lookback + 40}）。`);
  }
}

/* ══════════════ 工具 ══════════════ */
const isST = (row) => row.st === true || row.st === 1;

/**
 * 各板块的涨跌幅限制（见 SKILL.md §5.1）。
 *   主板   60x/000-003   10%
 *   创业板 300/301/302   20%   ← 302 是新增段，别漏
 *   科创板 688/689       20%   ← 689 是 CDR
 *   北交所 920           30%
 */
const boardOf = (code) =>
  /^(30|68)/.test(code) ? 'gem' : /^(4|8|92)/.test(code) ? 'bj' : 'main';
const limitUpThresh = (code) => CFG.limitPct[boardOf(code)];

/**
 * 涨停判定。
 *
 * ⚠ ST 的「5% 缩窄」**只发生在主板**：
 *   创业板/科创板 ST 股涨跌幅限制**仍是 20%**，北交所 ST 仍是 30%。
 *   早期版本无条件套用 `isST && pct>=4.7`，会把科创板/创业板 ST 股 5% 的
 *   普通上涨误判为涨停（本机实测这类股有 13+40 只），从而虚增条件三的涨停数。
 */
function isLimitUp(code, row) {
  const base = limitUpThresh(code);
  if (row.pc && row.c) {
    const pct = ((row.c - row.pc) / row.pc) * 100;
    if (pct >= base - CFG.limitTol) return true;
    if (boardOf(code) === 'main' && isST(row) && pct >= CFG.stLimit - CFG.limitTol) return true;
    return false;
  }
  return typeof row.p === 'number' && row.p >= base - CFG.limitTol;
}

/**
 * 获利筹码（成交量加权近似 + 时间衰减）—— 见 SKILL.md §4
 * 衰减不可省：否则单边上涨股恒 100%，失去区分度。
 */
function profitChip(rows, upto = rows.length - 1) {
  const end = upto, price = rows[end].c;
  if (!price) return null;
  const start = Math.max(0, end - CFG.chipWindow + 1);
  const span = end - start + 1;
  let sumV = 0, sumVP = 0, sumVP2 = 0, chipV = 0, maxV = 0, peak = null;
  for (let i = start; i <= end; i++) {
    const r = rows[i];
    const age = end - i;
    const decay = span > 1 ? 1 - (age / span) * CFG.decay : 1;
    const v = (r.v || 0) * decay;
    if (v <= 0) continue;
    const tp = (r.h && r.l && r.c) ? (r.h + r.l + r.c) / 3 : r.c;
    sumV += v; sumVP += v * tp; sumVP2 += v * tp * tp;
    if (tp <= price) chipV += v;
    if (r.v > maxV) { maxV = r.v; peak = +tp.toFixed(2); }
  }
  if (sumV <= 0) return null;
  const avg = sumVP / sumV;
  const variance = Math.max(0, sumVP2 / sumV - avg * avg);
  const conc = avg > 0 ? 1 - Math.sqrt(variance) / avg : 0;
  return { chip: (chipV / sumV) * 100, avg, conc, samples: span, peak };
}

/* ══════════════ 条件一：连续 N 日上涨 ≤ X% + 筹码 ≥ Y ══════════════ */
const res1 = [];
for (const code of codes) {
  const rows = data[code];
  if (rows.length < CFG.minRecords) continue;
  const n = rows.length, lastR = rows[n - 1];
  if (isST(lastR)) continue;
  const k = CFG.cond1.days;
  let ok = true;
  for (let i = n - k; i < n; i++) {
    const r = rows[i], p = rows[i - 1];
    if (!r || !p) { ok = false; break; }
    if (r.c <= p.c) { ok = false; break; }              // 每天必须涨
    if (typeof r.p === 'number' && r.p <= 0) { ok = false; break; }
    if (isLimitUp(code, r)) { ok = false; break; }      // 排除涨停日（否则「≤7%」形同虚设）
  }
  if (!ok) continue;
  const first = rows[n - k], last = rows[n - 1];
  const gain = ((last.c - first.pc) / first.pc) * 100;  // 首日以昨收起算
  if (gain > CFG.cond1.maxGain) continue;
  const pc = profitChip(rows);
  if (!pc || pc.chip < CFG.cond1.minChip) continue;
  res1.push({
    code, name: last.n, date: last.d, close: last.c,
    gain3: +gain.toFixed(2), chip: +pc.chip.toFixed(1), conc: +pc.conc.toFixed(3),
    avgCost: +pc.avg.toFixed(2), to: last.to,
    fmv亿: last.fmv ? +(last.fmv / 1e8).toFixed(1) : null,
  });
}
res1.sort((a, b) => b.chip - a.chip);
console.log(`[条件1] 连续${CFG.cond1.days}日上涨且累计≤${CFG.cond1.maxGain}% + 获利筹码≥${CFG.cond1.minChip}%  →  ${res1.length} 只`);

/* ══════════════ 条件二：N 日换手率和前 M 名 + 筹码 ≥ Y ══════════════ */
const turnoverRank = [];
for (const code of codes) {
  const rows = data[code];
  if (rows.length < CFG.minRecords) continue;
  const n = rows.length, a = rows[n - 1], b = rows[n - 2];
  if (!a || !b || isST(a)) continue;
  const sumTO = (a.to || 0) + (b.to || 0);
  if (sumTO <= 0) continue;
  turnoverRank.push({ code, sumTO, last: a });
}
turnoverRank.sort((x, y) => y.sumTO - x.sumTO);
const res2 = [];
turnoverRank.slice(0, CFG.cond2.topN).forEach((item, idx) => {
  const rows = data[item.code];
  const pc = profitChip(rows);
  if (!pc || pc.chip < CFG.cond2.minChip) return;      // 先排名、后叠筹码，顺序不可反
  res2.push({
    code: item.code, name: item.last.n, date: item.last.d, close: item.last.c,
    turnover2: +item.sumTO.toFixed(2), rank: idx + 1,
    chip: +pc.chip.toFixed(1), conc: +pc.conc.toFixed(3),
    pct: item.last.p, toToday: item.last.to,
  });
});
console.log(`[条件2] ${CFG.cond2.days}日换手率和前${CFG.cond2.topN} + 获利筹码≥${CFG.cond2.minChip}%  →  ${res2.length} 只`);

/* ══════════════ 条件三：区间内 N 次涨停 + 上市>D 天 + 筹码 ≥ Y + 非ST ══════════════ */
const res3 = [];
for (const code of codes) {
  const rows = data[code];
  if (rows.length < CFG.minRecords) continue;
  const n = rows.length, last = rows[n - 1];
  if (isST(last)) continue;
  if (n <= CFG.cond3.minListDays) continue;            // 窗口内交易日数近似上市天数
  let cnt = 0;
  for (let i = Math.max(0, n - CFG.cond3.lookback); i < n; i++) if (isLimitUp(code, rows[i])) cnt++;
  if (cnt < CFG.cond3.minLimitUp) continue;
  const pc = profitChip(rows);
  if (!pc || pc.chip < CFG.cond3.minChip) continue;
  res3.push({
    code, name: last.n, date: last.d, close: last.c,
    limitUps: cnt, listDays: n, chip: +pc.chip.toFixed(1), conc: +pc.conc.toFixed(3),
    avgCost: +pc.avg.toFixed(2), to: last.to,
    fmv亿: last.fmv ? +(last.fmv / 1e8).toFixed(1) : null,
  });
}
res3.sort((a, b) => b.limitUps - a.limitUps || b.chip - a.chip);
console.log(`[条件3] ${CFG.cond3.lookback}日≥${CFG.cond3.minLimitUp}次涨停 + 上市>${CFG.cond3.minListDays}天 + 获利筹码≥${CFG.cond3.minChip}%  →  ${res3.length} 只`);

/* ══════════════ 共振归集 ══════════════ */
const hitMap = new Map();
const tag = (code, t) => {
  if (!hitMap.has(code)) hitMap.set(code, { code, tags: [], name: '', close: 0, date: 0, chip: 0, conc: 0 });
  const o = hitMap.get(code);
  o.tags.push(t);
  return o;
};
for (const r of res1) { const o = tag(r.code, 'C1'); Object.assign(o, { name: r.name, close: r.close, date: r.date, chip: r.chip, conc: r.conc, gain3: r.gain3, fmv亿: r.fmv亿 }); }
for (const r of res2) { const o = tag(r.code, 'C2'); o.name = o.name || r.name; o.close = o.close || r.close; o.date = o.date || r.date; o.chip = Math.max(o.chip, r.chip); o.conc = Math.max(o.conc, r.conc); o.turnover2 = r.turnover2; o.toRank = r.rank; }
for (const r of res3) { const o = tag(r.code, 'C3'); o.name = o.name || r.name; o.close = o.close || r.close; o.date = o.date || r.date; o.chip = Math.max(o.chip, r.chip); o.conc = Math.max(o.conc, r.conc); o.limitUps = r.limitUps; }
for (const o of hitMap.values()) {
  if (o.fmv亿 === undefined) {
    const rows = data[o.code], last = rows && rows[rows.length - 1];
    o.fmv亿 = last && last.fmv ? +(last.fmv / 1e8).toFixed(1) : null;
  }
}

/* ══════════════ 洗盘形态打分（见 SKILL.md §5.2） ══════════════ */
function washoutScore(code) {
  const rows = data[code], n = rows.length;
  if (n < 30) return null;
  const win = rows.slice(n - 20);
  const closes = win.map((r) => r.c);
  const mx = Math.max(...closes), mn = Math.min(...closes);
  const band = (mx - mn) / mn * 100;
  const vols = win.map((r) => r.v);
  const vRecent = vols.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const vBase = vols.reduce((a, b) => a + b, 0) / vols.length;
  const volShrink = vBase > 0 ? vRecent / vBase : 1;
  const ma5 = closes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const ma10 = closes.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const ma20 = closes.reduce((a, b) => a + b, 0) / 20;
  const maSpread = (Math.max(ma5, ma10, ma20) - Math.min(ma5, ma10, ma20)) / ma20 * 100;
  const win90 = rows.slice(Math.max(0, n - 90));
  const hi90 = Math.max(...win90.map((r) => r.h || r.c));
  const lo90 = Math.min(...win90.map((r) => r.l || r.c));
  const pos = hi90 > lo90 ? (closes[closes.length - 1] - lo90) / (hi90 - lo90) * 100 : 50;
  const vLast = vols[vols.length - 1];
  const vPrev5 = vols.slice(-6, -1).reduce((a, b) => a + b, 0) / 5;
  const vRise = vPrev5 > 0 ? vLast / vPrev5 : 1;

  const parts = {
    amp: Math.round(band < 25 ? 22 * (1 - band / 25) : 0),
    shrink: Math.round(volShrink < 1 ? 22 * Math.min(1, (1 - volShrink) / 0.45) : 0),
    ma: Math.round(maSpread < 5 ? 26 * (1 - maSpread / 5) : 0),
    pos: Math.round(pos >= 25 && pos <= 75 ? 18 * (1 - Math.abs(pos - 50) / 25) : Math.max(0, 8 * (1 - pos / 100))),
    vrise: Math.round(vRise > 1.05 ? 12 * Math.min(1, (vRise - 1.05) / 0.6) : 0),
  };
  const s = parts.amp + parts.shrink + parts.ma + parts.pos + parts.vrise;
  return { s: Math.round(s), parts, band: +band.toFixed(1), volShrink: +volShrink.toFixed(2), maSpread: +maSpread.toFixed(2), pos: +pos.toFixed(0), vRise: +vRise.toFixed(2) };
}

/* ══════════════ 综合评分（见 SKILL.md §5.3） ══════════════ */
const combined = [];
for (const o of hitMap.values()) {
  const w = washoutScore(o.code);
  const washS = w ? w.s : 0;
  const act = Math.min(100, ((o.turnover2 || 0) / 60) * 100);
  const concS = Math.max(0, Math.min(100, (((o.conc || 0) - 0.80) / 0.20) * 100));
  const chipS = Math.max(0, Math.min(100, o.chip));
  const score = washS * 0.50 + concS * 0.25 + chipS * 0.15 + act * 0.10;
  combined.push({
    ...o, wash: w, washScore: washS, concScore: Math.round(concS), actScore: Math.round(act),
    resonScore: o.tags.length >= 3 ? 100 : o.tags.length === 2 ? 72 : 34,
    score: +score.toFixed(1),
  });
}
// 主键 = 共振数（核心意图），次键 = 综合分
combined.sort((a, b) => b.tags.length - a.tags.length || b.score - a.score);
const byReson = { 3: [], 2: [], 1: [] };
for (const o of combined) (byReson[o.tags.length] || byReson[1]).push(o);

/* ══════════════ 输出 ══════════════ */
const result = {
  meta: {
    generatedAt: new Date().toISOString(),
    dataSource: `stockdb 本地库 (${process.env.BASE || '127.0.0.1:7899'}) · 原生 HTTP 协议`,
    tradeDate: codes.length ? data[codes[0]][data[codes[0]].length - 1].d : null,
    universe: codes.length,
    chipMethod: `成交量加权近似（TP=(H+L+C)/3 按成交量加权 + 时间衰减 ${CFG.decay}，窗口 ${CFG.chipWindow} 日）`,
    note: '本地数据无真实筹码分布，获利筹码为估算值，仅用于相对排序，不宜作为绝对判据。',
  },
  conditions: {
    cond1: { key: 'C1', desc: `连续${CFG.cond1.days}日上涨，累计涨幅≤${CFG.cond1.maxGain}%，获利筹码≥${CFG.cond1.minChip}%`, hits: res1 },
    cond2: { key: 'C2', desc: `${CFG.cond2.days}日换手率之和前${CFG.cond2.topN}名，获利筹码≥${CFG.cond2.minChip}%`, hits: res2 },
    cond3: { key: 'C3', desc: `${CFG.cond3.lookback}交易日内≥${CFG.cond3.minLimitUp}次涨停，上市>${CFG.cond3.minListDays}天，获利筹码≥${CFG.cond3.minChip}%，排除ST`, hits: res3 },
  },
  groups: { triple: byReson[3], double: byReson[2], single: byReson[1] },
  combined,
};
fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 2));
fs.writeFileSync(path.join(OUT, 'result.json.js'), 'window.STRATEGY_RESULT=' + JSON.stringify(result) + ';');

console.log(`\n[共振] 命中≥1 条: ${combined.length} 只, 其中 ≥2 条: ${combined.filter((x) => x.tags.length >= 2).length} 只`);
console.log(`分层: 三条件 ${byReson[3].length} / 双条件 ${byReson[2].length} / 单条件 ${byReson[1].length}`);
if (byReson[3].length === 0) console.log('提示: 三条件零共振属正常 —— 高换手与温和连涨天然互斥（见 SKILL.md §5.3）');
console.log(`\nTOP15:\n` + combined.slice(0, 15).map((r) =>
  `  ${r.code} ${String(r.name).padEnd(7)} 收${String(r.close).padEnd(8)} [${r.tags.join('+')}] 分${String(r.score).padEnd(5)} 洗盘${String(r.washScore).padEnd(3)} 筹码${r.chip}%`
).join('\n'));
console.log(`\n→ ${path.join(OUT, 'result.json')}`);
