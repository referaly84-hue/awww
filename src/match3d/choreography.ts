import type { MatchEvent, MatchPayload, PlayerSlot, PlaySegment } from './types';

function shortPlayerName(full: string): string {
  const parts = String(full || 'Игрок').trim().split(/\s+/);
  if (parts.length >= 2) return parts[parts.length - 1];
  return parts[0] || 'Игрок';
}

function parseFormationCounts(formation?: string): number[] {
  const nums = String(formation || '4-3-3')
    .split('-')
    .map(n => parseInt(n, 10))
    .filter(n => Number.isFinite(n) && n > 0);
  return nums.length >= 2 ? nums : [4, 3, 3];
}

function generateLineupCoords(formation: string | undefined, count: number, side: 'home' | 'away'): [number, number][] {
  const coords: [number, number][] = [];
  const dir = side === 'home' ? 1 : -1;
  coords.push([dir * -47.5, 0]);

  const lines = parseFormationCounts(formation);
  const totalOutfield = Math.max(1, count - 1);
  const sum = lines.reduce((a, b) => a + b, 0);
  if (sum !== totalOutfield && lines.length > 0) {
    lines[lines.length - 1] += totalOutfield - sum;
  }

  const lineCount = lines.length;
  for (let li = 0; li < lineCount; li++) {
    const nInLine = Math.max(1, lines[li]);
    const frac = lineCount === 1 ? 0.5 : li / (lineCount - 1);
    const x = dir * (-34 + frac * 26);
    const spanZ = nInLine >= 4 ? 50 : nInLine === 3 ? 38 : nInLine === 2 ? 22 : 0;
    for (let j = 0; j < nInLine; j++) {
      const zFrac = nInLine === 1 ? 0 : j / (nInLine - 1) - 0.5;
      coords.push([x, zFrac * spanZ]);
    }
  }
  return coords;
}

function inferZoneFromText(text: string): { xBias: number; zBias: number } {
  const t = text.toLowerCase();
  let xBias = 0;
  let zBias = 0;

  if (t.includes('штрафн') || t.includes('вратар') || t.includes('пенальт') || t.includes('удар') || t.includes('гол') || t.includes('крестовин') || t.includes('штанг') || t.includes('сейв')) {
    xBias = 36;
  } else if (t.includes('углов') || t.includes('навес') || t.includes('прострел') || t.includes('фланг')) {
    xBias = 32;
  } else if (t.includes('контратак') || t.includes('подход') || t.includes('обостря') || t.includes('прорыв')) {
    xBias = 22;
  } else if (t.includes('центр') || t.includes('перепасов') || t.includes('контрол')) {
    xBias = 4;
  } else if (t.includes('вынос') || t.includes('оборон') || t.includes('собствен')) {
    xBias = -24;
  }

  if (t.includes('лев')) zBias = -20;
  else if (t.includes('прав')) zBias = 20;

  return { xBias, zBias };
}

