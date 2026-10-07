#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
build_manual.py —— 把 使用说明书.md 渲染成单文件离线 HTML 手册。

特性（都在客户端、零外部依赖）：
  · 左侧自动生成的目录 + 滚动高亮（scroll-spy）
  · 顶部搜索：过滤目录 + 只显示命中的章节 + 正文高亮
  · Ctrl/Cmd+K 聚焦搜索、Esc 清空、↑↓ 跳章节、g 回顶
  · 深色主题（跟随宿主 IDE 主题）
  · 打印友好
用法: python build_manual.py [输入.md] [输出.html]
"""
import html
import os
import re
import sys

import markdown

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "使用说明书.md")
DST = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, "使用说明书.html")

with open(SRC, "r", encoding="utf-8") as fh:
    text = fh.read()

md = markdown.Markdown(
    extensions=["tables", "fenced_code", "toc", "attr_list", "sane_lists", "md_in_html"],
    extension_configs={"toc": {"title": "目录", "toc_depth": "2-3", "permalink": False}},
)
body = md.convert(text)
toc_html = md.toc
# 侧栏自带「目录」标题 —— 去掉 toc 扩展生成的 toctitle，避免出现两次
toc_html = re.sub(r'<span class="toctitle">.*?</span>\s*', "", toc_html, flags=re.S)

# 侧栏已有目录 —— 去掉正文里手写的「## 目录」整段（含其后到 --- 的内容）
body = re.sub(r'<h2 id="[^"]*">目录</h2>[\s\S]*?(?=<hr\s*/?>)', "", body, count=1)

# 章节锚点清单（供客户端跳转用）
ids = re.findall(r'<h2 id="([^"]+)"', body)
n_h2 = len(ids)
n_h3 = len(re.findall(r'<h3 id="', body))
n_tables = body.count("<table>")
n_code = body.count("<pre>")
n_chars = len(re.sub(r"<[^>]+>", "", body))

STYLE = """
:root{
  --bg:#0d1117; --panel:#161b22; --panel2:#1c2128; --line:#30363d; --line2:#21262d;
  --tx:#e6edf3; --dim:#8b949e; --dim2:#6e7681;
  --acc:#58a6ff; --ok:#3fb950; --warn:#d29922; --danger:#f85149; --vio:#a371f7;
  --code-bg:#0b0f14;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:64px}
body{
  margin:0;background:var(--bg);color:var(--tx);
  font:15px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased;
}
code,pre,.mono{font-family:Consolas,"SF Mono",Menlo,"Cascadia Code",monospace}

/* ───────── 顶栏 ───────── */
#top{
  position:fixed;inset:0 0 auto 0;height:54px;z-index:50;
  display:flex;align-items:center;gap:14px;padding:0 18px;
  background:rgba(13,17,23,.92);backdrop-filter:blur(10px);
  border-bottom:1px solid var(--line);
}
#brand{font-size:14.5px;font-weight:700;white-space:nowrap;letter-spacing:.3px}
#brand em{font-style:normal;color:var(--acc)}
#stats{font-size:11.5px;color:var(--dim2);white-space:nowrap;display:flex;gap:12px}
#stats b{color:var(--dim);font-weight:600}
#sp{flex:1}
#searchWrap{position:relative;display:flex;align-items:center}
#q{
  width:250px;background:var(--panel);border:1px solid var(--line);color:var(--tx);
  border-radius:7px;padding:7px 30px 7px 30px;font-size:12.5px;font-family:inherit;outline:none;
  transition:border-color .13s,width .13s;
}
#q:focus{border-color:var(--acc);width:310px}
#searchWrap .ic{position:absolute;left:9px;color:var(--dim2);font-size:12px;pointer-events:none}
#clr{
  position:absolute;right:6px;background:none;border:none;color:var(--dim2);
  cursor:pointer;font-size:14px;line-height:1;padding:3px 4px;display:none
}
#clr:hover{color:var(--tx)}
#hits{font-size:11px;color:var(--dim2);white-space:nowrap;min-width:66px;text-align:right}
kbd{
  background:var(--panel2);border:1px solid var(--line);border-bottom-width:2px;
  border-radius:4px;padding:1px 5px;font-size:10px;font-family:Consolas,monospace;color:var(--dim)
}

