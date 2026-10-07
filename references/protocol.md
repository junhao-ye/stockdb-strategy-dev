# stockdb 7899 协议详解

> **本文件已按 2026-10-06 实测校正**。早期版本把「`t=日k:*:date` 返回 `[]`」误判为
> 「代码位通配不支持」——**这是错的**。真正的语法是 `k1`/`k2` 键表达式算子。
> 详见 §3。

## Contents
- 连接与鉴权
- 命令族（get / vals / keys / len / reload）
- **k1/k2 键表达式算子**（核心）
- 通配与批量的真实边界（含更正）
- 表结构与字段
- 日期、复权与 ST 语义
- 元数据表
- 对照：五条调用通道

## 1. 连接与鉴权

| 项 | 值 |
|---|---|
| 地址 | `http://127.0.0.1:7899`（配置文件 `stockdb.conf`，`server.port` / `server.ip`） |
| 鉴权 | 默认**无**。`stockdb.conf` 里 `#auth:` 被注释掉即免密 |
| 进程 | `stockdb.exe`（双击启动）。开机常驻、监听端口 |
| 传输 | 必须带 `json=1`，否则返回内部二进制（**乱码，勿用**） |
| 底层 | LevelDB（`data/` 约 22GB + `data1/`），`mydb/` 是私有库 |

**关键认知**：这个 7899 是**自研的股票专用 K-V 数据库**，不是 HTTP API 框架。
`cmd` 不是 REST 路由，而是**存储引擎原语**：`get`（取一个 key 的值）/ `vals`（模式匹配取多值）/
`keys`（模式匹配取键名）/ `len` / `reload`。理解这点就能预判哪些语法可行。

**还有一层**：`stockdb.exe` 内含 `123128.xyz` 域名 —— 它对某些「本地没有的表」
（财务、资金流、因子等）会**转发到在线服务**，而在线有配额。见 §8。

## 2. 命令族

```bash
BASE=http://127.0.0.1:7899
E(){ node -e "console.log(encodeURIComponent(process.argv[1]))" "$1"; }

# get  —— 取单个 key 的值
curl "$BASE/?cmd=get&t=$(E '日k:600633:20260625')&json=1"
# → {"date":20260625,"code":"600633","name":"浙数文化", ...}   单个 dict

# vals —— 模式匹配，返回多个「值」
curl "$BASE/?cmd=vals&t=$(E '日k:600633:2026062*')&json=1"
# → [ {...}, {...}, ... ]                                     数组

# keys —— 模式匹配，返回「键名」而不取值（用于枚举日期/代码）
curl "$BASE/?cmd=keys&t=$(E '日k:600633:2026*')&json=1"
# → ["日k:600633:20260105", "日k:600633:20260106", ...]

# get 带通配也返回 [ [key, value], ... ] 的键值对数组（便于对照）
curl "$BASE/?cmd=get&t=$(E '复权:600633:2026*')&json=1"
# → [["复权:600633:20260612",{"div":0.17,...}], ...]
```

| 命令 | 返回 | 用途 |
|---|---|---|
| `get` | 单值 dict；**带通配时**返回 `[[key,val],...]` | 精确取一条 |
| `vals` | 值数组 `[val, ...]` | 批量取值（主力用法） |
| `keys` | 键名数组 `["表:code:date", ...]` | 枚举日历、探测存在性 |
| `len` | 计数 | 探测规模 |
| `reload` | — | 重载数据 |

## 3. k1/k2 键表达式算子 ★（核心，也是最大的更正）

键是两段式 `表:key1:key2`（日k = `代码:日期`）。**不要把通配符塞进冒号链**，
而是用 **`k1` / `k2` 参数 + 算子**分别描述两段。

