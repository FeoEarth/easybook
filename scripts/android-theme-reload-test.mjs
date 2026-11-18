import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {membershipUI} from '../worker/membership-ui.mjs';

const java='../app/src/main/java/com/feoearth/easybook/';
const [main,appearance,membership,manifest]=await Promise.all([
 java+'MainActivity.java',java+'AppAppearance.java',java+'MembershipActivity.java','../app/src/main/AndroidManifest.xml'
].map(path=>readFile(new URL(path,import.meta.url),'utf8')));

assert.match(appearance,/getString\("themeMode", "auto"\)/,'both activities read the saved preference');
assert.match(appearance,/UI_MODE_NIGHT_MASK.*UI_MODE_NIGHT_YES/,'system mode comes from Android configuration');
assert.match(main,/replace\("<head>","<head><script>"\+appearanceBootstrap\(\)/,'native theme is applied before first paint');
assert.match(main,/putString\("themeMode",value\)\.apply\(\)/,'theme changes persist across reloads');
assert.match(main,/onConfigurationChanged[\s\S]*?refreshAppearance\(AppAppearance.systemDark\(configuration\)\)/);
assert.match(membership,/loadUrl\(origin\+"\/membership\?theme="\+\(dark\?"dark":"light"\)/,'membership receives the effective mode before its first paint');
assert.match(membership,/onConfigurationChanged[\s\S]*?applyAppearance\(configuration\)/,'membership updates without a WebView reload');
assert.match(manifest,/MainActivity[^>]+configChanges="[^"]*uiMode/);
assert.match(manifest,/MembershipActivity[^>]+configChanges="uiMode"/);
for(const theme of ['dark','light','auto','" onclick="alert(1)']){
 const html=membershipUI({csrf:'',theme});
 const rendered=theme==='light'||theme==='dark'?theme:'auto';
 assert.ok(html.includes(`<html lang="zh-CN" data-theme="${rendered}">`));
}
console.log('PASS Android theme bootstrap, live configuration handling and validated membership first paint');
