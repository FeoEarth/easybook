import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';

const assets = new URL('../app/src/main/assets/', import.meta.url);
const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || undefined});
try {
  const page = await browser.newPage({viewport: {width: 360, height: 620}, isMobile: true,
    hasTouch: true, colorScheme: 'dark', reducedMotion: 'reduce'});
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', {value: false}));
  await page.route('https://easybook.test/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/' || path === '/editor.js') {
      const file = path === '/' ? 'index.html' : 'editor.js';
      return route.fulfill({contentType: path === '/' ? 'text/html' : 'text/javascript',
        body: readFileSync(new URL(file, assets))});
    }
    return route.fulfill({status: 404});
  });
  await page.goto('https://easybook.test');
  await page.waitForFunction(() => window.easybookRich);
  if (await page.locator('#foldersButton').isVisible()) await page.locator('#foldersButton').click();
  await page.locator('#folders').waitFor({state: 'visible'});
  await page.evaluate(() => {
    const group = document.getElementById('customFolders');
    const rows = Array.from({length: 18}, (_, i) => {
      const row = document.createElement('button');
      row.className = 'folder-row';
      row.textContent = '测试文件夹 ' + i;
      return row;
    });
    group.append(...rows);
  });
  const bounds = selector => page.locator(selector).boundingBox();
  const checkDockClearance = async selector => {
    const content = await bounds(selector);
    const dock = await bounds('#navigation');
    assert.ok(content.y + content.height <= dock.y - 6, 'scrolling area stays above the search bar');
  };
  await checkDockClearance('#folders');
  await page.locator('#folders').evaluate(folders => { folders.scrollTop = folders.scrollHeight; });
  const last = await bounds('#customFolders .folder-row:last-child');
  const dock = await bounds('#navigation');
  assert.ok(last.y + last.height < dock.y, 'the last folder is fully reachable above the dock');
  assert.equal(await page.evaluate(() => window.scrollY), 0);

  await page.evaluate(() => { window.NativeStore = {call: async () => ({accepted: true})}; });
  await page.addScriptTag({content: readFileSync(new URL('native-glass/dock-surface.js', assets), 'utf8')});
  assert.equal(await page.evaluate(() => window.easybookDockSearchFocus()), true);
  await page.locator('#createFolder').waitFor({state: 'hidden'});
  await page.setViewportSize({width: 360, height: 440});
  await page.locator('#search').fill('不存在的笔记');
  await page.locator('#home').waitFor({state: 'visible'});
  await checkDockClearance('#home');
  await page.locator('#search').fill('');
  await page.locator('#search').blur();
  await page.locator('#folders').waitFor({state: 'visible'});
  await page.locator('#createFolder').waitFor({state: 'visible'});
  await page.waitForFunction(() => {
    const content = document.getElementById('folders').getBoundingClientRect();
    return content.bottom <= document.getElementById('navigation').getBoundingClientRect().top - 6;
  });
  console.log('PASS folder dock clearance, last row scrolling, and search on short viewports');
} finally {
  await browser.close();
}
