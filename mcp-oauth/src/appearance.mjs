export const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Standalone OAuth pages share Easybook's settings colors, type scale and control geometry.
export const oauthAppearance = `<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="light dark"><style>
:root{--ink:#1c1c1e;--muted:#8e8e93;--accent:#b88a00;--bg:#f2f2f7;--paper:#fff;--line:#e5e5ea;--selected:#e9e9ee;--on-accent:#241c00;--danger:#ff3b30}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:17px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;padding:calc(28px + env(safe-area-inset-top)) max(20px,env(safe-area-inset-right)) max(28px,env(safe-area-inset-bottom)) max(20px,env(safe-area-inset-left));overflow-wrap:anywhere}body>*{max-width:640px;margin-left:auto;margin-right:auto}h1{font-size:34px;line-height:1.2;letter-spacing:-1px;margin-top:12px;margin-bottom:24px}p{font-size:15px;color:var(--muted)}strong{color:var(--ink);font-weight:600}form{display:flex;flex-wrap:wrap;gap:12px;padding:20px;background:var(--paper);border-radius:20px;margin-top:24px}button,a{font:inherit;min-height:44px;border:0;border-radius:22px;padding:11px 18px;cursor:pointer;transition:opacity .12s}button{background:var(--selected);color:var(--ink);flex:1 1 180px}button[value=allow],a{background:var(--accent);color:var(--on-accent);font-weight:600}button[value=deny]{color:var(--danger)}a{display:inline-block;text-decoration:none}button:active,a:active{opacity:.65}button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:3px}@media(prefers-color-scheme:dark){:root{--ink:#f2f2f7;--muted:#98989f;--accent:#e6bb32;--bg:#000;--paper:#1c1c1e;--line:#38383a;--selected:#333335;--on-accent:#241c00}}@media(prefers-reduced-motion:reduce){*{transition:none}}
</style>`;

export const htmlHeaders = {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://github.com; frame-ancestors 'none'"};


// Chromium applies form-action to the OAuth POST's redirect as well. Allow only
// the callback target already validated against this OAuth client's registration.
export function oauthConsentHeaders(redirectUri){
 const url=new URL(redirectUri),protocol=url.protocol;
 const source=['https:','http:'].includes(protocol)?url.origin:protocol;
 if(!/^[a-z][a-z0-9+.-]*:$/.test(protocol)||['javascript:','data:','blob:','file:','about:'].includes(protocol)||/[\s;'"<>]/.test(source))throw Error('Unsafe OAuth callback policy');
 return {'Content-Security-Policy':`default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${source}; frame-ancestors 'none'`};
}
