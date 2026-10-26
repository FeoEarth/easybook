# Easybook MCP 0.8.0 能力目录

完整 JSON Schema： [mcp-catalog.json](mcp-catalog.json)。* 表示必填，? 表示可选。

55 个工具（含 2 个授权辅助工具），加 3 个旧名称别名、5 个原有配对工具。协议使用标准 JSON-RPC / sessionless Streamable HTTP。

## Tools

| 名称 | 功能 | 参数 | 权限 | 验证 |
|---|---|---|---|---|
| notes_list | 分页列出笔记，默认只返回元数据 | limit?:integer, cursor?:string, folder_id?:string, sort?:string, deleted?:boolean, format?:string, offset?:integer, length?:integer, fields?:array | notes.read | 合成数据 SQLite/协议调用通过 |
| notes_search | 按标题或正文文本搜索笔记 | limit?:integer, cursor?:string, folder_id?:string, query*:string, format?:string, offset?:integer, length?:integer, fields?:array | notes.read | 合成数据 SQLite/协议调用通过 |
| notes_get | 读取笔记；大型 JSON 按顶层节点分段，文本按字符分段 | id*:string, format?:string, offset?:integer, length?:integer, fields?:array | notes.read | 合成数据 SQLite/协议调用通过 |
| notes_batch_get | 批量读取笔记，最多五条；每条独立报告错误 | ids*:array, format?:string, offset?:integer, length?:integer, fields?:array | notes.read | 合成数据 SQLite/协议调用通过 |
| notes_create | 创建共享 JSON 文档模型笔记 | title*:string, icon?:string, pinned?:boolean, favorite?:boolean, folder_id?:string, document?:object, text?:string | notes.write | 合成数据 SQLite/协议调用通过 |
| notes_update | 按版本更新正文或元数据 | id*:string, version*:integer, title?:string, icon?:string, pinned?:boolean, favorite?:boolean, folder_id?:string, document?:object | notes.write | 合成数据 SQLite/协议调用通过 |
| notes_append | 追加完整文档片段的顶层节点 | id*:string, version*:integer, document?:object, text?:string | notes.write | 合成数据 SQLite/协议调用通过 |
| notes_delete | 移入最近删除 | id*:string, version*:integer | notes.delete | 合成数据 SQLite/协议调用通过 |
| notes_restore | 恢复笔记 | id*:string, version*:integer | notes.delete | 合成数据 SQLite/协议调用通过 |
| notes_move | 移动笔记至文件夹或根目录 | id*:string, version*:integer, folder_id*:string | notes.write | 合成数据 SQLite/协议调用通过 |
| notes_pin | 置顶或取消置顶 | id*:string, version*:integer, pinned*:boolean | notes.write | 合成数据 SQLite/协议调用通过 |
| folders_list | 分页列出文件夹及现有层级排序 | limit?:integer, cursor?:string | folders.read | 合成数据 SQLite/协议调用通过 |
| folders_get | 读取文件夹及管理版本 | id*:string | folders.read | 合成数据 SQLite/协议调用通过 |
| folders_get_contents | 读取指定文件夹的笔记元数据 | id*:string, limit?:integer, cursor?:string | folders.read | 合成数据 SQLite/协议调用通过 |
| folders_create | 创建文件夹，支持根目录 | name*:string, parent_id?:string, management_version*:integer | folders.manage | 合成数据 SQLite/协议调用通过 |
| folders_rename | 按更新时间校验重命名文件夹 | id*:string, name*:string, updated*:integer | folders.manage | 合成数据 SQLite/协议调用通过 |
| folders_move | 按管理版本调整层级和排序，拒绝循环 | id*:string, parent_id*:string, management_version*:integer, rank?:number | folders.manage | 合成数据 SQLite/协议调用通过 |
| folders_delete | 确认后软删除空文件夹；非空文件夹禁止删除 | id*:string, updated*:integer, management_version*:integer, confirmation_id*:string | folders.manage + 人工一次性确认 | 合成数据 SQLite/协议调用通过 |
| tasks_list | 分页读取原生 taskItem，保留节点路径和层级 | limit?:integer, cursor?:string, note_id?:string, completed?:boolean | tasks.read | 合成数据 SQLite/协议调用通过 |
| tasks_get | 用笔记版本和路径定位任务 | id*:string, version*:integer, path*:array | tasks.read | 合成数据 SQLite/协议调用通过 |
| tasks_create | 在指定 taskList 追加任务，或新建顶层清单 | id*:string, version*:integer, list_path?:array, text*:string, checked?:boolean | tasks.manage | 合成数据 SQLite/协议调用通过 |
| tasks_update | 修改单个任务文本或勾选状态；保留其他节点 | id*:string, version*:integer, path*:array, text?:string, checked?:boolean | tasks.manage | 合成数据 SQLite/协议调用通过 |
| tasks_complete | 按笔记版本修改指定任务 | id*:string, version*:integer, path*:array | tasks.manage | 合成数据 SQLite/协议调用通过 |
| tasks_reopen | 按笔记版本修改指定任务 | id*:string, version*:integer, path*:array | tasks.manage | 合成数据 SQLite/协议调用通过 |
| tasks_delete | 按笔记版本修改指定任务 | id*:string, version*:integer, path*:array | tasks.manage | 合成数据 SQLite/协议调用通过 |
| tasks_batch_complete | 同一笔记内一次 CAS 完成多个任务 | id*:string, version*:integer, tasks*:array | tasks.manage | 合成数据 SQLite/协议调用通过 |
| notes_get_outline | 获取标题、级别和节点路径 | id*:string | notes.read | 合成数据 SQLite/协议调用通过 |
| notes_find_in_note | 查找指定笔记中的文本和精确节点路径 | id*:string, query*:string | notes.read | 合成数据 SQLite/协议调用通过 |
| notes_replace_text | 仅替换指定 text 节点内唯一匹配，保留 marks | id*:string, version*:integer, path*:array, find*:string, replace*:string | notes.write | 合成数据 SQLite/协议调用通过 |
| notes_insert_section | 在顶层指定位置插入标题和完整文档片段 | id*:string, version*:integer, index*:integer, level*:integer, title*:string, document?:object, text?:string | notes.write | 合成数据 SQLite/协议调用通过 |
| notes_duplicate | 复制笔记并保留媒体及格式 | id*:string, version*:integer, title?:string, folder_id?:string | notes.write | 合成数据 SQLite/协议调用通过 |
| notes_batch_move | 逐条 CAS 批量移动；返回每条结果 | items*:array, folder_id*:string, confirmation_id*:string | notes.write + 人工一次性确认 | 合成数据 SQLite/协议调用通过 |
| notes_batch_delete | 确认后逐条 CAS 批量软删除 | items*:array, confirmation_id*:string | notes.delete + 人工一次性确认 | 合成数据 SQLite/协议调用通过 |
| notes_batch_update | 仅批量更新标题、图标、置顶、收藏元数据 | items*:array, metadata*:object, confirmation_id*:string | notes.write + 人工一次性确认 | 合成数据 SQLite/协议调用通过 |
| attachments_list | 分页浏览 R2 附件元数据，不读取文件内容 | limit?:integer, cursor?:string | attachments.read | 合成数据 SQLite/协议调用通过 |
| attachments_search | 按名称和 MIME 筛选当前附件分页 | limit?:integer, cursor?:string, query?:string, mime?:string | attachments.read | 合成数据 SQLite/协议调用通过 |
| attachments_get_metadata | 获取附件安全元数据 | attachment_id*:string | attachments.read | 合成数据 SQLite/协议调用通过 |
| attachments_get_download_url | 生成五分钟有效且可随工作区授权撤销的下载地址 | attachment_id*:string | attachments.read | 合成数据 SQLite/协议调用通过 |
| attachments_attach_to_note | 插入已有附件的正文引用 | id*:string, version*:integer, attachment_id*:string, index?:integer, as_image?:boolean | attachments.write | 合成数据 SQLite/协议调用通过 |
| attachments_detach_from_note | 仅移除精确节点路径处的附件引用 | id*:string, version*:integer, path*:array, attachment_id*:string | attachments.write | 合成数据 SQLite/协议调用通过 |
| attachments_delete | 确认后停用无引用附件；保留 R2 字节以兼容离线同步，禁止永久清除 | attachment_id*:string, confirmation_id*:string | attachments.write + 人工一次性确认 | 合成数据 SQLite/协议调用通过 |
| attachments_prepare_upload | 准备15分钟有效、绑定工作区和客户端的4 MiB分块上传 | filename*:string, mime_type*:string, sha256?:string, request_id?:string, provenance?:object, size*:integer | attachments.write | 合成数据 SQLite/协议调用通过 |
| attachments_upload_base64 | 上传最多128 KiB的小文件；使用严格标准Base64，不能上传URL或假设客户端能读取文件 | filename*:string, mime_type*:string, sha256?:string, request_id?:string, provenance?:object, content_base64*:string | attachments.write | 合成数据 SQLite/协议调用通过 |
| attachments_complete_upload | 验证全部分块、实际类型、大小和SHA-256后登记现有R2附件，幂等返回附件ID | upload_id*:string | attachments.write | 合成数据 SQLite/协议调用通过 |
| attachments_upload_status | 读取当前OAuth客户端上传状态与已接收分块 | upload_id*:string | attachments.write | 合成数据 SQLite/协议调用通过 |
| attachments_abort_upload | 取消未提交的上传并清理临时对象，不删除已登记附件 | upload_id*:string | attachments.write | 合成数据 SQLite/协议调用通过 |
| notes_get_attachments | 列出指定笔记中图片和附件的元数据、节点路径和版本 | id*:string, limit?:integer, cursor?:string | notes.read | 合成数据 SQLite/协议调用通过 |
| workspace_get_info | 当前工作区信息 | 无 | workspace.read | 合成数据 SQLite/协议调用通过 |
| workspace_get_summary | 笔记及文件夹计数；待办按有界分页统计 | limit?:integer, cursor?:string | workspace.read | 合成数据 SQLite/协议调用通过 |
| workspace_get_recent_activity | 按同步游标列出最近变更元数据 | limit?:integer, cursor?:string | workspace.read | 合成数据 SQLite/协议调用通过 |
| workspace_get_capabilities | 当前能力、权限和限制 | 无 | workspace.read | 合成数据 SQLite/协议调用通过 |
| workspace_get_sync_status | 服务端同步游标，不代表设备已同步 | 无 | workspace.read | 合成数据 SQLite/协议调用通过 |
| workspace_search_all | 跨笔记和文件夹搜索 | query*:string, limit?:integer, cursor?:string | workspace.read | 合成数据 SQLite/协议调用通过 |
| access_request_permissions | 请求用户在可信 Easybook 页面批准当前客户端写入权限 | scopes*:array | workspace.read | 合成数据 SQLite/协议调用通过 |
| operations_request_confirmation | 申请绑定工具及精确参数的一次性人工确认 | tool*:string, arguments*:object | workspace.read | 合成数据 SQLite/协议调用通过 |

