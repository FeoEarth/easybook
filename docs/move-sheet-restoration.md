# 移动备忘录 Sheet 恢复

基础 main 6d484d6e，最新发行版 build69 / versionCode37 与该提交一致。原有 moveDialog、positionMoveSheet、renderMoveFolders、showMove、closeMoveSheet 完整存在。问题是原生 menu.js 把 moveDialog 纳入通用菜单，将按钮转换为平铺文字行；NativeGlassMenu 并不投射原有拖动条、导航、路径、文件夹行与滚动结构，且其坐标计算以原Sheet底部为展开点，最终夹到屏幕内形成漂浮菜单。这不是原Sheet已经被删除。

只将 moveDialog 移出通用菜单适配（folderMoveDialog 不变）。新增 move-surface.js / move-content.html，复用 FormatGlassFrame 的材质/透明前景适配器；没有第二套Shader或移动命令。原标题、提示、取消、moveScroll、当前路径、文件夹行/进入子文件夹按钮及 busy/error/progress 全部投射原DOM，按钮token回调原 element.click()。拖动只把PointerEvent传给原moveDragZone处理器，原阈值、速度、busy保护、关闭动画不变；合成事件不调用主WebView的setPointerCapture。前景保留滚动，回写原moveScroll，导航后仍按原处理重置。数据/同步函数未修改。

Sheet使用现有QWEA0 GlassSurface/GlassBackdrop；move专用参数保留顶部圆角、底部直角（宽屏仍采用原四角圆角），使用16dp GPU模糊提高背景文字分离，内部列表继续用原paper填色。其余玻璃控件参数不变，Shader源码未修改。独立透明前景在Backdrop外，不采样自身，不叠加原CSS blur。CSS viewport矩形扣visualViewport偏移后转换一次，放置时扣root padding，避免系统栏/IME重复偏移；原positionMoveSheet继续决定尺寸/底部位置。仅真实事件和有限500ms过渡窗口更新，不持续截图、PixelCopy或无限动画循环。后退由原handleBack关闭Sheet；外部点击转发原取消按钮，忙碌时仍不可关闭。

API33以下、GPU失败、省电或高级效果不可用保留原Web Sheet；Web端本身仍为CSS降级材质，原生AGSL只存在Android。worker/ui.mjs仅为共用HTML生成产物，不修改Worker业务或数据库，不部署Cloudflare。

versionCode38。只执行JS语法、diff静态检查、Android Release编译/签名及产物完整性检查。不执行UI、模拟器、截图对比或全量回归。真实设备上的单篇/批量移动、未分类/嵌套目录、滚动/拖动、键盘、安全区域与视觉效果未运行验收，由用户安装验证。透明前景有额外WebView内存成本，未做性能基准。
