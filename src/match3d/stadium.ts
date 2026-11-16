import * as THREE from 'three';
import {
  APRON_LEN,
  APRON_WID,
  PITCH_LEN,
  PITCH_WID,
  makeAdBoardTexture,
  makeBallTexture,
  makeNetTexture,
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

  let skyTopHex = 0x2d6cb5;
  let skyHorizonHex = 0x8bbde8;
  let fogColorHex = 0x8db6db;
  let sunColorHex = 0xfff8e6;
  let sunIntensity = 2.15;
  let floodlightIntensity = 0.45;
  let fogDensity = 0.0018;

  if (isNight) {
    skyTopHex = 0x050b16;
    skyHorizonHex = weather === 'fog' ? 0x1b2b38 : weather === 'snow' || weather === 'blizzard' ? 0x1b283a : 0x0e1c2f;
    fogColorHex = skyHorizonHex;
    sunColorHex = 0xc9dcff;
    sunIntensity = 0.45;
    floodlightIntensity = 2.6;
    fogDensity = weather === 'fog' ? 0.0085 : weather === 'blizzard' ? 0.0062 : weather === 'rain' || weather === 'storm' ? 0.0044 : 0.0024;
  } else if (isSunset) {
    skyTopHex = weather === 'rain' || weather === 'storm' || weather === 'overcast' ? 0x2d3b4e : 0x2b4570;
    skyHorizonHex = weather === 'rain' || weather === 'storm' ? 0x5c697a : season === 'winter' ? 0xa3b8cc : 0xd98a5f;
    fogColorHex = skyHorizonHex;
    sunColorHex = weather === 'clear' ? 0xffbf7a : 0xd9e4f0;
    sunIntensity = weather === 'clear' ? 1.55 : 1.05;
    floodlightIntensity = 1.75;
    fogDensity = weather === 'fog' ? 0.0082 : weather === 'blizzard' ? 0.006 : 0.0026;
  } else {
    // Daytime varied cleanly by season & weather
    if (weather === 'storm') {
      skyTopHex = 0x27323f;
      skyHorizonHex = 0x4b5b6b;
      sunIntensity = 0.9;
      floodlightIntensity = 1.85;
      fogDensity = 0.0048;
    } else if (weather === 'rain' || weather === 'overcast') {
      skyTopHex = 0x4b6073;
      skyHorizonHex = 0x7e92a3;
      sunIntensity = 1.2;
      floodlightIntensity = 1.25;
      fogDensity = weather === 'rain' ? 0.0042 : 0.0028;
    } else if (weather === 'fog') {
      skyTopHex = 0x8094a3;
      skyHorizonHex = 0xb8c8d4;
      sunIntensity = 0.95;
      floodlightIntensity = 1.4;
      fogDensity = 0.0092;
    } else if (weather === 'snow' || weather === 'blizzard') {
      skyTopHex = 0x6f8498;
      skyHorizonHex = 0xb6c6d4;
      sunIntensity = 1.15;
      floodlightIntensity = 1.45;
      fogDensity = weather === 'blizzard' ? 0.0068 : 0.0045;
    } else if (season === 'winter') {
      skyTopHex = 0x5a89ba;
      skyHorizonHex = 0xc5daf0;
      sunColorHex = 0xfff5e4;
      sunIntensity = 1.85;
      fogDensity = 0.0022;
    } else if (season === 'autumn') {
      skyTopHex = 0x4876a8;
      skyHorizonHex = 0xb5c2c9;
      sunColorHex = 0xffdfad;
      sunIntensity = 1.85;
      fogDensity = 0.0026;
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
  update: (dt: number, elapsed: number, ballPos: THREE.Vector3, ballVel: THREE.Vector3, goalMood: number) => void;
  dispose: () => void;
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

  // Gradient Sky Dome around the entire stadium
  const skyTex = track(makeSkyGradientTexture(atmo.skyTopHex, atmo.skyHorizonHex, atmo.isNight));
  const skyDome = new THREE.Mesh(
    track(new THREE.SphereGeometry(245, 24, 16)),
    track(new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }))
  );
  root.add(skyDome);

  // Sun or Moon celestial disc when sky isn't obscured by heavy storm/fog
  if (atmo.weather === 'clear' || atmo.weather === 'overcast') {
    const sunElev = atmo.isNight ? 48 : atmo.isSunset ? 18 : 68;
    const sunAzim = atmo.isNight ? -75 : atmo.isSunset ? -110 : 45;
    const celestial = new THREE.Mesh(
      track(new THREE.SphereGeometry(atmo.isNight ? 3.2 : 5.2, 16, 12)),
      track(new THREE.MeshBasicMaterial({
        color: atmo.isNight ? 0xe2e8f0 : atmo.isSunset ? 0xffb35c : 0xfff8dc,
        fog: false,
      }))
    );
    celestial.position.set(sunAzim, sunElev, -145);
    root.add(celestial);
  }

  // Lighting: Hemisphere + Sun/Stadium key + corner floodlights + lightning flash light
  const hemi = new THREE.HemisphereLight(
    atmo.isNight ? 0x5d84b8 : atmo.isSunset ? 0xf5b98e : 0xc6e4ff,
    atmo.season === 'winter' ? 0x26353a : atmo.isNight ? 0x102218 : 0x244a2a,
    atmo.isNight ? 0.85 : 1.05
  );
  root.add(hemi);

  const keyLight = new THREE.DirectionalLight(atmo.sunColorHex, atmo.sunIntensity);
  keyLight.position.set(atmo.isSunset ? -48 : 34, atmo.isSunset ? 30 : 58, 38);
  if (!isSoftwareGl) {
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.near = 10;
    keyLight.shadow.camera.far = 180;
    keyLight.shadow.camera.left = -68;
    keyLight.shadow.camera.right = 68;
    keyLight.shadow.camera.top = 52;
    keyLight.shadow.camera.bottom = -52;
    keyLight.shadow.bias = -0.0005;
  }
  root.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xcbe2ff, atmo.floodlightIntensity * 0.72);
  fillLight.position.set(-42, 46, -34);
  root.add(fillLight);

  if (atmo.floodlightIntensity > 0.9) {
    const floodPositions: [number, number][] = [
      [-62, -44],
      [62, -44],
      [-62, 44],
      [62, 44],
    ];
    for (const [fx, fz] of floodPositions) {
      const fl = new THREE.DirectionalLight(0xf6f9ff, atmo.floodlightIntensity * 0.44);
      fl.position.set(fx, 40, fz);
      root.add(fl);
    }
  }

  // Lightning pulse light for thunder/storm conditions
  const lightningLight = new THREE.DirectionalLight(0xdbeafe, 0);
  lightningLight.position.set(-20, 75, -50);
  root.add(lightningLight);

  // Outer stadium ground apron tinted cleanly by season & snow
  const isSnowGround = atmo.weather === 'snow' || atmo.weather === 'blizzard' || (atmo.season === 'winter' && atmo.tempC <= -3);
  const outerColor = isSnowGround
    ? 0xcbd8e3
    : atmo.isNight
      ? 0x0f181d
      : atmo.season === 'autumn'
        ? 0x3b3524
        : 0x233829;
  const outerGeo = track(new THREE.PlaneGeometry(420, 420));
  const outerMat = track(new THREE.MeshStandardMaterial({
    color: outerColor,
    roughness: isSnowGround ? 0.78 : 0.94,
    metalness: 0.04,
  }));
  const outerGround = new THREE.Mesh(outerGeo, outerMat);
  outerGround.rotation.x = -Math.PI / 2;
  outerGround.position.y = -0.08;
  root.add(outerGround);

  // Regulation Pitch + Seasonal Mowed Grass Apron
  const isWet = atmo.weather === 'rain' || atmo.weather === 'storm';
  const isSnowPitch = atmo.weather === 'snow' || atmo.weather === 'blizzard';
  const pitchTex = track(makePitchTexture(maxAnisotropy, isWet, isSnowPitch, atmo.season));
  const roughTex = track(makePitchRoughnessTexture(maxAnisotropy, isWet));
  const pitchGeo = track(new THREE.PlaneGeometry(APRON_LEN, APRON_WID, 1, 1));
  const pitchMat = track(new THREE.MeshStandardMaterial({
    map: pitchTex,
    roughnessMap: roughTex,
    roughness: isWet ? 0.42 : isSnowPitch ? 0.72 : 0.84,
    metalness: isWet ? 0.08 : 0.02,
  }));
  const pitchMesh = new THREE.Mesh(pitchGeo, pitchMat);
  pitchMesh.rotation.x = -Math.PI / 2;
  pitchMesh.receiveShadow = !isSoftwareGl;
  root.add(pitchMesh);

  // Track surround inside stadium bowl (frost/snow-dusted in winter)
  const trackMat = track(new THREE.MeshStandardMaterial({
    color: isSnowGround ? 0x9aaaba : 0x1d2d28,
    roughness: 0.86,
    metalness: 0.06,
  }));
  const addBorderSlab = (w: number, d: number, x: number, z: number) => {
    const g = track(new THREE.BoxGeometry(w, 0.08, d));
    const msh = new THREE.Mesh(g, trackMat);
    msh.position.set(x, -0.035, z);
    msh.receiveShadow = !isSoftwareGl;
    root.add(msh);
  };
  addBorderSlab(152, 10, 0, -(APRON_WID / 2 + 5));
  addBorderSlab(152, 10, 0, APRON_WID / 2 + 5);
  addBorderSlab(12, APRON_WID, -(APRON_LEN / 2 + 6), 0);
  addBorderSlab(12, APRON_WID, APRON_LEN / 2 + 6, 0);

  // 3D Goals
  const netTex = track(makeNetTexture(maxAnisotropy));
  const postMat = track(new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.32, metalness: 0.35 }));
  const netMat = track(new THREE.MeshStandardMaterial({
    map: netTex,
    color: 0xffffff,
    transparent: true,
    opacity: 0.72,
    alphaTest: 0.15,
    side: THREE.DoubleSide,
    roughness: 0.9,
  }));

  const buildGoal = (dir: -1 | 1): { netMesh: THREE.Mesh; basePos: Float32Array } => {
    const g = new THREE.Group();
    const gx = dir * (PITCH_LEN / 2);
    const goalW = 7.32;
    const goalH = 2.44;
    const goalD = 2.25;
    const postR = 0.068;

    const postGeo = track(new THREE.CylinderGeometry(postR, postR, goalH, 12));
    const p1 = new THREE.Mesh(postGeo, postMat);
    p1.position.set(gx, goalH / 2, -goalW / 2);
    p1.castShadow = !isSoftwareGl;
    g.add(p1);

    const p2 = new THREE.Mesh(postGeo, postMat);
    p2.position.set(gx, goalH / 2, goalW / 2);
    p2.castShadow = !isSoftwareGl;
    g.add(p2);

    const barGeo = track(new THREE.CylinderGeometry(postR, postR, goalW + postR * 2, 12));
    const bar = new THREE.Mesh(barGeo, postMat);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(gx, goalH, 0);
    bar.castShadow = !isSoftwareGl;
    g.add(bar);

    const stanchionMat = track(new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.45, metalness: 0.5 }));
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

    const backNetGeo = track(new THREE.PlaneGeometry(goalW, goalH, 14, 6));
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

  // Perimeter LED Advertising Boards showing City & Weather + Matchup
  const compLabel = m.ctx?.comp || m.fixture.label || 'ВИРТ РПЛ';
  const tempBadge = `${atmo.tempC > 0 ? '+' : ''}${atmo.tempC}°C`;
  const cityWeatherText = `${atmo.city} · ${tempBadge} · ${atmo.conditionLabel}`;
  const adTexture = track(makeAdBoardTexture(m.fixture.homeName, m.fixture.awayName, compLabel, homeHex, maxAnisotropy, cityWeatherText));
  const adMat = track(new THREE.MeshStandardMaterial({
    map: adTexture,
    emissive: new THREE.Color(0xffffff),
    emissiveMap: adTexture,
    emissiveIntensity: atmo.isNight || atmo.isSunset ? 0.7 : 0.28,
    roughness: 0.35,
    metalness: 0.1,
  }));
  const adBackMat = track(new THREE.MeshStandardMaterial({ color: 0x0b1210, roughness: 0.7 }));

  const addLedWall = (len: number, x: number, z: number, rotY: number) => {
    const grp = new THREE.Group();
    const face = new THREE.Mesh(track(new THREE.PlaneGeometry(len, 1.05)), adMat);
    face.position.set(0, 0.525, 0.08);
    grp.add(face);
    const back = new THREE.Mesh(track(new THREE.BoxGeometry(len, 1.05, 0.14)), adBackMat);
    back.position.set(0, 0.525, 0);
    grp.add(back);
    grp.position.set(x, 0, z);
    grp.rotation.y = rotY;
    root.add(grp);
  };
  addLedWall(110, 0, -(PITCH_WID / 2 + 4.4), 0);
  addLedWall(110, 0, PITCH_WID / 2 + 4.4, Math.PI);
  addLedWall(72, -(PITCH_LEN / 2 + 5.2), 0, Math.PI / 2);
  addLedWall(72, PITCH_LEN / 2 + 5.2, 0, -Math.PI / 2);

  // Team Dugouts
  const buildDugout = (xCenter: number, accentHex: string) => {
    const dg = new THREE.Group();
    const benchMat = track(new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6 }));
    const glassMat = track(new THREE.MeshStandardMaterial({
      color: 0xcbe4f5,
      transparent: true,
      opacity: 0.32,
      roughness: 0.12,
      metalness: 0.2,
    }));
    const accentMat = track(new THREE.MeshStandardMaterial({ color: accentHex, roughness: 0.45 }));

    const base = new THREE.Mesh(track(new THREE.BoxGeometry(8.5, 0.55, 1.2)), benchMat);
    base.position.set(0, 0.28, 0);
    dg.add(base);

    const canopy = new THREE.Mesh(track(new THREE.BoxGeometry(8.8, 0.08, 1.75)), glassMat);
    canopy.position.set(0, 2.25, 0.15);
    canopy.rotation.x = 0.14;
    dg.add(canopy);

    const backWall = new THREE.Mesh(track(new THREE.BoxGeometry(8.6, 1.8, 0.08)), glassMat);
    backWall.position.set(0, 1.3, -0.58);
    dg.add(backWall);

    const stripe = new THREE.Mesh(track(new THREE.BoxGeometry(8.6, 0.25, 0.12)), accentMat);
    stripe.position.set(0, 2.2, -0.58);
    dg.add(stripe);

    dg.position.set(xCenter, 0, -(PITCH_WID / 2 + 2.8));
    root.add(dg);
  };
  buildDugout(-13, homeHex);
  buildDugout(13, awayHex);

  // Multi-Tiered Stadium Stands + Seasonal Roof Canopy (snow-topped in winter)
  const concreteMat = track(new THREE.MeshStandardMaterial({ color: 0x1a242b, roughness: 0.88, metalness: 0.08 }));
  const roofMat = track(new THREE.MeshStandardMaterial({
    color: isSnowGround ? 0xbecad6 : 0x223038,
    roughness: isSnowGround ? 0.65 : 0.5,
    metalness: isSnowGround ? 0.2 : 0.55,
  }));
  const trussMat = track(new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.45, metalness: 0.65 }));

  const buildStandSide = (len: number, depth: number, x: number, z: number, rotY: number) => {
    const sg = new THREE.Group();
    const tiers = 5;
    for (let t = 0; t < tiers; t++) {
      const stepH = 1.45;
      const stepD = depth / tiers;
      const riser = new THREE.Mesh(track(new THREE.BoxGeometry(len, (t + 1) * stepH, stepD)), concreteMat);
      riser.position.set(0, ((t + 1) * stepH) / 2, -(t * stepD));
      sg.add(riser);
    }
    const backWall = new THREE.Mesh(track(new THREE.BoxGeometry(len, 14, 1.6)), concreteMat);
    backWall.position.set(0, 7, -depth);
    sg.add(backWall);

    const roof = new THREE.Mesh(track(new THREE.BoxGeometry(len + 2, 0.55, depth + 4.5)), roofMat);
    roof.position.set(0, 14.2, -depth / 2 + 1.5);
    roof.rotation.x = 0.07;
    sg.add(roof);

    const fascia = new THREE.Mesh(
      track(new THREE.BoxGeometry(len + 2, 0.45, 0.4)),
      track(new THREE.MeshStandardMaterial({ color: homeHex, roughness: 0.4, metalness: 0.25 }))
    );
    fascia.position.set(0, 13.7, 3.6);
    sg.add(fascia);

    const colCount = Math.max(4, Math.floor(len / 18));
    const colGeo = track(new THREE.CylinderGeometry(0.24, 0.28, 14, 8));
    for (let i = 0; i <= colCount; i++) {
      const cx = -len / 2 + (len * i) / colCount;
      const col = new THREE.Mesh(colGeo, trussMat);
      col.position.set(cx, 7, -depth + 1.2);
      sg.add(col);
    }

    sg.position.set(x, 0, z);
    sg.rotation.y = rotY;
    root.add(sg);
  };

  buildStandSide(132, 15, 0, -(APRON_WID / 2 + 8), 0);
  buildStandSide(132, 15, 0, APRON_WID / 2 + 8, Math.PI);
  buildStandSide(92, 14, -(APRON_LEN / 2 + 8), 0, Math.PI / 2);
  buildStandSide(92, 14, APRON_LEN / 2 + 8, 0, -Math.PI / 2);

  // Corner Scoreboard Screen
  const boardFrame = new THREE.Mesh(track(new THREE.BoxGeometry(1.1, 6.2, 13)), trussMat);
  boardFrame.position.set(APRON_LEN / 2 + 10, 17.5, 0);
  root.add(boardFrame);
  const boardScreen = new THREE.Mesh(track(new THREE.PlaneGeometry(12.2, 5.4)), adMat);
  boardScreen.rotation.y = -Math.PI / 2;
  boardScreen.position.set(APRON_LEN / 2 + 9.4, 17.5, 0);
  root.add(boardScreen);

  // 4 Corner Floodlight Towers
  const pylonGeo = track(new THREE.CylinderGeometry(0.45, 0.85, 34, 8));
  const lampHeadMat = track(new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.6 }));
  const lampsActive = atmo.floodlightIntensity > 0.9;
  const lampGlowMat = track(new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: new THREE.Color(lampsActive ? 0xfff8e6 : 0xdbeafe),
    emissiveIntensity: lampsActive ? 2.5 : 0.35,
    roughness: 0.15,
  }));
  for (const [tx, tz] of [
    [-68, -48],
    [68, -48],
    [-68, 48],
    [68, 48],
  ]) {
    const tower = new THREE.Group();
    const mast = new THREE.Mesh(pylonGeo, trussMat);
    mast.position.y = 17;
    tower.add(mast);

    const head = new THREE.Mesh(track(new THREE.BoxGeometry(5.8, 3.6, 0.8)), lampHeadMat);
    head.position.set(0, 34.5, 0);
    head.lookAt(-tx, 0, -tz);
    tower.add(head);

    const glow = new THREE.Mesh(track(new THREE.PlaneGeometry(5.2, 3.0)), lampGlowMat);
    glow.position.set(0, 0, 0.43);
    head.add(glow);

    tower.position.set(tx, 0, tz);
    root.add(tower);
  }

  // Instanced Spectators
  const crowdCount = isSoftwareGl ? 700 : 1400;
  const specGeo = track(new THREE.CapsuleGeometry(0.24, 0.45, 4, 6));
  const specMat = track(new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0.05 }));
  const crowdMesh = new THREE.InstancedMesh(specGeo, specMat, crowdCount);
  crowdMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const crowdBasePositions: { x: number; y: number; z: number; phase: number }[] = [];
  const palette = [
    new THREE.Color(homeHex),
    new THREE.Color(homeHex).lerp(new THREE.Color(0xffffff), 0.35),
    new THREE.Color(awayHex),
    new THREE.Color('#e2e8f0'),
    new THREE.Color('#1e293b'),
    new THREE.Color('#f0c419'),
  ];
  const dummy = new THREE.Object3D();

  for (let i = 0; i < crowdCount; i++) {
    const stand = i % 4;
    const tier = (i * 7) % 5;
    const randU = ((Math.sin(i * 19.31) * 43758.5453) % 1 + 1) % 1;
    const tierY = 1.65 + tier * 1.45;
    const tierDepth = 1.4 + tier * 2.85;
    let sx = 0, sz = 0;
    if (stand === 0) {
      sx = (randU - 0.5) * 124;
      sz = -(APRON_WID / 2 + 8 + tierDepth);
    } else if (stand === 1) {
      sx = (randU - 0.5) * 124;
      sz = APRON_WID / 2 + 8 + tierDepth;
    } else if (stand === 2) {
      sx = -(APRON_LEN / 2 + 8 + tierDepth);
      sz = (randU - 0.5) * 84;
    } else {
      sx = APRON_LEN / 2 + 8 + tierDepth;
      sz = (randU - 0.5) * 84;
    }
    crowdBasePositions.push({ x: sx, y: tierY, z: sz, phase: (i * 0.73) % (Math.PI * 2) });
    dummy.position.set(sx, tierY, sz);
    dummy.rotation.set(0, Math.atan2(-sx, -sz), 0);
    dummy.updateMatrix();
    crowdMesh.setMatrixAt(i, dummy.matrix);

    const col = stand === 3 && i % 2 === 0
      ? palette[2]
      : palette[i % 5 === 0 ? 0 : i % 7 === 0 ? 5 : i % 3 === 0 ? 1 : (i % 2 === 0 ? 3 : 4)];
    crowdMesh.setColorAt(i, col);
  }
  crowdMesh.instanceMatrix.needsUpdate = true;
  if (crowdMesh.instanceColor) crowdMesh.instanceColor.needsUpdate = true;
  root.add(crowdMesh);

  // Match Football (High-vis orange winter ball in snow/blizzard, classic white otherwise)
  const ballTex = track(makeBallTexture(maxAnisotropy, atmo.useOrangeBall));
  const ballGeo = track(new THREE.SphereGeometry(0.24, 24, 18));
  const ballMat = track(new THREE.MeshStandardMaterial({
    map: ballTex,
    roughness: 0.36,
    metalness: 0.08,
  }));
  const ballMesh = new THREE.Mesh(ballGeo, ballMat);
  ballMesh.castShadow = !isSoftwareGl;
  ballMesh.position.set(0, 0.24, 0);
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

  // Dynamic Weather Precipitation (Rain / Storm / Snow / Blizzard / Autumn breeze)
  let weatherPoints: THREE.Points | null = null;
  let weatherPosAttr: THREE.BufferAttribute | null = null;
  const isPrecipRain = atmo.weather === 'rain' || atmo.weather === 'storm';
  const isPrecipSnow = atmo.weather === 'snow' || atmo.weather === 'blizzard';
  const weatherCount = isPrecipRain
    ? (atmo.weather === 'storm' ? (isSoftwareGl ? 900 : 1900) : (isSoftwareGl ? 600 : 1250))
    : isPrecipSnow
      ? (atmo.weather === 'blizzard' ? (isSoftwareGl ? 850 : 1800) : (isSoftwareGl ? 480 : 980))
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
      color: isPrecipSnow ? 0xf8fafc : 0xb6dcf8,
      size: atmo.weather === 'blizzard' ? 0.42 : isPrecipSnow ? 0.34 : atmo.weather === 'storm' ? 0.24 : 0.19,
      transparent: true,
      opacity: isPrecipSnow ? 0.84 : 0.56,
      depthWrite: false,
    }));
    weatherPoints = new THREE.Points(wGeo, wMat);
    root.add(weatherPoints);
  }

  // Goal Confetti Burst
  const confettiCount = 90;
  const confArr = new Float32Array(confettiCount * 3);
  const confVel = new Float32Array(confettiCount * 3);
  const confGeo = track(new THREE.BufferGeometry());
  const confAttr = new THREE.BufferAttribute(confArr, 3);
  confAttr.setUsage(THREE.DynamicDrawUsage);
  confGeo.setAttribute('position', confAttr);
  const confMat = track(new THREE.PointsMaterial({
    color: 0xf0c419,
    size: 0.45,
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
    confettiTimer = 2.8;
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

  const update = (dt: number, elapsed: number, ballPos: THREE.Vector3, ballVel: THREE.Vector3, goalMood: number) => {
    ballMesh.position.copy(ballPos);
    const speed = Math.hypot(ballVel.x, ballVel.z);
    if (speed > 0.05) {
      ballMesh.rotation.z -= (ballVel.x * dt) / 0.24;
      ballMesh.rotation.x += (ballVel.z * dt) / 0.24;
    }
    ballShadow.position.set(ballPos.x, 0.02, ballPos.z);
    const hRatio = Math.max(0.35, 1 - Math.max(0, ballPos.y - 0.24) * 0.09);
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

    const jumpAmp = 0.06 + goalMood * 0.38;
    const jumpFreq = 2.4 + goalMood * 7.5;
    for (let i = 0; i < crowdCount; i++) {
      const b = crowdBasePositions[i];
      dummy.position.set(b.x, b.y + Math.abs(Math.sin(elapsed * jumpFreq + b.phase)) * jumpAmp, b.z);
      dummy.rotation.set(0, Math.atan2(-b.x, -b.z), 0);
      dummy.updateMatrix();
      crowdMesh.setMatrixAt(i, dummy.matrix);
    }
    crowdMesh.instanceMatrix.needsUpdate = true;

    // Weather precipitation loop
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

    // Lightning flash in storm weather
    if (atmo.hasLightning) {
      if (elapsed >= nextLightningAt) {
        lightningPulse = 1.0;
        nextLightningAt = elapsed + 4.5 + Math.random() * 6.5;
      }
      if (lightningPulse > 0.01) {
        lightningPulse = Math.max(0, lightningPulse - dt * 5.2);
        const flicker = lightningPulse > 0.65 || (lightningPulse > 0.25 && lightningPulse < 0.42) ? 1 : 0.15;
        lightningLight.intensity = 4.2 * lightningPulse * flicker;
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
    update,
    dispose: () => {
      scene.remove(root);
      for (const d of disposables) d.dispose();
    },
  };
}