旧名称保留：list_folders → folders_list；search_notes → notes_search；get_note → notes_get。原有配对工具不变。

## Resources

| URI | MIME | 用途 | 权限 | 更新通知 |
|---|---|---|---|---|
| easybook://attachments | application/json | 附件目录 | attachments.read | 不支持，未声明 |
| easybook://workspace/info | application/json | 工作区信息 | workspace.read | 不支持，未声明 |
| easybook://workspace/summary | application/json | 工作区摘要 | workspace.read + tasks.read | 不支持，未声明 |
| easybook://workspace/capabilities | application/json | 工作区权限和能力 | workspace.read | 不支持，未声明 |
| easybook://folders | application/json | 文件夹目录 | folders.read | 不支持，未声明 |
| easybook://notes/recent | application/json | 最近更新笔记 | notes.read | 不支持，未声明 |
| easybook://tasks/open | application/json | 未完成待办 | tasks.read | 不支持，未声明 |
| easybook://tasks/completed | application/json | 已完成待办 | tasks.read | 不支持，未声明 |
| easybook://notes/{note_id} | application/json | 笔记 | notes.read | 不支持，未声明 |
| easybook://notes/{note_id}/text | text/plain | 笔记纯文本 | notes.read | 不支持，未声明 |
| easybook://notes/{note_id}/document | application/json | 笔记文档 JSON 分段 | notes.read | 不支持，未声明 |
| easybook://notes/{note_id}/outline | application/json | 笔记大纲 | notes.read | 不支持，未声明 |
| easybook://notes/{note_id}/attachments | application/json | 笔记附件 | attachments.read | 不支持，未声明 |
| easybook://folders/{folder_id} | application/json | 文件夹详情 | folders.read | 不支持，未声明 |
| easybook://folders/{folder_id}/notes | application/json | 文件夹笔记 | folders.read | 不支持，未声明 |
| easybook://attachments/{attachment_id}/metadata | application/json | 附件元数据 | attachments.read | 不支持，未声明 |

