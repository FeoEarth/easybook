# Easybook

参考 iOS 备忘录布局的轻量 Android 文本笔记应用，使用 Cloudflare Workers + D1 跨设备同步。

## 安装

打开本仓库 **Releases**，下载 `Easybook-0.6.0.apk`。支持 Android 8.0 及以上。APK 为非调试 Release 构建，沿用旧版兼容签名。首次安装需要允许来自浏览器的应用安装。

## 旧版迁移

0.4.x / 0.5.0 的相同包名版本可直接覆盖升级，无需卸载。原生 SQLite 笔记与全部旧 WebView 空间会事务迁移并核验；同步密钥与历史迁移快照由 Android Keystore（AES-256-GCM）加密。核验成功后删除 WebView 中的密钥及含密钥的旧存储键。长按设置底部版本号可查看状态、重试及恢复加密凭据检查点。原先更早、不同包名的独立安装仍需手动同步或 JSON 导入。

## 使用

- 离线创建、编辑、搜索笔记；标题、列表、待办与引用，点击「预览」查看。
- 收藏页面、回收站恢复、复制全文、Android 系统分享文本到 Easybook。
- 打开应用时每 12 秒同步一次，也可手动同步；后台关闭后不持续同步。
- 「文件夹 → 设置 → 连接其他设备」通过原生窗口查看／复制 64 位随机密钥，在另一台设备输入。密钥持有者可读写整个空间。请保存好，丢失后无法找回。
- 网页版：https://easybook-sync.1902521952.workers.dev ，可和 Android 共享空间。
- 同时修改同一页面时保留冲突副本；删除使用可同步的墓碑记录，防止离线设备复活已删除页面。
- Android 和网页均支持 JSON 备份导入导出；Android 使用系统文件选择器。原生复制、分享、触觉反馈和键盘适配。
- 顶部「文件夹」切换全部、收藏、最近删除和设置；底部提供搜索和新建。按日期分组，支持列表/画廊、深浅色和降低透明度。

## 数据与限制

使用 HTTPS，Cloudflare D1 保存文本；当前未实现端到端加密。Android 密钥保存在原生 Keystore 加密凭据库，WebView 只持有不透明空间标识。网页仍使用原 localStorage 模型。笔记正文、手动 JSON 备份与云端文本尚未加密。密钥失效时离线编辑和导出仍可用，输入原密钥重新配对，不自动清空数据。系统云备份及设备迁移排除应用数据；后端以 SHA-256 密钥摘要隔离空间。卸载会清除本机数据；同步成功的内容可通过原密钥重新取回。单篇正文上限 60,000 字符。此版本不包含 Notion 数据库、多人权限、图片上传、富文本协同或后台同步。

## 构建

JDK 17、Android SDK 35、Gradle 8.9：`gradle :app:assembleRelease`。
GitHub Actions 在推送 main 后构建并发布带 SHA-256 校验文件的 APK，构建时检查 JavaScript 语法，并在 Android 35 模拟器上验证创建、编辑、返回导航和Activity 重建后持久保存、待办勾选、深色外观和原生操作接口。升级兼容签名通过 Actions 缓存保留；新发行版为非调试 Release 构建。正式长期分发仍应将现有签名密钥迁入可靠的专用签名管理，避免丢失后无法覆盖升级。安全设计与恢复说明见 [第二阶段文档](docs/native-security-stage-2.md)。

## 后端

`worker/schema.sql` 为 D1 表结构，`worker/index.mjs` 实现版本条件写入和幂等重试。`worker/ui.mjs` 由 Android HTML 生成，两个端共享同一界面。修改 HTML 后执行 `node scripts/generate-ui.mjs`。`worker/wrangler.jsonc` 提供部署配置；Cloudflare 认证凭据不要提交到仓库。
