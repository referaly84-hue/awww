import * as THREE from 'three';
import { makePlayerKitTexture, makePlayerLabelTexture } from './textures';
import type { PlayerRig, PlayerSlot, TeamColors } from './types';

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3
    ? clean.split('').map(c => c + c).join('')
    : clean.padEnd(6, '0').slice(0, 6);
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function colorDist(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

function relLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(v => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export interface KitSet {
  homeJersey: string;
  homeShorts: string;
  homeSocks: string;
  awayJersey: string;
  awayShorts: string;
  awaySocks: string;
  homeGk: string;
  awayGk: string;
}

export function resolveMatchKits(home?: TeamColors, away?: TeamColors): KitSet {
  const hPrim = home?.primary || '#1e88e5';
  const hSec = home?.secondary || '#ffffff';
  let aPrim = away?.primary || '#e53935';
  let aSec = away?.secondary || '#ffffff';

  if (colorDist(hPrim, aPrim) < 115) {
    if (colorDist(hPrim, aSec) > 120) {
      const tmp = aPrim;
      aPrim = aSec;
      aSec = tmp;
    } else {
      aPrim = relLuminance(hPrim) > 0.55 ? '#111827' : '#f8fafc';
      aSec = away?.primary || '#f0c419';
    }
  }

  return {
    homeJersey: hPrim,
    homeShorts: hSec === hPrim ? '#0f172a' : hSec,
    homeSocks: hPrim,
    awayJersey: aPrim,
    awayShorts: aSec === aPrim ? '#1e293b' : aSec,
    awaySocks: aPrim,
    homeGk: colorDist(hPrim, '#facc15') > 110 && colorDist(aPrim, '#facc15') > 110 ? '#eab308' : '#06b6d4',
    awayGk: colorDist(hPrim, '#f97316') > 110 && colorDist(aPrim, '#f97316') > 110 ? '#f97316' : '#a855f7',
  };
}

/**
 * Builds an organic anatomical lofted mesh from elliptical cross-sections.
 * Supports front (+Z, u=0.25) and back (-Z, u=0.75) un-mirrored UVs.
 */
function createLoftedBodyGeometry(
  rings: { y: number; rx: number; rz: number; zOff?: number }[],
  radialSegs = 20
): THREE.BufferGeometry {
  const verts: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const yMin = rings[0].y;
  const yMax = rings[rings.length - 1].y;
  const ySpan = Math.max(0.001, yMax - yMin);
  const stride = radialSegs + 1;

  for (let ri = 0; ri < rings.length; ri++) {
    const ring = rings[ri];
    const v = (ring.y - yMin) / ySpan;
    const zOff = ring.zOff || 0;
    for (let si = 0; si <= radialSegs; si++) {
      const t = si / radialSegs;
      const theta = t * Math.PI * 2;
      const x = ring.rx * Math.cos(theta);
      const z = ring.rz * Math.sin(theta) + zOff;
      verts.push(x, ring.y, z);
      // 1.5 - t keeps both front (+Z at u=0.25) and back (-Z at u=0.75) un-mirrored
      uvs.push(1.5 - t, v);
    }
  }

  for (let ri = 0; ri < rings.length - 1; ri++) {
    for (let si = 0; si < radialSegs; si++) {
      const a = ri * stride + si;
      const b = a + 1;
      const c = (ri + 1) * stride + si;
      const d = c + 1;
      // Outward winding for theta going +X -> +Z -> -X -> -Z
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  // Bottom and top center caps
  const botCenterIdx = verts.length / 3;
  verts.push(0, yMin, rings[0].zOff || 0);
  uvs.push(0.5, 0);
  for (let si = 0; si < radialSegs; si++) {
    indices.push(botCenterIdx, si, si + 1);
  }

  const topRingStart = (rings.length - 1) * stride;
  const topCenterIdx = verts.length / 3;
  verts.push(0, yMax, rings[rings.length - 1].zOff || 0);
  uvs.push(0.5, 1);
  for (let si = 0; si < radialSegs; si++) {
    indices.push(topCenterIdx, topRingStart + si + 1, topRingStart + si);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function createLatheLimbGeo(
  profile: [number, number][],
  radialSegs = 12
): THREE.BufferGeometry {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(pts, radialSegs);
  geo.computeVertexNormals();
  return geo;
}

const SKIN_TONES = ['#f2c9a6', '#e6b48c', '#d4996e', '#a9704b', '#6d442b'];
const HAIR_TONES = ['#1a1614', '#382518', '#5c3c24', '#b88948', '#111827'];
const BOOT_ACCENTS = [0x38bdf8, 0xfacc15, 0xf97316, 0x22c55e, 0xe11d48, 0xf8fafc];

function makeFaceTexture(skinHex: string, hairHex: string, hasBeard: boolean): THREE.CanvasTexture {
  const w = 128;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = skinHex;
  ctx.fillRect(0, 0, w, h);

  // Front of SphereGeometry (+Z corresponds to u = 0.25)
  const fx = w * 0.25;

  // Subtle cheek warmth
  ctx.fillStyle = 'rgba(185, 85, 70, 0.14)';
  ctx.beginPath();
  ctx.arc(fx - w * 0.07, h * 0.56, 7, 0, Math.PI * 2);
  ctx.arc(fx + w * 0.07, h * 0.56, 7, 0, Math.PI * 2);
  ctx.fill();

  // Eyebrows
  ctx.fillStyle = hairHex;
  ctx.fillRect(fx - 13, h * 0.41, 9, 2.5);
  ctx.fillRect(fx + 4, h * 0.41, 9, 2.5);
  // Eyes
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(fx - 11, h * 0.46, 6, 3);
  ctx.fillRect(fx + 5, h * 0.46, 6, 3);
  ctx.fillStyle = '#1e1b18';
  ctx.fillRect(fx - 9, h * 0.46, 3, 3);
  ctx.fillRect(fx + 7, h * 0.46, 3, 3);
  // Subtle mouth
  ctx.fillStyle = 'rgba(130, 58, 52, 0.65)';
  ctx.fillRect(fx - 5, h * 0.64, 10, 2.2);

  if (hasBeard) {
    ctx.fillStyle = hairHex;
    ctx.globalAlpha = 0.28;
    ctx.beginPath();
    ctx.arc(fx, h * 0.66, 14, 0, Math.PI);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export interface PlayersManager {
  group: THREE.Group;
  rigs: Map<string, PlayerRig>;
  refereeRig: PlayerRig;
  carrierRing: THREE.Mesh;
  setLabelsVisible: (visible: boolean) => void;
  updateLabelsVisibility: (activeActorIds: Set<string>, forceAll: boolean) => void;
  animateRigs: (dt: number, elapsed: number, carrierId: string | null, ballPos?: THREE.Vector3) => void;
  dispose: () => void;
}

export function buildPlayersManager(
  scene: THREE.Scene,
  slots: PlayerSlot[],
  kits: KitSet,
  isSoftwareGl: boolean,
  longSleeves = false
): PlayersManager {
  const group = new THREE.Group();
  const rigs = new Map<string, PlayerRig>();
  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  // Sculpted anatomical shared geometries (~1.82m tall realistic athlete)
  // BodyPivot sits at hip joint height: y = 0.90m (leg length = 0.90m: thigh 0.42 + shin 0.41 + foot 0.07)
  const torsoGeo = track(createLoftedBodyGeometry([
    { y: 0.04, rx: 0.145, rz: 0.105, zOff: 0.0 },   // waist tuck
    { y: 0.14, rx: 0.158, rz: 0.112, zOff: 0.005 }, // lower abs
    { y: 0.28, rx: 0.188, rz: 0.125, zOff: 0.012 }, // ribcage
    { y: 0.41, rx: 0.212, rz: 0.132, zOff: 0.015 }, // athletic chest / pectorals
    { y: 0.49, rx: 0.222, rz: 0.112, zOff: 0.005 }, // broad shoulders
    { y: 0.54, rx: 0.115, rz: 0.088, zOff: 0.0 },   // collar trap base
  ], 22));

  const pelvisGeo = track(createLoftedBodyGeometry([
    { y: -0.09, rx: 0.165, rz: 0.118, zOff: 0.0 },
    { y: 0.0, rx: 0.162, rz: 0.115, zOff: 0.0 },
    { y: 0.06, rx: 0.148, rz: 0.106, zOff: 0.0 },
  ], 18));

  const collarGeo = track(new THREE.TorusGeometry(0.086, 0.018, 8, 16));
  const neckGeo = track(new THREE.CylinderGeometry(0.056, 0.064, 0.11, 12));
  const headGeo = track(new THREE.SphereGeometry(0.116, 16, 14));
  const noseGeo = track(new THREE.ConeGeometry(0.022, 0.048, 6));
  const earGeo = track(new THREE.SphereGeometry(0.026, 8, 6));

  // Hair variations
  const hairShortGeo = track(new THREE.SphereGeometry(0.12, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.56));
  const hairTopGeo = track(new THREE.CapsuleGeometry(0.085, 0.075, 6, 10));
  const hairCurlyGeo = track(new THREE.DodecahedronGeometry(0.128, 1));

  // Shoulder cap + short/long upper arm + elbow + forearm + hand/glove
  const shoulderGeo = track(new THREE.SphereGeometry(0.062, 10, 8));
  const sleeveGeo = track(createLatheLimbGeo([
    [0.056, -0.18],
    [0.064, -0.09],
    [0.062, 0.0],
  ], 12));
  const upperArmSkinGeo = track(createLatheLimbGeo([
    [0.043, -0.27],
    [0.049, -0.21],
    [0.052, -0.15],
  ], 10));
  const longUpperArmGeo = track(createLatheLimbGeo([
    [0.046, -0.27],
    [0.056, -0.14],
    [0.062, 0.0],
  ], 12));
  const elbowGeo = track(new THREE.SphereGeometry(0.043, 8, 8));
  const forearmGeo = track(createLatheLimbGeo([
    [0.031, -0.24],
    [0.039, -0.12],
    [0.043, 0.0],
  ], 10));
  const handGeo = track(new THREE.SphereGeometry(0.04, 8, 8));
  const gkGloveGeo = track(new THREE.BoxGeometry(0.068, 0.115, 0.088));

  // Hip -> Thigh (shorts leg) -> Knee -> Calf (sock + cuff) -> Boot (upper + sole)
  const hipSocketGeo = track(new THREE.SphereGeometry(0.084, 10, 8));
  const shortsLegGeo = track(createLatheLimbGeo([
    [0.078, -0.29],
    [0.088, -0.14],
    [0.086, 0.0],
  ], 12));
  const bareThighKneeGeo = track(createLatheLimbGeo([
    [0.056, -0.41],
    [0.066, -0.34],
    [0.072, -0.27],
  ], 10));
  const kneeCapGeo = track(new THREE.SphereGeometry(0.056, 10, 8));
  const calfSockGeo = track(createLatheLimbGeo([
    [0.042, -0.40], // ankle
    [0.048, -0.28], // achilles taper
    [0.064, -0.14], // calf muscle bulge
    [0.059, -0.05], // below knee
    [0.062, -0.02], // folded sock cuff
  ], 12));
  const sockCuffGeo = track(new THREE.CylinderGeometry(0.064, 0.064, 0.032, 12));

  // Sculpted football boot (upper + tongue + cleat soleplate)
  const bootUpperGeo = track(new THREE.CapsuleGeometry(0.048, 0.135, 6, 10));
  const bootSoleGeo = track(new THREE.BoxGeometry(0.095, 0.025, 0.24));

  const shadowGeo = track(new THREE.CircleGeometry(0.36, 18));
  const shadowMat = track(new THREE.MeshBasicMaterial({
    color: 0x050a07,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
  }));
  const cardYellowMat = track(new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide }));
  const cardGeo = track(new THREE.PlaneGeometry(0.15, 0.22));
  const soleMat = track(new THREE.MeshStandardMaterial({ color: 0x0a0f14, roughness: 0.65, metalness: 0.15 }));

  const createRig = (
    slot: PlayerSlot,
    jerseyHex: string,
    shortsHex: string,
    socksHex: string,
    secondaryHex: string,
    isRef = false
  ): PlayerRig => {
    const root = new THREE.Group();
    // Hips control vertical bob & pelvis rotation; BodyPivot contains spine/legs
    const hips = new THREE.Group();
    hips.position.y = 0.90;
    root.add(hips);

    const bodyPivot = new THREE.Group();
    hips.add(bodyPivot);

    let hash = 0;
    for (let i = 0; i < slot.id.length; i++) hash = (hash * 31 + slot.id.charCodeAt(i)) | 0;
    const skinHex = SKIN_TONES[Math.abs(hash) % SKIN_TONES.length];
    const hairHex = HAIR_TONES[Math.abs(hash >> 3) % HAIR_TONES.length];
    const bootColor = isRef ? 0x0f172a : BOOT_ACCENTS[Math.abs(hash >> 5) % BOOT_ACCENTS.length];
    const hairStyle = Math.abs(hash >> 7) % 4;

    const textLum = relLuminance(jerseyHex) > 0.5 ? '#0f172a' : '#ffffff';
    const kitTex = track(makePlayerKitTexture(slot.number, jerseyHex, secondaryHex, textLum, slot.isGk));
    const faceTex = track(makeFaceTexture(skinHex, hairHex, Math.abs(hash >> 9) % 3 === 0));
    const sheenCol = new THREE.Color(jerseyHex).lerp(new THREE.Color(0xffffff), 0.55);
    const torsoMat = track(new THREE.MeshPhysicalMaterial({
      map: kitTex,
      roughness: 0.72,
      metalness: 0.02,
      sheen: 0.68,
      sheenRoughness: 0.58,
      sheenColor: sheenCol,
    }));
    const jerseyMat = track(new THREE.MeshPhysicalMaterial({
      color: jerseyHex,
      roughness: 0.72,
      metalness: 0.02,
      sheen: 0.68,
      sheenRoughness: 0.58,
      sheenColor: sheenCol,
    }));
    const collarMat = track(new THREE.MeshStandardMaterial({ color: secondaryHex || textLum, roughness: 0.68, metalness: 0.04 }));
    const shortsMat = track(new THREE.MeshPhysicalMaterial({
      color: shortsHex,
      roughness: 0.76,
      metalness: 0.02,
      sheen: 0.45,
      sheenRoughness: 0.65,
      sheenColor: new THREE.Color(shortsHex).lerp(new THREE.Color(0xffffff), 0.4),
    }));
    const socksMat = track(new THREE.MeshStandardMaterial({ color: socksHex, roughness: 0.78, metalness: 0.02 }));
    const skinMat = track(new THREE.MeshStandardMaterial({ color: skinHex, roughness: 0.56, metalness: 0.02 }));
    const faceMat = track(new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.54, metalness: 0.02 }));
    const hairMat = track(new THREE.MeshStandardMaterial({ color: hairHex, roughness: 0.84, metalness: 0.02 }));
    const bootMat = track(new THREE.MeshPhysicalMaterial({
      color: bootColor,
      roughness: 0.28,
      metalness: 0.22,
      clearcoat: 0.85,
      clearcoatRoughness: 0.16,
    }));
    const gloveMat = slot.isGk
      ? track(new THREE.MeshPhysicalMaterial({ color: 0xf8fafc, roughness: 0.46, metalness: 0.05, clearcoat: 0.25 }))
      : null;

    // Pelvis / Shorts waist
    const pelvis = new THREE.Mesh(pelvisGeo, shortsMat);
    bodyPivot.add(pelvis);

    // Upper Torso Group (allows realistic spine counter-rotation vs hips!)
    const torsoGroup = new THREE.Group();
    torsoGroup.position.y = 0.04;
    bodyPivot.add(torsoGroup);

    const torso = new THREE.Mesh(torsoGeo, torsoMat);
    torso.castShadow = !isSoftwareGl;
    torsoGroup.add(torso);

    const collar = new THREE.Mesh(collarGeo, collarMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.set(0, 0.535, 0.004);
    torsoGroup.add(collar);

    // Neck + Head Group (allows subtle head look toward ball!)
    const neckHeadGroup = new THREE.Group();
    neckHeadGroup.position.set(0, 0.54, 0.005);
    torsoGroup.add(neckHeadGroup);

    const neck = new THREE.Mesh(neckGeo, skinMat);
    neck.position.y = 0.05;
    neckHeadGroup.add(neck);

    const head = new THREE.Mesh(headGeo, faceMat);
    head.position.set(0, 0.195, 0.006);
    head.scale.set(0.92, 1.09, 0.98);
    head.castShadow = !isSoftwareGl;
    neckHeadGroup.add(head);

    const nose = new THREE.Mesh(noseGeo, skinMat);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0.188, 0.118);
    neckHeadGroup.add(nose);

    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(earGeo, skinMat);
      ear.scale.set(0.55, 1.2, 0.85);
      ear.position.set(sx * 0.106, 0.19, 0);
      neckHeadGroup.add(ear);
    }

    // Hair styles
    if (hairStyle === 0) {
      const hair = new THREE.Mesh(hairShortGeo, hairMat);
      hair.position.set(0, 0.21, -0.006);
      hair.scale.set(0.94, 1.07, 1.0);
      hair.rotation.x = -0.22;
      neckHeadGroup.add(hair);
    } else if (hairStyle === 1) {
      const hairBase = new THREE.Mesh(hairShortGeo, hairMat);
      hairBase.position.set(0, 0.205, -0.008);
      hairBase.scale.set(0.93, 1.06, 0.99);
      hairBase.rotation.x = -0.25;
      neckHeadGroup.add(hairBase);
      const top = new THREE.Mesh(hairTopGeo, hairMat);
      top.rotation.x = Math.PI / 2 - 0.18;
      top.position.set(0, 0.285, 0.02);
      top.scale.set(0.9, 0.95, 0.72);
      neckHeadGroup.add(top);
    } else if (hairStyle === 2) {
      const curly = new THREE.Mesh(hairCurlyGeo, hairMat);
      curly.position.set(0, 0.245, -0.014);
      curly.scale.set(0.95, 0.9, 0.98);
      neckHeadGroup.add(curly);
    } else {
      // Buzzcut close cap
      const buzz = new THREE.Mesh(hairShortGeo, hairMat);
      buzz.position.set(0, 0.202, -0.005);
      buzz.scale.set(0.925, 1.07, 0.985);
      buzz.rotation.x = -0.2;
      neckHeadGroup.add(buzz);
    }

    // Articulated 2-Segment Arms (attached to torsoGroup so shoulders twist naturally!)
    const buildArm = (xOff: number): { arm: THREE.Group; forearm: THREE.Group } => {
      const arm = new THREE.Group();
      arm.position.set(xOff, 0.465, 0);

      const shoulder = new THREE.Mesh(shoulderGeo, jerseyMat);
      arm.add(shoulder);

      if (isRef || longSleeves) {
        const upper = new THREE.Mesh(longUpperArmGeo, jerseyMat);
        upper.castShadow = !isSoftwareGl;
        arm.add(upper);
      } else {
        const sleeve = new THREE.Mesh(sleeveGeo, jerseyMat);
        sleeve.castShadow = !isSoftwareGl;
        arm.add(sleeve);
        const skinUpper = new THREE.Mesh(upperArmSkinGeo, skinMat);
        arm.add(skinUpper);
      }

      const forearm = new THREE.Group();
      forearm.position.set(0, -0.27, 0);
      arm.add(forearm);

      const elbow = new THREE.Mesh(elbowGeo, isRef || longSleeves ? jerseyMat : skinMat);
      forearm.add(elbow);

      const lowerMesh = new THREE.Mesh(forearmGeo, isRef || longSleeves ? jerseyMat : skinMat);
      lowerMesh.castShadow = !isSoftwareGl;
      forearm.add(lowerMesh);

      if (gloveMat) {
        const glove = new THREE.Mesh(gkGloveGeo, gloveMat);
        glove.position.set(0, -0.255, 0.012);
        forearm.add(glove);
      } else {
        const hand = new THREE.Mesh(handGeo, skinMat);
        hand.scale.set(0.85, 1.25, 0.72);
        hand.position.set(0, -0.25, 0.005);
        forearm.add(hand);
      }

      torsoGroup.add(arm);
      return { arm, forearm };
    };
    const leftArmRig = buildArm(-0.235);
    const rightArmRig = buildArm(0.235);

    // Articulated 2-Segment Legs (Hip -> Thigh -> Knee -> Shin/Calf -> Boot)
    const buildLeg = (xOff: number): { leg: THREE.Group; shin: THREE.Group } => {
      const leg = new THREE.Group();
      leg.position.set(xOff, -0.02, 0);

      const hipSocket = new THREE.Mesh(hipSocketGeo, shortsMat);
      leg.add(hipSocket);

      const shortsLeg = new THREE.Mesh(shortsLegGeo, shortsMat);
      shortsLeg.castShadow = !isSoftwareGl;
      leg.add(shortsLeg);

      const lowerThigh = new THREE.Mesh(bareThighKneeGeo, skinMat);
      leg.add(lowerThigh);

      const shin = new THREE.Group();
      shin.position.set(0, -0.41, 0);
      leg.add(shin);

      const knee = new THREE.Mesh(kneeCapGeo, skinMat);
      shin.add(knee);

      const calf = new THREE.Mesh(calfSockGeo, socksMat);
      calf.castShadow = !isSoftwareGl;
      shin.add(calf);

      const cuff = new THREE.Mesh(sockCuffGeo, collarMat);
      cuff.position.y = -0.036;
      shin.add(cuff);

      // Sculpted Football Boot at ankle (y = -0.41)
      const bootGroup = new THREE.Group();
      bootGroup.position.set(0, -0.425, 0.045);

      const upper = new THREE.Mesh(bootUpperGeo, bootMat);
      upper.rotation.x = Math.PI / 2;
      upper.scale.set(0.95, 1.0, 0.76);
      upper.castShadow = !isSoftwareGl;
      bootGroup.add(upper);

      const sole = new THREE.Mesh(bootSoleGeo, soleMat);
      sole.position.y = -0.032;
      bootGroup.add(sole);

      shin.add(bootGroup);
      bodyPivot.add(leg);
      return { leg, shin };
    };
    const leftLegRig = buildLeg(-0.105);
    const rightLegRig = buildLeg(0.105);

    // Soft ground contact shadow
    const shadowDisc = new THREE.Mesh(shadowGeo, shadowMat);
    shadowDisc.rotation.x = -Math.PI / 2;
    shadowDisc.position.y = 0.015;
    root.add(shadowDisc);

    // Overhead label sprite
    const labelTex = track(makePlayerLabelTexture(slot.number, isRef ? 'Судья' : slot.shortName, jerseyHex));
    const spriteMat = track(new THREE.SpriteMaterial({
      map: labelTex,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    }));
    const nameSprite = new THREE.Sprite(spriteMat);
    nameSprite.position.set(0, 2.32, 0);
    nameSprite.scale.set(2.5, 0.56, 1);
    nameSprite.renderOrder = 10;
    nameSprite.visible = !isRef;
    root.add(nameSprite);

    let cardMesh: THREE.Mesh | undefined;
    if (isRef) {
      cardMesh = new THREE.Mesh(cardGeo, cardYellowMat);
      cardMesh.position.set(0.28, 1.95, 0.2);
      cardMesh.visible = false;
      root.add(cardMesh);
    }

    root.position.set(slot.baseX, 0, slot.baseZ);
    root.visible = slot.active;
    group.add(root);

    return {
      slot,
      root,
      hips,
      bodyPivot,
      torsoGroup,
      neckHeadGroup,
      leftArm: leftArmRig.arm,
      leftForearm: leftArmRig.forearm,
      rightArm: rightArmRig.arm,
      rightForearm: rightArmRig.forearm,
      leftLeg: leftLegRig.leg,
      leftShin: leftLegRig.shin,
      rightLeg: rightLegRig.leg,
      rightShin: rightLegRig.shin,
      shadowDisc,
      nameSprite,
      cardMesh,
      curX: slot.baseX,
      curZ: slot.baseZ,
      curY: 0,
      vx: 0,
      vz: 0,
      speed: 0,
      facing: slot.side === 'home' ? Math.PI / 2 : -Math.PI / 2,
      turnLean: 0,
      stridePhase: ((Math.abs(hash) % 100) / 100) * Math.PI * 2,
      breathPhase: ((Math.abs(hash >> 4) % 100) / 100) * Math.PI * 2,
      kickTimer: 0,
      kickDuration: 0.52,
      celebrateTimer: 0,
      diveTimer: 0,
      diveDir: 1,
      tackleTimer: 0,
      cardTimer: 0,
    };
  };

  for (const s of slots) {
    const isH = s.side === 'home';
    const jHex = s.isGk ? (isH ? kits.homeGk : kits.awayGk) : (isH ? kits.homeJersey : kits.awayJersey);
    const shHex = s.isGk ? '#0f172a' : (isH ? kits.homeShorts : kits.awayShorts);
    const skHex = s.isGk ? jHex : (isH ? kits.homeSocks : kits.awaySocks);
    const secHex = s.isGk ? '#ffffff' : (isH ? kits.homeShorts : kits.awayShorts);
    rigs.set(s.id, createRig(s, jHex, shHex, skHex, secHex, false));
  }

  const refSlot: PlayerSlot = {
    id: '__referee__',
    name: 'Арбитр',
    shortName: 'Судья',
    number: 0,
    side: 'home',
    pos: 'REF',
    isGk: false,
    isStarter: true,
    baseX: -4,
    baseZ: -6,
    active: true,
    sentOff: false,
  };
  const refereeRig = createRig(refSlot, '#1e293b', '#090d14', '#111827', '#facc15', true);

  // Active Ball Carrier Turf Ring
  const carrierRingGeo = track(new THREE.RingGeometry(0.55, 0.78, 28));
  const carrierRingMat = track(new THREE.MeshBasicMaterial({
    color: 0xf0c419,
    transparent: true,
    opacity: 0.78,
    side: THREE.DoubleSide,
    depthWrite: false,
  }));
  const carrierRing = new THREE.Mesh(carrierRingGeo, carrierRingMat);
  carrierRing.rotation.x = -Math.PI / 2;
  carrierRing.position.y = 0.025;
  carrierRing.visible = false;
  group.add(carrierRing);

  let globalLabelsOn = true;

  const setLabelsVisible = (visible: boolean) => {
    globalLabelsOn = visible;
  };

  const updateLabelsVisibility = (activeActorIds: Set<string>, forceAll: boolean) => {
    rigs.forEach(rig => {
      if (!rig.root.visible) {
        rig.nameSprite.visible = false;
        return;
      }
      if (!globalLabelsOn) {
        rig.nameSprite.visible = activeActorIds.has(rig.slot.id);
      } else {
        rig.nameSprite.visible = forceAll || activeActorIds.has(rig.slot.id) || rig.slot.isGk;
      }
    });
  };

  const animateRigs = (dt: number, elapsed: number, carrierId: string | null, ballPos?: THREE.Vector3) => {
    const damp = (a: number, b: number, lambda: number) => THREE.MathUtils.damp(a, b, lambda, dt);

    const animateOne = (rig: PlayerRig) => {
      if (!rig.root.visible) return;
      rig.root.position.set(rig.curX, rig.curY, rig.curZ);

      const spd = rig.speed;
      // Smooth heading from true velocity, or look toward ball when nearly stationary
      let yawDelta = 0;
      if (spd > 0.35) {
        const targetYaw = Math.atan2(rig.vx, rig.vz);
        let diff = targetYaw - rig.facing;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const step = diff * Math.min(1, dt * 10);
        rig.facing += step;
        yawDelta = step / Math.max(0.008, dt);
      } else if (ballPos) {
        const dxB = ballPos.x - rig.curX;
        const dzB = ballPos.z - rig.curZ;
        if (dxB * dxB + dzB * dzB > 0.4) {
          const targetYaw = Math.atan2(dxB, dzB);
          let diff = targetYaw - rig.facing;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          rig.facing += diff * Math.min(1, dt * 4.5);
        }
      }
      rig.root.rotation.y = rig.facing;
      rig.turnLean = damp(rig.turnLean, THREE.MathUtils.clamp(-yawDelta * 0.045, -0.24, 0.24), 10);

      // Continuous biomechanical gait blend (0 = idle -> 0.35 = jog -> 1.0 = sprint)
      const moveBlend = THREE.MathUtils.clamp(spd / 6.8, 0, 1);

      let targetHipY = 0.90;
      let targetHipRotY = 0;
      let targetBodyPitch = 0;
      let targetBodyRoll = rig.turnLean;
      let targetTorsoTwist = 0;

      let targetLLegX = 0;
      let targetLShinX = 0.06;
      let targetRLegX = 0;
      let targetRShinX = 0.06;

      let targetLArmX = 0;
      let targetLArmZ = 0.14;
      let targetLForeX = -0.28;
      let targetRArmX = 0;
      let targetRArmZ = -0.14;
      let targetRForeX = -0.28;

      if (spd > 0.25) {
        const strideFreq = 5.2 + moveBlend * 7.8;
        rig.stridePhase += dt * strideFreq;

        const ph = rig.stridePhase;
        const hipAmp = 0.22 + moveBlend * 0.68;

        // Three.js +X rotation swings leg BACK (+angle) or FORWARD (-angle):
        // Forward reach when sin(ph) > 0 -> negative X rotation on thigh!
        const lSin = Math.sin(ph);
        const rSin = Math.sin(ph + Math.PI);

        targetLLegX = -lSin * hipAmp;
        targetRLegX = -rSin * hipAmp;

        // Realistic knee flexion (only bends backward = positive rotation on shin!):
        // Peaks during back-swing recovery (~cos(ph) < 0 / transitioning forward)
        const lKneeBend = Math.max(0, -Math.cos(ph)) * (0.45 + moveBlend * 1.05) + Math.max(0, lSin) * 0.14;
        const rKneeBend = Math.max(0, -Math.cos(ph + Math.PI)) * (0.45 + moveBlend * 1.05) + Math.max(0, rSin) * 0.14;
        targetLShinX = 0.08 + lKneeBend;
        targetRShinX = 0.08 + rKneeBend;

        // Counter-swing arms with bent elbows
        const armAmp = 0.28 + moveBlend * 0.72;
        targetLArmX = lSin * armAmp;
        targetRArmX = rSin * armAmp;
        targetLForeX = -(0.45 + moveBlend * 0.78 + Math.max(0, -lSin) * 0.25);
        targetRForeX = -(0.45 + moveBlend * 0.78 + Math.max(0, -rSin) * 0.25);
        targetLArmZ = 0.14 + moveBlend * 0.06;
        targetRArmZ = -(0.14 + moveBlend * 0.06);

        // Double-frequency vertical center-of-mass bounce + subtle sprint lean & torso counter-twist
        targetHipY = 0.90 - moveBlend * 0.03 + Math.abs(Math.cos(ph)) * (0.02 + moveBlend * 0.045);
        targetBodyPitch = 0.05 + moveBlend * 0.20;
        targetHipRotY = lSin * (0.04 + moveBlend * 0.09);
        targetTorsoTwist = -lSin * (0.06 + moveBlend * 0.14);
      } else {
        // Athletic ready / idle stance (slight knee bend, weight shift, breathing)
        const br = Math.sin(elapsed * 2.3 + rig.breathPhase);
        const sway = Math.sin(elapsed * 1.15 + rig.breathPhase * 1.7);
        targetHipY = 0.895 + br * 0.008;
        targetBodyPitch = rig.slot.isGk ? 0.14 : 0.04;
        targetLLegX = -0.05 + sway * 0.02;
        targetRLegX = 0.05 - sway * 0.02;
        targetLShinX = rig.slot.isGk ? 0.24 : 0.10;
        targetRShinX = rig.slot.isGk ? 0.24 : 0.10;
        targetLArmX = br * 0.03;
        targetRArmX = -br * 0.03;
        targetLArmZ = rig.slot.isGk ? 0.28 : 0.14;
        targetRArmZ = rig.slot.isGk ? -0.28 : -0.14;
        targetLForeX = rig.slot.isGk ? -0.75 : -0.32;
        targetRForeX = rig.slot.isGk ? -0.75 : -0.32;
      }

      // Subtle head glance toward ball
      let targetHeadYaw = 0;
      if (ballPos) {
        const angToBall = Math.atan2(ballPos.x - rig.curX, ballPos.z - rig.curZ);
        let diff = angToBall - rig.facing;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        targetHeadYaw = THREE.MathUtils.clamp(diff, -0.55, 0.55);
      }

      // Multi-phase biomechanics action overlays
      if (rig.kickTimer > 0) {
        rig.kickTimer = Math.max(0, rig.kickTimer - dt);
        const frac = 1 - rig.kickTimer / Math.max(0.1, rig.kickDuration);
        if (frac < 0.35) {
          // Wind-up: plant left foot, pull right thigh back, bend knee tightly
          const w = frac / 0.35;
          targetLLegX = -0.22 * w;
          targetLShinX = 0.25 * w;
          targetRLegX = 0.85 * w;
          targetRShinX = 1.25 * w;
          targetLArmX = -0.55 * w;
          targetLArmZ = 0.42 * w;
          targetTorsoTwist = 0.28 * w;
          targetBodyPitch = -0.06 * w;
        } else {
          // Whip strike & follow-through
          const s = Math.sin(((frac - 0.35) / 0.65) * Math.PI);
          targetLLegX = 0.18 * s;
          targetLShinX = 0.18;
          targetRLegX = -1.28 * s;
          targetRShinX = 0.12 + 0.35 * (1 - s);
          targetLArmX = -0.82 * s;
          targetLArmZ = 0.48 * s;
          targetRArmX = 0.52 * s;
          targetTorsoTwist = -0.35 * s;
          targetBodyPitch = -0.14 * s;
        }
      }

      if (rig.tackleTimer > 0) {
        rig.tackleTimer = Math.max(0, rig.tackleTimer - dt);
        const p = Math.sin((rig.tackleTimer / 0.65) * Math.PI);
        targetHipY = 0.90 - p * 0.52;
        targetBodyPitch = -0.82 * p;
        targetRLegX = -1.35 * p;
        targetRShinX = 0.12;
        targetLLegX = 0.45 * p;
        targetLShinX = 1.35 * p;
        targetLArmX = 0.75 * p;
        targetRArmX = -0.65 * p;
      }

      if (rig.diveTimer > 0) {
        rig.diveTimer = Math.max(0, rig.diveTimer - dt);
        const p = Math.sin((rig.diveTimer / 1.05) * Math.PI);
        targetHipY = 0.90 + p * 0.28 - (1 - p) * 0.15;
        targetBodyRoll = rig.diveDir * 1.28 * p;
        targetBodyPitch = 0.15 * p;
        targetLArmZ = 2.75 * p;
        targetRArmZ = -2.75 * p;
        targetLArmX = -0.55 * p;
        targetRArmX = -0.55 * p;
        targetLForeX = -0.12;
        targetRForeX = -0.12;
        targetLShinX = 0.42 * p;
        targetRShinX = 0.22 * p;
      }

      if (rig.celebrateTimer > 0) {
        rig.celebrateTimer = Math.max(0, rig.celebrateTimer - dt);
        const hop = Math.abs(Math.sin(elapsed * 8.5 + rig.stridePhase));
        targetHipY = 0.90 + hop * 0.28;
        targetLArmZ = 2.35;
        targetRArmZ = -2.35;
        targetLArmX = -0.35;
        targetRArmX = -0.35;
        targetLForeX = -0.2;
        targetRForeX = -0.2;
        targetLShinX = 0.25 + hop * 0.45;
        targetRShinX = 0.25 + hop * 0.45;
      }

      // Exponentially damp every joint for zero joint popping!
      const jRate = 18;
      rig.hips.position.y = damp(rig.hips.position.y, targetHipY, 16);
      rig.hips.rotation.y = damp(rig.hips.rotation.y, targetHipRotY, 14);
      rig.bodyPivot.rotation.x = damp(rig.bodyPivot.rotation.x, targetBodyPitch, 14);
      rig.bodyPivot.rotation.z = damp(rig.bodyPivot.rotation.z, targetBodyRoll, 12);
      rig.torsoGroup.rotation.y = damp(rig.torsoGroup.rotation.y, targetTorsoTwist, 14);
      rig.neckHeadGroup.rotation.y = damp(rig.neckHeadGroup.rotation.y, targetHeadYaw, 8);

      rig.leftLeg.rotation.x = damp(rig.leftLeg.rotation.x, targetLLegX, jRate);
      rig.leftShin.rotation.x = damp(rig.leftShin.rotation.x, targetLShinX, jRate);
      rig.rightLeg.rotation.x = damp(rig.rightLeg.rotation.x, targetRLegX, jRate);
      rig.rightShin.rotation.x = damp(rig.rightShin.rotation.x, targetRShinX, jRate);

      rig.leftArm.rotation.x = damp(rig.leftArm.rotation.x, targetLArmX, jRate);
      rig.leftArm.rotation.z = damp(rig.leftArm.rotation.z, targetLArmZ, jRate);
      rig.leftForearm.rotation.x = damp(rig.leftForearm.rotation.x, targetLForeX, jRate);
      rig.rightArm.rotation.x = damp(rig.rightArm.rotation.x, targetRArmX, jRate);
      rig.rightArm.rotation.z = damp(rig.rightArm.rotation.z, targetRArmZ, jRate);
      rig.rightForearm.rotation.x = damp(rig.rightForearm.rotation.x, targetRForeX, jRate);

      if (rig.cardTimer > 0 && rig.cardMesh) {
        rig.cardTimer = Math.max(0, rig.cardTimer - dt);
        rig.rightArm.rotation.x = damp(rig.rightArm.rotation.x, -2.55, 16);
        rig.rightForearm.rotation.x = damp(rig.rightForearm.rotation.x, -0.15, 16);
        rig.cardMesh.visible = true;
        rig.cardMesh.position.set(0.24, 2.15, 0.25);
        if (rig.cardTimer <= 0) rig.cardMesh.visible = false;
      } else if (rig.cardMesh) {
        rig.cardMesh.visible = false;
      }
    };

    rigs.forEach(animateOne);
    animateOne(refereeRig);

    const carrierRig = carrierId ? rigs.get(carrierId) : undefined;
    if (carrierRig && carrierRig.root.visible) {
      carrierRing.visible = true;
      carrierRing.position.set(carrierRig.curX, 0.028, carrierRig.curZ);
      const pulseScale = 1 + Math.sin(elapsed * 5.2) * 0.07;
      carrierRing.scale.setScalar(pulseScale);
    } else {
      carrierRing.visible = false;
    }
  };

  scene.add(group);

  return {
    group,
    rigs,
    refereeRig,
    carrierRing,
    setLabelsVisible,
    updateLabelsVisibility,
    animateRigs,
    dispose: () => {
      scene.remove(group);
      for (const d of disposables) d.dispose();
    },
  };
}

export function setRefereeCardColor(refRig: PlayerRig, kind: 'yellow' | 'red'): void {
  if (!refRig.cardMesh) return;
  const mat = refRig.cardMesh.material as THREE.MeshBasicMaterial;
  mat.color.setHex(kind === 'red' ? 0xef4444 : 0xfacc15);
  refRig.cardTimer = 2.8;
}
