import * as THREE from 'three';
import { PITCH_LEN, PITCH_WID } from './textures';
import type { PlaySegment, PlayerRig, WeatherKind } from './types';

export const BALL_RADIUS = 0.22;
const GRAVITY = 9.81;
const SUB_DT = 1 / 120;
const HALF_LEN = PITCH_LEN / 2; // 52.5
const HALF_WID = PITCH_WID / 2; // 34.0
const GOAL_HALF_W = 3.66;
const GOAL_H = 2.44;
const GOAL_DEPTH = 2.25;
const POST_RADIUS = 0.085;

export interface TurfPhysicsProfile {
  restitution: number;
  rollDrag: number;
  airDrag: number;
  magnusCoeff: number;
  playerTraction: number;
}

export function getWeatherPhysicsProfile(weather: WeatherKind): TurfPhysicsProfile {
  if (weather === 'rain' || weather === 'storm') {
    return {
      restitution: 0.46,
      rollDrag: 0.62,     // wet slick grass -> ball skids fast!
      airDrag: 0.015,
      magnusCoeff: 0.014,
      playerTraction: 0.88,
    };
  }
  if (weather === 'snow' || weather === 'blizzard') {
    return {
      restitution: 0.35,  // soft snowy turf dampens bounce
      rollDrag: 1.75,     // snow slows rolling ball quickly
      airDrag: 0.018,
      magnusCoeff: 0.012,
      playerTraction: 0.76,
    };
  }
  return {
    restitution: 0.58,
    rollDrag: 0.96,
    airDrag: 0.012,
    magnusCoeff: 0.015,
    playerTraction: 1.0,
  };
}

export interface PhysicsCallbacks {
  onPostHit?: (side: 'left' | 'right', speed: number) => void;
  onNetHit?: (side: 'left' | 'right', speed: number) => void;
  onSaveDeflect?: (side: 'left' | 'right') => void;
  onKickImpact?: (strength: number) => void;
}

// Reusable module-scope math temporaries (Zero GC in tick loop)
const _up = new THREE.Vector3(0, 1, 0);
const _rollAxis = new THREE.Vector3();
const _deltaQuat = new THREE.Quaternion();
const _magnus = new THREE.Vector3();

export class MatchPhysicsWorld {
  public readonly ballPos = new THREE.Vector3(0, BALL_RADIUS, 0);
  public readonly ballVel = new THREE.Vector3(0, 0, 0);
  public readonly ballSpin = new THREE.Vector3(0, 0, 0);
  public readonly ballQuat = new THREE.Quaternion();

  public profile: TurfPhysicsProfile;
  private accum = 0;
  private activeSegId = '';
  private kickFired = false;
  private netTriggered = false;
  private postTriggered = false;
  private saveTriggered = false;
  private ballInNet = false;
  private callbacks: PhysicsCallbacks = {};

  constructor(weather: WeatherKind, callbacks?: PhysicsCallbacks) {
    this.profile = getWeatherPhysicsProfile(weather);
    if (callbacks) this.callbacks = callbacks;
  }

  public resetForSegment(seg: PlaySegment, immediateKick = false): void {
    this.activeSegId = seg.id;
    this.kickFired = immediateKick;
    this.netTriggered = false;
    this.postTriggered = false;
    this.saveTriggered = false;
    this.ballInNet = false;
    this.accum = 0;

    // Place ball cleanly at start if set-piece or first segment; otherwise keep continuous if close
    const sx = seg.ballStart[0];
    const sy = Math.max(BALL_RADIUS, seg.ballStart[1]);
    const sz = seg.ballStart[2];
    const distFromCurrent = Math.hypot(sx - this.ballPos.x, sz - this.ballPos.z);

    if (seg.isSetPiece || seg.isHalftime || seg.isFulltime || distFromCurrent > 4.5) {
      this.ballPos.set(sx, sy, sz);
      this.ballVel.set(0, 0, 0);
      this.ballSpin.set(0, 0, 0);
    }

    if (immediateKick) {
      this.fireSegmentKick(seg);
    }
  }

