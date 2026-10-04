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

- **规则统计**：规则总数 / 底座 / 魅族 / AsoulOpt / 自定义
- **实测拓扑**：把符号核心名还原为**本机真实 CPU 号**，例如

  | 符号 | 魅族 21 实测展开 |
  |---|---|
  | `e-core` | 能效小核 |
  | `p-core` | 性能中核 |
  | `hp-core` | 高性能大核 |
  | `all-core` | 全部核心 |

- **开关**：

  | 键 | 取值 | 默认 | 说明 |
  |---|---|---|---|
  | `meizu` | `on` / `off` | `on` | 是否加载魅族专属规则 |
  | `asoul` | `on` / `off` | `on` | 是否加载 AsoulOpt 游戏规则 |
  | `8G3` | `on` / `off` | 自动 | 底座用 8G3 档还是通用档 |

- **应用配置**：按当前开关重新生成 `applist.conf`（**纯本地，无需联网**）
- **在线更新规则**：从 GitHub 拉取最新规则源文件后自动重新应用

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

## 命令行（可选）

WebUI 的全部功能也可直接调用：

```sh
sh /data/adb/modules/Meizu_Thread/webui.sh status          # 状态（JSON）
sh /data/adb/modules/Meizu_Thread/webui.sh apply           # 重新生成规则
sh /data/adb/modules/Meizu_Thread/webui.sh apps            # 应用清单
sh /data/adb/modules/Meizu_Thread/webui.sh set-rule 包名 线程名 核心
sh /data/adb/modules/Meizu_Thread/webui.sh export          # 导出备份
```

## 发布包下载

```
https://raw.githubusercontent.com/FengFaQ/Meizu_Thread/main/out/Meizu_Thread_2.0.zip
```

## 反馈

提交 Issue 请附上：游戏/应用包名、线程负载截图、`/proc/<pid>/task/*/comm` 列表。

## 致谢

见 [致谢名单.md](致谢名单.md)。
