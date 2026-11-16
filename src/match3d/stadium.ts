import * as THREE from 'three';
import {
  buildVolumetricFloodlightBeams,
  buildVolumetricGrassLayer,
  enhancePitchMaterialWithRtxShader,
} from './shaders';
import {
  APRON_LEN,
  APRON_WID,
  PITCH_LEN,
  PITCH_WID,
  makeAdBoardTexture,
  makeBallNormalTexture,
  makeBallTexture,
  makeNetTexture,
  makePitchNormalTexture,
  makePitchRoughnessTexture,
  makePitchTexture,
  makeSkyGradientTexture,
} from './textures';
import type { MatchPayload, ResolvedAtmosphere, SeasonKind, WeatherKind } from './types';

function inferSeasonFromDate(dateStr?: string, tempC?: number): SeasonKind {
  if (dateStr) {
    const m = dateStr.match(/^\d{4}-(\d{2})/);
    if (m) {
      const month = parseInt(m[1], 10);
      if (month === 12 || month <= 2) return 'winter';
      if (month <= 5) return 'spring';
      if (month <= 8) return 'summer';
      return 'autumn';
    }
  }
  if (tempC != null) {
    if (tempC <= 1) return 'winter';
    if (tempC <= 11) return 'autumn';
    if (tempC <= 18) return 'spring';
  }
  return 'summer';
}

export function resolveAtmosphere(m: MatchPayload): ResolvedAtmosphere {
  const f = m.fixture || ({} as MatchPayload['fixture']);
  const c = m.ctx || {};
  const wd = f.weatherDetails || c.weatherDetails || {};
  const wStr = String(c.weather || f.weather || wd.condition || '').toLowerCase();
  const timeStr = String(f.gameTime || '17:00');
  const hourRaw = parseInt(timeStr.split(':')[0] || '17', 10);
  const hour = Number.isFinite(hourRaw) ? hourRaw : 17;

  const isNight = hour >= 20 || hour < 7;
  const isSunset = !isNight && (hour >= 17 && hour <= 19);

  let weather: WeatherKind = 'clear';
  const rawKind = String(wd.weatherKind || '').toLowerCase();
  if (['clear', 'overcast', 'fog', 'rain', 'storm', 'snow', 'blizzard'].includes(rawKind)) {
    weather = rawKind as WeatherKind;
  } else if (wStr.includes('метел') || wStr.includes('вьюг') || wStr.includes('буран')) {
    weather = 'blizzard';
  } else if (wStr.includes('гроз') || wStr.includes('ливен')) {
    weather = 'storm';
  } else if (wStr.includes('снег') || wStr.includes('снеж')) {
    weather = 'snow';
  } else if (wStr.includes('дожд') || wStr.includes('морос')) {
    weather = 'rain';
  } else if (wStr.includes('туман') || wStr.includes('дымк')) {
    weather = 'fog';
  } else if (wStr.includes('пасмур') || wStr.includes('облач')) {
    weather = 'overcast';
  }

  const tempC = Number(wd.tempC ?? wd.temp ?? (weather === 'snow' || weather === 'blizzard' ? -4 : 15));
  const windMs = Number(wd.windMs ?? wd.wind ?? (weather === 'blizzard' || weather === 'storm' ? 7 : 3));

  const rawSeason = String(wd.season || '').toLowerCase();
  const season: SeasonKind = ['winter', 'spring', 'summer', 'autumn'].includes(rawSeason)
    ? (rawSeason as SeasonKind)
    : inferSeasonFromDate(f.gameDate || f.date, tempC);

  const city = f.city || (f.stadium ? f.stadium.split(',').pop()?.trim() : '') || 'Москва';
  const conditionLabel = String(wd.condition || (f.weather ? f.weather.split(',')[0] : '') || 'Ясно');

  let skyTopHex = 0x245da6;
  let skyHorizonHex = 0x8bc0ed;
  let fogColorHex = 0x8db6db;
  let sunColorHex = 0xfff7e2;
  let sunIntensity = 2.4;
  let floodlightIntensity = 0.5;
  let fogDensity = 0.0014;

  if (isNight) {
    skyTopHex = 0x040914;
    skyHorizonHex = weather === 'fog' ? 0x1b2b38 : weather === 'snow' || weather === 'blizzard' ? 0x1a283a : 0x0d1b30;
    fogColorHex = skyHorizonHex;
    sunColorHex = 0xc9dcff;
    sunIntensity = 0.55;
    floodlightIntensity = 2.85;
    fogDensity = weather === 'fog' ? 0.0082 : weather === 'blizzard' ? 0.006 : weather === 'rain' || weather === 'storm' ? 0.004 : 0.0021;
  } else if (isSunset) {
    skyTopHex = weather === 'rain' || weather === 'storm' || weather === 'overcast' ? 0x2b3a4d : 0x243e6b;
    skyHorizonHex = weather === 'rain' || weather === 'storm' ? 0x5c697a : season === 'winter' ? 0xa3b8cc : 0xdc8556;
    fogColorHex = skyHorizonHex;
    sunColorHex = weather === 'clear' ? 0xffbb73 : 0xd9e4f0;
    sunIntensity = weather === 'clear' ? 1.85 : 1.15;
    floodlightIntensity = 1.95;
    fogDensity = weather === 'fog' ? 0.0078 : weather === 'blizzard' ? 0.0056 : 0.0022;
  } else {
    if (weather === 'storm') {
      skyTopHex = 0x232d39;
      skyHorizonHex = 0x485869;
      sunIntensity = 1.0;
      floodlightIntensity = 2.1;
      fogDensity = 0.0044;
    } else if (weather === 'rain' || weather === 'overcast') {
      skyTopHex = 0x4b6073;
      skyHorizonHex = 0x7e92a3;
      sunIntensity = 1.3;
      floodlightIntensity = 1.4;
      fogDensity = weather === 'rain' ? 0.0038 : 0.0024;
    } else if (weather === 'fog') {
      skyTopHex = 0x8094a3;
      skyHorizonHex = 0xb8c8d4;
      sunIntensity = 1.05;
      floodlightIntensity = 1.5;
      fogDensity = 0.0086;
    } else if (weather === 'snow' || weather === 'blizzard') {
      skyTopHex = 0x6f8498;
      skyHorizonHex = 0xb6c6d4;
      sunIntensity = 1.25;
      floodlightIntensity = 1.55;
      fogDensity = weather === 'blizzard' ? 0.0064 : 0.0041;
    } else if (season === 'winter') {
      skyTopHex = 0x5584b8;
      skyHorizonHex = 0xc5daf0;
      sunColorHex = 0xfff5e4;
      sunIntensity = 2.0;
      fogDensity = 0.0018;
    } else if (season === 'autumn') {
      skyTopHex = 0x4573a6;
      skyHorizonHex = 0xb5c2c9;
      sunColorHex = 0xffdfad;
      sunIntensity = 2.0;
      fogDensity = 0.0022;
    }
    fogColorHex = skyHorizonHex;
  }

  return {
    isNight,
    isSunset,
    hour,
    season,
    weather,
    city,
    conditionLabel,
    tempC,
    windMs,
    skyTopHex,
    skyHorizonHex,
    fogColorHex,
    fogDensity,
    sunIntensity,
    sunColorHex,
    floodlightIntensity,
    hasLightning: weather === 'storm',
    useOrangeBall: weather === 'snow' || weather === 'blizzard',
  };
}

