# DeepSeek Harness Desktop (Electron)

[![Electron](https://img.shields.io/badge/Electron-34-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-brightgreen.svg)]()

现代化、开箱即用的 **DeepSeek Harness (DSH)** 桌面客户端，基于 **Supervisor 进程守护架构** 构建，完美适配最新 `@deepseek-ai/dsh` (0.1.2-alpha.3+) 与 Node.js 24。

---

## ✨ 核心特性

- 🛡️ **纯粹解耦架构 (Supervisor Architecture)**
  - 核心数据与插件严格锚定系统的 `$DSH_HOME` (`~/.dsh`)，绝不将 DSH 暴力打包入只读 ASAR。
  - **100% 兼容插件生态**：在终端通过 `dsh plugin --profile web add/remove` 安装或卸载插件、本地 `link:` 软链插件完全照常工作。
- 🍎 **沉浸式 macOS 窗口体验**
  - 采用 macOS 现代无边框一体化标题栏 (`hiddenInset`)。
  - **智能交通灯避让**：侧边栏品牌行自动规避左上角红黄绿三色控制按钮，留出舒适的呼吸空白。
  - **全场景顶部拖拽**：在已有会话及「新会话（New Session）」无 Header 状态下，顶部均自适应生成原生透明拖拽判定区，同时完美避开右上角面板按钮，兼顾拖拽与点击。
- ⚡ **动态端口与免密认证**
  - 后台以 `--port 0 --no-open` 启动，由操作系统动态分配空闲端口，绝不与本地已有的 3080 端口冲突。
  - 启动后自动捕获 Launch Token 并注入会话 Cookie，无需手动复制 Token 登录。
- 🔄 **一键优雅重启 (`Cmd + Shift + R`)**
  - 插件增删或配置变更后，在应用内按下快捷键即可平滑向后端发送 `SIGTERM` 刷盘退出并秒级拉起，无需手写重启脚本。
- 🪟 **跨平台就绪**
  - 支持 macOS (Apple Silicon arm64 / Intel x64) 与 Windows (NSIS x64)。

---

## 🚀 快速开始

### 前置要求

- [Node.js](https://nodejs.org/) >= 20 (推荐 Node 24)
- [pnpm](https://pnpm.io/) >= 9
- 全局安装有 `@deepseek-ai/dsh` (`npm i -g @deepseek-ai/dsh`)

### 1. 安装依赖

```bash
pnpm install
```

### 2. 开发与实时预览

```bash
pnpm start
```

### 3. 构建打包

#### macOS (.dmg & .zip)
```bash
pnpm run build:mac
# 或者仅生成 dmg 安装镜像：
pnpm run build:dmg
```
构建产物将保存在 `dist/` 目录下（如 `DeepSeek Harness-0.1.2-arm64.dmg`）。

#### Windows (.exe)
```bash
pnpm run build:win
```

---

## 📐 架构设计

```text
+-------------------------------------------------------------+
|                 Electron Main Process (Supervisor)          |
|  - 嗅探环境变量与 PATH (Homebrew / Node 24 / dsh)             |
|  - 动态拉起子进程: dsh web --port 0 --no-open                  |
|  - 实时捕获 stdout Token 鉴权 URL                           |
|  - 系统托盘 / 原生菜单 / 优雅退出与重载 (SIGTERM -> restart)      |
+------------------------------+------------------------------+
                               |
               +---------------+---------------+
               |                               |
               v                               v
+-------------------------------+ +-------------------------------+
|     Electron Renderer (UI)    | |       DSH Backend Process     |
| - 沉浸式 hiddenInset 原生窗口   | | - 原生 Node.js 24 运行环境      |
| - 状态过渡页 (loading.html)    | | - 数据与配置位于 ~/.dsh        |
| - 自适应会话区顶部拖拽层         | | - 完全掌控 profiles/web/ 插件  |
| - 安全隔离桥接 (preload.js)    | | - 动态回传 loopback 服务端口   |
+-------------------------------+ +-------------------------------+
```

---

## ⌨️ 快捷键速查

| 快捷键 | 功能 |
|---|---|
| `Cmd/Ctrl + Shift + R` | **优雅重启 DSH 核心引擎**（插件安装后必用） |
| `Cmd/Ctrl + R` | 刷新当前页面 |
| `Cmd/Ctrl + ,` | 在文件管理器中快速打开 `~/.dsh` 数据目录 |
| `Cmd/Ctrl + Alt + I` | 打开/关闭 开发者工具 (DevTools) |
| `Cmd/Ctrl + Q` | 退出应用并安全停止后端进程 |

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 开源。
