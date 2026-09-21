/**
 * Two languages, and the code is one of them.
 *
 * The strings in the source *are* the English: there is no English table to
 * keep in step, `t()` is handed the sentence it would have rendered anyway,
 * and anything missing from the Chinese table falls back to it. A translation
 * is therefore never a missing key or a blank — at worst it is the English,
 * which is exactly what the app said before there was a language setting.
 *
 * Sentences with a value in them carry it as `{name}`, and the Chinese table
 * holds the same placeholder in whatever order the sentence needs.
 */
export type Lang = "zh" | "en";

const KEY = "mathom:lang";

export const LANGS: { value: Lang; label: string }[] = [
  { value: "zh", label: "中文" },
  { value: "en", label: "English" },
];

let current: Lang = "zh";

export function loadLang(): Lang {
  return localStorage.getItem(KEY) === "en" ? "en" : "zh";
}

/** Applies the language to the module and to the document. */
export function applyLang(lang: Lang) {
  current = lang;
  localStorage.setItem(KEY, lang);
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
}

export function t(
  text: string,
  vars?: Record<string, string | number>,
): string {
  let out = current === "zh" ? (ZH[text] ?? text) : text;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      out = out.split(`{${name}}`).join(String(value));
    }
  }
  return out;
}

const ZH: Record<string, string> = {
  // ---- window chrome
  Minimize: "最小化",
  Maximize: "最大化",
  Restore: "还原",
  Close: "关闭",
  "Drag to move": "拖动以移动窗口",

  // ---- scanning
  Scan: "扫描",
  "Choose folder…": "选择文件夹…",
  "{used} used of {total}": "已用 {used}，共 {total}",
  "{size} free": "剩余 {size}",
  "Choose a folder to scan": "选择要扫描的文件夹",
  Cancel: "取消",
  Rescan: "重新扫描",
  "Beginning a new scan cancels this one.": "开始新扫描会取消当前扫描。",
  Stop: "停止",
  "Stop the scan": "停止扫描",
  Ready: "就绪",
  "Choose a folder and start a scan.": "选择一个文件夹开始扫描。",
  "The tree and treemap fill in live while the scan runs.":
    "扫描过程中，左侧的树和右侧的图会实时填充。",
  "Scan cancelled": "扫描已取消",
  "Scan failed: {error}": "扫描失败：{error}",
  "Scan complete in {elapsed}": "扫描完成，用时 {elapsed}",
  "{count} unreadable": "{count} 个读不到",
  "{files} files · {folders} folders · {size}":
    "{files} 个文件 · {folders} 个文件夹 · {size}",
  "{count} nodes": "{count} 个节点",
  "Scanning…": "扫描中…",
  Rescanning: "重新扫描中",
  "Stop scanning": "停止扫描",

  // ---- the tree
  Name: "名称",
  Size: "大小",
  "% of parent": "占父级",
  Items: "项目",
  Modified: "修改时间",
  "Could not read this directory": "无法读取此目录",
  "Junction / symlink — not followed": "联接 / 符号链接 —— 未跟踪",

  // ---- the map
  Treemap: "图标视图",
  "Treemap appears here during a scan": "扫描时这里会显示图标视图",
  "Nothing here matches the filter — Esc clears it":
    "这里没有符合筛选条件的内容 —— 按 Esc 清除",
  "Waiting for data…": "等待数据…",
  "Nothing to show here": "这里没有可显示的内容",
  "{size} · {pct} of parent": "{size} · 占父级 {pct}",

  // ---- the panels beside it
  "(no extension)": "（无扩展名）",
  "File types": "文件类型",
  "Largest files": "最大的文件",
  "Appears during a scan": "扫描时显示",
  "No files here": "这里没有文件",
  "Click filters to this type · shift-click adds":
    "单击筛选为此类型 · shift 单击追加",
  "File-types panel": "文件类型面板",
  "Show or hide the file-types panel": "显示或隐藏文件类型面板",

  // ---- filtering and search
  "Search names…": "搜索名称…",
  "Try ext:mp4 — filter by type": "试 ext:mp4 —— 按类型筛选",
  "Try >500mb — filter by size": "试 >500mb —— 按大小筛选",
  "Enter filters the whole view": "回车筛选整个视图",
  "Showing matches in the tree and the map": "在树和图中显示匹配项",
  "Clear the view filter": "清除视图筛选",
  "No matches": "没有匹配项",
  "{count} match": "{count} 个匹配项",
  "{count} matches": "{count} 个匹配项",
  "Largest {shown} of {total} matches":
    "共 {total} 个匹配项，显示最大的 {shown} 个",
  "Space-separated filters, all must match:\nname substring · ext:mp4 · >100mb":
    "空格分隔多个条件，需全部满足：\n名称包含 · ext:mp4 · >100mb",
  "Enter filters every view; Esc clears": "回车筛选整个视图；Esc 清除",
  'Stop filtering by "{filter}"': "停止按「{filter}」筛选",

  // ---- context menu
  "Open in Explorer": "在资源管理器中打开",
  "Copy path": "复制路径",
  "Delete folder…": "删除文件夹…",
  "Delete file…": "删除文件…",
  "Zoom in": "放大",
  "Zoom out": "返回上一级",
  "Reset zoom": "回到顶层",

  // ---- deleting
  "Delete this folder?": "删除这个文件夹？",
  "Delete this file?": "删除这个文件？",
  "Deleting…": "删除中…",
  "Delete permanently": "永久删除",
  "Delete permanently (skip the Recycle Bin)": "永久删除（不经过回收站）",
  "Move to Recycle Bin": "移到回收站",
  "Moves to the Recycle Bin — you can restore it from there.":
    "移到回收站 —— 之后可以从那里还原。",
  "This can't be undone.": "此操作无法撤销。",
  Delete: "删除",

  // ---- export
  Export: "导出",
  "Export the current view as CSV or JSON": "把当前视图导出为 CSV 或 JSON",
  CSV: "CSV",
  JSON: "JSON",
  "Folders only": "仅文件夹",
  "Any depth — type a number": "任意深度 —— 也可以填数字",
  "Export needs a finished scan": "需要扫描完成后才能导出",
  "Clipboard refused the copy": "剪贴板拒绝了这次复制",
  Copied: "已复制",
  "Copied {rows} rows": "已复制 {rows} 行",

  // ---- settings
  Appearance: "外观",
  View: "视图",
  "Hide system files": "隐藏系统文件",
  "Hide OS/system files (pagefile, hiberfil, System Volume Information, …)":
    "隐藏操作系统 / 系统文件（pagefile、hiberfil、System Volume Information 等）",
  "Show names in treemap": "在图中显示名称",
  "Write each treemap block's name and size inside it":
    "把每个方块的名字和大小写在它里面",
  Depth: "深度",
  Auto: "自动",
  All: "全部",
  "As deep as the pixels are worth — folders fold when nothing inside them would be readable":
    "深到像素还值得为止 —— 里面的东西读不出来时，文件夹就折起来",
  "Every level that fits, and nothing folds": "能放下的层全展开，什么都不折",
  "Exactly {count} level": "正好 {count} 层",
  "Exactly {count} levels": "正好 {count} 层",
  Theme: "主题",
  System: "跟随系统",
  Light: "浅色",
  Dark: "深色",
  Colours: "配色",
  Classic: "经典",
  Multi: "多彩",
  "One colour for files, one for folders — the accent sets the tone":
    "文件一个颜色、文件夹一个颜色 —— 由强调色决定整体调子",
  "A colour per file type, with folders in the accent colour":
    "每个文件类型一个颜色，文件夹用强调色",
  Accent: "强调色",
  Language: "语言",

  // ---- elevation banner
  "Running without administrator rights — scans use the slower folder walker and skip files it can't read.":
    "当前没有管理员权限 —— 扫描会使用较慢的遍历方式，并跳过读不到的文件。",
  "Start the dev loop from an elevated terminal instead.":
    "请改从管理员终端启动开发模式。",
  "Relaunch as administrator": "以管理员身份重新启动",
  Dismiss: "关闭",

  // ---- failure
  "mathom hit an unexpected error": "mathom 遇到了一个意外错误",
  Reload: "重新加载",
  "unknown error": "未知错误",
};

/** The current language, for the few callers that need it rather than `t`. */
export function currentLang(): Lang {
  return current;
}
