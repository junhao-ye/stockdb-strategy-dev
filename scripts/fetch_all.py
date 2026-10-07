#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
fetch_all.py —— 全市场日K批量取数器（Python SDK 版，v3）

走 stock_sdk 的 rd 通道（本地 LevelDB，无限量、可离线）。
用「代码前缀 × 日期区间」组合，**4 个请求取回全市场整段历史**
（官方 Python 接口文档 §13.2 的推荐流水线写法）。

⚠ 通道边界（见 SKILL.md §2.2）：
  • rd / zb / bk / get_data = 本地，无限量、可离线   → 本脚本用这些
  • get_price / alpha / get_factor_values / 财务三表 = **在线接口**，有配额，
    超额不返回数据（文档称「在线服务会限制批量代码请求」）

前置（二选一）：
  A) 设 PYBAO 或 PYTHONPATH 指向 pybao 目录（推荐，不改环境）
  B) 跑一次 pybao/安装.py（写入 .pth）

用法:
  python fetch_all.py
  DAYS=250 PREFIXES="0*,3*,6*,920*" OUT=./_cache python fetch_all.py
  PYBAO=D:/baidunetdiskdownload/stockdb/pybao python fetch_all.py

输出: <OUT>/kline.json  +  <OUT>/_calendar.json
"""
import os
import re
import sys
import json
import time

PYBAO = os.environ.get('PYBAO')
if PYBAO and PYBAO not in sys.path:
    sys.path.insert(0, PYBAO)

try:
    from stock_sdk import rd
except ImportError:
    sys.stderr.write(
        "\n无法导入 stock_sdk。请二选一：\n"
        "  A) 设 PYBAO 指向 pybao 目录：\n"
        "       PYBAO=D:/baidunetdiskdownload/stockdb/pybao python fetch_all.py\n"
        "  B) 跑一次 stockdb/pybao/安装.py\n\n"
    )
    sys.exit(2)

OUT_DIR = os.path.abspath(os.environ.get('OUT', os.path.join(os.path.dirname(__file__), '_cache')))
TRADE_DAYS = int(os.environ.get('DAYS', 130))
CAL_CODE = os.environ.get('CAL_CODE', '000001')
PREFIXES = [s.strip() for s in os.environ.get('PREFIXES', '0*,3*,6*,920*').split(',') if s.strip()]
os.makedirs(OUT_DIR, exist_ok=True)


def unwrap(qr):
    """QueryResult → list[dict]。

    实测要点（SKILL.md §2.3）：
      • .do()   → list[dict]   ← 正确取法
      • .vals() → list[list]   ← **无字段名的数组**，按字段序排列
      • .keys() → 字段名；.all() 是后处理操作，与键通配无关，通常不用
    """
    if qr is None:
        return []
    if isinstance(qr, list):
        return qr
    try:
        r = qr.do()
        if isinstance(r, list):
            if r and isinstance(r[0], (list, tuple)) and len(r[0]) == 2 and isinstance(r[0][1], dict):
                return [x[1] for x in r]          # rd.get 通配 → [[key, dict], ...]
            return r
    except Exception:
        pass
    try:
        vals = qr.vals()
        if callable(vals):
            vals = vals()
        keys = qr.keys()
        if callable(keys):
            keys = keys()
        if isinstance(keys, list) and keys and isinstance(keys[0], list):
            keys = keys[0]
        if isinstance(vals, list) and isinstance(keys, list) and keys and vals and isinstance(vals[0], list):
            if len(keys) == len(vals[0]):
                return [dict(zip(keys, row)) for row in vals if isinstance(row, list)]
        return vals if isinstance(vals, list) else []
    except Exception:
        try:
            return list(qr)
        except Exception:
            return []


def is_stock(code, name):
    """防御性过滤。走前缀法时本就无需（前缀已保证纯股票），仅作兜底。

    ⚠ 不要写 `9[0-9]{5}`：会把 920xxx 北交所全部误杀（实测 308 只），
      而北交所应当保留。B 股只有 900xxx。
    """
    if re.match(r'^(159|16[0-9]|18[0-9]|50[0-9]|51[0-9]|52[0-9]|55[0-9]|56[0-9]|58[0-9]|11[0-9]|12[0-9]|204|900)', code):
        return False
    if re.search(r'ETF|LOF|REIT|基金|转债|债', name or '', re.I):
        return False
    return True


def main():
    t0 = time.time()

    # 1) 交易日历
    cal = []
    for pat in ('*', '20*'):
        try:
            kres = unwrap(rd.keys('日k', CAL_CODE, pat))
            cand = sorted({str(k).split(':')[-1] for k in kres
                           if str(k).split(':')[-1].isdigit() and len(str(k).split(':')[-1]) == 8})
            if cand:
                cal = cand
                break
        except Exception:
            continue
    if not cal:
        sys.stderr.write(f'无法读取交易日历（{CAL_CODE}）—— 请确认 stockdb.exe 在跑\n')
        sys.exit(3)

    days = cal[-TRADE_DAYS:]
    frm, to = days[0], days[-1]
    print(f'[历] 共 {len(cal)} 天, 取近 {len(days)} 天: {frm} ~ {to}')
    with open(os.path.join(OUT_DIR, '_calendar.json'), 'w', encoding='utf-8') as f:
        json.dump(days, f)

    # 2) 前缀 × 区间
    print(f'[任务] {len(PREFIXES)} 个前缀 × 1 次区间请求 = {len(PREFIXES)} 请求（区间 {frm}<{to}）')
    store = {}
    errs = 0
    rows_total = 0
    for p in PREFIXES:
        tp = time.time()
        try:
            rows = unwrap(rd.vals('日k', p, f'{frm}<{to}'))
        except Exception as e:
            errs += 1
            print(f'  {p:<8} ✘ {type(e).__name__}: {str(e)[:70]}')
            continue
        for r in rows:
            if not isinstance(r, dict):
                continue
            c = r.get('code')
            if not c:
                continue
            store.setdefault(str(c), []).append(r)
            rows_total += 1
        print(f'  {p:<8} {len(rows):>7} 条  {time.time()-tp:.2f}s')

    # 3) 退市 + 精简
    delisted = set(str(x) for x in unwrap(rd.vals('退市*')))
    out = {}
    dropped = 0
    for code, lst in store.items():
        if len(lst) < 5 or code in delisted:
            dropped += 1
            continue
        lst.sort(key=lambda r: r.get('date', 0))
        if not is_stock(code, lst[-1].get('name', '')):
            dropped += 1
            continue
        out[code] = [{
            'd': r.get('date'), 'c': r.get('close'), 'pc': r.get('pre_close'),
            'o': r.get('open'), 'h': r.get('high'), 'l': r.get('low'),
            'v': r.get('volume'), 'a': r.get('amount'), 'to': r.get('turnover'),
            'p': r.get('pct_chg'), 'am': r.get('amplitude'), 'st': r.get('is_st'),
            'fsh': r.get('float_share'), 'fmv': r.get('float_mv'), 'n': r.get('name'),
        } for r in lst]

    bj = sum(1 for c in out if c.startswith('920'))
    pth = os.path.join(OUT_DIR, 'kline.json')
    with open(pth, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False)
    print(f'[完] 抓到 {len(store)} 只 → 保留 {len(out)} 只（含北交所 {bj} 只；剔除 {dropped}）'
          f' / 记录 {rows_total} 条 / 错 {errs} / 耗时 {time.time()-t0:.1f}s')
    print(f'     → {pth}')

    if not out:
        sys.stderr.write('⚠ 股票池为空 —— 检查 7899 是否就绪\n')
        sys.exit(1)


if __name__ == '__main__':
    main()