  public fireSegmentKick(seg: PlaySegment): void {
    this.kickFired = true;
    if (seg.isHalftime || seg.isFulltime || seg.isCard || seg.subPair) {
      this.ballVel.multiplyScalar(0.2);
      return;
    }

    const x0 = this.ballPos.x;
    const y0 = Math.max(BALL_RADIUS, this.ballPos.y);
    const z0 = this.ballPos.z;
    const [x1, y1Raw, z1] = seg.ballEnd;
    const y1 = Math.max(BALL_RADIUS, y1Raw);

    const dx = x1 - x0;
    const dz = z1 - z0;
    const horizDist = Math.hypot(dx, dz);

    if (seg.type === 'dribble') {
      // Dribble carrier smoothly pushes ball ahead along run path
      const dur = Math.max(0.8, seg.playEndSec - seg.playStartSec);
      this.ballVel.set(dx / dur, 0.25, dz / dur);
      this.ballSpin.set(0, 0, 0);
      return;
    }

    if (horizDist < 0.3) {
      this.ballVel.set(0, 0, 0);
      return;
    }

    const T = Math.max(0.35, seg.flightDurSec || 0.9);
    const isDirectShot = !!(seg.isGoal || seg.isSave || seg.isPost || seg.isMiss || seg.isSetPiece === 'penalty');
    const isLofted = seg.ballPeakY > 0.7 || isDirectShot || seg.isSetPiece === 'corner' || seg.isSetPiece === 'freekick';

    // Compensate slightly for air drag or rolling friction
    const dragBoost = isLofted
      ? 1 + this.profile.airDrag * horizDist * 0.48
      : 1 + this.profile.rollDrag * T * 0.42;

    const vx0 = (dx / T) * dragBoost;
    const vz0 = (dz / T) * dragBoost;
    const horizSpeed = Math.hypot(vx0, vz0);

    let vy0 = 0;
    if (isDirectShot) {
      // Exact vertical ballistic velocity to hit target height (post/crossbar/corner) at t = T
      vy0 = (y1 - y0 + 0.5 * GRAVITY * T * T) / T + this.profile.airDrag * 1.4;
    } else if (isLofted) {
      const directVy = (y1 - y0 + 0.5 * GRAVITY * T * T) / T;
      const minArcVy = Math.sqrt(2 * GRAVITY * Math.max(0.05, seg.ballPeakY - y0));
      vy0 = Math.max(directVy, minArcVy * 0.92);
    } else {
      vy0 = Math.min(2.2, Math.max(0.4, (seg.ballPeakY - BALL_RADIUS) * 3.5));
    }

    // Exact Magnus spin & initial angle compensation so curve peaks at ballCurveZ at T/2 and returns to target at T
    let spinY = 0;
    let curveComp = 0;
    if (Math.abs(seg.ballCurveZ) > 0.03 && horizSpeed > 1) {
      const aPerp = -(8 * seg.ballCurveZ) / (T * T);
      spinY = -aPerp / (this.profile.magnusCoeff * horizSpeed);
      curveComp = (4 * seg.ballCurveZ) / T;
    }

    const invLen = 1 / horizDist;
    const perpX = -dz * invLen;
    const perpZ = dx * invLen;

    this.ballVel.set(vx0 + perpX * curveComp, vy0, vz0 + perpZ * curveComp);
    this.ballSpin.set(0, spinY, 0);

    const strength = THREE.MathUtils.clamp(Math.hypot(vx0, vy0, vz0) / 22, 0.35, 1.25);
    this.callbacks.onKickImpact?.(strength);
  }

