#!/usr/bin/env node
/**
 * selftest.js —— 页面 / 引擎 / 结果集 一致性自检（不依赖浏览器）
 *
 * 用法: node selftest.js                 # 校验目录内**全部**看板页面
 *       node selftest.js 策略工作台.html   # 只校验指定页面
 * 退出码: 0 全通过 / 1 有失败 / 2 找不到页面
 *
 * 设计无关：表格式（#tb + 遮罩抽屉）与工作台式（#list + 常驻详情）都能过。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const args = process.argv.slice(2);

/** 找出目录内所有引用 STRATEGY_RESULT 的页面 */
function discover() {
  return fs.readdirSync(DIR).filter((f) => f.endsWith('.html')).filter((f) => {
    try { return /STRATEGY_RESULT/.test(fs.readFileSync(path.join(DIR, f), 'utf8')); }
    catch (e) { return false; }
  });
}

let targets;
if (args[0]) {
  const p = path.isAbsolute(args[0]) ? args[0] : path.join(DIR, args[0]);
  if (!fs.existsSync(p)) { console.error('找不到 ' + p); process.exit(2); }
  targets = [{ name: path.basename(p), file: p }];
} else {
  const names = discover();
  if (!names.length) { console.error('找不到任何看板页面（需含 STRATEGY_RESULT）'); process.exit(2); }
  targets = names.map((n) => ({ name: n, file: path.join(DIR, n) }));
}

const RES = JSON.parse(fs.readFileSync(path.join(DIR, 'result.json'), 'utf8'));
const EN = fs.readFileSync(path.join(DIR, 'screen.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✗ ' + m); } };
const group = (t) => console.log('\n[' + t + ']');

