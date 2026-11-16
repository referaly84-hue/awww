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
} from './textures';
import type { MatchPayload, ResolvedAtmosphere, WeatherKind } from './types';

export function resolveAtmosphere(m: MatchPayload): ResolvedAtmosphere {
  const f = m.fixture || ({} as MatchPayload['fixture']);
  const c = m.ctx || {};
  const wStr = String(c.weather || f.weather || c.weatherDetails?.condition || f.weatherDetails?.condition || '').toLowerCase();
  const timeStr = String(f.gameTime || '17:00');
  const hour = parseInt(timeStr.split(':')[0] || '17', 10);
  const isNight = Number.isFinite(hour) ? hour >= 18 || hour < 7 : false;

  let weather: WeatherKind = 'clear';
  if (wStr.includes('снег') || wStr.includes('метел') || wStr.includes('снеж')) weather = 'snow';
  else if (wStr.includes('дожд') || wStr.includes('ливен') || wStr.includes('морос') || wStr.includes('гроз')) weather = 'rain';
  else if (wStr.includes('пасмур') || wStr.includes('облач') || wStr.includes('туман')) weather = 'overcast';

  const tempC = Number(f.weatherDetails?.tempC ?? c.weatherDetails?.tempC ?? (weather === 'snow' ? -3 : 14));
  const windMs = Number(f.weatherDetails?.windMs ?? c.weatherDetails?.windMs ?? 3);

  let skyColorHex = isNight ? 0x091321 : weather === 'overcast' || weather === 'rain' ? 0x5d7285 : weather === 'snow' ? 0x7c8e9e : 0x5b8fc2;
  const fogColorHex = isNight ? 0x0c1828 : weather === 'snow' ? 0x9aaab8 : weather === 'rain' ? 0x586b7a : 0x6f96b8;
  const fogDensity = weather === 'snow' ? 0.0042 : weather === 'rain' ? 0.0038 : isNight ? 0.0026 : 0.0022;

  return {
    isNight,
    weather,
    tempC,
    windMs,
    skyColorHex,
    fogColorHex,
    fogDensity,
    sunIntensity: isNight ? 0.45 : weather === 'clear' ? 2.15 : 1.35,
    floodlightIntensity: isNight ? 2.4 : weather === 'clear' ? 0.55 : 1.35,
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

  scene.background = new THREE.Color(atmo.skyColorHex);
  scene.fog = new THREE.FogExp2(atmo.fogColorHex, atmo.fogDensity);

  // Lighting: Hemisphere + Sun/Stadium key + corner floodlight accents
  const hemi = new THREE.HemisphereLight(
    atmo.isNight ? 0x5d84b8 : 0xbce0ff,
    atmo.isNight ? 0x102218 : 0x204728,
    atmo.isNight ? 0.85 : 1.05
  );
  root.add(hemi);

  const keyLight = new THREE.DirectionalLight(atmo.isNight ? 0xfff5e4 : 0xfff8ea, atmo.sunIntensity);
  keyLight.position.set(34, 58, 38);
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

  if (atmo.isNight || atmo.weather !== 'clear') {
    const floodPositions: [number, number][] = [
      [-62, -44],
      [62, -44],
      [-62, 44],
      [62, 44],
    ];
    for (const [fx, fz] of floodPositions) {
      const fl = new THREE.DirectionalLight(0xf6f9ff, atmo.floodlightIntensity * 0.42);
      fl.position.set(fx, 40, fz);
      root.add(fl);
    }
  }

  // Outer stadium ground apron (concrete/asphalt base extending cleanly into horizon fog)
  const outerGeo = track(new THREE.PlaneGeometry(420, 420));
  const outerMat = track(new THREE.MeshStandardMaterial({
    color: atmo.isNight ? 0x10181d : 0x24332a,
    roughness: 0.94,
    metalness: 0.04,
  }));
  const outerGround = new THREE.Mesh(outerGeo, outerMat);
  outerGround.rotation.x = -Math.PI / 2;
  outerGround.position.y = -0.08;
  root.add(outerGround);

  // Regulation Pitch + Mowed Grass Apron
  const isWet = atmo.weather === 'rain';
  const isSnow = atmo.weather === 'snow';
  const pitchTex = track(makePitchTexture(maxAnisotropy, isWet, isSnow));
  const roughTex = track(makePitchRoughnessTexture(maxAnisotropy, isWet));
  const pitchGeo = track(new THREE.PlaneGeometry(APRON_LEN, APRON_WID, 1, 1));
  const pitchMat = track(new THREE.MeshStandardMaterial({
    map: pitchTex,
    roughnessMap: roughTex,
    roughness: isWet ? 0.56 : 0.84,
    metalness: 0.02,
  }));
  const pitchMesh = new THREE.Mesh(pitchGeo, pitchMat);
  pitchMesh.rotation.x = -Math.PI / 2;
  pitchMesh.receiveShadow = !isSoftwareGl;
  root.add(pitchMesh);

  // Subtle dark track surround inside bowl
  const trackMat = track(new THREE.MeshStandardMaterial({
    color: 0x1d2d28,
    roughness: 0.88,
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

  // 3D Goals (at x = -52.5 and x = +52.5)
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

    // Back stanchions
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

    // Back Net with subdivisions so it ripples on goals
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

  // Perimeter LED Advertising Boards
  const compLabel = m.ctx?.comp || m.fixture.label || 'ВИРТ РПЛ';
  const adTexture = track(makeAdBoardTexture(m.fixture.homeName, m.fixture.awayName, compLabel, homeHex, maxAnisotropy));
  const adMat = track(new THREE.MeshStandardMaterial({
    map: adTexture,
    emissive: new THREE.Color(0xffffff),
    emissiveMap: adTexture,
    emissiveIntensity: atmo.isNight ? 0.65 : 0.25,
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

  // Team Dugouts (Technical Benches) along north touchline
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

  // Multi-Tiered Stadium Stands + Roof Canopy + 4 Floodlight Towers
  const concreteMat = track(new THREE.MeshStandardMaterial({ color: 0x1a242b, roughness: 0.88, metalness: 0.08 }));
  const roofMat = track(new THREE.MeshStandardMaterial({ color: 0x223038, roughness: 0.5, metalness: 0.55 }));
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
    // Back outer facade wall
    const backWall = new THREE.Mesh(track(new THREE.BoxGeometry(len, 14, 1.6)), concreteMat);
    backWall.position.set(0, 7, -depth);
    sg.add(backWall);

    // Overhanging roof slab + fascia accent
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

    // Structural roof columns
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

  // Corner Scoreboard / Big Screen on East stand roof
  const boardFrame = new THREE.Mesh(track(new THREE.BoxGeometry(1.1, 6.2, 13)), trussMat);
  boardFrame.position.set(APRON_LEN / 2 + 10, 17.5, 0);
  root.add(boardFrame);
  const boardScreen = new THREE.Mesh(track(new THREE.PlaneGeometry(12.2, 5.4)), adMat);
  boardScreen.rotation.y = -Math.PI / 2;
  boardScreen.position.set(APRON_LEN / 2 + 9.4, 17.5, 0);
  root.add(boardScreen);

  // 4 Floodlight Pylon Towers at corners
  const pylonGeo = track(new THREE.CylinderGeometry(0.45, 0.85, 34, 8));
  const lampHeadMat = track(new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.6 }));
  const lampGlowMat = track(new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: new THREE.Color(atmo.isNight ? 0xfff8e6 : 0xdbeafe),
    emissiveIntensity: atmo.isNight ? 2.4 : 0.45,
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

  // Instanced Crowd Spectators (1,400 animated cheering dots/figures across all 4 tiers — 1 draw call!)
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

    // Home fans pack home/side stands; away fans pack away end
    const col = stand === 3 && i % 2 === 0
      ? palette[2]
      : palette[i % 5 === 0 ? 0 : i % 7 === 0 ? 5 : i % 3 === 0 ? 1 : (i % 2 === 0 ? 3 : 4)];
    crowdMesh.setColorAt(i, col);
  }
  crowdMesh.instanceMatrix.needsUpdate = true;
  if (crowdMesh.instanceColor) crowdMesh.instanceColor.needsUpdate = true;
  root.add(crowdMesh);

  // Match Football + Soft Ground Shadow Disc
  const ballTex = track(makeBallTexture(maxAnisotropy));
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

  // Optional Weather Particle System (pooled Float32Array, zero GC allocations)
  let weatherPoints: THREE.Points | null = null;
  let weatherPosAttr: THREE.BufferAttribute | null = null;
  const weatherCount = atmo.weather === 'rain' ? (isSoftwareGl ? 600 : 1200) : atmo.weather === 'snow' ? (isSoftwareGl ? 450 : 900) : 0;
  if (weatherCount > 0) {
    const arr = new Float32Array(weatherCount * 3);
    for (let i = 0; i < weatherCount; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 140;
      arr[i * 3 + 1] = Math.random() * 34;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 96;
    }
    const wGeo = track(new THREE.BufferGeometry());
    weatherPosAttr = new THREE.BufferAttribute(arr, 3);
    weatherPosAttr.setUsage(THREE.DynamicDrawUsage);
    wGeo.setAttribute('position', weatherPosAttr);
    const wMat = track(new THREE.PointsMaterial({
      color: atmo.weather === 'snow' ? 0xf1f5f9 : 0xaad4f5,
      size: atmo.weather === 'snow' ? 0.34 : 0.2,
      transparent: true,
      opacity: atmo.weather === 'snow' ? 0.78 : 0.52,
      depthWrite: false,
    }));
    weatherPoints = new THREE.Points(wGeo, wMat);
    root.add(weatherPoints);
  }

  // Goal Confetti / Pyrotechnic Flare Burst behind goal
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
    // Ball placement, shadow scaling, and realistic spin from velocity
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

    // LED board subtle scroll
    adTexture.offset.x = (elapsed * 0.045) % 1;

    // Corner flags flutter in wind
    const windMul = 1 + Math.min(2, atmo.windMs * 0.15);
    for (let i = 0; i < flagCloths.length; i++) {
      flagCloths[i].rotation.y = Math.sin(elapsed * 4.2 * windMul + i) * 0.26;
    }

    // Net ripple decay
    if (leftNetWave > 0.01) {
      leftNetWave = Math.max(0, leftNetWave - dt * 1.15);
      updateNet(leftGoal.netMesh, leftGoal.basePos, leftNetWave, elapsed);
    }
    if (rightNetWave > 0.01) {
      rightNetWave = Math.max(0, rightNetWave - dt * 1.15);
      updateNet(rightGoal.netMesh, rightGoal.basePos, rightNetWave, elapsed);
    }

    // Crowd excitation wave (subtle bounce during normal play, energetic jumping during goals)
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

    // Weather particles update
    if (weatherPoints && weatherPosAttr) {
      const arr = weatherPosAttr.array as Float32Array;
      const fallSpeed = atmo.weather === 'rain' ? 24 : 3.2;
      const driftX = atmo.windMs * 0.45;
      for (let i = 0; i < weatherCount; i++) {
        arr[i * 3] += driftX * dt;
        arr[i * 3 + 1] -= fallSpeed * dt;
        if (atmo.weather === 'snow') {
          arr[i * 3 + 2] += Math.sin(elapsed * 1.8 + i) * 0.6 * dt;
        }
        if (arr[i * 3 + 1] < 0) {
          arr[i * 3 + 1] = 32 + Math.random() * 4;
          arr[i * 3] = (Math.random() - 0.5) * 140;
          arr[i * 3 + 2] = (Math.random() - 0.5) * 96;
        }
      }
      weatherPosAttr.needsUpdate = true;
    }

    // Goal celebration confetti update
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
