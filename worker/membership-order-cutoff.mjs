// Freeze chain funding at cancellation in the same transaction as the order update.
const installations=new WeakMap();
const orderTables=['membership_purchases','membership_gift_orders'];

export function ensureOrderCutoffs(db){
 let ready=installations.get(db);
 if(!ready){
  ready=db.batch([
   db.prepare(`CREATE TABLE IF NOT EXISTS membership_order_cutoffs(
    order_table TEXT NOT NULL,order_id TEXT NOT NULL,last_event INTEGER NOT NULL,
    PRIMARY KEY(order_table,order_id)
   )`),
   ...orderTables.map(table=>db.prepare(`CREATE TRIGGER IF NOT EXISTS ${table}_freeze_chain_funding
    AFTER UPDATE OF cancelled_at ON ${table}
    WHEN OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL AND OLD.payment_method='chain'
    BEGIN
     INSERT OR IGNORE INTO membership_order_cutoffs
     SELECT '${table}',NEW.id,COALESCE(MAX(rowid),0)-CASE WHEN NEW.cancel_reason='late_payment' THEN 1 ELSE 0 END
     FROM membership_balance_events
     WHERE account_id=NEW.account_id
       AND (NEW.cancel_reason<>'late_payment' OR kind='credit')
       AND (NEW.cancel_reason<>'expired' OR created_at<NEW.expires_at);
    END`))
  ]).catch(error=>{installations.delete(db);throw error});
  installations.set(db,ready);
 }
 return ready;
}

export async function chainOrderCutoff(db,table,order){
 if(order.cancelled_at==null)return {lastEvent:null,before:null};
 await ensureOrderCutoffs(db);
 const snapshot=await db.prepare('SELECT last_event FROM membership_order_cutoffs WHERE order_table=? AND order_id=?').bind(table,order.id).first();
 // Legacy orders have no reliable ordering for events in the cancellation millisecond.
 const before=order.cancel_reason==='expired'?order.expires_at:snapshot?null:order.cancelled_at;
 return {lastEvent:snapshot?.last_event??null,before};
}
