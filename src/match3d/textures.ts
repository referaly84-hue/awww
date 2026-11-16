import * as THREE from 'three';
import type { SeasonKind } from './types';

export const PITCH_LEN = 105;
export const PITCH_WID = 68;
export const APRON_LEN = 128;
export const APRON_WID = 86;

export function makePitchTexture(
  maxAnisotropy: number,
  isWet = false,
  isSnow = false,
  season: SeasonKind = 'summer'
): THREE.CanvasTexture {
  const w = 2048;
  const h = 1360;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const mx = ((APRON_LEN - PITCH_LEN) / 2 / APRON_LEN) * w;
  const mz = ((APRON_WID - PITCH_WID) / 2 / APRON_WID) * h;
  const pw = w - mx * 2;
  const ph = h - mz * 2;

  const paletteBySeason: Record<SeasonKind, { apron: string; trim: string; even: string; odd: string }> = {
    summer: { apron: '#1f5b32', trim: '#184b29', even: '#28773f', odd: '#216435' },
    spring: { apron: '#246638', trim: '#1c532d', even: '#2f8246', odd: '#266d3a' },
    autumn: { apron: '#2a562f', trim: '#214725', even: '#356838', odd: '#2b572e' },
    winter: { apron: '#355f43', trim: '#2c5038', even: '#376a47', odd: '#2f5d3e' },
  };
  const pal = paletteBySeason[season] || paletteBySeason.summer;

  // Base apron grass
  ctx.fillStyle = isSnow ? '#d8e6f0' : isWet ? '#184727' : pal.apron;
  ctx.fillRect(0, 0, w, h);

  // Alternating mowed stripes across pitch length (18 crisp bands)
  const stripes = 18;
  const stripeW = pw / stripes;
  for (let i = 0; i < stripes; i++) {
    const even = i % 2 === 0;
    ctx.fillStyle = isSnow
      ? (even ? '#3f7250' : '#356344')
      : isWet
        ? (even ? '#1d5630' : '#174827')
        : (even ? pal.even : pal.odd);
    ctx.fillRect(mx + i * stripeW, mz - 12, stripeW + 1, ph + 24);
  }

  // Apron trim outside touchlines (covered with crisp frost/snow drifts when snowing or freezing winter)
  if (isSnow) {
    ctx.fillStyle = '#dde9f3';
    ctx.fillRect(0, 0, w, mz - 4);
    ctx.fillRect(0, h - mz + 4, w, mz);
    ctx.fillRect(0, mz - 4, mx - 4, ph + 8);
    ctx.fillRect(w - mx + 4, mz - 4, mx, ph + 8);
  } else {
    ctx.fillStyle = isWet ? '#153e22' : pal.trim;
    ctx.fillRect(0, 0, w, mz);
    ctx.fillRect(0, h - mz, w, mz);
    ctx.fillRect(0, mz, mx, ph);
    ctx.fillRect(w - mx, mz, mx, ph);
  }

  // Subtle turf blade grain & seasonal texture (autumn leaves speckle or snow patches)
  ctx.save();
  for (let i = 0; i < 6500; i++) {
    const gx = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const gy = (Math.sin(i * 78.233) * 24634.6345) % 1;
    const rx = Math.abs(gx) * w;
    const ry = Math.abs(gy) * h;
    if (isSnow && i % 3 === 0) {
      ctx.fillStyle = 'rgba(235, 246, 255, 0.16)';
      ctx.fillRect(rx, ry, 7, 4);
    } else if (season === 'autumn' && (rx < mx || rx > w - mx || ry < mz || ry > h - mz) && i % 11 === 0) {
      ctx.fillStyle = i % 22 === 0 ? 'rgba(217, 119, 6, 0.35)' : 'rgba(180, 83, 9, 0.28)';
      ctx.fillRect(rx, ry, 5, 4);
    } else {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.04)';
      ctx.fillRect(rx, ry, 3, 2);
    }
  }
  ctx.restore();

  // Crisp regulation chalk pitch markings (FIFA 105m x 68m)
  const pxPerM = pw / PITCH_LEN;
  const lineW = Math.max(3, 0.14 * pxPerM);
  ctx.strokeStyle = 'rgba(244, 249, 246, 0.94)';
  ctx.fillStyle = 'rgba(244, 249, 246, 0.94)';
  ctx.lineWidth = lineW;
  ctx.lineJoin = 'miter';

  ctx.strokeRect(mx, mz, pw, ph);

  const cx = mx + pw / 2;
  const cy = mz + ph / 2;
  ctx.beginPath();
  ctx.moveTo(cx, mz);
  ctx.lineTo(cx, mz + ph);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, 9.15 * pxPerM, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, 0.32 * pxPerM, 0, Math.PI * 2);
  ctx.fill();

  const penDepth = 16.5 * pxPerM;
  const penWid = 40.32 * pxPerM;
  const sixDepth = 5.5 * pxPerM;
  const sixWid = 18.32 * pxPerM;
  const penSpotDist = 11 * pxPerM;
  const arcR = 9.15 * pxPerM;
  const arcTheta = Math.acos((16.5 - 11) / 9.15);

  ctx.strokeRect(mx, cy - penWid / 2, penDepth, penWid);
  ctx.strokeRect(mx, cy - sixWid / 2, sixDepth, sixWid);
  ctx.beginPath();
  ctx.arc(mx + penSpotDist, cy, 0.24 * pxPerM, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(mx + penSpotDist, cy, arcR, -arcTheta, arcTheta);
  ctx.stroke();

  ctx.strokeRect(mx + pw - penDepth, cy - penWid / 2, penDepth, penWid);
  ctx.strokeRect(mx + pw - sixDepth, cy - sixWid / 2, sixDepth, sixWid);
  ctx.beginPath();
  ctx.arc(mx + pw - penSpotDist, cy, 0.24 * pxPerM, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(mx + pw - penSpotDist, cy, arcR, Math.PI - arcTheta, Math.PI + arcTheta);
  ctx.stroke();

  const cr = 1.2 * pxPerM;
  ctx.beginPath(); ctx.arc(mx, mz, cr, 0, Math.PI / 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(mx + pw, mz, cr, Math.PI / 2, Math.PI); ctx.stroke();
  ctx.beginPath(); ctx.arc(mx + pw, mz + ph, cr, Math.PI, Math.PI * 1.5); ctx.stroke();
  ctx.beginPath(); ctx.arc(mx, mz + ph, cr, Math.PI * 1.5, Math.PI * 2); ctx.stroke();

  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = Math.max(2, lineW * 0.65);
  ctx.strokeRect(cx - 18 * pxPerM, mz - 3.6 * pxPerM, 10 * pxPerM, 2.2 * pxPerM);
  ctx.strokeRect(cx + 8 * pxPerM, mz - 3.6 * pxPerM, 10 * pxPerM, 2.2 * pxPerM);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function makePitchRoughnessTexture(maxAnisotropy: number, isWet = false): THREE.CanvasTexture {
  const w = 512;
  const h = 340;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const stripes = 18;
  const sw = w / stripes;
  for (let i = 0; i < stripes; i++) {
    const val = isWet ? (i % 2 === 0 ? 92 : 120) : (i % 2 === 0 ? 185 : 210);
    ctx.fillStyle = `rgb(${val},${val},${val})`;
    ctx.fillRect(i * sw, 0, sw + 1, h);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function makeSkyGradientTexture(topHex: number, horizonHex: number, isNight: boolean): THREE.CanvasTexture {
  const w = 256;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const topCol = `#${topHex.toString(16).padStart(6, '0')}`;
  const horCol = `#${horizonHex.toString(16).padStart(6, '0')}`;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, topCol);
  grad.addColorStop(0.55, horCol);
  grad.addColorStop(1, horCol);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  if (isNight) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    for (let i = 0; i < 65; i++) {
      const sx = Math.abs(Math.sin(i * 45.17) * 43758.5) % 1;
      const sy = Math.abs(Math.cos(i * 91.73) * 19234.1) % 1;
      if (sy < 0.48) ctx.fillRect(sx * w, sy * h, 1.5, 1.5);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function makeBallTexture(maxAnisotropy: number, isWinterOrange = false): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = isWinterOrange ? '#fb923c' : '#f8fafc';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = isWinterOrange ? '#9a3412' : '#cbd5e1';
  ctx.lineWidth = 2;
  for (let x = 0; x < w; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 32, h);
    ctx.stroke();
  }

  const drawPatch = (cx: number, cy: number, r: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (i * Math.PI * 2) / 5 - Math.PI / 2;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  };

  const c1 = isWinterOrange ? '#0f172a' : '#111827';
  const c2 = isWinterOrange ? '#facc15' : '#1b5c3f';
  const patches: [number, number, string][] = [
    [64, 64, c1],
    [192, 64, c2],
    [320, 64, c1],
    [448, 64, c2],
    [128, 176, c1],
    [256, 176, isWinterOrange ? '#ffffff' : '#f0c419'],
    [384, 176, c1],
    [0, 176, c2],
    [512, 176, c2],
  ];
  for (const [x, y, col] of patches) drawPatch(x, y, 26, col);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function makeNetTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(245, 250, 252, 0.88)';
  ctx.lineWidth = 3;
  const step = 16;
  for (let i = 0; i <= size; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(size, i);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 3);
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function makeAdBoardTexture(
  homeName: string,
  awayName: string,
  compLabel: string,
  accentHex: string,
  maxAnisotropy: number,
  cityWeatherText?: string
): THREE.CanvasTexture {
  const w = 2048;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#091712';
  ctx.fillRect(0, 0, w, h);

  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, '#0d2f21');
  grad.addColorStop(0.25, accentHex || '#1b5c3f');
  grad.addColorStop(0.5, '#0d2f21');
  grad.addColorStop(0.75, '#f0c419');
  grad.addColorStop(1, '#0d2f21');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, 10);
  ctx.fillRect(0, h - 10, w, 10);

  ctx.font = '700 42px Onest, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  const segments = [
    cityWeatherText ? cityWeatherText.toUpperCase() : 'ВИРТ РПЛ · ПРЯМАЯ ТРАНСЛЯЦИЯ',
    `${homeName.toUpperCase()}  VS  ${awayName.toUpperCase()}`,
    compLabel ? compLabel.toUpperCase() : 'ЧЕМПИОНАТ РОССИИ',
    'ЧЕСТНАЯ ИГРА · FAIR PLAY'
  ];
  const segW = w / segments.length;
  segments.forEach((txt, idx) => {
    ctx.fillStyle = idx % 2 === 1 ? '#f0c419' : '#f1f8f4';
    ctx.fillText(txt, segW * idx + segW / 2, h / 2, segW - 40);
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function makeJerseyBackTexture(num: number, bgHex: string, textHex: string): THREE.CanvasTexture {
  const s = 128;
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = textHex;
  ctx.font = '800 66px Unbounded, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(num), s / 2, s / 2 + 4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function makePlayerLabelTexture(num: number, shortName: string, accentHex: string): THREE.CanvasTexture {
  const w = 320;
  const h = 72;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);

  const r = 10;
  const x = 14;
  const y = 10;
  const bw = w - 28;
  const bh = h - 20;
  ctx.fillStyle = 'rgba(8, 16, 13, 0.82)';
  ctx.beginPath();
  ctx.roundRect(x, y, bw, bh, r);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = accentHex;
  ctx.beginPath();
  ctx.roundRect(x + 2, y + 2, 10, bh - 4, [8, 0, 0, 8]);
  ctx.fill();

  ctx.fillStyle = '#f0c419';
  ctx.font = '800 24px Unbounded, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(String(num), x + 20, h / 2 + 1);

  ctx.fillStyle = '#ffffff';
  ctx.font = '600 25px Onest, system-ui, sans-serif';
  ctx.fillText(shortName.slice(0, 14), x + 64, h / 2 + 1, bw - 74);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
