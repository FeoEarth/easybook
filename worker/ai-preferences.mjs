import {emptyPreferences,normalizePreferences} from '../shared/ai-preferences.mjs';
export async function readPreferences(env,account){
 await env.DB.prepare('CREATE TABLE IF NOT EXISTS account_ai_preferences(account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,version INTEGER NOT NULL,data_json TEXT NOT NULL)').run();
 const row=await env.DB.prepare('SELECT version,data_json FROM account_ai_preferences WHERE account_id=?').bind(account).first();
 return row?{...normalizePreferences(JSON.parse(row.data_json)),version:row.version}:emptyPreferences();
}
export async function writePreferences(env,account,input){
 const current=await readPreferences(env,account);if(input?.version!==current.version)return null;
 const next={...normalizePreferences(input),version:current.version+1};
 const result=await env.DB.prepare('INSERT INTO account_ai_preferences(account_id,version,data_json) VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET version=excluded.version,data_json=excluded.data_json WHERE account_ai_preferences.version=? RETURNING version').bind(account,next.version,JSON.stringify(next),current.version).first();
 return result?next:null;
}
