# Contributing

This is a personal hobby project shared as-is under the MIT License. There's no formal contribution process, and issues/PRs aren't actively monitored — fork the repo and change whatever you want.

The notes below just explain how the project is put together, in case you're building on it.

**One rule:** don't commit printer IPs, API keys, or other credentials. Use placeholder values in examples.

## Development setup

1. Clone the repository.
2. Install [Node.js 18+](https://nodejs.org).
3. Install the iCUE widget CLI:

   ```powershell
   npm install -g @icue/icuewidget-cli
   ```

4. Start the bridge while testing:

   ```powershell
   cd bridge
   ./start-bridge.ps1
   ```

5. Validate and package after widget changes:

   ```powershell
   node --check widget/scripts/widget.js
   icuewidget validate widget
   icuewidget package widget
   ```

6. Re-import the generated `prusa-status.icuewidget` in iCUE. After code changes, quit iCUE fully (tray), remove the old widget definition, then import the new package.

## Project layout

| Path | Purpose |
|------|---------|
| `widget/` | iCUE widget (HTML, JS, CSS, manifest, translations) |
| `bridge/` | Local Node bridge that proxies PrusaLink requests |
| `bridge/run-hidden.vbs` | Generated locally by `install-autostart.ps1` (not committed) |
| `prusa-status.icuewidget` | Packaged widget output (rebuild with `icuewidget package widget`) |

## How it's built

### Widget (`widget/`)

- Keep the widget compatible with the iCUE QtWebEngine sandbox — no external CDN scripts, no direct calls to the printer (use the bridge).
- Read iCUE properties with the existing `prop()` pattern in `widget/scripts/widget.js`.
- New user-facing labels in `index.html` should use the `tr('...')` pattern and get a matching entry in `widget/translation.json`.
- Bump `version` in `widget/manifest.json` when shipping changes, then re-run `icuewidget package widget`.

### Bridge (`bridge/`)

- The bridge must stay bound to `127.0.0.1` only.
- Prefer Node built-in modules; avoid adding dependencies unless necessary.
- Preserve the existing endpoints: `GET /health` and `POST /data`.
- Do not commit `run-hidden.vbs`; it contains machine-specific paths and is recreated by `install-autostart.ps1`.
- Restart the bridge after bridge changes for them to take effect.
