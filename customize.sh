SKIPUNZIP=0

# ============================================================
# 魅族线程 (Meizu Thread) 安装脚本
#
# 设计：全自动安装，无任何交互询问。
#   - 目标机型固定为魅族21(骁龙8Gen3)，无需选档
#   - 魅族专属规则为本模块核心，默认启用
#   - 游戏线程由 AsoulOpt 承担，默认启用（不再询问是否使用游戏线程）
#   - 如需更改，安装后在 WebUI(confige.txt) 中调整
# ============================================================

check_magisk_version() {
    ui_print "- Magisk version: $MAGISK_VER_CODE"
    ui_print "- Module version: $(grep_prop version "$TMPDIR/module.prop")"
    ui_print "- Module versionCode: $(grep_prop versionCode "$TMPDIR/module.prop")"
    ui_print "********************************************"
    ui_print "- $(grep_prop description "$TMPDIR/module.prop")"
    if [ "$MAGISK_VER_CODE" -lt 20400 ]; then
        ui_print "********************************************"
        ui_print "! 请安装 Magisk v20.4+ (20400+)"
        abort "********************************************"
    fi
}

check_required_files() {
    for REQUIRED_FILE in /sys/devices/system/cpu/present /proc/loadavg; do
        if [ ! -e "$REQUIRED_FILE" ]; then
            ui_print "********************************************"
            ui_print "! $REQUIRED_FILE 文件不存在"
            abort "! 请联系模块作者"
        fi
    done
}

extract_bin() {
    ui_print "********************************************"
    case "$ARCH" in
        arm) SOURCE_BIN="$MODPATH/bin/armeabi-v7a/AppOpt" ;;
        arm64) SOURCE_BIN="$MODPATH/bin/arm64-v8a/AppOpt" ;;
        x64) SOURCE_BIN="$MODPATH/bin/x86_64/AppOpt" ;;
        *) abort "! Unsupported platform: $ARCH" ;;
    esac

    ui_print "- Device platform: $ARCH"
    [ -f "$SOURCE_BIN" ] || abort "! 当前架构缺少 AppOpt 二进制文件"
    cp "$SOURCE_BIN" "$MODPATH/AppOpt"
    rm -rf "$MODPATH/bin"
    chmod a+x "$MODPATH/AppOpt"
    "$MODPATH/AppOpt" -v || abort "! 主程序验证失败，请检查模块 zip 文件是否损坏"
}

# 探测底座档位（8G3 走 8G3 规则，其余走通用规则）
# 不询问用户，纯自动判定
detect_soc_profile() {
    SOC_MODEL=$(getprop ro.soc.model)
    SOC_PLATFORM=$(getprop ro.board.platform)
    SOC_HARDWARE=$(getprop ro.hardware)
    SOC_ID=$(printf '%s %s %s' "$SOC_MODEL" "$SOC_PLATFORM" "$SOC_HARDWARE" | tr '[:upper:]' '[:lower:]')

    case "$SOC_ID" in
        *sm8650*|*pineapple*)
            SOC_8G3=on
            BASE_NAME=8G3
            ;;
        *)
            SOC_8G3=off
            BASE_NAME=Common
            ;;
    esac

    ui_print "********************************************"
    ui_print "- SoC model: ${SOC_MODEL:-unknown}"
    ui_print "- SoC platform: ${SOC_PLATFORM:-unknown}"
    ui_print "- 彗星底座: $BASE_NAME"
}

# 写入默认配置（全部默认启用，无交互）
write_config() {
    TIME_AREA=$(getprop persist.sys.timezone)
    [ -n "$TIME_AREA" ] || TIME_AREA=UTC
    UTC_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    cat > "$MODPATH/confige.txt" << configEOF
meizu=on
asoul=on
8G3=$SOC_8G3
soc_model=$SOC_MODEL
soc_platform=$SOC_PLATFORM
time_area=$TIME_AREA
time=$UTC_TIME
configEOF

    sed -i "/^description=/ s|^description=.*|description=魅族线程 $BASE_NAME 魅族:On Asoul:On|" "$MODPATH/module.prop"
    ui_print "- 彗星底座: $BASE_NAME"
    ui_print "- 魅族专属规则: 开启"
    ui_print "- AsoulOpt 游戏规则: 开启"
}

# 升级安装时：仅继承用户的【开关状态】，其余（SoC 档位/时间）用本次探测值覆盖
# 修正原彗星脚本直接整体覆盖 confige.txt 的问题——
# 那样会导致换机或更新规则后档位仍是旧值
merge_existing_config() {
    OLD_CONFIG=/data/adb/modules/Meizu_Thread/confige.txt
    [ -f "$OLD_CONFIG" ] || return 0

    for KEY in meizu asoul; do
        VAL=$(grep -E "^${KEY}=" "$OLD_CONFIG" 2>/dev/null | head -n1 | cut -d= -f2- | tr -d '\r\n')
        case "$VAL" in
            on|off) sed -i "s|^${KEY}=.*|${KEY}=${VAL}|" "$MODPATH/confige.txt" ;;
        esac
    done

    ui_print "- 已继承现有开关设置 (meizu/asoul)"

    MZ=$(grep -E "^meizu=" "$MODPATH/confige.txt" | cut -d= -f2)
    AS=$(grep -E "^asoul=" "$MODPATH/confige.txt" | cut -d= -f2)
    MZ_NAME=Off; [ "$MZ" = "on" ] && MZ_NAME=On
    AS_NAME=Off; [ "$AS" = "on" ] && AS_NAME=On
    sed -i "/^description=/ s|^description=.*|description=魅族线程 $BASE_NAME 魅族:${MZ_NAME} Asoul:${AS_NAME}|" "$MODPATH/module.prop"
}

module_instructions() {
    ui_print "********************************************"
    ui_print "- 安装完成，无需额外设置"
    ui_print "线程规则: /data/adb/modules/Meizu_Thread/applist.conf"
    ui_print "设备配置: /data/adb/modules/Meizu_Thread/confige.txt"
    ui_print "cpuset目录: /dev/cpuset/AkiAppOpt"
    ui_print "修改规则无需重启，会自动热加载"
    ui_print "如需调整开关，点击模块操作按钮"
    ui_print "********************************************"
}

check_magisk_version
check_required_files
extract_bin
detect_soc_profile
write_config
merge_existing_config
module_instructions

set_perm_recursive "$MODPATH" 0 0 0755 0644
for SCRIPT in "$MODPATH"/*.sh; do
    [ -f "$SCRIPT" ] && set_perm "$SCRIPT" 0 2000 0755 u:object_r:magisk_file:s0
done
set_perm "$MODPATH/AppOpt" 0 2000 0755 u:object_r:magisk_file:s0
