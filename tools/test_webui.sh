#!/bin/sh
# ============================================================
# 魅族线程 v3.0 自检
#
# 在临时副本上运行，不改动仓库文件。
#     sh tools/test_webui.sh
#
# 校验：
#   A. 脚本语法 / AsoulOpt 逻辑未被改动（与上游逐字节比对）
#   B. 后端 webui.sh：status / asopt-get / asopt-set / 每游戏覆盖 / games
#   C. 默认用户线程 default_threads.json 的结构与关键映射
# ============================================================

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
UPSTREAM_ASOPT="/c/xiancheng/_sources_原始素材/AsoulOpt_Kana"

PASS=0
FAIL=0
pass() { printf '  [PASS] %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf '  [FAIL] %s\n' "$1"; FAIL=$((FAIL + 1)); }
ok()   { if [ "$2" = "$3" ]; then pass "$1 = $2"; else fail "$1: 期望 [$3]，实际 [$2]"; fi; }
has()  { if printf '%s' "$2" | grep -q -- "$3"; then pass "$1"; else fail "$1（未匹配 $3）"; fi; }
nhas() { if printf '%s' "$2" | grep -q -- "$3"; then fail "$1（不应匹配 $3）"; else pass "$1"; fi; }

WORK=$(mktemp -d 2>/dev/null) || WORK="/tmp/meizu_v3.$$"
mkdir -p "$WORK"
for f in webui.sh module.prop default_threads.json asoulopt_games.txt; do
    [ -f "$ROOT/$f" ] && cp "$ROOT/$f" "$WORK/$f"
done
mkdir -p "$WORK/asoulopt"
[ -f "$ROOT/asoulopt/AsoulOpt" ] && cp "$ROOT/asoulopt/AsoulOpt" "$WORK/asoulopt/"
[ -f "$ROOT/asoulopt/service.sh" ] && cp "$ROOT/asoulopt/service.sh" "$WORK/asoulopt/"

MEIZU_ASOPT_DIR="$WORK/naki"
export MEIZU_ASOPT_DIR

cd "$WORK" || exit 1

CONF="$MEIZU_ASOPT_DIR/asopt.conf"
GAMES() { grep -cE '^[^#][^ ]+ [0-9]+ [0-9]+$' "$CONF" 2>/dev/null | tr -d ' '; }

printf '\n=== A. 语法与「AsoulOpt 逻辑未改动」===\n'
for f in webui.sh service.sh customize.sh; do
    if [ -f "$ROOT/$f" ]; then
        if sh -n "$ROOT/$f" 2>/dev/null; then pass "$f 语法"; else fail "$f 语法错误"; fi
    fi
done
if [ -f "$ROOT/asoulopt/service.sh" ]; then
    if sh -n "$ROOT/asoulopt/service.sh" 2>/dev/null; then pass "asoulopt/service.sh 语法"; else fail "asoulopt/service.sh 语法错误"; fi
    if [ -f "$UPSTREAM_ASOPT/service.sh" ]; then
        if cmp -s "$ROOT/asoulopt/service.sh" "$UPSTREAM_ASOPT/service.sh"; then
            pass "asoulopt/service.sh 与上游逐字节一致（逻辑未改动）"
        else
            fail "asoulopt/service.sh 与上游不一致！"
        fi
        if cmp -s "$ROOT/asoulopt/AsoulOpt" "$UPSTREAM_ASOPT/AsoulOpt"; then
            pass "asoulopt/AsoulOpt 二进制与上游逐字节一致"
        else
            fail "asoulopt/AsoulOpt 与上游不一致！"
        fi
    else
        printf '  [SKIP] 缺少上游副本，跳过逐字节比对\n'
    fi
fi
has "service.sh 只调用上游脚本（无自造逻辑）" "$(cat "$ROOT/service.sh")" 'exec sh "\$ASOULOPT/service.sh"'
has "module.prop 名称已改为魅族线程" "$(cat "$ROOT/module.prop")" 'name=魅族线程'

printf '\n=== B. 后端 webui.sh ===\n'
S=$(sh webui.sh status 2>&1)
has "status 可用" "$S" '"ok":true'
has "status 含 scene_installed" "$S" '"scene_installed"'
has "status 含 default_exists" "$S" '"default_exists"'
has "status 含 scene_conf 路径" "$S" 'com.omarea.vtools/files/threads.json'

G=$(sh webui.sh asopt-get 2>&1)
has "asopt-get 可用" "$G" '"ok":true'
has "默认 mode=0" "$G" '"mode":0'
has "默认 rt=0" "$G" '"rt":0'

sh webui.sh asopt-set 1 0 > /dev/null 2>&1
ok "写入 mode" "$(grep -E '^mode=' "$CONF" | cut -d= -f2 | tr -d '\r')" "1"
ok "写入 rt"   "$(grep -E '^rt=' "$CONF" | cut -d= -f2 | tr -d '\r')" "0"
has "保留上游说明头（硬亲和）"     "$(cat "$CONF")" '硬亲和'
has "保留上游说明头（Per-game）"   "$(cat "$CONF")" 'Per-game override'
has "保留上游说明头（切换游戏生效）" "$(cat "$CONF")" '切换游戏后生效'

sh webui.sh asopt-set-game com.miHoYo.Yuanshen 0 0 > /dev/null 2>&1
sh webui.sh asopt-set-game com.tencent.tmgp.sgame 2 1 > /dev/null 2>&1
ok "游戏覆盖 2 条" "$(GAMES)" "2"
ok "行格式合上游正则" "$(GAMES)" "2"
sh webui.sh asopt-set-game com.miHoYo.Yuanshen 1 1 > /dev/null 2>&1
ok "重复设置是覆盖而非新增" "$(GAMES)" "2"
has "覆盖后取值正确" "$(grep '^com.miHoYo.Yuanshen' "$CONF")" 'com.miHoYo.Yuanshen 1 1'
has "asopt-get 返回 2 个游戏" "$(sh webui.sh asopt-get 2>&1)" '"pkg":"com.tencent.tmgp.sgame"'
sh webui.sh asopt-del-game com.miHoYo.Yuanshen > /dev/null 2>&1
ok "删除后剩 1 条" "$(GAMES)" "1"

has "拒绝非法全局 mode" "$(sh webui.sh asopt-set 5 0 2>&1)" '"ok":false'
has "拒绝非法全局 rt"   "$(sh webui.sh asopt-set 0 9 2>&1)" '"ok":false'
has "拒绝非法游戏 mode" "$(sh webui.sh asopt-set-game com.x 9 0 2>&1)" '"ok":false'
has "拒绝含空格包名"    "$(sh webui.sh asopt-set-game 'a b' 0 0 2>&1)" '"ok":false'
has "拒绝空包名"        "$(sh webui.sh asopt-set-game '' 0 0 2>&1)" '"ok":false'

if sh webui.sh games > /dev/null 2>&1; then pass "games 可执行（无 pm 时安静返回）"; else fail "games 执行失败"; fi
has "支持游戏关键词表存在" "$(head -3 "$ROOT/asoulopt_games.txt")" '包含'

printf '\n=== C. 默认用户线程 default_threads.json ===\n'
DJ="$ROOT/default_threads.json"
if [ -f "$DJ" ]; then
    ok "规则条数（friendly 计数）" "$(grep -c '"friendly"' "$DJ" | tr -d ' ')" "179"
    has "含 com.tencent.mm" "$(cat "$DJ")" '"friendly": "com.tencent.mm"'
    has "含 cpuset 模型" "$(cat "$DJ")" '"cpuset"'
    has "含 heaviest_thread" "$(cat "$DJ")" '"heaviest_thread"'
    has "含 comm 映射" "$(cat "$DJ")" '"comm"'
    has "含 main_thread" "$(cat "$DJ")" '"main_thread"'
    has "含 other" "$(cat "$DJ")" '"other"'
    nhas "不含游戏段标志（AsoulOpt）" "$(cat "$DJ")" 'AsoulOpt'
    # 抽查 com.tencent.mm 的关键映射：RenderThread→2-6 / main→2-6 / other→5-6
    BLK=$(awk '/"friendly": "com.tencent.mm"/,/^  }/' "$DJ")
    has "mm: heaviest_cores=2-6" "$BLK" '"heaviest_cores": "2-6"'
    has "mm: main_thread=2-6"    "$BLK" '"main_thread": "2-6"'
    has "mm: other=5-6"          "$BLK" '"other": "5-6"'
    has "mm: comm 含 binder 前缀" "$BLK" '"binder:"'
else
    fail "缺少 default_threads.json"
fi

rm -rf "$WORK"

printf '\n============================================\n'
if [ "$FAIL" -eq 0 ]; then
    printf '  全部通过  (%s 项)\n' "$PASS"
else
    printf '  %s 项失败  (%s 项通过)\n' "$FAIL" "$PASS"
fi
printf '============================================\n\n'
[ "$FAIL" -eq 0 ]
