# 魅族线程 (Meizu Thread)

为 **魅族 21（骁龙 8 Gen 3）** 量身定制的 Magisk 线程分配模块。

## 组成

模块由三个可独立开关的部分组成，通过 WebUI（模块操作按钮）配置：

| 部分 | 说明 | 默认 |
|---|---|---|
| **彗星底座** | 日用应用线程规则，来自 Comet Thread Opt | 开启 |
| **魅族专属** | `com.meizu.*` / `com.flyme.*` 全量规则（89 包 / 265 条） | 开启 |
| **AsoulOpt** | 333 款游戏的线程规则（独立栏目） | 开启 |

## 安装

1. 通过 Magisk / KernelSU 刷入 zip
2. **全自动安装，无任何询问** —— 默认启用全部三项
   （游戏线程已由 AsoulOpt 承担，故不再询问是否使用游戏线程）
3. 安装后在 Magisk 中点击模块的**操作**按钮可随时重新拉取配置

> 如需关闭某一项，编辑 `/data/adb/modules/Meizu_Thread/confige.txt`
> 或安装后直接修改，再点击操作按钮生效。

## WebUI 配置项

模块操作按钮会读取 `confige.txt`：

| 键 | 取值 | 默认 | 说明 |
|---|---|---|---|
| `meizu` | `on` / `off` | `on` | 是否加载魅族专属规则 |
| `asoul` | `on` / `off` | `on` | 是否加载 AsoulOpt 游戏规则 |
| `8G3` | `on` / `off` | 自动 | 底座使用 8G3 档还是通用档 |

修改 `confige.txt` 后点击操作按钮即可按新配置重新生成 `applist.conf`。

## 文件说明

| 文件 | 说明 |
|---|---|
| `out/Meizu_Thread_1.0.zip` | **已构建好的可刷入包**（归档，直接下载即用） |
| `applist.conf` | 最终生效的线程规则（由 action.sh 生成） |
| `meizu_rules.conf` | 魅族专属规则源文件 |
| `asoulopt_rules.conf` | AsoulOpt 游戏规则源文件 |
| `base/App_8G3.txt` | 彗星底座（8G3 档） |
| `base/App_common.txt` | 彗星底座（通用档） |
| `confige.txt` | 用户配置 |
| `action.sh` | WebUI / 配置更新脚本 |
| `customize.sh` | 安装脚本 |
| `service.sh` | 开机启动脚本 |
| `tools/` | 可复现的构建脚本 |

## 发布包下载

```
https://raw.githubusercontent.com/FengFaQ/Meizu_Thread/main/out/Meizu_Thread_1.0.zip
```

## 规则语法

```
包名{线程名}=核心          指定线程绑核
包名=核心                  进程内其余线程兜底
```

核心可用**符号名**（引擎按设备实测拓扑在运行时展开）：

| 符号 | 魅族21 (2+3+2+1) 实际展开 |
|---|---|
| `e-core` | 能效小核 |
| `p-core` | 性能中核 |
| `hp-core` | 高性能大核 |
| `all-core` | 全部核心 |

> 线程名遵循内核 `TASK_COMM_LEN-1 = 15` 字符截断。
> 包名超过 15 字符时，主线程规则须写包名的**后 15 位**
> （如 `com.meizu.flyme.launcher` → `.flyme.launcher`）。

## 反馈

提交 Issue 请附上：游戏/应用包名、线程负载截图、`/proc/<pid>/task/*/comm` 列表。

## 致谢

见 [致谢名单.md](致谢名单.md)。
