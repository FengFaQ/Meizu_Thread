# -*- coding: utf-8 -*-
"""
从 RS2.0.2daily/applist.conf 提取全部魅族(com.meizu.* / com.flyme.*)规则，
按语义重映射为彗星引擎的符号核心名。

RS 原文使用写死的 4+3+1 拓扑编号：
    0-1  -> 小核      (binder / 后台)
    2-5  -> 中大核    (渲染 / 前台主线程)
    4-5  -> 大核      (进程默认兜底)

映射到符号名（引擎按魅族21 真实 2+3+2+1 拓扑运行时展开）：
    0-1  -> e-core
    2-5  -> p-core
    4-5  -> hp-core
"""
import io, os, re, collections

SRC = r"C:\xiancheng\_sources_原始素材\RS2.0.2daily\applist.conf"
OUT = r"C:\xiancheng\创作工作\03_魅族线程_Meizu_Thread\meizu_rules.conf"

# ---- 1. 读取并筛选魅族规则（保持原文件顺序） ----
meizu_only = []
seen_keys = set()
order = []
for raw in io.open(SRC, encoding="utf-8", errors="replace"):
    line = raw.strip()
    if not line or line.startswith("#"):
        continue
    pkg = re.split(r"[={:]", line)[0].strip()
    if not (pkg.startswith("com.meizu.") or pkg.startswith("com.flyme.")):
        continue
    key = line.split("=", 1)[0].strip()
    if key in seen_keys:
        continue
    seen_keys.add(key)
    meizu_only.append(line)

# ---- 2. 目标核心重映射 ----
# 注意：进程级兜底（裸 `包名=X`）不映射为 hp-core。
# 原因：RS 原文的 4-5 是 4+3+1 拓扑下的 2 个性能核；若映射为 hp-core，
#       在魅族21(2+3+2+1) 上会展开为【单个超大核 7】，
#       89 个魅族包的其余线程全部挤到一个核上，反而引发争抢。
# 彗星官方 App_common 的进程级兜底实践是 e-core,p-core（85 处），
# 故此处同样采用 e-core,p-core，保持与底座一致。
FALLBACK = "e-core,p-core"
MAP = {"0-1": "e-core", "2-5": "p-core", "4-5": "hp-core"}


def remap(line):
    lhs, rhs = line.split("=", 1)
    lhs, rhs = lhs.strip(), rhs.strip()
    # 进程级兜底：选择器不含 {} 且不含 : 后缀
    if "{" not in lhs and ":" not in lhs:
        return lhs + "=" + FALLBACK
    if rhs in MAP:
        return lhs + "=" + MAP[rhs]
    return line  # 未预期的目标，原样保留以便人工复核

remapped = [remap(l) for l in meizu_only]

# ---- 3. 按包名分组 ----
groups = collections.OrderedDict()
for line in remapped:
    pkg = re.split(r"[={:]", line)[0].strip()
    groups.setdefault(pkg, []).append(line)

# ---- 4. 归类分组：界面 / 媒体 / 系统服务 ----
UI = {
    "com.meizu.systemui", "com.meizu.flyme.launcher", "com.meizu.customizecenter",
    "com.meizu.net.nativelockscreen", "com.meizu.setup", "com.meizu.suggestion",
    "com.meizu.picker", "com.meizu.assistant", "com.meizu.flymelab",
    "com.meizu.flyme.easylauncher", "com.flyme.systemuiex", "com.flyme.systemuitools",
    "com.flyme.systemuieditor", "com.flyme.alivewallpaper", "com.flyme.linkpc",
    "com.flyme.ability", "com.flyme.linkUnion", "com.flyme.auto.launcherflow",
    "com.flyme.auto.notificationflow",
}
MEDIA = {
    "com.meizu.media.camera", "com.meizu.media.video", "com.meizu.media.music",
    "com.meizu.media.gallery", "com.meizu.media.imageservice", "com.flyme.videoclips",
    "com.flyme.scanner", "com.meizu.media.reader", "com.meizu.media.ebook",
    "com.meizu.media.life", "com.meizu.flyme.weather", "com.meizu.net.map",
    "com.meizu.net.search", "com.meizu.net.pedometer",
}
def bucket(p):
    if p in UI:
        return 0
    if p in MEDIA:
        return 1
    return 2

buckets = collections.OrderedDict([(0, []), (1, []), (2, [])])
for pkg, lines in groups.items():
    buckets[bucket(pkg)].append((pkg, lines))

TITLES = {0: "界面与桌面", 1: "媒体与网络服务", 2: "系统服务与后台"}

# ---- 5. 输出 ----
out = io.StringIO()
out.write("# ============================================================\n")
out.write("# 魅族 (Meizu / Flyme) 专属线程规则\n")
out.write("# ============================================================\n")
out.write("# 来源：RS2.0.2daily/applist.conf 中全部 com.meizu.* / com.flyme.* 规则\n")
out.write("# 提取：完整提取，未做任何取舍\n")
out.write(f"# 规模：{len(groups)} 个包 / {len(remapped)} 条规则\n")
out.write("#\n")
out.write("# 核心映射（原 RS 使用写死的 4+3+1 拓扑编号，此处改为符号名，\n")
out.write("# 由引擎按魅族21 实测拓扑 2+3+2+1 在运行时展开）：\n")
out.write("#     原 0-1  (小核/后台)   -> e-core\n")
out.write("#     原 2-5  (中大核/渲染) -> p-core\n")
out.write("#     原 4-5  (进程级兜底)  -> e-core,p-core\n")
out.write("#       注：不映射为 hp-core。RS 的 4-5 是 4+3+1 下的 2 个性能核，\n")
out.write("#       而魅族21 的 hp-core 只展开为单个超大核(核心7)，\n")
out.write("#       89 个包的兜底线程挤到 1 个核会争抢；故与彗星底座一致用 e-core,p-core。\n")
out.write("#     线程级规则 (包名{线程}=X) 保持原映射 e/p/hp-core。\n")
out.write("#\n")
out.write("# 规则含义：\n")
out.write("#     包名{线程}=核心    指定线程绑核\n")
out.write("#     包名{包名或后15位}=核心   主线程（Android 主线程名=进程名）\n")
out.write("#     包名=核心           进程内其余线程兜底\n")
out.write("# ============================================================\n")

stat = collections.Counter()
for b in (0, 1, 2):
    if not buckets[b]:
        continue
    out.write(f"\n\n# ---------- {TITLES[b]} ----------\n")
    for pkg, lines in buckets[b]:
        out.write("\n")
        for l in lines:
            out.write(l + "\n")
            stat[l.split("=", 1)[1].strip()] += 1

with io.open(OUT, "w", encoding="utf-8", newline="\n") as f:
    f.write(out.getvalue())

print(f"packages: {len(groups)}")
print(f"rules   : {len(remapped)}")
print("target distribution:", dict(stat))

# sanity: any unmapped leftovers?
leftover = [l for l in remapped if l.split('=',1)[1].strip() not in ("e-core","p-core","hp-core")]
print("unmapped:", leftover[:10] if leftover else "none")
