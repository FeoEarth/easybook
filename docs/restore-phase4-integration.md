# 阶段四完整整合与验收记录

## 基线
- main: 2854ade76f81a60c2f909e4ccc110bd1787a306c。
- PR #4: be6f6a27 → febdb189 → 68334cc4b029e5732bbfb028180e3e3961d8c064，共 23 个变更文件。
- 整合分支 restore-phase4-media-sync 原本与 main 相同。
- 以 main 树为基础进行三方代码整合；不覆盖旧树，不迁移数据库或删除附件。

## 功能整合清单
| 模块 | 实现 |
| --- | --- |
| 正文媒体 | PR #4 NodeView、保存光标位置、多文件上传、图片直接显示、普通附件卡片；旧 attachment 图片节点同样显示图片，保持原 JSON |
| 全屏预览 | 双击/滚轮/双指缩放、拖动、左右切换及滑动、关闭清理 Blob URL |
| 分类预览 | 图片、TXT 安全文本、浏览器 PDF、原生 PDF 阅读器、音视频、其他文件保存/外部打开 |
| 保存与分享 | Web 下载及受支持浏览器 Web Share；Android 私有 FileProvider 临时只读授权与系统保存/分享 |
| 附件一致性 | schema v1 SHA-256 引用、私有缓存/R2、5 MiB 现有限制、下载哈希与大小校验、损坏缓存原子修复、去重、离线缓存、原 outbox |
| 同步活动 | PR #4 原版独立页面，返回导航、sticky 导航、整体状态、成功时间、分组任务、真实传输字节/已知长度百分比、不确定进度、失败原因/重试、最近活动、冲突与离线恢复 |
| 原生同步 | NativeSync 实际流读写进度、SyncJournal 持久化观察、附件确认落盘后完成 |
| 文件夹同步 | 补充 Web/Android 文件夹活动与待同步数量；保留 main 的 updated/deleted 协议 |
| 最新 main | 画廊、长按菜单、滑动、多选/批量、置顶/移动、回收站、删除撤销、搜索、格式面板、待办布局、CAS/purge/隔离完整保留 |

## 冲突解决
- index.html 的格式与笔记管理 CSS/DOM 保留 main；媒体与同步 CSS/DOM 使用 PR #4，删除简化同步页。
- switchTab/handleBack 保留 main 手势清理、选择和查找退出逻辑，接入 PR #4 sync/history 导航。
- request 使用 PR #4 真实附件 XHR 进度；sync/applyRemote 保留 main 终结删除、撤销回执及文件夹时间戳规则，增加活动观察与落盘确认。
- nativeFolders 继续采用 main Map 和时间戳，避免回退旧 Set 导致文件夹改名/删除失败。
- NativeSync 在 main 文件夹/笔记协议上添加 PR #4 journal；不改 API、数据库模型或认证。
- editor 源码三方合并后重新构建；Android/Web HTML 和 editor 产物重新生成，服务端 API 保持 main。
- 保留 main 的新 APK 工作流与唯一 release tag，版本码提升至 19；不恢复旧固定 build18 发布配置。
- 更新旧同步页测试及 PR #4 已过期断言，新增 PR 校验工作流。

## 已运行验证
- npm test：语法、文档、编辑器、格式面板、Worker CAS/replay/回滚、IndexedDB、附件鉴权/隔离。
- test:media：正文位置与混排、JSON 重载、全屏预览/缩放/切换、PDF iframe、安全 TXT、保存/分享回调、旧图片节点兼容、真实进度事件、失败重试、离线恢复、去重及模拟跨客户端下载。
- test:sync-ui 和 sync-activity-test：原版页面分组、真实/不确定进度、无完成进度条、错误脱敏、成功时间、浏览器前进/后退及 Android JS 返回/文件夹回执。
- test:notes：Chromium 实际触控长按/滑动、画廊、多选、文件夹、撤销/终结删除、搜索、320/390/768 浅色/深色。
- sync-page-browser-test：320/390/1024 浅色/深色、无横向溢出、自然滚动、sticky 导航与浏览器导航。
- task-node-test、note-management-api-test、native bridge 测试。
- PR 工作流编译 Java/Android manifest，并在隔离模拟器运行原生数据层、附件缓存修复、鉴权与安全检查；main 工作流构建并验证 APK 签名。

## 验证边界
DOM 与模拟传输不等于 Android 真机系统功能验证。真实 Android PDF 手势/分页、文件选择/系统保存/分享、实际 Android↔Web 附件联测、真实中文输入法未验证。Web Share 和 PDF 插件取决于浏览器支持，保留保存后打开方式。进度是实际 JSON/base64 传输字节，不是原始文件字节；只有回执与本机持久化完成后确认成功。

## 生产部署
仅部署从最新整合源码构建的 Worker。继承 DB 与 ATTACHMENTS，保留变量和日志。无 D1 迁移、存储桶创建、用户笔记写入或附件删除。部署与 APK 最终 ID 以交付回复和 GitHub Actions 记录为准。
