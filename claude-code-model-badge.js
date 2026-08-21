#!/usr/bin/env node
// Patches the Claude Code VS Code extension's webview to add two badges next to
// the permission-mode button:
//   * `5h 42% · 7d 18%` — how much of the 5-hour and weekly rate-limit windows
//     you've burned, with a bar per window; click to refresh.
//   * `🧠 Model (effort)` — the active model; click for a model/effort/thinking
//     dropup.
// Unofficial, edits index.js in place.
// Run: node claude-code-model-badge.js  (then reload the VS Code window)
// Rollback: cp webview/index.js.orig webview/index.js  (in the extension folder)

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const MARKER = 'Active model, effort, and thinking mode';

// How often the usage badge asks the host to re-fetch /api/oauth/usage.
// The stock UI only fetches this when the Account & Usage dialog opens, and the
// endpoint answers 429 if you lean on it: one poll per minute per webview was
// enough to get locked out for hours. Five minutes, jittered so several windows
// don't line up, with exponential backoff on failure. Don't lower it.
const USAGE_POLL_MS = 300000;

// How long a cached reading may still be shown after refreshes start failing.
// VS Code destroys a hidden webview, so the cache lives in localStorage or it
// dies with every tab switch. Past this age the figures are dropped rather than
// shown: a 5-hour window moves enough that stale numbers mislead.
const USAGE_STALE_MS = 3600000;

const BRAIN_D = 'M264 64C227.4 64 196.5 88.6 187 122.1C139.6 131.8 104 173.7 104 224C104 235.3 105.8 246.2 109.1 256.3C86.4 275.4 72 304 72 336C72 359.7 80 381.6 93.3 399.1C89.8 409.5 88 420.5 88 432C88 486 129.2 530.5 181.9 535.5C197.5 559.8 224.8 576 256 576C281.2 576 304 565.4 320 548.4C336 565.4 358.8 576 384 576C415.1 576 442.4 559.8 458.1 535.5C510.8 530.4 552 486 552 432C552 420.5 550.1 409.5 546.7 399.1C560.1 381.6 568 359.7 568 336C568 304 553.5 275.4 530.9 256.3C534.2 246.1 536 235.2 536 224C536 173.7 500.4 131.8 453 122.1C443.5 88.6 412.6 64 376 64C354.2 64 334.4 72.7 320 86.9C305.6 72.8 285.8 64 264 64zM296 144L296 491.1C295.9 491.7 295.8 492.3 295.7 493C293.2 512.7 276.4 528 256 528C239.2 528 224.8 517.7 218.9 502.9C215.1 493.3 205.6 487.3 195.3 487.9C194.2 488 193.1 488 192.1 488C161.2 488 136.1 462.9 136.1 432C136.1 422.5 138.5 413.5 142.6 405.7C147.7 396.1 145.7 384.3 137.8 376.9C126.8 366.7 120 352.1 120 336C120 314.4 132.2 295.6 150.3 286.2C156.2 283.2 160.5 277.8 162.3 271.5C164.1 265.2 163.2 258.3 159.8 252.6C154.8 244.2 151.9 234.5 151.9 224C151.9 193.1 177 168 207.9 168C221.2 168 231.9 157.3 231.9 144C231.9 126.3 246.2 112 263.9 112C281.6 112 295.9 126.3 295.9 144zM344 491.1L344 144C344 126.3 358.3 112 376 112C393.7 112 408 126.3 408 144C408 157.3 418.7 168 432 168C462.9 168 488 193.1 488 224C488 234.5 485.1 244.3 480.1 252.6C476.7 258.3 475.8 265.1 477.6 271.5C479.4 277.9 483.8 283.2 489.6 286.2C507.6 295.5 519.9 314.3 519.9 336C519.9 352.1 513.1 366.7 502.1 376.9C494.2 384.3 492.2 396.1 497.3 405.7C501.5 413.5 503.8 422.4 503.8 432C503.8 462.9 478.7 488 447.8 488C446.7 488 445.6 488 444.6 487.9C434.3 487.3 424.8 493.4 421 502.9C415.1 517.6 400.6 528 383.9 528C363.5 528 346.7 512.7 344.2 493C344.1 492.4 344 491.7 343.9 491.1z';
const SLASH_D = 'M34.3 34.2C37.4 31.1 42.5 31.1 45.6 34.2L605.6 594.2C608.7 597.3 608.7 602.4 605.6 605.5C602.5 608.6 597.4 608.6 594.3 605.5L34.3 45.5C31.2 42.4 31.2 37.3 34.3 34.2z';

