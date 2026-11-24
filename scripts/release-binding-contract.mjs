// Fail closed if a release introduces undeclared database, bucket, KV, browser
// or inter-service authority. Runtime-only secrets are never printed.
export function checkResourceBindings(config,bindings){
 const expected=new Map();
 const add=(name,type,fields={})=>{if(expected.has(name))throw Error('duplicate_declared_resource_binding');expected.set(name,{type,fields})};
 for(const x of config.d1_databases||[])add(x.binding,'d1',{id:x.database_id});
 for(const x of config.r2_buckets||[])add(x.binding,'r2_bucket',{bucket_name:x.bucket_name});
 for(const x of config.kv_namespaces||[])add(x.binding,'kv_namespace',{id:x.id});
 for(const x of config.services||[])add(x.binding,'service',{service:x.service,...(x.entrypoint?{entrypoint:x.entrypoint}:{})});
 if(config.browser?.binding)add(config.browser.binding,'browser');
 const types=new Set(['d1','r2_bucket','kv_namespace','service','browser']);
 for(const b of bindings){
  if(['COLLECTION_XPRV','COLLECTION_JOB_TOKEN'].includes(b.name)&&!['easybook-collections','easybook-payments'].includes(config.name))throw Error('unexpected_finance_secret');
  if(!types.has(b.type))continue;
  const e=expected.get(b.name);if(!e||e.type!==b.type)throw Error('undeclared_resource_binding:'+b.name);
  for(const [key,value] of Object.entries(e.fields)){
   const actual=key==='id'&&b.type==='kv_namespace'?(b.namespace_id||b.id):b[key];
   if(actual!==value)throw Error('resource_binding_target_mismatch:'+b.name);
  }
  expected.delete(b.name);
 }
 if(expected.size)throw Error('missing_declared_resource_binding:'+Array.from(expected.keys()).join(','));
}
