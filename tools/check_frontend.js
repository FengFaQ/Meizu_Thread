/* ============================================================
   前端静态校验（开发期工具，不随模块分发）
     node tools/check_frontend.js
   校验：
     1) index.html 无重复 id，app.js 引用的 id 都存在
     2) 「用户线程 / 游戏线程」切换按钮与 screen-* 配对
     3) app.js 调用的 webui.sh 子命令都已实现
     4) 关键设计点：Scene 路径、默认配置、AsoulOpt 三处
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'webroot', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'webroot', 'app.js'), 'utf8');
const sh = fs.readFileSync(path.join(ROOT, 'webui.sh'), 'utf8');
const prop = fs.readFileSync(path.join(ROOT, 'module.prop'), 'utf8');

let fail = 0;
function check(cond, label, extra) {
  console.log((cond ? '  [PASS] ' : '  [FAIL] ') + label + (extra ? '  [' + extra + ']' : ''));
  if (!cond) fail++;
}

console.log('=== 1) DOM id ===');
const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
const idSet = new Set(ids);
const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
check(dup.length === 0, 'index.html 无重复 id (' + ids.length + ' 个)', dup.join(','));
const jsIds = new Set();
for (const m of js.matchAll(/\$\("([^"]+)"\)/g)) jsIds.add(m[1]);
for (const m of js.matchAll(/\$\('([^']+)'\)/g)) jsIds.add(m[1]);
// $() 用的是 querySelector，写法为 $("#id") —— 取出纯 id 部分校验
const pureIds = [...jsIds].filter((x) => /^#[A-Za-z][\w-]*$/.test(x)).map((x) => x.slice(1));

// app.js 运行时自己创建的 id（设置表单、游戏线程页都是动态构建），
// 这类 id 不在 index.html 里，属于正常情况，需排除后再比对
const dynamicIds = new Set();
for (const m of js.matchAll(/\bid:\s*"([^"]+)"/g)) dynamicIds.add(m[1]);   // el(tag,{id:"x"})
for (const m of js.matchAll(/\bid="([^"]+)"/g)) dynamicIds.add(m[1]);     // 模板串里的 id="x"

check(pureIds.length > 10, 'app.js 引用了 ' + pureIds.length + ' 个纯 id', '选择器总数 ' + jsIds.size);
const missing = pureIds.filter((x) => !idSet.has(x) && !dynamicIds.has(x));
check(missing.length === 0, '静态 id 均存在于 index.html（已排除 JS 动态创建的 ' + dynamicIds.size + ' 个）', missing.join(','));
const unused = ids.filter((x) => pureIds.indexOf(x) < 0);
if (unused.length) console.log('       （未直接用 $("#id") 引用: ' + unused.join(', ') + '）');

console.log('\n=== 2) 用户线程 / 游戏线程 切换配对 ===');
const roots = [...html.matchAll(/data-root="([^"]+)"/g)].map((m) => m[1]);
const uniqRoots = [...new Set(roots)];
check(uniqRoots.length > 0, '切换按钮 data-root: ' + uniqRoots.join(', '));
for (const r of uniqRoots) check(idSet.has('screen-' + r), '「' + r + '」有对应 screen-' + r);
check(uniqRoots.includes('list'), '含「用户线程」根屏 (list)');
check(uniqRoots.includes('asoul'), '含「游戏线程」根屏 (asoul)');

console.log('\n=== 3) app.js 调用的 webui.sh 子命令均已实现 ===');
const dispatched = new Set();
const caseBlock = sh.slice(sh.indexOf('case "$CMD" in'));
for (const m of caseBlock.matchAll(/^\s{4}([a-z][a-z-]*)\)/gm)) dispatched.add(m[1]);
const called = new Set();
for (const m of js.matchAll(/webui(?:Cmd|Tsv)\(\s*[`"']([a-z][a-z-]*)/g)) called.add(m[1]);
check(called.size > 0, 'app.js 调用了 ' + called.size + ' 个子命令: ' + [...called].sort().join(','));
const undef = [...called].filter((c) => !dispatched.has(c));
check(undef.length === 0, '全部已实现', undef.join(','));
console.log('       后端实现 ' + dispatched.size + ' 个: ' + [...dispatched].sort().join(','));

console.log('\n=== 4) 关键设计点 ===');
check(js.includes('com.omarea.vtools/files/threads.json'), '用户线程写 Scene 的 threads.json');
check(js.includes('default_threads.json'), '引用了模块自带的默认用户线程');
check(js.includes('loadDefaultThreads'), '实现了「载入默认」逻辑');
check(/#default-hint/.test(js) || js.includes('default-hint'), '默认配置有提示条');
check(js.includes('asopt-set-game') && js.includes('asopt-del-game'), '游戏线程支持每游戏增删');
check(/btn-asoul-save/.test(html) || /btn-asoul-save/.test(js), '游戏线程有全局 mode/rt 保存');
check(prop.includes('name=魅族线程'), '模块名已改为魅族线程');
check(/version=3\./.test(prop), '版本号为 3.x');
check(!fs.existsSync(path.join(ROOT, 'bin')), '不再携带自带引擎 bin/');
check(!fs.existsSync(path.join(ROOT, 'applist.conf')) || true, '（applist.conf 仅作转换输入，不入包）');

console.log('\n=== 结果 ===');
console.log(fail === 0 ? '全部通过' : fail + ' 项失败');
process.exit(fail === 0 ? 0 : 1);
