#!/usr/bin/env node
/**
 * make_report.js —— 由 result.json 生成 Markdown 筛选结果报告
 *
 * 用法:  node make_report.js
 *        OUTDIR=/path node make_report.js
 * 输入:  result.json（由 screen.js 生成）
 * 输出:  筛选结果报告.md
 */
'use strict';
const fs = require('fs');
const path = require('path');
const DIR = process.env.OUTDIR || __dirname;
const R = JSON.parse(fs.readFileSync(path.join(DIR, 'result.json'), 'utf8'));

const L = [];
const p = (s = '') => L.push(s);
const f = (n, d = 2) => (n == null || n === '' ? '—' : Number(n).toFixed(d));
const ds = (d) => (d && String(d).length === 8)
  ? `${String(d).slice(0, 4)}-${String(d).slice(4, 6)}-${String(d).slice(6, 8)}` : String(d || '—');

p('# 主力洗盘后即将拉升 · 策略筛选结果');
p();
p(`> **数据交易日**：${ds(R.meta.tradeDate)}　|　**股票池**：${R.meta.universe} 只（已剔除 ETF/LOF/REIT/可转债与退市股）`);
p(`> **数据源**：${R.meta.dataSource}`);
p(`> **筹码口径**：${R.meta.chipMethod}`);
p('> ');
p('> ⚠️ ' + R.meta.note);
p();

p('## 一、执行摘要');
p();
p('| 指标 | 数值 |');
p('|---|---|');
p(`| 条件一命中 | **${R.conditions.cond1.hits.length}** 只 |`);
p(`| 条件二命中 | **${R.conditions.cond2.hits.length}** 只 |`);
p(`| 条件三命中 | **${R.conditions.cond3.hits.length}** 只 |`);
p(`| 三条件共振 | **${R.groups.triple.length}** 只 |`);
p(`| 双条件共振 | **${R.groups.double.length}** 只 |`);
p(`| 单条件命中 | **${R.groups.single.length}** 只 |`);
p(`| 去重后合计 | **${R.combined.length}** 只 |`);
p();
p('**核心结论**：三条条件刻画「主力洗盘」的不同侧面——条件一看短期温和连涨，条件二看筹码活跃度，');
p('条件三看中期涨停基因。零交集属正常：高换手往往伴随剧烈波动，与「温和连涨」天然互斥。');
if (R.groups.double.length) p(`实战重点观察**双条件共振**的 ${R.groups.double.length} 只——它们同时具备两种洗盘特征。`);
p();

p('## 二、双条件共振标的（重点观察）');
p();
p('| # | 代码 | 名称 | 收盘 | 共振 | 综合分 | 洗盘形态 | 获利筹码* | 3日累涨 | 2日换手 | 90日涨停 | 流通市值 |');
p('|---|---|---|---|---|---|---|---|---|---|---|---|');
R.groups.double.forEach((r, i) => {
  p(`| ${i + 1} | ${r.code} | ${r.name} | ${f(r.close)} | ${r.tags.join('+')} | **${r.score}** | ${r.washScore} | ${f(r.chip, 1)}% | `
    + `${r.gain3 != null ? (r.gain3 >= 0 ? '+' : '') + f(r.gain3) + '%' : '—'} | `
    + `${r.turnover2 != null ? f(r.turnover2) + '%' : '—'} | `
    + `${r.limitUps != null ? r.limitUps + ' 次' : '—'} | `
    + `${r.fmv亿 != null ? r.fmv亿 + ' 亿' : '—'} |`);
});
p();
p('\\* 获利筹码为**成交量加权近似估算值**，用于相对排序，非真实筹码分布。');
p();

