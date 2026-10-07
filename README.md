# stockdb-strategy-dev

> WorkBuddy 技能：在本地 **stockdb** 行情库（`stockdb.exe` 监听 `127.0.0.1:7899`）上开发量化选股策略与策略看板页面。

把 stockdb 的**真实取数协议**（`k1`/`k2` 键表达式算子）、**本地 / 在线接口边界**，以及一套**经实测的筛选与评分口径**固化下来，避免每次从零试错。

## 它能做什么

- **全市场批量取日K**：`代码前缀 × 日期区间`，4 个请求取回整段历史（不写按日循环、不写代码分片、不高并发）
- **股票池过滤**：代码前缀天然纯股票，覆盖主板 / 创业板 / 科创板 / 北交所五段
- **多条件选股、涨停判定**（含各板块与 ST 口径）、洗盘形态量化、综合评分与排序
- **单文件离线 HTML 策略看板**（离线结果集兜底 + 浏览器内实时重算，已验证三种版式：表+抽屉 / 三栏工作台 / 多视图矩阵）
- 交付前 `selftest.js` 多页面一致性自检（10 组、158 项）

## 安装为 WorkBuddy 技能

把本仓库根目录复制到技能目录即可：

```bash
git clone https://github.com/junhao-ye/stockdb-strategy-dev.git
cp -r stockdb-strategy-dev "$HOME/.workbuddy/skills/stockdb-strategy-dev"
```

## 前置

- 本机运行 `stockdb.exe`（监听 `127.0.0.1:7899`）
- Node.js（跑脚本与看板实时重算）

## 使用（在策略项目里）

1. 取数：`node scripts/fetch_all.js`（或 `fetch_all.py`）
2. 筛选：`node scripts/screen.js` → 产出 `result.json` + `result.json.js`
3. 报告：`node scripts/make_report.js`
4. 看板：浏览器打开随项目产出的 `策略看板.html` / `策略工作台.html` / `策略矩阵.html`
5. 自检：`node scripts/selftest.js`（**退出码 0 才算交付**）

## 完整文档

详见仓库内的 **使用说明书.html**（12 章：协议 / 标的池 / 写策略 / 做看板 / 脚本手册 / 排错速查 / 踩坑全记录）。改文档后重跑 `build_manual.py` 即可重建。

## 重要约束

- 涨跌配色 **红涨绿跌**
- 只走**本地**通道（`rd`/`zb`/`bk`/`get_data`）；在线接口有配额，不用于批量
- 过滤正则**不得整段误杀任一板块**（尤其别写 `9[0-9]{5}`）
- 筹码为**成交量加权估算值**，仅用于相对排序，非真实分布

## License

MIT —— 见 [LICENSE](LICENSE)。