```bash
T=$(E '日k')

# 全市场某日 —— 一次 7490 条
curl "$BASE/?cmd=vals&t=$T&k1=all:&k2=key:20260930&json=1"

# 某前缀的所有票（6 开头）
curl "$BASE/?cmd=vals&t=$T&k1=qz:6&k2=key:20260930&json=1"

# 单票单日
curl "$BASE/?cmd=vals&t=$T&k1=key:000001&k2=key:20260930&json=1"

# 单票某月
curl "$BASE/?cmd=vals&t=$T&k1=key:000001&k2=qz:202609&json=1"

# 单票日期区间（含两端）
curl "$BASE/?cmd=get&t=$T&k1=key:000001&k2=fwd:20260901,20260905&json=1"

# 单票最新 N 条
curl "$BASE/?cmd=get&t=$T&k1=key:000001&k2=fwd:20260901,N&json=1"
```

**算子全集**（全部实测通过）：

| 算子 | 语义 | 实测 |
|---|---|---|
| `all:` | 该段全匹配 | `k1=all:` → 全市场 7490 只；`k2=all:` → 全部日期 |
| `key:X` | 精确匹配 | `k1=key:000001` → 1 条 |
| `qz:X` | 前缀匹配 | `k1=qz:6` → 2298 只；`k2=qz:202609` → 21 个交易日 |
| `fwd:a,b` | 正向区间（含两端） | `k2=fwd:20260901,20260905` → 4 条 |
| `fwd:a,N` | 从 a 起至最新 | 同 `a<N` |
| `fwz:a,b` | 反向区间 | `k2=fwz:20260905,20260901` |

**旧式冒号链仍可用**（`t=日k:code:date` 等价于两个 `key:`），但它**不支持在其中写通配符**。
这是「代码位通配失效」传闻的唯一来源。

**`all:` vs `"*"` —— 两层语义**（官方文档 §4.3／规则 4 说「`all` 不是查询语法」）：

| 写法 | wire | 结果 |
|---|---|---|
| Python `rd.vals('日k','*',d)` | `k1=all:` | ✅ 7490 条 |
| 裸 HTTP `k1=all:` | — | ✅ 7490 条 |
| 裸 HTTP `k1=*` | — | ✅ 7490 条（等价） |
| Python `rd.vals('日k','all',d)` | `k1=key:all` | ❌ 0 条（当普通键） |

文档警告的是**Python 层传字符串 `"all"`**；wire 层的 `all:`（带冒号）就是 `"*"` 的编码，合法。

**调试利器**：用 Python `rd.<fn>(...).url()` 让 SDK 把等效 HTTP 拼给你看：
```python
rd.vals('日k','*','20260930').url()   # → /?cmd=vals&t=日k&k1=all:&k2=key:20260930
rd.vals('日k','6*','20260930').url()  # → /?cmd=vals&t=日k&k1=qz:6&k2=key:20260930
```

## 4. 通配与批量的真实边界

| 写法 | 结果 | 说明 |
|---|---|---|
| `t=日k&k1=qz:0&k2=fwd:a,b` | ✅ **193,204 条** | **前缀 × 日期区间，批量取数首选**（v3） |
| `t=日k&k1=all:&k2=key:20260930` | ✅ 7490 条 | 全市场单日（v2） |
| `t=日k&k1=qz:6&k2=key:20260930` | ✅ 2298 条 | 代码前缀 |
| `t=日k&k1=key:000001&k2=qz:202609` | ✅ 21 条 | 日期前缀 |
| `t=日k&k1=key:000001&k2=fwd:a,b` | ✅ | 日期区间 |
| `日k:600633:2026062*` | ✅ 多日数组 | 冒号链 + 日期通配（限定单码） |
| `日k:600633` | ✅ 全历史 | 省略日期 |
| `日k` | ✅ 全表 | 省略代码+日期（**极慢，慎用**） |
| `日k:000001,000002:20260625` | ✅ 2 条 | 逗号批量 |
| `日k:(50个代码):20260625` | ✅ 50 条 | 实测上限 |
| `日k:(200个代码):20260625` | ❌ ECONNRESET | 超限。**已无必要**，用前缀 |
| `日k:*:20260625` | ❌ `[]` | **语法错**：应写 `k1=all:`（或 `k1=*`） |
| `日k:6*:20260625` | ❌ `[]` | 同上，应写 `k1=qz:6` |
| `日k:000001,000002:2026*` | ❌ `[]` | 逗号批量 × 日期通配 不兼容（已可绕开） |
| `日K:600633:2026*` | ❌ `[]` | 表名大小写敏感 |

