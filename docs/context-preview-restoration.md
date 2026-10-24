# 长按笔记预览恢复

基准：main 3766cb57；对照 378ad633985c、24b1626933db。这两版的 contextPreview、openContext、positionContext 和预览卡片结构仍完整保留在 main。

退化源于 0f8dcc8e（PR14）的原生通用菜单适配：contextDialog 被整体 visibility:hidden，原生端只接收按钮与标题，未接收预览。另一个独立问题是旧 positionContext 在 viewport height < 510 时无条件隐藏预览。

本次保留原 DOM 标题、摘要、图片、缩略图加载、源卡片定位及全部操作处理；原生接管时只隐藏 context-actions，预览继续由主 WebView 显示。新增 context 类型仅用于组合定位，不增加业务命令。原生实测菜单高度回传为透明操作占位高度，旧 positionContext 计算整组位置；菜单锚定占位顶部，不反向翻转覆盖预览。缩略图加载、容器尺寸、窗口和 visualViewport 变化通过现有失效/锚定机制同步。有限空间按操作区域实际高度约束预览，不再按 510px 阈值隐藏。极矮窗口仍可能裁切或需滚动。

GlassSurface、GlassBackdrop、Shader、材质参数、圆角、阴影及开关/按压动画均未修改；原生失败时恢复当前 Web 菜单。没有截图或逐帧轮询。worker/ui.mjs 仅是共用 HTML 的生成产物，不改 Worker API、数据或同步；本次不部署 Cloudflare。

versionCode36。仅 JS 静态语法检查、Android Release 编译/打包/签名与产物检查。未执行 UI、模拟器、截图、视觉验收及回归；真实设备列表/画廊、图片加载、返回/手势、深浅色与极小窗口由用户安装验收。
