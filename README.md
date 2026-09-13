# cc-vscode-statusbar

The Claude Code VS Code extension only shows how much of your rate limits you've used inside its
*Account & Usage* dialog. This patch puts it in the footer: **`5h 42% · 7d 18%`**, the share of
the 5-hour session window and the 7-day weekly window you've burned, with a bar each, right
before the permission-mode button. Reset times on hover, amber at 80% and red at 95%, click to
refresh.

It reads the same figures as that dialog, which means it needs a Claude AI subscription login
(Pro / Max / Team) — no other auth method reports those windows, and the badge then stays
hidden — and it asks the extension to refresh them every five minutes per open webview.

## Install

Ask Claude Code to do it:

> Install the usage badge patch from https://github.com/TsKyrk/cc-vscode-statusbar on this
> machine, and add a `SessionStart` hook so it survives extension updates.

Or run it yourself:

```sh
node claude-code-model-badge.js
```

Either way, reload the VS Code window afterwards (`Ctrl+Shift+P` → *Developer: Reload Window*).

**Re-run it after every extension update.** Updates install a fresh copy that has never been
patched. The hook mentioned above automates this.

The script keeps the name it had when it added a model badge, so hooks already pointing at it
keep working.

## Uninstall

Every extension folder keeps an untouched `webview/index.js.orig`. Copy it back over
`index.js`, or just reinstall the extension.

## What happened to the model badge