**结论（三代演进，均实测）**：

| 方案 | 请求数 | 耗时 | 记录 | 股票池 |
|---|---|---|---|---|
| 交易日 × 50 代码分片 | 19,500 | 11.0s | 972,846 | 5184 |
| 交易日 × `k1=all:` | 130 | 8.1s | 973,580 | 5186 |
| **前缀 × 日期区间** | **4** | **7.2s** | **713,338** | **5494** |

> ⚠️ **早期版本的错误结论**（已作废）：「不能一次取全市场某日，只能按代码分片 × 按日循环」。
> 这个错判导致 `fetch_all.js` v1 写了二维分片、**19,500 次请求**。v3 只要 **4 次**。

**区间可以很长**：实测 `0*` 前缀单请求取 2020-01-01~2026-09-30 → **2,409,141 条 / 4.7 秒**。

**前缀法天然纯股票**：`0*`+`3*`+`6*`+`920*` = 5494 只，ETF/基金/转债 **零污染**
（基金/债券在 `1*`/`5*` 段，不在前缀内）。

**并发建议**：本机单进程 LevelDB，`CONC=6` 实测稳定。但 v3 只有 4 个请求，**不需要并发**。

### 2.4 返回体字段名：日k 是「具名对象」，不是位置数组 ★

`cmd=vals` 默认返回**对象数组**，字段是全名（实测 `t=日k:300870`）：

```json
[{"code":"300870","date":20200824,"open":75,"high":97.65,"low":66.26,"close":85,
  "volume":13003363,"amount":993162048,"turnover":54.1915,"pct_chg":130.916,
  "float_mv":1455783413.189,"total_mv":6139781604.426,"name":"欧陆通","is_st":false,
  "pe_ttm":53.918313,"pb":15.840099,"amplitude":85.28,"vol_ratio":null}, ...]
```

| 要点 | 说明 |
|---|---|
| 字段是全名 | `date/open/high/low/close/volume/turnover/name/is_st`，**不是** `d/o/h/l/c/v` |
| `date` 是数字 | `20260930`，不是 `"2026-09-30"` → 展示前要格式化 |
| `name` / `is_st` 自带 | **不必另开接口查名称**，最后一条记录里就有 |
| 位置数组只在 `ap=` 投影时才出现 | 见 §6.2；默认不要按数组解 |

**⚠ 高频事故**：页面/脚本里写 `r.c`、`r.d`、`r.v` 取字段 → **全部 `undefined`**，
图表静默变空白或显示 `undefined`，**语法检查不会报错**。

**稳健写法**（兼容数组 / 短键 / 全名三种形态）：

```js
const pickf = (r, ...keys) => { for (const k of keys) if (r[k] != null) return r[k]; return undefined; };
const norm = (r) => Array.isArray(r)
  ? { d: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] }
  : { d: pickf(r,'d','date'),    o: +pickf(r,'o','open'),   h: +pickf(r,'h','high'),
      l: +pickf(r,'l','low'),    c: +pickf(r,'c','close'),  v: +pickf(r,'v','volume') };
```

**交付前必须用无头浏览器截图确认真的画出来了**（`node --check` 查不出这类字段缺失）：

```bash
msedge --headless=new --disable-gpu --window-size=1500,1000 \
  --virtual-time-budget=8000 --screenshot=shot.png "file:///<abs-path>.html"
```

## 5. 表结构与字段

### `日k`（最重要）

键格式 `日k:{code}:{YYYYMMDD}`，值为 dict：

