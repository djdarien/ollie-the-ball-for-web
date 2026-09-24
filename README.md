# Adventures of Ollie The Ball: The Lost Coin Hunt

A finished HTML5 edition of a 2014 Unity game. Ollie is a little yellow ball who woke up to find his coins scattered across the universe. Roll over every coin in a level, then take the glowing door.

## Play it

From this folder:

```bash
python3 -m http.server 8080
```

Open http://localhost:8080 and tap **Play**.

Do not double-click `index.html`. Browsers block the game if it is opened as a file.

## Share it

Zip this folder, leave out `node_modules/` and `ios/`, and send the zip. The person playing runs the same two commands above, or you can drop the folder on any static host (GitHub Pages, Netlify, a school web folder).

On a phone, use **Add to Home Screen** after it is hosted. The page already has an icon and a name.

## How to play

| Action | Keyboard | Phone |
| --- | --- | --- |
| Roll | WASD or arrows | Left stick |
| Jump | Space | Jump |
| Look | Drag, scroll to zoom | Drag the world |
| Camera reset | R | — |
| Pause | Esc | Pause |

Collect every coin, then roll into the door. A tumble (a ledge, the water, the well) sends Ollie back to the last safe spot. Progress and best times stay in the browser.

Gold orbs are a Super Jump. Cyan orbs slow Ollie down for a few seconds.

Type **ollie** anywhere, or enter it as the secret on Choose Level, to open every stage.