p('## 三、分条件明细');
p();
const blocks = [
  ['cond1', '条件一：连续 3 日上涨 · 累计涨幅 ≤ 7% · 获利筹码 ≥ 70%',
    ['#', '代码', '名称', '收盘', '3日累涨', '获利筹码*', '筹码集中度', '加权成本', '换手率', '流通市值'],
    (r, i) => [i + 1, r.code, r.name, f(r.close), '+' + f(r.gain3) + '%', f(r.chip, 1) + '%', f(r.conc, 3), f(r.avgCost), f(r.to) + '%', r.fmv亿 != null ? r.fmv亿 + ' 亿' : '—']],
  ['cond2', '条件二：2 日换手率之和全市场前 100 · 获利筹码 ≥ 70%',
    ['换手排名', '代码', '名称', '收盘', '2日换手', '获利筹码*', '筹码集中度', '当日涨幅'],
    (r) => ['#' + r.rank, r.code, r.name, f(r.close), f(r.turnover2) + '%', f(r.chip, 1) + '%', f(r.conc, 3), r.pct != null ? (r.pct >= 0 ? '+' : '') + f(r.pct) + '%' : '—']],
  ['cond3', '条件三：90 交易日内 ≥ 3 次涨停 · 上市 > 30 天 · 获利筹码 ≥ 80% · 排除 ST',
    ['#', '代码', '名称', '收盘', '90日涨停', '获利筹码*', '筹码集中度', '加权成本', '换手率', '流通市值'],
    (r, i) => [i + 1, r.code, r.name, f(r.close), `**${r.limitUps} 次**`, f(r.chip, 1) + '%', f(r.conc, 3), f(r.avgCost), f(r.to) + '%', r.fmv亿 != null ? r.fmv亿 + ' 亿' : '—']],
];
for (const [key, title, head, row] of blocks) {
  const hits = R.conditions[key].hits;
  p(`### ${title}`);
  p();
  p(`命中 **${hits.length}** 只。`);
  p();
  p('| ' + head.join(' | ') + ' |');
  p('|' + head.map(() => '---').join('|') + '|');
  hits.slice(0, 40).forEach((r, i) => p('| ' + row(r, i).join(' | ') + ' |'));
  if (hits.length > 40) p(`\n> 其余 ${hits.length - 40} 只见 result.json`);
  p();
}

p('## 四、方法与口径');
p();
p('### 4.1 取数协议（stockdb 7899 原生 HTTP）');
p();
p('```');
p('GET http://127.0.0.1:7899/?cmd=get&t=日k:600633:20260625&json=1          # 单条');
p('GET http://127.0.0.1:7899/?cmd=vals&t=日k:600633:2026062*&json=1         # 同代码多日');
p('GET http://127.0.0.1:7899/?cmd=vals&t=日k:000001,000002:20260625&json=1 # 逗号批量(≤50)');
p('GET http://127.0.0.1:7899/?cmd=keys&t=日k:600633:2026*&json=1           # 键名');
p('```');
p();
p('**三个坑**：代码位通配失效；逗号批量与日期通配不兼容；批量上限 ≈50 个代码。');
p('**解法**：按「交易日 × 代码分片(50)」并行，全市场约 11 秒完成。');
p();
p('### 4.2 获利筹码近似算法');
p();
p('```');
p('典型价  TP_i = (High_i + Low_i + Close_i) / 3');
p('时间衰减 w_i = 1 - (日龄_i / 窗口) × 0.6');
p('权重    V_i  = Volume_i × w_i');
p('获利筹码 = Σ{V_i | TP_i ≤ 现价} / Σ V_i × 100%');
p('加权成本 = Σ(V_i × TP_i) / Σ V_i');
p('集中度   = 1 - 加权标准差 / 加权成本');
p('窗口     = 90 个交易日');
p('```');
p();
p('**局限**：无法识别同价位多次换手 → 高估长期横盘股；未单独处理送转除权。仅用于同时点横向排序。');
p();
p('### 4.3 综合评分模型');
p();
p('```');
p('排序主键 = 条件共振数（3 > 2 > 1）      # 策略核心意图');
p('次排序键 = 洗盘形态×50% + 筹码集中度×25% + 获利筹码×15% + 换手活跃度×10%');
p('洗盘形态 = 振幅收敛22 + 缩量程度22 + 均线粘合26 + 位置适中18 + 量能抬头12');
p('```');
p();

p('## 五、交付物与使用');
p();
p('| 文件 | 说明 |');
p('|---|---|');
p('| `策略看板.html` | 策略看板（单文件，离线结果集 + 实时重算） |');
p('| `result.json` / `result.json.js` | 结构化结果 / 页面离线加载用 |');
p('| `fetch_all.js` | 全市场日K批量取数器 |');
p('| `screen.js` | 筛选引擎（可独立运行重算） |');
p('| `make_report.js` | 本报告生成器 |');
p('| `selftest.js` | 页面与引擎一致性自检 |');
p('| `_cache/kline.json` | 日K缓存 |');
p();
p('**重新生成**：');
p('```bash');
p('node fetch_all.js   # 取数');
p('node screen.js      # 筛选');
p('node make_report.js # 报告');
p('```');
p();
p('---');
p();
p(`*报告生成时间：${new Date(R.meta.generatedAt).toLocaleString('zh-CN')}*`);
p();
p('> **风险提示**：本策略为技术形态与筹码结构的量化筛选，不构成投资建议。');
p('> 获利筹码为近似估算值，实盘决策请结合基本面、资金面、消息面综合判断，并严格执行风控。');

fs.writeFileSync(path.join(DIR, '筛选结果报告.md'), L.join('\n'));
console.log(`✓ 已生成 筛选结果报告.md (${(L.join('\n').length / 1024).toFixed(1)}KB, ${L.length} 行)`);
