SKIPUNZIP=0

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

# 音量键位选择：上=开 / 下=关
ask_toggle() {
    local prompt="$1"

    ui_print "********************************************"
    ui_print "- $prompt"
    ui_print "  音量上 = 开启   音量下 = 关闭"
    ui_print "********************************************"

    while true; do
        EVENT=$(getevent -lqt 2>&1 | head -1)
        if echo "$EVENT" | grep -q "KEY_VOLUMEUP"; then
            echo "on"; return
        elif echo "$EVENT" | grep -q "KEY_VOLUMEDOWN"; then
            echo "off"; return
        fi
        sleep 0.1
    done
}

setup_config() {
    MEIZU_VAL=$(ask_toggle "启用魅族专属规则？(com.meizu.* / com.flyme.*)")
    ASOUL_VAL=$(ask_toggle "启用 AsoulOpt 游戏规则？(333 款游戏)")

    TIME_AREA=$(getprop persist.sys.timezone)
    [ -n "$TIME_AREA" ] || TIME_AREA=UTC
    UTC_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    cat > "$MODPATH/confige.txt" << configEOF
meizu=$MEIZU_VAL
asoul=$ASOUL_VAL
8G3=$SOC_8G3
soc_model=$SOC_MODEL
soc_platform=$SOC_PLATFORM
time_area=$TIME_AREA
time=$UTC_TIME
configEOF

    MZ_NAME=Off; [ "$MEIZU_VAL" = "on" ] && MZ_NAME=On
    AS_NAME=Off; [ "$ASOUL_VAL" = "on" ] && AS_NAME=On

    sed -i "/^description=/ s|^description=.*|description=魅族线程 $BASE_NAME 魅族:${MZ_NAME} Asoul:${AS_NAME}|" "$MODPATH/module.prop"
    ui_print "- 彗星底座: $BASE_NAME / 魅族: $MZ_NAME / AsoulOpt: $AS_NAME"
}

preserve_existing_config() {
    OLD_CONFIG=/data/adb/modules/Meizu_Thread/confige.txt
    if [ -f "$OLD_CONFIG" ]; then
        cp "$OLD_CONFIG" "$MODPATH/confige.txt"
        ui_print "- 已保留现有 confige.txt"
    fi
}

module_instructions() {
    ui_print "********************************************"
    ui_print "线程规则: /data/adb/modules/Meizu_Thread/applist.conf"
    ui_print "设备配置: /data/adb/modules/Meizu_Thread/confige.txt"
    ui_print "cpuset目录: /dev/cpuset/AkiAppOpt"
    ui_print "修改规则无需重启，会自动热加载"
    ui_print "安装后可点击模块操作按钮重新拉取配置"
    ui_print "********************************************"
}

check_magisk_version
check_required_files
extract_bin
detect_soc_profile
setup_config
preserve_existing_config
module_instructions

set_perm_recursive "$MODPATH" 0 0 0755 0644
for SCRIPT in "$MODPATH"/*.sh; do
    [ -f "$SCRIPT" ] && set_perm "$SCRIPT" 0 2000 0755 u:object_r:magisk_file:s0
done
set_perm "$MODPATH/AppOpt" 0 2000 0755 u:object_r:magisk_file:s0
