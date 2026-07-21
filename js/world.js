// ============================================================
// EMBERFALL ONLINE — world.js : map generation + tile rendering
// Tile types: 0 grass, 1 path, 2 water, 3 sand, 4 stonefloor,
//             5 rock(block), 6 tree(block), 7 wall(block),
//             8 darkgrass, 9 ash
// ============================================================
'use strict';

const World = {
  tiles: new Uint8Array(MAP_W * MAP_H),
  trees: [],            // {tx,ty} for canopy overlay
  houses: [],           // {tx,ty,w,h,roof}
  minimapC: null,

  t(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return 2;
    return this.tiles[ty * MAP_W + tx];
  },
  set(tx, ty, v) {
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return;
    this.tiles[ty * MAP_W + tx] = v;
  },
  blockedTile(tx, ty) {
    const t = this.t(tx, ty);
    return t === 2 || t === 5 || t === 6 || t === 7;
  },
  // pixel-space collision with a small radius
  blocked(px, py) {
    return this.blockedTile(Math.floor(px / TILE), Math.floor(py / TILE));
  },

  regionAt(px, py) {
    const tx = px / TILE, ty = py / TILE;
    if (dist(tx, ty, 70, 111) < 17) return 'village';
    if (tx > 99 && ty > 36 && ty < 94) return 'cave';
    if (ty < 36) return 'ruins';
    if (ty < 89) return 'forest';
    return 'meadow';
  },
  regionName(r) {
    return { village: 'Havenbrook Village', cave: 'The Ember Caves', ruins: 'The Ashen Ruins',
             forest: 'The Whisperwood', meadow: 'Southmeadow' }[r];
  },

  gen() {
    const R = mulberry32(1337);
    const T = this.tiles;
    // base grass
    T.fill(0);
    // ocean border with sand
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      const edge = Math.min(x, y, MAP_W - 1 - x, MAP_H - 1 - y);
      const wob = Math.floor(hash2(x >> 2, y >> 2) * 3);
      if (edge < 4 + wob) this.set(x, y, 2);
      else if (edge < 6 + wob) this.set(x, y, 3);
    }
    // forest band (dark grass + trees)
    for (let y = 38; y < 89; y++) for (let x = 8; x < 100; x++) {
      if (this.t(x, y) !== 0) continue;
      this.set(x, y, 8);
      if (hash2(x, y) < 0.15 + 0.1 * Math.sin(x * 0.15) * Math.sin(y * 0.13)) this.set(x, y, 6);
    }
    // dithered transition between the forest's dark grass and the meadow
    for (let y = 85; y < 93; y++) for (let x = 8; x < 100; x++) {
      const t = this.t(x, y);
      if (t !== 0 && t !== 8) continue;
      this.set(x, y, hash2(x * 13, y * 17) > (y - 84) / 9 ? 8 : 0);
    }
    // scattered trees in meadow + near village
    for (let y = 89; y < 132; y++) for (let x = 8; x < 132; x++) {
      if (this.t(x, y) === 0 && hash2(x * 3, y * 7) < 0.025) this.set(x, y, 6);
    }
    // pond in meadow: sandy shore, then water
    this.blob(96, 104, 6.5, 3, R);
    this.blob(96, 104, 4.8, 2, R, true);
    // ember caves (east): stone floor with rock walls
    for (let y = 37; y < 94; y++) for (let x = 100; x < 134; x++) {
      const t = this.t(x, y);
      if (t === 2 || t === 3) continue;
      this.set(x, y, 4);
      // outer rock rim
      if (x === 100 && (y < 63 || y > 67)) this.set(x, y, 5);
      if (y === 37 || y === 93 || x >= 132) this.set(x, y, 5);
    }
    // rock blobs inside caves
    for (let i = 0; i < 46; i++) {
      const cx = 103 + Math.floor(R() * 28), cy = 40 + Math.floor(R() * 50);
      if (dist(cx, cy, 124, 50) < 7) continue;                 // keep boss lair open
      if (Math.abs(cy - 65) < 3 && cx < 112) continue;         // keep entrance corridor
      this.blob(cx, cy, 1 + R() * 2.2, 5, R);
    }
    // gloomfang lair chamber
    this.ring(124, 50, 8, 5, 4); this.blob(124, 50, 6.5, 4, R, true);
    // ruins (north): ash + broken walls
    for (let y = 6; y < 36; y++) for (let x = 30; x < 110; x++) {
      const t = this.t(x, y);
      if (t === 2 || t === 3) continue;
      this.set(x, y, (t === 6) ? 6 : 9);
      if (hash2(x, y * 5) < 0.5) this.set(x, y, 9);
    }
    // clear trees in ruins area, add ruined wall segments
    for (let y = 6; y < 36; y++) for (let x = 30; x < 110; x++)
      if (this.t(x, y) === 6) this.set(x, y, 9);
    for (let i = 0; i < 26; i++) {
      const wx = 34 + Math.floor(R() * 70), wy = 9 + Math.floor(R() * 24);
      if (dist(wx, wy, 70, 15) < 10) continue;                  // keep arena open
      const len = 2 + Math.floor(R() * 4), horiz = R() < 0.5;
      for (let j = 0; j < len; j++) {
        const x = wx + (horiz ? j : 0), y = wy + (horiz ? 0 : j);
        if (this.t(x, y) === 9) this.set(x, y, 7);
      }
    }
    // boss arena: ring of rocks with south opening
    for (let a = 0; a < 40; a++) {
      const ang = a / 40 * Math.PI * 2;
      if (ang > 1.1 && ang < 2.0) continue;                     // opening facing south
      const x = Math.round(70 + Math.cos(ang) * 10), y = Math.round(15 + Math.sin(ang) * 8);
      this.set(x, y, 5);
    }
    // village clearing
    for (let y = 94; y < 128; y++) for (let x = 53; x < 88; x++) {
      if (dist(x, y, 70, 111) < 17 && this.t(x, y) === 6) this.set(x, y, 0);
    }
    // roads: village -> north through forest to ruins arena
    for (let y = 17; y <= 118; y++) for (let dx = -1; dx <= 1; dx++) {
      const x = 70 + dx + Math.round(Math.sin(y * 0.12) * 1.6);
      if (this.t(x, y) !== 2) this.set(x, y, 1);
    }
    // meadow road east from village toward the pond
    for (let x = 71; x <= 100; x++) {
      const y = 90 + Math.round(Math.sin(x * 0.2) * 1.2);
      if (this.t(x, y) !== 2) this.set(x, y, 1);
      if (this.t(x, y + 1) !== 2) this.set(x, y + 1, 1);
    }
    // forest road east into cave entrance (row ~65)
    for (let x = 72; x <= 112; x++) {
      const y = 65 + Math.round(Math.sin(x * 0.11) * 1.3);
      for (let dy = -1; dy <= 0; dy++) if (this.t(x, y + dy) !== 2) this.set(x, y + dy, 1);
    }
    // connect north road to forest road
    // village plaza
    this.blob(70, 111, 5.5, 1, R, true);
    // houses around plaza
    this.house(60, 104, 7, 5); this.house(75, 103, 7, 5);
    this.house(59, 114, 6, 5); this.house(76, 114, 7, 5);
    // torch posts stored for lighting
    this.torches = [[65, 108], [75, 108], [65, 115], [75, 115], [70, 95], [70, 122]];
    // collect trees for canopy pass
    this.trees = [];
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++)
      if (this.t(x, y) === 6) this.trees.push({ tx: x, ty: y });
    // gather nodes: moonpetals in the forest, sunberry bushes in the meadow
    G.gatherNodes = [];
    const nodeSpots = [
      ...[[64, 55], [77, 48], [58, 70], [82, 74], [67, 42], [88, 58], [54, 46], [75, 82], [61, 80], [85, 44]].map(s => [s[0], s[1], 'moonpetal']),
      ...[[55, 95], [62, 101], [80, 96], [88, 102], [50, 100], [74, 100], [90, 95], [45, 96]].map(s => [s[0], s[1], 'sunberry']),
    ];
    for (const [px, py, item] of nodeSpots) {
      let x = px, y = py;
      for (let tries = 0; tries < 20 && this.blockedTile(x, y); tries++) { x = px + Math.floor(R() * 5) - 2; y = py + Math.floor(R() * 5) - 2; }
      if (!this.blockedTile(x, y)) G.gatherNodes.push({ x: x * TILE + 16, y: y * TILE + 16, item, taken: 0 });
    }
    this.buildMinimap();
  },

  blob(cx, cy, r, type, R, force) {
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++)
      for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
        if (dist(x, y, cx, cy) < r + (R ? R() * 0.8 : 0)) {
          if (force || this.t(x, y) !== 2) this.set(x, y, type);
        }
      }
  },
  ring(cx, cy, r, type, inner) {
    for (let a = 0; a < 64; a++) {
      const ang = a / 64 * Math.PI * 2;
      this.set(Math.round(cx + Math.cos(ang) * r), Math.round(cy + Math.sin(ang) * r * 0.85), type);
    }
    if (inner !== undefined) this.blob(cx, cy, r - 1, inner, null, true);
  },
  house(tx, ty, w, h) {
    for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) this.set(x, y, 7);
    this.houses.push({ tx, ty, w, h, hue: hash2(tx, ty) });
  },

  // ---------- rendering ----------
  tileColor(t, x, y) {
    const v = hash2(x, y) * 0.07 - 0.035;
    switch (t) {
      case 0: return shade('#5a8442', v);
      case 1: return shade('#9a7d4f', v);
      case 2: return '#2a5a8a';
      case 3: return shade('#c9b57a', v);
      case 4: return shade('#64626f', v);
      case 5: return shade('#3a3a44', v);
      case 6: return shade('#4a6e38', v);   // under-tree ground
      case 7: return '#4a3c2e';
      case 8: return shade('#3f6135', v);
      case 9: return shade('#6e6659', v);
      default: return '#000';
    }
  },

  draw(ctx, cam) {
    const x0 = Math.max(0, Math.floor(cam.x / TILE)), y0 = Math.max(0, Math.floor(cam.y / TILE));
    const x1 = Math.min(MAP_W - 1, Math.ceil((cam.x + G.W) / TILE)), y1 = Math.min(MAP_H - 1, Math.ceil((cam.y + G.H) / TILE));
    const time = G.time;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const t = this.t(tx, ty);
        const px = tx * TILE - cam.x, py = ty * TILE - cam.y;
        ctx.fillStyle = this.tileColor(t, tx, ty);
        ctx.fillRect(px, py, TILE + 1, TILE + 1);
        const h = hash2(tx, ty);
        // organic scalloped edges where paths meet grass
        if (t === 1) {
          for (let k = 0; k < 4; k++) {
            const nx = tx + NB4[k][0], ny = ty + NB4[k][1];
            const nt = this.t(nx, ny);
            if (nt !== 0 && nt !== 8 && nt !== 9) continue;
            ctx.fillStyle = this.tileColor(nt, nx, ny);
            for (let j = 0; j < 3; j++) {
              const hh = hash2(tx * 7 + k * 31 + j, ty * 11 + j * 5);
              const along = 4 + j * 11 + hh * 6;
              const cx = k < 2 ? px + along : (k === 2 ? px : px + TILE);
              const cy = k < 2 ? (k === 0 ? py : py + TILE) : py + along;
              ctx.beginPath(); ctx.arc(cx, cy, 2.5 + hh * 3, 0, 7); ctx.fill();
            }
          }
        }
        if (t === 0 || t === 8) {
          // grass tufts + flowers
          if (h < 0.22) {
            ctx.fillStyle = t === 0 ? '#4d7538' : '#35522c';
            const gx = px + (h * 97 % 1) * 24 + 4, gy = py + (h * 53 % 1) * 24 + 4;
            ctx.fillRect(gx, gy, 2, 5); ctx.fillRect(gx + 4, gy + 2, 2, 4);
          }
          if (h > 0.965) {
            ctx.fillStyle = ['#e8d06a', '#d87a9a', '#e8e8f0'][Math.floor(h * 300) % 3];
            ctx.beginPath(); ctx.arc(px + 16 + Math.sin(tx * 7) * 8, py + 16 + Math.cos(ty * 5) * 8, 2.4, 0, 7); ctx.fill();
          }
        } else if (t === 2) {
          // animated water
          const w = Math.sin(time * 1.6 + tx * 0.9 + ty * 1.3) * 0.5 + 0.5;
          ctx.fillStyle = `rgba(90,160,220,${0.10 + w * 0.13})`;
          ctx.fillRect(px, py, TILE + 1, TILE + 1);
          // foam scallops along shorelines
          for (let k = 0; k < 4; k++) {
            if (this.t(tx + NB4[k][0], ty + NB4[k][1]) === 2) continue;
            ctx.fillStyle = `rgba(225,242,255,${0.14 + w * 0.14})`;
            for (let j = 0; j < 3; j++) {
              const hh = hash2(tx * 5 + k * 17 + j, ty * 13 + j * 3);
              const along = 4 + j * 11 + hh * 6;
              const cx = k < 2 ? px + along : (k === 2 ? px : px + TILE);
              const cy = k < 2 ? (k === 0 ? py : py + TILE) : py + along;
              ctx.beginPath(); ctx.arc(cx, cy, 2 + hh * 2.5 + w, 0, 7); ctx.fill();
            }
          }
          if (h > 0.75) {
            ctx.strokeStyle = `rgba(220,240,255,${0.25 * w})`;
            ctx.beginPath(); ctx.moveTo(px + 5, py + 16 + w * 4); ctx.quadraticCurveTo(px + 16, py + 12 + w * 4, px + 27, py + 16 + w * 4); ctx.stroke();
          }
        } else if (t === 4) {
          if (h < 0.14) { ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(px + h * 60 % 20 + 4, py + h * 40 % 20 + 4, 5, 4); }
          if (h > 0.9) { ctx.fillStyle = 'rgba(255,140,60,.16)'; ctx.beginPath(); ctx.arc(px + 16, py + 16, 4, 0, 7); ctx.fill(); } // ember glints
        } else if (t === 5) {
          // rock: chunky boulder
          ctx.fillStyle = '#2e2e38'; ctx.fillRect(px, py, TILE, TILE);
          ctx.fillStyle = shade('#54545e', h * 0.16 - 0.08);
          ctx.beginPath(); ctx.moveTo(px + 3, py + TILE - 3); ctx.lineTo(px + 5, py + 8); ctx.lineTo(px + 16, py + 2);
          ctx.lineTo(px + 28, py + 9); ctx.lineTo(px + 29, py + TILE - 3); ctx.closePath(); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,.10)'; ctx.fillRect(px + 7, py + 7, 8, 3);
        } else if (t === 9) {
          if (h < 0.1) { ctx.fillStyle = 'rgba(30,25,22,.35)'; ctx.beginPath(); ctx.arc(px + 16, py + 16, 5, 0, 7); ctx.fill(); }
          if (h > 0.94) { // ember sparks on ground
            const fl = Math.sin(time * 3 + tx * 9) * 0.5 + 0.5;
            ctx.fillStyle = `rgba(255,120,50,${0.25 + fl * 0.3})`; ctx.fillRect(px + 14, py + 14, 3, 3);
          }
        } else if (t === 1) {
          if (h < 0.2) { ctx.fillStyle = 'rgba(0,0,0,.10)'; ctx.beginPath(); ctx.arc(px + 8 + h * 40 % 16, py + 8 + h * 30 % 16, 2.5, 0, 7); ctx.fill(); }
        } else if (t === 7) {
          ctx.fillStyle = '#3a2f24'; ctx.fillRect(px, py, TILE, TILE);
          ctx.fillStyle = shade('#5c4a36', h * 0.1 - 0.05);
          ctx.fillRect(px + 1, py + 1, TILE - 2, 14); ctx.fillRect(px + 1, py + 17, TILE - 2, 14);
          ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(px, py + 15, TILE, 2);
        } else if (t === 3) {
          if (h < 0.1) { ctx.fillStyle = 'rgba(120,100,60,.4)'; ctx.beginPath(); ctx.arc(px + 16, py + 16, 2, 0, 7); ctx.fill(); }
        } else if (t === 6) {
          // trunk (canopy drawn later, above entities)
          ctx.fillStyle = 'rgba(0,0,0,.28)';
          ctx.beginPath(); ctx.ellipse(px + 16, py + 26, 12, 5, 0, 0, 7); ctx.fill();
          ctx.fillStyle = '#4a3620'; ctx.fillRect(px + 12, py + 8, 8, 20);
          ctx.fillStyle = '#3a2a18'; ctx.fillRect(px + 12, py + 8, 3, 20);
        }
      }
    }
    // houses (bodies + roofs)
    for (const hs of this.houses) {
      const px = hs.tx * TILE - cam.x, py = hs.ty * TILE - cam.y;
      const w = hs.w * TILE, h = hs.h * TILE;
      if (px > G.W || py > G.H || px + w < 0 || py + h < 0) continue;
      // walls
      ctx.fillStyle = '#6e5a42'; ctx.fillRect(px, py + h * 0.35, w, h * 0.65);
      ctx.fillStyle = '#5a4834';
      for (let i = 0; i < 4; i++) ctx.fillRect(px, py + h * 0.35 + i * h * 0.16, w, 2);
      // door + window
      ctx.fillStyle = '#3a2a18'; ctx.fillRect(px + w / 2 - 8, py + h - 24, 16, 24);
      ctx.fillStyle = '#c9a227'; ctx.fillRect(px + w / 2 + 3, py + h - 14, 3, 3);
      const winGlow = (G.dayTime > 0.55 || G.dayTime < 0.12) ? '#ffd98a' : '#2a2a3a';
      ctx.fillStyle = winGlow; ctx.fillRect(px + 8, py + h * 0.5, 10, 10); ctx.fillRect(px + w - 18, py + h * 0.5, 10, 10);
      ctx.strokeStyle = '#3a2a18'; ctx.lineWidth = 2;
      ctx.strokeRect(px + 8, py + h * 0.5, 10, 10); ctx.strokeRect(px + w - 18, py + h * 0.5, 10, 10);
      // roof
      const rc = hs.hue < 0.5 ? '#8a4a3a' : '#7a5a8a';
      ctx.fillStyle = rc;
      ctx.beginPath(); ctx.moveTo(px - 6, py + h * 0.38); ctx.lineTo(px + w / 2, py - h * 0.18); ctx.lineTo(px + w + 6, py + h * 0.38); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      ctx.beginPath(); ctx.moveTo(px + w / 2, py - h * 0.18); ctx.lineTo(px + w + 6, py + h * 0.38); ctx.lineTo(px + w / 2 + 4, py + h * 0.38); ctx.closePath(); ctx.fill();
    }
    // torch posts
    for (const [tx, ty] of this.torches) {
      const px = tx * TILE - cam.x + 16, py = ty * TILE - cam.y + 16;
      if (px < -40 || py < -40 || px > G.W + 40 || py > G.H + 40) continue;
      ctx.fillStyle = '#4a3620'; ctx.fillRect(px - 2, py - 22, 4, 26);
      const fl = Math.sin(time * 9 + tx * 5) * 0.5 + 0.5;
      ctx.fillStyle = `rgba(255,${150 + fl * 60},40,.95)`;
      ctx.beginPath(); ctx.arc(px, py - 25, 4 + fl * 1.5, 0, 7); ctx.fill();
      ctx.fillStyle = `rgba(255,220,120,.9)`;
      ctx.beginPath(); ctx.arc(px, py - 26, 2, 0, 7); ctx.fill();
    }
  },

  drawCanopies(ctx, cam) {
    for (const tr of this.trees) {
      const px = tr.tx * TILE - cam.x + 16, py = tr.ty * TILE - cam.y + 8;
      if (px < -60 || py < -60 || px > G.W + 60 || py > G.H + 60) continue;
      const h = hash2(tr.tx, tr.ty);
      const sway = Math.sin(G.time * 1.2 + tr.tx * 1.7) * 1.6;
      const dark = tr.ty < 89 && tr.ty >= 38;
      const c1 = dark ? '#274a26' : '#2f6030', c2 = dark ? '#356035' : '#417f3c';
      ctx.fillStyle = c1;
      ctx.beginPath(); ctx.arc(px + sway, py, 15 + h * 4, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(px - 9 + sway, py + 5, 11, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(px + 9 + sway, py + 5, 11, 0, 7); ctx.fill();
      ctx.fillStyle = c2;
      ctx.beginPath(); ctx.arc(px - 3 + sway, py - 4, 9 + h * 3, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(px + 6 + sway, py - 1, 7, 0, 7); ctx.fill();
    }
  },

  buildMinimap() {
    const c = document.createElement('canvas');
    c.width = MAP_W; c.height = MAP_H;
    const x = c.getContext('2d');
    const cols = { 0: '#5a8442', 1: '#9a7d4f', 2: '#2a5a8a', 3: '#c9b57a', 4: '#5a5a66', 5: '#33333d', 6: '#2f5a2e', 7: '#4a3c2e', 8: '#3f6135', 9: '#6e6659' };
    for (let ty = 0; ty < MAP_H; ty++) for (let tx = 0; tx < MAP_W; tx++) {
      x.fillStyle = cols[this.t(tx, ty)] || '#000';
      x.fillRect(tx, ty, 1, 1);
    }
    this.minimapC = c;
  },
};

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) + Math.round(255 * amt), g = ((n >> 8) & 255) + Math.round(255 * amt), b = (n & 255) + Math.round(255 * amt);
  r = clamp(r, 0, 255); g = clamp(g, 0, 255); b = clamp(b, 0, 255);
  return `rgb(${r},${g},${b})`;
}
