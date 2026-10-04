/* ============================================================
   魅族线程 WebUI 前端
   - 通过 KernelSU 注入的 JS 接口以 root 身份调用 webui.sh
   - 兼容「回调名式」与「Promise 式」两种 exec 形态
   ============================================================ */
'use strict';

(function () {

  /* ---------------- 常量 ---------------- */
  var DEFAULT_MODDIR = '/data/adb/modules/Meizu_Thread';
  var MODDIR = DEFAULT_MODDIR;
  var SCRIPT = MODDIR + '/webui.sh';
  var PAGE = 80;

  var CORES = [
    { v: 'hp-core', t: 'hp-core', d: '高性能大核' },
    { v: 'p-core', t: 'p-core', d: '性能中核' },
    { v: 'e-core', t: 'e-core', d: '能效小核' },
    { v: 'all-core', t: 'all-core', d: '全部核心' },
    { v: 'p-core,hp-core', t: 'p-core,hp-core', d: '中核 + 大核' },
    { v: 'e-core,p-core', t: 'e-core,p-core', d: '小核 + 中核' },
    { v: 'e-core,p-core,hp-core', t: 'e-core,p-core,hp-core', d: '除超大核外全部' }
  ];

  /* ---------------- KernelSU 桥 ---------------- */
  var KSU = (function () {
    var api = window.ksu || window.kernelsu || window.ksuApi || null;

    function available() {
      return !!(api && typeof api.exec === 'function');
    }

    // 统一返回 { errno, stdout, stderr }
    function execRaw(command, timeoutMs) {
      return new Promise(function (resolve) {
        if (!available()) {
          resolve({ errno: -1, stdout: '', stderr: '__NO_KSU__' });
          return;
        }
        var settled = false;
        var cbName = 'ksu_cb_' + Math.random().toString(36).slice(2) + Date.now().toString(36);

        function finish(res) {
          if (settled) return;
          settled = true;
          try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
          resolve(res);
        }

        // 回调名式（KernelSU 原生）
        window[cbName] = function (errno, stdout, stderr) {
          finish({ errno: errno, stdout: stdout || '', stderr: stderr || '' });
        };

        var ret;
        try {
          ret = api.exec(command, '{}', cbName);
        } catch (e) {
          finish({ errno: -1, stdout: '', stderr: String(e) });
          return;
        }

        // Promise 式（部分管理器/新版接口）
        if (ret && typeof ret.then === 'function') {
          ret.then(function (r) {
            if (r && typeof r === 'object') {
              finish({ errno: (r.errno === undefined ? 0 : r.errno), stdout: r.stdout || '', stderr: r.stderr || '' });
            } else {
              finish({ errno: 0, stdout: (r == null ? '' : String(r)), stderr: '' });
            }
          })['catch'](function (e) {
            finish({ errno: -1, stdout: '', stderr: String(e) });
          });
        }

        setTimeout(function () {
          finish({ errno: -2, stdout: '', stderr: '__TIMEOUT__' });
        }, timeoutMs || 60000);
      });
    }

    function toast(msg) {
      try {
        if (api && typeof api.toast === 'function') { api.toast(String(msg)); return true; }
      } catch (e) { /* 落到自绘 toast */ }
      return false;
    }

    function fullScreen(on) {
      try {
        if (api && typeof api.fullScreen === 'function') api.fullScreen(!!on);
      } catch (e) { /* 忽略 */ }
    }

    return { available: available, execRaw: execRaw, toast: toast, fullScreen: fullScreen };
  })();

  /* ---------------- 工具 ---------------- */
  function shq(s) {
    return "'" + String(s).replace(/'/g, "'\\''") + "'";
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function $(id) { return document.getElementById(id); }

  var toastTimer = null;
  function showToast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  function notify(msg) {
    if (!KSU.toast(msg)) showToast(msg);
  }

  var busyDepth = 0;
  function busy(on, text) {
    if (on) busyDepth++; else busyDepth = Math.max(0, busyDepth - 1);
    var el = $('busy');
    if (busyDepth > 0) {
      $('busy-text').textContent = text || '处理中…';
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }

  /* ---------------- 命令封装 ---------------- */
  function api(args, timeoutMs) {
    return KSU.execRaw('sh ' + shq(SCRIPT) + ' ' + args, timeoutMs);
  }

  function pickJson(text) {
    var lines = String(text || '').split('\n');
    for (var i = lines.length - 1; i >= 0; i--) {
      var L = lines[i].trim();
      if (L.charAt(0) === '{') {
        try { return JSON.parse(L); } catch (e) { /* 继续往前找 */ }
      }
    }
    return null;
  }

  function jsonCmd(args, timeoutMs) {
    return api(args, timeoutMs).then(function (r) {
      var j = pickJson(r.stdout);
      if (j) return j;
      var err = (r.stderr || '').trim();
      if (r.errno === -1 && err === '__NO_KSU__') return { ok: false, msg: '当前环境没有 KernelSU 接口' };
      if (r.errno === -2) return { ok: false, msg: '执行超时' };
      return { ok: false, msg: err || '命令无输出' };
    });
  }

  function tsvCmd(args, timeoutMs) {
    return api(args, timeoutMs).then(function (r) {
      return String(r.stdout || '')
        .split('\n')
        .map(function (l) { return l.replace(/\r$/, ''); })
        .filter(function (l) { return l.length > 0; })
        .map(function (l) { return l.split('\t'); });
    });
  }

  /* ---------------- 状态 ---------------- */
  var STATE = {
    status: null,
    apps: [],
    shown: PAGE,
    keyword: '',
    current: null,
    rules: []
  };

  /* ---------------- 渲染：总览 ---------------- */
  function statHtml(n, label, cls) {
    return '<div class="stat"><div class="n ' + (cls || '') + '">' + esc(n) + '</div>' +
      '<div class="l">' + esc(label) + '</div></div>';
  }

  function renderStatus(s) {
    STATE.status = s;
    $('ver').textContent = 'v' + (s.version || '?');

    var dev = [];
    if (s.soc_model) dev.push(s.soc_model);
    if (s.soc_platform) dev.push(s.soc_platform);
    $('devline').textContent = (dev.length ? dev.join(' · ') + ' · ' : '') +
      '底座 ' + (s.base || '?');

    var r = s.rules || {};
    $('stats').innerHTML =
      statHtml(r.total || 0, '规则总数') +
      statHtml(r.base || 0, '彗星底座') +
      statHtml(r.meizu || 0, '魅族专属') +
      statHtml(r.asoul || 0, 'AsoulOpt') +
      statHtml(r.custom || 0, '自定义', (r.custom ? '' : 'zero'));

    var t = s.topology || {};
    var rows = [
      ['e-core', t.e_core],
      ['p-core', t.p_core],
      ['hp-core', t.hp_core],
      ['all-core', t.all_core]
    ];
    $('topo').innerHTML = rows.map(function (x) {
      var v = x[1] || '';
      return '<div class="topo-row"><span class="sym">' + esc(x[0]) + '</span>' +
        '<span class="cpus' + (v ? '' : ' empty') + '">' +
        (v ? 'CPU ' + esc(v) : '未探测到') + '</span></div>';
    }).join('');

    $('sw-meizu').checked = s.meizu === 'on';
    $('sw-asoul').checked = s.asoul === 'on';
    $('sw-g83').checked = s.g83 === 'on';

    function yn(b) { return b ? '<span class="v ok">运行中</span>' : '<span class="v off">未运行</span>'; }
    $('runtime').innerHTML =
      kv('AppOpt 进程', s.running ? '<span class="v ok">运行中</span>' : '<span class="v off">未运行</span>') +
      kv('模块目录', esc(s.moddir || MODDIR)) +
      kv('版本号', esc(s.versionCode || '—')) +
      kv('底座档位', esc(s.base || '—') + (s.g83 === 'on' ? '（8G3）' : '（通用）'));
  }

  function kv(k, v) {
    return '<div class="kv-row"><span class="k">' + esc(k) + '</span><span class="v">' + v + '</span></div>';
  }

  function loadStatus(silent) {
    return jsonCmd('status').then(function (j) {
      if (!j || !j.ok) {
        if (!silent) notify((j && j.msg) || '状态读取失败');
        return j;
      }
      MODDIR = j.moddir || MODDIR;
      SCRIPT = MODDIR + '/webui.sh';
      renderStatus(j);
      return j;
    });
  }

  /* ---------------- 渲染：应用列表 ---------------- */
  function renderApps() {
    var kw = STATE.keyword.trim().toLowerCase();
    var list = STATE.apps.filter(function (a) {
      return !kw || a.pkg.toLowerCase().indexOf(kw) >= 0;
    });

    var slice = list.slice(0, STATE.shown);
    $('list-meta').textContent = STATE.apps.length + ' 个应用' +
      (kw ? '（匹配 ' + list.length + '）' : '') +
      (list.length > slice.length ? '，已显示 ' + slice.length : '');

    $('apps').innerHTML = slice.map(function (a) {
      var badges = '';
      if (a.custom > 0) badges += '<span class="badge cust">自定义 ' + a.custom + '</span>';
      if (a.adapted) badges += '<span class="badge builtin">内置 ' + a.builtin + '</span>';
      if (!a.adapted && a.custom === 0) badges += '<span class="badge">未适配</span>';
      if (/[*?]/.test(a.pkg)) badges += '<span class="badge wild">通配</span>';
      return '<div class="app" data-pkg="' + esc(a.pkg) + '">' +
        '<span class="pkgname">' + esc(a.pkg) + '</span>' +
        '<span class="meta">' + badges + '</span></div>';
    }).join('');

    $('btn-more').classList.toggle('hidden', list.length <= slice.length);
  }

  function loadApps() {
    return tsvCmd('apps', 120000).then(function (rows) {
      STATE.apps = rows.map(function (f) {
        return {
          pkg: f[0] || '',
          builtin: parseInt(f[1] || '0', 10) || 0,
          custom: parseInt(f[2] || '0', 10) || 0,
          adapted: (f[3] || '0') === '1'
        };
      }).filter(function (a) { return a.pkg; });
      renderApps();
    });
  }

  /* ---------------- 渲染：某应用规则 ---------------- */
  function renderRules(pkg) {
    var host = $('d-rules');
    if (!STATE.rules.length) {
      host.innerHTML = '<p class="hint">该应用当前没有规则。可在下方新增。</p>';
      return;
    }
    host.innerHTML = STATE.rules.map(function (r) {
      var thr = r.thread === '-' ? '<span class="proc">（进程兜底）</span>' : esc(r.thread);
      var del = r.custom
        ? '<button class="btn small danger" data-del="1" data-thread="' + esc(r.thread) + '">删</button>'
        : '';
      return '<div class="rule">' +
        '<span class="thr">' + thr + (r.custom ? ' <span class="badge cust">自定义</span>' : '') + '</span>' +
        '<span class="tail"><span class="core">' + esc(r.core) + '</span>' +
        '<button class="btn small" data-edit="1" data-thread="' + esc(r.thread) + '" data-core="' + esc(r.core) + '">改</button>' +
        del + '</span></div>';
    }).join('');
  }

  function openApp(pkg) {
    STATE.current = pkg;
    $('custom-list').classList.add('hidden');
    $('custom-detail').classList.remove('hidden');
    $('d-pkg').textContent = pkg;
    $('f-thread').value = '';
    $('f-core').value = 'hp-core';
    return loadRules(pkg);
  }

  function closeApp() {
    STATE.current = null;
    $('custom-detail').classList.add('hidden');
    $('custom-list').classList.remove('hidden');
    loadApps();
  }

  function loadRules(pkg) {
    busy(true, '读取规则…');
    return tsvCmd('app ' + shq(pkg), 60000).then(function (rows) {
      STATE.rules = rows.map(function (f) {
        return { thread: f[0] || '-', core: f[1] || '', custom: (f[2] || '0') === '1' };
      });
      renderRules(pkg);
    })['finally'](function () { busy(false); });
  }

  /* ---------------- 操作 ---------------- */
  var applying = false;
  function setFlags() {
    if (applying) return;
    applying = true;
    var m = $('sw-meizu').checked ? 'on' : 'off';
    var a = $('sw-asoul').checked ? 'on' : 'off';
    var g = $('sw-g83').checked ? 'on' : 'off';
    busy(true, '正在应用配置…');
    jsonCmd('set-flags ' + m + ' ' + a + ' ' + g, 180000).then(function (j) {
      notify((j && j.msg) || (j && j.ok ? '已应用' : '应用失败'));
      return loadStatus(true);
    })['finally'](function () {
      busy(false);
      applying = false;
    });
  }

  function doApply() {
    busy(true, '正在重新生成规则…');
    jsonCmd('apply', 180000).then(function (j) {
      notify((j && j.msg) || '完成');
      return loadStatus(true);
    })['finally'](function () { busy(false); });
  }

  function doUpdateRules() {
    busy(true, '正在从 GitHub 更新规则…');
    jsonCmd('update-rules', 300000).then(function (j) {
      notify((j && j.msg) || '完成');
      return loadStatus(true);
    })['finally'](function () { busy(false); });
  }

  function saveRule() {
    if (!STATE.current) return;
    var thr = $('f-thread').value.trim();
    var core = $('f-core').value;
    busy(true, '保存中…');
    jsonCmd('set-rule ' + shq(STATE.current) + ' ' + shq(thr || '-') + ' ' + shq(core), 120000)
      .then(function (j) {
        notify((j && j.msg) || '完成');
        if (j && j.ok) { $('f-thread').value = ''; }
        return loadRules(STATE.current).then(function () { return loadStatus(true); });
      })['finally'](function () { busy(false); });
  }

  function delRule(thread) {
    if (!STATE.current) return;
    busy(true, '删除中…');
    jsonCmd('del-rule ' + shq(STATE.current) + ' ' + shq(thread === '-' ? '' : thread), 120000)
      .then(function (j) {
        notify((j && j.msg) || '完成');
        return loadRules(STATE.current).then(function () { return loadStatus(true); });
      })['finally'](function () { busy(false); });
  }

  function resetApp() {
    if (!STATE.current) return;
    busy(true, '还原中…');
    jsonCmd('reset-app ' + shq(STATE.current), 120000).then(function (j) {
      notify((j && j.msg) || '完成');
      return loadRules(STATE.current).then(function () { return loadStatus(true); });
    })['finally'](function () { busy(false); });
  }

  function resetAll() {
    if (!confirm('确定清空全部自定义规则？此操作不可撤销。')) return;
    busy(true, '清空中…');
    jsonCmd('reset-all', 120000).then(function (j) {
      notify((j && j.msg) || '完成');
      return loadStatus(true);
    })['finally'](function () { busy(false); });
  }

  /* ---------------- 备份 / 导入 ---------------- */
  function doExport() {
    busy(true, '正在导出…');
    jsonCmd('export', 120000).then(function (j) {
      if (!j || !j.ok) { notify((j && j.msg) || '导出失败'); return; }
      $('export-out').classList.remove('hidden');
      $('export-path').textContent = '已保存到 ' + (j.path || '') + '（' + (j.count || 0) + ' 条自定义规则）';
      $('export-text').value = j.content || '';
      notify('已导出 ' + (j.count || 0) + ' 条规则');
    })['finally'](function () { busy(false); });
  }

  function doImport() {
    var text = $('import-text').value;
    if (!text.trim()) { notify('请先粘贴备份内容'); return; }
    if (text.indexOf('[rules]') < 0) { notify('内容缺少 [rules] 段，可能不是备份文件'); return; }
    if (!confirm('导入将覆盖当前自定义规则与开关，确定继续？')) return;

    busy(true, '正在导入…');
    var sentinel = 'MEIZU_EOF_' + Math.random().toString(36).slice(2);
    var tmp = MODDIR + '/.webui_import.tmp';
    var script = 'cat > ' + shq(tmp) + " << '" + sentinel + "'\n" + text.replace(/\s+$/, '') + '\n' + sentinel + '\n';

    KSU.execRaw(script, 60000).then(function (r) {
      if (r.errno !== 0) {
        notify('写入临时文件失败：' + (r.stderr || '').trim());
        busy(false);
        return null;
      }
      return jsonCmd('import ' + shq(tmp), 180000);
    }).then(function (j) {
      if (!j) return;
      notify((j && j.msg) || '导入完成');
      return loadStatus(true).then(function () { return loadApps(); });
    })['finally'](function () { busy(false); });
  }

  /* ---------------- 事件 ---------------- */
  function switchTab(name) {
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === name);
    }
    var panes = document.querySelectorAll('.pane');
    for (var j = 0; j < panes.length; j++) {
      panes[j].classList.toggle('active', panes[j].id === 'pane-' + name);
    }
    if (name === 'custom' && !STATE.apps.length) loadApps();
  }

  function initCoreOptions() {
    $('f-core').innerHTML = CORES.map(function (c) {
      return '<option value="' + esc(c.v) + '">' + esc(c.t) + ' — ' + esc(c.d) + '</option>';
    }).join('');
    $('f-core').value = 'hp-core';
  }

  function wire() {
    $('tabs').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.tab') : null;
      if (b) switchTab(b.getAttribute('data-tab'));
    });

    $('sw-meizu').addEventListener('change', setFlags);
    $('sw-asoul').addEventListener('change', setFlags);
    $('sw-g83').addEventListener('change', setFlags);

    $('btn-apply').addEventListener('click', doApply);
    $('btn-update').addEventListener('click', doUpdateRules);

    $('search').addEventListener('input', function () {
      STATE.keyword = this.value || '';
      STATE.shown = PAGE;
      renderApps();
    });
    $('btn-more').addEventListener('click', function () {
      STATE.shown += PAGE;
      renderApps();
    });

    $('apps').addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('.app') : null;
      if (el) openApp(el.getAttribute('data-pkg'));
    });

    $('btn-openpkg').addEventListener('click', function () {
      var p = $('f-newpkg').value.trim();
      if (!p) { notify('请输入包名'); return; }
      openApp(p);
    });

    $('btn-back').addEventListener('click', closeApp);
    $('btn-save').addEventListener('click', saveRule);
    $('btn-reset-app').addEventListener('click', resetApp);

    $('btn-mainthread').addEventListener('click', function () {
      var p = STATE.current || '';
      if (!p) return;
      if (p.length <= 15) { $('f-thread').value = p; notify('包名未超 15 字符，直接填入'); return; }
      $('f-thread').value = p.slice(-15);
      notify('已填入后 15 位：' + p.slice(-15));
    });

    $('d-rules').addEventListener('click', function (e) {
      var t = e.target;
      if (!t.getAttribute) return;
      if (t.getAttribute('data-edit')) {
        var th = t.getAttribute('data-thread');
        $('f-thread').value = th === '-' ? '' : th;
        $('f-core').value = t.getAttribute('data-core');
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      } else if (t.getAttribute('data-del')) {
        var th2 = t.getAttribute('data-thread');
        if (confirm('删除自定义规则：' + th2 + ' ？')) delRule(th2);
      }
    });

    $('btn-export').addEventListener('click', doExport);
    $('btn-import').addEventListener('click', doImport);
    $('btn-reset-all').addEventListener('click', resetAll);
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    initCoreOptions();
    wire();
    KSU.fullScreen(true);

    if (!KSU.available()) {
      $('noksu').classList.remove('hidden');
      $('devline').textContent = '未连接';
      return;
    }

    loadStatus().then(function (j) {
      if (j && j.ok) loadApps();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
