# 魅族线程 (Meizu Thread)

为 **魅族 21（骁龙 8 Gen 3）** 量身定制的线程绑核模块，
基于 **Comet Thread Opt（彗星线程）** 构建，附带 **图形化 WebUI**。

> 适配管理器：**KernelSU / KernelSU-Next / APatch**（提供原生 WebUI）。
> Magisk 无 WebUI 机制，但仍可用模块「操作」按钮应用配置。

## 组成

模块由三个可独立开关的部分组成，全部在 WebUI 中配置：

| 部分 | 说明 | 默认 |
|---|---|---|
| **彗星底座** | 日用应用线程规则，来自 Comet Thread Opt | 开启 |
| **魅族专属** | `com.meizu.*` / `com.flyme.*` 全量规则（89 包 / 265 条） | 开启 |
| **AsoulOpt** | 333 款游戏的线程规则（独立栏目） | 开启 |

## 安装

1. 通过 **KernelSU / KernelSU-Next / APatch**（或 Magisk）刷入 zip
2. **全自动安装，无任何询问** —— 默认启用全部三项
3. 安装后在管理器中点击本模块的 **【WebUI】** 按钮进行图形化配置

## WebUI

### 总览

- **规则统计**：规则总数 / 底座 / 魅族 / AsoulOpt / 自定义- **实测拓扑**：把符号核心名还原为**本机真实 CPU 号**，例如

  | 符号 | 魅族 21 实测展开 |
  |---|---|
  | `e-core` | 能效小核 |
  | `p-core` | 性能中核 |
  | `hp-core` | 高性能大核 |
  | `all-core` | 全部核心 |

- **开关**（写入 `confige.txt`）：

  | 键 | 取值 | 默认 | 说明 |
  |---|---|---|---|
  | `meizu` | `on` / `off` | `on` | 是否加载魅族专属规则 |
  | `asoul` | `on` / `off` | `on` | 是否加载 AsoulOpt 游戏规则 |
  | `8G3` | `on` / `off` | 自动 | 底座用 8G3 档还是通用档 |
  | `interval` | `1`–`3600` | `2` | 引擎扫描间隔秒数（`-s`） |
  | `cpuset_name` | 字符串 | `AkiAppOpt` | cpuset 目录名（`-b`） |

- **应用配置**：按当前开关重新生成 `applist.conf`（**纯本地，无需联网**）
- **在线更新规则**：从 GitHub 拉取最新规则源文件后自动重新应用

### 引擎（上游配置项）

上游两个项目的可调项原本只存在于二进制命令行与注释里，现已全部纳入 WebUI。

**AkiAppOpt 引擎参数**（来自二进制的 `getopt` 串 `c:s:b:hv`）：

| 选项 | 含义 | 上游默认 | 说明 |
|---|---|---|---|
| `-c` | 规则文件 | `./applist.conf` | 由模块固定为 `applist.conf` |
| `-s <秒>` | **扫描间隔** | **2** | 范围 1–3600，越小越灵敏、越耗电 |
| `-b <名字>` | **cpuset 目录名** | **AkiAppOpt** | 对应 `/dev/cpuset/<名字>/` |

> `-s` / `-b` 写入 `confige.txt`，由 `service.sh` 启动时读取并传给引擎；
> WebUI 保存后会**重启引擎**使其立即生效。

**AsoulOpt 运行模式**（上游 nakixii 模块，配置文件 `/data/adb/naki/asopt.conf`）：

| 键 | 取值 | 说明 |
|---|---|---|
| `mode` | `0` / `1` / `2` | 0 硬亲和（理论更好）· 1 软迁移（帧率可能更稳）· 2 硬迁移（帧率可能更稳） |
| `rt` | `0` / `1` | 0 调度器默认 · 1 实时模式（可能更流畅，**但可能导致卡死**） |
| `<包名> <mode> <rt>` | 每行一个 | **每游戏单独覆盖**，未列出的用全局值 |

> WebUI 生成的 `asopt.conf` 与上游 `customize.sh` 的格式**完全一致**
> （含同样的说明注释），可直接与官方 AsoulOpt 模块共用。
> 若未安装官方 AsoulOpt 模块，页面会明确提示——本模块已用 AsoulOpt 规则段接管游戏线程。

### 自定义线程

为**任意应用**（无论是否已被内置规则适配）自由调整绑核：

- 搜索或手动输入包名进入应用详情
- 查看该应用当前生效的全部线程规则（标注「内置」/「自定义」）
- 新增 / 修改 / 删除规则；留空线程名表示**进程级兜底**
- 「填入主线程名（后 15 位）」一键规避内核 `TASK_COMM_LEN-1` 截断
- 「还原该应用内置」清除该应用的全部自定义规则

**覆盖语义**：自定义规则会被放在规则文件**最前面**，同时
**剔除内置规则中同选择器的行**，因此每个选择器在全文件中唯一，
自定义必然生效，且不依赖引擎对重复规则的处理方向。

> 校验：非法核心名、超过 15 字符的线程名会被拒绝并提示。

### 备份 / 导入

