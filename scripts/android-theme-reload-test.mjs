import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../app/src/main/java/com/feoearth/easybook/MainActivity.java',import.meta.url),'utf8');

assert.match(source,/darkAppearance\(\).*getString\("themeMode","auto"\)/s,'native startup must restore the app theme instead of relying only on the system theme');
assert.match(source,/boolean dark = darkAppearance\(\)/,'the WebView background must use the restored app theme before loading');
assert.match(source,/replace\("<head>","<head><script>.*localStorage\.getItem\('easybook-theme'\).*document\.documentElement\.dataset\.theme=t/s,'theme must be injected at the beginning of head, before the first page paint');
assert.match(source,/putString\("themeMode",value\)\.apply\(\)/,'theme bridge changes must be persisted for future WebView reloads');

console.log('PASS Android theme reload: native and first HTML paint retain the selected appearance.');
