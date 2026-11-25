// Project the Android update dialog and batch action bar onto QWEA0 surfaces.
(() => {
 const ids = ['batchbar', 'appUpdateDialog'];
 const root = document.documentElement;
 const transparency = matchMedia('(prefers-reduced-transparency:reduce)');
 const darkScheme = matchMedia('(prefers-color-scheme:dark)');
 const skin = document.createElement('style');
 skin.textContent = `
   #batchbar.native-chrome-mounted, #appUpdateDialog.native-chrome-mounted { opacity: 0 !important }
   #appUpdateDialog.native-chrome-mounted::backdrop { backdrop-filter: none; -webkit-backdrop-filter: none }
 `;
 document.head.append(skin);
 let keyboard = false;

 const surfaces = ids.map((id, slot) => {
  const prefix = `Chrome${slot}`;
  const tokens = new WeakMap(), buttons = new Map();
  let source, nextToken = 0, revision = 0, mounted = false, disabled = false;
  let queued = false, until = 0, last = '', content, signature = '', dirty = true;
  const call = args => window.NativeStore.call('ui.glass.chrome', {slot, ...args});
  const sizeObserver = new ResizeObserver(schedule);

  function hide() {
   if (mounted) source?.classList.remove('native-chrome-mounted');
   mounted = false;
   if (last === 'closed' || !last) return;
   last = 'closed';
   dirty = true;
   signature = '';
   call({visible: false}).catch(() => {});
  }

  function fallback() {
   disabled = true;
   hide();
  }

  function visible() {
   if (!source?.isConnected || document.hidden || keyboard || root.dataset.glass === 'reduced'
       || transparency.matches || Math.abs((window.visualViewport?.scale || 1) - 1) > .01) return false;
   // The main document continues to handle modal focus and Back.
   const dialogs = document.querySelectorAll('dialog[open]');
   return slot === 0 ? !source.hidden && !dialogs.length : source.open && dialogs.length === 1;
  }

  function describe() {
   const clone = source.cloneNode(true);
   const copies = [...clone.querySelectorAll('button')];
   buttons.clear();
   [...source.querySelectorAll('button')].forEach((button, index) => {
    let token = tokens.get(button);
    if (!token) {
     token = `c-${++nextToken}`;
     tokens.set(button, token);
    }
    buttons.set(token, button);
    copies[index].dataset.formatToken = token;
   });
   const css = [...document.querySelectorAll('style')].filter(node => node !== skin).map(node => node.textContent).join('\n');
   const properties = getComputedStyle(root);
   const rootStyle = Array.from(properties).filter(name => name.startsWith('--'))
     .map(name => `${name}:${properties.getPropertyValue(name)};`).join('');
   return {html: clone.innerHTML, css, symbols: '', rootStyle, bodyClass: document.body.className,
     panel: id, theme: root.dataset.theme || 'auto'};
  }

  function sync() {
   if (disabled) return;
   const current = document.getElementById(id);
   if (current !== source) {
    hide();
    if (source) sizeObserver.unobserve(source);
    source = current;
    if (source) sizeObserver.observe(source);
    dirty = true;
   }
   if (!visible()) {
    hide();
    return;
   }
   const rect = source.getBoundingClientRect(), css = getComputedStyle(source);
   if (rect.width < 1 || rect.height < 1 || css.display === 'none') {
    hide();
    return;
   }
   let changed = false;
   if (dirty) {
    const next = describe(), key = JSON.stringify(next);
    if (key !== signature) {
     signature = key;
     content = next;
     revision++;
     changed = true;
    }
    dirty = false;
   }
   const viewport = window.visualViewport;
   const params = {
    visible: true, left: rect.left - (viewport?.offsetLeft || 0), top: rect.top - (viewport?.offsetTop || 0),
    width: rect.width, height: rect.height, viewportWidth: viewport?.width || root.clientWidth,
    dark: content.theme === 'dark' || content.theme !== 'light' && darkScheme.matches,
    opacity: mounted ? 1 : Number(css.opacity), corner: Math.min(rect.width / 2, rect.height / 2,
      parseFloat(css.borderTopLeftRadius) || 0), scrollTop: Math.min(100000, Math.max(0, source.scrollTop)),
    mounted, revision
   };
   const key = JSON.stringify(params);
   if (key === last && !changed) return;
   last = key;
   if (changed || !mounted) params.content = content;
   call(params).then(result => { if (!result.accepted) fallback(); }).catch(fallback);
  }

  function tick() {
   queued = false;
   sync();
   if (!disabled && visible() && performance.now() < until) schedule();
  }

  function schedule() {
   if (queued || disabled) return;
   queued = true;
   requestAnimationFrame(tick);
  }

  window[`easybookSync${prefix}Surface`] = schedule;
  window[`easybook${prefix}SurfaceFallback`] = fallback;
  window[`easybook${prefix}SurfaceReady`] = value => {
   if (!disabled && visible() && last !== 'closed' && value === revision && !mounted) {
    mounted = true;
    source.classList.add('native-chrome-mounted');
    schedule();
   }
  };
  window[`easybook${prefix}SurfaceClick`] = token => {
   const button = buttons.get(token);
   if (button && mounted && visible() && source.contains(button) && !button.hidden && !button.disabled
       && button.getClientRects().length) button.click();
  };
  window[`easybook${prefix}SurfaceScroll`] = top => {
   if (mounted && visible()) source.scrollTop = top;
  };

  return {
   schedule, hide,
   mutations(records) {
    const replacement = document.getElementById(id) !== source;
    const themeChanged = records.some(({target, attributeName}) =>
      target === root && attributeName === 'data-theme');
    if (themeChanged) hide();
    if (replacement || records.some(({target, attributeName, type}) =>
      source?.contains(target) && !(target === source && attributeName === 'class') ||
      type === 'childList' && target === document.head)) dirty = true;
    if (replacement || records.some(({target, attributeName}) =>
      target === source && ['open', 'hidden'].includes(attributeName))) {
     until = performance.now() + 400;
    }
    if (source && !visible()) hide();
    schedule();
   }
  };
 });

 const schedule = () => surfaces.forEach(surface => surface.schedule());
 new MutationObserver(records => surfaces.forEach(surface => surface.mutations(records))).observe(root,
   {subtree: true, childList: true, attributes: true, characterData: true});
 document.addEventListener('keydown', event => {
  if (event.key === 'Tab') {
   keyboard = true;
   surfaces.forEach(surface => surface.hide());
  }
 }, true);
 document.addEventListener('pointerdown', () => {
  if (keyboard) { keyboard = false; schedule(); }
 }, true);
 for (const type of ['resize', 'scroll']) {
  window.addEventListener(type, schedule, true);
  window.visualViewport?.addEventListener(type, schedule);
 }
 document.addEventListener('visibilitychange', () => {
  if (document.hidden) surfaces.forEach(surface => surface.hide());
  else schedule();
 });
 transparency.addEventListener('change', schedule);
 darkScheme.addEventListener('change', () => {
  surfaces.forEach(surface => surface.hide());
  schedule();
 });
 schedule();
})();
