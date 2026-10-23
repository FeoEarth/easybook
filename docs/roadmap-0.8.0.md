# Easybook 0.8.0 roadmap — Test environment
Baseline 781257bdf1600d8d9d88fa03e78dde52e33f7d50. This is a plan, not completed implementation.
## Phase 1: audit and design
Inventory source, commit history and Cloudflare resources; document schema, sync, threat model and risks. Output architecture-0.8.0.md, roadmap-0.8.0.md, acceptance-0.8.0.md. No business logic changes or deployment.
## Phase 2: canonical JSON and editor
Add versioned JSON schema, validation, deterministic text projection, node and mark tests. Refactor editor to single direct editing surface; task nesting, heading/list toggles, selection/IME/undo tests. Remove HTML authority only after test fixtures and approval.
## Phase 3: media and management
First-class image/attachment nodes, safe preview, upload queue and integrity checks; folders/subfolders, pin, search, trash, sort and restore. Keep R2 private.
## Phase 4: sync protocol
Workspace change cursor, transactional revisions, idempotent mutation outbox, tombstones, conflict copies, offline and multi-device parity. Test Android↔Web and simultaneous edits.
## Phase 5: UI, accessibility, security
iOS 26 Notes-inspired hierarchy and controls; Android/Web responsive behavior, dark mode, reduced motion; penetration-oriented bridge/CORS/CSP review, accessibility and IME regression.
## Phase 6: release gate
Run tests and staged deployment on isolated Test D1/R2/Worker; manually verify backups and destructive scope. Production deployment requires explicit separate authorization. No migration or old-format compatibility required, but never purge live resources implicitly.
## Phase 2 entry criteria
Approved ADRs, explicit isolated Test environment/resource IDs, verified current bindings, clean baseline CI, JSON schema fixtures, security owner review, backup/rollback procedure, acceptance thresholds and no unapproved live data deletion.