const BADGE = '(()=>{try{let T=e?.thinkingLevel?.value,O=!T||T==="off",BI=(sl)=>b("svg",{viewBox:"0 0 640 640",fill:"currentColor",style:{display:"inline-block",verticalAlign:"-0.125em",flexShrink:"0",width:"16px",height:"16px"},children:[b("path",{d:"__BRAIN__"}),sl?b("path",{d:"__SLASH__",stroke:"currentColor",strokeWidth:"40",strokeLinecap:"round"}):null]}),R=/^claude-([a-z]+)-(\\d+)(?:-(\\d{1,2}))?(?!\\d)/,PN=(r)=>{let m=String(r??"").match(R);return m?`${m[1].charAt(0).toUpperCase()+m[1].slice(1)} ${m[3]?`${m[2]}.${m[3]}`:m[2]}`:null},W=(d,r)=>d&&/\\d/.test(d)?d:PN(r)??d,D=k?.displayName,L=k?(k.value==="default"?PN(k.resolvedModel)??D:W(D,k.resolvedModel??k.value)):null,MS=e?.claudeConfig?.value?.models??[],X=(ev)=>{let dd=ev.target.closest("details");if(dd)dd.removeAttribute("open")},HE=(ev)=>ev.currentTarget.style.background="var(--vscode-list-hoverBackground)",HL=(ev)=>ev.currentTarget.style.background="transparent",RS={display:"block",width:"100%",textAlign:"left",background:"transparent",border:"none",color:"var(--vscode-foreground)",padding:"4px 8px",borderRadius:"4px",cursor:"pointer",fontSize:"1em",whiteSpace:"nowrap"},HS={padding:"6px 8px 2px",opacity:".65",fontSize:".8em",textTransform:"uppercase",letterSpacing:".05em"};return L?b("details",{style:{position:"relative",display:"inline-block"},children:[b("summary",{className:__CSS__.footerButton,title:"Active model, effort, and thinking mode — click to change",style:{listStyle:"none",color:"var(--app-primary-foreground)"},children:[b("span",{title:O?"Thinking: off":`Thinking: ${T}`,style:{opacity:O?".55":"1",display:"inline-flex",alignItems:"center",padding:"0 5px 0 7px"},children:BI(O)}),b("span",{children:`${L}${f?` (${f})`:""}`})]}),b("div",{onClick:X,style:{position:"fixed",inset:"0",zIndex:"999"}}),b("div",{style:{position:"absolute",bottom:"calc(100% + 8px)",right:"0",zIndex:"1000",minWidth:"220px",maxHeight:"320px",overflowY:"auto",background:"var(--vscode-editorWidget-background)",border:"1px solid var(--vscode-editorWidget-border)",borderRadius:"6px",boxShadow:"0 4px 16px rgba(0,0,0,.35)",padding:"4px",color:"var(--vscode-foreground)",fontSize:".9em"},children:[b("div",{style:HS,children:"Model"}),MS.map((m)=>b("button",{type:"button",disabled:!!m.disabled,onMouseEnter:HE,onMouseLeave:HL,onClick:(ev)=>{void e.setModel(m);X(ev)},style:{...RS,opacity:m.disabled?".5":"1",fontWeight:m.value===S?"600":"400"},children:`${m.value===S?"✓ ":""}${m.value==="default"?`${m.displayName||"Default"}${PN(m.resolvedModel)?` (${PN(m.resolvedModel)})`:""}`:W(m.displayName,m.resolvedModel??m.value)}`})),g?b("div",{style:HS,children:"Effort"}):null,g?g.map((lv)=>b("button",{type:"button",onMouseEnter:HE,onMouseLeave:HL,onClick:(ev)=>{e.setEffortLevel(lv);X(ev)},style:{...RS,fontWeight:lv===f?"600":"400"},children:`${lv===f?"✓ ":""}${lv.charAt(0).toUpperCase()+lv.slice(1)}`})):null,b("div",{style:HS,children:"Thinking"}),b("button",{type:"button",onMouseEnter:HE,onMouseLeave:HL,onClick:(ev)=>{e.setThinkingLevel(O?"default_on":"off");X(ev)},style:{...RS,fontWeight:O?"400":"600"},children:[`${O?"":"✓ "}`,BI(O),` ${O?"Off":"On"}`]})]})]}):null}catch{return null}})(),'.replace('__BRAIN__', BRAIN_D).replace('__SLASH__', SLASH_D);

