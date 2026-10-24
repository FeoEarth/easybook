# 高亮快捷操作与独立调色板

基线 main：bc374c6398eb96e7203140267dc997b77fbdc0fb（build64）。

## 局部变化

- 保留原高亮笔 SVG 和原 onclick：直接应用最近颜色，沿用现有有选区/空选区语义；不擅自添加不同的 toggle 规则。
- 将字体字符 ⌄ 替换为14px SVG chevron-down，保留44px独立触控区，与高亮笔组成一个普通分体控件，无额外玻璃层；整个胶囊高度、圆角、Aa/B/I/U 和其他入口不变。
- 箭头现在仅打开/关闭 `nativeHighlightPalette`，不再调用 openFormats(highlight)。Aa 和完整格式面板的布局、颜色与功能零修改。

## 共享状态与命令

`highlight-palette.js` 直接读取现有 `#highlightColors` 的颜色按钮（当前配置为黄/粉/绿/蓝/紫及移除），不复制色值表。独立面板按钮只调用对应原按钮.click()。原处理器继续更新 lastHighlight、localStorage、Tiptap mark 和完整面板状态；只有一个应用命令，不改变文档/撤销语义。快捷笔颜色提示与最近颜色保持同步。

箭头打开前保存书签；若完整格式面板正在打开，则先等待其原 close 处理器完成选区恢复/释放，再保存调色板书签，避免异步关闭误清空。取消不执行颜色命令；关闭后按既有编辑上下文恢复焦点并释放自己持有的书签。其他格式/链接/附件面板已接管时不释放其书签。调色板打开时冻结自适应重排，关闭后继续原稳定机制；五种上下文及其排序规则不改。

## 独立原生内容，复用材质

`menu.js` 仅为新增面板增加 palette 类型、quickHighlight 锚点与上方偏好。NativeGlassMenu 新增专用色块组件，不把完整格式面板缩小，也不套通用文字网格：标题/关闭、色块当前勾选、移除高亮。颜色来自同一 items，无第二套配置。选区变化时 ui.glass.palette 只更新色块选中态，不重建菜单或工具栏。

复用现有 GlassSurface/QWEA0 Shader、主题、动画、位置更新和降级；宽度上限280dp、44dp以上色块触控，根据可用宽度自然分行。原生与降级面板都以 quickHighlight 的真实矩形优先向上展开，viewport/IME/横向滚动变化沿用已有事件驱动锚点。箭头再次点击或外部点击、返回键可关闭。其他菜单分支的功能、参数和布局不变。API33以下保留紧凑 DOM 调色板作为降级。

没有改 Shader、GlassBackdrop、GlassSurface、FormatGlassFrame、format-surface.js、index.html、富文本核心、完整格式布局、Worker、数据库或同步。不部署Cloudflare。

## 最小检查与交付

versionCode33，versionName0.8.0。仅 node --check（新增调色板、adaptive-toolbar.js、menu.js）和现有APK编译/打包/签名/产物发布检查。

未执行 UI、模拟器、Instrumentation、截图、视觉评分、回归或性能基准。真实选区、空选区、键盘、不同设备颜色显示与触摸效果须用户安装APK验收；不得将源码规则或编译结果当成视觉验证。
