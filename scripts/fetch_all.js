#!/usr/bin/env node
/**
 * fetch_all.js —— 全市场日K批量取数器（v3，前缀 × 日期区间）
 *
 * ⚡ v3 关键变化：用「代码前缀 × 日期区间」组合，**4 个请求取回全市场整段历史**。
 *    这是官方 Python 文档 §13.2 的推荐流水线写法。
 *
 *    例：0 开头全部、20260325~20260930 整段
 *      /?cmd=vals&t=日k&k1=qz:0&k2=fwd:20260325,20260930     → 193129 条
 *
 * 演进（都是实测）：
 *    v1 交易日 × 50 代码分片   → 19,500 请求 / 11.0s
 *    v2 交易日 × k1=all:      →    130 请求 /  8.1s
 *    v3 前缀 × 日期区间        →      4 请求 /  4.4s   ← 现在
 *
 * 前缀法还有个额外好处：`0*`、`3*`、`6*`、`920*` **本身就是纯股票池**，
 * 天然排除 ETF/基金/可转债（那些在 1*、5* 段），无需正则过滤。
 *
 * 用法:
 *   node fetch_all.js                 # 默认近 130 交易日
 *   DAYS=250 node fetch_all.js
 *   PREFIXES=0*,3*,6*,920* node fetch_all.js
 *   OUT=./_cache node fetch_all.js
 *
 * 输出: <OUT>/kline.json          { code: [{d,c,pc,o,h,l,v,a,to,p,am,st,fsh,fmv,n}, ...] }
 *       <OUT>/_calendar.json      [交易日字符串, ...]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const BASE = process.env.BASE || 'http://127.0.0.1:7899';
const OUT_DIR = path.resolve(process.env.OUT || path.join(__dirname, '_cache'));
const TRADE_DAYS = Number(process.env.DAYS || 130);
const CAL_CODE = process.env.CAL_CODE || '000001';
// 股票段前缀。1*/5* 是基金/债券，不在其中（见 SKILL.md §3）
const PREFIXES = (process.env.PREFIXES || '0*,3*,6*,920*').split(',').map((s) => s.trim()).filter(Boolean);

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
const enc = encodeURIComponent;

