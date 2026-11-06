/**
 * The dashboard page: one self-contained HTML document, vanilla JS, no build step.
 * The only external request is the KoPubWorld Dotum webfont (CSP font-src allows just that CDN); without it the page falls back to Malgun Gothic.
 */
/** Signature mark: a J drawn as one trace between two terminals (a connection), on the brand gradient. */
export const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="jg" x1="3" y1="2" x2="29" y2="30" gradientUnits="userSpaceOnUse"><stop stop-color="#6DB3FF"/><stop offset="1" stop-color="#2358D4"/></linearGradient><linearGradient id="jh" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff" stop-opacity=".24"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>' +
    '<rect width="32" height="32" rx="9" fill="url(#jg)" stroke="none"/><rect width="32" height="32" rx="9" fill="url(#jh)" stroke="none"/>' +
    '<path d="M20.5 9.6v8.7a5.2 5.2 0 0 1-9.1 3.4" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>' +
    '<circle cx="20.5" cy="7" r="3.3" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.4"/><circle cx="20.5" cy="7" r="1.6" fill="#fff" stroke="none"/>' +
    '<circle cx="11.4" cy="21.7" r="3.3" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.4"/><circle cx="11.4" cy="21.7" r="1.6" fill="#fff" stroke="none"/></svg>';
