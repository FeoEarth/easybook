import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';

const assets = new URL('../app/src/main/assets/', import.meta.url);
const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || undefined});
try {
  const page = await browser.newPage({viewport: {width: 360, height: 580}, isMobile: true, locale: 'zh-CN', colorScheme: 'light',
    reducedMotion: 'reduce'});
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', {value: false}));
  await page.route('https://easybook.test/**', route => {
    const path = new URL(route.request().url()).pathname;
    const file = path === '/' ? 'index.html' : path === '/editor.js' ? 'editor.js' : null;
    if (!file) return route.fulfill({status: 404});
    return route.fulfill({contentType: path === '/' ? 'text/html' : 'text/javascript',
      body: readFileSync(new URL(file, assets))});
  });
  await page.goto('https://easybook.test');
  await page.waitForFunction(() => window.easybookRich);
  if (await page.locator('#foldersButton').isVisible()) await page.locator('#foldersButton').click();
  const create = page.locator('#createFolder');
  await create.click();
  const input = page.locator('#folderName');
  const dialog = page.locator('#newFolderDialog');
  const dialogCenter = async () => {
    await page.waitForFunction(() => {
      const rect = document.getElementById('newFolderDialog').getBoundingClientRect();
      return Math.abs(rect.top + rect.height / 2 - window.visualViewport.height / 2) < 2;
    });
    const bounds = await dialog.boundingBox();
    assert.ok(Math.abs(bounds.y + bounds.height / 2 - page.viewportSize().height / 2) < 2);
  };
  await dialogCenter();
  assert.equal(await input.evaluate(el => getComputedStyle(el).borderRadius), '20px');
  const submit = page.locator('#createFolderSubmit');
  const buttonColors = () => submit.evaluate(button => {
    const style = getComputedStyle(button);
    return [style.backgroundColor, style.color];
  });
  assert.equal(await submit.isDisabled(), true);
  assert.deepEqual(await buttonColors(), ['rgb(0, 100, 223)', 'rgb(255, 255, 255)']);

  await page.emulateMedia({colorScheme: 'dark', reducedMotion: 'reduce'});
  await page.setViewportSize({width: 320, height: 270});
  await dialogCenter();
  assert.deepEqual(await buttonColors(), ['rgb(25, 99, 221)', 'rgb(255, 255, 255)']);
  await input.fill('弹窗测试');
  await input.press('Enter');
  await dialog.waitFor({state: 'hidden'});
  const row = page.locator('#customFolders .folder-row').filter({hasText: '弹窗测试'});
  await row.click({button: 'right'});
  await page.locator('#folderRename').click();
  assert.equal(await input.inputValue(), '弹窗测试');
  assert.equal(await page.locator('#createFolderSubmit').textContent(), '保存');
  await input.fill('重命名测试');
  await input.press('Enter');

  const renamed = page.locator('#customFolders .folder-row').filter({hasText: '重命名测试'});
  await page.setViewportSize({width: 360, height: 580});
  await renamed.click({button: 'right'});
  await page.locator('#folderDelete').click();
  const confirm = page.locator('#confirmDialog'), accept = page.locator('#confirmAccept');
  await confirm.waitFor();
  assert.equal(await accept.textContent(), '删除');
  assert.equal(await accept.evaluate(button => getComputedStyle(button).borderRadius), '999px');
  assert.ok(await accept.evaluate(button => button.classList.contains('danger')));
  assert.equal(await page.evaluate(() => document.activeElement.id), 'confirmCancel');
  await page.keyboard.press('Escape');
  await confirm.waitFor({state: 'hidden'});
  assert.equal(await renamed.count(), 1);
  await renamed.click({button: 'right'});
  await page.locator('#folderDelete').click();
  await accept.click();
  await renamed.waitFor({state: 'detached'});

  console.log('PASS centered light/dark alerts, short viewports, keyboard submission, and safe destructive confirmation');
} finally {
  await browser.close();
}
