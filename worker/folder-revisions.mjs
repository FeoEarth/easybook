const schemas=new WeakMap();
export function ensureFolderRevisionSchema(env){let ready=schemas.get(env.DB);if(!ready){ready=env.DB.batch([env.DB.prepare("CREATE TABLE IF NOT EXISTS folder_revisions(workspace TEXT NOT NULL,folder_id TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),mutation TEXT NOT NULL DEFAULT '',PRIMARY KEY(workspace,folder_id))"),env.DB.prepare('CREATE TABLE IF NOT EXISTS folder_receipts(workspace TEXT NOT NULL,mutation TEXT NOT NULL,folder_id TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(workspace,mutation))')]).catch(error=>{schemas.delete(env.DB);throw error});schemas.set(env.DB,ready)}return ready}

// Append immediately after the folder write in the same batch. Older folders
// without a revision row already represent version 1, so their first edit is 2.
export function advanceFolderRevision(env,workspace,id,initial=2){return env.DB.prepare('INSERT INTO folder_revisions(workspace,folder_id,version,mutation) SELECT ?,?,?,? WHERE changes()=1 ON CONFLICT(workspace,folder_id) DO UPDATE SET version=folder_revisions.version+1,mutation=excluded.mutation').bind(workspace,id,initial,crypto.randomUUID());}