const DARK = `--bg:#0B0F19;--panel:#111827;--soft:#0E1422;--line:#1E2738;--text:#E7ECF5;--muted:#8E9BB3;--brand:#6C9CFF;--brand-h:#8DB2FF;--brand-soft:#15244A;--glow:rgba(108,156,255,.07);--ok:#4ADE9A;--warn:#F2B94B;--bad:#FF8279;--idle:#9AA7BE;--idle-bg:#1E2738;--side:#080C14;--shadow:0 1px 2px rgba(0,0,0,.3);--term:#070B13;--top:rgba(11,15,25,.82)`;
const PAGE = String.raw `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Jarvis</title>
<link rel="icon" type="image/svg+xml" href="__FAVICON__">
<script>try{var __t=localStorage.getItem("jt-theme");if(__t)document.documentElement.setAttribute("data-theme",__t);}catch(e){}</script>
<style>
@font-face{font-family:"KoPubWorldDotum";font-weight:300 599;font-display:swap;src:local("KoPubWorld Dotum Medium"),local("KoPubWorld돋움체 Medium"),url(https://cdn.jsdelivr.net/npm/font-kopubworld@1.0.3/fonts/KoPubWorld-Dotum-Medium.woff2) format("woff2")}
@font-face{font-family:"KoPubWorldDotum";font-weight:600 900;font-display:swap;src:local("KoPubWorld Dotum Bold"),local("KoPubWorld돋움체 Bold"),url(https://cdn.jsdelivr.net/npm/font-kopubworld@1.0.3/fonts/KoPubWorld-Dotum-Bold.woff2) format("woff2")}
:root{--bg:#F6F7FA;--panel:#FFFFFF;--soft:#F8F9FC;--line:#E8EBF1;--text:#111827;--muted:#6B7280;--brand:#2F6FED;--brand-h:#2559C8;--brand-soft:#EEF3FF;--glow:rgba(47,111,237,.06);
 --ok:#0E9F6E;--warn:#B7791F;--bad:#D6453D;--idle:#6B7280;--idle-bg:#ECEFF4;
 --side:#0F172A;--shadow:0 1px 2px rgba(16,24,40,.04);--term:#0D1322;--top:rgba(246,247,250,.82);--side-text:#9AA6BC;--side-on:#fff;--tint-ok:#EAF7F1;--tint-bad:#FCEEED;--tint-warn:#FBF3E4}
:root[data-theme=dark]{${DARK};--tint-ok:#0F2A21;--tint-bad:#2D1717;--tint-warn:#2C2412}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){${DARK};--tint-ok:#0F2A21;--tint-bad:#2D1717;--tint-warn:#2C2412}}
*{box-sizing:border-box}html{scroll-behavior:smooth;color-scheme:light dark;scrollbar-gutter:stable}
body{margin:0;font:500 14px/1.65 "KoPubWorldDotum","KoPubWorld Dotum","KoPubWorld돋움체","Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif;background:radial-gradient(900px 380px at 82% -140px,var(--glow),transparent 70%),var(--bg);background-attachment:fixed;color:var(--text);-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
b,h1,h2,h3,.btn.p{font-weight:700}
.mono,pre{font-family:Consolas,"SF Mono",Menlo,monospace}
svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;flex:none}
.hide{display:none!important}
body.modal-open{overflow:hidden}
.app{display:grid;grid-template-columns:232px 1fr;min-height:100vh}
.side{position:sticky;top:0;height:100vh;background:var(--side);color:var(--side-text);display:flex;flex-direction:column;padding:26px 14px 20px}
.brand{display:flex;align-items:center;gap:12px;padding:0 10px 30px}
.logo{width:38px;height:38px;flex:none}.logo svg{width:100%;height:100%;display:block;filter:drop-shadow(0 4px 10px rgba(47,111,237,.38))}
.brand b{display:block;color:#fff;font-size:16px;line-height:1.25;letter-spacing:.2px}.brand small{font-size:11.5px;opacity:.55}
.side nav{display:flex;flex-direction:column;gap:2px}
.side nav button{display:flex;align-items:center;gap:12px;border:0;background:transparent;color:inherit;padding:10px 12px;border-radius:10px;font:inherit;cursor:pointer;text-align:left;position:relative;transition:background .15s,color .15s}
.side nav button:hover{background:rgba(255,255,255,.06);color:var(--side-on)}
.side nav button.on{background:rgba(255,255,255,.09);color:var(--side-on);font-weight:700}
.side nav .dirty{margin-left:auto;width:7px;height:7px;border-radius:50%;background:#F2B94B}
.side-foot{margin-top:auto;padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.08);font-size:12.5px}
.side-foot div{display:flex;align-items:center;gap:9px;padding:3px 0}.side-foot span.l{opacity:.55;width:34px}
.dot{width:8px;height:8px;border-radius:50%;background:#64748B;flex:none}
.dot.ok{background:#34D399}.dot.warn{background:#FBBF24;animation:pulse 1.2s infinite}.dot.bad{background:#F87171}
@keyframes pulse{50%{opacity:.3}}@keyframes spin{to{transform:rotate(360deg)}}
.content{min-width:0}
.top{position:sticky;top:0;z-index:6;display:flex;align-items:center;gap:16px;padding:26px max(44px,calc((100% - 1120px)/2 + 44px)) 16px;background:var(--top);backdrop-filter:blur(14px) saturate(1.3);border-bottom:1px solid transparent;transition:border-color .2s}
.top.stuck{border-bottom-color:var(--line)}
.page-h h1{margin:0;font-size:24px;letter-spacing:-.4px}.page-h p{margin:2px 0 0;color:var(--muted);font-size:13px}
.top-r{margin-left:auto;display:flex;align-items:center;gap:14px}
.live{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--muted)}.live.off{color:var(--bad)}
.icon-btn{width:34px;height:34px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--muted);display:grid;place-items:center;cursor:pointer;transition:.15s}.icon-btn:hover{color:var(--text);background:var(--soft)}
main{padding:10px 44px 100px;max-width:1120px;width:100%;margin:0 auto}
.card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:28px 30px;margin-bottom:24px;box-shadow:var(--shadow)}
.card h2{margin:0;font-size:15.5px;letter-spacing:-.2px}.card .sub{margin:3px 0 20px;color:var(--muted);font-size:13px}
.card-h{display:flex;align-items:center;gap:12px;margin-bottom:20px}.card-h .sub{margin:0}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px}.grid .card{margin-bottom:0;display:flex;flex-direction:column}.grid .card .actions{margin-top:auto}.grid .card .msg{margin-bottom:16px}
.hero{background:var(--panel);border:1px solid var(--line);border-radius:20px;box-shadow:var(--shadow);margin-bottom:24px;overflow:hidden;position:relative}
.hero:before{content:"";position:absolute;inset:0;background:radial-gradient(480px 180px at 0% 0%,var(--hg,transparent),transparent 72%);pointer-events:none}
.hero.ok{--hg:var(--tint-ok)}.hero.warn{--hg:var(--tint-warn)}.hero.bad{--hg:var(--tint-bad)}
.hero-top{position:relative;display:flex;align-items:center;gap:22px;padding:32px 34px 28px}
.hero .big{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;flex:none;background:var(--idle-bg);color:var(--idle)}.hero .big svg{width:24px;height:24px;stroke-width:2.4}
.hero.ok .big{background:var(--tint-ok);color:var(--ok)}.hero.warn .big{background:var(--tint-warn);color:var(--warn)}.hero.bad .big{background:var(--tint-bad);color:var(--bad)}
.hero h2{margin:0;font-size:22px;letter-spacing:-.4px}.hero p{margin:4px 0 0;color:var(--muted);max-width:560px}
.hero .actions{margin-left:auto;flex:none}
.link{background:none;border:0;padding:0;color:var(--brand);font:inherit;font-size:13px;cursor:pointer}.link:hover{text-decoration:underline}
.fixw{margin-top:10px}.fix{margin-top:10px;max-width:560px;padding:12px 14px;border-radius:12px;background:var(--soft);border:1px solid var(--line);color:var(--muted);font-size:13px}
.metrics{position:relative;display:grid;grid-template-columns:1fr 1.25fr .8fr 1.75fr;border-top:1px solid var(--line)}
.metric{padding:18px 34px;min-width:0}.metric+.metric{border-left:1px solid var(--line)}
.metric .ml{color:var(--muted);font-size:12px}.metric .mv{font-size:17px;font-weight:700;margin-top:2px;letter-spacing:-.3px}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.chip{font-size:12px;padding:1px 10px;border-radius:999px;border:1px solid var(--line);color:var(--text)}.chip.off{color:var(--muted);text-decoration:line-through;opacity:.7}.chip.risk{color:var(--warn);border-color:var(--warn)}
.sk{color:transparent!important;background:linear-gradient(90deg,var(--idle-bg) 25%,var(--soft) 50%,var(--idle-bg) 75%);background-size:200% 100%;animation:sh 1.3s infinite;border-radius:6px;display:inline-block;min-width:70px}
@keyframes sh{to{background-position:-200% 0}}
section{animation:fade .25s ease}@keyframes fade{from{opacity:0;transform:translateY(6px)}}
.hint{display:flex;gap:12px;align-items:flex-start;background:var(--tint-warn);color:var(--warn);border-radius:14px;padding:13px 16px;margin-bottom:24px;font-size:13.5px}.hint svg{margin-top:2px}.hint.info{background:var(--brand-soft);color:var(--brand)}.hint.bad{background:var(--tint-bad);color:var(--bad)}
.hint .btn{margin-left:auto;flex:none}
.kv{display:grid;grid-template-columns:84px 1fr;gap:6px 14px;font-size:13px;margin-bottom:16px}.kv .k{color:var(--muted)}.kv .v{word-break:break-all}
.msg{color:var(--muted);font-size:12.5px;min-height:20px;margin:-6px 0 14px}.msg.err{color:var(--bad)}
.pill{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:700;color:var(--idle);margin-left:auto}
.pill .dot{background:currentColor}.pill.ok{color:var(--ok)}.pill.warn{color:var(--warn)}.pill.warn .dot{animation:pulse 1.2s infinite}.pill.bad{color:var(--bad)}
.stats{margin-left:auto;display:flex;gap:18px}.stats .pill{margin:0}
.chart{display:flex;align-items:flex-end;gap:4px;height:84px;border-bottom:1px solid var(--line)}
.bar{flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%;min-width:3px}
.bar i{display:block;width:100%}.bar .o{background:var(--brand);opacity:.85;border-radius:3px 3px 0 0}.bar .b{background:var(--bad);border-radius:3px 3px 0 0}.bar i+i{margin-top:1px}
.bar:hover .o{opacity:1}
.axis{display:flex;justify-content:space-between;color:var(--muted);font-size:11.5px;margin:8px 0 20px}
.feed{display:flex;flex-direction:column}
.ev{display:grid;grid-template-columns:78px 150px 1fr auto;gap:14px;align-items:center;padding:11px 0;border-top:1px solid var(--line);font-size:13px}
.ev .st{font-size:12.5px;font-weight:700;color:var(--ok);display:flex;align-items:center;gap:7px}.ev .st:before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}.ev .st.bad{color:var(--bad)}
.ev .tn{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ev .dt{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ev .tm{color:var(--muted);font-size:12px}
.empty-a{display:flex;flex-direction:column;align-items:center;gap:8px;padding:30px 10px 10px;color:var(--muted);text-align:center}.empty-a svg{width:30px;height:30px;opacity:.4}
.field{display:grid;grid-template-columns:110px 1fr auto;align-items:center;gap:12px;margin:12px 0}
.field .lab{color:var(--muted);font-size:13px}
.field .val{background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:8px 14px;min-height:38px;display:flex;align-items:center;font-family:Consolas,"SF Mono",Menlo,monospace;font-size:12.5px;word-break:break-all;min-width:0}
.field .val.empty{color:var(--muted);font-family:inherit}.field .acts{display:flex;gap:6px}
.code{position:relative;background:var(--term);color:#D7E0F2;border-radius:12px;padding:18px 20px;font:12.5px/1.75 Consolas,"SF Mono",Menlo,monospace;white-space:pre-wrap;word-break:break-all;margin:0 0 4px}
.code-bar{display:flex;align-items:center;gap:10px;margin-top:12px}.code-bar span{color:var(--muted);font-size:12.5px}.code-bar .btn{margin-left:auto}
.tabs-c{margin-bottom:18px}
.actions{display:flex;gap:8px;flex-wrap:wrap}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:36px;border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:10px;padding:0 16px;font:inherit;cursor:pointer;transition:background .12s,border-color .12s,color .12s,transform .05s;white-space:nowrap}
.btn:hover:not(:disabled){background:var(--soft);border-color:var(--muted)}.btn:active:not(:disabled){transform:translateY(1px)}
.btn.p{background:var(--brand);border-color:var(--brand);color:#fff}.btn.p:hover:not(:disabled){background:var(--brand-h);border-color:var(--brand-h)}
.btn.d{color:var(--bad)}.btn.d:hover:not(:disabled){background:var(--tint-bad);border-color:var(--bad)}.btn.d.p{background:var(--bad);border-color:var(--bad);color:#fff}.btn.d.p:hover:not(:disabled){background:var(--bad);filter:brightness(.92)}
.btn.sm{height:30px;padding:0 12px;font-size:12.5px;border-radius:8px}.btn:disabled{opacity:.4;cursor:not-allowed}
.btn.busy{pointer-events:none;opacity:.75}.btn.busy:before{content:"";width:13px;height:13px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin .7s linear infinite}
button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
input[type=text],textarea{width:100%;border:1px solid var(--line);border-radius:10px;padding:10px 14px;font-size:13px;background:var(--soft);color:var(--text);font-family:Consolas,"SF Mono",Menlo,monospace}
textarea{min-height:128px;resize:vertical;line-height:1.75}input[type=text]:focus,textarea:focus{background:var(--panel)}
.lbl{display:block;margin:16px 0 6px;font-size:13.5px}.lbl small{color:var(--muted);font-weight:500;margin-left:8px}
.opt{display:flex;align-items:center;gap:16px;padding:16px 0;border-top:1px solid var(--line)}.opt:first-of-type{border-top:0;padding-top:4px}
.opt .t{flex:1}.opt .t b{display:block;font-size:14px}.opt .t span{color:var(--muted);font-size:12.5px}
.sw{position:relative;width:44px;height:25px;flex:none}.sw input{opacity:0;position:absolute;inset:0;margin:0;cursor:pointer;z-index:1}
.sw i{position:absolute;inset:0;border-radius:999px;background:var(--idle-bg);transition:.18s}
.sw i:after{content:"";position:absolute;left:3px;top:3px;width:19px;height:19px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:.18s}
.sw input:checked+i{background:var(--brand)}.sw input:checked+i:after{left:22px}.sw input:focus-visible+i{outline:2px solid var(--brand);outline-offset:2px}
.sw.danger input:checked+i{background:#D69E2E}
.savebar{position:sticky;bottom:20px;display:flex;align-items:center;gap:12px;padding:12px 16px 12px 22px;background:var(--panel);border:1px solid var(--line);border-radius:14px;box-shadow:0 10px 36px rgba(16,24,40,.14);z-index:3}
.savebar .st{margin-right:auto;font-size:13px;color:var(--muted)}.savebar .st.dirty{color:var(--warn)}.savebar .st.err{color:var(--bad)}
.seg{display:inline-flex;background:var(--idle-bg);border-radius:10px;padding:3px;gap:2px}
.seg button{border:0;background:transparent;color:var(--muted);padding:5px 14px;border-radius:8px;font:inherit;cursor:pointer}.seg button.on{background:var(--panel);color:var(--text);font-weight:700;box-shadow:0 1px 2px rgba(0,0,0,.1)}
.toolbar{display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap}.toolbar input[type=text]{width:220px;font-family:inherit;padding:6px 13px;height:34px}
.toolbar .chk{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:13px;margin-left:auto}
.tl-count{margin-left:auto;color:var(--muted);font-size:13px}
.tl{display:grid;grid-template-columns:minmax(150px,230px) 1fr auto;gap:6px 18px;align-items:start;padding:13px 0;border-top:1px solid var(--line)}.tl:first-child{border-top:0;padding-top:0}.tl:last-child{padding-bottom:0}
.tl .n{font-weight:700;font-size:13px;word-break:break-all;padding-top:1px}.tl .d{color:var(--muted);font-size:13px;overflow-wrap:anywhere}.tl .chip{margin-top:0;white-space:nowrap}
.tl-empty{padding:34px 10px;text-align:center;color:var(--muted)}.tl-empty.err{color:var(--bad)}
.term{background:var(--term);border-radius:16px;padding:16px 4px;min-height:380px;max-height:66vh;overflow:auto;overscroll-behavior:contain;font:12px/1.7 Consolas,"SF Mono",Menlo,monospace}
.term div{padding:0 20px;white-space:pre-wrap;word-break:break-all;color:#CBD5E6}.term div:hover{background:rgba(255,255,255,.04)}
.term .bad{color:#FF8A80}.term .warn{color:#FFD27A}.term .ok{color:#7EE2B0}.term .empty{color:#7C89A3;padding:40px 16px;text-align:center;font-family:inherit}
.dir{display:flex;align-items:center;gap:14px;padding:12px 2px;border-top:1px solid var(--line)}.dir:first-child{border-top:0;padding-top:2px}
.dir-i{width:38px;height:38px;border-radius:10px;background:var(--brand-soft);color:var(--brand);display:grid;place-items:center;flex:none}
.dir-t{flex:1;min-width:0}.dir-t b{display:block;font-size:14px}.dir-t span{display:block;color:var(--muted);font-size:12px;font-family:Consolas,"SF Mono",Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dir-empty{padding:26px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:12px}
.dir-add{margin-top:16px}
.ag-card{display:flex;flex-direction:column;gap:12px;padding:20px;border:1px solid var(--line);border-radius:14px;background:var(--soft);margin-bottom:14px}
.ag-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.ag-name{font-size:15px;font-weight:700}
.ag-ver{font-size:12px;color:var(--muted);background:var(--idle-bg);padding:2px 8px;border-radius:6px}
.ag-meta{margin-left:auto;display:flex;align-items:center;gap:16px;font-size:12.5px;color:var(--muted)}
.ag-tools{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.ag-tools .chip{background:var(--panel)}
.ag-empty{padding:40px 16px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:14px}
.dlg.pk{width:min(620px,94vw)}.dlg.pk h3{margin-bottom:14px}
.pk-places{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
.place{border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:999px;padding:3px 14px;font:inherit;font-size:12.5px;cursor:pointer}.place:hover{border-color:var(--brand);color:var(--brand)}
.pk-bar{display:flex;align-items:center;gap:10px;margin-bottom:8px}.pk-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;color:var(--muted)}
.pk-list{border:1px solid var(--line);border-radius:12px;height:292px;overflow:auto;overscroll-behavior:contain;background:var(--soft)}
.fr{display:flex;align-items:center;gap:8px;padding:6px 8px 6px 12px;border-bottom:1px solid var(--line)}.fr:last-child{border-bottom:0}.fr:hover{background:var(--panel)}
.fr .nm{flex:1;min-width:0;border:0;background:none;font:inherit;color:var(--text);cursor:pointer;display:flex;align-items:center;gap:10px;padding:4px 0;text-align:left;overflow:hidden;white-space:nowrap}.fr .nm svg{color:var(--brand)}.fr .nm span{overflow:hidden;text-overflow:ellipsis}
.pk-empty{padding:40px 16px;text-align:center;color:var(--muted)}
.pk-in{display:flex;gap:8px;margin:12px 0 4px}.pk-in input{height:34px;padding:6px 12px}
.dlg.pk .msg{margin:2px 0 0}.dlg.pk .actions{margin-top:12px}
#toasts{position:fixed;right:24px;bottom:24px;display:flex;flex-direction:column;gap:10px;z-index:30}
.toast{background:#111827;color:#fff;padding:12px 18px;border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.28);animation:in .2s;max-width:380px;font-size:13.5px}.toast.bad{background:#7F1D1D}.toast.ok{background:#14532D}
@keyframes in{from{opacity:0;transform:translateY(8px)}}
.modal{position:fixed;inset:0;background:rgba(10,14,24,.5);display:grid;place-items:center;z-index:40;backdrop-filter:blur(3px)}
.dlg{background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:28px 30px;width:min(440px,92vw);box-shadow:0 24px 64px rgba(0,0,0,.35);animation:in .15s}
.dlg h3{margin:0 0 8px;font-size:17px}.dlg p{margin:0 0 24px;color:var(--muted)}.dlg .actions{justify-content:flex-end}
.gate{position:fixed;inset:0;background:var(--bg);display:grid;place-items:center;z-index:50;padding:24px}.gate .card{max-width:520px;text-align:center}
@media(max-width:1100px){.app{grid-template-columns:68px 1fr}.brand div:last-child,.side nav button .t,.side-foot span.l,.side-foot span:last-child{display:none}.brand{padding:0 0 24px;justify-content:center}.side nav button{justify-content:center;padding:12px}.side nav .dirty{position:absolute;top:8px;right:8px;margin:0}.side-foot{padding:12px 8px}.side-foot div{justify-content:center}}
@media(max-width:820px){.app{grid-template-columns:1fr}.side{position:static;height:auto;flex-direction:row;align-items:center;padding:10px 14px;gap:10px}.brand{padding:0}.side nav{flex-direction:row;margin-left:8px}.side-foot{display:none}.top{padding:16px}main{padding:6px 16px 90px}.grid{grid-template-columns:1fr}.field{grid-template-columns:1fr}.hero-top{flex-wrap:wrap;padding:24px}.hero .actions{margin-left:0}.metrics{grid-template-columns:1fr 1fr}.metric{padding:14px 24px}.metric+.metric{border-left:0}.metric:nth-child(even){border-left:1px solid var(--line)}.metric:nth-child(n+3){border-top:1px solid var(--line)}.ev{grid-template-columns:70px 1fr auto}.ev .dt{display:none}.live{display:none}.tl{grid-template-columns:1fr auto}.tl .d{grid-column:1/-1;order:3}.side nav button .t{display:inline}.side nav button{padding:10px 12px;white-space:nowrap}.side nav{overflow-x:auto;flex:1}#toasts{left:16px;right:16px}#toasts .toast{max-width:none}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*,*::before,*::after{animation:none!important;transition:none!important}}
</style></head><body>
<div class="app">
<aside class="side">
 <div class="brand"><div class="logo">__LOGO__</div><div><b>Jarvis</b><small id="ver">v__VERSION__</small></div></div>
 <nav role="tablist" aria-label="대시보드 화면">
  <button data-tab="status" class="on" role="tab" id="nav-status" aria-selected="true" aria-controls="tab-status"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg><span class="t">대시보드</span></button>
  <button data-tab="tools" role="tab" id="nav-tools" aria-selected="false" aria-controls="tab-tools"><svg viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg><span class="t">도구</span></button>
  <button data-tab="agents" role="tab" id="nav-agents" aria-selected="false" aria-controls="tab-agents"><svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg><span class="t">에이전트</span></button>
  <button data-tab="settings" role="tab" id="nav-settings" aria-selected="false" aria-controls="tab-settings"><svg viewBox="0 0 24 24"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg><span class="t">설정</span><i class="dirty hide" id="nav-dirty" title="저장하지 않은 변경"></i></button>
  <button data-tab="logs" role="tab" id="nav-logs" aria-selected="false" aria-controls="tab-logs"><svg viewBox="0 0 24 24"><path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg><span class="t">로그</span></button>
 </nav>
 <div class="side-foot"><div><span class="l">엔진</span><i class="dot" id="sf-sv"></i><span id="sf-sv-t">-</span></div><div><span class="l">터널</span><i class="dot" id="sf-tn"></i><span id="sf-tn-t">-</span></div></div>
</aside>
<div class="content">
<header class="top" id="top">
 <div class="page-h"><h1 id="page-title">대시보드</h1><p id="page-sub"></p></div>
 <div class="top-r"><span class="live" id="live"><i class="dot ok"></i><span id="live-t">실시간</span></span><button class="icon-btn" id="theme" aria-label="테마 전환"></button></div>
</header>
<main>
 <div class="hint bad hide" id="conn-banner" role="alert"><svg viewBox="0 0 24 24"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18.5v.5"/></svg><span>대시보드가 Jarvis와 연결되지 않았습니다. Jarvis가 종료되었다면 <b>Jarvis.cmd</b> 로 다시 실행하세요. 연결되면 자동으로 사라집니다.</span></div>
 <div class="hint hide" id="restartBanner"><svg viewBox="0 0 24 24"><path d="M12 3v3M12 18v3M4.2 7.5l2.6 1.5M17.2 15l2.6 1.5M4.2 16.5L6.8 15M17.2 9l2.6-1.5"/><circle cx="12" cy="12" r="3"/></svg><span>설정을 저장했습니다. <b>엔진을 재시작해야 적용됩니다.</b> 재시작하는 동안 AI 연결이 잠시 끊깁니다.</span><button class="btn p sm" id="applyRestart">지금 재시작</button></div>

 <section id="tab-status" role="tabpanel" aria-labelledby="nav-status">
  <div class="hero idle" id="hero">
   <div class="hero-top"><div class="big" id="hero-ico"></div><div class="hero-text"><h2 id="hero-t">상태를 확인하는 중…</h2><p id="hero-s"></p><div class="fixw hide" id="fixw"><button class="link" id="fix-toggle">해결 방법 보기</button><div class="fix hide" id="fix"><span id="fix-t"></span> <button class="link" id="diag-logs">로그 보기</button></div></div></div><div class="actions" id="hero-actions"></div></div>
   <div class="metrics">
    <div class="metric"><div class="ml">가동 시간</div><div class="mv sk" id="sv-up">00시간 00분</div></div>
    <div class="metric"><div class="ml">자동 재시작 (최근 10분)</div><div class="mv sk" id="sv-restarts">0회 (누적 0회)</div></div>
    <div class="metric"><div class="ml">허용 폴더</div><div class="mv sk" id="m-dirs">0개</div></div>
    <div class="metric"><div class="ml">허용된 작업</div><div class="chips" id="m-perms"></div></div>
   </div>
  </div>
  <div class="grid">
   <div class="card"><div class="card-h"><h2>엔진 (MCP 서버)</h2><span id="sv-badge" class="pill"><i class="dot"></i><span>-</span></span></div>
    <div class="kv"><span class="k">프로세스</span><span class="v mono sk" id="sv-pid">12345</span><span class="k">포트</span><span class="v mono sk" id="sv-port">8765</span></div>
    <div class="msg" id="sv-msg"></div>
    <div class="actions"><button class="btn p" id="sv-start">시작</button><button class="btn" id="sv-restart">재시작</button><button class="btn d" id="sv-stop">중지</button></div>
   </div>
   <div class="card"><div class="card-h"><h2>클라우드 터널 (HTTPS)</h2><span id="tn-badge" class="pill"><i class="dot"></i><span>-</span></span></div>
    <div class="kv"><span class="k">터널 ID</span><span class="v mono sk" id="tn-id">kind-horse.jpe1</span></div>
    <div class="msg" id="tn-msg"></div>
    <div class="actions"><button class="btn p" id="tn-start">연결</button><button class="btn d" id="tn-stop">연결 끊기</button></div>
   </div>
  </div>

  <div class="card"><div class="card-h"><div><h2>최근 활동</h2><p class="sub">최근 1시간 동안 AI가 호출한 도구</p></div>
    <div class="stats"><span class="pill ok"><i class="dot"></i><span id="act-ok">호출 0</span></span><span class="pill bad" id="act-bad-p"><i class="dot"></i><span id="act-bad">차단 0</span></span></div></div>
   <div class="chart" id="chart" role="img" aria-label="최근 1시간 활동 차트"></div>
   <div class="axis"><span>60분 전</span><span>30분 전</span><span>지금</span></div>
   <div class="feed" id="feed"></div>
  </div>

  <div class="card"><h2>AI 클라이언트 연결</h2><p class="sub">사용하는 클라이언트를 고르면 바로 붙여넣을 수 있는 설정이 나옵니다.</p>
   <div class="seg tabs-c" id="conn-seg"><button data-c="basic" class="on" aria-pressed="true">기본 정보</button><button data-c="claude" aria-pressed="false">Claude Code</button><button data-c="cursor" aria-pressed="false">Cursor</button><button data-c="curl" aria-pressed="false">curl 테스트</button></div>
   <div id="conn-basic">
    <div class="field"><span class="lab">HTTPS 주소</span><span class="val sk" id="url-public">https://xxxxxxxx-8765.jpe1.devtunnels.ms/mcp</span><div class="acts"><button class="btn sm" id="copy-public">복사</button></div></div>
    <div class="field"><span class="lab">로컬 주소</span><span class="val sk" id="url-local">http://127.0.0.1:8765/mcp</span><div class="acts"><button class="btn sm" id="copy-local">복사</button></div></div>
    <div class="field"><span class="lab">API Key</span><span class="val sk" id="key">pcmcp_xxxxxxxxxxxxxxxx</span><div class="acts"><button class="btn sm" id="key-reveal">표시</button><button class="btn sm" id="key-copy">복사</button><button class="btn sm d" id="key-regen">재발급</button></div></div>
    <div class="hint info" style="margin:16px 0 0"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/></svg><span>외부 AI 서비스(Copilot Studio 등)에는 <b>HTTPS 주소</b>를 쓰고, 인증은 API 키로 합니다. 요청 헤더는 <span class="mono">X-API-Key</span> 또는 <span class="mono">Authorization: Bearer</span> 입니다.</span></div>
   </div>
   <div id="conn-snip" class="hide"><pre class="code" id="snip"></pre><div class="code-bar"><span id="snip-note"></span><button class="btn p sm" id="snip-copy">키 포함해서 복사</button></div></div>
  </div>
 </section>

 <section id="tab-tools" class="hide" role="tabpanel" aria-labelledby="nav-tools">
  <div class="toolbar"><input type="text" id="tl-q" placeholder="도구 검색…" autocomplete="off" aria-label="도구 검색"><div class="seg" id="tl-seg"><button data-f="all" class="on" aria-pressed="true">전체</button><button data-f="read" aria-pressed="false">조회</button><button data-f="write" aria-pressed="false">변경</button></div>
   <span class="tl-count" id="tl-count"></span><button class="btn sm" id="tl-refresh">새로고침</button></div>
  <div class="card"><div id="tl-list"></div></div>
 </section>

 <section id="tab-agents" class="hide" role="tabpanel" aria-labelledby="nav-agents">
  <div class="toolbar"><input type="text" id="ag-q" placeholder="에이전트 이름 또는 도구 검색…" autocomplete="off" aria-label="에이전트 검색">
   <span class="tl-count" id="ag-count"></span><button class="btn sm" id="ag-refresh">새로고침</button></div>
  <div id="ag-list"></div>
 </section>
  <div class="card"><h2>허용 폴더 (샌드박스)</h2><p class="sub">AI는 아래 폴더 안에서만 파일을 읽고 쓸 수 있습니다. 하위 폴더도 포함됩니다.</p>
   <div id="dir-list"></div>
   <div class="dir-add"><button class="btn" id="dir-add">+ 폴더 추가</button></div></div>
  <div class="card"><h2>권한</h2><p class="sub">AI에게 허용할 작업을 고릅니다.</p>
   <div class="opt"><div class="t"><b>파일 읽기</b><span>폴더 목록, 파일 내용, 검색, 문서(PDF/Office) 읽기</span></div><label class="sw"><input type="checkbox" id="f-read"><i></i></label></div>
   <div class="opt"><div class="t"><b>파일 쓰기 / 수정</b><span>파일 생성, 수정, 삭제, 이동 (자동 백업과 되돌리기 포함)</span></div><label class="sw"><input type="checkbox" id="f-write"><i></i></label></div>
   <div class="opt"><div class="t"><b>터미널 실행</b><span>허용 목록에 있는 명령어만 PowerShell에서 실행합니다</span></div><label class="sw"><input type="checkbox" id="f-term"><i></i></label></div>
   <div class="opt"><div class="t"><b>승인 없이 자동 실행</b><span>AI 클라이언트의 승인 카드를 건너뜁니다. 신뢰하는 환경에서만 켜세요.</span></div><label class="sw danger"><input type="checkbox" id="f-auto"><i></i></label></div>
  </div>
  <div class="card"><h2>고급</h2>
   <label class="lbl" for="f-extra">추가 허용 명령어<small>세미콜론(;)으로 구분</small></label><input type="text" id="f-extra" placeholder="예: terraform;make">
   <label class="lbl" for="f-tunnel">Dev Tunnel 고유 ID<small>비워 두면 자동 생성</small></label><input type="text" id="f-tunnel">
   <span class="lbl" id="f-mode-lab">터미널 명령어 검사<small>allowlist: 목록에 있는 명령만 실행 · blocklist: 위험 명령만 차단</small></span><div class="seg" id="f-mode" role="group" aria-labelledby="f-mode-lab"><button data-m="allowlist" class="on" aria-pressed="true">allowlist</button><button data-m="blocklist" aria-pressed="false">blocklist</button></div>
   <p class="sub hide" id="mode-warn" style="margin-top:10px;color:var(--warn)">blocklist 모드는 허용 목록 검사를 건너뛰어 위험한 명령이 실행될 수 있습니다. 꼭 필요한 경우에만 쓰세요.</p></div>
  <div class="savebar"><span class="st" id="save-st">변경 사항 없음</span><button class="btn" id="revert" disabled>되돌리기</button><button class="btn p" id="save" disabled>저장</button></div>
 </section>

 <section id="tab-logs" class="hide" role="tabpanel" aria-labelledby="nav-logs">
  <div class="toolbar"><div class="seg" id="log-seg"><button data-k="audit" class="on" aria-pressed="true">도구 호출</button><button data-k="server" aria-pressed="false">서버</button><button data-k="tunnel" aria-pressed="false">터널</button><button data-k="supervisor" aria-pressed="false">감시자</button></div>
   <input type="text" id="log-q" placeholder="검색…" autocomplete="off" aria-label="로그 검색"><button class="btn sm" id="log-copy">복사</button><button class="btn sm" id="log-bottom">맨 아래로</button><label class="chk"><input type="checkbox" id="log-auto" checked> 자동 갱신</label></div>
  <div class="term" id="log-text" aria-label="로그 출력"></div>
 </section>
</main>
</div>
</div>
<div id="toasts" role="status" aria-live="polite"></div>
<div class="modal hide" id="modal"><div class="dlg"><h3 id="m-t"></h3><p id="m-b"></p><div class="actions"><button class="btn" id="m-no">취소</button><button class="btn p" id="m-yes">확인</button></div></div></div>
<div class="modal hide" id="picker"><div class="dlg pk">
 <h3>폴더 선택</h3>
 <div class="pk-places" id="pk-places"></div>
 <div class="pk-bar"><button class="btn sm" id="pk-up">↑ 위로</button><span class="pk-path mono" id="pk-path"></span></div>
 <div class="pk-list" id="pk-list" aria-label="폴더 목록"></div>
 <div class="pk-in"><input type="text" id="pk-in" placeholder="경로를 붙여넣고 Enter (예: D:\Projects)" autocomplete="off" spellcheck="false"><button class="btn sm" id="pk-go">이동</button></div>
 <div class="msg err" id="pk-err"></div>
 <div class="actions"><button class="btn" id="pk-cancel">취소</button><button class="btn p" id="pk-pick">이 폴더 선택</button></div>
</div></div>
<div class="gate hide" id="gate" role="alert"><div class="card"><h2>다시 로그인이 필요합니다</h2><p class="sub">이 브라우저의 접속이 만료되었거나 Jarvis가 재시작되었습니다.<br><b>Jarvis.cmd</b>(맥은 Jarvis.command)를 다시 실행하면 대시보드가 자동으로 열립니다.</p></div></div>
<script>
(function(){
  var TABS=["status","tools","agents","settings","logs"], TITLES={status:["대시보드","엔진과 터널의 상태를 확인하고 제어합니다."],tools:["도구","AI 클라이언트가 지금 사용할 수 있는 도구입니다."],agents:["에이전트","Jarvis MCP 서버와 CLI를 호출한 AI 클라이언트의 활동 기록입니다."],settings:["설정","AI가 접근할 수 있는 범위와 권한을 정합니다."],logs:["로그","도구 호출, 서버, 터널의 기록을 확인합니다."]};
  var $=function(i){return document.getElementById(i);}, last=null, shownKey="", keyTimer=0, fails=0, tab="status", logKind="audit", logRaw="", baseline="", settingsSig="", heroSig="", permSig="", connTab="basic", actSig="", dirs=[], pk=null;
  var L={running:"실행 중",stopped:"중지됨",starting:"시작 중",restarting:"재시작 중",failed:"실패",online:"연결됨",offline:"끊김",connecting:"연결 중",preparing:"준비 중",error:"오류",off:"꺼짐"};
  var K={running:"ok",online:"ok",starting:"warn",restarting:"warn",connecting:"warn",preparing:"warn",failed:"bad",error:"bad",offline:"bad",stopped:"",off:""};
  var ICON={ok:'<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',warn:'<svg viewBox="0 0 24 24"><path d="M12 7v6M12 17v.5"/></svg>',bad:'<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg>',idle:'<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>'};
  var THEME={auto:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 4v16"/><path d="M12 4a8 8 0 010 16z" fill="currentColor" stroke="none"/></svg>',light:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></svg>',dark:'<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z"/></svg>'};
  var THEME_NAME={auto:"시스템 설정",light:"라이트",dark:"다크"};

  // while a dialog is open the page behind it must not scroll (the picker's list used to hand its scroll over to the page)
  var lockObs=new MutationObserver(function(){document.body.classList.toggle("modal-open",!!document.querySelector(".modal:not(.hide),.gate:not(.hide)"));});
  ["modal","picker","gate"].forEach(function(id){lockObs.observe($(id),{attributes:true,attributeFilter:["class"]});});
  history.replaceState(null,"",location.pathname+location.hash);
  function theme(){return document.documentElement.getAttribute("data-theme")||"auto";}
  function setTheme(n){document.documentElement.setAttribute("data-theme",n);try{localStorage.setItem("jt-theme",n);}catch(e){}$("theme").innerHTML=THEME[n];$("theme").title="테마: "+THEME_NAME[n]+" (클릭하여 변경)";}
  $("theme").onclick=function(){var o=["auto","light","dark"];setTheme(o[(o.indexOf(theme())+1)%3]);};setTheme(theme());

  function toast(m,kind){var e=document.createElement("div");e.className="toast "+(kind||"");e.textContent=m;$("toasts").appendChild(e);setTimeout(function(){e.remove();},kind==="bad"?5000:2600);}
  function api(p,method,body){
    return fetch(p,{method:method||"GET",credentials:"same-origin",headers:{"content-type":"application/json"},body:body?JSON.stringify(body):undefined})
      .then(function(r){return r.json().catch(function(){return {};}).then(function(j){if(!r.ok){var e=new Error(j.error||("HTTP "+r.status));e.status=r.status;throw e;}return j;});});
  }
  function fail(e){toast(e.message,"bad");}
  function idle(btn){btn.classList.remove("busy");render(last);dirtyUi();}
  function busy(btn,p){btn.classList.add("busy");btn.disabled=true;return p.then(function(r){idle(btn);return r;},function(e){idle(btn);throw e;});}
  function trap(box,e){if(e.key!=="Tab")return;var els=[].filter.call(box.querySelectorAll("button,input"),function(el){return !el.disabled&&el.offsetParent!==null;});if(!els.length)return;var f=els[0],l=els[els.length-1];if(e.shiftKey&&document.activeElement===f){e.preventDefault();l.focus();}else if(!e.shiftKey&&document.activeElement===l){e.preventDefault();f.focus();}}
  function ask(title,body,yes,danger){
    return new Promise(function(res){
      var prev=document.activeElement;
      $("m-t").textContent=title;$("m-b").textContent=body;var y=$("m-yes");y.textContent=yes||"확인";y.className="btn p"+(danger?" d":"");$("modal").className="modal";y.focus();
      function done(v){$("modal").className="modal hide";y.onclick=$("m-no").onclick=null;document.removeEventListener("keydown",key);if(prev&&prev.focus)prev.focus();res(v);}
      function key(e){if(e.key==="Escape")done(false);trap($("modal"),e);}
      document.addEventListener("keydown",key);y.onclick=function(){done(true);};$("m-no").onclick=function(){done(false);};
    });
  }
  function copy(text,what){return navigator.clipboard.writeText(text).then(function(){toast(what+" 복사했습니다","ok");},function(){toast("복사하지 못했습니다. 직접 선택해서 복사해 주세요.","bad");});}
  function age(ms){if(!ms)return "-";var s=Math.max(0,Math.floor((Date.now()-ms)/1000)),d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);return (d?d+"일 ":"")+(h?h+"시간 ":"")+m+"분 "+(s%60)+"초";}
  function ago(ms){var s=Math.max(0,Math.floor((Date.now()-ms)/1000));if(s<10)return "방금";if(s<60)return s+"초 전";if(s<3600)return Math.floor(s/60)+"분 전";if(s<86400)return Math.floor(s/3600)+"시간 전";return Math.floor(s/86400)+"일 전";}

  function pill(id,state){var e=$(id);e.className="pill "+(K[state]||"");e.lastChild.textContent=L[state]||state;}
  function setDot(id,state,tid){$(id).className="dot "+(K[state]||"");$(tid).textContent=L[state]||state;}
  function mkBtn(label,cls,fn){var b=document.createElement("button");b.className="btn "+cls;b.textContent=label;b.onclick=function(){busy(b,fn()).catch(fail);};return b;}
  var svStart=function(){return api("/api/server/start","POST",{}).then(function(s){render(s);toast("엔진을 시작합니다","ok");});};
  var svRestart=function(){return api("/api/server/restart","POST",{}).then(function(s){render(s);toast("엔진을 재시작했습니다","ok");});};
  var svStop=function(){return ask("엔진을 중지할까요?","AI 클라이언트의 연결이 끊어집니다. 언제든 다시 시작할 수 있습니다.","중지",true).then(function(ok){if(ok)return api("/api/server/stop","POST",{}).then(function(s){render(s);toast("중지했습니다");});});};
  var tnStart=function(){return api("/api/tunnel/start","POST",{}).then(function(s){render(s);toast("터널 연결을 시도합니다");});};
  var tnStop=function(){return ask("터널을 끊을까요?","외부 AI 서비스(Copilot Studio 등)에서 접속할 수 없게 됩니다. 이 PC 안에서는 계속 쓸 수 있습니다.","연결 끊기",true).then(function(ok){if(ok)return api("/api/tunnel/stop","POST",{}).then(function(s){render(s);toast("터널을 껐습니다");});});};

  function hero(s){
    var sv=s.server.state, tn=s.tunnel.state, k, title, sub, acts=[];
    if(sv==="running"&&tn==="online"){k="ok";title="정상 운영 중";sub="엔진과 HTTPS 터널이 모두 연결되어 AI 클라이언트가 접속할 수 있습니다.";}
    else if(sv==="running"&&(tn==="off"||tn==="offline")){k="warn";title="로컬에서만 접속할 수 있습니다";sub="엔진은 동작하지만 터널이 연결되어 있지 않아 외부 AI 서비스는 접속할 수 없습니다.";acts.push(mkBtn("터널 연결","p",tnStart));}
    else if(sv==="running"&&tn==="error"){k="warn";title="터널에 문제가 있습니다";sub=s.tunnel.message||"터널 연결을 복구해 보세요.";acts.push(mkBtn("터널 복구","p",tnStart));}
    else if(sv==="running"){k="warn";title="터널을 연결하는 중입니다";sub="엔진은 동작 중입니다. HTTPS 주소가 준비되면 외부에서 접속할 수 있습니다.";}
    else if(sv==="starting"||sv==="restarting"){k="warn";title="엔진을 "+L[sv]+"입니다";sub="잠시만 기다려 주세요.";}
    else if(sv==="failed"){k="bad";title="엔진이 시작되지 못했습니다";sub=(s.hints&&s.hints[0])?s.hints[0].summary:"자동 재시작을 여러 번 시도했지만 실패해 멈췄습니다. 로그에서 원인을 확인하세요.";acts.push(mkBtn("다시 시작","p",svStart));}
    else{k="idle";title="엔진이 중지되어 있습니다";sub="시작하면 AI 클라이언트가 접속할 수 있습니다.";acts.push(mkBtn("시작","p",svStart));}
    $("hero").className="hero "+k;$("hero-ico").innerHTML=ICON[k];$("hero-t").textContent=title;$("hero-s").textContent=sub;
    // rebuild the buttons only when the situation changed; replacing them on every poll would eat clicks and hover
    var hs=k+"|"+title;if(hs!==heroSig){heroSig=hs;var a=$("hero-actions");a.textContent="";acts.forEach(function(b){a.appendChild(b);});}
    return k;
  }
  function render(s){
    if(!s)return;last=s;
    var sv=s.server.state, tn=s.tunnel.state;
    pill("sv-badge",sv);pill("tn-badge",tn);setDot("sf-sv",sv,"sf-sv-t");setDot("sf-tn",tn,"sf-tn-t");
    $("sv-pid").textContent=s.server.pid||"-";
    document.querySelectorAll(".sk").forEach(function(e){e.classList.remove("sk");});
    $("sv-port").textContent=s.settings.port;
    $("sv-restarts").textContent=s.server.restarts_in_window+"회 (누적 "+s.server.total_restarts+"회)";
    $("m-dirs").textContent=s.settings.allowed_dirs.length+"개";
    var ps=[["읽기",s.settings.enable_read],["쓰기",s.settings.enable_write],["터미널",s.settings.enable_terminal],["자동 승인",s.settings.auto_approve]], psig=JSON.stringify(ps);
    if(psig!==permSig){permSig=psig;var pc=$("m-perms");pc.textContent="";ps.forEach(function(p){var c=document.createElement("span");c.className="chip"+(p[0]==="자동 승인"?(p[1]?" risk":" off"):(p[1]?"":" off"));c.textContent=p[0];pc.appendChild(c);});}
    tickUptime();
    var sm=s.server.message||(s.server.last_exit&&s.server.state!=="running"?("마지막 종료: code "+s.server.last_exit.code):"");
    var hasHint=!!(s.hints&&s.hints.length);$("sv-msg").textContent=hasHint?"":sm;$("sv-msg").className="msg"+(sv==="failed"&&!hasHint?" err":"");
    $("tn-id").textContent=s.tunnel.id||"(없음 — 연결 시 자동 생성)";
    $("tn-msg").textContent=s.tunnel.message||"";$("tn-msg").className="msg"+(tn==="error"?" err":"");
    // buttons follow the state, so every enabled button does something
    var up=sv==="running"||sv==="starting"||sv==="restarting", sb=function(id,dis){var b=$(id);if(!b.classList.contains("busy"))b.disabled=dis;};
    sb("sv-start",up);sb("sv-restart",sv==="stopped");sb("sv-stop",sv==="stopped");
    sb("tn-start",tn==="connecting"||tn==="preparing");sb("tn-stop",tn==="off");
    var tb=$("tn-start");if(!tb.classList.contains("busy"))tb.textContent=tn==="online"?"다시 연결":(tn==="error"||tn==="offline")?"복구":"연결";
    var pu=$("url-public");pu.textContent=s.urls.public||"터널이 연결되면 표시됩니다";pu.className="val"+(s.urls.public?"":" empty");$("copy-public").disabled=!s.urls.public;
    $("url-local").textContent=s.urls.local;
    if(!shownKey)$("key").textContent=s.settings.api_key_masked;
    $("ver").textContent="v"+s.version;
    var k=hero(s);
    var h0=s.hints&&s.hints[0];$("fixw").className="fixw"+(h0?"":" hide");if(h0)$("fix-t").textContent=h0.fix;else $("fix").className="fix hide";
    var sig=JSON.stringify(s.settings);if(sig!==settingsSig){settingsSig=sig;if(!isDirty())fillSettings();}
    if(connTab!=="basic")paintSnippet();
  }
  function tickUptime(){if(!last)return;$("sv-up").textContent=last.server.state==="running"?age(last.server.started_at):"멈춤";}
  function live(ok){var e=$("live");e.className="live"+(ok?"":" off");e.firstChild.className="dot "+(ok?"ok":"bad");$("live-t").textContent=ok?"실시간":"연결 끊김";}
  function poll(){api("/api/state").then(function(s){fails=0;live(true);$("conn-banner").className="hint bad hide";render(s);}).catch(function(e){
    if(e.status===401){$("gate").className="gate";return;}
    live(false);if(++fails>=2)$("conn-banner").className="hint bad";});}

  /* activity: chart + feed */
  var EV={ALLOW:["허용",0],TOKEN_ISSUED:["연결",0],ERROR:["오류",1],AUTH_401:["인증 실패",1]};
  function evLabel(s){return EV[s]||(/^BLOCKED/.test(s)?["차단",1]:[s,0]);}
  function paintActivity(a){
    var sig=JSON.stringify([a.totals,a.recent.length&&a.recent[0].t,a.buckets.map(function(b){return b.ok+"/"+b.bad;})]);
    $("act-ok").textContent="호출 "+a.totals.ok;$("act-bad").textContent="차단·오류 "+a.totals.bad;
    $("chart").setAttribute("aria-label","최근 1시간 활동 차트: 호출 "+a.totals.ok+", 차단·오류 "+a.totals.bad);
    if(sig===actSig){updateAgo();return;}actSig=sig;
    var max=Math.max.apply(null,a.buckets.map(function(b){return b.ok+b.bad;}).concat([3])), ch=$("chart");ch.textContent="";
    a.buckets.forEach(function(b){var d=document.createElement("div");d.className="bar";var tt=new Date(b.t);d.title=("0"+tt.getHours()).slice(-2)+":"+("0"+tt.getMinutes()).slice(-2)+" · 호출 "+b.ok+" · 차단/오류 "+b.bad;
      if(b.bad){var x=document.createElement("i");x.className="b";x.style.height=(b.bad/max*100)+"%";d.appendChild(x);}
      if(b.ok){var y=document.createElement("i");y.className="o";y.style.height=(b.ok/max*100)+"%";d.appendChild(y);}
      ch.appendChild(d);});
    var f=$("feed");f.textContent="";
    if(!a.recent.length){var em=document.createElement("div");em.className="empty-a";em.innerHTML='<svg viewBox="0 0 24 24"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>';var tx=document.createElement("div");tx.textContent="아직 AI의 활동이 없습니다. 아래 ‘AI 클라이언트 연결’의 설정을 클라이언트에 입력하면 여기에 표시됩니다.";em.appendChild(tx);f.appendChild(em);return;}
    a.recent.forEach(function(e){var r=document.createElement("div");r.className="ev";var l=evLabel(e.status);
      var s=document.createElement("span");s.className="st"+(l[1]?" bad":"");s.textContent=l[0];
      var n=document.createElement("span");n.className="tn mono";n.textContent=e.tool;
      var d=document.createElement("span");d.className="dt";d.textContent=e.detail;d.title=e.detail;
      var tm=document.createElement("span");tm.className="tm";tm.setAttribute("data-t",e.t);tm.textContent=ago(e.t);
      r.appendChild(s);r.appendChild(n);r.appendChild(d);r.appendChild(tm);f.appendChild(r);});
  }
  function updateAgo(){document.querySelectorAll("#feed [data-t]").forEach(function(e){e.textContent=ago(Number(e.getAttribute("data-t")));});}
  function loadActivity(){if(tab!=="status")return;api("/api/activity").then(paintActivity).catch(function(){});}

  /* connection helpers: ready-to-paste config per client; the key is shown as a placeholder and only inserted on copy */
  function endpoint(){return last&&(last.urls.public||last.urls.local)||"";}
  function snippet(kind){var u=endpoint();
    if(kind==="claude")return 'claude mcp add --transport http jarvis '+u+' --header "X-API-Key: <API_KEY>"';
    if(kind==="cursor")return '{\n  "mcpServers": {\n    "jarvis": {\n      "url": "'+u+'",\n      "headers": { "X-API-Key": "<API_KEY>" }\n    }\n  }\n}';
    return 'curl -X POST '+u+' \\\n  -H "X-API-Key: <API_KEY>" \\\n  -H "Content-Type: application/json" \\\n  -H "Accept: application/json, text/event-stream" \\\n  -d \'{"jsonrpc":"2.0","id":1,"method":"tools/list"}\'';}
  var NOTE={claude:"터미널에서 한 번 실행하면 Claude Code에 등록됩니다.",cursor:"Cursor의 MCP 설정 파일(mcp.json)에 붙여넣으세요.",curl:"서버가 응답하는지 터미널에서 바로 확인합니다."};
  function paintSnippet(){var t=snippet(connTab);$("snip").textContent=t;var local=last&&!last.urls.public;$("snip-note").textContent=NOTE[connTab]+(local?" (터널이 없어 로컬 주소를 사용합니다)":"");}
  document.querySelectorAll("#conn-seg button").forEach(function(b){b.onclick=function(){connTab=b.getAttribute("data-c");
    document.querySelectorAll("#conn-seg button").forEach(function(x){var on=x===b;x.className=on?"on":"";x.setAttribute("aria-pressed",on?"true":"false");});
    $("conn-basic").className=connTab==="basic"?"":"hide";$("conn-snip").className=connTab==="basic"?"hide":"";if(connTab!=="basic")paintSnippet();};});
  $("snip-copy").onclick=function(){api("/api/apikey/reveal","POST",{}).then(function(r){return copy(snippet(connTab).split("<API_KEY>").join(r.api_key),"설정을");}).catch(fail);};

  $("sv-start").onclick=function(){busy($("sv-start"),svStart()).catch(fail);};
  $("sv-restart").onclick=function(){busy($("sv-restart"),svRestart()).catch(fail);};
  $("sv-stop").onclick=function(){busy($("sv-stop"),svStop()).catch(fail);};
  $("tn-start").onclick=function(){busy($("tn-start"),tnStart()).catch(fail);};
  $("tn-stop").onclick=function(){busy($("tn-stop"),tnStop()).catch(fail);};
  $("applyRestart").onclick=function(){busy($("applyRestart"),svRestart().then(function(){$("restartBanner").className="hint hide";})).catch(fail);};
  $("diag-logs").onclick=function(){logKind="server";go("logs");};
  $("fix-toggle").onclick=function(){var o=$("fix").className.indexOf("hide")<0;$("fix").className="fix"+(o?" hide":"");$("fix-toggle").textContent=o?"해결 방법 보기":"접기";};
  $("copy-public").onclick=function(){if(last&&last.urls.public)copy(last.urls.public,"HTTPS 주소를");};
  $("copy-local").onclick=function(){if(last)copy(last.urls.local,"로컬 주소를");};
  function hideKey(){shownKey="";clearTimeout(keyTimer);if(last)$("key").textContent=last.settings.api_key_masked;$("key-reveal").textContent="표시";}
  function showKey(k){shownKey=k;$("key").textContent=k;$("key-reveal").textContent="숨기기";clearTimeout(keyTimer);keyTimer=setTimeout(hideKey,30000);}
  $("key-reveal").onclick=function(){if(shownKey)return hideKey();api("/api/apikey/reveal","POST",{}).then(function(r){showKey(r.api_key);}).catch(fail);};
  $("key-copy").onclick=function(){api("/api/apikey/reveal","POST",{}).then(function(r){return copy(r.api_key,"API Key를");}).catch(fail);};
  $("key-regen").onclick=function(){ask("API Key를 재발급할까요?","기존 키를 쓰는 모든 연결이 끊어집니다. AI 클라이언트에 새 키를 다시 입력해야 합니다.","재발급",true).then(function(ok){if(!ok)return;
    return api("/api/apikey/regenerate","POST",{}).then(function(r){showKey(r.api_key);toast("재발급했습니다. 클라이언트의 키를 바꿔 주세요.","ok");});}).catch(fail);};

  /* settings: dirty tracking so edits are never lost or silently overwritten */
  var termMode="allowlist";
  function paintMode(){document.querySelectorAll("#f-mode button").forEach(function(x){var on=x.getAttribute("data-m")===termMode;x.className=on?"on":"";x.setAttribute("aria-pressed",on?"true":"false");});$("mode-warn").className="sub"+(termMode==="blocklist"?"":" hide");}
  document.querySelectorAll("#f-mode button").forEach(function(b){b.onclick=function(){termMode=b.getAttribute("data-m");paintMode();dirtyUi();};});
  function vals(){return JSON.stringify([dirs.slice(),$("f-read").checked,$("f-write").checked,$("f-term").checked,$("f-auto").checked,$("f-extra").value.trim(),$("f-tunnel").value.trim(),termMode]);}
  function isDirty(){return baseline!==""&&vals()!==baseline;}
  function fillSettings(){if(!last)return;var s=last.settings;dirs=s.allowed_dirs.slice();paintDirs();$("f-read").checked=s.enable_read;$("f-write").checked=s.enable_write;
    $("f-term").checked=s.enable_terminal;$("f-auto").checked=s.auto_approve;$("f-extra").value=s.extra_allowed_commands;$("f-tunnel").value=s.devtunnel_id;termMode=s.terminal_mode||"allowlist";paintMode();baseline=vals();dirtyUi();}
  function dirtyUi(){var d=isDirty();$("save").disabled=!d;$("revert").disabled=!d;$("nav-dirty").className="dirty"+(d?"":" hide");var st=$("save-st");st.className="st"+(d?" dirty":"");st.textContent=d?"저장하지 않은 변경 사항이 있습니다":"변경 사항 없음";}
  ["f-read","f-write","f-term","f-auto","f-extra","f-tunnel"].forEach(function(id){$(id).addEventListener("input",dirtyUi);$(id).addEventListener("change",dirtyUi);});
  $("revert").onclick=fillSettings;
  $("save").onclick=function(){
    if(!dirs.length){var st=$("save-st");st.className="st err";st.textContent="허용 폴더를 한 개 이상 입력하세요";return;}
    busy($("save"),api("/api/settings","POST",{allowed_dirs:dirs,enable_read:$("f-read").checked,enable_write:$("f-write").checked,enable_terminal:$("f-term").checked,
      auto_approve:$("f-auto").checked,extra_allowed_commands:$("f-extra").value.trim(),devtunnel_id:$("f-tunnel").value.trim(),terminal_mode:termMode})
      .then(function(r){settingsSig="";render(r);fillSettings();toast("저장했습니다","ok");if(r.changed&&r.changed.length)$("restartBanner").className="hint";}))
      .catch(function(e){var st=$("save-st");st.className="st err";st.textContent=e.message;fail(e);});
  };

  /* allowed folders: a list you add to with a folder browser, never a path you have to type or remember */
  var FOLDER='<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>';
  function baseName(p){var t=p.replace(/[\\/]+$/,""),i=Math.max(t.lastIndexOf("\\"),t.lastIndexOf("/"));return i>=0&&t.slice(i+1)?t.slice(i+1):p;}
  function sameDir(a,b){return a.toLowerCase()===b.toLowerCase();}
  function paintDirs(){
    var box=$("dir-list");box.textContent="";
    if(!dirs.length){var e=document.createElement("div");e.className="dir-empty";e.textContent="허용된 폴더가 없습니다. 아래 버튼으로 폴더를 하나 이상 추가하세요.";box.appendChild(e);return;}
    dirs.forEach(function(p,i){
      var r=document.createElement("div");r.className="dir";
      var ic=document.createElement("div");ic.className="dir-i";ic.innerHTML=FOLDER;
      var t=document.createElement("div");t.className="dir-t";var n=document.createElement("b");n.textContent=baseName(p);var q=document.createElement("span");q.textContent=p;q.title=p;t.appendChild(n);t.appendChild(q);
      var x=document.createElement("button");x.className="btn sm d";x.textContent="제거";x.onclick=function(){dirs.splice(i,1);paintDirs();dirtyUi();};
      r.appendChild(ic);r.appendChild(t);r.appendChild(x);box.appendChild(r);
    });
  }
  function addDir(p){
    if(dirs.some(function(d){return sameDir(d,p);})){toast("이미 추가된 폴더입니다");return;}
    dirs.push(p);paintDirs();dirtyUi();pickerClose();toast("폴더를 추가했습니다. 저장을 눌러야 적용됩니다.","ok");
  }
  var pkPrev=null;
  function pkKey(e){if(e.key==="Escape")pickerClose();trap($("picker"),e);}
  function pickerOpen(){pkPrev=document.activeElement;$("picker").className="modal";$("pk-in").value="";document.addEventListener("keydown",pkKey);$("pk-in").focus();pkGo("");}
  function pickerClose(){$("picker").className="modal hide";document.removeEventListener("keydown",pkKey);if(pkPrev&&pkPrev.focus)pkPrev.focus();}
  function pkGo(p){
    $("pk-err").textContent="";var list=$("pk-list");list.setAttribute("aria-busy","true");list.textContent="";
    var l=document.createElement("div");l.className="pk-empty";l.textContent="불러오는 중…";list.appendChild(l);
    return api("/api/fs?path="+encodeURIComponent(p)).then(function(d){pk=d;pkPaint();}).catch(function(e){$("pk-err").textContent=e.message;list.removeAttribute("aria-busy");if(pk)pkPaint();});
  }
  function pkPaint(){
    $("pk-list").removeAttribute("aria-busy");
    var d=pk,pl=$("pk-places");pl.textContent="";
    d.places.forEach(function(p){var b=document.createElement("button");b.className="place";b.textContent=p.name;b.onclick=function(){pkGo(p.path);};pl.appendChild(b);});
    $("pk-path").textContent=d.path==="@pc"?"내 PC":d.path;$("pk-path").title=d.path;
    $("pk-up").disabled=d.parent===null;$("pk-pick").disabled=d.is_root;$("pk-pick").title=d.is_root?"드라이브 전체는 허용할 수 없습니다. 안쪽 폴더를 고르세요.":"";
    var list=$("pk-list");list.textContent="";
    if(!d.entries.length){var em=document.createElement("div");em.className="pk-empty";em.textContent="이 안에는 하위 폴더가 없습니다. 이 폴더를 선택할 수 있습니다.";list.appendChild(em);}
    d.entries.forEach(function(en){
      var r=document.createElement("div");r.className="fr";
      var nm=document.createElement("button");nm.className="nm";nm.innerHTML=FOLDER;var sp=document.createElement("span");sp.textContent=en.name;sp.title=en.path;nm.appendChild(sp);nm.onclick=function(){pkGo(en.path);};
      var ad=document.createElement("button");ad.className="btn sm";ad.textContent="선택";ad.onclick=function(){addDir(en.path);};
      r.appendChild(nm);r.appendChild(ad);list.appendChild(r);
    });
    if(d.truncated){var tr=document.createElement("div");tr.className="pk-empty";tr.textContent="폴더가 많아 일부만 표시했습니다. 아래 입력칸에 경로를 직접 입력하세요.";list.appendChild(tr);}
    list.scrollTop=0;
  }
  $("dir-add").onclick=pickerOpen;$("pk-cancel").onclick=pickerClose;
  $("pk-up").onclick=function(){if(pk&&pk.parent!==null)pkGo(pk.parent);};
  $("pk-pick").onclick=function(){if(pk&&!pk.is_root)addDir(pk.path);};
  $("pk-go").onclick=function(){var v=$("pk-in").value.trim();if(v)pkGo(v);};
  $("pk-in").addEventListener("keydown",function(e){if(e.key==="Enter"){var v=$("pk-in").value.trim();if(v)pkGo(v);}});

  /* logs */
  function lineClass(l){if(/error|fail|exception|denied|BLOCK|DENY|AUTH_401|EADDRINUSE|crash|giving up|exited \(code [1-9]/i.test(l))return "bad";if(/warn|SKIP|restarting|retry/i.test(l))return "warn";if(/\bALLOW\b|started|ready|online/i.test(l))return "ok";return "";}
  function paintLogs(force){
    var box=$("log-text");
    if(!force){try{var sel=document.getSelection();if(sel&&sel.rangeCount&&!sel.isCollapsed&&box.contains(sel.anchorNode))return;}catch(e){}} // a repaint would eat the user's text selection; the next refresh retries
    var q=$("log-q").value.trim().toLowerCase(), atEnd=box.scrollTop+box.clientHeight>=box.scrollHeight-24, lines=logRaw?logRaw.split("\n"):[];
    if(q)lines=lines.filter(function(l){return l.toLowerCase().indexOf(q)>=0;});
    box.textContent="";
    if(!lines.length){var e=document.createElement("div");e.className="empty";e.textContent=q?"검색 결과가 없습니다":"아직 기록이 없습니다";box.appendChild(e);return;}
    var frag=document.createDocumentFragment();
    lines.forEach(function(l){var d=document.createElement("div"),c=lineClass(l);if(c)d.className=c;d.textContent=l;frag.appendChild(d);});
    box.appendChild(frag);if(atEnd)box.scrollTop=box.scrollHeight;
  }
  function loadLogs(force){return api("/api/logs?kind="+logKind+"&lines=400").then(function(r){logRaw=r.text||"";paintLogs(force);}).catch(fail);}
  document.querySelectorAll("#log-seg button").forEach(function(b){b.onclick=function(){logKind=b.getAttribute("data-k");syncSeg();logRaw="";loadLogs(true).then(function(){$("log-text").scrollTop=$("log-text").scrollHeight;});};});
  function syncSeg(){document.querySelectorAll("#log-seg button").forEach(function(x){var on=x.getAttribute("data-k")===logKind;x.className=on?"on":"";x.setAttribute("aria-pressed",on?"true":"false");});}
  $("log-q").oninput=paintLogs;
  $("log-copy").onclick=function(){copy(logRaw||"","로그를");};
  $("log-bottom").onclick=function(){var b=$("log-text");b.scrollTop=b.scrollHeight;};

  /* tools: what the running engine advertises to AI clients */
  var tools=null, toolsErr="", tlFilter="all";
  function paintTools(){
    var box=$("tl-list"), q=$("tl-q").value.trim().toLowerCase();box.textContent="";
    function note(msg,err){var e=document.createElement("div");e.className="tl-empty"+(err?" err":"");e.textContent=msg;box.appendChild(e);}
    if(!tools){$("tl-count").textContent="";note(toolsErr||"불러오는 중…",!!toolsErr);return;}
    var list=tools.filter(function(t){return (tlFilter==="all"||(tlFilter==="read")===t.readonly)&&(!q||(t.name+" "+t.description).toLowerCase().indexOf(q)>=0);});
    $("tl-count").textContent=list.length+" / "+tools.length+"개";
    if(!list.length){note(tools.length?"조건에 맞는 도구가 없습니다":"등록된 도구가 없습니다");return;}
    var frag=document.createDocumentFragment();
    list.forEach(function(t){
      var r=document.createElement("div");r.className="tl";
      var n=document.createElement("span");n.className="n mono";n.textContent=t.name;
      var d=document.createElement("span");d.className="d";d.textContent=t.description||"(설명 없음)";
      var c=document.createElement("span");c.className="chip"+(t.readonly?"":" risk");c.textContent=t.readonly?"조회":"변경";c.title=t.readonly?"파일이나 상태를 바꾸지 않습니다":"파일, 시스템, 외부 상태를 바꿀 수 있습니다";
      r.appendChild(n);r.appendChild(d);r.appendChild(c);frag.appendChild(r);
    });
    box.appendChild(frag);
  }
  function loadTools(){var b=$("tl-refresh");b.classList.add("busy");
    return api("/api/tools").then(function(r){tools=r.tools;toolsErr="";},function(e){tools=null;toolsErr=e.message;}).then(function(){b.classList.remove("busy");paintTools();});}
  document.querySelectorAll("#tl-seg button").forEach(function(b){b.onclick=function(){tlFilter=b.getAttribute("data-f");document.querySelectorAll("#tl-seg button").forEach(function(x){var on=x===b;x.className=on?"on":"";x.setAttribute("aria-pressed",on?"true":"false");});paintTools();};});
  $("tl-q").oninput=paintTools;$("tl-refresh").onclick=function(){loadTools();};

  /* agents: clients that connect to MCP or invoke the CLI */
  var agents=null, agentsErr="";
  function paintAgents(){
    var box=$("ag-list"), q=$("ag-q").value.trim().toLowerCase();box.textContent="";
    function note(msg,err){var e=document.createElement("div");e.className="ag-empty"+(err?" err":"");e.textContent=msg;box.appendChild(e);}
    if(!agents){$("ag-count").textContent="";note(agentsErr||"불러오는 중…",!!agentsErr);return;}
    var list=agents.filter(function(a){return !q||(a.agent+" "+(a.version||"")+" "+(a.via||[]).join(" ")+" "+Object.keys(a.tools||{}).join(" ")).toLowerCase().indexOf(q)>=0;});
    $("ag-count").textContent=list.length+" / "+agents.length+"개 에이전트";
    if(!list.length){note(agents.length?"조건에 맞는 에이전트가 없습니다":"호출 기록이 있는 에이전트가 없습니다");return;}
    var frag=document.createDocumentFragment();
    list.forEach(function(a){
      var card=document.createElement("div");card.className="ag-card";
      var head=document.createElement("div");head.className="ag-head";
      var name=document.createElement("span");name.className="ag-name";name.textContent=a.agent;
      head.appendChild(name);
      if(a.version){var ver=document.createElement("span");ver.className="ag-ver mono";ver.textContent="v"+a.version;head.appendChild(ver);}
      (a.via||[]).forEach(function(v){var chip=document.createElement("span");chip.className="chip"+(v==="tunnel"?" risk":"");chip.textContent=v;head.appendChild(chip);});
      var meta=document.createElement("div");meta.className="ag-meta";
      var calls=document.createElement("span");calls.textContent="호출 "+a.calls+"회";meta.appendChild(calls);
      if(a.last){var lastSeen=document.createElement("span");lastSeen.textContent="마지막 활동: "+ago(new Date(a.last).getTime());meta.appendChild(lastSeen);}
      head.appendChild(meta);
      card.appendChild(head);
      var toolKeys=Object.keys(a.tools||{});
      if(toolKeys.length){
        var tbox=document.createElement("div");tbox.className="ag-tools";
        var tlbl=document.createElement("span");tlbl.style.color="var(--muted)";tlbl.style.fontSize="12.5px";tlbl.textContent="사용 도구:";tbox.appendChild(tlbl);
        toolKeys.sort(function(x,y){return (a.tools[y]||0)-(a.tools[x]||0);}).forEach(function(k){
          var tc=document.createElement("span");tc.className="chip mono";tc.textContent=k+" ("+a.tools[k]+")";tbox.appendChild(tc);
        });
        card.appendChild(tbox);
      }
      frag.appendChild(card);
    });
    box.appendChild(frag);
  }
  function loadAgents(){var b=$("ag-refresh");b.classList.add("busy");
    return api("/api/agents").then(function(r){agents=r.agents;agentsErr="";},function(e){agents=null;agentsErr=e.message;}).then(function(){b.classList.remove("busy");paintAgents();});}
  $("ag-q").oninput=paintAgents;$("ag-refresh").onclick=function(){loadAgents();};

  /* tabs (kept in the URL hash so a reload stays where you were) */
  function go(name){
    if(TABS.indexOf(name)<0)name="status";tab=name;history.replaceState(null,"",location.pathname+"#"+name);
    document.querySelectorAll(".side nav button").forEach(function(x){var on=x.getAttribute("data-tab")===name;x.className=on?"on":"";x.setAttribute("aria-selected",on?"true":"false");});
    TABS.forEach(function(n){$("tab-"+n).className=n===name?"":"hide";});
    $("page-title").textContent=TITLES[name][0];$("page-sub").textContent=TITLES[name][1];
    if(name==="logs"){syncSeg();loadLogs().then(function(){$("log-text").scrollTop=$("log-text").scrollHeight;});}
    if(name==="status")loadActivity();
    if(name==="tools")loadTools();
    if(name==="agents")loadAgents();
  }
  document.querySelectorAll(".side nav button").forEach(function(b){b.onclick=function(){go(b.getAttribute("data-tab"));};});
  document.querySelector(".side nav").addEventListener("keydown",function(e){
    var bs=[].slice.call(document.querySelectorAll(".side nav button")),i=bs.indexOf(document.activeElement);
    if(i<0)return;var n=null;
    if(e.key==="ArrowRight"||e.key==="ArrowDown")n=(i+1)%bs.length;
    else if(e.key==="ArrowLeft"||e.key==="ArrowUp")n=(i+bs.length-1)%bs.length;
    else if(e.key==="Home")n=0;else if(e.key==="End")n=bs.length-1;
    if(n!==null){e.preventDefault();bs[n].focus();go(bs[n].getAttribute("data-tab"));}
  });
  window.addEventListener("scroll",function(){$("top").className="top"+(window.scrollY>4?" stuck":"");},{passive:true});
  window.addEventListener("beforeunload",function(e){if(isDirty()){e.preventDefault();e.returnValue="";}});
  setInterval(function(){poll();if(tab==="logs"&&$("log-auto").checked)loadLogs();},2000);setInterval(tickUptime,1000);setInterval(loadActivity,5000);
  go((location.hash||"").slice(1));poll();
})();
</script></body></html>`;
export function renderUi(version) {
    return PAGE.replace(/__VERSION__/g, version.replace(/[^0-9A-Za-z.+-]/g, ""))
        .replace(/__FAVICON__/g, () => "data:image/svg+xml," + encodeURIComponent(LOGO_SVG))
        .replace(/__LOGO__/g, () => LOGO_SVG);
}
