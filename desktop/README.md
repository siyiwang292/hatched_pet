# Hatched Ice Pet

Maodou is a small, original long-eared ice companion for macOS and Windows. The Electron
window is transparent, frameless, always on top, and hidden from the taskbar or Dock.

## Run locally

From the repository root:

```bash
npm install
npm start
```

Drag Maodou directly to reposition the pet. Use the `…` menu to feed, play with, or put
Maodou to sleep. The three meters show fullness, fun, and energy. Needs and the last window
position are saved automatically.

The tray/menu-bar icon can show or hide Maodou, pause wandering, or quit the application.

## Package

```bash
npm run pack
```

Installable builds can be produced with `npm run dist`. The Electron Builder configuration
in `package.json` includes macOS DMG/ZIP and Windows NSIS/portable targets. Build each
platform's installer on that platform for the most reliable result.
