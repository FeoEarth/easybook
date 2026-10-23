# Easybook 0.8.0 第三阶段：富文本与格式

基线：main `f3afd6793d037e852059aa65a80e9cd0d701600f`。本阶段编号以最新用户指令为准，取代原路线图中“第三阶段：媒体与管理”的安排。

## 实际接入与范围

已核对第二阶段编辑器源码、共享 Schema、存取回调和已有编辑器恢复测试，相关文件与 GitHub main blob 一致。Android/Web 继续共用 `editor/rich-editor.js`、schemaVersion 1 和同一生成资源。正文仍然只以 JSON 存储，没有引入 HTML 主存储或协议变更。原生安全组件、SQLite、Worker API、D1、R2 与密钥均不改动。

- 删除编辑/预览切换，打开即可编辑；任务与附件既有功能继续使用。
- Aa 格式面板：标题、副标题、小标题、正文、等宽块、引用、列表、分割线，粗体、斜体、下划线、删除线、链接、行内代码。
- 高亮：黄、粉、绿、蓝、紫，设置同类 Mark 可直接改色，移除仅删除高亮；字体颜色另用 textColor Mark，支持默认、红、橙、黄、绿、蓝、紫、灰。
- 面板打开时保存 ProseMirror 选区 bookmark，文档事务映射后恢复；链接输入不丢失原选区。光标处设置格式沿用 storedMarks；Enter/Backspace 和撤销/重做沿用原生 ProseMirror 命令，加载另一笔记时重置历史，避免跨笔记撤销。
- 保留 Android 已有 adjustResize/原生 IME Insets；共享层增加 visualViewport 避让、视口内面板、选区光标滚动。中文 composition 期间不重载或重绘编辑器，完成时发出保存；导航、隐藏和离开页面时补交待保存输入。
- 粘贴先 DOMPurify，再仅保留合法颜色、支持的语义标签和任务属性，移除事件、任意布局 CSS、脚本和危险链接。原生复制沿用 ProseMirror DOM 序列化，粘回时恢复支持的文字格式与颜色；媒体粘贴不上传远程内容。

界面参考 Apple Notes 的 Aa 分组与底部浮动工具栏；字体颜色、行内代码属于 Easybook 扩展，面板已标识。没有宣称像素级还原或 Apple 原生实现。

## Markdown 规则

在 Aa → Markdown 中粘贴后插入当前选区，或导出正文并复制为 Markdown 文本。使用锁定版本 markdown-it；不会将 Markdown 作为第二套正文。

- 标题、正文、引用、项目/编号/待办列表、分割线、粗体、斜体、删除线、链接、行内代码和代码块采用 Markdown 表达。
- 下划线、高亮、字体颜色导出为文本并显示提示；代码内叠加的其他样式省略并提示，JSON 保存仍完整保留。
- 图片/附件导出名称并提示，二进制完整备份仍使用现有 JSON 备份。导入远程图片为链接，不自动请求或下载图片。
- 原始 HTML 作为文字导入；四至六级标题降为三级；表格语法按文字保留。Markdown 不能替代无损 JSON 备份。

## 最低必要验证

命令：`npm run build:editor && npm run test:editor`。

通过：局部/跨段高亮、五色变更、移除、独立字体颜色、格式叠加、选区与链接输入面板、格式继承、Enter/Backspace、撤销/重做、跨笔记历史隔离、模拟中文 composition 结束提交、安全带色粘贴、Markdown 导入/导出及降级、Schema 往返、实际页面的 IndexedDB 离线保存与恢复。Web 与 Android 生成资源同源。

未运行全项目 E2E、Android 模拟器/真实输入法、跨设备联测或正式 APK 构建；未重新部署 Cloudflare。真实 Android 中文输入法候选窗与软键盘外观仍需后续实机体验确认；模拟 DOM 测试不能证明设备行为。此次只提交独立第三阶段分支，避免 main 推送自动打包发行版。