// The webview session already carries the rate-limit windows the host fetches
// from /api/oauth/usage — `utilization` is a signal holding
// `{five_hour, seven_day, ...}` with `{utilization: 0-100, resets_at: ISO string}`.
// Nothing in the stock UI reads it, and the host only refreshes it on request,
// so the badge drives its own polling through `requestUsageUpdate()`.
//
// A failed fetch blanks the signal host-side, so the last good reading is cached
// on `globalThis` and kept on screen dimmed rather than letting the badge vanish
// — and the poller backs off instead of hammering an endpoint already saying no.
const USAGE_BADGE = '(()=>{try{let G=globalThis,K="__ccUsageBadge",LS="cc-usage-badge-cache",S=G[K],PS=(w,t)=>{try{G.localStorage&&G.localStorage.setItem(LS,JSON.stringify({w:w,at:t}))}catch{}};if(!S){let c=null;try{let v=G.localStorage&&G.localStorage.getItem(LS);if(v){let o=JSON.parse(v);if(o&&Array.isArray(o.w)&&o.w.length&&Date.now()-o.at<__STALE__)c=o}}catch{}S=G[K]={s:e,ok:c?c.w:null,at:c?c.at:0,key:"",fail:0,next:0};let P=()=>{let n=Date.now(),z=S.s;if(!z||n<S.next)return;S.next=n+__POLL__+Math.random()*60000;Promise.resolve(z.requestUsageUpdate()).then(()=>{let u=z.utilization?.value;if(u&&(typeof u.five_hour?.utilization==="number"||typeof u.seven_day?.utilization==="number"))S.fail=0,S.at=Date.now(),S.ok&&PS(S.ok,S.at);else S.fail=Math.min(S.fail+1,3),S.next=Date.now()+Math.min(__POLL__*Math.pow(2,S.fail),1800000)},()=>{})};setTimeout(P,0),setInterval(P,30000)}S.s=e;let U=e?.utilization?.value,W=[["5h","Session (5h)",U?.five_hour],["7d","Weekly (7d)",U?.seven_day]].flatMap(([k,l,w])=>typeof w?.utilization==="number"?[{k,l,p:Math.max(0,Math.min(100,w.utilization)),r:w.resets_at}]:[]),ST=!1;if(W.length){S.ok=W;let ky=W.map((x)=>x.k+x.p).join("|");if(S.key!==ky||!S.at)S.key=ky,S.at=Date.now(),PS(W,S.at)}else if(S.ok&&Date.now()-S.at<__STALE__)W=S.ok,ST=!0;if(W.length===0)return null;let RT=(v)=>{let d=new Date(v).getTime()-Date.now();if(!(d>0))return "soon";let m=Math.floor(d/60000);if(m<60)return `in ${m}m`;let h=Math.floor(m/60);if(h<24)return `in ${h}h`;return `in ${Math.floor(h/24)}d`},AG=(d)=>{let m=Math.round(d/60000);return m<1?"moments ago":m<60?`${m}m ago`:`${Math.round(m/60)}h ago`},M=Math.max(...W.map((x)=>x.p)),C=M>=95?"var(--vscode-errorForeground)":M>=80?"var(--vscode-editorWarning-foreground)":void 0;return b("button",{type:"button",className:__CSS__.footerButton,title:W.map((x)=>`${x.l}: ${Math.floor(x.p)}% used${x.r?` \\u00B7 resets ${RT(x.r)}`:""}`).concat(ST?[`Stale \\u00B7 last refresh ${AG(Date.now()-S.at)}`,"Click to retry"]:["Click to refresh"]).join("\\n"),onClick:()=>{try{S.fail=0,S.next=Date.now()+__POLL__,e.requestUsageUpdate()}catch{}},style:{...C?{color:C}:{},...ST?{opacity:".55"}:{}},children:W.map((x,i)=>b("span",{style:{display:"inline-flex",alignItems:"center",gap:"4px",maxWidth:"none",marginLeft:i?"4px":"0"},children:[b("span",{style:{position:"relative",display:"inline-block",width:"20px",height:"4px",flexShrink:"0"},children:[b("span",{style:{position:"absolute",inset:"0",borderRadius:"2px",background:"currentColor",opacity:".25"}}),b("span",{style:{position:"absolute",left:"0",top:"0",bottom:"0",borderRadius:"2px",background:"currentColor",width:`${x.p}%`}})]}),b("span",{children:`${x.k} ${Math.floor(x.p)}%`})]},x.k))})}catch{return null}})(),'.replace(/__POLL__/g, String(USAGE_POLL_MS)).replace(/__STALE__/g, String(USAGE_STALE_MS));