This repository started as a model badge — model, effort level and thinking mode next to the
permission-mode button — because the extension had no such indicator, as requested in
[anthropics/claude-code#28986](https://github.com/anthropics/claude-code/issues/28986). The
extension now ships its own: a model pill in the footer showing the model and effort, click to
switch, present since at least `2.1.266`. As this README always said it would, the model badge
was retired rather than kept alongside it. The usage badge, which had lived on a
`feat/usage-limits-badge` branch, is what's left, and is now `main`.

Running the script over a bundle patched by an earlier version removes the model badge: it
recognises the old patch and re-patches from `index.js.orig`.

The same rule applies to what remains. The day the extension shows the rate-limit windows in
its footer, this repository is dead weight and should be archived. Patching a bundled file is a
workaround, not a solution. Treat it as one.

## Credits

The original model badge script was written and published by
**[@ianwieds](https://github.com/ianwieds)** in a comment on
[anthropics/claude-code#28986](https://github.com/anthropics/claude-code/issues/28986), and this
repository first republished it as-is. The badge is gone, but the way the script patches — anchor
on a call-site, capture identifiers rather than assume them, `index.js.orig` backup, parse-check
before writing, idempotent re-runs — is still Ian's.

Thank you, Ian, for the fix — the least we can do is send some traffic your way. Ian is a
solopreneur based in Los Angeles building digital products at
[ITW Creative Works](https://itwcreativeworks.com) — a portfolio of SaaS tools and APIs
spanning social media automation, marketing tech, AI chatbots, and developer utilities. Check
out what he's shipping.

Usage badge and maintenance: [@TsKyrk](https://github.com/TsKyrk). Packaging and verification:
[Claude Code](https://claude.com/claude-code).

## License

None set, and none claimed here. The script grew out of [@ianwieds](https://github.com/ianwieds)'
published work; for any reuse beyond running it, ask.

---

# Notes for Claude Code

*Everything below is for the agent doing the install. Humans can stop reading.*

## Whether to install it

It only pays off on a Claude AI subscription login; on anything else the badge renders nothing.
Check rather than making the user self-declare:

```js
// ~/.claude.json — `oauthAccount` is written by a Claude AI (OAuth) login
const os = require('os'), fs = require('fs');
const j = JSON.parse(fs.readFileSync(`${os.homedir()}/.claude.json`, 'utf8'));
j.oauthAccount?.organizationType;   // "claude_pro", "claude_max", … — absent on API-key logins
```

That is the *CLI's* login and the extension keeps its own auth state; the same account in
practice on one machine, but a heuristic, not proof. Say which way it came out and let the user
decide.

## What the patch does

It injects a preact element immediately after the footer spacer, before the permission-mode
selector, in the extension's minified webview bundle, anchored on:

```
className:<css>.spacer}),<h>(<component>,{mode:<m>,availableModes:<a>,onSelect:(<x>)=>void <session>.setPermissionMode(
```

`ANCHOR` captures `<css>`, `<h>` (the element creator) and `<session>` from that call-site rather
than assuming their minified names.

The figures come from the module-scope signal the host feeds with `panel_usage_update` —
`{five_hour, seven_day, ...}`, each window `{utilization: 0-1, resetsAt: epoch seconds}`, the same
signal the extension's sidebar usage bars read. Its minified name is never visible at the anchor,
so `usageWindowsVar` derives it in two hops from shapes rather than names: the
`panel_usage_update` relay names the merge function, and the merge function's body names the
signal. The badge polls `session.requestUsageUpdate()` to keep it fresh, and caches the last good
reading in `localStorage` so a rebuilt webview shows it dimmed instead of nothing.

That poll is the only part worth being careful with. `/api/oauth/usage` answers **429** if you
lean on it, and the stock extension only refreshes when asked — one poll per minute per webview
was enough to get locked out for hours, and because a failed fetch leaves the signal empty, the
badge silently vanished rather than looking broken. Hence `USAGE_POLL_MS` at five minutes with
jitter, exponential backoff on failure, and the dimmed cache. Don't lower it.

## Verify before writing anything

`patchSource` is exported, so the patch can be exercised entirely in memory first:

```js
const { patchSource, usageWindowsVar } = require('./claude-code-model-badge.js');
const src = require('fs').readFileSync(bundlePath, 'utf8');

usageWindowsVar(src);                          // expect: a short identifier, e.g. "aG"
patchSource(src).status;                       // expect: patched
patchSource(patchSource(src).source).status;   // expect: already-patched
patchSource('const x=1;').status;              // expect: usage-signal-not-found
```

`patched` then `already-patched` proves the anchor and the signal were both found in this build
*and* that re-runs are safe. `usage-signal-not-found` or `anchor-not-found` on a real bundle
means stop — the minified layout changed and `USAGE_RELAY` or `ANCHOR` needs updating. Report
that rather than forcing it.

A matching anchor is necessary but not sufficient. Confirm these exist in the bundle too:

| Symbol | Why it matters |
|---|---|
| `<css>.footerButton` | the class the badge reuses; check it appears elsewhere in the bundle |
| `requestUsageUpdate` | what the badge calls to refresh the figures |
| `five_hour`, `seven_day`, `resetsAt` | the window shape the badge reads from the signal |

Worth the two minutes: the badge is wrapped in a `try/catch` that renders `null`, so a wrong
assumption breaks nothing — it just makes the badge silently not appear, which is far harder
to diagnose afterwards.

## Safety properties already in the script

| Property | Effect |
|---|---|
| Anchor or signal miss | Bundle left untouched rather than blindly rewritten |
| `new vm.Script(patched)` | Parse-check before any write; a broken edit is never persisted |
| `index.js.orig` backup | Written before the first modification |
| Idempotent | Re-running detects the current badge and skips |
| Older patch detected | Re-patched from `index.js.orig` instead of stacked on top |
| `try/catch` around the badge | Renders `null` on unexpected state instead of breaking the UI |

## Expect several extension folders

VS Code keeps previously installed versions on disk. The script patches every
`anthropic.claude-code-*` folder it finds; only the newest is loaded, so patching stale ones
is harmless noise, not an error. Report it as such — three "patched ✓" lines is the normal
output on a machine with three versions installed.

## The hook

It belongs in **user** settings (`~/.claude/settings.json`), *not* a project's
`.claude/settings.json`. The latter is normally committed, which would patch teammates'
extensions on their machines without their knowledge. Say this out loud before writing it.

```json
"hooks": {
  "SessionStart": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "node \"/absolute/path/to/claude-code-model-badge.js\" >> \"$HOME/.claude/model-badge.log\" 2>&1 || true",
          "timeout": 15
        }
      ]
    }
  ]
}
```

- **Redirect the output.** The script prints one line per extension folder; without the
  redirect those land in the agent's context at every session start.
- **`|| true`.** If the clone is later moved or deleted, session start must not fail.
- On Windows, hooks run under Git Bash when installed, so `$HOME` resolves.

**Expect the hook edit to be refused on the first attempt.** Claude Code's auto-mode
classifier blocks writing hooks, since a hook is an arbitrary command run at every session
start. That's the guardrail working. Explain it and let the user approve — do not route
around it by writing the file through a shell.

After editing `settings.json`, re-parse it. A malformed settings file silently disables
*every* setting it contains, not just the hook.

## Two things that are not instant

- The badge appears on the next **window reload**, not when the patch runs.
- The hook runs at session start, and VS Code may already have loaded the webview from the
  unpatched bundle by then. After an extension update the user is at most one reload behind —
  not zero. Tell them, so they don't think it failed.

## Verified against

| Extension version | Result |
|---|---|
| `2.1.217-win32-x64` | yes |
| `2.1.218-win32-x64` | yes |
| `2.1.220-win32-x64` | yes |
| `2.1.228-win32-x64` | no — anchor rewritten below |
| `2.1.233-win32-x64` | yes (after rewrite) |
| `2.1.234-win32-x64` | yes (after rewrite) |
| `2.1.247-win32-x64` | no — badge rewritten below |
| `2.1.250-win32-x64` | yes (after rewrite) |
| `2.1.266-win32-x64` | anchor yes; usage badge blank — usage source rewritten below |
| `2.1.268-win32-x64` | yes (after rewrite) |
| `2.1.270-win32-x64` | yes; model badge retired, anchor narrowed below |

The anchor depended on minified variable names, which change between builds. `2.1.228` broke it
(the mode-selector call site's last prop, `onSelectUltracode:y`, became `:x`; everything else
held). The regex then matched `[\w$]+` for every prop *value* in that call instead of hardcoding
them — only the literal prop names and surrounding syntax were fixed.

`2.1.247` broke it further up the stack: the model badge snippet itself hardcoded single-letter
identifiers (`b` for the element-creator function, `e` for the session object, and others),
betting the minifier would keep reusing those same letters. It had for several builds by
coincidence, then didn't. Since then `ANCHOR` captures the identifiers the patch needs directly
from the anchor call site, the one place they appear undisguised, and threads them into the
snippet.

`2.1.266` left the anchor intact but moved the usage data out from under the usage badge, which
then rendered nothing at all: the session's `.utilization` signal is gone. The windows now arrive
as a `panel_usage_update` message the host pushes to the webview and land in a module-scope
signal, renamed and rescaled on the way — `fiveHour`/`sevenDay` became `five_hour`/`seven_day`,
`utilization` went from a percentage to a 0-1 fraction, and `resetsAt` from an ISO string to
epoch seconds (absent once the window has rolled over). The badge reads that signal instead, and
derives its minified name from the relay call-site rather than hardcoding it.
`requestUsageUpdate()` still drives the refresh, unchanged.

`2.1.268` shipped two days later and is the reason that name is derived rather than written down:
the same signal is `kG` in `2.1.266`, `xG` in `2.1.268` and `aG` in `2.1.270`.

`2.1.270` changed nothing the patch depends on, but it is where the model badge was retired in
favour of the extension's own model pill (which had in fact been there since at least `2.1.266`).
With it went the anchor's need for the selector's effort props: `ANCHOR` now stops at
`setPermissionMode(`, capturing only the CSS object, element creator and session, so a
reshuffle of the props after it can no longer break the match. Add rows here when you confirm a
new version.