export function buildPlayerSlots(m: MatchPayload): PlayerSlot[] {
  const slots: PlayerSlot[] = [];
  const usedNumsHome = new Set<number>();
  const usedNumsAway = new Set<number>();

  const pickNum = (used: Set<number>, idx: number, isGk: boolean): number => {
    if (isGk && !used.has(1)) { used.add(1); return 1; }
    const pref = [1, 2, 4, 5, 3, 6, 8, 10, 7, 11, 9, 12, 14, 17, 19, 20, 22, 23, 27, 77, 99][idx] || (idx + 2);
    let n = pref;
    while (used.has(n)) n++;
    used.add(n);
    return n;
  };

  for (const side of ['home', 'away'] as const) {
    const lu = m.lineups?.[side];
    const used = side === 'home' ? usedNumsHome : usedNumsAway;
    let starters = lu?.starters && lu.starters.length ? lu.starters : [];
    let bench = lu?.bench && lu.bench.length ? lu.bench : [];

    if (!starters.length && m.stats?.players) {
      const sidePls = Object.entries(m.stats.players)
        .map(([pid, p]: [string, any]) => ({ id: p.id || pid, name: p.n || 'Игрок', pos: p.pos || 'ЦП', side: p.side, started: p.started !== false }))
        .filter(p => p.side === side);
      starters = sidePls.filter(p => p.started).slice(0, 11);
      bench = sidePls.filter(p => !starters.some(s => s.id === p.id));
    }

    while (starters.length < 11) {
      const idx = starters.length;
      starters.push({
        id: `${side}_syn_${idx}`,
        name: idx === 0 ? 'Вратарь' : `Игрок ${idx + 1}`,
        pos: idx === 0 ? 'ВР' : idx < 5 ? 'ЗЩ' : idx < 9 ? 'ПЗ' : 'НП',
      });
    }

    const coords = generateLineupCoords(lu?.formation, starters.length, side);
    starters.forEach((p, idx) => {
      const isGk = idx === 0 || String(p.slotPos || p.pos).toUpperCase().includes('ВР');
      const [bx, bz] = coords[idx] || [side === 'home' ? -15 : 15, (idx - 5) * 8];
      slots.push({
        id: p.id,
        name: p.name,
        shortName: shortPlayerName(p.name),
        number: pickNum(used, idx, isGk),
        side,
        pos: p.slotPos || p.pos || 'ПЗ',
        isGk,
        isStarter: true,
        baseX: bx,
        baseZ: bz,
        active: true,
        sentOff: false,
      });
    });

    bench.forEach((p, idx) => {
      slots.push({
        id: p.id,
        name: p.name,
        shortName: shortPlayerName(p.name),
        number: pickNum(used, 11 + idx, false),
        side,
        pos: p.pos || 'ПЗ',
        isGk: String(p.pos).toUpperCase().includes('ВР'),
        isStarter: false,
        baseX: side === 'home' ? -13 + idx * 0.9 : 13 + idx * 0.9,
        baseZ: -37.2,
        active: false,
        sentOff: false,
      });
    });
  }

  return slots;
}

export interface TimelineBuild {
  segments: PlaySegment[];
  startTimeSec: number;
  endTimeSec: number;
  totalPlaySec: number;
  keyEventSecs: { sec: number; playSec: number; type: string; label: string; score: [number, number] }[];
}

