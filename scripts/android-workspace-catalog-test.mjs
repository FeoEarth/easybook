import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const [activity,client,html]=await Promise.all([
 readFile(new URL('app/src/main/java/com/feoearth/easybook/MainActivity.java',root),'utf8'),
 readFile(new URL('app/src/main/java/com/feoearth/easybook/WorkspaceClient.java',root),'utf8'),
 readFile(new URL('app/src/main/assets/index.html',root),'utf8')
]);
const repository=await readFile(new URL('app/src/main/java/com/feoearth/easybook/NoteRepository.java',root),'utf8');

assert.match(client,/action\.equals\("listCached"\).*cachedActiveWorkspace\(\).*cachedWorkspaces\(\)/s,'cached workspace catalog must be available without network access');
assert.match(activity,/NativeSync\.isRunning[^\n]+!action\.equals\("list"\)[^\n]+!action\.equals\("listCached"\)/,'read-only workspace discovery must not be blocked by background sync');
const cachedCall=html.indexOf("action:'listCached'");
const remoteCall=html.indexOf("action:'list'",cachedCall);
assert.ok(cachedCall>0&&remoteCall>cachedCall,'Android must render the cached catalog before starting online refresh');
assert.ok(html.slice(cachedCall,remoteCall).includes('renderWorkspaceChoices()'),'cached workspaces must be rendered immediately');
assert.match(client,/pendingRegistration.*merge\(list,new JSONArray\(\)\.put\(local\)\)/s,'pending local workspaces must survive an authoritative account refresh');
assert.match(client,/pendingRegistration&&personalKey!=null&&keyDenied.*activateCachedWorkspace/s,'pending local workspaces must remain selectable before registration');
assert.match(repository,/workspace-unavailable:.*workspace-pending:/s,'a stale unavailable marker must not lock a still-pending local workspace');
assert.match(html,/addEventListener\('online',async\(\)=>.*retryNativeWorkspaceRegistration\(\).*refreshWorkspaces\(\)/s,'network recovery must retry registration and refresh the catalog');
assert.match(client,/action\.equals\("register"\).*workspace-pending:.*workspaceId.*bootstrapKey.*turnstileToken/s,'manual registration must preserve and register the selected local workspace identity');
assert.match(html,/data-register-workspace=.*立即联网注册.*registerLocalWorkspace/s,'pending local workspaces must expose a manual registration action');
assert.match(html,/当前工作区.*切换工作区.*添加工作区.*管理当前工作区/s,'workspace settings must present actions in an object-first hierarchy');
assert.match(html,/保存在本机.*个人工作区.*共享工作区/s,'local pending, registered personal and shared workspaces must be separate groups');
assert.match(client,/action\.equals\("rename"\).*workspace-pending:.*updateWorkspaceMetadata/s,'pending local workspaces must be manageable without server registration');
assert.match(activity,/case "bootstrap".*ensureLocalWorkspace\(\).*snapshot/s,'first Android bootstrap must create a complete local workspace before rendering');
assert.match(repository,/ensureLocalWorkspace\(\).*newKey\(\).*我的工作区.*pendingRegistration.*workspace-pending:.*bindWorkspaceIdentity/s,'first offline launch must persist a local workspace ID and pending registration state');
assert.match(html,/easybookAccountChanged=.*if\(identityV2\)void refreshWorkspaces\(\)/,'first login must refresh account workspaces from every page');

console.log('PASS Android workspace catalog: cached workspaces render before online refresh and during sync.');
