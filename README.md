# mathom-SpaceSniffer-Style

**Windows 磁盘空间分析器 —— SpaceSniffer外观版本。**

扫描一块盘，看清空间到底去哪了：实时文件夹树、可缩放的矩形树图（treemap）、文件类型分布、搜索，以及删除到回收站。

这是 [mathom](https://github.com/gitRasheed/mathom) 的一个个人分支。扫描后端（MFT 读取、目录遍历）是上游原样；**地图从布局到绘制整个重做了**：文件夹一个色系、文件一个色系，靠明度深浅读出嵌套层级。

<img width="1920" height="1065" alt="image" src="https://github.com/user-attachments/assets/2fabd93f-3732-48c7-af53-01f4f0cec349" />

---

## 地图

地图是窗口的主体，其余面板默认收起。

- **两种配色。** `Classic`（默认）文件夹一个颜色、文件一个颜色；`Multi` 给十类文件各一个颜色。前者一眼看清结构，后者回答"这块盘塞了什么"。
- **层级加深。** 每深一层，整块暗一档，最多三档。文件夹和文件同步移动，所以两级之间的落差在任何深度都不变——否则一个很深的文件会和一层浅文件夹变成同一个色块。这是 SpaceSniffer 默认视图里我们之前缺的那一半。
- **Morandi 色调。** 所有颜色都压在同一个明度和极低的彩度上，没有哪一类喊得比别人响。切 accent（teal / blue / violet / rose / green）只换色相，不换地图的分量。accent 同时管窗口主色和地图色调——"一套配色"是一个选择，不是两个。
- **浅色优先。** 地图是按"白纸上的印刷地图"设计的：浅底上一个色号读作"更深一层"。深色主题也在（`System` / `Light` / `Dark`），但默认是浅色，而不是跟着系统走。
- **直角和倒角。** 方块是直角；边缘是 1px 的倒角（上沿亮、下沿暗），替换掉原来那种会随方块形状拉成指纹的高光。
- **标签在单独一层。** 缩放时不会跟着图片一起被拉糊。只画进放得下的**实心**块——已经被细分的块由子项盖着，名字画上去会压在它们身上。
- **最小块由标签决定。** 一个块至少要能写下三个字（28×14），这条定义贯穿整个布局。放不下的涂成它所在文件夹的颜色，是被**吸收**而不是被删掉，所以不留洞。
- **碎条会丢掉。** squarify 排完总会在边上留下几条 10px×600 这种长条，写不下名字、看着像毛边。短边小于 10px 且长宽比超过 4:1 的直接丢弃，于是绘制、命中测试、标签和开合比对看到的是同一张地图。
- **动画只有一种语言。** 打开文件夹是从中心放大（交叉淡入只会闪，因为它没有"上一帧"）；缩放是两个布局过同一台相机；扫描、筛选、改窗口大小是滑动。系统开了「减少动态效果」就全部停掉。

## 其他

- **深度。** `Auto`（默认，按像素决定值不值得再切一层）/ `All` / `1` / `2` / `3`。固定档位会把可读性门限整体撤掉——它真的会回到密密麻麻的小方块，那是刻意的。
- **语言。** 中文（默认）和 English。源码里的字符串**就是**英文，没有一份需要同步的英文表；中文表缺了就回落成英文，所以翻译永远不会是一个空白的 key。
- **搜索。** 支持 `ext:mp4`、`>500mb` 这类语法。
- **扫描。** NTFS 卷上直接读主文件表（MFT），不走目录遍历；结果边扫边出，树和地图实时长出来。大小如实报告：逻辑大小 vs 占用大小、NTFS 压缩、稀疏文件、硬链接只算一次、OneDrive 占位文件。

## 运行

从 [Releases](../../releases) 下载 portable zip（单文件 exe）、MSI 或 setup.exe。

没有代码签名，SmartScreen 会拦一下：「更多信息」→「仍要运行」。

读 MFT 需要管理员权限，应用启动时会问一次；拒绝就退化成较慢的目录遍历。

> 本分支没有 winget 包。`winget install mathom` 装的是上游那个，不是这个。

## 从源码构建

需要 [Rust](https://rustup.rs)（stable）和 [Node.js](https://nodejs.org) 20+。

```text
cd ui && npm ci && cd ..
npm run dev          # 开发模式，热重载
npm run build:app    # release 构建 + 安装包
cargo test --workspace
```

## 布局

一个 cargo workspace。`crates/core` 是树模型、treemap 布局和搜索，不含平台相关代码；`crates/scanner` 是通用的并行遍历器；`crates/scanner-ntfs` 是裸 MFT 读取器，仅 Windows 可用。`src-tauri` 和 `ui/` 分别是 Tauri v2 外壳和 React 前端。两个后端实现同一个 `Scanner` trait，每次扫描由应用决定：卷是 NTFS 且进程已提权，就走 MFT，否则走遍历器。

## 许可

[MIT](LICENSE)。上游版权归 [gitRasheed/mathom](https://github.com/gitRasheed/mathom) 的作者。

---
---

# mathom-SpaceSniffer-Style

**A Windows disk space analyzer whose interface is done the SpaceSniffer way.**

Scan a drive and see where the space went: a live folder tree, a zoomable treemap, a file-type breakdown, search, and delete to the Recycle Bin.

A personal fork of [mathom](https://github.com/gitRasheed/mathom). The scanning back end — the MFT reader and the folder walker — is upstream's, untouched. **The map was rebuilt**, layout and all: one colour family for folders, another for files, with lightness carrying how deep in you are.

---

## The map

The map is the window; every other panel starts closed.

- **Two colour modes.** `Classic` (default) gives folders one colour and files another; `Multi` gives each of ten file types its own. The first shows you structure at a glance, the second answers "what is this disk full of".
- **Level contrast.** Every level of nesting steps one shade darker, saturating at three. Both colours move by the same amount, so the gap between a folder and a file is the same at any depth — without it, a deep file and a shallow folder are the same block to look at. This is the half of SpaceSniffer's default view we were missing.
- **A Morandi palette.** Every colour sits at one lightness with a dusting of chroma, so no category shouts louder than the one beside it. Switching accent (teal / blue / violet / rose / green) changes the hue and nothing about the map's weight. The accent sets the window's accent and the map's tone together — "a colour scheme" is one choice, not two.
- **Light first.** The map is designed as a printed map on white, where a shade darker reads as "further in". The dark theme is there (`System` / `Light` / `Dark`), but light is the default rather than whatever the system says.
- **Square blocks, 1px bevels.** Corners are square; the edge is a light top and a shadowed bottom, replacing a radial sheen that stretched into a fingerprint on any block that was not square.
- **Labels live on their own layer.** They do not smear when the map is scaled. They are painted only into **solid** blocks — one the layout subdivided is covered by its children, and a name centred in it would land on top of them.
- **The floor is defined by the label.** The shortest thing a block can say is three characters and the padding around them (28×14), and that one definition runs the whole layout. Anything too small is painted in the colour of the folder it sits in — **absorbed**, not deleted, so nothing leaves a hole.
- **Slivers are dropped.** A squarified layout always leaves a few 10px×600 strips along an edge: too thin for a name, and they read as a fringe rather than as blocks. Short side under 10px *and* four times longer than it is wide, and they are gone — so the paint, the hit test, the labels and the open/close diff all agree about what the map is.
- **One motion language.** Opening a folder scales out of its own centre (a crossfade has no previous frame, so it reads as a flicker); the zoom draws both layouts through one camera; a scan tick, a filter or a resize slides. `prefers-reduced-motion` stands the whole thing down.

## Also

- **Depth.** `Auto` (default — pixels decide whether another level is worth cutting), `All`, `1`, `2`, `3`. The fixed levels stand the legibility gates down and really do go back to a mesh of small blocks; that is deliberate, and it is a different picture rather than a shorter Auto.
- **Language.** Chinese (default) and English. The strings in the source **are** the English — there is no English table to keep in step, and anything missing from the Chinese table falls back to it, so a translation is never a blank.
- **Search.** `ext:mp4`, `>500mb` and the like.
- **Scanning.** On NTFS volumes it reads the Master File Table directly instead of walking folders, and results stream in while the scan runs so the tree and map fill in live. Sizes are reported truthfully: logical vs. allocated, NTFS compression, sparse files, hardlinks counted once, OneDrive placeholders.

## Running it

Download the portable zip (a single exe), the MSI, or setup.exe from [Releases](../../releases).

Not code-signed yet, so SmartScreen warns on first run: "More info", then "Run anyway".

Reading the MFT needs administrator rights; the app asks once at launch and falls back to the slower folder walker if you decline.

> There is no winget package for this fork. `winget install mathom` installs upstream's build, not this one.

## Build from source

[Rust](https://rustup.rs) (stable) and [Node.js](https://nodejs.org) 20+.

```text
cd ui && npm ci && cd ..
npm run dev          # development app with hot reload
npm run build:app    # release build + installers
cargo test --workspace
```

## Layout

A cargo workspace. `crates/core` holds the tree model, treemap layout, and search, with no platform-specific code. `crates/scanner` is the generic parallel walker; `crates/scanner-ntfs` is the raw MFT reader, Windows-only. `src-tauri` and `ui/` are the Tauri v2 shell and the React front end. Both backends implement the same `Scanner` trait; per scan the app picks MFT when the volume is NTFS and the process is elevated, otherwise the walker.

## License

[MIT](LICENSE). Upstream copyright belongs to the author of [gitRasheed/mathom](https://github.com/gitRasheed/mathom).
