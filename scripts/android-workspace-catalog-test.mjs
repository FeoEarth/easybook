import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const [activity,client,html]=await Promise.all([
 readFile(new URL('app/src/main/java/com/feoearth/easybook/MainActivity.java',root),'utf8'),
 readFile(new URL('app/src/main/java/com/feoearth/easybook/WorkspaceClient.java',root),'utf8'),
 readFile(new URL('app/src/main/assets/index.html',root),'utf8')
]);

assert.match(client,/action\.equals\("listCached"\).*cachedActiveWorkspace\(\).*cachedWorkspaces\(\)/s,'cached workspace catalog must be available without network access');
assert.match(activity,/NativeSync\.isRunning[^\n]+!action\.equals\("list"\)[^\n]+!action\.equals\("listCached"\)/,'read-only workspace discovery must not be blocked by background sync');
const cachedCall=html.indexOf("action:'listCached'");
const remoteCall=html.indexOf("action:'list'",cachedCall);
assert.ok(cachedCall>0&&remoteCall>cachedCall,'Android must render the cached catalog before starting online refresh');
assert.ok(html.slice(cachedCall,remoteCall).includes('renderWorkspaceChoices()'),'cached workspaces must be rendered immediately');

console.log('PASS Android workspace catalog: cached workspaces render before online refresh and during sync.');
