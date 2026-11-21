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
    { id: 'line', label: 'Power line', full: 'Power line', icon: '🔌', mode: 'line', cost: 4, type: T.LINE },
    { sep: true },
    { id: 'res', label: 'Resid.', full: 'Residential', swatch: '#4caf50', mode: 'rect', cost: 10, type: T.RES },
    { id: 'com', label: 'Comm.', full: 'Commercial', swatch: '#3b82f6', mode: 'rect', cost: 10, type: T.COM },
    { id: 'ind', label: 'Indust.', full: 'Industrial', swatch: '#eab308', mode: 'rect', cost: 10, type: T.IND },
    { sep: true },
    { id: 'power', label: 'Coal', full: 'Coal plant', icon: '🏭', mode: 'single', cost: 3000, type: T.POWER },
    { id: 'wind', label: 'Wind', full: 'Wind turbine', icon: '🌬️', mode: 'single', cost: 500, type: T.WIND },
    { id: 'police', label: 'Police', full: 'Police station', icon: '🚓', mode: 'single', cost: 500, type: T.POLICE },
    { id: 'fire', label: 'Fire', full: 'Fire station', icon: '🚒', mode: 'single', cost: 500, type: T.FIRE },
    { id: 'school', label: 'School', icon: '🏫', mode: 'single', cost: 800, type: T.SCHOOL },
    { id: 'park', label: 'Park', icon: '⛲', mode: 'rect', cost: 40, type: T.PARK },
    { id: 'tree', label: 'Trees', full: 'Trees', icon: '🌳', mode: 'rect', cost: 5, type: T.TREE },
  ];
  const toolById = Object.fromEntries(TOOLS.filter(t => !t.sep).map(t => [t.id, t]));
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const SPEED_MS = [Infinity, 420, 160, 50];

  // ---------- State ----------
  let type, lvl, variety, fire;                       // persistent
  let roadDist, pow, pol, crime, land, cPol, cFire, cEdu; // derived maps
  let netId, nearRoad, traffic, commute;              // road networks and commuting
  const ROAD_CAP = 450;     // commuters one road tile carries before it jams
  const NO_ROUTE = 255;     // commute value for homes that can't reach any job
  let nets = [];            // per road network: zone counts, residents and jobs
  let routes = [];          // sample home-to-work paths, used by the cars
  let S;                                              // scalar game state
  const demand = { R: 0, C: 0, I: 0 };
  const stats = { pop: 0, comJobs: 0, indJobs: 0, powCap: 0, powUse: 0, unpowered: 0, roads: 0,
    commuters: 0, jammed: 0, jamTile: -1, noJobHomes: 0, noJobTile: -1, isolated: 0, isolatedTile: -1 };
  let lastBudget = null;
  let mapsDirty = true;

  function alloc() {
    type = new Uint8Array(N); lvl = new Uint8Array(N); variety = new Uint8Array(N); fire = new Uint8Array(N);
    roadDist = new Uint8Array(N); pow = new Uint8Array(N); pol = new Uint8Array(N); crime = new Uint8Array(N);
    land = new Uint8Array(N); cPol = new Uint8Array(N); cFire = new Uint8Array(N); cEdu = new Uint8Array(N);
    netId = new Int32Array(N); nearRoad = new Int32Array(N); traffic = new Float32Array(N); commute = new Uint8Array(N);
    nets = []; routes = [];
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

  // Label connected road networks, then attach every tile within 3 steps of a road
  // to the network of its nearest road. Zones only "see" each other through a network.
  function computeRoadDist() {
    roadDist.fill(255); netId.fill(-1); nearRoad.fill(-1);
    const q = new Int32Array(N);
    let n = 0;
    for (let s0 = 0; s0 < N; s0++) {
      if (type[s0] !== T.ROAD || netId[s0] >= 0) continue;
      let qh = 0, qt = 0; q[qt++] = s0; netId[s0] = n;
      while (qh < qt) {
        const i = q[qh++], x = i % W, y = (i / W) | 0;
        for (const [dx, dy] of DIRS) {
          const nx = x + dx, ny = y + dy;
          if (!inb(nx, ny)) continue;
          const j = idx(nx, ny);
          if (type[j] === T.ROAD && netId[j] < 0) { netId[j] = n; q[qt++] = j; }
        }
      }
      n++;
    }
    let qh = 0, qt = 0;
    for (let i = 0; i < N; i++) if (type[i] === T.ROAD) { roadDist[i] = 0; nearRoad[i] = i; q[qt++] = i; }
    while (qh < qt) {
      const i = q[qh++], d = roadDist[i];
      if (d >= 3) continue;
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!inb(nx, ny)) continue;
        const j = idx(nx, ny);
        if (roadDist[j] > d + 1) { roadDist[j] = d + 1; netId[j] = netId[i]; nearRoad[j] = nearRoad[i]; q[qt++] = j; }
      }
    }
    nets = Array.from({ length: n }, () => ({ res: 0, com: 0, ind: 0, pop: 0, jobs: 0 }));
    for (let i = 0; i < N; i++) {
      const t = type[i];
      if (!isZone(t) || roadDist[i] > 3) continue;
      const k = nets[netId[i]], l = lvl[i];
      if (t === T.RES) { k.res++; k.pop += RES_CAP[l]; }
      else if (t === T.COM) { k.com++; k.jobs += COM_JOBS[l]; }
      else { k.ind++; k.jobs += IND_JOBS[l]; }
    }
  }

  // Does this zone have the partners it needs on its own road network?
  // Homes need jobs (commercial or industrial zones); businesses need homes.
  function hasPartner(i) {
    if (roadDist[i] > 3) return false;
    const k = nets[netId[i]];
    return type[i] === T.RES ? k.com + k.ind > 0 : k.res > 0;
  }

  // Route every home's workers along the road network to the nearest job,
  // adding up how many commuters use each road tile.
  function computeTraffic() {
    traffic.fill(0); commute.fill(NO_ROUTE);
    const jd = new Int16Array(N).fill(-1), q = new Int32Array(N);
    let qh = 0, qt = 0;
    for (let i = 0; i < N; i++) {
      const t = type[i];
      if ((t === T.COM || t === T.IND) && lvl[i] && roadDist[i] <= 3) {
        const r = nearRoad[i];
        if (jd[r] < 0) { jd[r] = 0; q[qt++] = r; }
      }
    }
    while (qh < qt) {
      const i = q[qh++], x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!inb(nx, ny)) continue;
        const j = idx(nx, ny);
        if (type[j] === T.ROAD && jd[j] < 0) { jd[j] = jd[i] + 1; q[qt++] = j; }
      }
    }
    const paths = [], homes = [];
    let commuters = 0, noJob = 0, noJobTile = -1, isolated = 0, isolatedTile = -1;
    for (let i = 0; i < N; i++) {
      if (isZone(type[i]) && roadDist[i] <= 3 && !hasPartner(i)) { isolated++; isolatedTile = i; }
      if (type[i] !== T.RES || !lvl[i] || roadDist[i] > 3) continue;
      const r = nearRoad[i];
      if (jd[r] < 0) { noJob++; noJobTile = i; continue; }
      const workers = RES_CAP[lvl[i]] * 0.55;
      commuters += workers;
      const path = [r];
      let cur = r, h = (i * 2654435761) >>> 0;
      traffic[r] += workers;
      while (jd[cur] > 0) {
        const x = cur % W, y = (cur / W) | 0;
        let next = -1, cnt = 0;
        h = (Math.imul(h, 1103515245) + 12345) >>> 0;
        for (const [dx, dy] of DIRS) {
          const nx = x + dx, ny = y + dy;
          if (!inb(nx, ny)) continue;
          const j = idx(nx, ny);
          if (jd[j] === jd[cur] - 1) { cnt++; if (next < 0 || ((h >>> (8 + cnt)) % cnt) === 0) next = j; }
        }
        cur = next; path.push(cur); traffic[cur] += workers;
      }
      paths.push(path); homes.push(i);
    }
    routes = [];
    let jammed = 0, worst = 0, jamTile = -1;
    for (let i = 0; i < N; i++) {
      if (type[i] !== T.ROAD) continue;
      const c = traffic[i] / ROAD_CAP;
      if (c > 1) { jammed++; if (c > worst) { worst = c; jamTile = i; } }
    }
    for (let k = 0; k < paths.length; k++) {
      const p = paths[k];
      let tm = roadDist[homes[k]] + p.length;
      for (const j of p) { const c = traffic[j] / ROAD_CAP; if (c > 1) tm += (c - 1) * 3; }
      commute[homes[k]] = Math.min(254, Math.round(tm));
      if (p.length > 2) {
        if (routes.length < 300) routes.push(p);
        else if (Math.random() < 300 / (k + 1)) routes[(Math.random() * 300) | 0] = p;
      }
    }
    Object.assign(stats, { commuters: Math.round(commuters), jammed, jamTile, noJobHomes: noJob, noJobTile, isolated, isolatedTile });
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
    computeTraffic();
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
      if (t === T.ROAD && traffic[i] > 30) radial(fp, i, 1, Math.min(30, traffic[i] / ROAD_CAP * 14), 'add');
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
      // Zones need partners on the same road network: homes need jobs, businesses need homes.
      if (!hasPartner(i)) {
        if (l > 0 && Math.random() < 0.08) lvl[i]--;
        continue;
      }
      const k = nets[netId[i]];
      const d = t === T.RES ? demand.R : t === T.COM ? demand.C : demand.I;
      let s = d;
      if (t === T.RES) {
        // Jobs zoned but not built yet: houses can appear, but nothing bigger.
        if (commute[i] === NO_ROUTE) { if (l >= 1) s -= 0.35; }
        else s -= Math.max(0, commute[i] - 18) / 40;     // long commutes put people off
      } else if (k.pop === 0 && l >= 1) s -= 0.4;          // no customers or workers yet
      const jam = traffic[nearRoad[i]] / ROAD_CAP;
      if (jam > 1) s -= (jam - 1) * 0.35;                  // nobody wants to live on a jammed street
      // Balance of jobs and workers on this network
      const bal = Math.max(-1, Math.min(1, (k.jobs - k.pop * 0.55) / (k.pop * 0.55 + 40)));
      s += t === T.RES ? bal * 0.25 : -bal * 0.25;
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
    const at = i => ({ x: i % W, y: (i / W) | 0 });
    if (stats.isolated > 4 && S.month % 3 === 0) {
      const p = at(stats.isolatedTile);
      toast(`🔗 Zones near (${p.x}, ${p.y}) aren't connected by road to the zones they need. Homes need jobs, and businesses need homes.`, 'warn', p);
    } else if (stats.noJobHomes > 4 && S.month % 3 === 1) {
      const p = at(stats.noJobTile);
      toast(`🏠 ${stats.noJobHomes} homes near (${p.x}, ${p.y}) can't reach any jobs yet.`, 'warn', p);
    }
    if (stats.jamTile >= 0 && stats.jammed > 2 && S.month % 2 === 0) {
      const p = at(stats.jamTile);
      toast(`🚗 Traffic jam at (${p.x}, ${p.y}). Build another road route around it.`, 'warn', p);
    }
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
    if (tool.id === 'inspect') { showInspect(tiles[0]); return { inspect: true }; }
    let spent = 0, placed = 0, broke = false, blocked = 0, need = 0;
    for (const i of tiles) {
      if (!canPlaceAt(tool, i)) { blocked++; continue; }
      const c = costAt(tool, i);
      if (S.funds - spent < c) { broke = true; need = c; break; }
      spent += c; placed++;
      if (batch && !batch.tiles.has(i)) batch.tiles.set(i, [type[i], lvl[i], fire[i], variety[i]]);
      if (tool.id === 'bulldoze') { type[i] = T.GRASS; lvl[i] = 0; fire[i] = 0; }
      else { type[i] = tool.type; lvl[i] = 0; fire[i] = 0; variety[i] = (Math.random() * 256) | 0; }
    }
    S.funds -= spent;
    if (placed) { mapsDirty = true; computeMaps(); computeStats(); updateHUD(); drawMinimap(); }
    return { placed, spent, broke, blocked, need };
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
    const target = routes.length ? Math.min(300, Math.round(stats.commuters / 10), routes.length * 3)
      : Math.min(stats.roads * 0.2, 20) | 0;
    for (let n = 0; n < 3 && cars.length < target; n++) {
      const col = CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0], v = 1.2 + Math.random();
      if (routes.length) {
        const p = routes[(Math.random() * routes.length) | 0];
        const path = Math.random() < 0.5 ? p : p.slice().reverse();   // to work, or home again
        cars.push({ path, k: 0, a: path[0], b: path[1], t: Math.random(), c: col, v });
      } else if (stats.roads > 1) {
        const i = (Math.random() * N) | 0;
        if (type[i] === T.ROAD) {
          const nb = roadNeighbors(i);
          if (nb.length) cars.push({ path: null, a: i, b: nb[(Math.random() * nb.length) | 0], t: 0, c: col, v });
        }
      }
    }
    if (cars.length > target + 10) cars.length = target;
    const mult = [0, 1, 2.2, 4][S.speed];
    for (let k = cars.length - 1; k >= 0; k--) {
      const c = cars[k];
      if (type[c.a] !== T.ROAD || type[c.b] !== T.ROAD) { cars.splice(k, 1); continue; }
      const jam = traffic[c.b] / ROAD_CAP;
      c.t += dt * c.v * mult * (jam > 0.8 ? 1 / (1 + (jam - 0.8) * 2.5) : 1);
      let done = false;
      while (c.t >= 1 && !done) {
        c.t -= 1;
        if (c.path) {
          c.k++;
          if (c.k >= c.path.length - 1) { done = true; break; }
          c.a = c.path[c.k]; c.b = c.path[c.k + 1];
        } else {
          const nb = roadNeighbors(c.b).filter(j => j !== c.a);
          const prev = c.a; c.a = c.b;
          c.b = nb.length ? nb[(Math.random() * nb.length) | 0] : prev;
        }
      }
      if (done) cars.splice(k, 1);
    }
  }

  // ---------- Rendering ----------
  const canvas = document.getElementById('view');
  const ctx = canvas.getContext('2d');
  const cam = { x: 0, y: 0, z: 1 };
  let dpr = 1, vw = 0, vh = 0;
  let overlay = 'none';
  let hoverTile = -1;
  let pending = null; // previewed build order {tool, tiles}
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

  // ---------- Pixel-art sprites (js/sprites.js) ----------
  // Sprites are 32x16 px per tile natively and drawn at 2x in world space (64x32).
  const SPR = window.CordSprites.build();
  const SPX = TW / 32;
  const ZONE_TINT = { [T.RES]: '#4caf50', [T.COM]: '#3b82f6', [T.IND]: '#eab308' };

  function heat(v, palette) {
    const t = v / 100;
    if (palette === 'good') return `hsla(${(t * 120) | 0},80%,50%,0.55)`;
    return `hsla(${(120 - t * 120) | 0},85%,50%,${0.15 + t * 0.5})`;
  }

  function sprite(sp, cx, cy) {
    ctx.drawImage(sp.canvas, cx - TW / 2, cy + TH / 2 - sp.h * SPX, TW, sp.h * SPX);
  }

  function roadMask(i) {
    const x = i % W, y = (i / W) | 0;
    const r = (nx, ny) => inb(nx, ny) && type[idx(nx, ny)] === T.ROAD;
    return (r(x + 1, y) ? 1 : 0) | (r(x - 1, y) ? 2 : 0) | (r(x, y + 1) ? 4 : 0) | (r(x, y - 1) ? 8 : 0);
  }

  function groundSprite(i) {
    const t = type[i];
    switch (t) {
      case T.WATER: return SPR.water[(Math.floor(time * 2.2) + i % W + ((i / W) | 0)) % 3];
      case T.ROAD: return SPR.road[roadMask(i)];
      case T.RES: return lvl[i] ? SPR.lot : SPR.zoneRes;
      case T.COM: return lvl[i] ? SPR.lot : SPR.zoneCom;
      case T.IND: return lvl[i] ? SPR.lotInd : SPR.zoneInd;
      case T.PARK: return SPR.parkGround;
      case T.POWER: return SPR.lotInd;
      case T.POLICE: case T.FIRE: case T.SCHOOL: return SPR.lot;
      default: return SPR.grass[variety[i] & 1];
    }
  }

  function objectSprite(i) {
    const t = type[i], l = lvl[i];
    switch (t) {
      case T.TREE: return SPR.trees;
      case T.RES: return l ? SPR['res' + l] : null;
      case T.COM: return l ? SPR['com' + l] : null;
      case T.IND: return l ? SPR['ind' + l] : null;
      case T.POWER: return SPR.coal;
      case T.WIND: return SPR.wind[S.speed ? Math.floor(time * (3 + S.speed * 2) + variety[i]) % 3 : 0];
      case T.POLICE: return SPR.police;
      case T.FIRE: return SPR.fire;
      case T.SCHOOL: return SPR.school;
      case T.PARK: return SPR.park;
      case T.LINE: return SPR.pole;
    }
    return null;
  }

  function drawGround(i, cx, cy) { sprite(groundSprite(i), cx, cy); }

  function drawObject(i, cx, cy) {
    const sp = objectSprite(i);
    if (sp) sprite(sp, cx, cy);
    if (type[i] === T.LINE) {
      // wires to neighbouring poles / powered tiles
      const x = i % W, y = (i / W) | 0, wy = 48;
      ctx.strokeStyle = 'rgba(25,22,30,0.85)'; ctx.lineWidth = 1;
      ctx.beginPath();
      [[1, 0], [0, 1]].forEach(([dx, dy]) => {
        const nx = x + dx, ny = y + dy;
        if (inb(nx, ny) && conducts(type[idx(nx, ny)])) {
          const tx = cx + (dx - dy) * TW / 2, ty = cy + (dx + dy) * TH / 2;
          const endY = type[idx(nx, ny)] === T.LINE ? ty - wy : ty - 4;
          ctx.moveTo(cx, cy - wy); ctx.quadraticCurveTo((cx + tx) / 2, (cy - wy + endY) / 2 + 8, tx, endY);
        }
      });
      ctx.stroke();
    }
    if (fire[i]) {
      const top = cy + TH / 2 - (sp ? sp.h * SPX : 24);
      const f = (Math.floor(time * 12 + i) % 3) * 3;
      ctx.fillStyle = '#ff7a1a';
      ctx.fillRect(cx - 12, top + 10 - f, 8, cy - top - 2 + f);
      ctx.fillRect(cx + 2, top + 4 + f, 10, cy - top + 2 - f);
      ctx.fillStyle = '#ffd84a';
      ctx.fillRect(cx - 8, top + 18, 4, cy - top - 14);
      ctx.fillRect(cx + 4, top + 14 - f, 4, cy - top - 10 + f);
    }
  }

  function objectTop(i, cy) {
    const sp = objectSprite(i);
    return sp ? cy + TH / 2 - sp.h * SPX : cy;
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

  function previewTiles() { return pending && pending.tiles ? pending.tiles : []; }
  const corner = (x, y) => [(x - y) * TW / 2, (x + y) * TH / 2];
  const center = (x, y) => [(x - y) * TW / 2, (x + y) * TH / 2 + TH / 2];

  // Graph-paper grid; every 10th line is brighter so coordinates are easy to count.
  function drawGrid() {
    ctx.lineWidth = 1 / cam.z;
    for (const major of [false, true]) {
      ctx.strokeStyle = major ? 'rgba(255,255,255,0.32)' : 'rgba(0,0,0,0.12)';
      ctx.beginPath();
      for (let k = 0; k <= W; k++) {
        if ((k % 10 === 0) !== major) continue;
        let a = corner(k, 0), b = corner(k, H); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
        a = corner(0, k); b = corner(W, k); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      }
      ctx.stroke();
    }
  }

  function label(text, x, y, color, size) {
    ctx.font = `700 ${size / cam.z}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3 / cam.z; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(text, x, y);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }
  const X_COL = '#ffd166', Y_COL = '#7dd3fc';
  // Reference markers where major grid lines cross, so a coordinate is always in view.
  function drawMarkers(visible) {
    const every = cam.z >= 1.1 ? 5 : 10;
    for (let y = 0; y < H; y += every) for (let x = 0; x < W; x += every) {
      const [cx, cy] = center(x, y);
      if (!visible(cx, cy)) continue;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath(); ctx.arc(cx, cy, 2 / cam.z, 0, Math.PI * 2); ctx.fill();
      label(`${x},${y}`, cx, cy - 9 / cam.z, 'rgba(255,255,255,0.92)', 10);
    }
  }
  function drawAxes() {
    const step = cam.z >= 0.9 ? 1 : cam.z >= 0.5 ? 2 : 5;
    for (let k = 0; k < W; k++) {
      if (k % step && k % 10) continue;
      const big = k % 10 === 0 ? 13 : 11;
      let c = center(k, -1); label(String(k), c[0], c[1], X_COL, big);
      c = center(k, H); label(String(k), c[0], c[1], X_COL, big);
      c = center(-1, k); label(String(k), c[0], c[1], Y_COL, big);
      c = center(W, k); label(String(k), c[0], c[1], Y_COL, big);
    }
    let c = center(W / 2, -3); label('X →', c[0], c[1], X_COL, 15);
    c = center(-3, H / 2); label('← Y', c[0], c[1], Y_COL, 15);
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0f1720'; ctx.fillRect(0, 0, vw, vh);
    ctx.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, dpr * cam.x, dpr * cam.y);
    ctx.imageSmoothingEnabled = false;

    // Grass-coloured underlay hides hairline seams between tiles at fractional zoom.
    {
      const a = corner(0, 0), b = corner(W, 0), c = corner(W, H), d = corner(0, H);
      ctx.fillStyle = '#5c9d42';
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.closePath(); ctx.fill();
    }

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
        } else if (overlay === 'traffic') {
          if (type[i] === T.ROAD) {
            const c = traffic[i] / ROAD_CAP;
            ctx.fillStyle = c < 0.05 ? 'rgba(148,163,184,0.35)' : c < 0.6 ? 'rgba(34,197,94,0.6)' : c < 1 ? 'rgba(250,204,21,0.7)' : 'rgba(239,68,68,0.75)';
            diamond(cx, cy, 0.9); ctx.fill();
          } else { ctx.fillStyle = 'rgba(15,23,32,0.35)'; diamond(cx, cy, 1); ctx.fill(); }
        } else if (overlay !== 'coords') {
          const [v, pal] = overlayValue(i);
          ctx.fillStyle = heat(v, pal); diamond(cx, cy, 1); ctx.fill();
        }
      }
    }

    drawGrid();

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
        const ok = canPlaceAt(pending.tool, i);
        ctx.fillStyle = ok ? (pending.tool.id === 'bulldoze' ? 'rgba(239,68,68,0.45)' : 'rgba(255,255,255,0.35)') : 'rgba(239,68,68,0.25)';
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
    const showIcons = overlay === 'none' || overlay === 'power' || overlay === 'traffic';
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const cx = (x - y) * TW / 2, cy = (x + y) * TH / 2 + TH / 2;
      if (!visible(cx, cy)) continue;
      const i = y * W + x, t = type[i];
      if (t !== T.GRASS && t !== T.WATER && t !== T.ROAD) drawObject(i, cx, cy);
      if (showIcons && isZone(t)) {
        const by = lvl[i] ? objectTop(i, cy) - 6 : cy - 8;
        if (roadDist[i] > 3) badge(cx, by, '#f97316', '⛔');
        else if (!hasPartner(i)) badge(cx, by, '#c084fc', '⇄');
        else if (!pow[i] && (time * 1.5 | 0) % 2) badge(cx, by, '#facc15', '⚡');
      }
    }

    if (overlay !== 'coords') drawMarkers(visible);
    // Tile numbers overlay
    if (overlay === 'coords') {
      const every = cam.z >= 0.9 ? 1 : cam.z >= 0.55 ? 2 : 5;
      for (let y = 0; y < H; y += every) for (let x = 0; x < W; x += every) {
        const [cx, cy] = center(x, y);
        if (visible(cx, cy)) label(`${x},${y}`, cx, cy, '#fff', 9);
      }
    }
    // Label both ends of the previewed order
    if (pending && pending.tiles && pending.tiles.length) {
      const ends = [pending.tiles[0], pending.tiles[pending.tiles.length - 1]];
      for (const i of new Set(ends)) {
        const x = i % W, y = (i / W) | 0, [cx, cy] = center(x, y);
        label(`(${x}, ${y})`, cx, cy - 22, '#fff', 12);
      }
    }
    drawAxes();
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

  // The map is only for looking: drag pans, pinch/scroll zooms, tap inspects.
  // Building happens through coordinates in the build console.
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      pan = null;
      const [p1, p2] = [...pointers.values()];
      pinch = { d: Math.hypot(p1.x - p2.x, p1.y - p2.y), mx: (p1.x + p2.x) / 2, my: (p1.y + p2.y) / 2 };
      return;
    }
    pan = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false, click: e.button === 0 };
    canvas.style.cursor = 'grabbing';
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
      if (Math.abs(dx) + Math.abs(dy) > 6) pan.moved = true;
      if (pan.moved) { cam.x = pan.cx + dx; cam.y = pan.cy + dy; }
    }
    hoverTile = screenToTile(e.clientX, e.clientY);
    updateTooltip(e.clientX, e.clientY, e.pointerType);
  });
  const endPointer = e => {
    pointers.delete(e.pointerId);
    canvas.style.cursor = 'grab';
    if (pinch) { if (pointers.size < 2) pinch = null; return; }
    if (pan) {
      if (pan.click && !pan.moved && e.type === 'pointerup') {
        const i = screenToTile(e.clientX, e.clientY);
        if (i >= 0) showInspect(i);
      }
      pan = null;
    }
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

  function updateTooltip(sx, sy, ptype) {
    if (hoverTile < 0 || ptype !== 'mouse') { tooltip.hidden = true; return; }
    tooltip.hidden = false; tooltip.className = '';
    tooltip.textContent = `X ${hoverTile % W}  Y ${(hoverTile / W) | 0}`;
    tooltip.style.left = sx + 16 + 'px'; tooltip.style.top = sy + 16 + 'px';
  }

  const keys = new Set();
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    keys.add(e.key.toLowerCase());
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); keys.delete('z'); undo(); return; }
    if (e.key === ' ') { e.preventDefault(); setSpeed(S.speed ? 0 : 1); }
    if (e.key === 'Escape') clearConsole();
    if (e.key === '/' || e.key === 'Enter') { e.preventDefault(); $('cmd').focus(); }
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
    canvas.style.cursor = 'grab';
    $('cTool').textContent = currentTool.full || currentTool.label;
    $('toGroup').hidden = currentTool.mode === 'single';
    $('fromLabel').textContent = currentTool.mode === 'single' ? 'At' : 'From';
    $('btnBuild').textContent = id === 'inspect' ? 'Inspect' : id === 'bulldoze' ? 'Bulldoze' : 'Build';
    refreshPreview(formOrder());
  }

  // ---------- Coordinate build console ----------
  const ALIASES = {
    road: 'road', roads: 'road', street: 'road', line: 'line', wire: 'line',
    res: 'res', residential: 'res', house: 'res', homes: 'res', r: 'res',
    com: 'com', commercial: 'com', shop: 'com', shops: 'com', c: 'com',
    ind: 'ind', industrial: 'ind', factory: 'ind', i: 'ind',
    coal: 'power', plant: 'power', power: 'power', wind: 'wind', turbine: 'wind',
    police: 'police', fire: 'fire', firestation: 'fire', school: 'school', park: 'park', tree: 'tree', trees: 'tree',
    bulldoze: 'bulldoze', demolish: 'bulldoze', destroy: 'bulldoze', bd: 'bulldoze', clear: 'bulldoze',
    inspect: 'inspect', info: 'inspect',
  };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const usage = tool => tool.mode === 'single' ? `${tool.id} X Y` : `${tool.id} X1 Y1 to X2 Y2`;

  function makeOrder(tool, nums) {
    if (nums.length !== 2 && nums.length !== 4) return { tool, err: `Usage: ${usage(tool)}` };
    if (tool.mode === 'single' && nums.length === 4) return { tool, err: `${tool.full || tool.label} goes on one tile. Usage: ${usage(tool)}` };
    if (nums.some(n => !Number.isInteger(n) || n < 0 || n >= W)) return { tool, err: `Coordinates must be whole numbers from 0 to ${W - 1}` };
    const a = idx(nums[0], nums[1]), b = nums.length === 4 ? idx(nums[2], nums[3]) : a;
    const label = `${tool.id} ${nums[0]} ${nums[1]}` + (nums.length === 4 ? ` to ${nums[2]} ${nums[3]}` : '');
    return { tool, tiles: dragTiles(tool, a, b), label };
  }

  function parseCommand(src) {
    const s = src.trim().toLowerCase().replace(/power[\s-]*lines?/g, 'line').replace(/fire[\s-]*station/g, 'fire')
      .replace(/police[\s-]*station/g, 'police').replace(/wind[\s-]*turbine/g, 'wind').replace(/coal[\s-]*plant/g, 'coal');
    if (!s) return null;
    const word = (s.match(/^[a-z]+/) || [''])[0];
    const nums = (s.match(/-?\d+(\.\d+)?/g) || []).map(Number);
    if (word === 'help' || s === '?') return { help: true };
    if (word === 'undo' || word === 'u') return { undo: true };
    if (word === 'goto' || word === 'go' || word === 'view' || word === 'look') {
      if (nums.length !== 2 || nums.some(n => n < 0 || n >= W)) return { err: `Usage: goto X Y (0 to ${W - 1})` };
      return { goto: nums };
    }
    if (word === 'pause') return { speed: 0 };
    if (word === 'play' || word === 'resume') return { speed: 1 };
    const id = ALIASES[word];
    if (!id) return { err: `Unknown command "${word || s}". Type help to see the commands.` };
    return makeOrder(toolById[id], nums);
  }

  function focusTiles(tiles) {
    let sx = 0, sy = 0;
    for (const i of tiles) { sx += i % W; sy += (i / W) | 0; }
    const x = sx / tiles.length, y = sy / tiles.length;
    const [wx, wy] = center(x, y), px = wx * cam.z + cam.x, py = wy * cam.z + cam.y;
    if (px < 80 || px > vw - 80 || py < 100 || py > vh - 200) centerCamera(x, y);
  }

  function say(msg, kind = '') {
    const h = $('cHint'); h.textContent = msg; h.className = kind || 'ok';
    toast(msg, kind);
  }

  function runOrder(o) {
    if (!o) return false;
    if (o.help) { $('helpModal').hidden = false; return true; }
    if (o.undo) {
      const lbl = batch && batch.label;
      endBatch(); undo();
      if (lbl) beginBatch(lbl);
      return true;
    }
    if (o.err) { say(o.err, 'bad'); return false; }
    if (o.speed !== undefined) { setSpeed(o.speed); return true; }
    if (o.goto) { centerCamera(o.goto[0], o.goto[1]); say(`Moved the view to (${o.goto[0]}, ${o.goto[1]})`); return true; }
    const tool = o.tool, name = (tool.full || tool.label).toLowerCase();
    focusTiles(o.tiles);
    const r = applyTool(tool, o.tiles);
    if (r.inspect) return true;
    if (r.placed) {
      const what = tool.id === 'bulldoze' ? `Cleared ${plural(r.placed, 'tile')}` :
        tool.mode === 'single' ? `Built a ${name}` : `Built ${plural(r.placed, name + ' tile')}`;
      let msg = `${what} for ${fmtMoney(r.spent)}.`;
      if (r.broke) msg += ' Ran out of funds before finishing.';
      else if (r.blocked) msg += ` Skipped ${plural(r.blocked, 'blocked tile')}.`;
      say(msg, r.broke ? 'warn' : '');
      return true;
    }
    if (r.broke) say(`Not enough funds. This needs ${fmtMoney(r.need)} and you have ${fmtMoney(S.funds)}.`, 'bad');
    else say(tool.id === 'bulldoze' ? 'Nothing to clear there.' : `Can't build a ${name} there. The tiles are water or already in use.`, 'bad');
    return false;
  }

  const fields = ['x1', 'y1', 'x2', 'y2'].map(id => $(id));
  function formOrder() {
    const v = fields.map(f => f.value.trim());
    if (!v[0] && !v[1]) return null;
    if (!v[0] || !v[1]) return { tool: currentTool, err: 'Enter both X and Y' };
    const nums = [Number(v[0]), Number(v[1])];
    if (currentTool.mode !== 'single' && (v[2] || v[3])) {
      if (!v[2] || !v[3]) return { tool: currentTool, err: 'Enter both X and Y for the end point' };
      nums.push(Number(v[2]), Number(v[3]));
    }
    return makeOrder(currentTool, nums);
  }

  function defaultHint() {
    return currentTool.mode === 'single'
      ? 'Enter the X and Y of a tile. The yellow and blue numbers on the map edges are X and Y.'
      : 'Enter From X,Y. Add To X,Y to cover a line or an area.';
  }

  function refreshPreview(o) {
    pending = o && o.tiles ? o : null;
    const h = $('cHint');
    if (!o) { h.textContent = defaultHint(); h.className = ''; return; }
    if (o.err) { h.textContent = o.err; h.className = 'bad'; return; }
    if (o.help) { h.textContent = 'Press Enter to open the help'; h.className = ''; return; }
    if (o.undo) { h.textContent = undoStack.length ? `Press Enter to undo "${undoStack[undoStack.length - 1].label}"` : 'Nothing to undo'; h.className = ''; return; }
    if (o.goto) { h.textContent = `Press Enter to move the view to (${o.goto[0]}, ${o.goto[1]})`; h.className = ''; return; }
    if (o.speed !== undefined) { h.textContent = o.speed ? 'Press Enter to resume' : 'Press Enter to pause'; h.className = ''; return; }
    const tool = o.tool;
    if (tool.id === 'inspect') { const i = o.tiles[0]; h.textContent = `Inspect tile (${i % W}, ${(i / W) | 0})`; h.className = ''; return; }
    let n = 0, cost = 0;
    for (const i of o.tiles) if (canPlaceAt(tool, i)) { n++; cost += costAt(tool, i); }
    if (!n) { h.textContent = tool.id === 'bulldoze' ? 'Nothing to clear in that area' : 'Those tiles are water or already in use'; h.className = 'bad'; return; }
    h.textContent = `${tool.full || tool.label}: ${plural(n, 'tile')}, ${fmtMoney(cost)}` +
      (n < o.tiles.length ? ` (${o.tiles.length - n} blocked)` : '') + (cost > S.funds ? '. Not enough funds.' : '');
    h.className = cost > S.funds ? 'bad' : 'ok';
  }

  function clearConsole() {
    fields.forEach(f => { f.value = ''; });
    $('cmd').value = '';
    refreshPreview(null);
  }

  function buildFromForm() {
    const o = formOrder();
    if (!o) { say('Enter coordinates first', 'warn'); fields[0].focus(); return; }
    beginBatch(o.label || '');
    const ok = runOrder(o);
    endBatch();
    if (ok && o.tool && o.tool.id !== 'inspect') {
      if (o.tool.mode === 'line' && fields[2].value) {
        // Chain the next segment from where this one ended.
        fields[0].value = fields[2].value; fields[1].value = fields[3].value;
        fields[2].value = ''; fields[3].value = '';
      } else fields.forEach(f => { f.value = ''; });
    }
    pending = null; // keep the result message until the next edit
  }

  fields.forEach((f, k) => {
    f.addEventListener('input', () => { $('cmd').value = ''; refreshPreview(formOrder()); });
    f.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); buildFromForm(); } });
  });
  $('btnBuild').addEventListener('click', buildFromForm);

  const history = [];
  let hIdx = 0;
  const lastPart = v => { const parts = v.split(/[;\n]/); return parts[parts.length - 1]; };
  $('cmd').addEventListener('input', () => refreshPreview(parseCommand(lastPart($('cmd').value))));
  $('cmd').addEventListener('keydown', e => {
    if (e.key === 'ArrowUp' && hIdx > 0) { e.preventDefault(); $('cmd').value = history[--hIdx]; refreshPreview(parseCommand(lastPart($('cmd').value))); }
    if (e.key === 'ArrowDown') { e.preventDefault(); hIdx = Math.min(history.length, hIdx + 1); $('cmd').value = history[hIdx] || ''; refreshPreview(parseCommand(lastPart($('cmd').value))); }
  });
  $('cmdForm').addEventListener('submit', e => {
    e.preventDefault();
    const src = $('cmd').value;
    if (!src.trim()) return;
    history.push(src); hIdx = history.length;
    const label = src.trim().replace(/\s+/g, ' ');
    beginBatch(label.length > 40 ? label.slice(0, 39) + '…' : label);
    for (const part of src.split(/[;\n]+/)) if (part.trim()) runOrder(parseCommand(part));
    endBatch();
    $('cmd').value = '';
    pending = null;
  });

  // ---------- Undo ----------
  // Each Build press or submitted command line is one undo step. Undo restores the
  // tiles it changed and refunds what it cost.
  const undoStack = [];
  let batch = null;
  function beginBatch(label) { batch = { label, tiles: new Map(), funds: S.funds }; }
  function endBatch() {
    if (batch && batch.tiles.size) {
      batch.spent = batch.funds - S.funds;
      undoStack.push(batch);
      if (undoStack.length > 50) undoStack.shift();
    }
    batch = null;
    updateUndo();
  }
  function undo() {
    const b = undoStack.pop();
    if (!b) { say('Nothing to undo', 'warn'); updateUndo(); return; }
    for (const [i, v] of b.tiles) { type[i] = v[0]; lvl[i] = v[1]; fire[i] = v[2]; variety[i] = v[3]; }
    S.funds += b.spent;
    mapsDirty = true; computeMaps(); computeStats(); updateHUD(); drawMinimap();
    focusTiles([...b.tiles.keys()]);
    say(`Undid "${b.label}". Refunded ${fmtMoney(b.spent)}.`);
    updateUndo();
  }
  function updateUndo() {
    const btn = $('btnUndo');
    btn.disabled = !undoStack.length;
    btn.title = undoStack.length ? `Undo "${undoStack[undoStack.length - 1].label}" (Ctrl+Z)` : 'Nothing to undo';
  }
  function clearUndo() { undoStack.length = 0; updateUndo(); }
  $('btnUndo').addEventListener('click', () => { undo(); });

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
      if (roadDist[i] <= 3) {
        const k = nets[netId[i]];
        if (t === T.RES) {
          if (!hasPartner(i)) row('Jobs by road', '❌ none connected');
          else if (commute[i] === NO_ROUTE) row('Commute', l ? 'Jobs not built yet' : '–');
          else row('Commute', `${commute[i]} tiles` + (commute[i] > 30 ? ' (long)' : ''));
        } else row('Homes by road', k.res ? `${k.pop.toLocaleString()} residents` : '❌ none connected');
        const jam = traffic[nearRoad[i]] / ROAD_CAP;
        if (jam > 1) row('Street', '🚗 Jammed');
      }
    } else if (t === T.ROAD) {
      const c = traffic[i] / ROAD_CAP;
      row('Commuters', `${Math.round(traffic[i]).toLocaleString()} / ${ROAD_CAP}`);
      row('Traffic', c < 0.05 ? 'Empty' : c < 0.6 ? 'Light' : c < 1 ? 'Busy' : '🚗 Jammed');
      row('Upkeep', fmtMoney(UPKEEP[t]) + '/mo');
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
    while (box.children.length > (window.matchMedia('(max-width: 720px)').matches ? 2 : 4)) box.firstChild.remove();
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
      mapsDirty = true; computeMaps(); computeStats(); setSpeed(S.speed); updateHUD(); drawMinimap(); clearUndo();
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
    computeMaps(); computeStats(); setSpeed(1); updateHUD(); drawMinimap(); showInspect(-1); clearUndo();
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
  selectTool('road');
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
    simDay, refs: () => ({ type, lvl, pow, roadDist }),
    run: src => { beginBatch(src); const r = src.split(/[;\n]+/).filter(p => p.trim()).map(p => runOrder(parseCommand(p))); endBatch(); return r; },
    undo: () => undo(), traffic: () => traffic, commute: () => commute };
})();