/* ───────── 布局 ───────── */
#wrap{display:flex;padding-top:54px;min-height:100vh}
#side{
  width:288px;flex:0 0 288px;position:sticky;top:54px;height:calc(100vh - 54px);
  overflow-y:auto;border-right:1px solid var(--line);background:#0f141a;padding:16px 0 40px
}
#side .ttl{
  font-size:10.5px;color:var(--dim2);letter-spacing:1.2px;text-transform:uppercase;
  padding:0 18px 9px;font-weight:700
}
#toc ul{list-style:none;margin:0;padding:0}
#toc li{margin:0}
#toc a{
  display:block;color:var(--dim);text-decoration:none;font-size:12.5px;
  padding:4px 18px 4px 18px;border-left:2px solid transparent;line-height:1.45;
  transition:color .1s,border-color .1s,background .1s
}
#toc a:hover{color:var(--tx);background:#161c24}
#toc a.on{color:var(--acc);border-left-color:var(--acc);background:#121a24;font-weight:600}
#toc>ul>li>a{font-weight:600;color:var(--tx);opacity:.92;font-size:13px;margin-top:3px}
#toc ul ul a{padding-left:33px;font-size:12px;color:var(--dim2)}
#toc ul ul a:hover{color:var(--dim)}
#toc a.hide{display:none}
#side .foot{font-size:10.5px;color:var(--dim2);padding:16px 18px 0;border-top:1px solid var(--line2);margin-top:12px;line-height:1.6}

#main{flex:1;min-width:0;display:flex;justify-content:center;padding:26px 34px 120px}
#doc{max-width:880px;width:100%}

/* ───────── 正文 ───────── */
#doc h1{
  font-size:26px;margin:4px 0 6px;line-height:1.3;font-weight:800;letter-spacing:-.2px
}
#doc h2{
  font-size:20px;font-weight:700;margin:44px 0 14px;padding:0 0 9px;
  border-bottom:1px solid var(--line);scroll-margin-top:66px
}
#doc h2:first-of-type{margin-top:26px}
#doc h3{font-size:16px;font-weight:700;margin:28px 0 10px;color:#d7e3ee;scroll-margin-top:66px}
#doc h4{font-size:14px;font-weight:700;margin:20px 0 8px;color:var(--dim);scroll-margin-top:66px}
#doc p{margin:10px 0}
#doc strong{color:#fff;font-weight:650}
#doc em{color:var(--dim);font-style:normal;background:#1a212b;border-radius:3px;padding:0 4px}
#doc a{color:var(--acc);text-decoration:none;border-bottom:1px solid rgba(88,166,255,.3)}
#doc a:hover{border-bottom-color:var(--acc)}
#doc hr{border:none;border-top:1px solid var(--line);margin:34px 0}
#doc ul,#doc ol{padding-left:23px;margin:10px 0}
#doc li{margin:5px 0}
#doc li>ul,#doc li>ol{margin:5px 0}

/* 引用块 —— 用作「提示条」，按 emoji 前缀着色 */
#doc blockquote{
  margin:14px 0;padding:11px 15px;border-radius:8px;
  border-left:3px solid var(--acc);background:#121a24;color:#c9d6e2
}
#doc blockquote p{margin:5px 0}
#doc blockquote p:first-child{margin-top:0}
#doc blockquote p:last-child{margin-bottom:0}
#doc blockquote strong{color:#fff}
/* 危险 / 警告 类引用块（含 ❗ ⚠）改红色调 */
#doc blockquote.danger{border-left-color:var(--danger);background:#1d1315}
#doc blockquote.warn{border-left-color:var(--warn);background:#1d1a12}
#doc blockquote.ok{border-left-color:var(--ok);background:#0f1a13}