function get(url, timeout = 180000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const txt = Buffer.concat(chunks).toString('utf8');
        try { resolve(JSON.parse(txt)); } catch (e) { resolve(null); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function retryGet(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { return await get(url); }
    catch (e) { if (i === tries - 1) throw e; await new Promise((r) => setTimeout(r, 300 * (i + 1))); }
  }
  return null;
}

/** k1/k2 算子（见 SKILL.md §2.1） */
const op = {
  all: () => 'all:',
  key: (v) => 'key:' + v,
  // qz: 本身即「前缀」语义，尾部的 * 要剥掉（'0*' → qz:0）
  qz: (v) => 'qz:' + String(v).replace(/\*+$/, ''),
  fwd: (a, b) => `fwd:${a},${b}`,
};
/** 前缀 × 日期区间 —— 一次取该前缀全部票的整段历史 */
const urlPrefixRange = (prefix, from, to) =>
  `${BASE}/?cmd=vals&t=${enc('日k')}&k1=${op.qz(prefix)}&k2=${op.fwd(from, to)}&json=1`;
/** 交易日历 */
const urlCalendar = (code) =>
  `${BASE}/?cmd=keys&t=${enc('日k')}&k1=${op.key(code)}&k2=${op.all()}&json=1`;

/**
 * 防御性过滤。正常走前缀法时**不需要**它（前缀已保证纯股票），
 * 仅作为兜底，防止数据源变化或误用其他前缀。
 *
 * ⚠ 不要写 `9[0-9]{5}`：那会把 **920xxx 北交所** 全部误杀（实测 308 只），
 *   而北交所是应当保留的（SKILL.md §3）。B 股只有 `900xxx`。
 */
function isStock(code, name) {
  if (/^(159|16[0-9]|18[0-9]|50[0-9]|51[0-9]|52[0-9]|55[0-9]|56[0-9]|58[0-9]|11[0-9]|12[0-9]|204|900)/.test(code)) return false;
  if (/ETF|LOF|REIT|基金|转债|债/i.test(name || '')) return false;
  return true;
}

async function main() {
  const t0 = Date.now();

  // 1) 交易日历
  let keys = await retryGet(urlCalendar(CAL_CODE));
  if (!Array.isArray(keys) || !keys.length) {
    keys = await retryGet(`${BASE}/?cmd=keys&t=${enc('日k:' + CAL_CODE + ':*')}&json=1`);
  }
  if (!Array.isArray(keys) || !keys.length) {
    console.error(`无法读取交易日历 —— 请确认 stockdb.exe 正在运行（${BASE}）`);
    process.exit(3);
  }
  const calendar = keys.map((k) => String(k).split(':').pop()).filter((d) => /^\d{8}$/.test(d)).sort();
  const days = calendar.slice(-TRADE_DAYS);
  const from = days[0], to = days[days.length - 1];
  console.log(`[历] 共 ${calendar.length} 天, 取近 ${days.length} 天: ${from} ~ ${to}`);
  fs.writeFileSync(path.join(OUT_DIR, '_calendar.json'), JSON.stringify(days));

  // 2) 前缀 × 区间，逐个前缀一次请求
  console.log(`[任务] ${PREFIXES.length} 个前缀 × 1 次区间请求 = ${PREFIXES.length} 请求（区间 ${from}<${to}）`);
  const store = new Map();
  let rows = 0, errs = 0;
  for (const p of PREFIXES) {
    const tp = Date.now();
    let arr = null;
    try {
      arr = await retryGet(urlPrefixRange(p, from, to));
    } catch (e) { errs++; }
    if (!Array.isArray(arr)) { errs++; console.log(`  ${p.padEnd(8)} ✘ 无数据`); continue; }
    for (const r of arr) {
      if (!r || !r.code) continue;
      let a = store.get(r.code);
      if (!a) { a = []; store.set(r.code, a); }
      a.push(r); rows++;
    }
    console.log(`  ${p.padEnd(8)} ${String(arr.length).padStart(7)} 条  ${((Date.now() - tp) / 1000).toFixed(2)}s`);
  }

  // 3) 退市 + 精简字段
  const delisted = new Set((await retryGet(`${BASE}/?cmd=vals&t=${enc('退市*')}&json=1`)) || []);
  const out = {};
  let dropped = 0, droppedBj = 0;
  for (const [code, list] of store) {
    if (list.length < 5 || delisted.has(code)) { dropped++; continue; }
    list.sort((a, b) => a.date - b.date);
    const nm = list[list.length - 1].name || '';
    if (!isStock(code, nm)) { dropped++; if (/^920/.test(code)) droppedBj++; continue; }
    out[code] = list.map((r) => ({
      d: r.date, c: r.close, pc: r.pre_close, o: r.open, h: r.high, l: r.low,
      v: r.volume, a: r.amount, to: r.turnover, p: r.pct_chg,
      am: r.amplitude, st: r.is_st, fsh: r.float_share, fmv: r.float_mv, n: r.name,
    }));
  }
  const kept = Object.keys(out).length;
  const bj = Object.keys(out).filter((c) => /^920/.test(c)).length;
  const file = path.join(OUT_DIR, 'kline.json');
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(`[完] 抓到 ${store.size} 只 → 保留 ${kept} 只（含北交所 ${bj} 只；剔除 ${dropped}）`
    + ` / 记录 ${rows} 条 / 错 ${errs} / 耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`     → ${file}`);

  if (kept === 0) { console.error('⚠ 股票池为空 —— 检查 7899 是否就绪'); process.exit(1); }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
