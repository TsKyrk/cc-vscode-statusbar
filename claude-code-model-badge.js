#!/usr/bin/env node
// Patches the Claude Code VS Code extension's webview to add a rate-limit usage
// badge next to the permission-mode button: `5h 42% · 7d 18%` — how much of the
// 5-hour and weekly windows you've burned, with a bar per window; click to refresh.
// Unofficial, edits index.js in place.
// Run: node claude-code-model-badge.js  (then reload the VS Code window)
// Rollback: cp webview/index.js.orig webview/index.js  (in the extension folder)
//
// The file keeps its old name so SessionStart hooks already pointing at it keep
// working. The model badge it used to add is gone: the extension ships its own
// model pill (present since at least 2.1.266).

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

// Text only ever found in a bundle this script patched. Either one, where the
// bundle doesn't hold exactly the current badge, sends it back to index.js.orig
// for a clean re-patch.
//
// The retired model badge's tooltip is checked *before* the already-patched test:
// a bundle patched while both badges existed also carries the current usage badge
// verbatim, and would otherwise be skipped with the model badge still in it.
const RETIRED_MODEL_BADGE = 'Active model, effort, and thinking mode';
// The usage badge's globalThis key, present in every version of it.
const USAGE_BADGE_KEY = '"__ccUsageBadge"';

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

// The rate-limit windows the host pushes to the webview as `panel_usage_update`
// land in a module-scope signal — `{five_hour, seven_day, ...}`, each window
// `{utilization: 0-1, resetsAt: epoch seconds}` — which is also what the sidebar
// usage bars read. Nothing refreshes it on a timer, so the badge keeps asking
// the host for a fresh reading through `requestUsageUpdate()` and re-renders off
// the signal. (Through 2.1.265 this sat on the session as `.utilization`, with
// camelCase window names, percentages and ISO reset times; that property is gone
// — reading it is why the badge went blank on 2.1.266.)
//
// The signal is empty until the first push lands, and a webview VS Code destroyed
// and rebuilt starts empty again, so the last good reading is cached in
// localStorage and kept on screen dimmed rather than letting the badge vanish —
// and the poller backs off instead of hammering an endpoint already saying no.
const USAGE_BADGE = '(()=>{try{let G=globalThis,K="__ccUsageBadge",LS="cc-usage-badge-cache-v2",S=G[K],PS=(w,t)=>{try{G.localStorage&&G.localStorage.setItem(LS,JSON.stringify({w:w,at:t}))}catch{}},RW=()=>{let u=__WINDOWS__?.value,n=Date.now();return[["5h","Session (5h)",u?.five_hour],["7d","Weekly (7d)",u?.seven_day]].flatMap(([k,l,w])=>{if(!w||typeof w.utilization!=="number")return[];let r=typeof w.resetsAt==="number"?w.resetsAt*1000:0;return[{k:k,l:l,p:r&&r<=n?0:Math.max(0,Math.min(100,w.utilization*100)),r:r}]})};if(!S){let c=null;try{let v=G.localStorage&&G.localStorage.getItem(LS);if(v){let o=JSON.parse(v);if(o&&Array.isArray(o.w)&&o.w.length&&Date.now()-o.at<__STALE__)c=o}}catch{}S=G[K]={s:__SESSION__,ok:c?c.w:null,at:c?c.at:0,key:"",fail:0,next:0};let BO=()=>{S.fail=Math.min(S.fail+1,3),S.next=Date.now()+Math.min(__POLL__*Math.pow(2,S.fail),1800000)},P=()=>{let n=Date.now(),z=S.s;if(!z||n<S.next)return;S.next=n+__POLL__+Math.random()*60000;Promise.resolve(z.requestUsageUpdate()).then(()=>{setTimeout(()=>{if(RW().length)S.fail=0;else BO()},2000)},BO)};setTimeout(P,0),setInterval(P,30000)}S.s=__SESSION__;let W=RW(),ST=!1;if(W.length){S.ok=W;let ky=W.map((x)=>x.k+x.p).join("|");if(S.key!==ky||!S.at)S.key=ky,S.at=Date.now(),PS(W,S.at)}else if(S.ok&&Date.now()-S.at<__STALE__)W=S.ok,ST=!0;if(W.length===0)return null;let RT=(v)=>{let d=v-Date.now();if(!(d>0))return "soon";let m=Math.floor(d/60000);if(m<60)return `in ${m}m`;let h=Math.floor(m/60);if(h<24)return `in ${h}h`;return `in ${Math.floor(h/24)}d`},AG=(d)=>{let m=Math.round(d/60000);return m<1?"moments ago":m<60?`${m}m ago`:`${Math.round(m/60)}h ago`},M=Math.max(...W.map((x)=>x.p)),C=M>=95?"var(--vscode-errorForeground)":M>=80?"var(--vscode-editorWarning-foreground)":void 0;return __H__("button",{type:"button",className:__CSS__.footerButton,title:W.map((x)=>`${x.l}: ${Math.floor(x.p)}% used${x.r?` \\u00B7 resets ${RT(x.r)}`:""}`).concat(ST?[`Stale \\u00B7 last refresh ${AG(Date.now()-S.at)}`,"Click to retry"]:["Click to refresh"]).join("\\n"),onClick:()=>{try{S.fail=0,S.next=Date.now()+__POLL__,__SESSION__.requestUsageUpdate()}catch{}},style:{...C?{color:C}:{},...ST?{opacity:".55"}:{}},children:W.map((x,i)=>__H__("span",{style:{display:"inline-flex",alignItems:"center",gap:"4px",maxWidth:"none",marginLeft:i?"4px":"0"},children:[__H__("span",{style:{position:"relative",display:"inline-block",width:"20px",height:"4px",flexShrink:"0"},children:[__H__("span",{style:{position:"absolute",inset:"0",borderRadius:"2px",background:"currentColor",opacity:".25"}}),__H__("span",{style:{position:"absolute",left:"0",top:"0",bottom:"0",borderRadius:"2px",background:"currentColor",width:`${x.p}%`}})]}),__H__("span",{children:`${x.k} ${Math.floor(x.p)}%`})]},x.k))})}catch{return null}})(),'.replace(/__POLL__/g, String(USAGE_POLL_MS)).replace(/__STALE__/g, String(USAGE_STALE_MS));