/* ══════════════════ 每个页面跑一遍 [1]~[3] ══════════════════ */
for (const T of targets) {
const H = fs.readFileSync(T.file, 'utf8');
if (targets.length > 1) console.log(`\n╔══ ${T.name} ══╗`);
const tag = (m) => targets.length > 1 ? `[${T.name}] ${m}` : m;

/* ── [1] DOM 契约 ──
 * 三种设计都要能过（版式无关）：
 *   表格式（行点击开遮罩抽屉）     → #th/#tb + #draw/#mask
 *   工作台式（列表 + 常驻详情面板）→ #list + #main
 *   矩阵式（多视图 + 底部浮层）    → #matrix/#mBody + #sheet
 * 共同必备：结果集、重算入口、漏斗消费。
 */
group('1 DOM 契约');
// 结果浏览区（三选一）
ok(/id=["'](tb|list|matrix)["']/.test(H), '缺少结果浏览容器（#tb / #list / #matrix）');
// 详情区（三选一）
ok(/id=["'](draw|main|sheet)["']/.test(H), '缺少详情容器（#draw / #main / #sheet）');
// 若带表格，则必须有表头容器
if (/id=["']tb["']/.test(H)) ok(/id=["']th["']/.test(H), '有 #tb 但缺 #th（表头）');
if (/id=["']matrix["']/.test(H)) ok(/id=["']mBody["']/.test(H), '有 #matrix 但缺 #mBody（表体）');
// 逐页的必备件（用「三选一 / 存在其一」表达，避免把版式差异当缺陷）
ok(/id=["'](funnel|cnt|c1)["']/.test(H), '缺少计数/漏斗容器（#funnel / #cnt / #c1）');
ok(H.includes('STRATEGY_RESULT'), '未引用 STRATEGY_RESULT');
ok(/runScreen|recalc|重算/.test(H), '缺少实时重算入口');
ok(/meta\.funnel|\[.?funnel.?\]|funnel/.test(H), '未消费 meta.funnel（漏斗）');

/* ── [2] 资源引用 ── */
group('2 资源引用');
ok(H.includes('./result.json.js'), '未加载 result.json.js（离线兜底）');
ok(fs.existsSync(path.join(DIR, 'result.json.js')), 'result.json.js 不存在');
ok(!/echarts|chart\.js|cdn\./i.test(H), '引入了外部图表库（应为无依赖 SVG）');
ok(/vector-effect/.test(H), 'SVG 缺 vector-effect（线宽会异常拉伸）');
ok(/<svg/.test(H), '未使用手绘 SVG');

/* ── [3] 协议用法（只对**带实时重算**的页面强制；纯离线页跳过）── */
group('3 协议用法');
{
  const hasLive = /qz:/.test(H);                 // 用了前缀法才算"带实时重算"
  if (hasLive) {
    ok(/json=1/.test(H), '未使用 &json=1');
    ok(/测试期超2000次/.test(H), '未检测在线接口配额提示（字符串形态）');
    ok(/\.error\b/.test(H), '未检测 {error:...} 返回（字典形态不抛异常）');
    ok(/['"]0['"]\s*,\s*['"]3['"]/.test(H) || /qz:'\s*\+\s*p/.test(H),
      '实时重算未用 0/3/6 前缀遍历（应循环 qz:<prefix>）');
    ok(!/k1=all:/.test(H.replace(/cmd=keys[^`'"]*/g, '')), '实时重算误用 k1=all:（应前缀分片）');
    ok(!/CHUNK/.test(H), '疑似按代码分片并发（应前缀法）');
  } else {
    console.log('  (跳过：本页为纯离线结果集浏览，无实时重算)');
  }
}

/* ── [4] 口径一致性：页面 CFG vs 引擎 CFG（逐页比对；缺项跳过不报错）── */
group('4 口径一致性');
{
  // ⚠ 取值要拿**权重定义**那一行，不能撞上 `p.wShrink || 0` 这类默认值兜底：
  //   故用「键: 0.4」且要求值在 (0,1] 区间 —— 权重必为正小数，默认兜底是 0。
  const pick = (src, key) => {
    const re = new RegExp('\\b' + key + '\\s*:\\s*(0?\\.\\d+|[1-9]\\d*(?:\\.\\d+)?)\\b', 'g');
    let m;
    while ((m = re.exec(src))) {
      const v = Number(m[1]);
      if (v > 0) return v;                       // 忽略 `: 0` 这类默认兜底
    }
    return null;
  };
  for (const k of ['volLowWin', 'maLong', 'discountMin', 'maMid', 'maMidRatioMax',
                   'minListDays', 'maxProfitChip', 'maxMaSpread', 'chipWindow', 'decay',
                   'pullbackWin', 'stopLossPct', 'minRecords', 'maxConcPct',
                   'wShrink', 'wBox', 'wChip', 'boxWin',
                   'shrinkPerfectQ', 'shrinkZeroQ', 'chipPerfectQ', 'chipZeroQ']) {
    const a = pick(EN, k), b = pick(H, k);
    if (a === null) continue;                     // 引擎没有这项 → 不适用
    if (b === null) continue;                     // 页面没复刻这项（如矩阵页不做实时重算）→ 跳过
    ok(Math.abs(a - b) < 1e-9, tag(`CFG.${k} 不一致：引擎=${a} 页面=${b}`));
  }
  const a = EN.match(/minFmv\s*:\s*([0-9.eE+]+)/);
  const b = H.match(/minFmv\s*:\s*([0-9.eE+]+)/);
  if (a && b) ok(Math.abs(Number(a[1]) - Number(b[1])) < 1, tag(`CFG.minFmv 不一致：${a[1]} vs ${b[1]}`));
}
}  // ← 逐页循环结束；以下 [5]~[10] 只依赖 result.json，跑一次

/* ── [5] 结果集字段 ── */
group('5 结果集字段');
const NEED = ['code', 'name', 'board', 'close', 'ma120', 'ma60', 'dev120', 'dev60',
  'volRatio20', 'to', 'chip', 'conc', 'maSpread', 'fmv亿', 'listDays',
  'boxHigh', 'boxLow', 'boxPos',                                   // 箱体三维之一
  'pullbackLow', 'stopPrice', 'stopDist', 'score', 'scoreParts', 'reasons'];
ok(Array.isArray(RES.hits) && RES.hits.length > 0, 'hits 为空');
for (const k of NEED)
  ok(RES.hits.every((h) => k in h), `结果缺少字段 ${k}`);
ok(RES.meta && RES.meta.tradePlan, 'meta.tradePlan 缺失');
ok(RES.meta && RES.meta.thresholds, 'meta.thresholds 缺失');
ok(RES.meta && RES.meta.scoring, 'meta.scoring 缺失（评分口径未落盘）');
ok(RES.meta && Array.isArray(RES.meta.funnel), 'meta.funnel 缺失');
// 箱位必须是 0~1 的合法位置
ok(RES.hits.every((h) => h.boxPos >= 0 && h.boxPos <= 1), 'boxPos 越界（应在 0~1）');

/* ── [6] 排序单调性（主键 = 离 MA120 越远越前） ── */
group('6 排序单调性');
{
  let bad = 0;
  for (let i = 1; i < RES.hits.length; i++)
    if (RES.hits[i].dev120 < RES.hits[i - 1].dev120) bad++;
  ok(bad === 0, `离 MA120 距离排序被破坏 ${bad} 处`);
}

/* ── [7] 条件口径回归（10 项硬性不变量 × 全部命中） ── */
group('7 条件口径回归');
{
  const bad = {};
  const flag = (k) => { bad[k] = (bad[k] || 0) + 1; };
  for (const h of RES.hits) {
    if (!(h.dev120 <= -10)) flag('低于MA120不足10%');
    if (!(h.close <= h.ma60 * 1.1)) flag('现价超MA60的1.1倍');
    if (!(h.close < h.ma60)) flag('已站上MA60未被剔');
    if (!(h.fmv亿 > 20)) flag('市值≤20亿');
    if (!(h.listDays > 90)) flag('上市≤90天');
    if (!(h.maSpread >= 5)) flag('均线黏合未被剔');
    if (!(h.chip <= 70)) flag('获利盘>70%未被剔');
    if (!(h.stopPrice < h.close)) flag('止损价≥现价');
    if (!/^(300|301|302|600|601|603|605|000|001|002|003)/.test(h.code)) flag('板块越界');
    if (/ST/i.test(h.name || '')) flag('混入ST');
  }
  const keys = Object.keys(bad);
  ok(keys.length === 0, `不变量违反: ${keys.map((k) => `${k}×${bad[k]}`).join(', ')}`);
}

/* ── [8] 标的池纯度（防整段误杀） ── */
group('8 标的池纯度');
{
  const pf = RES.meta.funnel;
  ok(pf && pf.length >= 7, `漏斗级数不足：${pf && pf.length}`);
  if (pf) {
    for (let i = 1; i < pf.length; i++)
      ok(pf[i].n <= pf[i - 1].n, `漏斗非单调：${pf[i - 1].label}(${pf[i - 1].n}) → ${pf[i].label}(${pf[i].n})`);
    ok(pf[0].n > 4000, `策略池过小(${pf[0].n})，可能是板块正则误杀`);
  }
  // 板块构成
  const bd = {};
  for (const h of RES.hits) bd[h.board] = (bd[h.board] || 0) + 1;
  ok(Object.keys(bd).length >= 2, `命中板块仅 ${Object.keys(bd).join('/')}，覆盖不足`);
  ok(!RES.hits.some((h) => /^(688|689|920)/.test(h.code)), '混入科创板/北交所（本策略应排除）');
}

/* ── [9] 板块覆盖（防误杀回归 · 读缓存核对池构成） ── */
group('9 板块覆盖（防误杀回归）');
{
  const cp = path.join(DIR, '_cache', 'kline.json');
  if (!fs.existsSync(cp)) { console.log('  (跳过：无 _cache/kline.json)'); }
  else {
    const k = JSON.parse(fs.readFileSync(cp, 'utf8'));
    const cnt = { 深主板: 0, 创业板: 0, 沪主板: 0, 科创板: 0, 北交所: 0 };
    for (const c of Object.keys(k)) {
      if (/^(000|001|002|003)/.test(c)) cnt.深主板++;
      else if (/^(300|301|302)/.test(c)) cnt.创业板++;
      else if (/^(600|601|603|605)/.test(c)) cnt.沪主板++;
      else if (/^(688|689)/.test(c)) cnt.科创板++;
      else if (/^920/.test(c)) cnt.北交所++;
    }
    console.log('  缓存池构成: ' + Object.entries(cnt).map(([a, b]) => `${a} ${b}`).join(' / '));
    for (const [b, n] of Object.entries(cnt)) ok(n > 0, `${b} 在缓存池中为 0（疑被过滤规则整段误杀）`);
    ok(cnt.科创板 > 500, `科创板仅 ${cnt.科创板} 只，疑被误杀（预期 ~607）`);
    ok(cnt.北交所 > 250, `北交所仅 ${cnt.北交所} 只，疑被 9[0-9]{5} 类黑名单误杀（预期 ~308）`);
  }
}

/* ── [10] 评分分解自洽（读 result.json 的 meta.scoring，不写死公式） ── */
group('10 评分分解自洽');
{
  // ⚠ 不要在这里写死权重 —— 换策略族时权重会变。改为读 meta.scoring.weights。
  const w = (RES.meta && RES.meta.scoring && RES.meta.scoring.weights) || null;
  ok(!!w, 'meta.scoring.weights 缺失（无法校验评分分解）');
  if (w) {
    let bad = 0, mismatch = [];
    const map = { shrink: 'wShrink', box: 'wBox', chip: 'wChip' };
    for (const h of RES.hits) {
      const p = h.scoreParts;
      if (!p) { bad++; continue; }
      let re = 0;
      for (const [f, wk] of Object.entries(map)) {
        if (p[wk] != null) re += p[wk];                    // 加权贡献直加
        else if (p[f] != null && w[f] != null) re += p[f] * w[f];
      }
      if (Math.abs(re - h.score) > 1.05) { bad++; if (mismatch.length < 3) mismatch.push(`${h.code} 重算${re.toFixed(1)} vs 存${h.score}`); }
      for (const k of Object.keys(map)) {
        const v = p[k];
        if (v != null && !(v >= 0 && v <= 100)) bad++;
      }
    }
    ok(bad === 0, `评分分解与总分不自洽 ${bad} 处 ${mismatch.join('; ')}`);
    // 权重和应为 1
    const sw = Object.values(w).reduce((a, b) => a + b, 0);
    ok(Math.abs(sw - 1) < 1e-6, `评分权重和不等于 1（${sw}）`);
  }
}

console.log(`\n${'─'.repeat(52)}`);
console.log(`selftest: ${pass} passed / ${fail} failed   （${targets.length} 个页面：${targets.map(t=>t.name).join('、')}）`);
process.exit(fail === 0 ? 0 : 1);
