# Prusa Status — Corsair Xeneon Edge Widget

Live PrusaLink print status on your Corsair Xeneon Edge display via iCUE.

This project has two parts:

- **`widget/`** — the iCUE widget itself, which renders on your Xeneon Edge tile.
- **`bridge/`** — a small Node server that runs on your PC and relays requests to your printer. It exists because iCUE widgets can't talk to PrusaLink directly (no CORS, and PrusaLink requires HTTP digest auth that the widget sandbox can't perform).

**What it shows:**

- Printer state (Idle, Printing, Paused, etc.)
- Current print file name
- Job progress and time remaining
- Nozzle and bed temperatures (current / target)

## Requirements

- **Windows** with [iCUE 5.47+](https://www.corsair.com/icue)
- **Node.js 18+** for the local bridge
- A **Prusa printer** with PrusaLink on your LAN
- Your printer **IP address**, **API key**, and optionally **username** (`maker` on MK4/XL)

## Installation

### 1. Get the project

Clone or download this repository. A pre-built widget is included — you do not need to build anything to get started.

### 2. Start the bridge

```powershell
cd bridge
./start-bridge.ps1
```

Verify it is running: [http://127.0.0.1:37655/health](http://127.0.0.1:37655/health)

Keep this running while the widget is in use. The bridge listens on `127.0.0.1` only.

**Optional — start at login (no console window):**

```powershell
cd bridge
./install-autostart.ps1
```

This registers a Windows scheduled task and writes `bridge/run-hidden.vbs` locally with paths for your machine. That file is not in the repo — do not edit it manually. Run `./install-autostart.ps1` after cloning, after moving the project folder, or if you change Node install location or bridge port. Re-run with `-Port` if you use a non-default port (must match Bridge Port in iCUE).

Remove autostart and the local launcher with `./uninstall-autostart.ps1`.

### 3. Import the widget

In iCUE, import `prusa-status.icuewidget` from the repository root and assign it to a Xeneon Edge tile.

### 4. Configure in iCUE

The widget's settings panel has two groups:

**Connection**

| Setting | Value |
|---------|-------|
| Printer Name | Optional label, useful if you run multiple tiles for multiple printers |
| Printer IP Address | e.g. `192.168.1.50` |
| API Key | Your PrusaLink API key (used as the digest auth password) |
| Username | Empty for most printers; use `maker` on MK4/XL |
| Bridge Port | `37655` (must match the running bridge) |
| Poll Interval (seconds) | `30` recommended |

**Appearance**

| Setting | Value |
|---------|-------|
| Accent Color | Highlight color for the progress bar and accents |
| Text Color | Primary text color |
| Background Color | Tile background color |

If port `37655` is already in use, start the bridge on a different port with `./start-bridge.ps1 -Port 37656` and set the same value in Bridge Port above.

## Troubleshooting

- **Bridge offline** — Run `bridge/start-bridge.ps1`
- **Authentication failed** — Check API key and username; confirm digest auth is enabled on the printer (Settings → Network → Login credentials)
- **Could not reach printer** — Verify the IP is on the same network
- **Widget shows old data or is blank** — Quit iCUE fully (tray), remove the widget, re-import `prusa-status.icuewidget`

## Forking / building from source

This is shared as-is for anyone who wants to fork it and change things. See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup and how the widget/bridge are put together.

## License

Licensed under the [MIT License](LICENSE).

Copyright (c) 2026 Jonathan
