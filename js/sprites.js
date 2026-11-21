/* Cord City pixel-art sprite set.
 * Every sprite is drawn pixel by pixel at native size (tiles are 32x16)
 * and meant to be scaled up with smoothing off. No image files needed.
 *
 * Sprites are anchored on the tile's ground diamond: the diamond occupies the
 * bottom 16 rows of the sprite, centred horizontally. */
(function (global) {
  'use strict';

  const TILE_W = 32, TILE_H = 16;
  const OUT = '#231f2e';

  // ---------- helpers ----------
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shade(c, f) {
    const n = parseInt(c.slice(1), 16);
    const k = v => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, '0');
    return '#' + k((n >> 16) & 255) + k((n >> 8) & 255) + k(n & 255);
  }
  const hash = (x, y, s = 0) => (((x * 73856093) ^ (y * 19349663) ^ (s * 83492791)) >>> 0);

  class Sprite {
    constructor(h) {
      this.w = TILE_W; this.h = h;
      this.canvas = document.createElement('canvas');
      this.canvas.width = TILE_W; this.canvas.height = h;
      this.g = this.canvas.getContext('2d');
      this.cx = 16; this.cy = h - 8;     // ground centre (between rows)
    }
    px(x, y, c) {
      if (!c || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
      this.g.fillStyle = c; this.g.fillRect(x, y, 1, 1);
    }
  }

  // Iterate the columns of a 2:1 diamond with half-width hw.
  function cols(cx, hw, fn) {
    for (let dx = -hw; dx < hw; dx++) {
      const k = dx < 0 ? -dx - 1 : dx;
      fn(cx + dx, k, Math.ceil((hw - k) / 2), dx < 0);
    }
  }

  // Paint the ground diamond. painter(x, y, tx, ty) gets tile-space coords in [-0.5, 0.5].
  function ground(s, painter) {
    cols(s.cx, 16, (x, k, e) => {
      for (let y = s.cy - e; y <= s.cy + e - 1; y++) {
        const a = (x + 0.5 - s.cx) / 16, b = (y + 0.5 - s.cy) / 8;
        s.px(x, y, painter(x, y, (a + b) / 2, (b - a) / 2));
      }
    });
  }

  // Extruded box. o: {ox, oy, base, hw, h, top, left, right, paint(u, v, isLeft, x, y)}
  function box(s, o) {
    const cx = s.cx + (o.ox || 0), cy = s.cy + (o.oy || 0) - (o.base || 0);
    cols(cx, o.hw, (x, k, e, isLeft) => {
      const yTop = cy - e - o.h, topBot = cy + e - 1 - o.h, faceBot = cy + e - 1;
      for (let y = yTop; y <= topBot; y++) s.px(x, y, y === topBot ? shade(o.top, 1.12) : o.top);
      const side = isLeft ? o.left : o.right;
      for (let y = topBot + 1; y <= faceBot; y++) {
        const u = o.hw - 1 - k, v = faceBot - y;
        s.px(x, y, (o.paint && o.paint(u, v, isLeft, x, y)) || side);
      }
      if (k === 0 && isLeft) for (let y = topBot + 1; y < faceBot; y++) s.px(x, y, shade(o.left, 1.12));
      if (k === o.hw - 1) for (let y = yTop; y <= faceBot; y++) s.px(x, y, OUT);
      s.px(x, yTop, OUT);
      if (!o.base) s.px(x, faceBot, shade(side, 0.65));
    });
  }

  // Stepped hip roof sitting on top of a wall of height `base`.
  function hipRoof(s, o) {
    const cx = s.cx + (o.ox || 0), cy0 = s.cy + (o.oy || 0) - o.base;
    for (let sz = o.hw, lift = 0; sz >= 2; sz -= 2, lift += o.pitch || 2) {
      const cy = cy0 - lift;
      cols(cx, sz, (x, k, e, isLeft) => {
        const c = isLeft ? o.L : o.R;
        for (let y = cy - e; y <= cy + e - 1; y++) s.px(x, y, c);
        s.px(x, cy + e - 1, shade(c, 0.82));
        s.px(x, cy - e, OUT);
        if (k === sz - 1) s.px(x, cy, OUT);
      });
    }
  }

  function circle(s, cx, cy, r, fn) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d <= r) s.px(x, y, fn(x, y, d, x + 0.5 - cx, y + 0.5 - cy));
      }
  }

  function tree(s, ox, oy, r, seed, pal) {
    const p = pal || { L: '#7cc057', M: '#4f9a3a', D: '#2f6e2c' };
    const bx = s.cx + ox, by = s.cy + oy;
    // shadow
    for (let y = -1; y <= 1; y++) for (let x = -r; x <= r; x++)
      if ((x * x) / (r * r) + (y * y) / 2 <= 1) s.px(bx + x, by + y, 'rgba(20,40,20,0.35)');
    s.px(bx, by - 1, '#5b3a22'); s.px(bx - 1, by - 1, '#6e4628');
    s.px(bx, by - 2, '#5b3a22'); s.px(bx - 1, by - 2, '#6e4628');
    const ccx = bx, ccy = by - 2 - r;
    const R = rng(seed);
    circle(s, ccx, ccy, r, (x, y, d, dx, dy) => {
      if (d > r - 0.9) return OUT;
      const l = dx + dy;
      let c = l < -r * 0.5 ? p.L : l > r * 0.45 ? p.D : p.M;
      if (R() < 0.12) c = shade(c, R() < 0.5 ? 1.15 : 0.85);
      return c;
    });
  }

  function puff(s, x, y, r) {
    circle(s, x, y, r, (px, py, d, dx, dy) => d > r - 0.8 ? '#8d8f96' : (dx + dy < 0 ? '#eef0f3' : '#c9ccd2'));
  }

  function line(s, x0, y0, x1, y1, c) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i++) s.px(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), c);
  }

  const lit = (x, y, odds) => hash(x, y, 7) % odds === 0;
  function windows(glass, litCol, every, rows, from, h, odds = 6) {
    return (u, v, isLeft, x, y) => {
      if (v < from || v > h - 3) return null;
      if (u % every === 1 && (v % rows === 1 || v % rows === 2)) return lit(x, y, odds) ? litCol : (isLeft ? glass : shade(glass, 0.8));
      return null;
    };
  }

  // ---------- ground tiles ----------
  const GRASS = ['#5c9d42', '#57963e', '#64a748', '#518f3a'];
  function grassPainter(seed) {
    return (x, y) => {
      const h = hash(x, y, seed) % 100;
      if (h === 0 && hash(x, y, seed + 9) % 3 === 0) return '#e9d96f';
      if (h < 14) return GRASS[2];
      if (h < 26) return GRASS[1];
      if (h < 30) return GRASS[3];
      return GRASS[0];
    };
  }
  function makeGrass(seed) { const s = new Sprite(16); ground(s, grassPainter(seed)); return s; }

  function makeWater(frame) {
    const s = new Sprite(16);
    ground(s, (x, y, tx, ty) => {
      const deep = (hash(x >> 2, y >> 1, 3) % 3 === 0);
      const wave = ((x + frame * 2 + (y % 3) * 5) % 13 < 2) && (y % 3 === 0);
      if (wave) return '#9fd0f2';
      return deep ? '#3271b3' : '#3a80c6';
    });
    return s;
  }

  const DIR = { PX: 1, NX: 2, PY: 4, NY: 8 };
  function makeRoad(mask, hwy) {
    const s = new Sprite(16);
    const m = 0.15, links = [1, 2, 4, 8].filter(b => mask & b).length;
    ground(s, (x, y, tx, ty) => {
      const nPX = tx > 0.5 - m, nNX = tx < -0.5 + m, nPY = ty > 0.5 - m, nNY = ty < -0.5 + m;
      const walk = (nPX && !(mask & 1)) || (nNX && !(mask & 2)) || (nPY && !(mask & 4)) || (nNY && !(mask & 8)) ||
        ((nPX || nNX) && (nPY || nNY));
      if (walk && hwy) {
        // gravel shoulder with a white edge line
        const edgeLine = (tx > 0.5 - m - 0.05 && tx <= 0.5 - m + 0.04) || (tx < -0.5 + m + 0.05 && tx >= -0.5 + m - 0.04) ||
          (ty > 0.5 - m - 0.05 && ty <= 0.5 - m + 0.04) || (ty < -0.5 + m + 0.05 && ty >= -0.5 + m - 0.04);
        return edgeLine ? '#eeeae0' : (hash(x, y, 4) % 3 ? '#8f8a7c' : '#7d786b');
      }
      if (walk) {
        const inner = (tx > 0.5 - m - 0.05 && tx <= 0.5 - m + 0.04) || (tx < -0.5 + m + 0.05 && tx >= -0.5 + m - 0.04) ||
          (ty > 0.5 - m - 0.05 && ty <= 0.5 - m + 0.04) || (ty < -0.5 + m + 0.05 && ty >= -0.5 + m - 0.04);
        return inner ? '#8e8a80' : ((x + y) % 4 === 0 ? '#c8c3b7' : '#b9b4a8');
      }
      if (links >= 3) {
        // junction box: no lane paint
      } else {
        const onX = Math.abs(ty) < 0.04 && ((tx >= 0 && mask & 1) || (tx <= 0 && mask & 2));
        const onY = Math.abs(tx) < 0.04 && ((ty >= 0 && mask & 4) || (ty <= 0 && mask & 8));
        const lane = hwy ? '#f4f4f0' : '#f2cf4a';
        if (onX && Math.floor((tx + 0.5) * 8) % 2 === 0) return lane;
        if (onY && Math.floor((ty + 0.5) * 8) % 2 === 0) return lane;
      }
      if (hwy) return hash(x, y, 11) % 9 === 0 ? '#363a43' : '#3e434c';
      return hash(x, y, 11) % 9 === 0 ? '#444954' : '#4d525d';
    });
    return s;
  }

  function makeZone(color, seed) {
    const s = new Sprite(16), gp = grassPainter(seed);
    ground(s, (x, y, tx, ty) => {
      const edge = Math.max(Math.abs(tx), Math.abs(ty));
      if (edge > 0.39 && edge < 0.45) return (x >> 1) % 2 === 0 ? color : shade(color, 0.7);
      if (edge <= 0.39 && (x + y) % 4 === 0 && y % 2 === 0) return shade(color, 0.85);
      return gp(x, y);
    });
    return s;
  }

  function makeLot(base, seed) {
    const s = new Sprite(16);
    ground(s, (x, y, tx, ty) => {
      if (Math.max(Math.abs(tx), Math.abs(ty)) > 0.44) return shade(base, 0.82);
      return hash(x, y, seed) % 7 === 0 ? shade(base, 0.93) : base;
    });
    return s;
  }

  function makeParkGround() {
    const s = new Sprite(16), gp = grassPainter(5);
    ground(s, (x, y, tx, ty) => {
      if (Math.abs(tx) < 0.06 || Math.abs(ty) < 0.06) return (x + y) % 3 ? '#d8c690' : '#c9b47c';
      const g = gp(x, y);
      return g === GRASS[0] ? '#6db24c' : g;
    });
    // fountain
    const f = { ox: 0, oy: 0 };
    cols(s.cx, 5, (x, k, e) => { for (let y = s.cy - e; y <= s.cy + e - 1; y++) s.px(x, y, '#c9c4b8'); });
    cols(s.cx, 4, (x, k, e) => { for (let y = s.cy - e; y <= s.cy + e - 1; y++) s.px(x, y, (x + y) % 3 ? '#4f97d6' : '#8cc4ee'); });
    void f;
    return s;
  }

  // ---------- objects (transparent, drawn over a ground tile) ----------
  function obj(h, draw) { const s = new Sprite(h); draw(s); return s; }

  const SPRITES = {};
  function build() {
    // Ground
    SPRITES.grass = [makeGrass(1), makeGrass(2)];
    SPRITES.water = [makeWater(0), makeWater(1), makeWater(2)];
    SPRITES.road = [];
    for (let m = 0; m < 16; m++) SPRITES.road[m] = makeRoad(m);
    SPRITES.highway = [];
    for (let m = 0; m < 16; m++) SPRITES.highway[m] = makeRoad(m, true);
    SPRITES.zoneRes = makeZone('#4fbf5a', 3);
    SPRITES.zoneCom = makeZone('#4b8ee8', 4);
    SPRITES.zoneInd = makeZone('#e5b52a', 6);
    SPRITES.lot = makeLot('#a8ada6', 1);
    SPRITES.lotInd = makeLot('#948c7c', 2);
    SPRITES.parkGround = makeParkGround();

    // Trees
    SPRITES.trees = obj(34, s => {
      tree(s, -7, -2, 5, 1); tree(s, 7, -1, 4, 2); tree(s, 0, 3, 5, 3);
    });

    // Residential
    SPRITES.res1 = obj(40, s => {
      tree(s, 9, 2, 3, 7);
      box(s, { ox: -2, oy: -1, hw: 9, h: 7, top: '#e9dcc0', left: '#efe2c4', right: '#cdbb98',
        paint: (u, v, isLeft) => {
          if (isLeft && u >= 9 && u <= 10 && v <= 3) return '#7a4a2a';
          if (u % 4 === 2 && v >= 3 && v <= 4) return isLeft ? '#6d97c4' : '#557ca6';
          return null;
        } });
      hipRoof(s, { ox: -2, oy: -1, hw: 10, base: 7, L: '#cf5b3e', R: '#a4432f' });
    });
    SPRITES.res2 = obj(58, s => {
      box(s, { hw: 13, h: 22, top: '#b9b1a5', left: '#dcb68f', right: '#b88f69',
        paint: windows('#5f87b3', '#ffe39a', 3, 4, 2, 22, 5) });
      box(s, { ox: 4, oy: -2, base: 22, hw: 3, h: 3, top: '#d7d7d7', left: '#bdbdbd', right: '#9a9a9a' });
    });
    SPRITES.res3 = obj(92, s => {
      box(s, { hw: 12, h: 56, top: '#8d877c', left: '#d4cec1', right: '#aaa397',
        paint: windows('#5a7fa6', '#ffe39a', 3, 3, 2, 56, 4) });
      box(s, { ox: -3, oy: 1, base: 56, hw: 3, h: 6, top: '#8a5a3c', left: '#a86e48', right: '#83553a' });
    });

    // Commercial
    SPRITES.com1 = obj(42, s => {
      box(s, { hw: 13, h: 11, top: '#7c8a97', left: '#ece8de', right: '#cbc6b9',
        paint: (u, v, isLeft) => {
          if (v >= 7 && v <= 8) return u % 2 ? '#d9483b' : '#f6f1e7';
          if (v >= 2 && v <= 5 && u % 5 !== 0) return isLeft ? '#8fc6e6' : '#6ea6c8';
          if (v < 2 && u % 5 !== 0) return '#5d6a75';
          return null;
        } });
      box(s, { ox: -2, oy: 0, base: 11, hw: 5, h: 3, top: '#f2c14b', left: '#f2c14b', right: '#cf9f2e' });
    });
    SPRITES.com2 = obj(68, s => {
      box(s, { hw: 13, h: 32, top: '#5d6b78', left: '#73a8cc', right: '#4f7fa4',
        paint: (u, v, isLeft, x, y) => {
          if (v % 4 === 0) return isLeft ? '#e3ebf0' : '#bfcad2';
          if ((u + v) % 9 === 0) return '#b9e1f7';
          if (lit(x, y, 9)) return '#fff0b0';
          return null;
        } });
      box(s, { ox: 4, oy: -2, base: 32, hw: 4, h: 4, top: '#9aa3ab', left: '#8a939b', right: '#6c747b' });
    });
    SPRITES.com3 = obj(116, s => {
      const glass = (h) => (u, v, isLeft, x, y) => {
        if (v % 3 === 0) return isLeft ? '#2f4f72' : '#223a55';
        if (u % 3 === 0) return isLeft ? '#3f6890' : '#2e4f70';
        if (lit(x, y, 7)) return '#ffe9a0';
        return null;
      };
      box(s, { hw: 13, h: 36, top: '#3c5a7a', left: '#4f83b8', right: '#3a6590', paint: glass(36) });
      box(s, { base: 36, hw: 9, h: 34, top: '#3c5a7a', left: '#5a8fc4', right: '#406e9c', paint: glass(34) });
      box(s, { base: 70, hw: 5, h: 10, top: '#cfd6dd', left: '#b8c2cc', right: '#8e99a4' });
      for (let k = 0; k < 10; k++) s.px(16, s.cy - 5 - 80 - k, k < 2 ? '#ff4a3a' : '#c6ccd2');
    });

    // Industrial
    SPRITES.ind1 = obj(38, s => {
      box(s, { hw: 14, h: 10, top: '#8f8d86', left: '#c4ad74', right: '#9c8655',
        paint: (u, v, isLeft) => {
          if (isLeft && u >= 5 && u <= 10 && v <= 6) return v % 2 ? '#6b5f4a' : '#5a4f3d';
          return u % 2 ? null : (isLeft ? '#b39d66' : '#8b764a');
        } });
      box(s, { base: 10, hw: 10, h: 2, top: '#a3a19a', left: '#8f8d86', right: '#76746e' });
    });
    SPRITES.ind2 = obj(64, s => {
      box(s, { ox: 6, oy: -3, hw: 2, h: 28, top: '#5a3a30', left: '#a35f4a', right: '#7d4636',
        paint: (u, v) => (v >= 23 && v <= 24 ? '#f1ece2' : null) });
      box(s, { hw: 14, h: 13, top: '#6f6a62', left: '#ae9f88', right: '#877a66',
        paint: (u, v, isLeft) => (v >= 8 && v <= 9 && u % 3 === 1 ? (isLeft ? '#e3d9a4' : '#bfb682') : null) });
      puff(s, 22.5, s.cy - 3 - 34, 3.2); puff(s, 25.5, s.cy - 3 - 40, 2.4);
    });
    SPRITES.ind3 = obj(72, s => {
      const stack = (ox, oy) => box(s, { ox, oy, hw: 2, h: 34, top: '#5a3a30', left: '#a35f4a', right: '#7d4636',
        paint: (u, v) => (v >= 29 && v <= 30 ? '#f1ece2' : null) });
      stack(8, -4); stack(2, -7);
      box(s, { hw: 15, h: 16, top: '#67625a', left: '#a89a85', right: '#827562',
        paint: (u, v, isLeft) => (v >= 11 && v <= 12 && u % 3 === 1 ? '#e3d9a4' : (u % 6 === 0 ? (isLeft ? '#968a76' : '#706555') : null)) });
      box(s, { ox: -8, oy: 4, hw: 4, h: 9, top: '#e1e4e8', left: '#cfd3d8', right: '#a7adb4',
        paint: (u, v) => (v === 5 ? '#d9483b' : null) });
      puff(s, 24.5, s.cy - 4 - 40, 3.2); puff(s, 18.5, s.cy - 7 - 41, 3);
    });

    // Power
    SPRITES.coal = obj(84, s => {
      const stack = (ox, oy) => box(s, { ox, oy, hw: 3, h: 40, top: '#3a3a3a', left: '#e4e0d8', right: '#b9b4aa',
        paint: (u, v) => (Math.floor(v / 5) % 2 && v > 18 ? '#c9473a' : null) });
      stack(6, -3); stack(-2, -7);
      box(s, { hw: 14, h: 14, top: '#666b73', left: '#8a8f97', right: '#666a72',
        paint: (u, v, isLeft) => (v >= 9 && v <= 10 && u % 4 === 1 ? '#ffd76a' : (u % 7 === 0 ? (isLeft ? '#7a7f87' : '#585c63') : null)) });
      puff(s, 22.5, s.cy - 3 - 46, 3.5); puff(s, 14.5, s.cy - 7 - 47, 3);
    });
    SPRITES.wind = [0, 1, 2].map(f => obj(76, s => {
      cols(s.cx, 4, (x, k, e) => { for (let y = s.cy - e; y <= s.cy + e - 1; y++) s.px(x, y, '#b5b7b2'); });
      const top = s.cy - 48;
      for (let y = top; y <= s.cy; y++) { s.px(15, y, '#f3f4f6'); s.px(16, y, '#c7cad0'); }
      s.px(14, top - 1, OUT); s.px(15, top - 1, '#e6e8eb'); s.px(16, top - 1, '#e6e8eb'); s.px(17, top - 1, '#b3b7bd');
      for (let b = 0; b < 3; b++) {
        const a = f * (Math.PI * 2 / 9) + b * Math.PI * 2 / 3 - Math.PI / 2;
        line(s, 15.5, top - 1, 15.5 + Math.cos(a) * 15, top - 1 + Math.sin(a) * 15, '#f7f8fa');
        line(s, 16.5, top, 16.5 + Math.cos(a) * 14, top + Math.sin(a) * 14, '#b9bdc4');
      }
      s.px(15, top - 1, '#d9483b');
    }));

    // Services
    SPRITES.police = obj(46, s => {
      box(s, { hw: 13, h: 13, top: '#e6eaf0', left: '#5677bd', right: '#3d5a96',
        paint: (u, v, isLeft) => {
          if (v === 6) return '#f4f6fa';
          if (isLeft && u >= 9 && u <= 11 && v <= 4) return '#26324f';
          if (u % 3 === 1 && v >= 8 && v <= 10) return isLeft ? '#bcd3f0' : '#94acd0';
          return null;
        } });
      const ly = s.cy - 13 - 2;
      s.px(13, ly, '#ff4a4a'); s.px(14, ly, '#ff4a4a'); s.px(17, ly, '#4a7dff'); s.px(18, ly, '#4a7dff');
      s.px(15, ly, '#e8e8e8'); s.px(16, ly, '#e8e8e8');
    });
    SPRITES.fire = obj(56, s => {
      box(s, { ox: 6, oy: -3, hw: 3, h: 24, top: '#7a2a20', left: '#c4473a', right: '#9b3428',
        paint: (u, v) => (v >= 19 && v <= 20 && u % 2 ? '#3c2a24' : null) });
      box(s, { hw: 13, h: 13, top: '#e7d8d0', left: '#cc4a3c', right: '#a2382c',
        paint: (u, v, isLeft) => {
          if (isLeft && v <= 8 && ((u >= 3 && u <= 7) || (u >= 9 && u <= 13))) return v % 2 ? '#3c2a24' : '#55403a';
          if (!isLeft && u % 3 === 1 && v >= 6 && v <= 8) return '#f1d9a0';
          if (v === 11) return '#f3ebe6';
          return null;
        } });
    });
    SPRITES.school = obj(56, s => {
      box(s, { hw: 14, h: 12, top: '#eadfca', left: '#cf8552', right: '#a7663c',
        paint: (u, v, isLeft) => {
          if (v === 10) return '#f6efe2';
          if (isLeft && u >= 12 && u <= 13 && v <= 5) return '#5b3a26';
          if (u % 3 === 1 && v >= 3 && v <= 6) return isLeft ? '#f6efe2' : '#d9d0bf';
          return null;
        } });
      const fx = 26, fy = s.cy - 1 - 12;
      for (let y = fy - 14; y <= fy; y++) s.px(fx, y, '#4a4a4a');
      for (let y = 0; y < 4; y++) for (let x = 1; x <= 6; x++) s.px(fx + x - 7, fy - 14 + y + (x > 3 ? 0 : 0), y < 2 ? '#d9483b' : '#f6f1e7');
    });
    SPRITES.park = obj(30, s => {
      tree(s, -9, -1, 4, 11); tree(s, 9, 1, 4, 12);
      // bench
      for (let i = 0; i < 4; i++) { s.px(10 + i * 2, s.cy - 4 + i, '#7a4a2a'); s.px(11 + i * 2, s.cy - 4 + i, '#7a4a2a'); }
      // fountain jet
      s.px(16, s.cy - 3, '#bfe3fb'); s.px(15, s.cy - 2, '#8cc4ee'); s.px(16, s.cy - 2, '#8cc4ee'); s.px(17, s.cy - 2, '#8cc4ee');
    });
    // Green highway sign that marks where the region's highway enters the map
    SPRITES.hwySign = obj(50, s => {
      const top = s.cy - 36;
      for (let y = top + 8; y <= s.cy + 3; y++) { s.px(5, y, '#9aa0a6'); s.px(26, y, '#9aa0a6'); s.px(6, y, '#6b7076'); s.px(27, y, '#6b7076'); }
      for (let y = top; y <= top + 11; y++) for (let x = 3; x <= 28; x++) {
        const edge = y === top || y === top + 11 || x === 3 || x === 28;
        s.px(x, y, edge ? '#eef2ee' : '#1f7a45');
      }
      // arrow and two lines of "text"
      for (let x = 6; x <= 12; x++) s.px(x, top + 5, '#ffffff');
      s.px(11, top + 4, '#ffffff'); s.px(11, top + 6, '#ffffff'); s.px(10, top + 3, '#ffffff'); s.px(10, top + 7, '#ffffff');
      for (let x = 15; x <= 25; x++) { if (x % 3) s.px(x, top + 3, '#ffffff'); if (x % 4) s.px(x, top + 7, '#d7eadc'); }
      for (let x = 3; x <= 28; x++) s.px(x, top + 12, OUT);
    });
    SPRITES.pole = obj(40, s => {
      const top = s.cy - 26;
      for (let y = top; y <= s.cy; y++) { s.px(15, y, '#7a5235'); s.px(16, y, '#5a3b26'); }
      for (let x = 10; x <= 21; x++) s.px(x, top + 2, '#5a3b26');
      [10, 15, 21].forEach(x => { s.px(x, top + 1, '#e9eef2'); });
    });
    return SPRITES;
  }

  global.CordSprites = { build, SPRITES, TILE_W, TILE_H, DIR };
})(window);
