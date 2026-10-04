#!/system/bin/sh
# ============================================================
# 魅族线程 v3.0 —— 开机脚本
#
# 本版只负责拉起**捆绑的 AsoulOpt**（游戏线程）。
# 用户线程由 Scene 自行读取它的 threads.json，不需要本脚本干预。
#
# ⚠️ asoulopt/service.sh 是上游原文件，**一字未改**；
#    它用 ${0%/*} 定位自身目录，因此把它放在本模块的 asoulopt/ 子目录下
#    即可正常找到同目录的 AsoulOpt 二进制。
# ============================================================

MODDIR="${0%/*}"
ASOULOPT="$MODDIR/asoulopt"

[ -x "$ASOULOPT/AsoulOpt" ] || exit 0

# 交给上游脚本执行（含 core_ctl / migt 参数写入、等待 /data/data、启动进程）
exec sh "$ASOULOPT/service.sh"
