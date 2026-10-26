# MCP expansion baseline (828cfb91)

| Area | Existing | Action |
|---|---|---|
| notes | get_note/search_notes read only | retain aliases; add all requested note tools using existing notes() CAS + receipts + change triggers |
| folders | list_folders flat read | retain alias; reuse folders and management_state placement CAS |
| tasks | taskList/taskItem, no IDs | version-bound node paths; every mutation requires note version, no schema change |
| attachments | R2 v2 manifests/chunks and legacy objects | reuse manifests; bounded listing; short lived workspace/client tickets; no physical purge |
| workspace | paired OAuth grants | metadata counts and bounded task statistics; change cursor |
| Resources / Prompts | absent | shared tool services, seven static/seven templates, 26 templates |
| permissions | mcp:read only | preserve old grants; independent owner-approved per-client scoped grants |
| high risk | absent | exact payload, expiring, single-use owner confirmation; permanent purge unavailable |
| release | staged versions + browser checks + rollback | retain deployment pipeline; extend targeted protocol tests |

No native Android or editor UI change. Sessionless transport cannot reliably deliver subscriptions; advertise subscribe=false/listChanged=false.