  public step(dt: number, seg: PlaySegment, segElapsedPlay: number): void {
    const segDur = Math.max(0.1, seg.playEndSec - seg.playStartSec);
    const frac = THREE.MathUtils.clamp(segElapsedPlay / segDur, 0, 1);

    if (seg.id !== this.activeSegId) {
      this.resetForSegment(seg, false);
    }

    if (!this.kickFired && frac >= seg.kickAtFrac) {
      this.fireSegmentKick(seg);
    }

    // During dribble segments, gently guide ball with slight dribble taps
    if (seg.type === 'dribble' && this.kickFired) {
      const targetX = THREE.MathUtils.lerp(seg.ballStart[0], seg.ballEnd[0], frac);
      const targetZ = THREE.MathUtils.lerp(seg.ballStart[2], seg.ballEnd[2], frac);
      const pull = Math.min(1, dt * 8);
      this.ballVel.x = THREE.MathUtils.lerp(this.ballVel.x, (targetX - this.ballPos.x) * 6, pull);
      this.ballVel.z = THREE.MathUtils.lerp(this.ballVel.z, (targetZ - this.ballPos.z) * 6, pull);
    }

    this.accum = Math.min(0.12, this.accum + dt);
    while (this.accum >= SUB_DT) {
      this.stepSub(SUB_DT, seg);
      this.accum -= SUB_DT;
    }
  }

  private stepSub(h: number, seg: PlaySegment): void {
    const p = this.ballPos;
    const v = this.ballVel;
    const prof = this.profile;

    const speed = v.length();
    const onGround = p.y <= BALL_RADIUS + 0.008 && Math.abs(v.y) < 0.45;

    if (onGround) {
      p.y = BALL_RADIUS;
      v.y = 0;
      // Grass rolling friction
      const horizSpeed = Math.hypot(v.x, v.z);
      if (horizSpeed > 0.02) {
        const decel = prof.rollDrag * (0.65 + horizSpeed * 0.06);
        const factor = Math.max(0, 1 - decel * h);
        v.x *= factor;
        v.z *= factor;
      } else {
        v.x = 0;
        v.z = 0;
      }
      this.ballSpin.multiplyScalar(Math.max(0, 1 - 2.5 * h));
    } else {
      // Airborne: gravity + quadratic air drag + Magnus force
      v.y -= GRAVITY * h;
      if (speed > 0.01) {
        const drag = prof.airDrag * speed;
        v.x -= v.x * drag * h;
        v.y -= v.y * drag * h;
        v.z -= v.z * drag * h;

        // F_magnus = k * (spin x vel)
        _magnus.crossVectors(this.ballSpin, v).multiplyScalar(prof.magnusCoeff * h);
        v.add(_magnus);
      }
    }

    p.addScaledVector(v, h);

    // Turf bounce
    if (p.y < BALL_RADIUS) {
      p.y = BALL_RADIUS;
      if (v.y < -0.55) {
        v.y = -v.y * prof.restitution;
        // Slight horizontal grip on bounce
        v.x *= 0.92;
        v.z *= 0.92;
      } else {
        v.y = 0;
      }
    }

    // Save parry physics near goal line
    if (seg.isSave && !this.saveTriggered && Math.abs(p.x) > HALF_LEN - 3.4 && Math.abs(p.z) < GOAL_HALF_W + 1.2) {
      this.saveTriggered = true;
      const side: 'left' | 'right' = p.x < 0 ? 'left' : 'right';
      const outDir = side === 'left' ? 1 : -1;
      v.x = outDir * Math.max(5.5, Math.abs(v.x) * 0.42);
      v.y = Math.max(2.4, Math.abs(v.y) * 0.5 + 1.8);
      v.z = (p.z >= 0 ? 1 : -1) * Math.max(3.5, Math.abs(v.z) + 2.2);
      this.callbacks.onSaveDeflect?.(side);
    }

    // 3D Goalpost & Crossbar collisions (at x = ±HALF_LEN)
    this.collideGoalFrame(-1, seg);
    this.collideGoalFrame(1, seg);

    // Goal Net Box Physics (x beyond ±HALF_LEN within goal mouth)
    this.collideGoalNet(-1);
    this.collideGoalNet(1);

    // Keep ball within stadium perimeter fences
    if (p.x > HALF_LEN + 6.5) { p.x = HALF_LEN + 6.5; v.x = -Math.abs(v.x) * 0.35; }
    if (p.x < -(HALF_LEN + 6.5)) { p.x = -(HALF_LEN + 6.5); v.x = Math.abs(v.x) * 0.35; }
    if (p.z > HALF_WID + 4.5) { p.z = HALF_WID + 4.5; v.z = -Math.abs(v.z) * 0.35; }
    if (p.z < -(HALF_WID + 4.5)) { p.z = -(HALF_WID + 4.5); v.z = Math.abs(v.z) * 0.35; }

    // Realistic quaternion rolling & spin rotation
    const horizSpeed = Math.hypot(v.x, v.z);
    if (horizSpeed > 0.03 && p.y <= BALL_RADIUS + 0.12) {
      _rollAxis.set(v.z, 0, -v.x).normalize();
      const angle = (horizSpeed * h) / BALL_RADIUS;
      _deltaQuat.setFromAxisAngle(_rollAxis, angle);
      this.ballQuat.premultiply(_deltaQuat).normalize();
    } else if (speed > 0.1) {
      _rollAxis.set(v.z, this.ballSpin.y * 0.45, -v.x);
      if (_rollAxis.lengthSq() > 0.0001) {
        _rollAxis.normalize();
        const angle = ((speed * 0.55 + Math.abs(this.ballSpin.y) * 0.8) * h) / BALL_RADIUS;
        _deltaQuat.setFromAxisAngle(_rollAxis, angle);
        this.ballQuat.premultiply(_deltaQuat).normalize();
      }
    }
  }

