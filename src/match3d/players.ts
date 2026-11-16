import * as THREE from 'three';
import { makeJerseyBackTexture, makePlayerLabelTexture } from './textures';
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

  // Ensure away kit clearly contrasts against home kit AND against green grass (#256a38)
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
    homeGk: colorDist(hPrim, '#facc15') > 110 && colorDist(aPrim, '#facc15') > 110 ? '#eab308' : '#22d3ee',
    awayGk: colorDist(hPrim, '#f97316') > 110 && colorDist(aPrim, '#f97316') > 110 ? '#f97316' : '#a855f7',
  };
}

const SKIN_TONES = ['#f2c9a6', '#e6b48c', '#d4996e', '#a9704b', '#6d442b'];
const HAIR_TONES = ['#1a1614', '#382518', '#5c3c24', '#b88948', '#111827'];

export interface PlayersManager {
  group: THREE.Group;
  rigs: Map<string, PlayerRig>;
  refereeRig: PlayerRig;
  carrierRing: THREE.Mesh;
  setLabelsVisible: (visible: boolean) => void;
  updateLabelsVisibility: (activeActorIds: Set<string>, forceAll: boolean) => void;
  animateRigs: (dt: number, elapsed: number, carrierId: string | null) => void;
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

  // Shared player geometries to keep memory & draw setup lightweight
  const torsoGeo = track(new THREE.BoxGeometry(0.48, 0.56, 0.25));
  const sleeveGeo = track(new THREE.CylinderGeometry(0.065, 0.055, 0.2, 8));
  const armGeo = track(new THREE.CylinderGeometry(0.05, 0.044, 0.42, 8));
  const gloveGeo = track(new THREE.SphereGeometry(0.065, 8, 8));
  const shortsWaistGeo = track(new THREE.BoxGeometry(0.44, 0.22, 0.24));
  const thighGeo = track(new THREE.CylinderGeometry(0.075, 0.062, 0.26, 8));
  const sockGeo = track(new THREE.CylinderGeometry(0.055, 0.045, 0.34, 8));
  const bootGeo = track(new THREE.BoxGeometry(0.11, 0.08, 0.22));
  const headGeo = track(new THREE.SphereGeometry(0.145, 12, 10));
  const hairGeo = track(new THREE.SphereGeometry(0.15, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.58));
  const shadowGeo = track(new THREE.CircleGeometry(0.38, 16));
  const shadowMat = track(new THREE.MeshBasicMaterial({
    color: 0x050a07,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
  }));
  const bootMat = track(new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.45, metalness: 0.15 }));
  const cardYellowMat = track(new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide }));
  const cardRedMat = track(new THREE.MeshBasicMaterial({ color: 0xef4444, side: THREE.DoubleSide }));
  const cardGeo = track(new THREE.PlaneGeometry(0.16, 0.24));

  const createRig = (slot: PlayerSlot, jerseyHex: string, shortsHex: string, socksHex: string, isRef = false): PlayerRig => {
    const root = new THREE.Group();
    const bodyPivot = new THREE.Group();
    bodyPivot.position.y = 0.72;
    root.add(bodyPivot);

    // Deterministic skin/hair from ID
    let hash = 0;
    for (let i = 0; i < slot.id.length; i++) hash = (hash * 31 + slot.id.charCodeAt(i)) | 0;
    const skinHex = SKIN_TONES[Math.abs(hash) % SKIN_TONES.length];
    const hairHex = HAIR_TONES[Math.abs(hash >> 3) % HAIR_TONES.length];

    const jerseyMat = track(new THREE.MeshStandardMaterial({ color: jerseyHex, roughness: 0.72, metalness: 0.04 }));
    const shortsMat = track(new THREE.MeshStandardMaterial({ color: shortsHex, roughness: 0.76, metalness: 0.03 }));
    const socksMat = track(new THREE.MeshStandardMaterial({ color: socksHex, roughness: 0.74, metalness: 0.03 }));
    const skinMat = track(new THREE.MeshStandardMaterial({ color: skinHex, roughness: 0.65, metalness: 0.02 }));
    const hairMat = track(new THREE.MeshStandardMaterial({ color: hairHex, roughness: 0.85, metalness: 0.02 }));
    const gloveMat = slot.isGk
      ? track(new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.55 }))
      : null;

    // Back number plate on jersey
    const textLum = relLuminance(jerseyHex) > 0.5 ? '#0f172a' : '#ffffff';
    const numTex = track(makeJerseyBackTexture(slot.number, jerseyHex, textLum));
    const backNumMat = track(new THREE.MeshStandardMaterial({ map: numTex, roughness: 0.72 }));

    const torso = new THREE.Mesh(torsoGeo, [
      jerseyMat,
      jerseyMat,
      jerseyMat,
      jerseyMat,
      jerseyMat,
      backNumMat, // -Z is player back because player looks toward +Z in local space
    ]);
    torso.position.y = 0.34;
    torso.castShadow = !isSoftwareGl;
    bodyPivot.add(torso);

    const shortsWaist = new THREE.Mesh(shortsWaistGeo, shortsMat);
    shortsWaist.position.y = 0.02;
    bodyPivot.add(shortsWaist);

    // Head + hair cap
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.y = 0.79;
    head.castShadow = !isSoftwareGl;
    bodyPivot.add(head);

    const hair = new THREE.Mesh(hairGeo, hairMat);
    hair.position.y = 0.805;
    hair.rotation.x = -0.18;
    bodyPivot.add(hair);

    // Arms (pivoted at shoulders)
    const buildArm = (xOff: number): THREE.Group => {
      const p = new THREE.Group();
      p.position.set(xOff, 0.56, 0);
      const sleeve = new THREE.Mesh(sleeveGeo, jerseyMat);
      sleeve.position.y = -0.09;
      p.add(sleeve);
      const limb = new THREE.Mesh(armGeo, isRef || longSleeves ? jerseyMat : skinMat);
      limb.position.y = -0.26;
      p.add(limb);
      if (gloveMat) {
        const glove = new THREE.Mesh(gloveGeo, gloveMat);
        glove.position.y = -0.47;
        p.add(glove);
      }
      bodyPivot.add(p);
      return p;
    };
    const leftArm = buildArm(-0.3);
    const rightArm = buildArm(0.3);

    // Legs (pivoted at hips)
    const buildLeg = (xOff: number): THREE.Group => {
      const p = new THREE.Group();
      p.position.set(xOff, 0.0, 0);
      const thigh = new THREE.Mesh(thighGeo, shortsMat);
      thigh.position.y = -0.14;
      p.add(thigh);
      const sock = new THREE.Mesh(sockGeo, socksMat);
      sock.position.y = -0.44;
      p.add(sock);
      const boot = new THREE.Mesh(bootGeo, bootMat);
      boot.position.set(0, -0.65, 0.04);
      boot.castShadow = !isSoftwareGl;
      p.add(boot);
      bodyPivot.add(p);
      return p;
    };
    const leftLeg = buildLeg(-0.125);
    const rightLeg = buildLeg(0.125);

    // Soft ground contact shadow
    const shadowDisc = new THREE.Mesh(shadowGeo, shadowMat);
    shadowDisc.rotation.x = -Math.PI / 2;
    shadowDisc.position.y = 0.015;
    root.add(shadowDisc);

    // Crisp overhead billboard label sprite
    const labelTex = track(makePlayerLabelTexture(slot.number, isRef ? 'Судья' : slot.shortName, jerseyHex));
    const spriteMat = track(new THREE.SpriteMaterial({
      map: labelTex,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    }));
    const nameSprite = new THREE.Sprite(spriteMat);
    nameSprite.position.set(0, 2.25, 0);
    nameSprite.scale.set(2.55, 0.58, 1);
    nameSprite.renderOrder = 10;
    nameSprite.visible = !isRef;
    root.add(nameSprite);

    let cardMesh: THREE.Mesh | undefined;
    if (isRef) {
      cardMesh = new THREE.Mesh(cardGeo, cardYellowMat);
      cardMesh.position.set(0.34, 1.85, 0.12);
      cardMesh.visible = false;
      root.add(cardMesh);
    }

    root.position.set(slot.baseX, 0, slot.baseZ);
    root.visible = slot.active;
    group.add(root);

    return {
      slot,
      root,
      bodyPivot,
      leftArm,
      rightArm,
      leftLeg,
      rightLeg,
      shadowDisc,
      nameSprite,
      cardMesh,
      curX: slot.baseX,
      curZ: slot.baseZ,
      curY: 0,
      facing: slot.side === 'home' ? Math.PI / 2 : -Math.PI / 2,
      stridePhase: Math.random() * Math.PI * 2,
      kickTimer: 0,
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
    rigs.set(s.id, createRig(s, jHex, shHex, skHex, false));
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
  const refereeRig = createRig(refSlot, '#1e293b', '#090d14', '#111827', true);

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

  const animateRigs = (dt: number, elapsed: number, carrierId: string | null) => {
    const animateOne = (rig: PlayerRig) => {
      if (!rig.root.visible) return;
      const dx = rig.slot.baseX - rig.curX; // not used directly; velocity comes from delta between cur & root
      const vx = rig.curX - rig.root.position.x;
      const vz = rig.curZ - rig.root.position.z;
      const moveDist = Math.hypot(vx, vz);
      const speed = dt > 0.0001 ? moveDist / dt : 0;

      rig.root.position.set(rig.curX, rig.curY, rig.curZ);

      // Smooth yaw facing
      if (moveDist > 0.015) {
        const targetYaw = Math.atan2(vx, vz);
        let diff = targetYaw - rig.facing;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        rig.facing += diff * Math.min(1, dt * 11);
      }
      rig.root.rotation.y = rig.facing;

      // Stride cycle driven by ground speed
      if (speed > 0.45) {
        rig.stridePhase += dt * Math.min(18, speed * 2.15);
        const swing = Math.min(0.85, speed * 0.11) * Math.sin(rig.stridePhase);
        rig.leftLeg.rotation.x = swing;
        rig.rightLeg.rotation.x = -swing;
        rig.leftArm.rotation.x = -swing * 0.72;
        rig.rightArm.rotation.x = swing * 0.72;
        rig.bodyPivot.position.y = 0.72 + Math.abs(Math.cos(rig.stridePhase)) * 0.055;
        rig.bodyPivot.rotation.x = Math.min(0.16, speed * 0.018);
      } else {
        // Idle breathing & slight scan
        const idle = Math.sin(elapsed * 2.4 + rig.stridePhase) * 0.03;
        rig.leftLeg.rotation.x *= 0.82;
        rig.rightLeg.rotation.x *= 0.82;
        rig.leftArm.rotation.x = idle;
        rig.rightArm.rotation.x = -idle;
        rig.bodyPivot.position.y = 0.72 + idle * 0.3;
        rig.bodyPivot.rotation.x *= 0.85;
      }

      rig.bodyPivot.rotation.z *= 0.85;
      rig.leftArm.rotation.z = 0.12;
      rig.rightArm.rotation.z = -0.12;

      // Special action overlays
      if (rig.kickTimer > 0) {
        rig.kickTimer = Math.max(0, rig.kickTimer - dt);
        const p = Math.sin((rig.kickTimer / 0.42) * Math.PI);
        rig.rightLeg.rotation.x = -1.25 * p;
        rig.leftArm.rotation.x = -0.8 * p;
        rig.bodyPivot.rotation.x = -0.16 * p;
      }

      if (rig.tackleTimer > 0) {
        rig.tackleTimer = Math.max(0, rig.tackleTimer - dt);
        const p = Math.sin((rig.tackleTimer / 0.55) * Math.PI);
        rig.bodyPivot.position.y = 0.72 - p * 0.34;
        rig.bodyPivot.rotation.x = -0.75 * p;
        rig.rightLeg.rotation.x = -1.1 * p;
      }

      if (rig.diveTimer > 0) {
        rig.diveTimer = Math.max(0, rig.diveTimer - dt);
        const p = Math.sin((rig.diveTimer / 0.95) * Math.PI);
        rig.bodyPivot.position.y = 0.72 + p * 0.35;
        rig.bodyPivot.rotation.z = rig.diveDir * 1.15 * p;
        rig.leftArm.rotation.z = 2.6 * p;
        rig.rightArm.rotation.z = -2.6 * p;
      }

      if (rig.celebrateTimer > 0) {
        rig.celebrateTimer = Math.max(0, rig.celebrateTimer - dt);
        const hop = Math.abs(Math.sin(elapsed * 9.5 + rig.stridePhase)) * 0.38;
        rig.bodyPivot.position.y = 0.72 + hop;
        rig.leftArm.rotation.z = 2.45;
        rig.rightArm.rotation.z = -2.45;
        rig.leftArm.rotation.x = -0.35;
        rig.rightArm.rotation.x = -0.35;
      }

      if (rig.cardTimer > 0 && rig.cardMesh) {
        rig.cardTimer = Math.max(0, rig.cardTimer - dt);
        rig.rightArm.rotation.x = -2.45;
        rig.cardMesh.visible = true;
        rig.cardMesh.position.set(0.28, 2.05, 0.25);
        if (rig.cardTimer <= 0) rig.cardMesh.visible = false;
      } else if (rig.cardMesh) {
        rig.cardMesh.visible = false;
      }

      // Silence unused variable warning without extra work
      void dx;
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
    // Keep reference to card materials on manager via helper if needed
  };
}

export function setRefereeCardColor(refRig: PlayerRig, kind: 'yellow' | 'red'): void {
  if (!refRig.cardMesh) return;
  const mat = refRig.cardMesh.material as THREE.MeshBasicMaterial;
  mat.color.setHex(kind === 'red' ? 0xef4444 : 0xfacc15);
  refRig.cardTimer = 2.8;
}