/* 表格 */
#doc table{
  border-collapse:separate;border-spacing:0;width:100%;margin:14px 0;
  font-size:13px;border:1px solid var(--line);border-radius:8px;overflow:hidden
}
#doc thead th{
  background:#1a212b;color:var(--dim);font-weight:700;text-align:left;
  padding:9px 12px;border-bottom:1px solid var(--line);font-size:12px;
  white-space:nowrap;position:relative
}
#doc tbody td{padding:8px 12px;border-bottom:1px solid var(--line2);vertical-align:top}
#doc tbody tr:last-child td{border-bottom:none}
#doc tbody tr:nth-child(even) td{background:#11161d}
#doc tbody tr:hover td{background:#161d27}
#doc td code,#doc th code{font-size:12px}
#doc table code{white-space:nowrap}

/* 代码 */
#doc code{
  background:#1a212b;color:#ffa657;font-size:12.5px;padding:1.5px 5px;border-radius:4px
}
#doc pre{
  background:var(--code-bg);border:1px solid var(--line);border-radius:8px;
  padding:13px 15px;overflow-x:auto;margin:13px 0;line-height:1.6
}
#doc pre code{
  background:none;color:#c9d6e2;padding:0;font-size:12.5px;white-space:pre
}
/* 代码里的注释行淡显 */
#doc pre code .cmt{color:var(--dim2)}

/* 复选框清单 */
#doc input[type=checkbox]{
  appearance:none;-webkit-appearance:none;width:14px;height:14px;margin:0 7px 0 0;
  border:1.5px solid var(--line);border-radius:4px;background:var(--panel);
  vertical-align:-2px;cursor:pointer;position:relative;transition:all .12s
}
#doc input[type=checkbox]:hover{border-color:var(--acc)}
#doc input[type=checkbox]:checked{background:var(--ok);border-color:var(--ok)}
#doc input[type=checkbox]:checked::after{
  content:"✓";position:absolute;inset:0;color:#0d1117;font-size:11px;
  display:flex;align-items:center;justify-content:center;font-weight:800
}
#doc li:has(> input[type=checkbox]){list-style:none;margin-left:-19px}

/* 搜索命中 */
#doc mark.hit{background:#7a5c00;color:#ffe9a8;border-radius:3px;padding:0 2px}
#doc .sec-off{display:none}

/* 回到顶部 */
#totop{
  position:fixed;right:24px;bottom:24px;width:38px;height:38px;border-radius:50%;
  background:var(--panel2);border:1px solid var(--line);color:var(--dim);
  cursor:pointer;font-size:15px;display:none;z-index:40;line-height:1
}
#totop:hover{color:var(--tx);border-color:var(--acc)}
#totop.on{display:block}

/* 窄屏 */
@media (max-width:1080px){
  #side{display:none}
  #main{padding:20px 18px 100px}
  #stats{display:none}
  #q{width:170px}#q:focus{width:220px}
}

