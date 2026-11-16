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
  // GK on goal line edge
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
    // Spread lines from own defense (-34) to forward line (-6)
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
  let xBias = 0; // relative to attacking half: + pushes closer to opponent goal
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

  if (t.includes('лев')) zBias = -22;
  else if (t.includes('прав')) zBias = 22;

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

    // Fallback from match stats if lineups weren't attached
    if (!starters.length && m.stats?.players) {
      const sidePls = Object.entries(m.stats.players)
        .map(([pid, p]: [string, any]) => ({ id: p.id || pid, name: p.n || 'Игрок', pos: p.pos || 'ЦП', side: p.side, started: p.started !== false }))
        .filter(p => p.side === side);
      starters = sidePls.filter(p => p.started).slice(0, 11);
      bench = sidePls.filter(p => !starters.some(s => s.id === p.id));
    }

    // Ensure at least 11 slots for visual authenticity
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
  keyEventSecs: { sec: number; type: string; label: string; score: [number, number] }[];
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
    return { segments: [], startTimeSec: 0, endTimeSec: 90 * 60, keyEventSecs: [] };
  }

  // Normalize negative pre-match minutes smoothly into [-30..0] right before kickoff
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
  const keyEventSecs: { sec: number; type: string; label: string; score: [number, number] }[] = [];

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
  let lastBallX = 0;
  let lastBallZ = 0;

  for (let idx = 0; idx < cleanEvents.length; idx++) {
    const ev = cleanEvents[idx];
    const t = Math.max(lastEndSec, rawTime(ev));

    // Synthesize midfield passing play if there is a gap > 14 match-seconds between real events
    if (t - lastEndSec > 14 && t >= 0) {
      const gapStart = Math.max(0, lastEndSec);
      const gapEnd = t;
      const sideCycle: ('home' | 'away') = idx % 2 === 0 ? 'home' : 'away';
      const pool = sideCycle === 'home' ? homeStarters : awayStarters;
      const numHops = Math.min(5, Math.max(2, Math.floor((gapEnd - gapStart) / 35)));
      const hopDur = (gapEnd - gapStart) / numHops;
      let prevX = lastBallX;
      let prevZ = lastBallZ;

      for (let h = 0; h < numHops; h++) {
        const pFrom = pool[1 + ((idx + h * 3) % Math.max(1, pool.length - 1))];
        const pTo = pool[1 + ((idx + h * 3 + 2) % Math.max(1, pool.length - 1))];
        const hs = gapStart + h * hopDur;
        const he = hs + hopDur;
        const [bx1, bz1] = playerBaseInHalf(pFrom, hs);
        const [bx2, bz2] = playerBaseInHalf(pTo, he);
        const targetX = Math.max(-44, Math.min(44, (bx2 * 0.7 + prevX * 0.3) + Math.sin(idx + h) * 6));
        const targetZ = Math.max(-30, Math.min(30, bz2 * 0.8 + Math.cos(idx + h * 2) * 5));
        segments.push({
          id: `syn_${idx}_${h}`,
          evIndex: ev.i,
          startSec: hs,
          endSec: he,
          type: 'pass',
          team: sideCycle,
          text: cleanEvents[Math.max(0, idx - 1)]?.text || 'Команды разыгрывают мяч в центре поля',
          score: idx > 0 ? cleanEvents[idx - 1].score : ev.score,
          actorIds: [pFrom.id, pTo.id],
          ballStart: [prevX || bx1, 0.24, prevZ || bz1],
          ballPeakY: 0.45,
          ballEnd: [targetX, 0.24, targetZ],
          ballCurveZ: 0.6,
          isSynthesized: true,
        });
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
    const dur = ev.type === 'goal' || ev.type === 'own_goal'
      ? 9
      : ['shot', 'save', 'post', 'miss', 'penalty', 'red', 'yellow', 'var', 'corner', 'freekick'].includes(ev.type)
        ? 7
        : 5;

    const p0 = getPlayer(ev.pids?.[0], side, 8);
    const p1 = getPlayer(ev.pids?.[1], ev.type === 'tackle' || ev.type === 'duel' || ev.type === 'save' ? oppSide : side, 6);
    const [p0x, p0z] = playerBaseInHalf(p0, t);
    const zone = inferZoneFromText(ev.text || '');

    let bStart: [number, number, number] = [lastBallX, 0.24, lastBallZ];
    let bEnd: [number, number, number] = [atkDir * 12, 0.24, zone.zBias * 0.6];
    let peakY = 0.45;
    let curveZ = 0;

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
      const shotOriginX = ev.type === 'own_goal' ? targetGoalX - scoreAtkDir * 7.5 : targetGoalX - scoreAtkDir * (12 + (idx % 9));
      const shotOriginZ = Math.max(-14, Math.min(14, zone.zBias * 0.45 + ((idx % 3) - 1) * 5));
      const cornerZ = ((idx % 2 === 0 ? 1 : -1) * 2.35);
      bStart = [shotOriginX, 0.24, shotOriginZ];
      bEnd = [targetGoalX + scoreAtkDir * 1.15, 0.85, cornerZ];
      peakY = 1.65;
      curveZ = (idx % 2 === 0 ? -1.4 : 1.4);
      keyEventSecs.push({ sec: t, type: ev.type, label: `${ev.min}' ГОЛ! ${ev.players?.[0] || ''}`, score: ev.score });
    } else if (ev.type === 'save') {
      isSave = true;
      bStart = [oppGoalX - atkDir * 16, 0.24, ((idx % 3) - 1) * 6];
      bEnd = [oppGoalX - atkDir * 2.2, 0.55, (idx % 2 === 0 ? 1 : -1) * 4.5];
      peakY = 1.85;
      curveZ = 0.8;
      keyEventSecs.push({ sec: t, type: 'save', label: `${ev.min}' Сейв`, score: ev.score });
    } else if (ev.type === 'post') {
      isPost = true;
      bStart = [oppGoalX - atkDir * 18, 0.24, ((idx % 3) - 1) * 4];
      bEnd = [oppGoalX, 2.15, (idx % 2 === 0 ? 3.55 : -3.55)];
      peakY = 2.4;
      keyEventSecs.push({ sec: t, type: 'post', label: `${ev.min}' Штанга/Перекладина`, score: ev.score });
    } else if (ev.type === 'miss' || ev.type === 'shot') {
      isMiss = ev.type === 'miss';
      bStart = [oppGoalX - atkDir * 20, 0.24, zone.zBias * 0.4];
      bEnd = [oppGoalX + atkDir * 2.5, ev.type === 'miss' ? 2.8 : 1.2, (idx % 2 === 0 ? 5.2 : -5.2)];
      peakY = 2.6;
    } else if (ev.type === 'penalty') {
      isSetPiece = 'penalty';
      bStart = [oppGoalX - atkDir * 11, 0.24, 0];
      bEnd = [oppGoalX - atkDir * 1.5, 1.1, 2.2];
      peakY = 1.2;
      keyEventSecs.push({ sec: t, type: 'penalty', label: `${ev.min}' Пенальти`, score: ev.score });
    } else if (ev.type === 'corner') {
      isSetPiece = 'corner';
      const cz = idx % 2 === 0 ? -33.2 : 33.2;
      bStart = [oppGoalX - atkDir * 0.6, 0.24, cz];
      bEnd = [oppGoalX - atkDir * 8.5, 0.3, 0];
      peakY = 3.8;
      curveZ = cz > 0 ? -3.2 : 3.2;
    } else if (ev.type === 'freekick') {
      isSetPiece = 'freekick';
      bStart = [oppGoalX - atkDir * 24, 0.24, zone.zBias * 0.45];
      bEnd = [oppGoalX - atkDir * 4.5, 1.1, 0];
      peakY = 3.1;
      curveZ = 2.2;
    } else if (ev.type === 'yellow' || ev.type === 'red') {
      isCard = ev.type;
      bStart = [Math.max(-35, Math.min(35, p0x)), 0.24, Math.max(-24, Math.min(24, p0z))];
      bEnd = bStart;
      peakY = 0.24;
      keyEventSecs.push({ sec: t, type: ev.type, label: `${ev.min}' ${ev.type === 'red' ? 'КК' : 'ЖК'} ${ev.players?.[0] || ''}`, score: ev.score });
    } else if (ev.type === 'sub' && ev.pids?.length >= 2) {
      subPair = { inId: ev.pids[0], outId: ev.pids[1], side };
      bStart = [lastBallX, 0.24, lastBallZ];
      bEnd = bStart;
      peakY = 0.24;
    } else if (ev.type === 'kickoff') {
      isSetPiece = 'kickoff';
      bStart = [0, 0.24, 0];
      bEnd = [-atkDir * 14, 0.24, (idx % 2 === 0 ? 6 : -6)];
      peakY = 0.35;
    } else if (ev.type === 'halftime' || ev.type === 'fulltime') {
      bStart = [0, 0.24, 0];
      bEnd = [0, 0.24, 0];
      peakY = 0.24;
    } else {
      // Dynamic pass, dribble, tackle, duel, foul, offside, possession
      const sx = Math.max(-42, Math.min(42, p0x * 0.55 + atkDir * zone.xBias * 0.45));
      const sz = Math.max(-29, Math.min(29, zone.zBias || p0z * 0.65));
      const [p1x, p1z] = playerBaseInHalf(p1, t);
      const ex = Math.max(-44, Math.min(44, (p1x * 0.45 + sx * 0.55) + atkDir * 9));
      const ez = Math.max(-29, Math.min(29, p1z * 0.65 + ((idx % 3) - 1) * 5));
      bStart = [sx, 0.24, sz];
      bEnd = [ex, 0.24, ez];
      peakY = ev.type === 'dribble' ? 0.3 : 1.15;
    }

    segments.push({
      id: `ev_${ev.i}_${idx}`,
      evIndex: ev.i,
      startSec: t,
      endSec: t + dur,
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
    });

    lastEndSec = t + dur;
    lastBallX = bEnd[0];
    lastBallZ = bEnd[2];
  }

  return {
    segments,
    startTimeSec: segments[0].startSec,
    endTimeSec: segments[segments.length - 1].endSec,
    keyEventSecs,
  };
}