- **导出**：写入 `/sdcard/Download/Meizu_Thread_backup_<时间>.txt`
  （含开关状态与全部自定义规则），同时在页面显示内容便于复制
- **导入**：粘贴备份内容即可恢复
- **清空全部自定义**：一键回到纯内置行为
- 升级安装时**自动保留**原有自定义规则

## 文件说明

| 文件 | 说明 |
|---|---|
| `out/Meizu_Thread_2.0.zip` | **已构建好的可刷入包**（归档，直接下载即用） |
| `webroot/` | WebUI 前端（`index.html` / `style.css` / `app.js`） |
| `webui.sh` | WebUI 后端（纯 POSIX sh，root 执行） |
| `custom_rules.tsv` | 用户自定义线程规则（WebUI 维护） |
| `confige.txt` | 开关与设备配置 |
| `applist.conf` | 最终生效的线程规则（由 `webui.sh apply` 生成） |
| `meizu_rules.conf` | 魅族专属规则源文件 |
| `asoulopt_rules.conf` | AsoulOpt 游戏规则源文件 |
| `base/App_8G3.txt` | 彗星底座（8G3 档） |
| `base/App_common.txt` | 彗星底座（通用档） |
| `action.sh` | 模块「操作」按钮入口（终端回退方案） |
| `customize.sh` | 安装脚本 |
| `service.sh` | 开机启动脚本 |
| `tools/` | 可复现的构建脚本 |

## 规则语法

```
包名{线程名}=核心          指定线程绑核
包名=核心                  进程内其余线程兜底
```

包名支持 `*` `?` `[]` 通配符。核心可用**符号名**，由引擎按设备实测拓扑在运行时展开：

- `e-core` / `p-core` / `hp-core` / `all-core`
- 可组合，如 `p-core,hp-core`

> 线程名遵循内核 `TASK_COMM_LEN-1 = 15` 字符截断。
> 包名超过 15 字符时，主线程规则须写包名的**后 15 位**
> （如 `com.meizu.flyme.launcher` → `.flyme.launcher`）。

## 验证运行状态

模块内置自检脚本，在设备上以 **root** 运行：

```sh
# 总览 + 自动抽样（挑最多 3 个正在运行且带规则的应用）
su -c sh /data/adb/modules/Meizu_Thread/check.sh

# 详查某个应用（逐线程列出实际绑核与期望值）
su -c sh /data/adb/modules/Meizu_Thread/check.sh com.tencent.mm
```

它会依次检查：

| 节 | 检查内容 | 通过标准 |
|---|---|---|
| 1 | 权限、模块文件、规则数 | AppOpt 可执行、applist.conf 存在 |
| 2 | AppOpt 进程 | **运行中** |
| 3 | 日志中的规则丢弃告警 | 「无效 CPU 范围」「无有效 CPU」均为 **0** |
| 4 | 拓扑探测与符号展开 | 与机型预期一致（魅族 21 为 `2+3+2+1`） |
| 5 | cpuset 目录结构与任务数 | 能列出各 CPU 组合目录 |
| 6 | **实测线程绑核** | 「异常」为 0 |

第 6 节是**决定性的**：线程绑核的唯一事实是
`/proc/<tid>/status` 的 `Cpus_allowed_list`，脚本把它与该线程按
`applist.conf` 应得的规则做对照，并附带 `/proc/<tid>/cpuset`
来判断**是谁在约束它**：

| 现象 | 含义 |
|---|---|
| 实际 = 期望 | ✅ 正常 |
| 实际 ≠ 期望，`cpuset=/AkiAppOpt/...` | 引擎生效但结果不符，请反馈 |
| 实际 ≠ 期望，`cpuset=/top-app` 等 | 被 Android 自身 cpuset 覆盖 |
| 实际 = 全部核心 | 规则未匹配到该线程 |

> 脚本也可在 PC 上验证自身逻辑：`sh check.sh --selftest`（22 项）。

## 命令行（可选）

WebUI 的全部功能也可直接调用：

```sh
sh /data/adb/modules/Meizu_Thread/webui.sh status          # 状态（JSON）
sh /data/adb/modules/Meizu_Thread/webui.sh apply           # 重新生成规则
sh /data/adb/modules/Meizu_Thread/webui.sh apps            # 应用清单
sh /data/adb/modules/Meizu_Thread/webui.sh set-rule 包名 线程名 核心
sh /data/adb/modules/Meizu_Thread/webui.sh export          # 导出备份
```

## 自检

`tools/test_webui.sh` 会在**临时副本**上跑一遍后端全流程
（生成规则、覆盖、增删改、备份往返、开关切换等 27 项），不会改动仓库文件：

```sh
sh tools/test_webui.sh
```

其中「规则体与仓库基线逐字节比对」一项，可确保改动后端后
生成的规则仍与既有发布包**完全一致**。

## 发布包下载

```
https://raw.githubusercontent.com/FengFaQ/Meizu_Thread/main/out/Meizu_Thread_2.0.zip
```

## 反馈

提交 Issue 请附上：游戏/应用包名、线程负载截图、`/proc/<pid>/task/*/comm` 列表。

## 致谢

见 [致谢名单.md](致谢名单.md)。
