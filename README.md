# Cord City

An isometric city-building sim that runs in the browser. It uses plain HTML5 Canvas and JavaScript, with no dependencies and no build step.

## Play

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Features

- Procedurally generated terrain with rivers, lakes and forests
- Roads, power lines, and residential, commercial and industrial zoning, all placed by dragging
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
| Build / zone | Left-click or drag |
| Pan | Right/middle drag, WASD/arrows, or drag with the Inspect tool |
| Zoom | Mouse wheel, pinch, or `+` / `-` |
| Pause | Space |
| Tools | `1`–`9` |