export function buildMatchTimeline(evs: MatchEvent[], slots: PlayerSlot[]): TimelineBuild {
  const homeStarters = slots.filter(s => s.side === 'home' && s.isStarter);
  const awayStarters = slots.filter(s => s.side === 'away' && s.isStarter);
  const byId = new Map(slots.map(s => [s.id, s]));

  const cleanEvents = (evs || []).slice().sort((a, b) => {
    const ta = (a.min || 0) * 60 + (a.sec || 0);
    const tb = (b.min || 0) * 60 + (b.sec || 0);
    return ta - tb || (a.i || 0) - (b.i || 0);
  });

  if (!cleanEvents.length) {
    return { segments: [], startTimeSec: 0, endTimeSec: 90 * 60, totalPlaySec: 10, keyEventSecs: [] };
  }

  const rawTime = (ev: MatchEvent): number => {
    const t = (ev.min || 0) * 60 + (ev.sec || 0);
    if (t < 0) return Math.max(-25, t * 0.12);
    return t;
  };

  const attackDirAt = (side: 'home' | 'away', matchSec: number): 1 | -1 => {
    const secondHalf = matchSec >= 45 * 60;
    const baseDir = side === 'home' ? 1 : -1;
    return secondHalf ? (-baseDir as 1 | -1) : baseDir;
  };

  const segments: PlaySegment[] = [];
  const keyEventSecs: { sec: number; playSec: number; type: string; label: string; score: [number, number] }[] = [];

  const getPlayer = (pid: string | undefined, fallbackSide: 'home' | 'away', roleIdx = 5): PlayerSlot => {
    if (pid && byId.has(pid)) return byId.get(pid)!;
    const pool = fallbackSide === 'home' ? homeStarters : awayStarters;
    return pool[Math.min(pool.length - 1, Math.max(0, roleIdx))] || slots[0];
  };

  const playerBaseInHalf = (p: PlayerSlot, matchSec: number): [number, number] => {
    const secondHalf = matchSec >= 45 * 60;
    return secondHalf ? [-p.baseX, -p.baseZ] : [p.baseX, p.baseZ];
  };

  let lastEndSec = Math.min(0, rawTime(cleanEvents[0]));
  let playCursor = 0;
  let lastBallX = 0;
  let lastBallZ = 0;

  const pushSeg = (s: Omit<PlaySegment, 'playStartSec' | 'playEndSec'>, playDur: number) => {
    const seg: PlaySegment = {
      ...s,
      playStartSec: playCursor,
      playEndSec: playCursor + playDur,
    };
    segments.push(seg);
    playCursor += playDur;
  };

  for (let idx = 0; idx < cleanEvents.length; idx++) {
    const ev = cleanEvents[idx];
    const t = Math.max(lastEndSec, rawTime(ev));

    // Smoothly connect long gaps between real events using realistic connected passes
    if (t - lastEndSec > 18 && t >= 0) {
      const gapStart = Math.max(0, lastEndSec);
      const gapEnd = t;
      const sideCycle: ('home' | 'away') = idx % 2 === 0 ? 'home' : 'away';
      const pool = sideCycle === 'home' ? homeStarters : awayStarters;
      const numHops = Math.min(3, Math.max(2, Math.floor((gapEnd - gapStart) / 60)));
      const hopMatchDur = (gapEnd - gapStart) / numHops;
      let prevX = lastBallX;
      let prevZ = lastBallZ;

      for (let h = 0; h < numHops; h++) {
        const pFrom = pool[1 + ((idx + h * 3) % Math.max(1, pool.length - 1))];
        const pTo = pool[1 + ((idx + h * 3 + 2) % Math.max(1, pool.length - 1))];
        const hs = gapStart + h * hopMatchDur;
        const he = hs + hopMatchDur;
        const [bx2, bz2] = playerBaseInHalf(pTo, he);
        const targetX = Math.max(-42, Math.min(42, (bx2 * 0.65 + prevX * 0.35) + Math.sin(idx + h) * 5));
        const targetZ = Math.max(-29, Math.min(29, bz2 * 0.75 + Math.cos(idx + h * 2) * 4));
        const dist = Math.hypot(targetX - prevX, targetZ - prevZ);
        const flightDur = Math.max(0.65, Math.min(1.4, dist / 17));
        const playDur = flightDur + 0.85;

        pushSeg({
          id: `syn_${idx}_${h}`,
          evIndex: ev.i,
          startSec: hs,
          endSec: he,
          kickAtFrac: 0.16,
          flightDurSec: flightDur,
          type: 'pass',
          team: sideCycle,
          text: cleanEvents[Math.max(0, idx - 1)]?.text || 'Команды разыгрывают мяч',
          score: idx > 0 ? cleanEvents[idx - 1].score : ev.score,
          actorIds: [pFrom.id, pTo.id],
          ballStart: [prevX, 0.22, prevZ],
          ballPeakY: dist > 20 ? 1.4 : 0.36,
          ballEnd: [targetX, 0.22, targetZ],
          ballCurveZ: dist > 18 ? 0.75 : 0.25,
          isSynthesized: true,
        }, playDur);

        prevX = targetX;
        prevZ = targetZ;
      }
      lastBallX = prevX;
      lastBallZ = prevZ;
    }

    const side: 'home' | 'away' = ev.team === 'away' ? 'away' : 'home';
    const oppSide: 'home' | 'away' = side === 'home' ? 'away' : 'home';
    const atkDir = attackDirAt(side, t);
    const oppGoalX = atkDir * 52.5;
    const matchDur = ev.type === 'goal' || ev.type === 'own_goal'
      ? 9
      : ['shot', 'save', 'post', 'miss', 'penalty', 'red', 'yellow', 'var', 'corner', 'freekick'].includes(ev.type)
        ? 7
        : 5;

    const p0 = getPlayer(ev.pids?.[0], side, 8);
    const p1 = getPlayer(ev.pids?.[1], ev.type === 'tackle' || ev.type === 'duel' || ev.type === 'save' ? oppSide : side, 6);
    const [p0x, p0z] = playerBaseInHalf(p0, t);
    const zone = inferZoneFromText(ev.text || '');

    let bStart: [number, number, number] = [lastBallX, 0.22, lastBallZ];
    let bEnd: [number, number, number] = [atkDir * 12, 0.22, zone.zBias * 0.6];
    let peakY = 0.45;
    let curveZ = 0;
    let playDur = 2.8;
    let flightDurSec = 0.9;
    let kickAtFrac = 0.18;
    let needsBuildupPass = false;

    let isGoal = false;
    let isSave = false;
    let isPost = false;
    let isMiss = false;
    let isCard: 'yellow' | 'red' | undefined;
    let isSetPiece: PlaySegment['isSetPiece'];
    let goalSide: 'left' | 'right' | undefined;
    let subPair: PlaySegment['subPair'];

    if (ev.type === 'goal' || ev.type === 'own_goal') {
      isGoal = true;
      const scoringSide: 'home' | 'away' = ev.team === 'away' ? 'away' : 'home';
      const scoreAtkDir = attackDirAt(scoringSide, t);
      const targetGoalX = scoreAtkDir * 52.5;
      goalSide = targetGoalX < 0 ? 'left' : 'right';
      const shotOriginX = ev.type === 'own_goal' ? targetGoalX - scoreAtkDir * 7.5 : targetGoalX - scoreAtkDir * (13 + (idx % 8));
      const shotOriginZ = Math.max(-13, Math.min(13, zone.zBias * 0.45 + ((idx % 3) - 1) * 4.5));
      const cornerZ = ((idx % 2 === 0 ? 1 : -1) * 2.25);
      bStart = [shotOriginX, 0.22, shotOriginZ];
      bEnd = [targetGoalX + scoreAtkDir * 1.45, 0.95, cornerZ];
      peakY = 1.45;
      curveZ = (idx % 2 === 0 ? -1.15 : 1.15);
      flightDurSec = 0.62;
      kickAtFrac = 0.16;
      playDur = 4.6;
      needsBuildupPass = true;
    } else if (ev.type === 'save') {
      isSave = true;
      bStart = [oppGoalX - atkDir * 16, 0.22, ((idx % 3) - 1) * 5.5];
      bEnd = [oppGoalX - atkDir * 1.4, 1.05, (idx % 2 === 0 ? 1 : -1) * 2.4];
      peakY = 1.55;
      curveZ = 0.75;
      flightDurSec = 0.64;
      kickAtFrac = 0.18;
      playDur = 3.4;
      needsBuildupPass = true;
    } else if (ev.type === 'post') {
      isPost = true;
      bStart = [oppGoalX - atkDir * 17.5, 0.22, ((idx % 3) - 1) * 3.8];
      // Aim squarely at top post corner so physical goalpost collision triggers cleanly!
      bEnd = [oppGoalX, 2.28, (idx % 2 === 0 ? 3.62 : -3.62)];
      peakY = 2.45;
      curveZ = 0.4;
      flightDurSec = 0.66;
      kickAtFrac = 0.18;
      playDur = 3.5;
      needsBuildupPass = true;
    } else if (ev.type === 'miss' || ev.type === 'shot') {
      isMiss = ev.type === 'miss';
      bStart = [oppGoalX - atkDir * 19, 0.22, zone.zBias * 0.4];
      bEnd = [oppGoalX + atkDir * 2.6, ev.type === 'miss' ? 2.4 : 1.1, (idx % 2 === 0 ? 4.8 : -4.8)];
      peakY = 2.3;
      flightDurSec = 0.74;
      kickAtFrac = 0.18;
      playDur = 3.0;
      needsBuildupPass = true;
    } else if (ev.type === 'penalty') {
      isSetPiece = 'penalty';
      bStart = [oppGoalX - atkDir * 11, 0.22, 0];
      bEnd = [oppGoalX - atkDir * 1.1, 1.15, 2.15];
      peakY = 1.25;
      flightDurSec = 0.48;
      kickAtFrac = 0.28;
      playDur = 3.2;
    } else if (ev.type === 'corner') {
      isSetPiece = 'corner';
      const cz = idx % 2 === 0 ? -33.2 : 33.2;
      bStart = [oppGoalX - atkDir * 0.6, 0.22, cz];
      bEnd = [oppGoalX - atkDir * 8.5, 0.3, 0];
      peakY = 4.1;
      curveZ = cz > 0 ? -3.0 : 3.0;
      flightDurSec = 1.35;
      kickAtFrac = 0.24;
      playDur = 3.4;
    } else if (ev.type === 'freekick') {
      isSetPiece = 'freekick';
      bStart = [oppGoalX - atkDir * 24, 0.22, zone.zBias * 0.45];
      bEnd = [oppGoalX - atkDir * 3.8, 1.35, 0.8];
      peakY = 3.1;
      curveZ = 2.1;
      flightDurSec = 0.96;
      kickAtFrac = 0.25;
      playDur = 3.3;
    } else if (ev.type === 'yellow' || ev.type === 'red') {
      isCard = ev.type;
      bStart = [lastBallX, 0.22, lastBallZ];
      bEnd = bStart;
      peakY = 0.22;
      flightDurSec = 0.5;
      kickAtFrac = 0.1;
      playDur = 2.8;
    } else if (ev.type === 'sub' && ev.pids?.length >= 2) {
      subPair = { inId: ev.pids[0], outId: ev.pids[1], side };
      bStart = [lastBallX, 0.22, lastBallZ];
      bEnd = bStart;
      peakY = 0.22;
      flightDurSec = 0.5;
      kickAtFrac = 0.1;
      playDur = 2.3;
    } else if (ev.type === 'kickoff') {
      isSetPiece = 'kickoff';
      bStart = [0, 0.22, 0];
      bEnd = [-atkDir * 14, 0.22, (idx % 2 === 0 ? 6 : -6)];
      peakY = 0.34;
      flightDurSec = 0.92;
      kickAtFrac = 0.22;
      playDur = 2.5;
    } else if (ev.type === 'halftime' || ev.type === 'fulltime') {
      bStart = [0, 0.22, 0];
      bEnd = [0, 0.22, 0];
      peakY = 0.22;
      flightDurSec = 0.5;
      kickAtFrac = 0.1;
      playDur = 2.4;
    } else if (ev.type === 'dribble') {
      // Continue directly from ball's current location or short pass into stride
      const dTargetX = Math.max(-44, Math.min(44, lastBallX + atkDir * 16));
      const dTargetZ = Math.max(-28, Math.min(28, zone.zBias ? zone.zBias * 0.75 : lastBallZ * 0.75));
      bStart = [lastBallX, 0.22, lastBallZ];
      bEnd = [dTargetX, 0.22, dTargetZ];
      peakY = 0.26;
      flightDurSec = 1.9;
      kickAtFrac = 0.08;
      playDur = 2.4;
    } else {
      // Dynamic pass, tackle, duel, foul, offside, possession chained continuously
      const sx = lastBallX;
      const sz = lastBallZ;
      const [p1x, p1z] = playerBaseInHalf(p1, t);
      const ex = Math.max(-44, Math.min(44, (p1x * 0.45 + p0x * 0.25 + sx * 0.3) + atkDir * 10));
      const ez = Math.max(-29, Math.min(29, (zone.zBias ? zone.zBias * 0.65 : p1z * 0.65) + ((idx % 3) - 1) * 4));
      const dist = Math.hypot(ex - sx, ez - sz);
      bStart = [sx, 0.22, sz];
      bEnd = [ex, 0.22, ez];
      peakY = dist > 20 ? 1.55 : 0.4;
      curveZ = dist > 18 ? 0.65 : 0;
      flightDurSec = Math.max(0.6, Math.min(1.35, dist / 18));
      kickAtFrac = 0.16;
      playDur = flightDurSec + 0.9;
    }

    // Insert smooth buildup pass before shots/goals/saves/posts if ball is far from shot origin -> ZERO teleport!
    if (needsBuildupPass) {
      const distGap = Math.hypot(bStart[0] - lastBallX, bStart[2] - lastBallZ);
      if (distGap > 3.2) {
        const bFlight = Math.max(0.65, Math.min(1.4, distGap / 20));
        const passer = getPlayer(ev.pids?.[1], side, 6);
        pushSeg({
          id: `buildup_${ev.i}_${idx}`,
          evIndex: ev.i,
          startSec: Math.max(lastEndSec, t - 2),
          endSec: t,
          kickAtFrac: 0.15,
          flightDurSec: bFlight,
          type: 'pass',
          team: ev.team,
          text: ev.text,
          score: idx > 0 ? cleanEvents[idx - 1].score : ev.score,
          actorIds: [passer.id, p0.id],
          ballStart: [lastBallX, 0.22, lastBallZ],
          ballPeakY: distGap > 22 ? 1.5 : 0.36,
          ballEnd: [bStart[0], 0.22, bStart[2]],
          ballCurveZ: distGap > 18 ? 0.55 : 0,
          isBuildup: true,
        }, bFlight + 0.65);
      }
    }

    const segPlayStart = playCursor;
    pushSeg({
      id: `ev_${ev.i}_${idx}`,
      evIndex: ev.i,
      startSec: t,
      endSec: t + matchDur,
      kickAtFrac,
      flightDurSec,
      type: ev.type,
      team: ev.team,
      text: ev.text,
      score: ev.score,
      actorIds: (ev.pids && ev.pids.length) ? ev.pids : [p0.id, p1.id],
      ballStart: bStart,
      ballPeakY: peakY,
      ballEnd: bEnd,
      ballCurveZ: curveZ,
      isGoal,
      isSave,
      isPost,
      isMiss,
      isCard,
      isSetPiece,
      isHalftime: ev.type === 'halftime',
      isFulltime: ev.type === 'fulltime',
      subPair,
      goalSide,
    }, playDur);

    if (isGoal) {
      keyEventSecs.push({ sec: t, playSec: segPlayStart, type: ev.type, label: `${ev.min}' ГОЛ! ${ev.players?.[0] || ''}`, score: ev.score });
    } else if (isSave) {
      keyEventSecs.push({ sec: t, playSec: segPlayStart, type: 'save', label: `${ev.min}' Сейв`, score: ev.score });
    } else if (isPost) {
      keyEventSecs.push({ sec: t, playSec: segPlayStart, type: 'post', label: `${ev.min}' Штанга/Перекладина`, score: ev.score });
    } else if (isSetPiece === 'penalty') {
      keyEventSecs.push({ sec: t, playSec: segPlayStart, type: 'penalty', label: `${ev.min}' Пенальти`, score: ev.score });
    } else if (isCard) {
      keyEventSecs.push({ sec: t, playSec: segPlayStart, type: ev.type, label: `${ev.min}' ${ev.type === 'red' ? 'КК' : 'ЖК'} ${ev.players?.[0] || ''}`, score: ev.score });
    }

    lastEndSec = t + matchDur;
    // After goal, next action resets around center; after save/post, ball rebounds near penalty box
    if (isGoal) {
      lastBallX = 0;
      lastBallZ = 0;
    } else if (isPost || isSave) {
      lastBallX = oppGoalX - atkDir * 11;
      lastBallZ = bEnd[2] * 0.5;
    } else {
      lastBallX = bEnd[0];
      lastBallZ = bEnd[2];
    }
  }

  return {
    segments,
    startTimeSec: segments[0].startSec,
    endTimeSec: segments[segments.length - 1].endSec,
    totalPlaySec: Math.max(1, playCursor),
    keyEventSecs,
  };
}
