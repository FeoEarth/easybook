# 底部编辑工具栏原生 Liquid Glass

基线 main：30e377ffe17293e57d5853597f1e9c29c98bd073（build65）。原 #formatbar 使用 CSS backdrop-filter / 半透明填充，未连接 QWEA0 原生透镜。

本次给底部胶囊接入完整 GlassSurface，复用同一个 QWEA0 Shader 和 GlassBackdrop。工具栏专用参数为8dp GPU blur、7dp位移、10dp斜面；圆角来自原胶囊实测半高，避免将999px CSS圆角直接传给SDF。原胶囊尺寸、按钮、排列、Aa、高亮笔/独立调色板、附件与更多入口不变。

复用已有 FormatGlassFrame 的透明内容投影适配器，新增工具栏模式。原格式面板模式的默认渲染参数和布局保留。Toolbar前景只投影现有 DOM/CSS/SVG，不包含编辑器、文档或独立命令实现。原工具栏在前景ready后才隐藏；透明前景不重复CSS模糊。源背景不包含自身，整个胶囊只有一块玻璃，不为每个按钮额外叠加玻璃。

点击以稳定token转发至原按钮.click()，此前捕获原编辑选区；前景不获取输入焦点。触摸阶段通知既有自适应延后机制，不在滑动时重排。前景横向滚动回写至原formatTrack，菜单仍从原按钮的实际矩形定位。惯性滚动期间不把回传位置写回前景，避免反馈抵消滚动。

CSS viewport坐标扣除visualViewport偏移后转换一次至WebView像素；工具栏模式在root放置时扣除FrameLayout自身padding，避免重复安全区域。原样式决定高度和位置，键盘/窗口/滚动/DOM变化事件驱动同步。工具栏单独显示时，真实DOM/滚动变化也会合并触发既有 ui.glass.invalidate，刷新硬件WebView录制，避免仅依赖几何变化导致背景停留。没有常驻刷新、Bitmap截图或PixelCopy。

GlassBackdrop仍只录制主WebView一次，可同时通知当前面板/菜单与工具栏消费者；不存在第二套玻璃引擎。关闭/导航时释放或复用已有资源。API33以下、GPU失败、省电、减少透明效果及页面缩放时恢复原CSS工具栏。

versionCode35。仅node --check（工具栏源脚本、前景脚本、自适应脚本）、APK编译/打包/签名和产物检查。不运行UI/模拟器/截图/视觉对比/回归。新增透明工具栏WebView带来内存开销；真实设备字体、触摸/惯性滚动、IME与GPU表现未验证，由用户安装验收。未修改Worker、同步协议、文档模型；不部署Cloudflare。