/* 滚动条 */
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:#2b3340;border-radius:6px;border:2px solid var(--bg)}
::-webkit-scrollbar-thumb:hover{background:#3c4655}

@media print{
  #top,#side,#totop{display:none!important}
  #wrap{padding:0}#main{padding:0}
  body{background:#fff;color:#000}
  #doc pre,#doc table{border-color:#ccc}
  #doc pre code{color:#000}
}
"""

SCRIPT = r"""
'use strict';
const $ = (s) => document.querySelector(s);

/* ───────── 引用块按语义着色 ───────── */
document.querySelectorAll('#doc blockquote').forEach((b) => {
  const t = b.textContent;
  if (/❗|❌|严禁|绝不能|不要用|已被换掉/.test(t)) b.classList.add('danger');
  else if (/⚠|陷阱|注意|警告/.test(t)) b.classList.add('warn');
  else if (/✅|💡|👉|📌|🔍|💬/.test(t)) b.classList.add('ok');
});

/* ───────── 代码块：注释行淡显 ───────── */
document.querySelectorAll('#doc pre code').forEach((c) => {
  c.innerHTML = c.innerHTML.replace(
    /(^|\n)(\s*(?:\/\/|#)\s[^\n]*)/g,
    (m, br, cmt) => br + '<span class="cmt">' + cmt + '</span>'
  );
});

/* ───────── 滚动高亮（scroll-spy） ───────── */
const links = [...document.querySelectorAll('#toc a')];
const byId = new Map(links.map((a) => [decodeURIComponent(a.getAttribute('href').slice(1)), a]));
const heads = [...document.querySelectorAll('#doc h2[id], #doc h3[id]')];

let ticking = false;
function spy() {
  ticking = false;
  const y = window.scrollY + 90;
  let cur = null;
  for (const h of heads) { if (h.offsetTop <= y) cur = h.id; else break; }
  links.forEach((a) => a.classList.remove('on'));
  if (cur && byId.has(cur)) {
    const a = byId.get(cur);
    a.classList.add('on');
    const box = $('#side');
    const r = a.getBoundingClientRect(), br = box.getBoundingClientRect();
    if (r.top < br.top + 20 || r.bottom > br.bottom - 20) {
      box.scrollTop += r.top - br.top - box.clientHeight / 2.6;
    }
  }
  $('#totop').classList.toggle('on', window.scrollY > 500);
}
window.addEventListener('scroll', () => {
  if (!ticking) { ticking = true; requestAnimationFrame(spy); }
}, { passive: true });

/* ───────── 搜索：过滤目录 + 只显示命中章节 + 正文高亮 ───────── */
const RAW = document.body.innerHTML;           // 未高亮的原始状态
const secs = [...document.querySelectorAll('#doc h2[id]')].map((h) => {
  const nodes = [h];
  let n = h.nextElementSibling;
  while (n && n.tagName !== 'H2') { nodes.push(n); n = n.nextElementSibling; }
  return { head: h, nodes, text: nodes.map((x) => x.textContent).join(' ').toLowerCase() };
});

let clearTimer = null;
function doSearch(rawQ) {
  const q = rawQ.trim().toLowerCase();
  $('#clr').style.display = q ? 'block' : 'none';

  // 1) 还原上一次的高亮
  if (document.querySelector('#doc mark.hit')) {
    document.querySelectorAll('#doc mark.hit').forEach((m) => {
      const p = m.parentNode; p.replaceChild(document.createTextNode(m.textContent), m); p.normalize();
    });
  }

  if (!q) {
    secs.forEach((s) => s.nodes.forEach((n) => n.classList.remove('sec-off')));
    links.forEach((a) => a.classList.remove('hide'));
    $('#toc').querySelectorAll('li').forEach((li) => (li.style.display = ''));
    $('#hits').textContent = '';
    document.querySelectorAll('#doc h2[id]').forEach((h) => h.classList.remove('sec-off'));
    return;
  }

  // 2) 章节级显隐
  let hit = 0;
  secs.forEach((s) => {
    const ok = s.text.includes(q);
    if (ok) hit++;
    s.nodes.forEach((n) => n.classList.toggle('sec-off', !ok));
  });
  $('#hits').textContent = hit ? hit + ' 章命中' : '无命中';

  // 3) 目录同步：只留命中的章（及其子项）
  const keep = new Set(secs.filter((s) => !s.nodes[0].classList.contains('sec-off')).map((s) => s.head.id));
  document.querySelectorAll('#toc > ul > li').forEach((li) => {
    const a = li.querySelector('a');
    const id = a ? decodeURIComponent(a.getAttribute('href').slice(1)) : '';
    li.style.display = keep.has(id) ? '' : 'none';
  });

  // 4) 正文高亮（在可见章节内）
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  secs.filter((s) => !s.nodes[0].classList.contains('sec-off')).forEach((s) => {
    s.nodes.forEach((node) => {
      if (node.tagName === 'PRE' || node.tagName === 'TABLE') return;   // 代码/表格不破坏结构
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const targets = [];
      let n;
      while ((n = walker.nextNode())) {
        if (n.nodeValue.toLowerCase().includes(q) && n.parentNode.tagName !== 'MARK') targets.push(n);
      }
      targets.forEach((t) => {
        const frag = document.createDocumentFragment();
        let last = 0, s2;
        re.lastIndex = 0;
        while ((s2 = re.exec(t.nodeValue))) {
          if (s2.index > last) frag.appendChild(document.createTextNode(t.nodeValue.slice(last, s2.index)));
          const m = document.createElement('mark');
          m.className = 'hit'; m.textContent = s2[0];
          frag.appendChild(m);
          last = s2.index + s2[0].length;
          if (s2.index === re.lastIndex) re.lastIndex++;
        }
        if (last < t.nodeValue.length) frag.appendChild(document.createTextNode(t.nodeValue.slice(last)));
        t.parentNode.replaceChild(frag, t);
      });
    });
  });

  // 5) 滚到第一个命中章节
  const first = secs.find((s) => !s.nodes[0].classList.contains('sec-off'));
  if (first) window.scrollTo({ top: first.head.offsetTop - 70, behavior: 'auto' });
}

$('#q').addEventListener('input', (e) => {
  clearTimeout(clearTimer);
  const v = e.target.value;
  clearTimer = setTimeout(() => doSearch(v), 110);
});
$('#clr').onclick = () => { $('#q').value = ''; doSearch(''); $('#q').focus(); };

/* ───────── 键盘 ───────── */
document.addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA/.test(document.activeElement.tagName);
  if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
    e.preventDefault(); $('#q').focus(); $('#q').select();
  } else if (e.key === 'Escape') {
    if (typing) { $('#q').value = ''; doSearch(''); $('#q').blur(); }
  } else if (!typing && (e.key === 'g' || e.key === 'G')) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (!typing && (e.key === 'j' || e.key === 'J' || e.key === 'ArrowDown' && e.altKey)) {
    jump(1);
  } else if (!typing && (e.key === 'k' && !e.metaKey && !e.ctrlKey)) {
    jump(-1);
  }
});
function jump(dir) {
  const vis = heads.filter((h) => !h.classList.contains('sec-off'));
  const y = window.scrollY + 100;
  let i = vis.findIndex((h) => h.offsetTop > y);
  if (i === -1) i = vis.length;
  const t = vis[Math.max(0, Math.min(vis.length - 1, i + (dir > 0 ? 0 : -1)))];
  if (t) window.scrollTo({ top: t.offsetTop - 70, behavior: 'smooth' });
}

/* ───────── 回到顶部 ───────── */
$('#totop').onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });

spy();
"""

page = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>stockdb 策略开发技能 · 完整使用说明书</title>
<style>{STYLE}</style>
</head>
<body>

<div id="top">
  <div id="brand">stockdb 策略开发 <em>·</em> 使用说明书</div>
  <div id="stats">
    <span><b>{n_h2}</b> 章</span>
    <span><b>{n_h3}</b> 节</span>
    <span><b>{n_tables}</b> 表</span>
    <span><b>{n_code}</b> 代码块</span>
    <span><b>{n_chars:,}</b> 字</span>
  </div>
  <div id="sp"></div>
  <div id="hits"></div>
  <div id="searchWrap">
    <span class="ic">⌕</span>
    <input id="q" type="text" placeholder="搜索全文…" autocomplete="off" spellcheck="false">
    <button id="clr" title="清空">×</button>
  </div>
</div>

<div id="wrap">
  <nav id="side">
    <div class="ttl">目录</div>
    <div id="toc">{toc_html}</div>
    <div class="foot">
      <kbd>⌘/Ctrl</kbd>+<kbd>K</kbd> 搜索 &nbsp;·&nbsp; <kbd>Esc</kbd> 清空<br>
      <kbd>J</kbd> / <kbd>K</kbd> 上下章 &nbsp;·&nbsp; <kbd>G</kbd> 回顶
    </div>
  </nav>

  <main id="main">
    <article id="doc">
{body}
    </article>
  </main>
</div>

<button id="totop" title="回到顶部">↑</button>
<script>{SCRIPT}</script>
</body>
</html>
"""

with open(DST, "w", encoding="utf-8") as fh:
    fh.write(page)

print(f"→ {DST}")
print(f"   {n_h2} 章 / {n_h3} 节 / {n_tables} 表 / {n_code} 代码块 / {len(page):,} bytes")