  private collideGoalFrame(dir: -1 | 1, seg: PlaySegment): void {
    const gx = dir * HALF_LEN;
    const p = this.ballPos;
    const v = this.ballVel;
    if (Math.abs(p.x - gx) > 0.45) return;

    const minDist = BALL_RADIUS + POST_RADIUS;

    // Two vertical goalposts at z = ±GOAL_HALF_W
    for (const pz of [-GOAL_HALF_W, GOAL_HALF_W]) {
      if (p.y <= GOAL_H + BALL_RADIUS) {
        const dx = p.x - gx;
        const dz = p.z - pz;
        const d = Math.hypot(dx, dz);
        if (d < minDist && d > 0.0001) {
          const nx = dx / d;
          const nz = dz / d;
          p.x = gx + nx * minDist;
          p.z = pz + nz * minDist;
          const vn = v.x * nx + v.z * nz;
          if (vn < 0) {
            const e = seg.isPost ? 0.82 : 0.74;
            v.x -= (1 + e) * vn * nx;
            v.z -= (1 + e) * vn * nz;
            if (!this.postTriggered) {
              this.postTriggered = true;
              this.callbacks.onPostHit?.(dir === -1 ? 'left' : 'right', Math.abs(vn));
            }
          }
        }
      }
    }

    // Horizontal crossbar at y = GOAL_H
    if (Math.abs(p.z) <= GOAL_HALF_W + POST_RADIUS) {
      const dx = p.x - gx;
      const dy = p.y - GOAL_H;
      const d = Math.hypot(dx, dy);
      if (d < minDist && d > 0.0001) {
        const nx = dx / d;
        const ny = dy / d;
        p.x = gx + nx * minDist;
        p.y = GOAL_H + ny * minDist;
        const vn = v.x * nx + v.y * ny;
        if (vn < 0) {
          const e = seg.isPost ? 0.82 : 0.74;
          v.x -= (1 + e) * vn * nx;
          v.y -= (1 + e) * vn * ny;
          if (!this.postTriggered) {
            this.postTriggered = true;
            this.callbacks.onPostHit?.(dir === -1 ? 'left' : 'right', Math.abs(vn));
          }
        }
      }
    }
  }

