# Easybook 0.8.0 — stage acceptance checklist
Legend: [x] evidence reviewed; [ ] unverified/pending. Phase 1 is documentation-only.
- [x] GitHub repository accessible; latest observed main SHA 781257bdf1600d8d9d88fa03e78dde52e33f7d50.
- [x] Source-level inventory: Android, Web UI, editor, Worker, D1 schema, R2 attachment handler, security classes.
- [x] Cloudflare resource inventory: easybook-sync, easybook-data, easybook-attachments.
- [x] Apple iOS 26 Notes documentation reviewed; native behavior separated from Easybook extensions.
- [x] Target canonical JSON, attachment/task nodes, sync strategy and module decisions documented.
- [x] Known risks and existing test suite names recorded.
- [ ] Actual deployed Worker bindings and D1 schema compared with GitHub.
- [ ] D1/R2 live contents verified (not necessary for documentation; avoid sensitive data reads).
- [ ] CI tests executed and passing at pinned SHA.
- [ ] Android IME and Web cross-device runtime regression tests passed.
- [ ] Security threat model and data retention reviewed.
- [ ] Isolated Test environment and backups verified.
- [ ] Phase 2 implementation explicitly authorized.
- [ ] Production deployment authorized (out of scope).
No core code changed; no Worker deployed; no D1/R2 objects or secrets deleted in phase 1.

## Phase 2 implementation evidence — 2026-10-24
- [x] Explicit phase 2 authorization; scope and no-isolation instruction captured.
- [x] Current Worker bindings and D1 table definitions read-only verified.
- [x] Shared versioned JSON contract and native asset match.
- [x] All requested nodes/marks serialized, validated and restored in local tests.
- [x] Web IndexedDB offline save and stale-tab CAS tested.
- [x] Worker CAS, immutable replay receipt, incremental cursor, tombstone and rollback tested using SQLite.
- [x] Old HTML canonical storage/Markdown conversion removed from active clients and API.
- [ ] Android CI instrumentation completion: see phase-two-0.8.0.md execution record.
- [ ] Device IME and comprehensive editor UI acceptance (later phase).
