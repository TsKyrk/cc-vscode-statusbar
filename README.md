# cc-vscode-statusbar

The Claude Code VS Code extension doesn't tell you which model you're talking to. This patch
adds a badge that does — model, effort level and thinking mode, always visible next to the
permission-mode button. Click it to switch any of the three.

https://github.com/user-attachments/assets/f6c3586f-c93b-4dea-965c-29fdc98389e7

## Install

Ask Claude Code to do it:

> Install the model badge patch from https://github.com/TsKyrk/cc-vscode-statusbar on this
> machine, and add a `SessionStart` hook so it survives extension updates.

Or run it yourself:

```sh
node claude-code-model-badge.js
```

Either way, reload the VS Code window afterwards (`Ctrl+Shift+P` → *Developer: Reload Window*).

**Re-run it after every extension update.** Updates install a fresh copy that has never been
patched. The hook mentioned above automates this.

## Uninstall

Every extension folder keeps an untouched `webview/index.js.orig`. Copy it back over
`index.js`, or just reinstall the extension.

## This project deserves to die

It exists only because the extension has no such indicator. The feature was requested in
[anthropics/claude-code#28986](https://github.com/anthropics/claude-code/issues/28986); the
day Anthropic ships it, this repository becomes dead weight and should be archived.

Patching a bundled file is a workaround, not a solution. Treat it as one.

## Credits

`claude-code-model-badge.js` was written and published by
**[@ianwieds](https://github.com/ianwieds)** in a comment on
[anthropics/claude-code#28986](https://github.com/anthropics/claude-code/issues/28986). This
repository republishes it unmodified so it's easier to find and re-run than a comment buried
in an issue thread. The demo above is theirs too.

Thank you, Ian, for the fix — the least we can do is send some traffic your way. Ian is a
solopreneur based in Los Angeles building digital products at
[ITW Creative Works](https://itwcreativeworks.com) — a portfolio of SaaS tools and APIs
spanning social media automation, marketing tech, AI chatbots, and developer utilities. Check
out what he's shipping.

Packaging and verification: [Claude Code](https://claude.com/claude-code).

## License

None set, and none claimed here. The script is [@ianwieds](https://github.com/ianwieds)' work,
reproduced as published. For any reuse beyond that, ask them.

---

# Notes for Claude Code

*Everything below is for the agent doing the install. Humans can stop reading.*

## What the patch does

It injects a preact element immediately before the permission-mode selector in the extension's
minified webview bundle, anchored on:

```
className:<css>.spacer}),b(<component>,{mode:t,availableModes:i,onSelect:(D)=>void e.setPermissionMode(D,!0),...})
```

The injected code reuses variables already in scope there and calls the webview's own methods.
It never adds state of its own.

## Verify before writing anything

`patchSource` is exported, so the patch can be exercised entirely in memory first:

```js
const { patchSource } = require('./claude-code-model-badge.js');
const src = require('fs').readFileSync(bundlePath, 'utf8');

patchSource(src).status;                       // expect: patched
patchSource(patchSource(src).source).status;   // expect: already-patched
patchSource('const x=1;').status;              // expect: anchor-not-found
```

`patched` then `already-patched` proves the anchor matches this build *and* that re-runs are
safe. `anchor-not-found` on a real bundle means stop — the minified layout changed and
`ANCHOR` needs updating. Report that rather than forcing it.

A matching anchor is necessary but not sufficient. Confirm these exist in the bundle too:

| Symbol | Why it matters |
|---|---|
| `k`, `S` | resolved model object and normalized selection — the badge label |
| `f`, `g` | effort level and supported levels — the effort section of the dropup |
| `<css>.footerButton` | the class the badge reuses; check it appears elsewhere in the bundle |
| `setModel`, `setEffortLevel`, `setThinkingLevel` | what the dropup calls |

Worth the two minutes: the badge is wrapped in a `try/catch` that renders `null`, so a wrong
assumption breaks nothing — it just makes the badge silently not appear, which is far harder
to diagnose afterwards.

## Safety properties already in the script

| Property | Effect |
|---|---|
| Anchor miss | Bundle left untouched rather than blindly rewritten |
| `new vm.Script(patched)` | Parse-check before any write; a broken edit is never persisted |
| `index.js.orig` backup | Written before the first modification |
| Idempotent | Re-running detects an existing badge and skips |
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
- The hook runs at session start, so after an extension update the user is at most one reload
  behind — not zero. Tell them, so they don't think it failed.

## Verified against

| Extension version | Anchor match |
|---|---|
| `2.1.217-win32-x64` | yes |
| `2.1.218-win32-x64` | yes |
| `2.1.220-win32-x64` | yes |
| `2.1.228-win32-x64` | no — anchor rewritten below |
| `2.1.233-win32-x64` | yes (after rewrite) |
| `2.1.234-win32-x64` | yes (after rewrite) |

The anchor depended on minified variable names, which change between builds. `2.1.228` broke it
(the mode-selector call site's last prop, `onSelectUltracode:y`, became `:x`; everything else
held). The regex now matches `[\w$]+` for every prop *value* in that call instead of hardcoding
them — only the literal prop names and surrounding syntax are fixed — so a future rename of that
kind won't need another patch. Add rows here when you confirm a new version.
