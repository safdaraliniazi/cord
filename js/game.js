/* Cord City — an isometric city-building sim for the browser.
 * Plain JavaScript + Canvas 2D, no dependencies. */
(() => {
  'use strict';

  // ---------- Constants ----------
  const W = 64, H = 64, N = W * H;
  const TW = 64, TH = 32;               // isometric tile size (world px)
  const SAVE_KEY = 'cordcity.save.v1';

  const T = {
    GRASS: 0, WATER: 1, TREE: 2, ROAD: 3, RES: 4, COM: 5, IND: 6,
    POWER: 7, PARK: 8, POLICE: 9, FIRE: 10, SCHOOL: 11, LINE: 12, WIND: 13,
  };
  const isZone = t => t === T.RES || t === T.COM || t === T.IND;
  const isService = t => t === T.POWER || t === T.WIND || t === T.POLICE || t === T.FIRE || t === T.SCHOOL;
  const conducts = t => t >= T.ROAD && t !== T.PARK;

  const NAMES = ['Grass', 'Water', 'Trees', 'Road', 'Residential', 'Commercial', 'Industrial',
    'Coal Power Plant', 'Park', 'Police Station', 'Fire Station', 'School', 'Power Line', 'Wind Turbine'];
  const UPKEEP = { [T.ROAD]: 0.25, [T.LINE]: 0.1, [T.POWER]: 100, [T.WIND]: 12, [T.PARK]: 1.5,
    [T.POLICE]: 50, [T.FIRE]: 50, [T.SCHOOL]: 70 };
  const POWER_CAP = { [T.POWER]: 900, [T.WIND]: 110 };
  const RES_CAP = [0, 12, 45, 160];
  const COM_JOBS = [0, 8, 28, 95];
  const IND_JOBS = [0, 14, 38, 110];
  const POWER_USE = [1, 2, 6, 16];
  const COVER_R = { [T.POLICE]: 11, [T.FIRE]: 11, [T.SCHOOL]: 13 };

  const TOOLS = [
    { id: 'inspect', label: 'Inspect', icon: '🔍', mode: 'single', cost: 0 },
    { id: 'bulldoze', label: 'Bulldoze', icon: '🚜', mode: 'rect', cost: 2 },
    { sep: true },
    { id: 'road', label: 'Road', icon: '🛣️', mode: 'line', cost: 10, type: T.ROAD },
    { id: 'line', label: 'Power line', icon: '🔌', mode: 'line', cost: 4, type: T.LINE },
    { sep: true },
    { id: 'res', label: 'Resid.', swatch: '#4caf50', mode: 'rect', cost: 10, type: T.RES },
    { id: 'com', label: 'Comm.', swatch: '#3b82f6', mode: 'rect', cost: 10, type: T.COM },
    { id: 'ind', label: 'Indust.', swatch: '#eab308', mode: 'rect', cost: 10, type: T.IND },
    { sep: true },
    { id: 'power', label: 'Coal', icon: '🏭', mode: 'single', cost: 3000, type: T.POWER },
    { id: 'wind', label: 'Wind', icon: '🌬️', mode: 'single', cost: 500, type: T.WIND },
    { id: 'police', label: 'Police', icon: '🚓', mode: 'single', cost: 500, type: T.POLICE },
    { id: 'fire', label: 'Fire', icon: '🚒', mode: 'single', cost: 500, type: T.FIRE },
    { id: 'school', label: 'School', icon: '🏫', mode: 'single', cost: 800, type: T.SCHOOL },
    { id: 'park', label: 'Park', icon: '⛲', mode: 'rect', cost: 40, type: T.PARK },
    { id: 'tree', label: 'Trees', icon: '🌳', mode: 'rect', cost: 5, type: T.TREE },
  ];
  const toolById = Object.fromEntries(TOOLS.filter(t => !t.sep).map(t => [t.id, t]));
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const SPEED_MS = [Infinity, 420, 160, 50];

  // ---------- State ----------
  let type, lvl, variety, fire;                       // persistent
  let roadDist, pow, pol, crime, land, cPol, cFire, cEdu; // derived maps
  let S;                                              // scalar game state
  const demand = { R: 0, C: 0, I: 0 };
  const stats = { pop: 0, comJobs: 0, indJobs: 0, powCap: 0, powUse: 0, unpowered: 0, roads: 0 };
  let lastBudget = null;
  let mapsDirty = true;

  function alloc() {
    type = new Uint8Array(N); lvl = new Uint8Array(N); variety = new Uint8Array(N); fire = new Uint8Array(N);
    roadDist = new Uint8Array(N); pow = new Uint8Array(N); pol = new Uint8Array(N); crime = new Uint8Array(N);
    land = new Uint8Array(N); cPol = new Uint8Array(N); cFire = new Uint8Array(N); cEdu = new Uint8Array(N);
  }

  // ---------- Random / noise ----------
  function mulberry32(a) {
    return () => {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function valueNoise(rand, cell) {
    const gw = Math.ceil(W / cell) + 2, g = new Float32Array(gw * gw).map(() => rand());
    const sm = t => t * t * (3 - 2 * t);
    return (x, y) => {
      const fx = x / cell, fy = y / cell, ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = sm(fx - ix), ty = sm(fy - iy);
      const a = g[iy * gw + ix], b = g[iy * gw + ix + 1], c = g[(iy + 1) * gw + ix], d = g[(iy + 1) * gw + ix + 1];
      return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    };
  }

  function generate(seed) {
    alloc();
    const rand = mulberry32(seed);
    const n1 = valueNoise(rand, 14), n2 = valueNoise(rand, 6), n3 = valueNoise(rand, 5);
    const riverX = 6 + rand() * 10, riverPhase = rand() * 6;
    for (let y = 0; y < H; y++) {
      const rx = riverX + Math.sin(y * 0.12 + riverPhase) * 4 + Math.sin(y * 0.31) * 1.5;
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        variety[i] = (rand() * 256) | 0;
        const h = n1(x, y) * 0.75 + n2(x, y) * 0.25;
        const dc = Math.hypot(x - W / 2, y - H / 2);
        if ((h < 0.27 && dc > 12) || (x >= rx && x < rx + 2.6)) type[i] = T.WATER;
        else if (n3(x, y) > 0.62 && dc > 6) type[i] = T.TREE;
      }
    }
    S = {
      funds: 20000, day: 0, month: 0, year: 2000, tax: 9, speed: 1, name: 'Cord City',
      milestone: 0, cam: null, seed,
    };
    mapsDirty = true;
    cars.length = 0;
  }

  // ---------- Simulation ----------
  const idx = (x, y) => y * W + x;
  const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function computeRoadDist() {
    roadDist.fill(255);
    const q = new Int32Array(N); let qh = 0, qt = 0;
    for (let i = 0; i < N; i++) if (type[i] === T.ROAD) { roadDist[i] = 0; q[qt++] = i; }
    while (qh < qt) {
      const i = q[qh++], d = roadDist[i];
      if (d >= 3) continue;
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!inb(nx, ny)) continue;
        const j = idx(nx, ny);
        if (roadDist[j] > d + 1) { roadDist[j] = d + 1; q[qt++] = j; }
      }
    }
  }

  function powerUse(i) {
    const t = type[i];
    if (isZone(t)) return POWER_USE[lvl[i]];
    if (t === T.POLICE || t === T.FIRE || t === T.SCHOOL) return 6;
    return 0;
  }

  function computePower() {
    pow.fill(0);
    const seen = new Uint8Array(N), q = new Int32Array(N);
    stats.powCap = 0; stats.powUse = 0; stats.unpowered = 0;
    for (let s = 0; s < N; s++) {
      if (seen[s] || !(type[s] === T.POWER || type[s] === T.WIND)) continue;
      // Flood-fill the connected grid, starting from this plant.
      let qh = 0, qt = 0; q[qt++] = s; seen[s] = 1;
      while (qh < qt) {
        const i = q[qh++], x = i % W, y = (i / W) | 0;
        for (const [dx, dy] of DIRS) {
          const nx = x + dx, ny = y + dy;
          if (!inb(nx, ny)) continue;
          const j = idx(nx, ny);
          if (!seen[j] && conducts(type[j])) { seen[j] = 1; q[qt++] = j; }
        }
      }
      let cap = 0;
      for (let k = 0; k < qt; k++) cap += POWER_CAP[type[q[k]]] || 0;
      stats.powCap += cap;
      for (let k = 0; k < qt; k++) {
        const i = q[k], u = powerUse(i);
        if (u <= cap) { cap -= u; pow[i] = 1; stats.powUse += u; } else stats.unpowered++;
      }
    }
  }

  function radial(target, i, r, amount, mode) {
    const x0 = i % W, y0 = (i / W) | 0;
    for (let y = Math.max(0, y0 - r); y <= Math.min(H - 1, y0 + r); y++) {
      for (let x = Math.max(0, x0 - r); x <= Math.min(W - 1, x0 + r); x++) {
        const d = Math.hypot(x - x0, y - y0);
        if (d > r) continue;
        const v = amount * (1 - d / (r + 1)), j = y * W + x;
        if (mode === 'max') { if (v > target[j]) target[j] = v; } else target[j] += v;
      }
    }
  }

  function computeMaps() {
    computeRoadDist();
    computePower();
    const fp = new Float32Array(N), fc = new Float32Array(N), fg = new Float32Array(N), fw = new Float32Array(N);
    const cp = new Float32Array(N), cf = new Float32Array(N), ce = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const t = type[i], l = lvl[i];
      if (t === T.IND && l) radial(fp, i, 4 + l, 18 * l, 'add');
      else if (t === T.POWER) radial(fp, i, 8, 70, 'add');
      else if (t === T.TREE) radial(fg, i, 2, 6, 'add');
      else if (t === T.PARK) radial(fg, i, 3, 14, 'add');
      else if (t === T.WATER) radial(fw, i, 3, 10, 'max');
      else if (t === T.POLICE) radial(cp, i, COVER_R[t], 100, 'max');
      else if (t === T.FIRE) radial(cf, i, COVER_R[t], 100, 'max');
      else if (t === T.SCHOOL) radial(ce, i, COVER_R[t], 100, 'max');
      if (isZone(t) && l) radial(fc, i, 3, [0, 4, 9, 16][l] + (t === T.COM ? 3 : 0), 'add');
      if (t === T.ROAD && stats.pop > 1500) fp[i] += 6;
    }
    for (let i = 0; i < N; i++) {
      cPol[i] = Math.min(100, cp[i]); cFire[i] = Math.min(100, cf[i]); cEdu[i] = Math.min(100, ce[i]);
      const p = Math.max(0, Math.min(100, fp[i] - fg[i] * 0.8));
      pol[i] = p;
      const c = Math.max(0, Math.min(100, fc[i] * (1 - cPol[i] / 115)));
      crime[i] = c;
      const lv = 32 + Math.min(fw[i], 18) + Math.min(fg[i], 22) + cEdu[i] * 0.14 + cFire[i] * 0.08
        + cPol[i] * 0.06 - p * 0.75 - c * 0.45;
      land[i] = Math.max(0, Math.min(100, lv));
    }
    mapsDirty = false;
  }

  function computeStats() {
    let pop = 0, cj = 0, ij = 0, roads = 0;
    for (let i = 0; i < N; i++) {
      const t = type[i], l = lvl[i];
      if (t === T.RES) pop += RES_CAP[l];
      else if (t === T.COM) cj += COM_JOBS[l];
      else if (t === T.IND) ij += IND_JOBS[l];
      else if (t === T.ROAD) roads++;
    }
    stats.pop = pop; stats.comJobs = cj; stats.indJobs = ij; stats.roads = roads;
    const workers = pop * 0.55, jobs = cj + ij;
    const taxEff = (S.tax - 9) * 0.07;
    const clamp = v => Math.max(-1, Math.min(1, v));
    demand.R = clamp((jobs * 1.1 + 80 - workers) / (workers * 0.25 + 50) - taxEff);
    demand.C = clamp((pop * 0.22 - cj + 10) / (cj * 0.3 + 25) - taxEff);
    demand.I = clamp((pop * 0.33 - ij + 30) / (ij * 0.3 + 25) - taxEff);
  }

  function maxLevel(i, t) {
    const lv = land[i];
    if (t === T.IND) return stats.pop >= 1200 && cEdu[i] > 20 ? 3 : stats.pop >= 150 ? 2 : 1;
    if (lv >= 58 && stats.pop >= (t === T.RES ? 700 : 1500)) return 3;
    if (lv >= 30 && stats.pop >= (t === T.RES ? 60 : 200)) return 2;
    return 1;
  }

  function grow() {
    for (let i = 0; i < N; i++) {
      const t = type[i];
      if (!isZone(t) || Math.random() > 0.12 || fire[i]) continue;
      const l = lvl[i];
      if (!pow[i] || roadDist[i] > 3) {
        if (l > 0 && Math.random() < 0.12) lvl[i]--;
        continue;
      }
      const d = t === T.RES ? demand.R : t === T.COM ? demand.C : demand.I;
      let s = d;
      if (t === T.IND) s += (land[i] - 25) / 300;
      else s += (land[i] - 40) / 140 - crime[i] / 220;
      if (t === T.RES) s -= pol[i] / 160;
      if (s > 0 && Math.random() < s * 0.55) {
        if (l < maxLevel(i, t)) { lvl[i]++; variety[i] = (Math.random() * 256) | 0; }
      } else if (s < -0.3 && l > 0 && Math.random() < -s * 0.15) {
        lvl[i]--;
      }
    }
  }

  function fires() {
    for (let i = 0; i < N; i++) {
      const t = type[i];
      if (fire[i]) {
        if (cFire[i] > 25 && fire[i] > 2) fire[i] = 2;       // fire brigade arrives
        fire[i]--;
        if (fire[i] > 0 && cFire[i] < 25 && Math.random() < 0.15) {
          const [dx, dy] = DIRS[(Math.random() * 4) | 0];
          const x = (i % W) + dx, y = ((i / W) | 0) + dy;
          if (inb(x, y)) {
            const j = idx(x, y);
            if (!fire[j] && ((isZone(type[j]) && lvl[j]) || isService(type[j]) || type[j] === T.TREE)) fire[j] = 6 + (Math.random() * 6) | 0;
          }
        }
        if (fire[i] === 0) {
          if (isZone(t)) lvl[i] = 0; else { type[i] = T.GRASS; lvl[i] = 0; }
          mapsDirty = true;
        }
        continue;
      }
      const flammable = (isZone(t) && lvl[i]) || isService(t);
      if (flammable && Math.random() < 0.000012 * (t === T.IND || t === T.POWER ? 3 : 1) * (1 - cFire[i] / 100)) {
        fire[i] = 8 + (Math.random() * 8) | 0;
        const x = i % W, y = (i / W) | 0;
        toast(`🔥 Fire reported at (${x}, ${y})${cFire[i] < 25 ? ', with no fire coverage!' : ''}`, 'bad', { x, y });
      }
    }
  }

  function monthly() {
    const jobs = stats.comJobs + stats.indJobs;
    const resTax = Math.round(stats.pop * S.tax * 0.03);
    const bizTax = Math.round(jobs * S.tax * 0.025);
    const exp = {};
    for (let i = 0; i < N; i++) { const u = UPKEEP[type[i]]; if (u) exp[type[i]] = (exp[type[i]] || 0) + u; }
    let totalExp = 0;
    for (const k in exp) { exp[k] = Math.round(exp[k]); totalExp += exp[k]; }
    S.funds += resTax + bizTax - totalExp;
    lastBudget = { resTax, bizTax, exp, totalExp, net: resTax + bizTax - totalExp, month: S.month, year: S.year };
    if (S.funds < 0) toast('⚠️ The city is in debt! Raise taxes or cut services.', 'bad');
    if (stats.unpowered > 20 && Math.random() < 0.5) toast('⚡ Not enough power! Build more plants.', 'warn');
    const ms = [[100, 'Your settlement reached 100 residents'], [500, 'Village status: 500 residents!'],
      [2000, 'Town status: 2,000 residents!'], [8000, 'City status: 8,000 residents!'],
      [25000, 'Metropolis: 25,000 residents!']];
    while (S.milestone < ms.length && stats.pop >= ms[S.milestone][0]) { toast('🎉 ' + ms[S.milestone][1]); S.milestone++; }
  }

  function simDay() {
    if (mapsDirty || S.day % 2 === 0) computeMaps();
    computeStats();
    grow();
    fires();
    S.day++;
    if (S.day >= 30) {
      S.day = 0; S.month++;
      if (S.month >= 12) { S.month = 0; S.year++; }
      monthly();
    }
    updateHUD();
    drawMinimap();
  }

  // ---------- Building ----------
  function canPlace(tool, i) {
    const t = type[i];
    if (tool.id === 'bulldoze') return t !== T.GRASS && t !== T.WATER;
    if (tool.id === 'inspect') return true;
    if (t === T.WATER) return false;
    if (t === tool.type) return false;
    if (tool.id === 'tree') return t === T.GRASS;
    if (tool.id === 'road') return t === T.GRASS || t === T.TREE || t === T.LINE || (isZone(t) && lvl[i] === 0);
    if (tool.id === 'line') return t === T.GRASS || t === T.TREE;
    if (isZone(tool.type)) return t === T.GRASS || t === T.TREE || (isZone(t) && lvl[i] === 0);
    return t === T.GRASS || t === T.TREE;
  }
  // Power lines may cross water.
  function canPlaceAt(tool, i) {
    if (tool.id === 'line' && type[i] === T.WATER) return true;
    return canPlace(tool, i);
  }
  function costAt(tool, i) {
    if (tool.id === 'bulldoze') return isZone(type[i]) ? 2 + lvl[i] * 10 : isService(type[i]) ? 50 : 2;
    if (tool.id === 'line' && type[i] === T.WATER) return tool.cost * 5;
    return tool.cost;
  }

  function applyTool(tool, tiles) {
    if (tool.id === 'inspect') { showInspect(tiles[0]); return; }
    let spent = 0, placed = 0, broke = false;
    for (const i of tiles) {
      if (!canPlaceAt(tool, i)) continue;
      const c = costAt(tool, i);
      if (S.funds - spent < c) { broke = true; break; }
      spent += c; placed++;
      if (tool.id === 'bulldoze') { type[i] = T.GRASS; lvl[i] = 0; fire[i] = 0; }
      else { type[i] = tool.type; lvl[i] = 0; fire[i] = 0; variety[i] = (Math.random() * 256) | 0; }
    }
    S.funds -= spent;
    if (broke) toast('Not enough funds!', 'bad');
    if (placed) { mapsDirty = true; computeMaps(); computeStats(); updateHUD(); drawMinimap(); }
  }

  // ---------- Cars ----------
  const cars = [];
  const CAR_COLORS = ['#ef4444', '#f8fafc', '#3b82f6', '#facc15', '#22c55e', '#111827', '#a855f7'];
  function roadNeighbors(i) {
    const x = i % W, y = (i / W) | 0, out = [];
    for (const [dx, dy] of DIRS) { const nx = x + dx, ny = y + dy; if (inb(nx, ny) && type[idx(nx, ny)] === T.ROAD) out.push(idx(nx, ny)); }
    return out;
  }
  function updateCars(dt) {
    const target = Math.min(stats.roads * 0.6, stats.pop / 15, 350) | 0;
    if (cars.length < target && stats.roads > 1) {
      for (let k = 0; k < 5; k++) {
        const i = (Math.random() * N) | 0;
        if (type[i] === T.ROAD) {
          const nb = roadNeighbors(i);
          if (nb.length) cars.push({ a: i, b: nb[(Math.random() * nb.length) | 0], t: 0, c: CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0], v: 1.2 + Math.random() });
          break;
        }
      }
    }
    if (cars.length > target + 5) cars.length = target;
    const mult = [0, 1, 2.2, 4][S.speed];
    for (let k = cars.length - 1; k >= 0; k--) {
      const c = cars[k];
      if (type[c.a] !== T.ROAD || type[c.b] !== T.ROAD) { cars.splice(k, 1); continue; }
      c.t += dt * c.v * mult;
      while (c.t >= 1) {
        c.t -= 1;
        const nb = roadNeighbors(c.b).filter(j => j !== c.a);
        const prev = c.a; c.a = c.b;
        c.b = nb.length ? nb[(Math.random() * nb.length) | 0] : prev;
      }
    }
  }

  // ---------- Rendering ----------
  const canvas = document.getElementById('view');
  const ctx = canvas.getContext('2d');
  const cam = { x: 0, y: 0, z: 1 };
  let dpr = 1, vw = 0, vh = 0;
  let overlay = 'none';
  let hoverTile = -1;
  let drag = null;   // {tool, start, end}
  let currentTool = toolById.inspect;
  let selected = -1;
  let time = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    vw = window.innerWidth; vh = window.innerHeight;
    canvas.width = vw * dpr; canvas.height = vh * dpr;
  }
  function centerCamera(x, y) {
    const wx = (x - y) * TW / 2, wy = (x + y) * TH / 2 + TH / 2;
    cam.x = vw / 2 - wx * cam.z; cam.y = vh / 2 - wy * cam.z;
  }
  function screenToTile(sx, sy) {
    const wx = (sx - cam.x) / cam.z, wy = (sy - cam.y) / cam.z;
    const fx = (wx / (TW / 2) + wy / (TH / 2)) / 2, fy = (wy / (TH / 2) - wx / (TW / 2)) / 2;
    const x = Math.floor(fx), y = Math.floor(fy);
    return inb(x, y) ? idx(x, y) : -1;
  }

  const shadeCache = new Map();
  function shade(hex, f) {
    const key = hex + f;
    let v = shadeCache.get(key);
    if (v) return v;
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.max(0, ((n >> 16) & 255) * f)) | 0;
    const g = Math.min(255, Math.max(0, ((n >> 8) & 255) * f)) | 0;
    const b = Math.min(255, Math.max(0, (n & 255) * f)) | 0;
    v = `rgb(${r},${g},${b})`; shadeCache.set(key, v);
    return v;
  }

  function diamond(cx, cy, s) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - TH / 2 * s); ctx.lineTo(cx + TW / 2 * s, cy);
    ctx.lineTo(cx, cy + TH / 2 * s); ctx.lineTo(cx - TW / 2 * s, cy); ctx.closePath();
  }

  // Draw an extruded box centred on (cx,cy) offset by (ox,oy) tile units.
  function box(cx, cy, s, h, color, ox = 0, oy = 0, roof, windows) {
    cx += (ox - oy) * TW / 2; cy += (ox + oy) * TH / 2;
    const hw = TW / 2 * s, hh = TH / 2 * s;
    // left face
    ctx.fillStyle = shade(color, 0.78);
    ctx.beginPath();
    ctx.moveTo(cx - hw, cy); ctx.lineTo(cx, cy + hh); ctx.lineTo(cx, cy + hh - h); ctx.lineTo(cx - hw, cy - h); ctx.closePath(); ctx.fill();
    // right face
    ctx.fillStyle = shade(color, 0.6);
    ctx.beginPath();
    ctx.moveTo(cx, cy + hh); ctx.lineTo(cx + hw, cy); ctx.lineTo(cx + hw, cy - h); ctx.lineTo(cx, cy + hh - h); ctx.closePath(); ctx.fill();
    if (windows && h > 14) {
      ctx.strokeStyle = windows; ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let k = 7; k < h - 4; k += 7) {
        ctx.moveTo(cx - hw + 3, cy - k + 1.5); ctx.lineTo(cx - 3, cy + hh - k - 1.5);
        ctx.moveTo(cx + 3, cy + hh - k - 1.5); ctx.lineTo(cx + hw - 3, cy - k + 1.5);
      }
      ctx.stroke();
    }
    // top
    ctx.fillStyle = roof || shade(color, 1.08);
    diamond(cx, cy - h, s); ctx.fill();
  }

  function pitchedHouse(cx, cy, s, h, wall, roofCol, ox, oy) {
    box(cx, cy, s, h, wall, ox, oy, shade(wall, 1));
    cx += (ox - oy) * TW / 2; cy += (ox + oy) * TH / 2;
    const hw = TW / 2 * s, hh = TH / 2 * s, top = cy - h, rh = 9 * s + 3;
    ctx.fillStyle = roofCol;
    ctx.beginPath();
    ctx.moveTo(cx - hw, top); ctx.lineTo(cx, top + hh); ctx.lineTo(cx + hw / 2, top + hh / 2 - rh); ctx.lineTo(cx - hw / 2, top - hh / 2 - rh); ctx.closePath(); ctx.fill();
    ctx.fillStyle = shade(roofCol, 0.7);
    ctx.beginPath();
    ctx.moveTo(cx, top + hh); ctx.lineTo(cx + hw, top); ctx.lineTo(cx + hw / 2, top - hh / 2 + 0); ctx.lineTo(cx + hw / 2, top + hh / 2 - rh); ctx.closePath(); ctx.fill();
    ctx.fillStyle = shade(roofCol, 0.85);
    ctx.beginPath();
    ctx.moveTo(cx - hw, top); ctx.lineTo(cx - hw / 2, top - hh / 2 - rh); ctx.lineTo(cx + hw / 2, top + hh / 2 - rh); ctx.lineTo(cx + hw / 2, top - hh / 2); ctx.lineTo(cx, top - hh); ctx.closePath(); ctx.fill();
  }

  function tree(cx, cy, ox, oy, sc) {
    cx += (ox - oy) * TW / 2; cy += (ox + oy) * TH / 2;
    ctx.fillStyle = '#5b3a1e'; ctx.fillRect(cx - 1.5, cy - 6 * sc, 3, 6 * sc);
    ctx.fillStyle = '#2f7d32';
    ctx.beginPath(); ctx.moveTo(cx, cy - 26 * sc); ctx.lineTo(cx + 8 * sc, cy - 6 * sc); ctx.lineTo(cx - 8 * sc, cy - 6 * sc); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#3f9a43';
    ctx.beginPath(); ctx.moveTo(cx, cy - 26 * sc); ctx.lineTo(cx - 8 * sc, cy - 6 * sc); ctx.lineTo(cx - 1, cy - 6 * sc); ctx.closePath(); ctx.fill();
  }

  const ZONE_TINT = { [T.RES]: '#4caf50', [T.COM]: '#3b82f6', [T.IND]: '#eab308' };

  function heat(v, palette) {
    // v 0..100
    const t = v / 100;
    if (palette === 'good') return `hsla(${(t * 120) | 0},80%,50%,0.55)`;
    return `hsla(${(120 - t * 120) | 0},85%,50%,${0.15 + t * 0.5})`;
  }

  function groundColor(i) {
    const t = type[i], v = variety[i];
    if (t === T.WATER) return null;
    const base = (v & 7) - 4;
    return `rgb(${88 + base},${150 + base * 2},${72 + base})`;
  }

  function drawGround(i, cx, cy) {
    const t = type[i];
    if (t === T.WATER) {
      const w = Math.sin(time * 1.5 + (i % W) * 0.7 + ((i / W) | 0) * 0.5) * 6;
      ctx.fillStyle = `rgb(${46 + w},${120 + w},${190 + w})`;
      diamond(cx, cy, 1.02); ctx.fill();
      return;
    }
    ctx.fillStyle = groundColor(i);
    diamond(cx, cy, 1.02); ctx.fill();
    if (t === T.ROAD) drawRoad(i, cx, cy);
    else if (isZone(t)) {
      if (lvl[i] === 0) {
        ctx.fillStyle = ZONE_TINT[t] + '55'; diamond(cx, cy, 0.92); ctx.fill();
        ctx.strokeStyle = ZONE_TINT[t]; ctx.lineWidth = 1.2; diamond(cx, cy, 0.8); ctx.stroke();
      } else {
        ctx.fillStyle = t === T.IND ? '#8b8270' : '#9aa39a'; diamond(cx, cy, 0.95); ctx.fill();
      }
    } else if (t === T.PARK) {
      ctx.fillStyle = '#6cc25a'; diamond(cx, cy, 0.95); ctx.fill();
      ctx.fillStyle = '#d9c99a'; diamond(cx, cy, 0.35); ctx.fill();
    } else if (isService(t)) {
      ctx.fillStyle = '#a5aaa5'; diamond(cx, cy, 0.95); ctx.fill();
    }
  }

  function drawRoad(i, cx, cy) {
    ctx.fillStyle = '#4b5563'; diamond(cx, cy, 1.0); ctx.fill();
    const x = i % W, y = (i / W) | 0;
    // edge midpoints for +x, -x, +y, -y directions
    const mids = [[TW / 4, TH / 4], [-TW / 4, -TH / 4], [-TW / 4, TH / 4], [TW / 4, -TH / 4]];
    ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath();
    let links = 0;
    DIRS.forEach(([dx, dy], k) => {
      const nx = x + dx, ny = y + dy;
      if (inb(nx, ny) && type[idx(nx, ny)] === T.ROAD) {
        ctx.moveTo(cx, cy); ctx.lineTo(cx + mids[k][0], cy + mids[k][1]); links++;
      }
    });
    ctx.stroke(); ctx.setLineDash([]);
    if (links > 2) { ctx.fillStyle = '#4b5563'; diamond(cx, cy, 0.3); ctx.fill(); }
  }

  function drawObject(i, cx, cy) {
    const t = type[i], l = lvl[i], v = variety[i];
    switch (t) {
      case T.TREE:
        tree(cx, cy, -0.18, -0.1, 0.9); tree(cx, cy, 0.2, 0.05, 0.75 + (v & 3) * 0.08);
        if (v & 1) tree(cx, cy, -0.05, 0.25, 0.7);
        break;
      case T.PARK:
        tree(cx, cy, -0.3, -0.25, 0.6); tree(cx, cy, 0.3, 0.25, 0.55);
        break;
      case T.RES:
        if (l === 1) {
          const walls = ['#f1e4c8', '#e8d3b0', '#f5f0e6', '#dcc7a1'][v & 3];
          const roofs = ['#b9472f', '#7a4b2a', '#4a5f7a', '#9c3d54'][(v >> 2) & 3];
          pitchedHouse(cx, cy, 0.42, 9, walls, roofs, -0.18, -0.12);
          pitchedHouse(cx, cy, 0.36, 8, walls, roofs, 0.24, 0.2);
        } else if (l === 2) {
          box(cx, cy, 0.72, 26 + (v & 7), ['#d9c3a0', '#c9b79c', '#e2d6c3'][v % 3], 0, 0, null, 'rgba(255,240,200,0.45)');
        } else if (l === 3) {
          box(cx, cy, 0.7, 58 + (v & 31), ['#b9a58c', '#a8b0b8', '#c4b6a6'][v % 3], 0, 0, null, 'rgba(255,240,200,0.5)');
        }
        break;
      case T.COM:
        if (l === 1) {
          box(cx, cy, 0.7, 12, ['#7fa7d9', '#89c0d6', '#a3b5e0'][v % 3], 0, 0, '#dfe6ee', 'rgba(255,255,255,0.5)');
        } else if (l === 2) {
          box(cx, cy, 0.78, 36 + (v & 7), ['#5f8fcf', '#6b9fb8', '#7c8fc9'][v % 3], 0, 0, null, 'rgba(210,235,255,0.55)');
        } else if (l === 3) {
          box(cx, cy, 0.78, 50, '#4f7fbf', 0, 0, null, 'rgba(210,235,255,0.6)');
          box(cx, cy - 50, 0.55, 40 + (v & 31), '#3f6fb0', 0, 0, null, 'rgba(210,235,255,0.6)');
        }
        break;
      case T.IND:
        if (l >= 1) {
          const c = ['#b59a5a', '#a08a6a', '#9c8f7a'][v % 3];
          box(cx, cy, 0.8, 10 + l * 6, c, 0.02, 0.02, shade(c, 0.9));
          if (l >= 2) { box(cx, cy - (10 + l * 6), 0.14, 14 + l * 4, '#8a7a6a', -0.15, 0.15); smoke(cx, cy - (24 + l * 10), v); }
          if (l >= 3) { box(cx, cy - 28, 0.14, 22, '#8a7a6a', 0.18, -0.18); smoke(cx + 10, cy - 52, v + 40); }
        }
        break;
      case T.POWER:
        box(cx, cy, 0.85, 20, '#8c8c8c', 0, 0, '#9a9a9a');
        box(cx, cy - 20, 0.16, 30, '#b04a3a', -0.22, 0.1);
        box(cx, cy - 20, 0.16, 30, '#b04a3a', 0.1, -0.22);
        smoke(cx - 9, cy - 56, v); smoke(cx + 9, cy - 56, v + 60);
        break;
      case T.WIND: {
        ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - 46); ctx.stroke();
        const a = time * (S.speed ? 2 + S.speed : 0.3) + v;
        ctx.lineWidth = 2; ctx.beginPath();
        for (let k = 0; k < 3; k++) {
          const ang = a + k * Math.PI * 2 / 3;
          ctx.moveTo(cx, cy - 46); ctx.lineTo(cx + Math.cos(ang) * 18, cy - 46 + Math.sin(ang) * 18);
        }
        ctx.stroke();
        break;
      }
      case T.POLICE:
        box(cx, cy, 0.75, 18, '#3b5b9a', 0, 0, '#cfd8e6', 'rgba(255,255,255,0.5)');
        ctx.fillStyle = (time * 2 | 0) % 2 ? '#ef4444' : '#3b82f6'; ctx.fillRect(cx - 2, cy - 26, 4, 4);
        break;
      case T.FIRE:
        box(cx, cy, 0.75, 18, '#b83a2e', 0, 0, '#e7d2cc', 'rgba(255,255,255,0.5)');
        box(cx, cy - 18, 0.18, 12, '#8f2a20', 0.2, -0.2);
        break;
      case T.SCHOOL:
        box(cx, cy, 0.8, 16, '#c9844f', 0, 0, '#e8d6c2', 'rgba(255,255,255,0.5)');
        ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx, cy - 16); ctx.lineTo(cx, cy - 34); ctx.stroke();
        ctx.fillStyle = '#ef4444'; ctx.fillRect(cx, cy - 34, 8, 5);
        break;
      case T.LINE: {
        ctx.strokeStyle = '#5b4636'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - 22); ctx.moveTo(cx - 6, cy - 20); ctx.lineTo(cx + 6, cy - 20); ctx.stroke();
        const x = i % W, y = (i / W) | 0;
        ctx.strokeStyle = 'rgba(30,30,30,0.8)'; ctx.lineWidth = 1;
        ctx.beginPath();
        [[1, 0], [0, 1]].forEach(([dx, dy]) => {
          const nx = x + dx, ny = y + dy;
          if (inb(nx, ny) && conducts(type[idx(nx, ny)])) {
            const tx = cx + (dx - dy) * TW / 2, ty = cy + (dx + dy) * TH / 2;
            ctx.moveTo(cx, cy - 20); ctx.quadraticCurveTo((cx + tx) / 2, (cy + ty) / 2 - 16, tx, ty - 20);
          }
        });
        ctx.stroke();
        break;
      }
    }
    if (fire[i]) {
      const f = Math.sin(time * 20 + i) * 3;
      ctx.fillStyle = 'rgba(255,120,20,0.9)';
      ctx.beginPath(); ctx.moveTo(cx - 12, cy); ctx.lineTo(cx, cy - 34 - f); ctx.lineTo(cx + 12, cy); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,220,60,0.9)';
      ctx.beginPath(); ctx.moveTo(cx - 6, cy); ctx.lineTo(cx, cy - 20 + f); ctx.lineTo(cx + 6, cy); ctx.closePath(); ctx.fill();
    }
  }

  function smoke(cx, cy, v) {
    if (!S.speed) return;
    for (let k = 0; k < 3; k++) {
      const p = ((time * 0.6 + k / 3 + v / 97) % 1);
      ctx.fillStyle = `rgba(200,200,200,${0.45 * (1 - p)})`;
      ctx.beginPath(); ctx.arc(cx + p * 10, cy - p * 26, 3 + p * 6, 0, Math.PI * 2); ctx.fill();
    }
  }

  function overlayValue(i) {
    switch (overlay) {
      case 'land': return [land[i], 'good'];
      case 'pollution': return [pol[i], 'bad'];
      case 'crime': return [crime[i], 'bad'];
      case 'fire': return [cFire[i], 'good'];
      case 'edu': return [cEdu[i], 'good'];
    }
    return null;
  }

  function previewTiles() {
    if (!drag) return hoverTile >= 0 && currentTool.id !== 'inspect' ? [hoverTile] : [];
    return dragTiles(drag.tool, drag.start, drag.end);
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0f1720'; ctx.fillRect(0, 0, vw, vh);
    ctx.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, dpr * cam.x, dpr * cam.y);

    // visible bounds in world px
    const left = -cam.x / cam.z - TW, right = (vw - cam.x) / cam.z + TW;
    const top = -cam.y / cam.z - TH, bottom = (vh - cam.y) / cam.z + 140;
    const visible = (cx, cy) => cx > left && cx < right && cy > top && cy < bottom;

    // Ground pass
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const cx = (x - y) * TW / 2, cy = (x + y) * TH / 2 + TH / 2;
      if (!visible(cx, cy)) continue;
      const i = y * W + x;
      drawGround(i, cx, cy);
      if (overlay !== 'none') {
        if (overlay === 'power') {
          if (conducts(type[i]) || isZone(type[i])) {
            ctx.fillStyle = pow[i] ? 'rgba(250,204,21,0.55)' : 'rgba(239,68,68,0.6)';
            diamond(cx, cy, 0.9); ctx.fill();
          }
        } else {
          const [v, pal] = overlayValue(i);
          ctx.fillStyle = heat(v, pal); diamond(cx, cy, 1); ctx.fill();
        }
      }
    }

    // Cars (drawn on the ground, before buildings)
    for (const c of cars) {
      const ax = c.a % W, ay = (c.a / W) | 0, bx = c.b % W, by = (c.b / W) | 0;
      const fx = ax + (bx - ax) * c.t, fy = ay + (by - ay) * c.t;
      // drive on the right: offset perpendicular to direction
      const dx = bx - ax, dy = by - ay;
      const ox = -dy * 0.15, oy = dx * 0.15;
      const cx = (fx + ox - fy - oy) * TW / 2, cy = (fx + ox + fy + oy) * TH / 2 + TH / 2;
      if (!visible(cx, cy)) continue;
      ctx.fillStyle = c.c;
      ctx.fillRect(cx - 3, cy - 3, 6, 4);
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(cx - 3, cy + 1, 6, 1);
    }

    // Preview highlights
    const prev = previewTiles();
    if (prev.length) {
      for (const i of prev) {
        const x = i % W, y = (i / W) | 0, cx = (x - y) * TW / 2, cy = (x + y) * TH / 2 + TH / 2;
        const ok = canPlaceAt(currentTool, i);
        ctx.fillStyle = ok ? (currentTool.id === 'bulldoze' ? 'rgba(239,68,68,0.45)' : 'rgba(255,255,255,0.35)') : 'rgba(239,68,68,0.25)';
        diamond(cx, cy, 1); ctx.fill();
      }
    }
    if (hoverTile >= 0) {
      const x = hoverTile % W, y = (hoverTile / W) | 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.5;
      diamond((x - y) * TW / 2, (x + y) * TH / 2 + TH / 2, 1); ctx.stroke();
    }
    if (selected >= 0) {
      const x = selected % W, y = (selected / W) | 0;
      ctx.strokeStyle = '#4cc38a'; ctx.lineWidth = 2.5;
      diamond((x - y) * TW / 2, (x + y) * TH / 2 + TH / 2, 1); ctx.stroke();
    }

    // Object pass (painter's order)
    const showIcons = overlay === 'none' || overlay === 'power';
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const cx = (x - y) * TW / 2, cy = (x + y) * TH / 2 + TH / 2;
      if (!visible(cx, cy)) continue;
      const i = y * W + x, t = type[i];
      if (t !== T.GRASS && t !== T.WATER && t !== T.ROAD) drawObject(i, cx, cy);
      if (showIcons && isZone(t)) {
        if (roadDist[i] > 3) badge(cx, cy - 8 - lvl[i] * 12, '#f97316', '⛔');
        else if (!pow[i] && (time * 1.5 | 0) % 2) badge(cx, cy - 8 - lvl[i] * 12, '#facc15', '⚡');
      }
    }
  }

  function badge(cx, cy, color, glyph) {
    if (cam.z < 0.45) return;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath(); ctx.arc(cx, cy, 6.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color; ctx.font = '9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(glyph, cx, cy + 0.5);
  }

  // ---------- Minimap ----------
  const mini = document.getElementById('minimap');
  const mctx = mini.getContext('2d');
  const MW = 3, MH = 1.5;
  function drawMinimap() {
    mctx.fillStyle = '#0f1720'; mctx.fillRect(0, 0, mini.width, mini.height);
    const cols = { [T.GRASS]: '#5b9648', [T.WATER]: '#2e78be', [T.TREE]: '#2f6b30', [T.ROAD]: '#9ca3af', [T.PARK]: '#7bd36a', [T.LINE]: '#7a6a5a' };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, t = type[i];
      let c = cols[t];
      if (isZone(t)) c = lvl[i] ? shade(ZONE_TINT[t], 0.7 + lvl[i] * 0.15) : shade(ZONE_TINT[t], 0.5);
      if (!c) c = '#d4d4d8';
      if (fire[i]) c = '#f97316';
      mctx.fillStyle = c;
      mctx.fillRect(96 + (x - y) * MW / 2 - 1.5, (x + y) * MH / 2, MW, MH + 0.5);
    }
    // viewport rect
    const tl = [(-cam.x) / cam.z, (-cam.y) / cam.z], br = [(vw - cam.x) / cam.z, (vh - cam.y) / cam.z];
    const k = MW / TW;
    mctx.strokeStyle = '#fff'; mctx.lineWidth = 1;
    mctx.strokeRect(96 + tl[0] * k, tl[1] * k, (br[0] - tl[0]) * k, (br[1] - tl[1]) * k);
  }
  mini.addEventListener('pointerdown', e => {
    const r = mini.getBoundingClientRect();
    const mx = (e.clientX - r.left) * mini.width / r.width, my = (e.clientY - r.top) * mini.height / r.height;
    const wx = (mx - 96) / (MW / TW), wy = my / (MW / TW);
    cam.x = vw / 2 - wx * cam.z; cam.y = vh / 2 - wy * cam.z;
    drawMinimap();
  });

  // ---------- Input ----------
  function dragTiles(tool, a, b) {
    const ax = a % W, ay = (a / W) | 0, bx = b % W, by = (b / W) | 0;
    const out = [];
    if (tool.mode === 'single') return [b];
    if (tool.mode === 'rect') {
      for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++)
        for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) out.push(idx(x, y));
      return out;
    }
    // line: L-shape, longest axis first
    const sx = Math.sign(bx - ax), sy = Math.sign(by - ay);
    if (Math.abs(bx - ax) >= Math.abs(by - ay)) {
      for (let x = ax; x !== bx + sx || x === ax; x += sx || 1) { out.push(idx(x, ay)); if (!sx) break; }
      for (let y = ay + sy; sy && y !== by + sy; y += sy) out.push(idx(bx, y));
    } else {
      for (let y = ay; y !== by + sy || y === ay; y += sy || 1) { out.push(idx(ax, y)); if (!sy) break; }
      for (let x = ax + sx; sx && x !== bx + sx; x += sx) out.push(idx(x, by));
    }
    return out;
  }

  const pointers = new Map();
  let pan = null, pinch = null;
  const tooltip = document.getElementById('tooltip');

  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      drag = null; pan = null;
      const [p1, p2] = [...pointers.values()];
      pinch = { d: Math.hypot(p1.x - p2.x, p1.y - p2.y), mx: (p1.x + p2.x) / 2, my: (p1.y + p2.y) / 2 };
      return;
    }
    if (e.button === 1 || e.button === 2 || (currentTool.id === 'inspect' && e.button === 0)) {
      pan = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false, click: e.button === 0 };
      return;
    }
    const i = screenToTile(e.clientX, e.clientY);
    if (i >= 0 && e.button === 0) drag = { tool: currentTool, start: i, end: i };
  });
  canvas.addEventListener('pointermove', e => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y), mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
      zoomAt(pinch.mx, pinch.my, cam.z * d / pinch.d);
      cam.x += mx - pinch.mx; cam.y += my - pinch.my;
      pinch = { d, mx, my };
      return;
    }
    if (pan) {
      const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) pan.moved = true;
      cam.x = pan.cx + dx; cam.y = pan.cy + dy;
    }
    hoverTile = screenToTile(e.clientX, e.clientY);
    if (drag && hoverTile >= 0) drag.end = hoverTile;
    updateTooltip(e.clientX, e.clientY);
  });
  const endPointer = e => {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; return; }
    if (pan) {
      if (pan.click && !pan.moved) { const i = screenToTile(e.clientX, e.clientY); if (i >= 0) showInspect(i); }
      pan = null;
    }
    if (drag && e.type === 'pointerup') { applyTool(drag.tool, dragTiles(drag.tool, drag.start, drag.end)); }
    drag = null;
    updateTooltip(e.clientX, e.clientY);
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', () => { hoverTile = -1; tooltip.hidden = true; });

  function zoomAt(sx, sy, z) {
    z = Math.max(0.3, Math.min(2.5, z));
    cam.x = sx - (sx - cam.x) * z / cam.z; cam.y = sy - (sy - cam.y) * z / cam.z; cam.z = z;
  }
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, cam.z * Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  function updateTooltip(sx, sy) {
    const tool = currentTool;
    if (tool.id === 'inspect' || hoverTile < 0) { tooltip.hidden = true; return; }
    const tiles = drag ? dragTiles(tool, drag.start, drag.end) : [hoverTile];
    let cost = 0, n = 0;
    for (const i of tiles) if (canPlaceAt(tool, i)) { cost += costAt(tool, i); n++; }
    tooltip.hidden = false;
    tooltip.textContent = n ? `${tool.label} · $${cost.toLocaleString()}` : `Can't place here`;
    tooltip.className = (!n || cost > S.funds) ? 'bad' : '';
    tooltip.style.left = sx + 16 + 'px'; tooltip.style.top = sy + 16 + 'px';
  }

  const keys = new Set();
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    keys.add(e.key.toLowerCase());
    if (e.key === ' ') { e.preventDefault(); setSpeed(S.speed ? 0 : 1); }
    if (e.key === 'Escape') { drag = null; selectTool('inspect'); }
    if (e.key === '+' || e.key === '=') zoomAt(vw / 2, vh / 2, cam.z * 1.2);
    if (e.key === '-') zoomAt(vw / 2, vh / 2, cam.z / 1.2);
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 9) { const list = TOOLS.filter(t => !t.sep); if (list[n - 1]) selectTool(list[n - 1].id); }
  });
  window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));

  // ---------- UI ----------
  const $ = id => document.getElementById(id);
  const toolbar = $('toolbar');
  for (const t of TOOLS) {
    if (t.sep) { const d = document.createElement('div'); d.className = 'sep'; toolbar.appendChild(d); continue; }
    const b = document.createElement('button');
    b.dataset.tool = t.id;
    b.title = `${t.label}${t.cost ? ` ($${t.cost}${t.mode !== 'single' ? '/tile' : ''})` : ''}`;
    b.innerHTML = (t.swatch ? `<span class="sw" style="background:${t.swatch}"></span>` : t.icon) + `<small>${t.label}</small>`;
    b.addEventListener('click', () => selectTool(t.id));
    toolbar.appendChild(b);
  }
  function selectTool(id) {
    currentTool = toolById[id];
    toolbar.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.tool === id));
    canvas.style.cursor = id === 'inspect' ? 'grab' : 'crosshair';
  }

  document.querySelectorAll('#speed button').forEach(b => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
  function setSpeed(s) {
    S.speed = s;
    document.querySelectorAll('#speed button').forEach(b => b.classList.toggle('active', +b.dataset.speed === s));
  }

  $('overlay').addEventListener('change', e => { overlay = e.target.value; });
  $('tax').addEventListener('input', e => { S.tax = +e.target.value; $('taxVal').textContent = S.tax + '%'; computeStats(); updateHUD(); });

  function fmtMoney(v) { return (v < 0 ? '-$' : '$') + Math.abs(Math.round(v)).toLocaleString(); }

  function updateHUD() {
    $('funds').textContent = fmtMoney(S.funds);
    $('funds').classList.toggle('neg', S.funds < 0);
    $('pop').textContent = stats.pop.toLocaleString();
    $('date').textContent = `${MONTHS[S.month]} ${S.year}`;
    $('power').textContent = `${stats.powUse.toLocaleString()} / ${stats.powCap.toLocaleString()} MW`;
    $('power').classList.toggle('low', stats.unpowered > 0);
    const bar = (el, v) => {
      const f = $(el), pct = Math.abs(v) * 50;
      if (v >= 0) { f.style.bottom = '50%'; f.style.top = ''; f.style.height = pct + '%'; f.style.opacity = 1; }
      else { f.style.top = '50%'; f.style.bottom = ''; f.style.height = pct + '%'; f.style.opacity = 0.55; }
    };
    bar('dR', demand.R); bar('dC', demand.C); bar('dI', demand.I);
    if (selected >= 0) showInspect(selected, true);
  }

  function meter(v, good) {
    const c = good ? `hsl(${v * 1.2},70%,50%)` : `hsl(${120 - v * 1.2},70%,50%)`;
    return `<div class="meter"><div style="width:${v}%;background:${c}"></div></div>`;
  }
  function showInspect(i, refresh) {
    const el = $('inspect');
    if (i < 0) { el.hidden = true; selected = -1; return; }
    selected = i;
    const t = type[i], l = lvl[i], x = i % W, y = (i / W) | 0;
    let rows = '';
    const row = (k, v) => { rows += `<tr><td>${k}</td><td>${v}</td></tr>`; };
    if (isZone(t)) {
      row('Density', ['Empty', 'Low', 'Medium', 'High'][l]);
      if (t === T.RES) row('Residents', RES_CAP[l]);
      else row('Jobs', (t === T.COM ? COM_JOBS : IND_JOBS)[l]);
      row('Powered', pow[i] ? '✅' : '❌');
      row('Road access', roadDist[i] <= 3 ? '✅' : '❌ (needs road ≤3)');
    } else if (t === T.POWER || t === T.WIND) {
      row('Output', POWER_CAP[t] + ' MW'); row('Upkeep', fmtMoney(UPKEEP[t]) + '/mo');
    } else if (UPKEEP[t]) {
      row('Upkeep', fmtMoney(UPKEEP[t]) + '/mo');
      if (isService(t)) row('Powered', pow[i] ? '✅' : '❌');
    }
    if (fire[i]) row('Status', '🔥 On fire!');
    el.hidden = false;
    el.innerHTML = `<h3>${NAMES[t]} <span>(${x}, ${y})</span></h3><table>${rows}</table>
      <div style="margin-top:6px">Land value ${meter(land[i], true)}</div>
      <div>Pollution ${meter(pol[i], false)}</div>
      <div>Crime ${meter(crime[i], false)}</div>
      <div>Police / Fire / School<br>${meter(cPol[i], true)}${meter(cFire[i], true)}${meter(cEdu[i], true)}</div>`;
    if (!refresh) { if (isPhone()) setPanel(true); el.scrollIntoView({ block: 'nearest' }); }
  }

  function toast(msg, kind = '', where) {
    const d = document.createElement('div');
    d.className = 'toast ' + kind; d.textContent = msg;
    if (where) { d.style.pointerEvents = 'auto'; d.style.cursor = 'pointer'; d.onclick = () => centerCamera(where.x, where.y); }
    const box = $('toasts'); box.appendChild(d);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => d.remove(), 4500);
  }

  // Modals
  document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m || e.target.classList.contains('close')) m.hidden = true; });
  });
  $('btnHelp').onclick = () => { $('helpModal').hidden = false; };
  $('btnBudget').onclick = () => {
    const b = lastBudget;
    let html = '';
    if (!b) html = '<p>No budget report yet. Wait for the first month to end.</p>';
    else {
      html = `<p>Report for ${MONTHS[b.month === 0 ? 11 : b.month - 1]} ${b.month === 0 ? b.year - 1 : b.year}</p><table class="budget">
        <tr><td>Residential taxes</td><td>${fmtMoney(b.resTax)}</td></tr>
        <tr><td>Business taxes</td><td>${fmtMoney(b.bizTax)}</td></tr>`;
      for (const k in b.exp) html += `<tr><td>${NAMES[k]} upkeep</td><td>-${fmtMoney(b.exp[k])}</td></tr>`;
      html += `<tr class="total"><td>Net per month</td><td>${fmtMoney(b.net)}</td></tr></table>`;
    }
    html += `<p style="color:var(--muted)">Tax rate: ${S.tax}%. Higher taxes bring more income but reduce demand.</p>`;
    $('budgetBody').innerHTML = html;
    $('budgetModal').hidden = false;
  };

  function save() {
    try {
      const data = { S: { ...S, cam: { ...cam } }, type: Array.from(type), lvl: Array.from(lvl), variety: Array.from(variety) };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      toast('💾 City saved');
    } catch (err) { toast('Could not save: ' + err.message, 'bad'); }
  }
  function load(silent) {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) { if (!silent) toast('No saved city found', 'warn'); return false; }
      const d = JSON.parse(raw);
      alloc();
      type.set(d.type); lvl.set(d.lvl); variety.set(d.variety);
      S = d.S; cars.length = 0;
      if (S.cam) Object.assign(cam, S.cam);
      $('tax').value = S.tax; $('taxVal').textContent = S.tax + '%';
      mapsDirty = true; computeMaps(); computeStats(); setSpeed(S.speed); updateHUD(); drawMinimap();
      if (!silent) toast('📂 City loaded');
      return true;
    } catch (err) { if (!silent) toast('Could not load save', 'bad'); return false; }
  }
  $('btnSave').onclick = save;
  $('btnLoad').onclick = () => load(false);
  let newArmed = 0;
  $('btnNew').onclick = () => {
    if (Date.now() - newArmed > 3000) {
      newArmed = Date.now();
      toast('Tap ✚ again to start a new city. Unsaved progress will be lost.', 'warn');
      return;
    }
    newArmed = 0;
    newCity();
  };
  const isPhone = () => window.matchMedia('(max-width: 720px)').matches;
  function setPanel(open) {
    $('side').classList.toggle('open', open);
    $('btnPanel').classList.toggle('on', open);
  }
  $('btnPanel').onclick = () => setPanel(!$('side').classList.contains('open'));
  function syncTopHeight() {
    document.documentElement.style.setProperty('--topH', $('topbar').offsetHeight + 'px');
  }
  function newCity() {
    generate((Math.random() * 1e9) | 0);
    cam.z = isPhone() ? 0.7 : 1; centerCamera(W / 2, H / 2);
    $('tax').value = S.tax; $('taxVal').textContent = S.tax + '%';
    computeMaps(); computeStats(); setSpeed(1); updateHUD(); drawMinimap(); showInspect(-1);
  }

  // ---------- Main loop ----------
  let last = performance.now(), acc = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now; time += dt;
    // keyboard panning
    const sp = 600 * dt;
    if (keys.has('arrowleft') || keys.has('a')) cam.x += sp;
    if (keys.has('arrowright') || keys.has('d')) cam.x -= sp;
    if (keys.has('arrowup') || keys.has('w')) cam.y += sp;
    if (keys.has('arrowdown') || keys.has('s')) cam.y -= sp;

    if (S.speed) {
      acc += dt * 1000;
      const step = SPEED_MS[S.speed];
      let n = 0;
      while (acc >= step && n < 4) { simDay(); acc -= step; n++; }
      if (acc > step * 4) acc = 0;
    }
    if (mapsDirty) { computeMaps(); computeStats(); }
    updateCars(dt);
    render();
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', () => { resize(); syncTopHeight(); drawMinimap(); });
  resize(); syncTopHeight();
  if (!load(true)) { newCity(); $('helpModal').hidden = false; }
  selectTool('inspect');
  updateHUD();
  drawMinimap();
  setInterval(() => { if (S.speed) drawMinimap(); }, 1000);
  requestAnimationFrame(frame);

  // Autosave every 2 minutes
  setInterval(() => {
    try {
      const data = { S: { ...S, cam: { ...cam } }, type: Array.from(type), lvl: Array.from(lvl), variety: Array.from(variety) };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (_) {}
  }, 120000);

  // Expose for debugging/tests
  window.cordCity = { T, get S() { return S; }, type, stats, demand, applyTool: (id, tiles) => applyTool(toolById[id], tiles), idx,
    simDay, refs: () => ({ type, lvl, pow, roadDist }) };
})();