| 字段 | 类型 | 说明 |
|---|---|---|
| `date` | int | `YYYYMMDD` |
| `code` / `name` | str | 代码 / 名称 |
| `open high low close pre_close` | float | 价（`close` 已复权，见 §6） |
| `volume` | int | 成交量（股） |
| `amount` | int | 成交额（元） |
| `turnover` | float | 换手率 % |
| `pct_chg` | float | 涨跌幅 % |
| `amplitude` | float | 振幅 % |
| `is_st` | bool | 是否 ST |
| `vol_ratio` | float | 量比 |
| `total_share` / `float_share` | int | 总股本 / 流通股本 |
| `total_mv` / `float_mv` | float | 总市值 / 流通市值 |
| `pe_ttm` / `pb` | float | 估值 |

共 **21 个字段**。**注意**：`float_mv` 在不同记录里精度不一（有的带小数，有的取整），
做阈值判断时先 `Number()`。
**没有** 筹码分布、股东户数、龙虎榜、资金流字段——这些只能在**在线接口**或外接数据源（见 `a-stock-data` 技能）。

### `分钟k`

键 `分钟k:{code}:{YYYYMMDDhhmmss}`。字段仅 `date code open high low close volume amount`
（**无** turnover / pct_chg / is_st）。全市场某时刻一次可取（实测 7182 只）。
但分钟数据量大，**不要全市场逐分钟拉**——官方说明明确警告「暴力拉取 5 分钟会被永久封禁设备」。

### `复权`

键 `复权:{code}:{YYYYMMDD}`，值 `{div, give, trans, mult, cum}`：
分红 / 送股 / 转增 / 乘数 / 累计因子。用于自行计算复权价（日K 默认已给复权价）。

### 其他

- `股票代码` → `{"0":["000001",...],"3":[...],"6":[...],"9":[...],"1":[...],"5":[...]}`（按首位分组）
- `退市` → 退市代码数组
- 私有表：`rd.set(表名, code, date, value)` 写入 `mydb/`

## 6. 日期、复权与 ST 语义

| 项 | 语义 |
|---|---|
| 日K 日期 | 8 位 `YYYYMMDD`；**最早 2000-01-07 左右**（因股而异） |
| 分钟日期 | 14 位 `YYYYMMDDhhmmss`，如 `20260625145200` |
| 范围语法 | 用算子 `k2=fwd:20260620,20260626`（**推荐**）；旧式 `20260620<20260626` 亦可 |
| `N` 简写 | `fwd:20260620,N` = 从该日到最新 |
| 复权 | `close` 等字段**默认已是前复权**；`fq` 参数仅 Python/JS SDK 层有 |
| ST | `is_st` 布尔。**建议与名称含 `ST` 交叉验证**（历史记录偶有缺失） |

## 7. 元数据表

```bash
# 全市场代码（按首位分组）
curl "$BASE/?cmd=get&t=$(E '股票代码')&json=1"

# 退市代码
curl "$BASE/?cmd=vals&t=$(E '退市*')&json=1"

# 推导交易日历（挑一只上市早、不停牌的票）
curl "$BASE/?cmd=keys&t=$(E '日k')&k1=key:000001&k2=all:&json=1"
# 回退（老式）：cmd=keys&t=日k:000001:*
```

**创建标的池的正确顺序**：
`全部代码 − 退市 − 非股票段（见 SKILL.md §3）= 股票池`。
**不要**直接用 `股票代码` 表的结果——它含 ETF/基金/可转债。
（用 `k1=all:` 取日K 时也可直接用返回自带的 `code`/`name` 过滤，无需先取代码表。）

## 8. 五条调用通道 + 本地/在线边界 ★

> 官方 Python 文档的术语是「**在线接口**」（`set_init()` 配置的那个，与 `init()` 配的本地端点不同）。
> 下面统一用「在线」。

官方提供 5 条通道：

