# -*- coding: utf-8 -*-
"""
从上游 nakixii/Magisk_AsoulOpt 的 README.md 提取「支持的游戏」关键词列表，
生成 asoulopt_games.txt（供 WebUI 的「游戏线程」页匹配已安装游戏）。

上游语义（README 原文）：
    如果包名**包含**以下任意一项（即使是不完整匹配），那么就支持该游戏。
    If the package name contains any of the following entries (includes
    incomplete matches), the game is supported.
"""
import io, os, re, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
README = r"C:\xiancheng\创作工作\02_游戏线程_Magisk_AsoulOpt\README.md"
OUT = os.path.join(REPO, "asoulopt_games.txt")


def main():
    if not os.path.isfile(README):
        sys.exit("缺少上游 README: %s" % README)

    text = io.open(README, encoding="utf-8").read()
    # 取第一个围栏代码块
    m = re.search(r"```\s*\n(.*?)\n```", text, re.S)
    if not m:
        sys.exit("未在 README 中找到关键词代码块")

    entries = []
    for line in m.group(1).splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        entries.append(s)

    seen, uniq = set(), []
    for e in entries:
        if e not in seen:
            seen.add(e)
            uniq.append(e)

    with io.open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("# AsoulOpt 支持的游戏关键词（来自上游 README.md）\n")
        f.write("# 包名【包含】其中任意一项即视为受支持\n")
        for e in uniq:
            f.write(e + "\n")

    print("关键词条数: %d" % len(uniq))
    print("已写入: %s" % OUT)


if __name__ == "__main__":
    main()
