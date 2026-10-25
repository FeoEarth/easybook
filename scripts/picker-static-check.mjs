import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const java=await readFile('app/src/main/java/com/feoearth/easybook/MainActivity.java','utf8'),html=await readFile('app/src/main/assets/index.html','utf8');
for(const token of ['MediaStore.ACTION_PICK_IMAGES','MediaStore.EXTRA_PICK_IMAGES_MAX','Intent.ACTION_OPEN_DOCUMENT','Intent.EXTRA_ALLOW_MULTIPLE','getClipData()','openInputStream(uri)','releasePersistableUriPermission','case "ui.performance"'])assert.ok(java.includes(token),token);
for(const token of ['照片与视频','data-content-action="files"','data-content-action="table"','accept="image/*,video/*"','easybook-fast-mode'])assert.ok(html.includes(token),token);
assert.ok(!html.includes('图片或文件'));assert.ok(java.includes('method.startsWith("ui.glass.")&&getPreferences'));console.log('Picker split/multi-select/URI import and persistent glass-off routing static checks passed');