| 通道 | 入口 | 评价 |
|---|---|---|
| **裸 HTTP** | `GET /?cmd=...&json=1` | ✅ **批量选股推荐**。零依赖、无门禁 |
| Python SDK | `pybao/` 后 `from stock_sdk import rd` | ✅ 与裸 HTTP 同数据；用 `.url()` 反查语法 |
| Python 原生 | `from stockdb import rd, init` | 底层；`rd_test.py` 是官方语法字典 |
| MCP | `调用方式/ai_mcp/stockdb_full_mcp.py` | 41 个工具；**多数包的是在线接口** |
| Excel/WPS | `调用方式/excel/wps_js_macro.js` | 宏调用 |
| ~~JS SDK~~ | `gp.js`/`bk.js`/`zb.js`/`tu.js` | ⚠️ 有授权门禁，Node 下抛 `SDK校验失败`；仅适合浏览器 |

### ★ 本地 vs 在线

这是**最容易被误导**的一点。`stock_sdk` 导出 90 个名字，但只有这几个打本地库：

| 通道 | 内容 | 额度 |
|---|---|---|
| **`rd.get/vals/keys/pipe`** | `日k` `分钟k` `复权` `股票代码` `退市` | ✅ **本地、无限量、可离线** |
| **`rd.get_data`** | 真复权 + 周/月K + 多代码 | ✅ 本地 |
| **`zb.get`** | 批量技术指标 | ✅ 本地 |
| **`bk.get`** | 板块映射 | ✅ 本地 |
| `get_price` `get_bars` `get_trade_days` `get_all_securities` | 结构化行情 | ❌ 在线 |
| `alpha` `get_factor_values` `get_factor_kanban_values` `MACD` `KDJ` `RSI` `BOLL` `MA` | 因子 / 指标 | ❌ 在线 |
| `get_money_flow` `get_mtss` `get_billboard_list` `get_locked_shares` `get_index_stocks` | 资金 / 事件 | ❌ 在线 |
| `valuation` `income` `balance` `cash_flow` `indicator` `macro` | 财务 / 宏观 | 在线（`Table` 对象，需 `.query()`） |

**在线接口失配后不返回数据**，两种形态：

```python
'测试期超2000次，正式版将移除次数。批量无限制请求应使用本地stockdb。…'   # 配额提示
{'error': '…'}                                                          # 业务错误字典
```

→ **写策略一律只用本地通道**。若返回值是含「测试期」的字符串、或带 `error` 键的 dict，
说明走了在线，必须改回。`stockdb.exe` 内含 `123128.xyz` 域名，是在线组件的出口。

### Python `QueryResult` 取值对照（实测）

| 方法 | 返回 | 备注 |
|---|---|---|
| **`.do()`** | **`list[dict]`** | ★ 要 dict 就用这个 |
| `.vals()` | `list[list]` | **纯数组、无字段名**，按固定字段序 |
| `.keys()` | `list[list[str]]` | 字段名 |
| `.all()` | — | 无参查询报 `Missing required parameters`，别用 |
| `.url()` | `str` | 反查等效 HTTP，**学语法首选** |

### 已知文档缺陷

- `ai_mcp/README.md` 写 `stock_mcp_server.py`，**实际是 `stockdb_full_mcp.py`**。
- 同 README 称必须先跑 `pybao/安装.py`；实测**设 `PYTHONPATH` 即可**。
- `python/调用.txt` 提到 `http_js.js`，该文件**不存在**。
- `ai_mcp/README.md` 的 41 个工具描述里写「时间范围: 2005至今」，**读起来像本地数据**，
  实际上多数走在线接口（配额受限）。**别据此以为能批量取因子。**

## 9. 本地加工接口（zb / bk / get_data / pipe）★

官方 Python 文档明确这四个也是**本地**能力，不受在线配额限制。

### `rd.get_data` —— 加工后的行情（真复权 / 周月K）

```python
rd.get_data(code, start=None, end=None, frequency='1d', fields=None, fq='qfq')
```
| 参数 | 取值 | 实测 |
|---|---|---|
| `frequency` | `1d/1m/5m/15m/30m/60m/1w/1M` | `1w` → 38 条/年 ✅ |
| `fq` | `'qfq'`(前复权) / `'hfq'`(后复权) / `None`(不复权) | 后复权 close=1608.41 vs 前复权 11.66 ✅ |
| `fields` | `None` → `dict{code:[dict]}`；`'a,b,c'` → **位置矩阵** | ✅ |

