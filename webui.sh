#!/system/bin/sh
# ============================================================
# 魅族线程 v3.0 —— WebUI 后端
#
# 只做两件事：
#   1) 读写 AsoulOpt 的官方配置（游戏线程那一栏的可视化编辑）
#   2) 汇报环境状态（是否装了 Scene、默认用户线程是否存在…）
#
# 用户线程（Scene 的 threads.json）由前端直接读写 —— 与 upstream 编辑器一致，
# 不需要本脚本参与。
#
# AsoulOpt 的「逻辑」一律不动：配置路径与格式完全沿用上游
# （/data/adb/naki/asopt.conf，由 nakixii 的 customize.sh 定义）。
# ============================================================

MODDIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
[ -f "$MODDIR/module.prop" ] || MODDIR=/data/adb/modules/Meizu_Thread

# 允许用环境变量覆盖，便于在 PC 上测试
ASOPT_DIR="${MEIZU_ASOPT_DIR:-/data/adb/naki}"
ASOPT_CONF="$ASOPT_DIR/asopt.conf"
SCENE_PKG="com.omarea.vtools"
SCENE_CONF="/data/user/0/$SCENE_PKG/files/threads.json"

TMP="${TMPDIR:-/tmp}/meizu_webui.$$"
mkdir -p "$TMP" 2>/dev/null
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT HUP INT TERM

have() { command -v "$1" >/dev/null 2>&1; }

json_str() {
    awk 'BEGIN{ORS=""}
        {
            gsub(/\\/, "\\\\")
            gsub(/"/, "\\\"")
            gsub(/\t/, "\\t")
            gsub(/\r/, "")
            if (NR > 1) printf "\\n"
            printf "%s", $0
        }'
}

result() {
    local ok="$1"; shift
    printf '{"ok":%s,"msg":"%s"}\n' \
        "$([ "$ok" = "1" ] && echo true || echo false)" \
        "$(printf '%s' "$*" | json_str)"
    exit 0
}

# ---------------------------------------------------------------
# 状态
# ---------------------------------------------------------------
scene_installed() {
    if have pm && pm list packages 2>/dev/null | grep -q "$SCENE_PKG"; then
        echo 1
    else
        echo 0
    fi
}

do_status() {
    local si ti di ai
    si="$(scene_installed)"
    [ -f "$SCENE_CONF" ] && ti=1 || ti=0
    [ -f "$MODDIR/default_threads.json" ] && di=1 || di=0
    [ -x "$MODDIR/asoulopt/AsoulOpt" ] && ai=1 || ai=0
    printf '{"ok":true,"scene_installed":%s,"threads_exists":%s,"default_exists":%s,"asoul_binary":%s,"scene_conf":"%s","asopt_conf":"%s","moddir":"%s"}\n' \
        "$si" "$ti" "$di" "$ai" \
        "$(printf '%s' "$SCENE_CONF" | json_str)" \
        "$(printf '%s' "$ASOPT_CONF" | json_str)" \
        "$(printf '%s' "$MODDIR" | json_str)"
}

# ---------------------------------------------------------------
# AsoulOpt 配置（格式与上游 customize.sh 生成的一致）
#   mode=<0|1|2>      0 硬亲和 / 1 软迁移 / 2 硬迁移
#   rt=<0|1>          0 调度器默认 / 1 实时模式
#   <包名> <mode> <rt>  每游戏覆盖
# ---------------------------------------------------------------
asopt_header() {
    cat <<'ASOPTEOF'
# mode：运行模式 / Operation Mode
# 0：硬亲和，理论上表现更好 / Affinity, performs better in theory
# 1：软迁移，帧率可能更稳定 / Soft migrate, fps maybe more stable
# 2：硬迁移，帧率可能更稳定 / Hard migrate, fps maybe more stable

# rt：实时模式 / Real-Time Mode
# 0：调度器默认行为 / Scheduler default behavior
# 1：可能更流畅，但可能导致卡死 / maybe smoother, but may cause freeze

# 可对游戏单独指定 mode 和 rt / Per-game override of mode and rt
# 格式 / Format：包名(package name) mode rt
# 例 / Example：com.miHoYo.Yuanshen 0 0
# 一行一个，未匹配的游戏使用上面的全局值
# One per line, global values above as fallback

# ***保存后即时应用，切换游戏后生效***
# ***Applied on save, effective on next app switch***
ASOPTEOF
}

asopt_games() {
    [ -f "$ASOPT_CONF" ] || return 0
    awk '
        /^[[:space:]]*#/ { next }
        /^[[:space:]]*$/ { next }
        /^[[:space:]]*mode[[:space:]]*=/ { next }
        /^[[:space:]]*rt[[:space:]]*=/ { next }
        NF >= 3 {
            p = $1; m = $2; r = $3
            if (p == "") next
            if (m !~ /^[0-9]+$/ || r !~ /^[0-9]+$/) next
            print p " " m " " r
        }
    ' "$ASOPT_CONF"
}

asopt_cur() {
    local v=""
    if [ -f "$ASOPT_CONF" ]; then
        v="$(grep -E "^[[:space:]]*$1=" "$ASOPT_CONF" 2>/dev/null | head -n1 | cut -d= -f2 | tr -d ' \r\n')"
    fi
    case "$1" in
        mode) case "$v" in 0|1|2) ;; *) v=0 ;; esac ;;
        rt)   case "$v" in 0|1) ;; *) v=0 ;; esac ;;
    esac
    printf '%s' "$v"
}