// The badge goes in right after the footer spacer, before the permission-mode
// selector. That call-site is the one place the per-build identifiers the badge
// needs appear undisguised — the CSS-module object (from the spacer), the
// element-creator function and the session object — so they are captured here
// rather than assumed to keep a fixed name. Only as much of the selector call is
// matched as yields them: the effort props after it only ever mattered to the
// retired model badge, and each one was something a build could reshuffle.
const ANCHOR = /(className:([\w$]+)\.spacer\}\),)(([\w$]+)\([\w$]+,\{mode:[\w$]+,availableModes:[\w$]+,onSelect:\([\w$]+\)=>void ([\w$]+)\.setPermissionMode\()/;

// The signal holding the usage windows is module-scope and never named at the
// badge's own call-site, so it is derived in two hops from shapes rather than
// names, the same way ANCHOR captures the rest: the `panel_usage_update` relay
// names the merge function, and the merge function's body names the signal.
const USAGE_RELAY = /case"panel_usage_update":([\w$]+)\([\w$]+\.request\.unifiedWindows\)/;

const usageWindowsVar = (source) => {
  const relay = source.match(USAGE_RELAY);
  if (!relay) return null;
  const merge = source.match(new RegExp(
    `function ${relay[1].replace(/\$/g, '\\$')}\\(([\\w$]+)\\)\\{` +
    'let ([\\w$]+)=[\\w$]+\\(([\\w$]+)\\.value,\\1\\);if\\(\\2!==\\3\\.value\\)\\3\\.value=\\2\\}'
  ));
  return merge ? merge[3] : null;
};

const installedBadgeRe = (patch) => new RegExp(
  patch
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/__(?:CSS|H|SESSION|WINDOWS)__/g, '[\\w$]+')
);

const EXTENSIONS_DIR = path.join(os.homedir(), '.vscode', 'extensions');

const patchSource = (source) => {
  const windowsVar = usageWindowsVar(source);

  if (source.includes(RETIRED_MODEL_BADGE)) {
    return { status: 'outdated', source };
  }

  if (windowsVar && installedBadgeRe(USAGE_BADGE).test(source)) {
    return { status: 'already-patched', source };
  }

  if (source.includes(USAGE_BADGE_KEY)) {
    return { status: 'outdated', source };
  }

  if (!windowsVar) {
    return { status: 'usage-signal-not-found', source };
  }

  if (!ANCHOR.test(source)) {
    return { status: 'anchor-not-found', source };
  }

  // Function replacers: minified names such as `$$` are valid identifiers, and a
  // replacement *string* would read them as substitution patterns.
  const patched = source.replace(ANCHOR, (_match, spacer, cssName, modeSelector, hFn, sessionVar) => {
    const patch = USAGE_BADGE
      .replace(/__CSS__/g, () => cssName)
      .replace(/__H__/g, () => hFn)
      .replace(/__SESSION__/g, () => sessionVar)
      .replace(/__WINDOWS__/g, () => windowsVar);
    return `${spacer}${patch}${modeSelector}`;
  });

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

  if (status === 'usage-signal-not-found') {
    return 'usage signal not found — left untouched (the usage relay changed; update USAGE_RELAY)';
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

module.exports = { patchSource, usageWindowsVar, RETIRED_MODEL_BADGE, USAGE_BADGE_KEY, USAGE_BADGE, ANCHOR, USAGE_RELAY };