export interface StadiumRig {
  root: THREE.Group;
  ballMesh: THREE.Mesh;
  ballShadow: THREE.Mesh;
  adTexture: THREE.CanvasTexture;
  leftNetMesh: THREE.Mesh;
  rightNetMesh: THREE.Mesh;
  leftNetBasePos: Float32Array;
  rightNetBasePos: Float32Array;
  flagCloths: THREE.Mesh[];
  triggerGoalNet: (side: 'left' | 'right', strength?: number) => void;
  triggerConfetti: (side: 'left' | 'right', colorHex: string) => void;
  triggerTurfSpray: (x: number, z: number, dirX: number, dirZ: number, strength?: number) => void;
  update: (dt: number, elapsed: number, ballPos: THREE.Vector3, ballVel: THREE.Vector3, goalMood: number, ballQuat?: THREE.Quaternion) => void;
  dispose: () => void;
}

/**
 * Evaluates a continuous rounded-rectangle (superellipse-like stadium bowl) point & outward normal.
 */
function stadiumPerimeterPoint(
  t: number,
  halfStraightX: number,
  halfStraightZ: number,
  cornerRadius: number
): { x: number; z: number; nx: number; nz: number } {
  const segStraightX = halfStraightX * 2;
  const segStraightZ = halfStraightZ * 2;
  const segCorner = (Math.PI * cornerRadius) / 2;
  const totalLen = 2 * segStraightX + 2 * segStraightZ + 4 * segCorner;
  let d = (((t % 1) + 1) % 1) * totalLen;

  // 1. North straight (-Z side, moving -X -> +X)
  if (d < segStraightX) {
    return { x: -halfStraightX + d, z: -(halfStraightZ + cornerRadius), nx: 0, nz: -1 };
  }
  d -= segStraightX;

  // 2. NE corner
  if (d < segCorner) {
    const a = -Math.PI / 2 + (d / segCorner) * (Math.PI / 2);
    return {
      x: halfStraightX + Math.cos(a) * cornerRadius,
      z: -halfStraightZ + Math.sin(a) * cornerRadius,
      nx: Math.cos(a),
      nz: Math.sin(a),
    };
  }
  d -= segCorner;

  // 3. East straight (+X side, moving -Z -> +Z)
  if (d < segStraightZ) {
    return { x: halfStraightX + cornerRadius, z: -halfStraightZ + d, nx: 1, nz: 0 };
  }
  d -= segStraightZ;

  // 4. SE corner
  if (d < segCorner) {
    const a = (d / segCorner) * (Math.PI / 2);
    return {
      x: halfStraightX + Math.cos(a) * cornerRadius,
      z: halfStraightZ + Math.sin(a) * cornerRadius,
      nx: Math.cos(a),
      nz: Math.sin(a),
    };
  }
  d -= segCorner;

  // 5. South straight (+Z side, moving +X -> -X)
  if (d < segStraightX) {
    return { x: halfStraightX - d, z: halfStraightZ + cornerRadius, nx: 0, nz: 1 };
  }
  d -= segStraightX;

  // 6. SW corner
  if (d < segCorner) {
    const a = Math.PI / 2 + (d / segCorner) * (Math.PI / 2);
    return {
      x: -halfStraightX + Math.cos(a) * cornerRadius,
      z: halfStraightZ + Math.sin(a) * cornerRadius,
      nx: Math.cos(a),
      nz: Math.sin(a),
    };
  }
  d -= segCorner;

  // 7. West straight (-X side, moving +Z -> -Z)
  if (d < segStraightZ) {
    return { x: -(halfStraightX + cornerRadius), z: halfStraightZ - d, nx: -1, nz: 0 };
  }
  d -= segStraightZ;

  // 8. NW corner
  const a = Math.PI + (d / segCorner) * (Math.PI / 2);
  return {
    x: -halfStraightX + Math.cos(a) * cornerRadius,
    z: -halfStraightZ + Math.sin(a) * cornerRadius,
    nx: Math.cos(a),
    nz: Math.sin(a),
  };
}

/**
 * Builds a swept 3D stadium bowl ribbon from profile points [radialOffset, y].
 */