  private collideGoalNet(dir: -1 | 1): void {
    const gx = dir * HALF_LEN;
    const p = this.ballPos;
    const v = this.ballVel;

    const pastLine = dir === 1 ? p.x > gx + BALL_RADIUS * 0.4 : p.x < gx - BALL_RADIUS * 0.4;
    const insideWidth = Math.abs(p.z) < GOAL_HALF_W - BALL_RADIUS * 0.2;
    const underBar = p.y < GOAL_H - BALL_RADIUS * 0.2;
    const inBackZone = dir === 1 ? p.x < gx + GOAL_DEPTH + 0.5 : p.x > gx - (GOAL_DEPTH + 0.5);

    if (pastLine && insideWidth && underBar && inBackZone) {
      if (!this.ballInNet) {
        this.ballInNet = true;
      }
      // Back net boundary
      const backX = gx + dir * (GOAL_DEPTH - BALL_RADIUS * 1.1);
      if ((dir === 1 && p.x >= backX) || (dir === -1 && p.x <= backX)) {
        p.x = backX;
        const impact = Math.abs(v.x);
        v.x = -dir * Math.min(1.6, impact * 0.16);
        v.z *= 0.45;
        v.y *= 0.45;
        if (!this.netTriggered) {
          this.netTriggered = true;
          this.callbacks.onNetHit?.(dir === -1 ? 'left' : 'right', impact);
        }
      }
      // Side nets
      const sideLim = GOAL_HALF_W - BALL_RADIUS * 1.1;
      if (Math.abs(p.z) > sideLim) {
        p.z = Math.sign(p.z) * sideLim;
        v.z *= -0.25;
      }
      // Roof net
      if (p.y > GOAL_H - BALL_RADIUS * 1.1) {
        p.y = GOAL_H - BALL_RADIUS * 1.1;
        v.y = Math.min(0, -Math.abs(v.y) * 0.25);
      }
    }
  }
}

/**
 * Steering & pairwise separation physics for all 22 players + referee so nobody teleports,
 * slides unnaturally, or walks directly through another player.
 */
export function stepPlayersSteering(
  rigs: Map<string, PlayerRig>,
  refereeRig: PlayerRig,
  targetMap: Map<string, [number, number]>,
  refTarget: [number, number],
  dt: number,
  traction: number,
  carrierId: string | null
): void {
  const activeRigs: PlayerRig[] = [];
  rigs.forEach(rig => {
    if (rig.root.visible) activeRigs.push(rig);
  });

  const stepOne = (rig: PlayerRig, tx: number, tz: number, isCarrier: boolean) => {
    const dx = tx - rig.curX;
    const dz = tz - rig.curZ;
    const dist = Math.hypot(dx, dz);

    const baseMax = rig.slot.pos === 'REF'
      ? 6.9
      : rig.slot.isGk
        ? 6.2
        : isCarrier
          ? 8.4
          : 7.9;
    const maxSpeed = baseMax * traction;

    // Smooth arrival deceleration ramp within 2.5m so players never overshoot & oscillate
    let desVx = 0;
    let desVz = 0;
    if (dist > 0.04) {
      const ramp = dist < 2.2 ? (dist / 2.2) : 1.0;
      const targetSpd = maxSpeed * Math.max(0.18, ramp);
      desVx = (dx / dist) * targetSpd;
      desVz = (dz / dist) * targetSpd;
    }

    const accelRate = (dist > 0.1 ? 12.5 : 16.0) * traction;
    const blend = 1 - Math.exp(-accelRate * dt);
    rig.vx += (desVx - rig.vx) * blend;
    rig.vz += (desVz - rig.vz) * blend;

    rig.curX += rig.vx * dt;
    rig.curZ += rig.vz * dt;
    rig.speed = Math.hypot(rig.vx, rig.vz);
  };

  for (const rig of activeRigs) {
    const t = targetMap.get(rig.slot.id);
    if (t) stepOne(rig, t[0], t[1], rig.slot.id === carrierId);
  }
  stepOne(refereeRig, refTarget[0], refTarget[1], false);

  // Soft pairwise separation (min spacing 0.95m) so players avoid merging through each other
  const minSep = 0.95;
  const minSepSq = minSep * minSep;
  for (let i = 0; i < activeRigs.length; i++) {
    const a = activeRigs[i];
    for (let j = i + 1; j < activeRigs.length; j++) {
      const b = activeRigs[j];
      const dx = b.curX - a.curX;
      const dz = b.curZ - a.curZ;
      const dSq = dx * dx + dz * dz;
      if (dSq < minSepSq && dSq > 0.0001) {
        const d = Math.sqrt(dSq);
        const push = (minSep - d) * 0.45;
        const nx = dx / d;
        const nz = dz / d;
        a.curX -= nx * push;
        a.curZ -= nz * push;
        b.curX += nx * push;
        b.curZ += nz * push;
      }
    }
  }
}
