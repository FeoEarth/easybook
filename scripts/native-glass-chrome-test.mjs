import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const index = read('app/src/main/assets/index.html');
const batch = index.match(/<div class="batchbar[^\n]+/)[0];
const confirm = index.match(/<dialog id="confirmDialog"[^\n]+/)[0];
const styles = index.match(/<style>[\s\S]*?<\/style>/)[0];
const glassAssets = 'app/src/main/assets/native-glass/';
const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || undefined});
try {
  const page = await browser.newPage({viewport: {width: 390, height: 640}, colorScheme: 'light', reducedMotion: 'reduce'});
  const foreground = await browser.newPage({viewport: {width: 390, height: 640}});
  const errors = [];
  for (const target of [page, foreground]) target.on('pageerror', error => errors.push(error.message));
  await page.setContent(styles + '<button id="appUpdateEntry">更新</button>' + batch + confirm);
  await page.evaluate(() => {
    window.updates = [];
    window.commands = [];
    window.NativeStore = {
      async call(method, args) {
        if (method === 'ui.glass.chrome') {
          window.updates.push(args);
          return {accepted: true};
        }
        if (method === 'device.update' && args.action === 'check') {
          return {current: '0.8.0', latest: '0.8.1', currentCode: 1, latestCode: 2, updateAvailable: true,
            notes: '<script>throw Error("inert")</script>', stage: 'idle'};
        }
        if (method === 'device.update' && args.action === 'download') window.commands.push('download');
        return {};
      }
    };
    document.getElementById('batchMove').onclick = () => window.commands.push('move');
  });
  await foreground.setContent(read(glassAssets + 'chrome-content.html'));
  await foreground.evaluate(() => {
    window.messages = [];
    window.FormatActions = {postMessage(message) { window.messages.push(JSON.parse(message)); }};
  });
  await page.addScriptTag({content: read('app/src/main/res/raw/native_update.js')});
  await page.addScriptTag({content: read(glassAssets + 'chrome-surface.js')});
  const readUpdate = (slot, visible, after = 0, dark) => page.waitForFunction(
    ({slot, visible, after, dark}) => window.updates.findLast(
      (args, index) => index >= after && args.slot === slot && args.visible === visible
        && (dark === undefined || args.dark === dark)),
    {slot, visible, after, dark}
  ).then(result => result.jsonValue());
  const count = () => page.evaluate(() => window.updates.length);
  const ready = (slot, revision) =>
    page.evaluate(({slot, revision}) => window[`easybookChrome${slot}SurfaceReady`](revision), {slot, revision});
  const mount = slot => readUpdate(slot, true).then(async payload => {
    assert.ok(payload.content.css.length < 180000);
    await foreground.evaluate(args => window.renderFormat(args.content, args), payload);
    const message = await foreground.evaluate(() => window.messages.at(-1));
    assert.deepEqual(message, {type: 'ready', revision: payload.revision});
    await ready(slot, message.revision);
    return message.revision;
  });
  const click = async (slot, selector) => {
    await foreground.locator(selector).click();
    const message = await foreground.evaluate(() => window.messages.at(-1));
    assert.equal(message.type, 'click');
    await page.evaluate(({slot, token}) => window[`easybookChrome${slot}SurfaceClick`](token), {slot, token: message.token});
  };

  await page.locator('#batchbar').evaluate(bar => { bar.hidden = false; });
  const oldBatchRevision = await mount(0);
  assert.equal(await page.locator('#batchbar').evaluate(bar => getComputedStyle(bar).opacity), '0');
  await click(0, '#batchMove');
  assert.deepEqual(await page.evaluate(() => window.commands), ['move']);

  const beforeOpen = await count();
  await page.locator('#appUpdateEntry').click();
  await readUpdate(0, false, beforeOpen);
  await page.locator('#appUpdateDownload').waitFor({state: 'visible'});
  await page.waitForFunction(() => window.updates.at(-1)?.content?.html.includes('throw Error'));
  const oldUpdateRevision = await mount(1);
  await page.locator('#appUpdateDialog.native-chrome-mounted').waitFor();
  assert.equal(await foreground.locator('#appUpdateNotes').textContent(), '<script>throw Error("inert")</script>');
  assert.equal(await foreground.locator('#appUpdateNotes script').count(), 0);
  assert.equal(await page.locator('#appUpdateDialog').evaluate(dialog => dialog.open && getComputedStyle(dialog).opacity), '0');
  await click(1, '#appUpdateDownload');
  assert.deepEqual(await page.evaluate(() => window.commands), ['move', 'download']);
  const beforeClose = await count();
  await click(1, '#appUpdateClose');
  await readUpdate(1, false, beforeClose);
  const reopenedBatch = await readUpdate(0, true, beforeClose);
  assert.ok(reopenedBatch.revision > oldBatchRevision);
  await ready(0, oldBatchRevision);
  assert.equal(await page.locator('#batchbar.native-chrome-mounted').count(), 0);
  await ready(0, reopenedBatch.revision);
  assert.equal(await page.locator('#batchbar.native-chrome-mounted').count(), 1);

  await page.evaluate(() => {
    const dialog = document.getElementById('confirmDialog');
    const accept = document.getElementById('confirmAccept');
    accept.textContent = '删除';
    accept.className = 'danger';
    accept.onclick = () => { window.commands.push('delete'); dialog.close(); };
    dialog.showModal();
  });
  await mount(2);
  assert.equal(await foreground.locator('#confirmAccept').textContent(), '删除');
  assert.equal(await foreground.locator('#confirmAccept').evaluate(button => getComputedStyle(button).borderRadius), '999px');
  await click(2, '#confirmAccept');
  assert.deepEqual(await page.evaluate(() => window.commands), ['move', 'download', 'delete']);
  await readUpdate(2, false);

  const beforeReopen = await count();
  await page.locator('#appUpdateEntry').click();
  await readUpdate(1, true, beforeReopen, false);
  const beforeDark = await count();
  await page.emulateMedia({colorScheme: 'dark'});
  const darkUpdate = await readUpdate(1, true, beforeDark, true);
  assert.equal(darkUpdate.dark, true);
  assert.ok(darkUpdate.content && darkUpdate.revision > oldUpdateRevision);
  await page.waitForFunction(after => {
    const latest = window.updates.slice(after).findLast(args => args.slot === 1);
    if (latest?.visible && latest.dark) window.easybookChrome1SurfaceReady(latest.revision);
    return document.getElementById('appUpdateDialog').classList.contains('native-chrome-mounted');
  }, beforeDark);
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('#appUpdateDialog.native-chrome-mounted').count(), 0);
  const beforePointer = await count();
  await page.locator('#appUpdateVersion').click();
  const afterPointer = await readUpdate(1, true, beforePointer);
  await ready(1, afterPointer.revision);
  assert.equal(await page.locator('#appUpdateDialog.native-chrome-mounted').count(), 1);
  await page.evaluate(() => window.easybookChrome1SurfaceFallback());
  assert.equal(await page.locator('#appUpdateDialog.native-chrome-mounted').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS Android glass projections for batch actions, updater, and confirmations, including actions and fallback');
} finally {
  await browser.close();
}
