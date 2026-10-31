(function () {
  'use strict';
  // Android-only screen, added after the shared notes/settings page initializes.
  const bridge = window.NativeStore;
  if (!bridge) return;
  let sheet, state = null, checking = false, speed = 0, lastBytes = 0, lastTick = 0, notice = '';
  const id = value => document.getElementById(value);
  const size = value => ((Number(value) || 0) / 1048576).toFixed(1) + ' MB';

  const style = document.createElement('style');
  style.textContent = `
    #appUpdateDialog{width:min(520px,calc(100% - 28px));max-height:83dvh;padding:22px;border:1px solid var(--border);border-radius:26px;background:var(--glass);color:var(--ink);box-shadow:0 24px 70px rgba(0,0,0,.22);backdrop-filter:blur(32px) saturate(1.5);-webkit-backdrop-filter:blur(32px) saturate(1.5);overflow:auto}
    #appUpdateDialog::backdrop{background:rgba(0,0,0,.32);backdrop-filter:blur(6px)}
    #appUpdateDialog .update-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}
    #appUpdateDialog h2{font-size:22px;letter-spacing:-.4px;margin:0}
    #appUpdateDialog .update-close{font-size:25px;border-radius:50%;width:38px;height:38px;min-width:38px;min-height:38px;padding:0;background:var(--selected);color:var(--muted)}
    #appUpdateDialog .update-version{font-size:17px;font-weight:700;margin:5px 0}
    #appUpdateDialog .update-subtitle{font-size:13px;color:var(--muted);line-height:1.5;margin:3px 0 14px}
    #appUpdateDialog .update-notes{font-size:13px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;max-height:32dvh;overflow:auto;background:var(--paper);border-radius:15px;padding:14px;margin:12px 0}
    #appUpdateDialog progress{height:6px;width:100%;border:0;border-radius:20px;overflow:hidden;background:var(--selected);display:block;margin:12px 0}
    #appUpdateDialog progress::-webkit-progress-bar{background:var(--selected);border-radius:20px}
    #appUpdateDialog progress::-webkit-progress-value{background:var(--accent);border-radius:20px}
    #appUpdateDialog .update-actions{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:16px}
    #appUpdateDialog .update-actions button{border-radius:19px;background:var(--selected);font-weight:600}
    #appUpdateDialog .update-actions button.primary{background:var(--accent);color:white}
    #appUpdateDialog .update-message{font-size:13px;color:var(--muted);min-height:20px;line-height:1.5}
  `;
  document.head.append(style);

  function render(data) {
    if (data) state = data;
    if (!sheet) return;
    const status = id('appUpdateStatus');
    const available = !!state?.updateAvailable;
    const stage = state?.stage || 'idle';
    const downloading = stage === 'downloading';
    const current = state?.current || '';
    const latest = state?.latest || '';
    id('appUpdateVersion').textContent = checking ? '正在检查更新…' : latest
      ? (available ? '发现新版本 ' : '当前已是最新版本 ') + latest : '检查更新';
    id('appUpdateBuild').textContent = latest
      ? '当前 ' + current + '（' + state.currentCode + '） · 最新 ' + latest + '（' + state.latestCode + '）'
      : '当前版本 ' + (current || 'Easybook');
    if (status) status.textContent = checking ? '正在检查…' : available
      ? (stage === 'ready' ? '更新已下载，等待安装' : downloading
        ? '正在下载 ' + Math.round((state.downloaded || 0) / (state.size || 1) * 100) + '%' : '发现新版本 ' + latest)
      : latest ? '当前已是最新版本' : '点击检查正式发行版';
    const notes = id('appUpdateNotes');
    notes.hidden = !latest;
    notes.textContent = state?.notes || '未提供更新说明。';
    const progress = id('appUpdateProgress');
    progress.hidden = !downloading;
    progress.value = Math.min(100, Math.max(0, Math.floor((state?.downloaded || 0) / (state?.size || 1) * 100)));
    let message = '请选择检查更新。';
    if (checking) message = '正在从 GitHub 检查最新正式发行版…';
    else if (downloading) message = '已下载 ' + size(state.downloaded) + ' / ' + size(state.size)
      + (speed > 0 ? ' · ' + size(speed) + '/s' : '');
    else if (stage === 'ready') message = '下载完成，已验证 SHA-256、包名、版本号及应用签名。';
    else if (stage === 'failed') message = state.error || '下载失败，请重试。';
    else if (available) message = 'APK ' + size(state.size) + ' · 由 Android 系统确认安装。';
    else if (latest) message = '无需更新。';
    id('appUpdateMessage').textContent = notice || message;
    id('appUpdateCancel').hidden = !downloading;
    id('appUpdateCheck').hidden = checking || downloading;
    id('appUpdateDownload').hidden = checking || !available || downloading || stage === 'ready';
    id('appUpdateDownload').textContent = stage === 'failed' ? '重新下载' : '下载更新';
    id('appUpdateInstall').hidden = !available || stage !== 'ready';
  }

  window.easybookUpdateProgress = data => {
    const tick = performance.now(), bytes = Number(data?.downloaded) || 0;
    if (data?.stage === 'downloading' && lastTick && bytes >= lastBytes && tick > lastTick)
      speed = Math.round((bytes - lastBytes) * 1000 / (tick - lastTick));
    else if (data?.stage !== 'downloading') speed = 0;
    lastTick = tick; lastBytes = bytes;
    render(data);
  };

  function activate() {
    const entry = id('appUpdateEntry');
    if (!entry || entry.dataset.nativeUpdaterReady) return false;
    entry.dataset.nativeUpdaterReady = 'true';
    sheet = document.createElement('dialog');
    sheet.id = 'appUpdateDialog'; sheet.setAttribute('aria-labelledby', 'appUpdateTitle');
    sheet.innerHTML = '<div class="update-heading"><h2 id="appUpdateTitle">Easybook 更新</h2><button id="appUpdateClose" class="update-close" aria-label="关闭更新窗口">×</button></div>'
      + '<div id="appUpdateVersion" class="update-version">检查更新</div><div id="appUpdateBuild" class="update-subtitle"></div>'
      + '<div id="appUpdateMessage" class="update-message" aria-live="polite"></div>'
      + '<progress id="appUpdateProgress" max="100" value="0" hidden></progress><div id="appUpdateNotes" class="update-notes" hidden></div>'
      + '<div class="update-actions"><button id="appUpdateCancel" hidden>取消下载</button><button id="appUpdateCheck">重新检查</button>'
      + '<button id="appUpdateDownload" class="primary" hidden>下载更新</button>'
      + '<button id="appUpdateInstall" class="primary" hidden>安装更新</button></div>';
    document.body.append(sheet);
    id('appUpdateClose').onclick = () => sheet.close();
    async function check() {
      if (checking || state?.stage === 'downloading') return;
      checking = true; notice = ''; render();
      try {
        render(await bridge.call('device.update', {action:'check'}));
      } catch (e) {
        id('appUpdateMessage').textContent = '检查失败：' + (e?.message || '请检查网络后重试');
        if (id('appUpdateStatus')) id('appUpdateStatus').textContent = '检查失败';
      } finally { checking = false; if (state?.latest) render(); }
    }
    entry.onclick = () => {if (!sheet.open) sheet.showModal(); void check();};
    id('appUpdateCheck').onclick = () => void check();
    id('appUpdateDownload').onclick = async () => {
      notice = ''; speed = 0; lastTick = 0; const btn = id('appUpdateDownload'); btn.disabled = true;
      try { render(await bridge.call('device.update', {action:'download'})); }
      catch(e) { notice = '无法开始下载：' + (e?.message || '请重试'); render(); }
      finally { btn.disabled = false; }
    };
    id('appUpdateCancel').onclick = async () => {
      try { await bridge.call('device.update', {action:'cancel'}); notice = '正在取消下载…'; render(); }
      catch (e) { notice = '取消失败：' + (e?.message || '请重试'); render(); }
    };
    id('appUpdateInstall').onclick = async () => {
      const btn = id('appUpdateInstall'); btn.disabled = true;
      try {
        const result = await bridge.call('device.update', {action:'install'});
        notice = result.needsPermission
          ? '请允许 Easybook 安装应用，返回后再次点击安装更新。'
          : '已打开 Android 系统安装器，请确认安装。';
      } catch(e) { notice = '安装失败：' + (e?.message || '请重试'); }
      finally { btn.disabled = false; render(); }
    };
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && sheet.open)
        void bridge.call('device.update', {action:'state'}).then(render).catch(() => {});
    });
    // Shared Web UI's static version footer is not the installed APK's build version.
    // The updater dialog always uses BuildConfig values returned by the native bridge.
    void bridge.call('device.update', {action:'state'}).then(render).catch(() => {});
    return true;
  }

  if (!activate()) {
    const observer = new MutationObserver(() => { if (activate()) observer.disconnect(); });
    observer.observe(document.documentElement, {childList:true, subtree:true});
  }
})();
