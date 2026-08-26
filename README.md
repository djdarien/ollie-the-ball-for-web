# Adventures of Ollie the Ball: The Lost Coin Hunt

HTML5 remake of the 2014 Unity 4.5 alpha. Roll Ollie, collect every coin in the stage, then enter the glowing door.

The original project still lives in this repo (`Assets/`, `ProjectSettings/`). It targeted **Unity 4.5 + Unity Web Player**, which browsers no longer run, and it used **UnityScript**, which Unity dropped. This `web/` folder is the playable, finished edition.

## Play

From this folder:

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080

Do not open `index.html` as a file URL. ES modules need a local server.

### Controls

| Action | Desktop | Phone / iPad |
| --- | --- | --- |
| Move | WASD or arrows | Left stick |
| Jump | Space | Jump button |
| Look | Drag / scroll | Drag the world |
| Pause | Esc | Pause button |

Goal: collect **all** coins, then roll into the door. Falling off the path (or into water / the well) retries the level.

### Unlock all levels (QA)

Type **`ollie`** anywhere, or enter it in the **Level code** box on Choose Level. That unlocks every stage and saves in this browser. `?unlock=1` on the URL does the same.

## What this edition finishes

- 8 complete stages (the Unity project had several unfinished scenes)
- Original rules: coins, door lock, speed pads, jump pads, teleporters, moving platforms
- Original Ollie face, splash art, and sound effects
- Keyboard + touch so it can ship on the web now and as an iPhone app later
- Level unlocks and best times saved in the browser
- Pause with music / SFX / graphics quality (the old Escape menu)

Unity bugs that were also fixed in the original C# (for archival completeness):

- `GameManager.Updata` never ran; renamed to `Update` so the X-to-menu key works in Unity 4
- “Procced” typos on the win / door prompts

## iPhone later (Capacitor)

This folder is already a Capacitor web dir (`capacitor.config.json`). When you are ready:

```bash
npm install @capacitor/core @capacitor/cli @capacitor/ios
npx cap add ios
npx cap copy ios
npx cap open ios
```

Then archive from Xcode with an Apple Developer account. The page is already a standalone web app (Add to Home Screen) via `manifest.json`.

## Why not Unity WebGL?

Unity 4.5 cannot export WebGL. Getting there would mean upgrading through Unity 5 → 2017 (UnityScript removal) → a current editor, then rewriting every `rigidbody` / `audio` / `Application.LoadLevel` shortcut and rebuilding 8 binary scenes. The gameplay is a marble coin-hunt, so a Three.js + cannon-es remake is the reliable way to ship on the web and, later, wrap for iOS.
