# -*- coding: utf-8 -*-
"""
构建魅族线程 Magisk 模块 zip

打包内容：
    applist.conf（预生成，避免首次使用需联网）
    meizu_rules.conf / asoulopt_rules.conf（供 WebUI 重新拉取）
    base/（彗星底座源文件）
    action.sh / customize.sh / service.sh / module.prop / confige.txt
    bin/<arch>/AppOpt
    META-INF/...

排除：.git / 构建脚本 / README 等仓库文件
"""
import io, os, zipfile, sys, shutil

REPO = r"C:\xiancheng\创作工作\03_魅族线程_Meizu_Thread"
OUTDIR = r"C:\xiancheng\创作工作\04_魅族适配_产出物"
# 归档目录（两个）：
#   1) 本地项目根 out/      —— 方便本地随时取用
#   2) 仓库内 out/          —— 随 git 推送，可直接用 raw 链接下载
LOCAL_OUT = r"C:\xiancheng\out"
ARCHIVE_DIR = os.path.join(REPO, "out")
VERSION = "3.0"
ZIPNAME = f"Meizu_Thread_{VERSION}.zip"

# zip 内需要包含的条目（v3.0：Scene 线程编辑器 + 捆绑 AsoulOpt，无自带引擎）
INCLUDE_FILES = [
    "module.prop",
    "webui.sh",
    "service.sh",
    "customize.sh",
    "default_threads.json",
    "asoulopt_games.txt",
    "致谢名单.md",
]
INCLUDE_DIRS = ["META-INF", "webroot", "asoulopt"]

# 不应进 zip 的
EXCLUDE_NAMES = {".git", ".gitignore", "README.md", "update.json", "changelog.md", "__pycache__"}

os.makedirs(OUTDIR, exist_ok=True)
zippath = os.path.join(OUTDIR, ZIPNAME)
if os.path.exists(zippath):
    os.remove(zippath)

added = 0
with zipfile.ZipFile(zippath, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    # 顶层文件
    for f in INCLUDE_FILES:
        p = os.path.join(REPO, f)
        if not os.path.isfile(p):
            print(f"  !! 缺失: {f}")
            continue
        z.write(p, f)
        added += 1

    # 目录
    for d in INCLUDE_DIRS:
        root = os.path.join(REPO, d)
        if not os.path.isdir(root):
            print(f"  !! 缺失目录: {d}")
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [x for x in dirnames if x not in EXCLUDE_NAMES]
            for fn in filenames:
                if fn in EXCLUDE_NAMES:
                    continue
                full = os.path.join(dirpath, fn)
                rel = os.path.relpath(full, REPO).replace("\\", "/")
                z.write(full, rel)
                added += 1

size = os.path.getsize(zippath)
print(f"\n生成: {zippath}")
print(f"条目: {added}")
print(f"大小: {size:,} 字节 ({size/1024:.1f} KB)")

# 列出内容清单
print("\n=== zip 内容 ===")
with zipfile.ZipFile(zippath) as z:
    for n in sorted(z.namelist()):
        info = z.getinfo(n)
        print(f"  {info.file_size:>9,}  {n}")

# ---- 同步到两个归档目录 ----
# 1) 本地项目根 out/（方便本地取用）
# 2) 仓库内 out/（随 git 推送）
print("\n=== 归档 ===")
for label, d in (("本地", LOCAL_OUT), ("仓库", ARCHIVE_DIR)):
    os.makedirs(d, exist_ok=True)
    dest = os.path.join(d, ZIPNAME)
    shutil.copy2(zippath, dest)
    print(f"  [{label}] {dest}")
    print(f"         {os.path.getsize(dest):,} 字节")