分页通过 URI 查询参数 limit/cursor；笔记文本用 offset/length，JSON 文档用顶层节点 offset 分段。结果含 next_cursor 或 next_offset。所有资源复用工具服务并经过相同授权。

## Prompts

| 名称 | 参数 | 功能 | prompts/get 示例 arguments |
|---|---|---|---|
| organize_notes | note_ids*, requirements? | 整理指定笔记 | {"note_ids":"11111111-1111-4111-8111-111111111111"} |
| organize_workspace | scope?, requirements? | 制定知识库整理方案 | {} |
| categorize_notes | scope?, requirements? | 按主题分类笔记 | {} |
| merge_related_notes | note_ids*, requirements? | 合并相关笔记并保留原始内容 | {"note_ids":"11111111-1111-4111-8111-111111111111"} |
| find_duplicate_notes | scope?, requirements? | 查找真正重复的内容 | {} |
| clean_up_notes | scope?, requirements? | 识别空白、无效或过时笔记 | {} |
| summarize_note | note_id*, level?, requirements? | 总结笔记 | {"note_id":"11111111-1111-4111-8111-111111111111"} |
| summarize_folder | folder_id*, level?, requirements? | 总结文件夹 | {"folder_id":"11111111-1111-4111-8111-111111111111"} |
| create_study_guide | scope?, level?, requirements? | 生成学习指南 | {} |
| generate_flashcards | scope?, count?, level?, requirements? | 生成记忆卡片 | {} |
| generate_quiz | scope?, count?, level?, requirements? | 生成练习题 | {} |
| review_knowledge | scope?, level?, requirements? | 复习知识点 | {} |
| explain_note | note_id*, level?, requirements? | 解释笔记中的概念 | {"note_id":"11111111-1111-4111-8111-111111111111"} |
| build_knowledge_outline | scope?, level?, requirements? | 生成知识大纲 | {} |
| plan_my_day | scope?, period?, requirements? | 制定今日计划 | {} |
| weekly_review | scope?, period?, requirements? | 每周回顾 | {} |
| review_incomplete_tasks | scope?, period?, requirements? | 检查未完成事项 | {} |
| break_down_task | scope?, task*, period?, requirements? | 拆解复杂任务 | {"task":"整理项目任务"} |
| prioritize_tasks | scope?, period?, requirements? | 分析任务优先级 | {} |
| create_project_plan | scope?, period?, requirements? | 从笔记生成项目计划 | {} |
| rewrite_note | note_id*, requirements? | 润色笔记 | {"note_id":"11111111-1111-4111-8111-111111111111"} |
| expand_note | note_id*, requirements? | 扩展笔记内容 | {"note_id":"11111111-1111-4111-8111-111111111111"} |
| translate_note | note_id*, target_language*, requirements? | 翻译笔记 | {"note_id":"11111111-1111-4111-8111-111111111111","target_language":"中文"} |
| extract_action_items | note_id*, requirements? | 提取行动项 | {"note_id":"11111111-1111-4111-8111-111111111111"} |
| convert_to_checklist | note_id*, requirements? | 转换为待办清单 | {"note_id":"11111111-1111-4111-8111-111111111111"} |
| create_meeting_summary | note_id*, requirements? | 整理会议纪要 | {"note_id":"11111111-1111-4111-8111-111111111111"} |
| illustrate_notes | note_ids*, image_source*, images_per_note?, placement? | 为指定笔记寻找、生成或选择相关图片，上传并插入，保留来源和AI标识 | {"note_ids":"11111111-1111-4111-8111-111111111111","image_source":"existing"} |

