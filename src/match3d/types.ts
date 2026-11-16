import type * as THREE from 'three';

export interface TeamColors {
  primary: string;
  secondary: string;
}

export interface LineupPlayer {
  id: string;
  name: string;
  pos: string;
  slotPos?: string;
}

export interface TeamLineup {
  name?: string;
  logo?: string;
  formation?: string;
  roles?: Record<string, string>;
  starters?: LineupPlayer[];
  bench?: LineupPlayer[];
}

export interface MatchEvent {
  i: number;
  min: number;
  sec?: number;
  team: 'home' | 'away' | 'none';
  type: string;
  players?: string[];
  pids?: string[];
  text: string;
  xg?: number;
  score: [number, number];
}

export interface MatchPayload {
  fixture: {
    id: string;
    comp?: string;
    label?: string;
    home: string;
    away: string;
    homeName: string;
    awayName: string;
    homeLogo?: string;
    awayLogo?: string;
    homeColors?: TeamColors;
    awayColors?: TeamColors;
    status: string;
    hg: number | null;
    ag: number | null;
    pen?: { hg: number; ag: number } | null;
    stadium?: string;
    city?: string;
    gameTime?: string;
    weather?: string;
    weatherShort?: string;
    weatherDetails?: {
      icon?: string;
      condition?: string;
      tempC?: number;
      windMs?: number;
      precipMm?: number;
    } | null;
  };
  lineups?: {
    home?: TeamLineup;
    away?: TeamLineup;
  } | null;
  ctx?: {
    comp?: string;
    roundLabel?: string;
    stadium?: string;
    weather?: string;
    weatherDetails?: any;
    derby?: string;
  } | null;
  stats?: any;
}

export type CameraMode = 'tv' | 'tactical' | 'goal' | 'free';

export type WeatherKind = 'clear' | 'rain' | 'snow' | 'overcast';

export interface ResolvedAtmosphere {
  isNight: boolean;
  weather: WeatherKind;
  tempC: number;
  windMs: number;
  skyColorHex: number;
  fogColorHex: number;
  fogDensity: number;
  sunIntensity: number;
  floodlightIntensity: number;
}

export interface PlaySegment {
  id: string;
  evIndex: number;
  startSec: number;
  endSec: number;
  type: string;
  team: 'home' | 'away' | 'none';
  text: string;
  score: [number, number];
  actorIds: string[];
  ballStart: [number, number, number];
  ballPeakY: number;
  ballEnd: [number, number, number];
  ballCurveZ: number;
  isGoal?: boolean;
  isSave?: boolean;
  isPost?: boolean;
  isMiss?: boolean;
  isCard?: 'yellow' | 'red';
  isSetPiece?: 'kickoff' | 'corner' | 'freekick' | 'penalty';
  isHalftime?: boolean;
  isFulltime?: boolean;
  subPair?: { inId: string; outId: string; side: 'home' | 'away' };
  goalSide?: 'left' | 'right';
  isSynthesized?: boolean;
}

export interface PlayerSlot {
  id: string;
  name: string;
  shortName: string;
  number: number;
  side: 'home' | 'away';
  pos: string;
  isGk: boolean;
  isStarter: boolean;
  baseX: number;
  baseZ: number;
  active: boolean;
  sentOff: boolean;
}

export interface PlayerRig {
  slot: PlayerSlot;
  root: THREE.Group;
  bodyPivot: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  shadowDisc: THREE.Mesh;
  nameSprite: THREE.Sprite;
  cardMesh?: THREE.Mesh;
  curX: number;
  curZ: number;
  curY: number;
  facing: number;
  stridePhase: number;
  kickTimer: number;
  celebrateTimer: number;
  diveTimer: number;
  diveDir: number;
  tackleTimer: number;
  cardTimer: number;
}