asopt_write() {
    local mode="$1" rt="$2" games="$3"
    mkdir -p "$ASOPT_DIR" 2>/dev/null
    {
        asopt_header
        printf '\n'
        printf 'mode=%s\n' "$mode"
        printf 'rt=%s\n' "$rt"
        if [ -n "$games" ]; then printf '%s\n' "$games"; fi
    } > "$ASOPT_CONF"
}

do_asopt_get() {
    local n
    n="$(asopt_games | grep -c . 2>/dev/null)"
    [ -n "$n" ] || n=0
    printf '{"ok":true,"path":"%s","mode":%s,"rt":%s,"count":%s,"games":[' \
        "$(printf '%s' "$ASOPT_CONF" | json_str)" "$(asopt_cur mode)" "$(asopt_cur rt)" "$n"
    asopt_games | awk '{ printf "%s{\"pkg\":\"%s\",\"mode\":%s,\"rt\":%s}", (NR>1?",":""), $1, $2, $3 }'
    printf ']}\n'
}

do_asopt_set() {
    local mode="$1" rt="$2"
    case "$mode" in 0|1|2) ;; *) result 0 "mode 只能是 0 / 1 / 2" ;; esac
    case "$rt" in 0|1) ;; *) result 0 "rt 只能是 0 / 1" ;; esac
    asopt_write "$mode" "$rt" "$(asopt_games)"
    result 1 "AsoulOpt 全局配置已保存：mode=$mode rt=$rt"
}

do_asopt_set_game() {
    local pkg="$1" m="$2" r="$3" mode rt
    [ -n "$pkg" ] || result 0 "包名不能为空"
    case "$pkg" in *[[:space:]]*|*"#"*|*"="*) result 0 "包名不能含空格、# 或 =" ;; esac
    case "$m" in 0|1|2) ;; *) result 0 "mode 只能是 0 / 1 / 2" ;; esac
    case "$r" in 0|1) ;; *) result 0 "rt 只能是 0 / 1" ;; esac
    mode="$(asopt_cur mode)"; rt="$(asopt_cur rt)"
    asopt_games | awk -v p="$pkg" '$1 != p' > "$TMP/games.new"
    printf '%s %s %s\n' "$pkg" "$m" "$r" >> "$TMP/games.new"
    asopt_write "$mode" "$rt" "$(cat "$TMP/games.new")"
    result 1 "已设置「$pkg」：mode=$m rt=$r"
}

do_asopt_del_game() {
    local pkg="$1" mode rt
    [ -n "$pkg" ] || result 0 "包名不能为空"
    [ -s "$ASOPT_CONF" ] || result 0 "尚无 AsoulOpt 配置"
    mode="$(asopt_cur mode)"; rt="$(asopt_cur rt)"
    asopt_games | awk -v p="$pkg" '$1 != p' > "$TMP/games.new"
    asopt_write "$mode" "$rt" "$(cat "$TMP/games.new")"
    result 1 "已移除「$pkg」的单独配置"
}

# ---------------------------------------------------------------
# 已安装且受 AsoulOpt 支持的游戏
#   TSV: 包名 \t 是否已单独配置(0/1) \t 生效mode \t 生效rt
#   匹配语义与上游一致：包名【包含】关键词即命中
# ---------------------------------------------------------------
do_games() {
    local kw="$MODDIR/asoulopt_games.txt"
    [ -f "$kw" ] || return 0
    have pm || return 0

    local pkgs
    pkgs="$(pm list packages -3 2>/dev/null | sed 's/^package://' | tr -d '\r')"
    [ -n "$pkgs" ] || return 0

    asopt_games > "$TMP/ov.txt"
    local gmode grt
    gmode="$(asopt_cur mode)"; grt="$(asopt_cur rt)"

    printf '%s\n' "$pkgs" | while IFS= read -r p; do
        [ -n "$p" ] || continue
        if awk -v pkg="$p" '
                /^[[:space:]]*#/ { next }
                NF >= 1 {
                    k = $1
                    if (k != "" && index(pkg, k) > 0) { found = 1; exit }
                }
                END { exit(found ? 0 : 1) }
            ' "$kw"; then
            ov="$(awk -v pkg="$p" '$1 == pkg { print $2 " " $3; exit }' "$TMP/ov.txt")"
            if [ -n "$ov" ]; then
                printf '%s\t1\t%s\t%s\n' "$p" "${ov%% *}" "${ov##* }"
            else
                printf '%s\t0\t%s\t%s\n' "$p" "$gmode" "$grt"
            fi
        fi
    done
}

CMD="$1"; shift 2>/dev/null
case "$CMD" in
    status)          do_status ;;
    asopt-get)       do_asopt_get ;;
    asopt-set)       do_asopt_set "$1" "$2" ;;
    asopt-set-game)  do_asopt_set_game "$1" "$2" "$3" ;;
    asopt-del-game)  do_asopt_del_game "$1" ;;
    games)           do_games ;;
    *)
        printf '{"ok":false,"msg":"未知子命令：%s"}\n' "$(printf '%s' "$CMD" | json_str)"
        exit 1
        ;;
esac