**这是唯一正确的复权来源** —— 不要手写复权换算、不要手写周/月K合成（官方规则 9 明确要求）。

### `zb.get` —— 批量技术指标

```python
zb.get(name, codes=None, original=None, start=None, end=None,
       frequency='day', method=1, base=1000.0, fq='qfq', fields=None, n=None, cross=False)
```
两种模式：
- **代码模式**：`zb.get('macd', ['000001'], start='20260601', end='N')` —— 自行取数后计算
- **内存模式**：`zb.get('macd', kdata)` —— **复用已加载行情，不再访问数据库**（推荐）

> ⚠ **默认日期陷阱**：代码模式下不传 `end` 时，默认 `start` 是固定值 `20260302`，
> **只算那一天，不是全历史**。正式策略必须显式传 `start`/`end`。
> ⚠ 传 `original` 时 `start/end/frequency/fq` 失效——指标基于你给的数据。
> ⚠ 不接受 `rd.get_data(fields='a,b')` 的**位置矩阵**（无列名）——要用 `fields=None`。

支持指标：`macd` `kdj` `rsi` `boll` `ma` …（另有 `cross`、`zhishu` 指数、基础 `fields`）

### `bk.get` —— 板块映射（本地）

```python
bk.get('000001')                       # 股票 → 板块列表（含 code/name/category）
bk.get(['000001','600000'])            # 多股 → dict{code: [...]}
bk.get(category=1)                     # 分类 → 板块列表（含 symbols 成分股）
```

### `rd.pipe` —— 批量读 / 批量写

```python
pipe = rd.pipe()
for c in codes: pipe.mget('分钟k', c, '20260625145200')   # 离散精确键批量读
rows = pipe.do()                                           # 或 await pipe
```
写入私有数据必须用 `mset` 批量提交，**不能循环逐条 `rd.set`**。

## 10. 服务端查询参数（num / ap）

`.url()` 反查出的三个参数，都在**服务端**执行：

| 参数 | 来源 | 作用 |
|---|---|---|
| `num=N` | `q[:N]` / `q[-N:]` | 服务端切片，`-N` = 最新 N 条 |
| `ap=get.a,b,c` | `q.get('a,b,c')` | 服务端字段投影 → **位置数组** |
| `k1`/`k2` | 见 §3 | 键表达式算子 |

```python
rows = rd.vals('日k', '000001', '20260901<N')[-20:].get('date,close').do()
# → [[20260910, 11.8], ...]   一次请求，服务端完成切片与投影
```

官方规则 7：**对查询对象先切片、再执行**，不要全量下载后再切。

## 11. 私有存储规范（官方硬要求）

- 因子 / 缓存 / 策略结果 / 私有数据 → 必须写 `rd` 的 `./mydb`
- **严禁**自建 SQLite / MySQL / DuckDB / Parquet 等第二套存储（官方列为「严重错误」）
- 多条写入必须 `rd.pipe().mset()` 批量提交
- `./data~./dataN` 是系统历史数据，`./mydb` 是私有写入空间；**只能通过 `rd` 接口访问**，
  不得绕过 SDK 直接操作底层文件

## 12. 在线接口的错误形态

```python
{'error': '...'}                      # 官方文档规则 12：不一定抛异常，必须检查
'测试期超2000次，…'                    # 配额提示字符串
```

官方原文：「在线接口可能以 `{"error": "..."}` 返回业务错误，**不一定抛异常**」；
「**在线服务会限制批量代码请求**」；「批量历史行情**必须使用本地 `stockdb.exe + rd`**」。

```python
def require_ok(v):
    if isinstance(v, dict) and v.get('error'):
        raise RuntimeError(v['error'])
    if isinstance(v, str) and '测试期' in v:
        raise RuntimeError('走了在线接口，请改用 rd 通道')
    return v
```

在线接口**适用**：最新 Tick、财务/基本面、指数成分/行业/概念/交易日等参考数据。
**不适用**：全市场逐股历史K线、高频轮询、替代本地大批量分钟数据。
