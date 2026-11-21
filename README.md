# Cord City

An isometric city-building sim for the browser where **you build by coordinates**. There's no dragging: every road, zone and building is placed by typing its X/Y position on a graph-paper map, either in a simple From/To form or as text commands.

Pixel-art graphics drawn in code (`js/sprites.js`, preview in `sprites.html`). Plain HTML5 Canvas and JavaScript, with no dependencies and no build step.

## Building by coordinates

The map's edges are numbered (yellow = X, blue = Y), bright grid lines mark every 10 tiles, and markers like `30,30` show where those lines cross. Pick a tool, enter **From X, Y** (and **To X, Y** for lines and areas), check the preview, and press **Build**. Or type commands, separated by `;`:

```
coal 30 36
road 20 30 to 40 30
res 21 26 to 30 29; com 21 31 to 26 33; ind 34 31 to 39 34
park 31 26
bulldoze 25 27 to 26 28
goto 32 32
```

Other commands: `wind`, `police`, `fire`, `school`, `line` (power line), `trees`, `inspect X Y`, `pause`, `play`, `help`. Use ↑/↓ to recall earlier commands.

## Play

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Features

- Procedurally generated terrain with rivers, lakes and forests
- Roads, power lines, and residential, commercial and industrial zoning, all placed by coordinates
- Road networks that matter: homes need a road route to jobs, businesses need homes on the same network, and every worker's commute is routed, so busy roads jam (Traffic overlay)
- Undo for any build (button,  command or Ctrl+Z), with a full refund
- Coal and wind power, with a power grid that floods through connected tiles and has limited capacity
- R/C/I demand simulation; buildings grow from low to high density depending on demand, land value, pollution and crime
- Police, fire and school coverage; parks and trees raise land value
- Random fires that spread unless a fire station covers the area
- Monthly budget with taxes and upkeep, plus population milestones
- Animated traffic, smoke and wind turbines
- Overlays (power, land value, pollution, crime, fire, education) and a minimap
- Save/load and autosave to `localStorage`
- Mouse, keyboard and touch controls (pinch to zoom)

## Controls

| Action | Input |
| --- | --- |
| Build / zone | Coordinates in the build console |
| Pan | Drag the map, or WASD/arrows |
| Inspect a tile | Tap or click it |
| Focus the console | `/` |
| Zoom | Mouse wheel, pinch, or `+` / `-` |
| Pause | Space |
| Tools | `1`–`9` |
