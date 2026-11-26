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
  const dock = await bounds('#navigation');
  const content = await bounds('#folders');
  assert.ok(content.y + content.height > dock.y + dock.height, 'folder content can pass under the dock');
  assert.equal(await page.locator('#folders').evaluate(el => getComputedStyle(el).overflowY), 'visible',
    'the list is not clipped by a separate scrolling box');
  await page.evaluate(() => scrollTo(0, document.scrollingElement.scrollHeight));
  const last = await bounds('#customFolders .folder-row:last-child');
  assert.ok(last.y + last.height < dock.y, 'the last folder is fully reachable above the dock');
  assert.ok(await page.evaluate(() => window.scrollY) > 0);

  await page.evaluate(() => {
    window.dockUpdates = [];
    window.NativeStore = {call: async (method, params) => {
      if (method === 'ui.glass.dock' && params.visible && params.content) window.dockUpdates.push(params);
      return {accepted: true};
    }};
  });
  await page.addScriptTag({content: readFileSync(new URL('native-glass/dock-surface.js', assets), 'utf8')});
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(await page.evaluate(() => window.dockUpdates.length), 0);
  await page.evaluate(() => {
    window.EasybookNativeUiReady = true;
    window.easybookSyncDockSearchSurface();
  });
  await page.waitForFunction(() => new Set(window.dockUpdates.map(update => update.slot)).size === 3);
  const updates = await page.evaluate(() => Array.from({length: 3}, (_, slot) =>
    window.dockUpdates.findLast(update => update.slot === slot)));
  const foreground = await browser.newPage({viewport: {width: 360, height: 620}});
  await foreground.setContent(readFileSync(new URL('native-glass/dock-content.html', assets), 'utf8'));
  const names = ['DockSearch', 'DockFolder', 'DockCompose'];
  const controls = ['.searchbar', '#createFolder', '#newTop'];
  for (const update of updates) {
    assert.ok(JSON.stringify(update.content).length < 5000, 'dock projects only its own controls and symbols');
    const ready = await foreground.evaluate(args => {
      let payload;
      window.FormatActions = {postMessage: message => { payload = JSON.parse(message); }};
      window.renderFormat(args.content, {...args, dockSlot:args.slot});
      return payload;
    }, update);
    assert.deepEqual(ready, {type:'ready', revision:update.revision});
    const rect = await foreground.locator(controls[update.slot]).boundingBox();
    assert.ok(rect && Math.abs(rect.y - update.top) < 1);
    assert.equal(await foreground.locator(controls[update.slot]).evaluate(el => getComputedStyle(el).backgroundColor),
      'rgba(0, 0, 0, 0)', 'foreground leaves glass drawing to Android');
    await page.evaluate(({name, revision}) => window['easybook' + name + 'SurfaceReady'](revision),
      {name:names[update.slot], revision:update.revision});
  }
  await page.waitForFunction(() => document.querySelectorAll('#navigation .native-dock-mounted').length === 3);
  await foreground.close();
  assert.equal(await page.evaluate(() => window.easybookDockSearchFocus()), true);
  await page.locator('#createFolder').waitFor({state: 'hidden'});
  await page.setViewportSize({width: 360, height: 440});
  await page.locator('#search').fill('不存在的笔记');
  await page.locator('#home').waitFor({state: 'visible'});
  assert.equal(await page.locator('#home').evaluate(el => getComputedStyle(el).overflowY), 'visible');
  await page.locator('#search').fill('');
  await page.locator('#search').blur();
  await page.locator('#folders').waitFor({state: 'visible'});
  await page.locator('#createFolder').waitFor({state: 'visible'});
  console.log('PASS continuous folder scrolling, dock backdrop content, delayed Android bootstrap, and native projections');
} finally {
  await browser.close();
}