## 权限与确认

现有 OAuth scope 和工作区配对继续保持 mcp:read，不自动增加写入。新写入由 access_request_permissions 申请，用户在已连接正确工作区的 Easybook Web 确认页面检查客户端、权限并点击批准。页面只在用户点击时使用当前 Web 已保存的工作区身份；密钥不出现在 URL、工具结果或日志中。新增权限按 workspace/client 保存，撤销工作区访问同时撤销权限、确认和下载票据。

批量移动、批量元数据更新、批量软删除、空文件夹软删除和附件停用，先 operations_request_confirmation({tool,arguments})，再由用户批准，最后以 confirmation_id 调用原工具。确认绑定工作区、客户端和规范化的全部参数，十分钟过期，单次消费；confirmed:true 不受支持。原工具不得接收 workspace 参数切换身份。

所有笔记写入复用 notes() 的版本 CAS、mutation receipt、原子 change feed 以及共享文档校验。任务定位为笔记 UUID + version + node path；任何内容位置变化必须重新读取，不会静默修改另一任务。局部替换只操作唯一匹配 text 节点并保留 marks。任务格式跨度不唯一时要求更精确路径。

## 边界和限制

- 无永久清除工具。folders_delete 仅允许无笔记、无子文件夹的文件夹，且只软删除。
- attachments_delete 为可恢复的停用标记：隐藏于 MCP 列表并阻止新增 MCP 引用，保留 R2 字节和已有 Web/Android 引用。离线设备缺乏全局引用锁，故不物理删除。
- 附件使用现有 R2 manifest/chunk 协议；短期下载链接五分钟失效，撤销工作区授权立即失效。不返回 R2 内部路径、wireId 或凭据。新增 MCP 上传会话复用相同分块/manifest协议，详见 mcp-uploads.md。
- 工作区笔记/文件夹计数为精确计数。任务计数由原始 taskItem 派生，旧数据每次最多补齐十条；tasks.complete=false 时不能当作完整统计，next_cursor=continue 时继续调用。附件总数不可靠时返回 null。
- 同步状态仅表示服务端游标，不声称 Android 或其他设备已完成同步。
- 批量最多20项，逐项 CAS，非全批原子；每条结果显式标注成功/失败。批量读取最多5篇，列表最多30项。任务扫描每次最多5篇笔记，可能返回空页及下一游标。
- JSON 文档分段不代表可直接覆盖完整原文；编辑须使用明确局部操作，或在完整读取后以版本校验更新。单节点过大时提示改用文本分段。
- 资源订阅、列表变化通知不支持，不虚报能力。客户端仍可仅使用 Tools。
- prompts/get 不读取私人笔记、不执行写入；所有模板要求引用来源、区分事实与建议并先展示草稿。

## 针对性验证

node scripts/mcp-capabilities-test.mjs 覆盖全部基础工具及附件资源；新增上传工具另由 mcp-upload-test.mjs 验证、3别名、8静态+8动态资源和27提示词，使用内存真实 SQLite、合成工作区和合成 R2。检查旧只读权限、跨工作区拒绝、版本冲突、确认参数/客户端绑定和重放、下载撤销、嵌套任务、表格/marks保留、大文档分段及同步变更记录。另运行原有配对回归、文档合同和 Web 生成产物语法一致性检查。

生产发布沿用候选版本上传、候选浏览器运行验证、正式晋升和失败自动回滚；新增迁移只建立 MCP 控制平面表和派生统计，不新建笔记或任务存储系统。