// Both badges land between the spacer and the permission-mode button, usage
// first so the reading order is usage · model · mode.
const PATCH = USAGE_BADGE + BADGE;

const ANCHOR = /(className:([\w$]+)\.spacer\}\),)(b\([\w$]+,\{mode:[\w$]+,availableModes:[\w$]+,onSelect:\([\w$]+\)=>void [\w$]+\.setPermissionMode\([\w$]+,!0\),anchorRight:!0,effortLevel:[\w$]+,supportedEffortLevels:[\w$]+,onSetEffort:[\w$]+,ultracodeAvailable:[\w$]+,ultracodeSelected:[\w$]+,onSelectUltracode:[\w$]+\}\))/;

const INSTALLED_BADGE_RE = new RegExp(
  PATCH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/__CSS__/g, '[\\w$]+')
);

const EXTENSIONS_DIR = path.join(os.homedir(), '.vscode', 'extensions');

const patchSource = (source) => {
  if (INSTALLED_BADGE_RE.test(source)) {
    return { status: 'already-patched', source };
  }

  if (source.includes(MARKER)) {
    return { status: 'outdated', source };
  }

  if (!ANCHOR.test(source)) {
    return { status: 'anchor-not-found', source };
  }

  const patched = source.replace(ANCHOR, (_match, spacer, cssName, modeSelector) => `${spacer}${PATCH.replace(/__CSS__/g, cssName)}${modeSelector}`);

  new vm.Script(patched); // parse-check; throws if the edit broke the bundle

  return { status: 'patched', source: patched };
};

const patchExtensionDir = (extDir) => {
  const bundle = path.join(extDir, 'webview', 'index.js');
  if (!fs.existsSync(bundle)) {
    return 'no webview/index.js — skipped';
  }

  const backup = `${bundle}.orig`;
  let { status, source } = patchSource(fs.readFileSync(bundle, 'utf8'));

  if (status === 'already-patched') {
    return 'already patched — skipped';
  }

  if (status === 'outdated') {
    if (!fs.existsSync(backup)) {
      return 'outdated badge but no index.js.orig backup — reinstall the extension to reset';
    }
    ({ status, source } = patchSource(fs.readFileSync(backup, 'utf8')));
    if (status === 'patched') {
      fs.writeFileSync(bundle, source);
      return 'badge upgraded from index.js.orig ✓ (reload the VS Code window)';
    }
    return `re-patch from backup failed (${status}) — bundle left with the old badge`;
  }

  if (status === 'anchor-not-found') {
    return 'anchor not found — left untouched (bundle layout changed; update the regex)';
  }

  if (!fs.existsSync(backup)) {
    fs.copyFileSync(bundle, backup);
  }
  fs.writeFileSync(bundle, source);
  return 'patched ✓ (reload the VS Code window to see the badge)';
};

const main = () => {
  const stamp = () => `[${new Date().toISOString()}]`;
  const dirs = fs.readdirSync(EXTENSIONS_DIR)
    .filter((name) => name.startsWith('anthropic.claude-code-'))
    .map((name) => path.join(EXTENSIONS_DIR, name))
    .sort();

  if (dirs.length === 0) {
    console.log(`${stamp()} No anthropic.claude-code-* folders under ${EXTENSIONS_DIR}.`);
    return;
  }

  dirs.forEach((dir, index) => {
    const label = path.basename(dir);
    let outcome;
    try {
      outcome = patchExtensionDir(dir);
    } catch (error) {
      outcome = `FAILED, file untouched — ${error.message}`;
    }
    console.log(`${stamp()} [${index + 1}/${dirs.length}] ${label}: ${outcome}`);
  });
};

if (require.main === module) {
  main();
}

module.exports = { patchSource, MARKER, BADGE, USAGE_BADGE, PATCH, ANCHOR };
