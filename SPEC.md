# stockdb-strategy-dev Specification

## Intent

在 stockdb 本地行情库（`stockdb.exe` 监听 `127.0.0.1:7899`）之上开发量化选股策略与策略看板页面。  
把这个数据库的**真实取数协议**（`k1`/`k2` 键表达式算子）、**本地与在线接口的边界**、  
以及一套**经实测的筛选与评分口径**  
固化下来，避免每次从零试错。

非目标：替代通用行情数据源技能；本技能针对的是**本地 stockdb**这一特定数据资产。

## Scope

In scope:

- stockdb 7899 取数协议：`k1`/`k2` 键表达式算子（`all:`/`key:`/`qz:`/`fwd:`/`fwz:`）+ `json=1`
- 全市场批量取数：**代码前缀 × 日期区间，4 请求取回整段历史**（官方 Python 文档 §13.2 写法）
- 通道边界：本地 `rd`/`zb`/`bk`/`get_data` vs **在线接口**（配额受限）
- 标的池过滤（股票段前缀天然纯股票；兜底正则）
- 获利筹码的成交量加权近似
- 多条件选股的实现族、涨停判定（含各板块与 ST 口径）、洗盘形态量化、综合评分与排序
- 策略看板页面（离线结果集 + 浏览器内实时重算）
- 可改用的取数 / 筛选 / 报告 / 自检脚本（Node 与 Python 双版）

Out of scope:

- 真实筹码分布（需外接数据源，见 `a-stock-data`）
- 分钟级高频策略（官方警告暴力拉取会被封设备）
- 部署 stockdb 本身（那是解压 + 双击运行）
- 交易执行 / 下单

## Users And Trigger Context

- Primary users: 在本机持有 stockdb 数据、要写选股策略与看板的使用者
- Common user requests:
  - 「用本地股票数据库写个选股」
  - 「主力洗盘/拉升/连板/换手率/筹码 筛选」
  - 「全市场批量取日K」
  - 「做个策略结果页面/看板」
  - 「stockdb / 7899 / gp.js 怎么调」
- Should not trigger for: 纯行情问答（不取数）、其他数据源（腾讯/东财/通达信）、  
  通用投资观点讨论、只读某只票的实时报价

## Runtime Contract

- Required first actions:
  1. 确认 `stockdb.exe` 在运行（一次 `cmd=get` 探测）
  2. 跑 `fetch_all.js` 或 `fetch_all.py` 取数（**不要**手写取数循环）
  3. 确认股票池覆盖五个板块段（前缀法天然保证；用兜底正则时尤其要查）
- Required outputs:
  - 筛选结果（`result.json` + 报告或等价呈现）
  - 若交付页面：单文件 HTML + `result.json.js`，7899 离线也能开
  - 筹码口径**必须标注为估算值**
- Non-negotiable constraints:
  - 涨跌配色 **红涨绿跌**
  - 排序主键 = 条件共振数
  - 零共振时**解释**而非放宽条件
  - 取数用「代码前缀 × 日期区间」；**不写按日循环、不写代码分片、不高并发**
  - 只走**本地**通道（`rd`/`zb`/`bk`/`get_data`）；**在线**接口有配额，不用于批量
  - 过滤正则**不得整段误杀任一板块**（尤其别写 `9[0-9]{5}`）
  - ST 的 5% 涨跌幅缩窄**只适用于主板**（创/科 ST 仍是 20%）
  - 交付前 `selftest.js` 退出码为 0
- Expected bundled files loaded at runtime:
  - `scripts/fetch_all.js` / `scripts/fetch_all.py`、`scripts/screen.js`、  
    `scripts/make_report.js`、`scripts/selftest.js`、`scripts/build_dashboard.template.html`
  - 按需：`references/protocol.md`, `references/screening-cookbook.md`,  
    `references/dashboard-recipe.md`, `references/worked-example.md`

## Source And Evidence Model

Authoritative sources:

- stockdb 官方文档：`调用方式/ai_自动开发文档/AI策略界面开发纯js接口文档.md`、  
  `调用方式/python/AI策略python开发接口文档.md`
- 官方参考实现：`调用方式/http/rd_test.py`（协议字典）、`调用方式/http/http_api.py`、  
  `调用方式/python/sdk_test.py`、`调用方式/ai_自动开发文档/示范.html` + `viewer.js`
