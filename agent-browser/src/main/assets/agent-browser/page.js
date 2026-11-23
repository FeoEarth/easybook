(() => {
  const port = browser.runtime.connectNative('easybookAgentBrowser');
  const clean = (text, size) => (text || '').replace(/\s+/g, ' ').trim().slice(0, size);
  const challenge = () => document.querySelector('#challenge-form,#anomaly-modal,.anomaly-modal,iframe[src*="captcha"],#cf-challenge-running,form#challenge-form') ||
    /^(just a moment|too many requests|access denied|attention required)/i.test(document.title);
  const visible = node => node.getClientRects().length && getComputedStyle(node).visibility === 'visible';
  const searchHost = () => ['duckduckgo.com','html.duckduckgo.com','lite.duckduckgo.com'].includes(location.hostname);
  function collectLinks() {
    const results = [], seen = new Set();
    const matches = searchHost() ? 'a[data-testid="result-title-a"],a.result__a,a.result-link' : 'a[href]';
    for (const anchor of [...document.querySelectorAll(matches)].slice(0, 500)) {
      if (!visible(anchor) || anchor.hasAttribute('download') || anchor.closest('form,[data-testid="ad"],.result--ad')) continue;
      let url;
      try {
        url = new URL(anchor.href);
        if (searchHost() && /(^|\.)duckduckgo\.com$/.test(url.hostname) && url.pathname === '/l/') {
          url = new URL(url.searchParams.get('uddg'));
        }
        if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 2048 || seen.has(url.href)) continue;
      } catch { continue; }
      const title = clean(anchor.innerText || anchor.getAttribute('aria-label'), 140);
      if (!title) continue;
      seen.add(url.href);
      const snippet = searchHost() ? clean(anchor.closest('article,.result,[data-testid="result"]')
        ?.querySelector('[data-result="snippet"],[data-testid="result-snippet"],.result__snippet')?.innerText, 160) : '';
      results.push({url:url.href,title,snippet});
      if (results.length === 18) break;
    }
    return results;
  }
  function pageText() {
    const root = document.querySelector('main,article,[role="main"]') || document.body;
    if (!root) return '';
    if (!window.scrollY) return clean(root.innerText, 3900);
    const paragraphs = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let nodes = 0, length = 0;
    while (walker.nextNode() && nodes++ < 12000 && length < 3900) {
      const node = walker.currentNode, parent = node.parentElement;
      if (!parent || parent.closest('script,style,form,[contenteditable],textarea,select') || !visible(parent)) continue;
      const rect = parent.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) continue;
      const text = clean(node.textContent, 3900 - length);
      if (text) { paragraphs.push(text); length += text.length + 1; }
    }
    return clean(paragraphs.join(' '), 3900);
  }
  function sendSnapshot(id) {
    if (challenge()) { port.postMessage({id,url:location.href,blocked:true}); return; }
    if (document.querySelector('input[type="password"]')) { port.postMessage({id,url:location.href,signIn:true}); return; }
    port.postMessage({id,url:location.href,title:clean(document.title,180),text:pageText(),links:collectLinks()});
  }
  port.onMessage.addListener(message => {
    if (!message || !Number.isInteger(message.id)) return;
    if (message.op === 'scroll') {
      const scrollArea = [...document.querySelectorAll('main,[role="main"],article')].find(node =>
        node.clientHeight > 60 && node.scrollHeight > node.clientHeight + 8 && /auto|scroll/.test(getComputedStyle(node).overflowY));
      (scrollArea || window).scrollBy(0, (scrollArea?.clientHeight || window.innerHeight) * (message.direction === 'up' ? -0.85 : 0.85));
      setTimeout(() => sendSnapshot(message.id), 400);
    } else if (message.op === 'read') sendSnapshot(message.id);
  });
  document.addEventListener('submit', event => {
    if (challenge()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    port.postMessage({form:true,url:location.href});
  }, true);
})();
