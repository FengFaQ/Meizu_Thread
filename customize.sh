SKIPUNZIP=0

# ============================================================
# 魅族线程 (Meizu Thread) v3.0 安装脚本
#
# 与 v2.0 的区别：本版不再自带线程引擎，
#   · 用户线程 → 写入 Scene（com.omarea.vtools）的 threads.json，由 Scene 生效
#   · 游戏线程 → 由捆绑的 AsoulOpt 负责（其逻辑一字未改，只是安装位置
#                由 /data/adb/modules/asoul_affinity_opt 移到本模块的 asoulopt/ 子目录）
#
# 全自动安装，无任何交互询问。
# ============================================================

MODID=Meizu_Thread
NAKI_DIR=/data/adb/naki
ASOPT_CONF="$NAKI_DIR/asopt.conf"

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

# Scene 是本模块「用户线程」的实际执行者，没装则配置无处生效
check_scene() {
    ui_print "********************************************"
    if command -v pm >/dev/null 2>&1 && pm list packages 2>/dev/null | grep -q "com.omarea.vtools"; then
        ui_print "- 已检测到 Scene (com.omarea.vtools)"
    else
        ui_print "! 未检测到 Scene (com.omarea.vtools)"
        ui_print "! 「用户线程」会把配置写入 Scene 的 threads.json，"
        ui_print "! 未安装 Scene 时该部分不会生效（游戏线程不受影响）"
    fi
}

# 生成 AsoulOpt 的配置文件
# 内容格式与上游 customize.sh 生成的一致（同样的说明注释 + mode= / rt= + 每游戏覆盖）
# 仅在文件不存在时创建，绝不覆盖用户已有配置
ensure_asopt_conf() {
    mkdir -p "$NAKI_DIR" 2>/dev/null
    if [ -f "$ASOPT_CONF" ]; then
        ui_print "- AsoulOpt 配置已存在，保留不覆盖：$ASOPT_CONF"
        return 0
    fi
    cat > "$ASOPT_CONF" << 'ASOPTEOF'
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

mode=0
rt=0
ASOPTEOF
    ui_print "- 已生成 AsoulOpt 默认配置：$ASOPT_CONF"
}

# 捆绑的 AsoulOpt 需要可执行
prepare_asoulopt() {
    if [ -f "$MODPATH/asoulopt/AsoulOpt" ]; then
        set_perm "$MODPATH/asoulopt/AsoulOpt" 0 0 0755
        set_perm "$MODPATH/asoulopt/service.sh" 0 0 0755
        ui_print "- AsoulOpt 已就位：$MODPATH/asoulopt/"
    else
        ui_print "! 警告：缺少 asoulopt/AsoulOpt，游戏线程将不可用"
    fi
}

module_instructions() {
    ui_print "********************************************"
    ui_print "- 安装完成"
    ui_print "- 请在 KernelSU 中点击本模块的【WebUI】按钮："
    ui_print "    · 用户线程：编辑 Scene 的线程核心分配（已预置魅族线程默认值）"
    ui_print "    · 游戏线程：AsoulOpt 游戏清单与 mode / rt 设置"
    ui_print "********************************************"
    ui_print "用户线程配置: /data/user/0/com.omarea.vtools/files/threads.json"
    ui_print "默认用户线程: /data/adb/modules/$MODID/default_threads.json"
    ui_print "游戏线程配置: $ASOPT_CONF"
    ui_print "捆绑 AsoulOpt: /data/adb/modules/$MODID/asoulopt/"
    ui_print "********************************************"
}

check_magisk_version
check_required_files
check_scene
ensure_asopt_conf
prepare_asoulopt
module_instructions

set_perm_recursive "$MODPATH" 0 0 0755 0644
for SCRIPT in "$MODPATH"/*.sh; do
    [ -f "$SCRIPT" ] && set_perm "$SCRIPT" 0 2000 0755 u:object_r:magisk_file:s0
done
[ -d "$MODPATH/asoulopt" ] && set_perm_recursive "$MODPATH/asoulopt" 0 0 0755 0755
[ -d "$MODPATH/webroot" ] && set_perm_recursive "$MODPATH/webroot" 0 0 0755 0644
