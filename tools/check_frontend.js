/* ============================================================
   前端静态校验（开发期工具，不随模块分发）
     node tools/check_frontend.js
   校验：
     1) app.js 引用的 DOM id 都存在于 index.html
     2) 标签页 data-tab 与 pane-* 一一配对
     3) 核心选项都能通过后端校验正则
     4) app.js 调用的 webui.sh 子命令都已在后端实现
     5) index.html 中不存在重复 id
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'webroot', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'webroot', 'app.js'), 'utf8');
const sh = fs.readFileSync(path.join(ROOT, 'webui.sh'), 'utf8');

let fail = 0;
function check(cond, label, extra) {
  console.log((cond ? '  [PASS] ' : '  [FAIL] ') + label + (extra ? '  [' + extra + ']' : ''));
  if (!cond) fail++;
}

console.log('=== 1) DOM id 交叉核对 ===');
const ids = [];
for (const m of html.matchAll(/id="([^"]+)"/g)) ids.push(m[1]);
const idSet = new Set(ids);
const dupIds = ids.filter((x, i) => ids.indexOf(x) !== i);
check(dupIds.length === 0, 'index.html 无重复 id (' + ids.length + ' 个)', dupIds.join(','));
const jsIds = new Set();
for (const m of js.matchAll(/\$\('([^']+)'\)/g)) jsIds.add(m[1]);
const missing = [...jsIds].filter((x) => !idSet.has(x));
check(missing.length === 0, 'app.js 引用的 ' + jsIds.size + ' 个 id 均存在', missing.join(','));

console.log('\n=== 2) 标签页与面板配对 ===');
const tabs = [...html.matchAll(/data-tab="([^"]+)"/g)].map((m) => m[1]);
const panes = [...html.matchAll(/id="pane-([^"]+)"/g)].map((m) => m[1]);
check(tabs.length === panes.length, '标签数 = 面板数 (' + tabs.length + ')', tabs.join(','));
for (const t of tabs) check(panes.includes(t), '「' + t + '」有对应 pane-' + t);
check(new Set(tabs).size === tabs.length, '标签无重复');

console.log('\n=== 3) 核心选项与后端校验一致 ===');
const CORE_RE = /^(e-core|p-core|hp-core|all-core)(,(e-core|p-core|hp-core|all-core))*$/;
const cores = [...js.matchAll(/v:\s*'([^']+)'/g)].map((m) => m[1]);
check(cores.length > 0, '取到 ' + cores.length + ' 个核心选项');
for (const c of cores) check(CORE_RE.test(c), '核心「' + c + '」合法');

console.log('\n=== 4) 前后端子命令一致性 ===');
const dispatched = new Set();
const caseBlock = sh.slice(sh.indexOf('case "$CMD" in'));
for (const m of caseBlock.matchAll(/^\s{4}([a-z][a-z-]*)\)/gm)) dispatched.add(m[1]);
const called = new Set();
for (const m of js.matchAll(/(?:jsonCmd|tsvCmd)\('([a-z][a-z-]*)/g)) called.add(m[1]);
check(called.size > 0, 'app.js 调用了 ' + called.size + ' 个子命令', [...called].sort().join(','));
const undef = [...called].filter((c) => !dispatched.has(c));
check(undef.length === 0, '所有子命令均已实现', undef.join(','));
console.log('       后端共实现 ' + dispatched.size + ' 个子命令');

console.log('\n=== 5) 引擎/AsoulOpt 关键项已在 UI 暴露 ===');
check(html.includes('en-interval'), 'UI 暴露 -s 扫描间隔');
check(html.includes('en-cpuset'), 'UI 暴露 -b cpuset 名');
check(/seg-asopt-mode/.test(html) && /seg-asopt-rt/.test(html), 'UI 暴露 AsoulOpt mode / rt');
check(html.includes('asopt-games'), 'UI 暴露每游戏覆盖列表');
check(/data-val="0"[\s\S]*data-val="1"[\s\S]*data-val="2"/.test(html), 'mode 提供 0/1/2 三档');

console.log('\n=== 结果 ===');
console.log(fail === 0 ? '全部通过' : fail + ' 项失败');
process.exit(fail === 0 ? 0 : 1);