function buildSweptBowlGeometry(
  profile: [number, number][],
  steps = 96,
  halfStraightX = 48,
  halfStraightZ = 28,
  cornerRadius = 19
): THREE.BufferGeometry {
  const verts: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const stride = profile.length;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const pt = stadiumPerimeterPoint(t, halfStraightX, halfStraightZ, cornerRadius);
    for (let j = 0; j < stride; j++) {
      const [radOff, y] = profile[j];
      verts.push(pt.x + pt.nx * radOff, y, pt.z + pt.nz * radOff);
      uvs.push(t * 16, j / (stride - 1));
    }
  }

  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < stride - 1; j++) {
      const a = i * stride + j;
      const b = a + 1;
      const c = (i + 1) * stride + j;
      const d = c + 1;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function buildStadiumAndAtmosphere(
  scene: THREE.Scene,
  m: MatchPayload,
  atmo: ResolvedAtmosphere,
  maxAnisotropy: number,
  isSoftwareGl: boolean,
  homeHex: string,
  awayHex: string
): StadiumRig {
  const root = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  scene.background = new THREE.Color(atmo.fogColorHex);
  scene.fog = new THREE.FogExp2(atmo.fogColorHex, atmo.fogDensity);

  // Gradient Sky Dome
  const skyTex = track(makeSkyGradientTexture(atmo.skyTopHex, atmo.skyHorizonHex, atmo.isNight));
  const skyDome = new THREE.Mesh(
    track(new THREE.SphereGeometry(260, 28, 18)),
    track(new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }))
  );
  root.add(skyDome);

  // Sun or Moon celestial disc
  if (atmo.weather === 'clear' || atmo.weather === 'overcast') {
    const sunElev = atmo.isNight ? 52 : atmo.isSunset ? 18 : 72;
    const sunAzim = atmo.isNight ? -78 : atmo.isSunset ? -115 : 42;
    const celestial = new THREE.Mesh(
      track(new THREE.SphereGeometry(atmo.isNight ? 3.4 : 5.6, 16, 12)),
      track(new THREE.MeshBasicMaterial({
        color: atmo.isNight ? 0xe2e8f0 : atmo.isSunset ? 0xffbb6e : 0xfff8dc,
        fog: false,
      }))
    );
    celestial.position.set(sunAzim, sunElev, -155);
    root.add(celestial);
  }

  // Warm/Cool Studio Stadium Lighting Rig
  const hemi = new THREE.HemisphereLight(
    atmo.isNight ? 0x628bc2 : atmo.isSunset ? 0xf6ba8c : 0xcce6ff,
    atmo.season === 'winter' ? 0x26353a : atmo.isNight ? 0x102419 : 0x244d2b,
    atmo.isNight ? 0.92 : 1.15
  );
  root.add(hemi);

  const keyLight = new THREE.DirectionalLight(atmo.sunColorHex, atmo.sunIntensity);
  keyLight.position.set(atmo.isSunset ? -52 : 36, atmo.isSunset ? 28 : 62, 40);
  if (!isSoftwareGl) {
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.near = 12;
    keyLight.shadow.camera.far = 185;
    keyLight.shadow.camera.left = -64;
    keyLight.shadow.camera.right = 64;
    keyLight.shadow.camera.top = 48;
    keyLight.shadow.camera.bottom = -48;
    keyLight.shadow.bias = -0.0004;
    keyLight.shadow.normalBias = 0.025;
  }
  root.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xcce3ff, atmo.floodlightIntensity * 0.78);
  fillLight.position.set(-44, 48, -36);
  root.add(fillLight);

  if (atmo.floodlightIntensity > 0.85) {
    const floodPositions: [number, number][] = [
      [-64, -46],
      [64, -46],
      [-64, 46],
      [64, 46],
    ];
    for (const [fx, fz] of floodPositions) {
      const fl = new THREE.DirectionalLight(0xf8fbff, atmo.floodlightIntensity * 0.48);
      fl.position.set(fx, 44, fz);
      root.add(fl);
    }
  }

  const lightningLight = new THREE.DirectionalLight(0xdbeafe, 0);
  lightningLight.position.set(-20, 75, -50);
  root.add(lightningLight);

  // Outer Stadium Concourse & Surround Ground
  const isSnowGround = atmo.weather === 'snow' || atmo.weather === 'blizzard' || (atmo.season === 'winter' && atmo.tempC <= -3);
  const outerColor = isSnowGround
    ? 0xcbd8e3
    : atmo.isNight
      ? 0x0e171c
      : atmo.season === 'autumn'
        ? 0x3b3524
        : 0x1e3326;
  const outerGround = new THREE.Mesh(
    track(new THREE.PlaneGeometry(460, 460)),
    track(new THREE.MeshStandardMaterial({
      color: outerColor,
      roughness: isSnowGround ? 0.78 : 0.92,
      metalness: 0.04,
    }))
  );
  outerGround.rotation.x = -Math.PI / 2;
  outerGround.position.y = -0.08;
  root.add(outerGround);

  // RTX Pitch Material (MeshPhysicalMaterial + Grass Normal Map + Puddle/Ripple/Blade GLSL Shader)
  const isWet = atmo.weather === 'rain' || atmo.weather === 'storm';
  const isSnowPitch = atmo.weather === 'snow' || atmo.weather === 'blizzard';
  const pitchTex = track(makePitchTexture(maxAnisotropy, isWet, isSnowPitch, atmo.season));
  const roughTex = track(makePitchRoughnessTexture(maxAnisotropy, isWet));
  const pitchNormalTex = track(makePitchNormalTexture(maxAnisotropy));

  const pitchMat = track(new THREE.MeshPhysicalMaterial({
    map: pitchTex,
    roughnessMap: roughTex,
    normalMap: pitchNormalTex,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughness: isWet ? 0.34 : isSnowPitch ? 0.72 : 0.80,
    metalness: isWet ? 0.14 : 0.02,
    clearcoat: isWet ? 0.52 : 0.0,
    clearcoatRoughness: isWet ? 0.18 : 0.6,
    envMapIntensity: isWet ? 1.55 : 0.75,
  }));
  const pitchShaderUniforms = enhancePitchMaterialWithRtxShader(pitchMat, atmo);

  const pitchMesh = new THREE.Mesh(track(new THREE.PlaneGeometry(APRON_LEN, APRON_WID, 1, 1)), pitchMat);
  pitchMesh.rotation.x = -Math.PI / 2;
  pitchMesh.receiveShadow = !isSoftwareGl;
  root.add(pitchMesh);

  // Volumetric 3D Grass Blades Layer
  const grassLayer = buildVolumetricGrassLayer(atmo, isSoftwareGl);
  disposables.push(grassLayer);
  root.add(grassLayer.mesh);

  // Dark Track / Synthetic Pitch Surround
  const trackMat = track(new THREE.MeshStandardMaterial({
    color: isSnowGround ? 0x9aaaba : 0x162420,
    roughness: isWet ? 0.35 : 0.85,
    metalness: 0.08,
  }));
  const trackSurround = new THREE.Mesh(
    track(buildSweptBowlGeometry([[0, -0.02], [11, -0.02]], 72, 48, 28, 19)),
    trackMat
  );
  trackSurround.receiveShadow = !isSoftwareGl;
  root.add(trackSurround);

  // 3D Goals with Metallic Post Sheen
  const netTex = track(makeNetTexture(maxAnisotropy));
  const postMat = track(new THREE.MeshPhysicalMaterial({
    color: 0xf8fafc,
    roughness: 0.22,
    metalness: 0.55,
    clearcoat: 0.7,
    clearcoatRoughness: 0.12,
  }));
  const netMat = track(new THREE.MeshStandardMaterial({
    map: netTex,
    color: 0xffffff,
    transparent: true,
    opacity: 0.76,
    alphaTest: 0.15,
    side: THREE.DoubleSide,
    roughness: 0.85,
  }));

  const buildGoal = (dir: -1 | 1): { netMesh: THREE.Mesh; basePos: Float32Array } => {
    const g = new THREE.Group();
    const gx = dir * (PITCH_LEN / 2);
    const goalW = 7.32;
    const goalH = 2.44;
    const goalD = 2.25;
    const postR = 0.068;

    const postGeo = track(new THREE.CylinderGeometry(postR, postR, goalH, 14));
    for (const sz of [-goalW / 2, goalW / 2]) {
      const p = new THREE.Mesh(postGeo, postMat);
      p.position.set(gx, goalH / 2, sz);
      p.castShadow = !isSoftwareGl;
      g.add(p);
    }

    const barGeo = track(new THREE.CylinderGeometry(postR, postR, goalW + postR * 2, 14));
    const bar = new THREE.Mesh(barGeo, postMat);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(gx, goalH, 0);
    bar.castShadow = !isSoftwareGl;
    g.add(bar);

    const stanchionMat = track(new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.4, metalness: 0.6 }));
    const braceGeo = track(new THREE.CylinderGeometry(0.036, 0.036, goalD, 8));
    for (const sz of [-goalW / 2, goalW / 2]) {
      const topB = new THREE.Mesh(braceGeo, stanchionMat);
      topB.rotation.z = Math.PI / 2;
      topB.position.set(gx + dir * (goalD / 2), goalH, sz);
      g.add(topB);

      const botB = new THREE.Mesh(braceGeo, stanchionMat);
      botB.rotation.z = Math.PI / 2;
      botB.position.set(gx + dir * (goalD / 2), 0.04, sz);
      g.add(botB);

      const backPost = new THREE.Mesh(track(new THREE.CylinderGeometry(0.038, 0.038, goalH, 8)), stanchionMat);
      backPost.position.set(gx + dir * goalD, goalH / 2, sz);
      g.add(backPost);
    }

    const backNetGeo = track(new THREE.PlaneGeometry(goalW, goalH, 16, 7));
    const netMesh = new THREE.Mesh(backNetGeo, netMat);
    netMesh.position.set(gx + dir * goalD, goalH / 2, 0);
    netMesh.rotation.y = dir === 1 ? -Math.PI / 2 : Math.PI / 2;
    g.add(netMesh);

    const sideNetGeo = track(new THREE.PlaneGeometry(goalD, goalH, 4, 4));
    for (const sz of [-goalW / 2, goalW / 2]) {
      const sn = new THREE.Mesh(sideNetGeo, netMat);
      sn.position.set(gx + dir * (goalD / 2), goalH / 2, sz);
      g.add(sn);
    }
    const roofNetGeo = track(new THREE.PlaneGeometry(goalD, goalW, 4, 8));
    const rn = new THREE.Mesh(roofNetGeo, netMat);
    rn.rotation.x = Math.PI / 2;
    rn.position.set(gx + dir * (goalD / 2), goalH, 0);
    g.add(rn);

    root.add(g);
    const posAttr = backNetGeo.attributes.position as THREE.BufferAttribute;
    return { netMesh, basePos: new Float32Array(posAttr.array) };
  };

  const leftGoal = buildGoal(-1);
  const rightGoal = buildGoal(1);

  // Corner Flags
  const flagCloths: THREE.Mesh[] = [];
  const poleGeo = track(new THREE.CylinderGeometry(0.028, 0.028, 1.55, 8));
  const poleMat = track(new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 }));
  const flagGeo = track(new THREE.PlaneGeometry(0.48, 0.34, 4, 2));
  const flagMat = track(new THREE.MeshStandardMaterial({ color: 0xf0c419, side: THREE.DoubleSide, roughness: 0.7 }));
  for (const [cx, cz] of [
    [-PITCH_LEN / 2, -PITCH_WID / 2],
    [PITCH_LEN / 2, -PITCH_WID / 2],
    [-PITCH_LEN / 2, PITCH_WID / 2],
    [PITCH_LEN / 2, PITCH_WID / 2],
  ]) {
    const fg = new THREE.Group();
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = 0.775;
    fg.add(pole);
    const cloth = new THREE.Mesh(flagGeo, flagMat);
    cloth.position.set(0.24, 1.38, 0);
    fg.add(cloth);
    fg.position.set(cx, 0, cz);
    root.add(fg);
    flagCloths.push(cloth);
  }

  // HDR Illuminated Perimeter LED Advertising Boards
  const compLabel = m.ctx?.comp || m.fixture.label || 'ВИРТ РПЛ';
  const tempBadge = `${atmo.tempC > 0 ? '+' : ''}${atmo.tempC}°C`;
  const cityWeatherText = `${atmo.city} · ${tempBadge} · ${atmo.conditionLabel}`;
  const adTexture = track(makeAdBoardTexture(m.fixture.homeName, m.fixture.awayName, compLabel, homeHex, maxAnisotropy, cityWeatherText));
  const adMat = track(new THREE.MeshStandardMaterial({
    map: adTexture,
    emissive: new THREE.Color(0xffffff),
    emissiveMap: adTexture,
    emissiveIntensity: atmo.isNight || atmo.isSunset ? 1.15 : 0.45,
    roughness: 0.3,
    metalness: 0.1,
  }));
  const adBackMat = track(new THREE.MeshStandardMaterial({ color: 0x0b1210, roughness: 0.7 }));

  const addLedWall = (len: number, x: number, z: number, rotY: number) => {
    const grp = new THREE.Group();
    const face = new THREE.Mesh(track(new THREE.PlaneGeometry(len, 1.08)), adMat);
    face.position.set(0, 0.54, 0.09);
    grp.add(face);
    const back = new THREE.Mesh(track(new THREE.BoxGeometry(len, 1.08, 0.14)), adBackMat);
    back.position.set(0, 0.54, 0);
    grp.add(back);
    grp.position.set(x, 0, z);
    grp.rotation.y = rotY;
    root.add(grp);
  };
  addLedWall(110, 0, -(PITCH_WID / 2 + 4.4), 0);
  addLedWall(110, 0, PITCH_WID / 2 + 4.4, Math.PI);
  addLedWall(72, -(PITCH_LEN / 2 + 5.2), 0, Math.PI / 2);
  addLedWall(72, PITCH_LEN / 2 + 5.2, 0, -Math.PI / 2);

  // Architectural Glass Team Dugouts + Player Tunnel
  const buildDugout = (xCenter: number, accentHex: string) => {
    const dg = new THREE.Group();
    const benchMat = track(new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.55 }));
    const glassMat = track(new THREE.MeshPhysicalMaterial({
      color: 0xd8eefc,
      transparent: true,
      opacity: 0.36,
      roughness: 0.08,
      metalness: 0.1,
      clearcoat: 1.0,
    }));
    const accentMat = track(new THREE.MeshStandardMaterial({ color: accentHex, roughness: 0.45 }));

    const base = new THREE.Mesh(track(new THREE.BoxGeometry(8.8, 0.52, 1.25)), benchMat);
    base.position.set(0, 0.26, 0);
    dg.add(base);

    // Individual bucket seats in dugout
    const seatGeo = track(new THREE.BoxGeometry(0.55, 0.72, 0.5));
    for (let si = -3; si <= 3; si++) {
      const seat = new THREE.Mesh(seatGeo, accentMat);
      seat.position.set(si * 1.08, 0.85, -0.1);
      dg.add(seat);
    }

    const canopy = new THREE.Mesh(track(new THREE.BoxGeometry(9.2, 0.08, 1.85)), glassMat);
    canopy.position.set(0, 2.28, 0.15);
    canopy.rotation.x = 0.14;
    dg.add(canopy);

    const backWall = new THREE.Mesh(track(new THREE.BoxGeometry(8.9, 1.85, 0.08)), glassMat);
    backWall.position.set(0, 1.32, -0.6);
    dg.add(backWall);

    const stripe = new THREE.Mesh(track(new THREE.BoxGeometry(8.9, 0.24, 0.12)), accentMat);
    stripe.position.set(0, 2.22, -0.6);
    dg.add(stripe);

    dg.position.set(xCenter, 0, -(PITCH_WID / 2 + 2.8));
    root.add(dg);
  };
  buildDugout(-13, homeHex);
  buildDugout(13, awayHex);

  // Player Tunnel Hood at center North touchline
  const tunnelHood = new THREE.Mesh(
    track(new THREE.CylinderGeometry(2.1, 2.1, 4.6, 12, 1, false, 0, Math.PI)),
    track(new THREE.MeshStandardMaterial({ color: homeHex, roughness: 0.55, side: THREE.DoubleSide }))
  );
  tunnelHood.rotation.z = Math.PI / 2;
  tunnelHood.rotation.y = Math.PI / 2;
  tunnelHood.position.set(0, 0.6, -(PITCH_WID / 2 + 7.2));
  root.add(tunnelHood);

  // Touchline Broadcast Camera Crew & Goal-Line Photographers
  const camPodGeo = track(new THREE.BoxGeometry(0.65, 0.95, 0.55));
  const camLensGeo = track(new THREE.CylinderGeometry(0.11, 0.14, 0.52, 10));
  const camMat = track(new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.35, metalness: 0.65 }));
  const lensMat = track(new THREE.MeshPhysicalMaterial({ color: 0x1e293b, roughness: 0.08, metalness: 0.9, clearcoat: 1.0 }));
  for (const [cx, cz, ry] of [
    [-22, -(PITCH_WID / 2 + 6.2), 0],
    [22, -(PITCH_WID / 2 + 6.2), 0],
    [-(PITCH_LEN / 2 + 4.2), -9, Math.PI / 2],
    [-(PITCH_LEN / 2 + 4.2), 9, Math.PI / 2],
    [PITCH_LEN / 2 + 4.2, -9, -Math.PI / 2],
    [PITCH_LEN / 2 + 4.2, 9, -Math.PI / 2],
  ] as [number, number, number][]) {
    const pod = new THREE.Group();
    const stand = new THREE.Mesh(camPodGeo, camMat);
    stand.position.y = 0.48;
    pod.add(stand);
    const lens = new THREE.Mesh(camLensGeo, lensMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 1.05, 0.22);
    pod.add(lens);
    pod.position.set(cx, 0, cz);
    pod.rotation.y = ry;
    root.add(pod);
  }

  // CLOSED 360° EUROPEAN STADIUM BOWL (Swept Superellipse Tiers + Concourse + Cantilever Roof + Glowing Inner LED Halo)
  const bowlConcreteMat = track(new THREE.MeshStandardMaterial({ color: 0x1c262e, roughness: 0.86, metalness: 0.08 }));
  const roofOuterMat = track(new THREE.MeshStandardMaterial({
    color: isSnowGround ? 0xc8d6e2 : 0x222f38,
    roughness: isSnowGround ? 0.65 : 0.45,
    metalness: isSnowGround ? 0.15 : 0.55,
    side: THREE.DoubleSide,
  }));
  const roofUnderMat = track(new THREE.MeshStandardMaterial({
    color: 0x151e26,
    roughness: 0.62,
    metalness: 0.35,
    side: THREE.DoubleSide,
  }));
  const fasciaClubMat = track(new THREE.MeshStandardMaterial({
    color: homeHex,
    emissive: new THREE.Color(homeHex),
    emissiveIntensity: atmo.isNight || atmo.isSunset ? 0.55 : 0.15,
    roughness: 0.35,
  }));
  const haloLightMat = track(new THREE.MeshBasicMaterial({
    color: atmo.isNight ? 0xf5faff : atmo.isSunset ? 0xffe4bd : 0xe2e8f0,
    side: THREE.DoubleSide,
  }));
  const trussMat = track(new THREE.MeshStandardMaterial({ color: 0x4b5c6e, roughness: 0.4, metalness: 0.72 }));

  // Lower tier + concourse wall + upper tier + exterior shell
  const bowlProfile: [number, number][] = [
    [9.2, 0.0],
    [9.2, 1.5],     // pitchside wall
    [16.8, 6.2],    // lower tier slope
    [18.2, 6.2],    // mid concourse walkway
    [18.2, 8.2],    // upper tier fascia
    [28.5, 16.8],   // upper tier top
    [30.5, 18.2],   // back wall top
    [31.5, 0.0],    // exterior facade base
  ];
  const bowlMesh = new THREE.Mesh(track(buildSweptBowlGeometry(bowlProfile, 108)), bowlConcreteMat);
  bowlMesh.receiveShadow = !isSoftwareGl;
  root.add(bowlMesh);

  // Sweeping Cantilever Stadium Roof Canopy
  const roofProfile: [number, number][] = [
    [11.5, 18.6],  // inner roof lip overlooking touchline
    [22.0, 20.6],  // mid arch camber
    [32.0, 18.4],  // outer overhang
  ];
  const roofMesh = new THREE.Mesh(track(buildSweptBowlGeometry(roofProfile, 108)), roofOuterMat);
  root.add(roofMesh);

  const roofUnderMesh = new THREE.Mesh(
    track(buildSweptBowlGeometry([[11.6, 18.35], [31.5, 18.25]], 108)),
    roofUnderMat
  );
  root.add(roofUnderMesh);

  // Club Color Ribbon Along Mid-Concourse & Inner Roof Halo Light Bar
  const concourseRibbon = new THREE.Mesh(
    track(buildSweptBowlGeometry([[18.1, 6.3], [18.1, 8.0]], 96)),
    fasciaClubMat
  );
  root.add(concourseRibbon);

  const roofLightHalo = new THREE.Mesh(
    track(buildSweptBowlGeometry([[12.2, 18.28], [13.1, 18.28]], 96)),
    haloLightMat
  );
  root.add(roofLightHalo);

  // Structural Roof Columns & Cantilever Trusses around the 360° Bowl
  const pillarGeo = track(new THREE.CylinderGeometry(0.32, 0.42, 18.5, 8));
  const ribGeo = track(new THREE.BoxGeometry(0.45, 0.7, 20.5));
  const ribCount = 28;
  for (let i = 0; i < ribCount; i++) {
    const t = i / ribCount;
    const pt = stadiumPerimeterPoint(t, 48, 28, 19);
    const angle = Math.atan2(pt.nx, pt.nz);

    const pillar = new THREE.Mesh(pillarGeo, trussMat);
    pillar.position.set(pt.x + pt.nx * 30.2, 9.25, pt.z + pt.nz * 30.2);
    root.add(pillar);

    const rib = new THREE.Mesh(ribGeo, trussMat);
    rib.position.set(pt.x + pt.nx * 21.5, 19.6, pt.z + pt.nz * 21.5);
    rib.rotation.y = angle;
    root.add(rib);
  }

  // Instanced Stadium Bucket Seats across Both Tiers (2,200 seats)
  const seatCount = isSoftwareGl ? 900 : 2200;
  const seatGeo = track(new THREE.BoxGeometry(0.56, 0.52, 0.46));
  const seatMat = track(new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.1 }));
  const seatMesh = new THREE.InstancedMesh(seatGeo, seatMat, seatCount);
  const dummy = new THREE.Object3D();
  const seatPal = [
    new THREE.Color(homeHex),
    new THREE.Color(homeHex).lerp(new THREE.Color(0x0f172a), 0.35),
    new THREE.Color(0x1e293b),
    new THREE.Color(awayHex),
  ];

  for (let i = 0; i < seatCount; i++) {
    const t = (i / seatCount) + ((i % 7) * 0.0003);
    const tierRow = (i * 11) % 16; // 0..7 lower tier, 8..15 upper tier
    const isUpper = tierRow >= 8;
    const rowLocal = isUpper ? tierRow - 8 : tierRow;
    const radOff = isUpper ? 18.8 + (rowLocal / 7) * 9.2 : 9.8 + (rowLocal / 7) * 6.6;
    const y = isUpper ? 8.55 + (rowLocal / 7) * 8.1 : 1.75 + (rowLocal / 7) * 4.4;
    const pt = stadiumPerimeterPoint(t, 48, 28, 19);

    dummy.position.set(pt.x + pt.nx * radOff, y, pt.z + pt.nz * radOff);
    dummy.rotation.set(0, Math.atan2(-pt.nx, -pt.nz), 0);
    dummy.updateMatrix();
    seatMesh.setMatrixAt(i, dummy.matrix);

    // Away sector near East corner (t around 0.25..0.38)
    const isAwayZone = t > 0.28 && t < 0.38 && !isUpper;
    const sc = isAwayZone ? seatPal[3] : (rowLocal % 4 === 0 ? seatPal[1] : seatPal[0]);
    seatMesh.setColorAt(i, sc);
  }
  seatMesh.instanceMatrix.needsUpdate = true;
  if (seatMesh.instanceColor) seatMesh.instanceColor.needsUpdate = true;
  root.add(seatMesh);

  // Corner Giant 4K Jumbotrons
  for (const [jx, jz, jry] of [
    [66, -34, -Math.PI * 0.68],
    [-66, 34, Math.PI * 0.32],
  ] as [number, number, number][]) {
    const jFrame = new THREE.Mesh(track(new THREE.BoxGeometry(11.6, 5.6, 0.7)), trussMat);
    jFrame.position.set(jx, 15.8, jz);
    jFrame.rotation.y = jry;
    root.add(jFrame);

    const jScreen = new THREE.Mesh(track(new THREE.PlaneGeometry(10.8, 4.9)), adMat);
    jScreen.position.set(jx, 15.8, jz);
    jScreen.rotation.y = jry;
    jScreen.translateZ(0.42);
    root.add(jScreen);
  }

  // 4 High Stadium Floodlight Masts + Volumetric Atmospheric God-Ray Shafts
  const pylonGeo = track(new THREE.CylinderGeometry(0.42, 0.88, 36, 10));
  const lampHeadMat = track(new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.65 }));
  const lampsActive = atmo.floodlightIntensity > 0.9;
  const lampGlowMat = track(new THREE.MeshBasicMaterial({
    color: lampsActive ? 0xffffff : 0xcbd5e1,
  }));
  for (const [tx, tz] of [
    [-68, -48],
    [68, -48],
    [-68, 48],
    [68, 48],
  ]) {
    const tower = new THREE.Group();
    const mast = new THREE.Mesh(pylonGeo, trussMat);
    mast.position.y = 18;
    tower.add(mast);

    const head = new THREE.Mesh(track(new THREE.BoxGeometry(6.4, 3.8, 0.8)), lampHeadMat);
    head.position.set(0, 36.2, 0);
    head.lookAt(-tx, 0, -tz);
    tower.add(head);

    const glow = new THREE.Mesh(track(new THREE.PlaneGeometry(5.8, 3.2)), lampGlowMat);
    glow.position.set(0, 0, 0.43);
    head.add(glow);

    tower.position.set(tx, 0, tz);
    root.add(tower);
  }

  const volBeams = buildVolumetricFloodlightBeams(atmo);
  disposables.push(volBeams);
  root.add(volBeams.group);

  // Instanced Animated Spectators across the 360° Bowl
  const crowdCount = isSoftwareGl ? 750 : 1800;
  const specGeo = track(new THREE.CapsuleGeometry(0.21, 0.42, 4, 6));
  const specMat = track(new THREE.MeshStandardMaterial({ roughness: 0.76, metalness: 0.04 }));
  const crowdMesh = new THREE.InstancedMesh(specGeo, specMat, crowdCount);
  crowdMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  crowdMesh.frustumCulled = false;

  const crowdBasePositions: { x: number; y: number; z: number; yaw: number; phase: number }[] = [];
  const palette = [
    new THREE.Color(homeHex),
    new THREE.Color(homeHex).lerp(new THREE.Color(0xffffff), 0.35),
    new THREE.Color(awayHex),
    new THREE.Color('#e2e8f0'),
    new THREE.Color('#1e293b'),
    new THREE.Color('#f0c419'),
  ];

  for (let i = 0; i < crowdCount; i++) {
    const randU = ((Math.sin(i * 19.31) * 43758.5453) % 1 + 1) % 1;
    const t = (i / crowdCount + randU * 0.02) % 1;
    const tierRow = (i * 13) % 16;
    const isUpper = tierRow >= 8;
    const rowLocal = isUpper ? tierRow - 8 : tierRow;
    const radOff = (isUpper ? 18.9 + (rowLocal / 7) * 9.0 : 9.9 + (rowLocal / 7) * 6.4);
    const tierY = (isUpper ? 8.85 + (rowLocal / 7) * 8.1 : 2.05 + (rowLocal / 7) * 4.4);
    const pt = stadiumPerimeterPoint(t, 48, 28, 19);
    const sx = pt.x + pt.nx * radOff;
    const sz = pt.z + pt.nz * radOff;
    const yaw = Math.atan2(-pt.nx, -pt.nz);

    crowdBasePositions.push({ x: sx, y: tierY, z: sz, yaw, phase: (i * 0.73) % (Math.PI * 2) });
    dummy.position.set(sx, tierY, sz);
    dummy.rotation.set(0, yaw, 0);
    dummy.updateMatrix();
    crowdMesh.setMatrixAt(i, dummy.matrix);

    const isAwayZone = t > 0.28 && t < 0.38 && !isUpper;
    const col = isAwayZone
      ? palette[2]
      : palette[i % 5 === 0 ? 0 : i % 7 === 0 ? 5 : i % 3 === 0 ? 1 : (i % 2 === 0 ? 3 : 4)];
    crowdMesh.setColorAt(i, col);
  }
  crowdMesh.instanceMatrix.needsUpdate = true;
  if (crowdMesh.instanceColor) crowdMesh.instanceColor.needsUpdate = true;
  root.add(crowdMesh);

  // Match Football with Clearcoat + Normal Map Seams
  const ballTex = track(makeBallTexture(maxAnisotropy, atmo.useOrangeBall));
  const ballNorm = track(makeBallNormalTexture(maxAnisotropy));
  const ballGeo = track(new THREE.SphereGeometry(0.22, 28, 20));
  const ballMat = track(new THREE.MeshPhysicalMaterial({
    map: ballTex,
    normalMap: ballNorm,
    normalScale: new THREE.Vector2(0.45, 0.45),
    roughness: isWet ? 0.18 : 0.30,
    metalness: 0.05,
    clearcoat: isWet ? 0.9 : 0.55,
    clearcoatRoughness: isWet ? 0.1 : 0.24,
  }));
  const ballMesh = new THREE.Mesh(ballGeo, ballMat);
  ballMesh.castShadow = !isSoftwareGl;
  ballMesh.position.set(0, 0.22, 0);
  root.add(ballMesh);

  const ballShadowGeo = track(new THREE.CircleGeometry(0.36, 16));
  const ballShadowMat = track(new THREE.MeshBasicMaterial({
    color: 0x050a07,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  }));
  const ballShadow = new THREE.Mesh(ballShadowGeo, ballShadowMat);
  ballShadow.rotation.x = -Math.PI / 2;
  ballShadow.position.set(0, 0.02, 0);
  root.add(ballShadow);

  // Dynamic Weather Precipitation (Rain / Storm / Snow / Blizzard)
  let weatherPoints: THREE.Points | null = null;
  let weatherPosAttr: THREE.BufferAttribute | null = null;
  const isPrecipRain = atmo.weather === 'rain' || atmo.weather === 'storm';
  const isPrecipSnow = atmo.weather === 'snow' || atmo.weather === 'blizzard';
  const weatherCount = isPrecipRain
    ? (atmo.weather === 'storm' ? (isSoftwareGl ? 900 : 2100) : (isSoftwareGl ? 600 : 1400))
    : isPrecipSnow
      ? (atmo.weather === 'blizzard' ? (isSoftwareGl ? 850 : 1900) : (isSoftwareGl ? 480 : 1050))
      : 0;

  if (weatherCount > 0) {
    const arr = new Float32Array(weatherCount * 3);
    for (let i = 0; i < weatherCount; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 145;
      arr[i * 3 + 1] = Math.random() * 36;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 100;
    }
    const wGeo = track(new THREE.BufferGeometry());
    weatherPosAttr = new THREE.BufferAttribute(arr, 3);
    weatherPosAttr.setUsage(THREE.DynamicDrawUsage);
    wGeo.setAttribute('position', weatherPosAttr);
    const wMat = track(new THREE.PointsMaterial({
      color: isPrecipSnow ? 0xf8fafc : 0xbce0fa,
      size: atmo.weather === 'blizzard' ? 0.42 : isPrecipSnow ? 0.34 : atmo.weather === 'storm' ? 0.25 : 0.20,
      transparent: true,
      opacity: isPrecipSnow ? 0.85 : 0.58,
      depthWrite: false,
    }));
    weatherPoints = new THREE.Points(wGeo, wMat);
    root.add(weatherPoints);
  }

  // Kick / Tackle Turf & Water/Snow Spray Particles
  const sprayCount = 48;
  const sprayArr = new Float32Array(sprayCount * 3);
  const sprayVel = new Float32Array(sprayCount * 3);
  const sprayLife = new Float32Array(sprayCount);
  const sprayGeo = track(new THREE.BufferGeometry());
  const sprayAttr = new THREE.BufferAttribute(sprayArr, 3);
  sprayAttr.setUsage(THREE.DynamicDrawUsage);
  sprayGeo.setAttribute('position', sprayAttr);
  const sprayMat = track(new THREE.PointsMaterial({
    color: isSnowPitch ? 0xf1f5f9 : isWet ? 0xcbe8ff : 0x4d7c38,
    size: isWet ? 0.22 : 0.19,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
  }));
  const sprayPoints = new THREE.Points(sprayGeo, sprayMat);
  sprayPoints.frustumCulled = false;
  root.add(sprayPoints);
  let sprayCursor = 0;

  const triggerTurfSpray = (x: number, z: number, dirX: number, dirZ: number, strength = 1.0) => {
    const n = Math.min(20, Math.round(10 * strength));
    for (let i = 0; i < n; i++) {
      const idx = sprayCursor % sprayCount;
      sprayCursor++;
      sprayArr[idx * 3] = x + (Math.random() - 0.5) * 0.4;
      sprayArr[idx * 3 + 1] = 0.08 + Math.random() * 0.12;
      sprayArr[idx * 3 + 2] = z + (Math.random() - 0.5) * 0.4;
      sprayVel[idx * 3] = -dirX * (1.2 + Math.random() * 2.8) + (Math.random() - 0.5) * 2.2;
      sprayVel[idx * 3 + 1] = (1.6 + Math.random() * 2.6) * strength;
      sprayVel[idx * 3 + 2] = -dirZ * (1.2 + Math.random() * 2.8) + (Math.random() - 0.5) * 2.2;
      sprayLife[idx] = 0.45 + Math.random() * 0.3;
    }
    sprayAttr.needsUpdate = true;
  };

  // Goal Confetti Burst
  const confettiCount = 110;
  const confArr = new Float32Array(confettiCount * 3);
  const confVel = new Float32Array(confettiCount * 3);
  const confGeo = track(new THREE.BufferGeometry());
  const confAttr = new THREE.BufferAttribute(confArr, 3);
  confAttr.setUsage(THREE.DynamicDrawUsage);
  confGeo.setAttribute('position', confAttr);
  const confMat = track(new THREE.PointsMaterial({
    color: 0xf0c419,
    size: 0.48,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  }));
  const confPoints = new THREE.Points(confGeo, confMat);
  confPoints.visible = false;
  root.add(confPoints);

  let confettiTimer = 0;
  let leftNetWave = 0;
  let rightNetWave = 0;
  let nextLightningAt = 3.5;
  let lightningPulse = 0;

  const triggerGoalNet = (side: 'left' | 'right', strength = 1.0) => {
    if (side === 'left') leftNetWave = Math.max(leftNetWave, strength);
    else rightNetWave = Math.max(rightNetWave, strength);
  };

  const triggerConfetti = (side: 'left' | 'right', colorHex: string) => {
    const gx = side === 'left' ? -56 : 56;
    confMat.color.set(colorHex || '#f0c419');
    confMat.opacity = 0.95;
    confPoints.visible = true;
    confettiTimer = 3.0;
    for (let i = 0; i < confettiCount; i++) {
      confArr[i * 3] = gx + (Math.random() - 0.5) * 4;
      confArr[i * 3 + 1] = 0.8 + Math.random() * 1.4;
      confArr[i * 3 + 2] = (Math.random() - 0.5) * 12;
      confVel[i * 3] = (Math.random() - 0.5) * 5;
      confVel[i * 3 + 1] = 6 + Math.random() * 8;
      confVel[i * 3 + 2] = (Math.random() - 0.5) * 8;
    }
    confAttr.needsUpdate = true;
  };

  const updateNet = (mesh: THREE.Mesh, base: Float32Array, wave: number, elapsed: number) => {
    const attr = mesh.geometry.attributes.position as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const bx = base[i];
      const by = base[i + 1];
      const bz = base[i + 2];
      arr[i] = bx;
      arr[i + 1] = by;
      arr[i + 2] = bz + wave * 0.55 * Math.sin(elapsed * 18 + bx * 0.9 + by * 1.2);
    }
    attr.needsUpdate = true;
  };

  const update = (
    dt: number,
    elapsed: number,
    ballPos: THREE.Vector3,
    ballVel: THREE.Vector3,
    goalMood: number,
    ballQuat?: THREE.Quaternion
  ) => {
    pitchShaderUniforms.uTime.value = elapsed;
    grassLayer.update(elapsed);
    volBeams.update(elapsed);

    ballMesh.position.copy(ballPos);
    if (ballQuat) {
      ballMesh.quaternion.copy(ballQuat);
    } else {
      const speed = Math.hypot(ballVel.x, ballVel.z);
      if (speed > 0.05) {
        ballMesh.rotation.z -= (ballVel.x * dt) / 0.22;
        ballMesh.rotation.x += (ballVel.z * dt) / 0.22;
      }
    }
    ballShadow.position.set(ballPos.x, 0.02, ballPos.z);
    const hRatio = Math.max(0.35, 1 - Math.max(0, ballPos.y - 0.22) * 0.09);
    ballShadow.scale.setScalar(hRatio);
    ballShadowMat.opacity = 0.42 * hRatio;

    adTexture.offset.x = (elapsed * 0.045) % 1;

    const windMul = 1 + Math.min(2.6, atmo.windMs * 0.18);
    for (let i = 0; i < flagCloths.length; i++) {
      flagCloths[i].rotation.y = Math.sin(elapsed * 4.2 * windMul + i) * Math.min(0.45, 0.18 + atmo.windMs * 0.035);
    }

    if (leftNetWave > 0.01) {
      leftNetWave = Math.max(0, leftNetWave - dt * 1.15);
      updateNet(leftGoal.netMesh, leftGoal.basePos, leftNetWave, elapsed);
    }
    if (rightNetWave > 0.01) {
      rightNetWave = Math.max(0, rightNetWave - dt * 1.15);
      updateNet(rightGoal.netMesh, rightGoal.basePos, rightNetWave, elapsed);
    }

    const jumpAmp = 0.06 + goalMood * 0.42;
    const jumpFreq = 2.4 + goalMood * 7.8;
    for (let i = 0; i < crowdCount; i++) {
      const b = crowdBasePositions[i];
      dummy.position.set(b.x, b.y + Math.abs(Math.sin(elapsed * jumpFreq + b.phase)) * jumpAmp, b.z);
      dummy.rotation.set(0, b.yaw, 0);
      dummy.updateMatrix();
      crowdMesh.setMatrixAt(i, dummy.matrix);
    }
    crowdMesh.instanceMatrix.needsUpdate = true;

    // Turf/Water/Snow spray update
    let sprayDirty = false;
    for (let i = 0; i < sprayCount; i++) {
      if (sprayLife[i] > 0) {
        sprayLife[i] -= dt;
        sprayVel[i * 3 + 1] -= 9.8 * dt;
        sprayArr[i * 3] += sprayVel[i * 3] * dt;
        sprayArr[i * 3 + 1] = Math.max(-0.5, sprayArr[i * 3 + 1] + sprayVel[i * 3 + 1] * dt);
        sprayArr[i * 3 + 2] += sprayVel[i * 3 + 2] * dt;
        if (sprayLife[i] <= 0) sprayArr[i * 3 + 1] = -5;
        sprayDirty = true;
      }
    }
    if (sprayDirty) sprayAttr.needsUpdate = true;

    if (weatherPoints && weatherPosAttr) {
      const arr = weatherPosAttr.array as Float32Array;
      const fallSpeed = isPrecipRain
        ? (atmo.weather === 'storm' ? 30 : 23)
        : (atmo.weather === 'blizzard' ? 6.5 : 3.2);
      const driftX = (atmo.weather === 'blizzard' ? 1.4 : 0.55) * atmo.windMs;
      for (let i = 0; i < weatherCount; i++) {
        arr[i * 3] += driftX * dt;
        arr[i * 3 + 1] -= fallSpeed * dt;
        if (isPrecipSnow) {
          arr[i * 3 + 2] += Math.sin(elapsed * 2.1 + i) * (atmo.weather === 'blizzard' ? 2.1 : 0.7) * dt;
        }
        if (arr[i * 3 + 1] < 0 || Math.abs(arr[i * 3]) > 82) {
          arr[i * 3 + 1] = 33 + Math.random() * 4;
          arr[i * 3] = (Math.random() - 0.5) * 145;
          arr[i * 3 + 2] = (Math.random() - 0.5) * 100;
        }
      }
      weatherPosAttr.needsUpdate = true;
    }

    if (atmo.hasLightning) {
      if (elapsed >= nextLightningAt) {
        lightningPulse = 1.0;
        nextLightningAt = elapsed + 4.5 + Math.random() * 6.5;
      }
      if (lightningPulse > 0.01) {
        lightningPulse = Math.max(0, lightningPulse - dt * 5.2);
        const flicker = lightningPulse > 0.65 || (lightningPulse > 0.25 && lightningPulse < 0.42) ? 1 : 0.15;
        lightningLight.intensity = 4.6 * lightningPulse * flicker;
      } else {
        lightningLight.intensity = 0;
      }
    }

    if (confettiTimer > 0) {
      confettiTimer = Math.max(0, confettiTimer - dt);
      for (let i = 0; i < confettiCount; i++) {
        confVel[i * 3 + 1] -= 9.5 * dt;
        confArr[i * 3] += confVel[i * 3] * dt;
        confArr[i * 3 + 1] = Math.max(0.1, confArr[i * 3 + 1] + confVel[i * 3 + 1] * dt);
        confArr[i * 3 + 2] += confVel[i * 3 + 2] * dt;
      }
      confAttr.needsUpdate = true;
      confMat.opacity = Math.min(0.95, confettiTimer * 0.55);
      if (confettiTimer <= 0) confPoints.visible = false;
    }
  };

  scene.add(root);

  return {
    root,
    ballMesh,
    ballShadow,
    adTexture,
    leftNetMesh: leftGoal.netMesh,
    rightNetMesh: rightGoal.netMesh,
    leftNetBasePos: leftGoal.basePos,
    rightNetBasePos: rightGoal.basePos,
    flagCloths,
    triggerGoalNet,
    triggerConfetti,
    triggerTurfSpray,
    update,
    dispose: () => {
      scene.remove(root);
      for (const d of disposables) d.dispose();
    },
  };
}