- 官方说明：`先看！这个！！使用说明.txt`、`调用方式/调用说明.txt`、`调用方式/ai_mcp/README.md`

Useful improvement sources:

- positive examples: 本技能 `references/worked-example.md` 中 2026-09-30 的实测输出
- negative examples: `worked-example.md` 的坑 1/2/3 反例（ETF 霸榜 / 筹码恒 100% / 银行股排第一）
- commit logs/changelogs: 无（非 git 项目）
- issue or PR feedback: 无
- validation results: `selftest.js` 多页面一致性自检（10 组、158 项口径）

Data that must not be stored:

- 任何 API Key / 授权凭据
- stockdb 的授权/许可信息
- 用户的实际持仓与资金数据

## Reference Architecture

- `SKILL.md` **是路由器，不是百科全书**（v2.2.0 起）：三条铁律、路由表、取数速查  
  （算子/通道边界/SDK/私有存储）、标的池、筹码近似、评分模型（含「非泛用」警告）、  
  页面要点、流水线、交付清单、报错速查、环境与权威参照。  
  **协议细节、评测口径、页面配方一律指向 `references/`。**
- `references/` contains:
  - `protocol.md` — 协议与表结构全解、算子全集、边界表、本地加工接口、服务端参数（查 API 细节时读）
  - `screening-cookbook.md` — 条件写法族、涨停口径、参数调优（写条件时读）
  - `dashboard-recipe.md` — 页面配方（改页面时读）
  - `worked-example.md` — 完整实例 + 三类坑的修正（要参照时读）
- `references/evidence/` contains: 暂空（尚未积累迭代样例）
- `scripts/` contains: 5 个可执行脚本（4 JS + 1 Python）+ 1 个页面模板 + `README.md` 契约说明
- `SOURCES.md` contains: 来源清单（S1–S18）、决策记录（含 superseded/corrected 条目）、  
  覆盖矩阵、检索终止理由 —— **溯源与「为什么这么定」都在这里，不占运行时文件**
- `assets/` contains: 无

## Validation

- Lightweight validation: `uv run scripts/quick_validate.py <skill-dir>`（skill-writer 提供）
- Deeper validation: `node scripts/selftest.js`（页面与引擎口径一致性，**10 组、覆盖多页面、158 项**）
- Cross-implementation check: `fetch_all.js` 与 `fetch_all.py` 产出应**逐条一致**
- Holdout examples: 暂无持久化 holdout
- Acceptance gates:
  1. 结构校验无错、无缺失引用
  2. `selftest.js` 退出码 0
  3. 结果中不含 ETF/基金代码
  4. **五个板块段均在池中**（第 9 组）——防「整段误杀」回归
  5. 筹码口径在报告与页面都有估算标注

## Known Limitations

- 筹码为**近似估算**，无法识别同价位多次换手，会高估长期横盘股
- 送转除权未单独处理（依赖日K已给的前复权价）
- 上市天数为「窗口内记录数」近似，非真实上市日期
- **§5.2/§5.3 的维度与权重只为「洗盘拉升」标定**，不是泛用评分模型；  
  换策略类型必须重标（趋势策略的均线方向要求与「粘合」相反）
- 新股上市前 5 日不限价，未单独处理（靠 `minListDays` 规避）
- 实测结论基于单机单版本 stockdb（数据至 2026-09-30）；  
  上游若改动协议，行为需重新实测
- 分钟级数据未纳入脚本（官方警告高频拉取会封设备）
- **在线接口**（财务/因子/资金流）本技能只记录边界，未纳入脚本——配额受限

## Maintenance Notes

- When to update `SKILL.md`: 协议边界变化、新增典型坑、评分口径调整、脚本契约变化
- When to update `SOURCES.md`: 新增来源、协议重新实测、数据范围变化
- When to update `references/evidence/`: 积累到新的正/反例时（尤其用户反馈的误判案例）
- **保持 `SKILL.md` 是路由器**：新增大段知识时先进 `references/`，`SKILL.md` 只留  
  「什么情况下读哪个文件」+ 必须当场知道的决策点
- 上游 stockdb 版本更新后，**优先重新实测取数协议与通道边界**——它们最容易变化、  
  也最影响取数正确性
- **权威源**：`调用方式/python/AI策略python开发接口文档.md`（1672 行）。  
  与实测冲突时以实测为准，但要把差异记进 `SOURCES.md`
