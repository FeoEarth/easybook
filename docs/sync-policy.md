# Device sync policies

Settings are local to this installation and workspace; existing installations default to all folders, automatic local changes, a 15-minute remote check and 30-day history. They are never included in shared document data or management operations.

Selected roots include descendants by stable folder ID. Unclassified is independent. Folder names and hierarchy metadata remain shared so the picker can discover remote folders. Notes and their referenced attachments are filtered for both uploads and downloads. Unselected notes, dirty changes and immutable in-flight mutation snapshots remain stored. Moving a note outside the selected scope holds that change until it is included again. Selecting a scope or changing hierarchy restarts the change cursor; the server advances over excluded records and explicitly acknowledges scope support. Older servers cannot silently ignore a partial scope. Older clients retain their existing all-folder behavior.

Omission never means deletion. Existing remote copies remain when a folder is deselected or a remote note moves outside scope. Terminal purge stubs carry no folder ID, so clients consult the last known folder and only apply them to existing in-scope notes. A local terminal purge with unknown origin is held under partial scope until all folders are enabled. This conservative rule avoids sending a delete for an excluded folder. No R2 cleanup or schema migration is introduced.

History is observation data, separate from the outbox. Deletion and retention only remove terminal log records; queued, waiting and running records remain. Completing a check preserves its ID. Native history is authoritative so old renderer copies cannot keep a completed check running.

Local changes are debounced. Remote checks use one timer only while the Web page is visible. Manual mode disables both automatic triggers. Android JobScheduler supplies best-effort background checks at 15 minutes or longer; the 5-minute choice applies in the foreground. Android battery restrictions may delay jobs. No resident polling service is used. Web cannot promise synchronization after the page closes. Wi-Fi/unmetered Web options are available only where the browser exposes the corresponding reliable signal; Android checks NetworkCapabilities. Network policy applies to manual sync too.

Each native workspace has one active run, a 90-second run deadline, bounded request timeouts, coalescing and exponential retry delay. Interrupted jobs release the running gate in finally. A paused automatic policy retains all local data and queued work. Explicit attachment viewing continues to use the existing on-demand attachment reader.

Validation is limited to scope/deletion safety fixtures, JavaScript parsing, a targeted native policy unit check, and release compilation/signature/artifact checks. UI, emulator, live multi-device conflict and battery behavior require device acceptance.
