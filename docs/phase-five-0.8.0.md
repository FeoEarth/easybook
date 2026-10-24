# 0.8.0 第五阶段：笔记管理

- 轻点打开、长按上下文菜单，右滑置顶／恢复，左滑移动／删除；长按松手与滑动不触发打开。
- 列表“选择备忘录”：多选、取消、全选、数量；底栏批量移动／删除，最近删除批量恢复／永久删除。
- 置顶分组优先排序；文件夹创建、重命名、删除（笔记移至未分类）；标题／正文搜索及当前笔记查找。
- 内部菜单提供置顶、查找、移动、复制、分享、文本导出、删除；立即同步留在设置。
- 复用 mutation/outbox、IndexedDB 和 Android SQLite。purged=1 是不可恢复的终态，清空笔记内容、阻止旧写入及旧回执复活；云端旧回执正文清空，feed 保留终态以供离线设备追上。
- 文件夹 deleted=1 终态随完整文件夹分页下发；重命名按 updated 合并，旧设备不能撤销删除。附件文件的物理回收不属于本次范围。

部署前按顺序执行 0005-note-management.sql（仅增加 notes_json.purged、folders.deleted）及 Worker 更新；旧客户端需更新后获得完整管理和终态过滤体验。

验证：note-management-api-test、note-management-ui-test（真实 Chromium 触摸事件，长按／滑动／多选／批量移动／删除恢复／永久删除／文件夹／搜索／IndexedDB重载）；Android 数据层及同步代码 Java 编译通过。未做 Android 真机手势、键盘及 SQLite 仪器测试；未重复完整编辑器或附件测试。

参考：https://support.apple.com/en-us/118442
