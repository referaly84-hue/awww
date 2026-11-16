import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { MatchAudioEngine } from './audio';
import { buildMatchTimeline, buildPlayerSlots, type TimelineBuild } from './choreography';
import { buildDemoMatch, type DemoPresetId } from './demo';
import { MatchPhysicsWorld, stepPlayersSteering } from './physics';
import { buildPlayersManager, resolveMatchKits, setRefereeCardColor, type PlayersManager } from './players';
import { BroadcastCasVignetteShader, createStadiumEnvironmentTexture } from './shaders';
import { buildStadiumAndAtmosphere, resolveAtmosphere, type StadiumRig } from './stadium';
import type { CameraMode, MatchEvent, MatchPayload, PlayerSlot, PlaySegment } from './types';

function detectSoftwareGl(renderer: THREE.WebGLRenderer): boolean {
  try {
    const gl = renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const str = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || '');
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(str);
  } catch {
    return false;
  }
}

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

function formatClock(sec: number): string {
  if (sec < 0) return 'ДО МАТЧА';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

class Match3DEngine {
  private host: HTMLElement | null = null;
  private matchId: string | null = null;
  private payload: MatchPayload | null = null;
  private events: MatchEvent[] = [];
  private slots: PlayerSlot[] = [];
  private timeline: TimelineBuild = { segments: [], startTimeSec: 0, endTimeSec: 5400, totalPlaySec: 10, keyEventSecs: [] };

  private renderer: THREE.WebGLRenderer | null = null;
  private composer: EffectComposer | null = null;
  private composerRt: THREE.WebGLRenderTarget | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private casPass: ShaderPass | null = null;

  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private controls: OrbitControls | null = null;
  private pmremEnv: THREE.WebGLRenderTarget | null = null;
  private stadium: StadiumRig | null = null;
  private players: PlayersManager | null = null;
  private physics: MatchPhysicsWorld | null = null;
  private audio = new MatchAudioEngine();

  private isSoftwareGl = false;
  private rtxEnabled = true;
  private resizeObs: ResizeObserver | null = null;
  private rafId = 0;
  private afterDrawTimeout = 0;
  private destroyed = false;
  private hiddenPaused = false;
  private contextLost = false;

  // Continuous real-time simulation state
  private playSec = 0;
  private simMatchSec = 0;
  private playing = true;
  private speed = 1;
  private cameraMode: CameraMode = 'tv';
  private userCameraOverride = false;
  private showNames = true;
  private hudVisible = true;
  private dockCollapsed = false;
  private lastClockTime = 0;
  private elapsedReal = 0;
  private lastTriggeredSegId = '';
  private goalBannerTimer = 0;
  private goalBannerTeam = '';
  private goalMood = 0;
  private camShake = 0;
  private actionCamTimer = 0;
  private shotSpeedTimer = 0;
  private shotSpeedKmh = 0;
  private onActiveEventChange?: (evIndex: number) => void;

  // Pre-allocated math objects (zero GC in tick loop)
  private readonly camTarget = new THREE.Vector3(0, 0.8, 0);
  private readonly camDesiredPos = new THREE.Vector3(0, 34, 62);
  private readonly camDesiredTarget = new THREE.Vector3(0, 0.8, 0);
  private readonly camFocus = new THREE.Vector3(0, 0.22, 0);
  private readonly activeActorIds = new Set<string>();
  private readonly slotTargetMap = new Map<string, [number, number]>();
  private readonly refTarget: [number, number] = [-4, -6];

  // UI elements
  private stageEl: HTMLElement | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private dockEl: HTMLElement | null = null;
  private scoreEl: HTMLElement | null = null;
  private clockEl: HTMLElement | null = null;
  private tickerEl: HTMLElement | null = null;
  private goalFlashEl: HTMLElement | null = null;
  private shotBadgeEl: HTMLElement | null = null;
  private scrubFillEl: HTMLElement | null = null;
  private scrubThumbEl: HTMLElement | null = null;
  private scrubMarkersEl: HTMLElement | null = null;
  private playBtnEl: HTMLButtonElement | null = null;
  private contextFallbackEl: HTMLElement | null = null;
  private keyDownHandler: ((e: KeyboardEvent) => void) | null = null;

  public mount(
    container: HTMLElement,
    payload: MatchPayload,
    events: MatchEvent[],
    opts?: { onActiveEvent?: (evIndex: number) => void }
  ): void {
    const newId = payload?.fixture?.id;
    if (this.host === container && this.matchId === newId && this.renderer) {
      this.update(payload, events);
      return;
    }

    this.destroy();
    this.destroyed = false;
    this.host = container;
    this.matchId = newId || null;
    this.payload = payload;
    this.events = (events || []).slice();
    this.onActiveEventChange = opts?.onActiveEvent;

    this.slots = buildPlayerSlots(payload);
    this.timeline = buildMatchTimeline(this.events, this.slots);

    if (payload.fixture.status === 'live' && this.timeline.segments.length) {
      const lastSeg = this.timeline.segments[this.timeline.segments.length - 1];
      this.playSec = Math.max(0, lastSeg.playStartSec);
    } else {
      const kickoffSeg = this.timeline.segments.find(s => s.startSec >= 0) || this.timeline.segments[0];
      this.playSec = kickoffSeg ? kickoffSeg.playStartSec : 0;
    }
    this.simMatchSec = this.computeMatchSecAt(this.playSec);

    this.playing = true;
    this.hiddenPaused = false;
    this.userCameraOverride = false;
    this.lastTriggeredSegId = '';
    this.goalBannerTimer = 0;
    this.goalMood = 0;
    this.camShake = 0;
    this.actionCamTimer = 0;
    this.shotSpeedTimer = 0;

    this.buildDom(container, payload);
    this.initThree(payload);

    const firstSeg = this.getSegmentAtPlay(this.playSec);
    if (firstSeg && this.physics) {
      this.physics.resetForSegment(firstSeg, false);
      this.camFocus.copy(this.physics.ballPos);
    }

    this.renderScrubberMarkers();
    this.syncHudImmediate();
    this.startLoop();
  }

  public update(payload: MatchPayload, events: MatchEvent[]): void {
    if (this.destroyed || !this.renderer) return;
    const prevLen = this.events.length;
    this.payload = payload;
    this.events = (events || []).slice();
    this.timeline = buildMatchTimeline(this.events, this.slots);
    this.renderScrubberMarkers();

    if (this.events.length > prevLen && payload.fixture.status === 'live') {
      const newestSeg = this.timeline.segments[this.timeline.segments.length - 1];
      if (newestSeg && newestSeg.playStartSec - this.playSec < 18) {
        this.playSec = newestSeg.playStartSec;
        this.playing = true;
      }
    }
    this.syncHudImmediate();
  }

  public jumpToEvent(evIndex: number): void {
    const seg = this.timeline.segments.find(s => s.evIndex === evIndex && !s.isSynthesized && !s.isBuildup)
      || this.timeline.segments.find(s => s.evIndex === evIndex);
    if (!seg) return;
    this.seekPlaySec(seg.playStartSec);
    this.playing = true;
    this.updatePlayButton();
    this.stageEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  public setPausedIfHidden(hidden: boolean): void {
    this.hiddenPaused = hidden;
    if (!hidden && !this.destroyed && this.renderer) {
      this.lastClockTime = performance.now();
    }
  }

  private seekPlaySec(targetPlaySec: number): void {
    this.playSec = Math.max(0, Math.min(this.timeline.totalPlaySec, targetPlaySec));
    this.simMatchSec = this.computeMatchSecAt(this.playSec);
    this.lastTriggeredSegId = '';
    this.actionCamTimer = 0;
    const seg = this.getSegmentAtPlay(this.playSec);
    if (seg && this.physics) {
      this.physics.resetForSegment(seg, false);
      this.camFocus.copy(this.physics.ballPos);
      const secondHalf = this.simMatchSec >= 45 * 60;
      this.players?.rigs.forEach(rig => {
        const s = rig.slot;
        rig.curX = secondHalf ? -s.baseX : s.baseX;
        rig.curZ = secondHalf ? -s.baseZ : s.baseZ;
        rig.vx = 0;
        rig.vz = 0;
        rig.speed = 0;
      });
    }
    this.syncHudImmediate();
  }

  private buildDom(container: HTMLElement, m: MatchPayload): void {
    const f = m.fixture;
    const hCol = f.homeColors?.primary || '#1e88e5';
    const aCol = f.awayColors?.primary || '#e53935';
    const weatherStr = m.ctx?.weather || f.weather || '';
    const isLive = f.status === 'live';

    container.innerHTML = `
      <div class="m3d-shell" style="position:relative;border-radius:12px;overflow:hidden;background:#08120e;border:1px solid #20382d;box-shadow:0 12px 34px rgba(10,25,18,0.34);margin-bottom:16px;user-select:none">
        <div class="m3d-stage" style="position:relative;width:100%;height:clamp(360px,58vh,600px);background:#091321">
          <canvas class="m3d-canvas" style="display:block;width:100%;height:100%;touch-action:none"></canvas>

          <div class="m3d-fallback" style="display:none;position:absolute;inset:0;background:#0c1713;color:#e2eee7;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center;gap:8px;z-index:25">
            <div style="font:700 16px Unbounded,sans-serif">3D-рендер временно недоступен</div>
            <div style="font-size:13px;color:#9bb3a5;max-width:420px">Контекст WebGL был сброшен или не поддерживается браузером. Текстовая хроника матча ниже продолжает работать в обычном режиме.</div>
          </div>

          <div class="m3d-hud" style="position:absolute;inset:0;pointer-events:none;z-index:10">
            <div style="position:absolute;top:12px;left:12px;right:12px;display:flex;align-items:flex-start;justify-content:space-between;gap:8px;flex-wrap:wrap">
              <div style="pointer-events:auto;display:flex;align-items:center;background:rgba(8,14,12,0.90);border:1px solid rgba(255,255,255,0.16);border-radius:6px;overflow:hidden;color:#fff;font-size:12.5px">
                <span style="padding:6px 9px;background:${isLive ? '#c62828' : '#1b5c3f'};font:700 11px Unbounded,sans-serif;letter-spacing:.04em;color:#fff">${isLive ? 'ПРЯМОЙ ЭФИР' : 'РПЛ HD'}</span>
                <span style="width:5px;align-self:stretch;background:${escapeHtml(hCol)}"></span>
                <span style="padding:6px 10px;font-weight:700;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(f.homeName)}</span>
                <span class="m3d-score" style="padding:5px 10px;background:rgba(255,255,255,0.12);font:800 15px Unbounded,sans-serif;color:#f0c419">0 : 0</span>
                <span style="padding:6px 10px;font-weight:700;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(f.awayName)}</span>
                <span style="width:5px;align-self:stretch;background:${escapeHtml(aCol)}"></span>
                <span class="m3d-clock" style="padding:6px 10px;background:rgba(0,0,0,0.42);font:700 12px ui-monospace,Consolas,monospace;color:#cfe8d9;min-width:58px;text-align:center">00:00</span>
              </div>

              <div style="pointer-events:auto;display:flex;align-items:center;gap:6px">
                <span class="m3d-shot-badge" style="display:none;padding:5px 9px;background:rgba(15,23,42,0.9);border:1px solid rgba(240,196,25,0.55);border-radius:6px;color:#f0c419;font:700 11.5px Unbounded,sans-serif"></span>
                ${(() => {
                  const at = resolveAtmosphere(m);
                  const tStr = `${at.tempC > 0 ? '+' : ''}${at.tempC}°C`;
                  const sMap = { winter: 'Зима', spring: 'Весна', summer: 'Лето', autumn: 'Осень' };
                  return `<span style="padding:5px 9px;background:rgba(8,14,12,0.84);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:#cde0d5;font-size:11.5px;white-space:nowrap">${escapeHtml(at.city)} · ${sMap[at.season]} · ${tStr} · ${escapeHtml(at.conditionLabel || weatherStr.split(',')[0])}</span>`;
                })()}
                <button type="button" data-act="toggle-hud" title="Скрыть/показать интерфейс [H]" style="cursor:pointer;padding:6px 10px;background:rgba(8,14,12,0.86);border:1px solid rgba(255,255,255,0.16);border-radius:6px;color:#e6f2ec;font-size:12px;font-weight:600">HUD</button>
                <button type="button" data-act="fullscreen" title="Во весь экран" style="cursor:pointer;padding:6px 10px;background:rgba(8,14,12,0.86);border:1px solid rgba(255,255,255,0.16);border-radius:6px;color:#e6f2ec;font-size:12px;font-weight:600">⛶</button>
              </div>
            </div>

            <div class="m3d-goal-flash" style="display:none;position:absolute;left:50%;top:62px;transform:translateX(-50%);background:rgba(10,36,26,0.96);border:2px solid #f0c419;border-radius:8px;padding:10px 24px;color:#fff;text-align:center;box-shadow:0 10px 28px rgba(0,0,0,0.5)">
              <div style="font:800 22px Unbounded,sans-serif;color:#f0c419;letter-spacing:.05em">ГОООЛ!</div>
              <div class="m3d-goal-team" style="font:600 13px Onest,sans-serif;color:#e7f4ec;margin-top:2px"></div>
            </div>

            <div class="m3d-ticker-wrap" style="position:absolute;left:12px;right:12px;bottom:10px;display:flex;justify-content:center">
              <div class="m3d-ticker" style="background:rgba(8,14,12,0.88);border:1px solid rgba(255,255,255,0.14);border-radius:6px;padding:7px 14px;color:#eef7f2;font-size:13px;line-height:1.35;max-width:760px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Подготовка к матчу…</div>
            </div>
          </div>
        </div>

        <div class="m3d-dock" style="background:#0c1914;border-top:1px solid #1e372c;color:#e4f0e9;padding:10px 12px;display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:11px;font-weight:700;color:#8bb09b;min-width:28px">0'</span>
            <div class="m3d-scrub" style="position:relative;flex:1;height:14px;display:flex;align-items:center;cursor:pointer">
              <div style="position:relative;width:100%;height:6px;background:#1e352b;border-radius:3px;overflow:visible">
                <div class="m3d-scrub-fill" style="height:100%;width:0%;background:#2f7d55;border-radius:3px"></div>
                <div class="m3d-scrub-markers" style="position:absolute;inset:0;pointer-events:none"></div>
                <div class="m3d-scrub-thumb" style="position:absolute;top:50%;left:0%;width:13px;height:13px;transform:translate(-50%,-50%);background:#f0c419;border:2px solid #091410;border-radius:3px"></div>
              </div>
            </div>
            <span style="font-size:11px;font-weight:700;color:#8bb09b;min-width:28px;text-align:right">90'</span>
          </div>

          <div class="m3d-dock-controls" style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
            <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
              <button type="button" data-act="prev" title="Предыдущее событие" style="cursor:pointer;padding:6px 9px;background:#152a21;border:1px solid #28493a;border-radius:6px;color:#e4f0e9;font-size:12px;font-weight:700">⏮</button>
              <button type="button" class="m3d-play-btn" data-act="play" style="cursor:pointer;padding:6px 14px;background:#2f7d55;border:1px solid #3c9868;border-radius:6px;color:#fff;font-size:12.5px;font-weight:700;min-width:92px">⏸ Пауза</button>
              <button type="button" data-act="next" title="Следующее событие" style="cursor:pointer;padding:6px 9px;background:#152a21;border:1px solid #28493a;border-radius:6px;color:#e4f0e9;font-size:12px;font-weight:700">⏭</button>
              ${isLive ? `<button type="button" data-act="golive" style="cursor:pointer;padding:6px 10px;background:#991b1b;border:1px solid #dc2626;border-radius:6px;color:#fff;font-size:11.5px;font-weight:700">В эфир</button>` : ''}

              <div style="display:inline-flex;border:1px solid #28493a;border-radius:6px;overflow:hidden;margin-left:4px">
                ${[0.5, 1, 2, 4].map(sp => `<button type="button" data-speed="${sp}" style="cursor:pointer;padding:5px 8px;border:0;background:${sp === this.speed ? '#f0c419' : '#152a21'};color:${sp === this.speed ? '#0b1913' : '#cfe2d7'};font-size:11.5px;font-weight:700">${sp}x</button>`).join('')}
              </div>
            </div>

            <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
              <div style="display:inline-flex;border:1px solid #28493a;border-radius:6px;overflow:hidden">
                ${[
                  ['tv', 'ТВ'],
                  ['tactical', 'Тактика'],
                  ['goal', 'Ворота'],
                  ['free', 'Обзор'],
                ].map(([cm, lbl]) => `<button type="button" data-cam="${cm}" style="cursor:pointer;padding:5px 9px;border:0;background:${cm === this.cameraMode ? '#2f7d55' : '#152a21'};color:#fff;font-size:11.5px;font-weight:600">${lbl}</button>`).join('')}
              </div>

              <button type="button" data-act="rtx" title="HDR Bloom + DLSS-CAS Sharpening" style="cursor:pointer;padding:5px 9px;background:${this.rtxEnabled ? '#1d4ed8' : '#152a21'};border:1px solid ${this.rtxEnabled ? '#3b82f6' : '#28493a'};border-radius:6px;color:#ffffff;font-size:11.5px;font-weight:700">RTX + CAS</button>
              <button type="button" data-act="names" style="cursor:pointer;padding:5px 9px;background:${this.showNames ? '#234436' : '#152a21'};border:1px solid #28493a;border-radius:6px;color:#e4f0e9;font-size:11.5px;font-weight:600">Имена</button>
              <button type="button" data-act="sound" style="cursor:pointer;padding:5px 9px;background:${this.audio.isEnabled() ? '#234436' : '#152a21'};border:1px solid #28493a;border-radius:6px;color:#e4f0e9;font-size:11.5px;font-weight:600">${this.audio.isEnabled() ? 'Звук вкл' : 'Звук'}</button>
              <button type="button" data-act="collapse" title="Свернуть/развернуть панель" style="cursor:pointer;padding:5px 8px;background:#152a21;border:1px solid #28493a;border-radius:6px;color:#9bb3a5;font-size:11.5px;font-weight:700">▾</button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.stageEl = container.querySelector('.m3d-stage');
    this.canvasEl = container.querySelector('.m3d-canvas');
    this.dockEl = container.querySelector('.m3d-dock');
    this.scoreEl = container.querySelector('.m3d-score');
    this.clockEl = container.querySelector('.m3d-clock');
    this.tickerEl = container.querySelector('.m3d-ticker');
    this.goalFlashEl = container.querySelector('.m3d-goal-flash');
    this.shotBadgeEl = container.querySelector('.m3d-shot-badge');
    this.scrubFillEl = container.querySelector('.m3d-scrub-fill');
    this.scrubThumbEl = container.querySelector('.m3d-scrub-thumb');
    this.scrubMarkersEl = container.querySelector('.m3d-scrub-markers');
    this.playBtnEl = container.querySelector('.m3d-play-btn');
    this.contextFallbackEl = container.querySelector('.m3d-fallback');

    this.bindUiHandlers(container);
  }

  private bindUiHandlers(container: HTMLElement): void {
    const shell = container.querySelector('.m3d-shell') as HTMLElement | null;
    container.querySelectorAll<HTMLButtonElement>('[data-act]').forEach(btn => {
      btn.onclick = () => {
        const act = btn.dataset.act;
        if (act === 'play') {
          this.playing = !this.playing;
          if (this.playing && this.playSec >= this.timeline.totalPlaySec - 0.2) {
            const k0 = this.timeline.segments.find(s => s.startSec >= 0) || this.timeline.segments[0];
            this.seekPlaySec(k0 ? k0.playStartSec : 0);
          }
          this.updatePlayButton();
        } else if (act === 'prev') {
          this.stepKeyMoment(-1);
        } else if (act === 'next') {
          this.stepKeyMoment(1);
        } else if (act === 'golive') {
          const lastSeg = this.timeline.segments[this.timeline.segments.length - 1];
          if (lastSeg) {
            this.seekPlaySec(lastSeg.playStartSec);
            this.playing = true;
            this.updatePlayButton();
          }
        } else if (act === 'rtx') {
          this.rtxEnabled = !this.rtxEnabled;
          btn.style.background = this.rtxEnabled ? '#1d4ed8' : '#152a21';
          btn.style.borderColor = this.rtxEnabled ? '#3b82f6' : '#28493a';
        } else if (act === 'names') {
          this.showNames = !this.showNames;
          this.players?.setLabelsVisible(this.showNames);
          btn.style.background = this.showNames ? '#234436' : '#152a21';
        } else if (act === 'sound') {
          const on = this.audio.setEnabled(!this.audio.isEnabled());
          btn.textContent = on ? 'Звук вкл' : 'Звук';
          btn.style.background = on ? '#234436' : '#152a21';
        } else if (act === 'toggle-hud') {
          this.hudVisible = !this.hudVisible;
          if (this.tickerEl?.parentElement) {
            this.tickerEl.parentElement.style.display = this.hudVisible ? 'flex' : 'none';
          }
          if (this.dockEl) {
            this.dockEl.style.display = this.hudVisible ? 'flex' : 'none';
          }
        } else if (act === 'collapse') {
          this.dockCollapsed = !this.dockCollapsed;
          const ctrl = container.querySelector('.m3d-dock-controls') as HTMLElement | null;
          if (ctrl) ctrl.style.display = this.dockCollapsed ? 'none' : 'flex';
          btn.textContent = this.dockCollapsed ? '▴' : '▾';
        } else if (act === 'fullscreen' && shell) {
          if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
          else shell.requestFullscreen?.().catch(() => {});
        }
      };
    });

    container.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach(btn => {
      btn.onclick = () => {
        this.speed = Number(btn.dataset.speed) || 1;
        container.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach(b => {
          const active = Number(b.dataset.speed) === this.speed;
          b.style.background = active ? '#f0c419' : '#152a21';
          b.style.color = active ? '#0b1913' : '#cfe2d7';
        });
      };
    });

    container.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach(btn => {
      btn.onclick = () => {
        this.cameraMode = (btn.dataset.cam as CameraMode) || 'tv';
        this.userCameraOverride = this.cameraMode === 'free';
        if (this.controls) {
          this.controls.enabled = this.cameraMode === 'free' || this.cameraMode === 'tactical';
        }
        container.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach(b => {
          b.style.background = b.dataset.cam === this.cameraMode ? '#2f7d55' : '#152a21';
        });
      };
    });

    const scrub = container.querySelector('.m3d-scrub') as HTMLElement | null;
    if (scrub) {
      const seekAtClientX = (clientX: number) => {
        const rect = scrub.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
        this.seekPlaySec(pct * Math.max(1, this.timeline.totalPlaySec));
      };
      let dragging = false;
      scrub.onpointerdown = ev => {
        dragging = true;
        scrub.setPointerCapture?.(ev.pointerId);
        seekAtClientX(ev.clientX);
      };
      scrub.onpointermove = ev => {
        if (dragging) seekAtClientX(ev.clientX);
      };
      scrub.onpointerup = () => { dragging = false; };
      scrub.onpointercancel = () => { dragging = false; };
    }

    this.keyDownHandler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'h' || e.key === 'H' || e.key === 'р' || e.key === 'Р') {
        const btn = container.querySelector<HTMLButtonElement>('[data-act="toggle-hud"]');
        btn?.click();
      }
    };
    window.addEventListener('keydown', this.keyDownHandler);
  }

  private renderScrubberMarkers(): void {
    if (!this.scrubMarkersEl) return;
    const total = Math.max(1, this.timeline.totalPlaySec);
    this.scrubMarkersEl.innerHTML = this.timeline.keyEventSecs.map(k => {
      const pct = Math.max(0, Math.min(100, (k.playSec / total) * 100));
      const color = k.type === 'goal' || k.type === 'own_goal' ? '#f0c419' : k.type === 'red' ? '#ef4444' : '#38bdf8';
      return `<span title="${escapeHtml(k.label)}" style="position:absolute;left:${pct.toFixed(2)}%;top:-2px;width:4px;height:10px;border-radius:2px;background:${color};transform:translateX(-50%)"></span>`;
    }).join('');
  }

  private stepKeyMoment(dir: -1 | 1): void {
    const keys = this.timeline.keyEventSecs;
    if (!keys.length) {
      this.seekPlaySec(this.playSec + dir * 6);
      return;
    }
    if (dir === 1) {
      const next = keys.find(k => k.playSec > this.playSec + 0.8) || keys[0];
      this.seekPlaySec(next.playSec);
    } else {
      const prevList = keys.filter(k => k.playSec < this.playSec - 0.8);
      const prev = prevList.length ? prevList[prevList.length - 1] : keys[keys.length - 1];
      this.seekPlaySec(prev.playSec);
    }
  }

  private updatePlayButton(): void {
    if (!this.playBtnEl) return;
    this.playBtnEl.textContent = this.playing ? '⏸ Пауза' : '▶ Играть';
  }

  private initThree(m: MatchPayload): void {
    if (!this.canvasEl || !this.stageEl) return;

    const w = Math.max(320, this.stageEl.clientWidth || 800);
    const h = Math.max(260, this.stageEl.clientHeight || 460);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: this.canvasEl,
        antialias: true,
        powerPreference: 'high-performance',
      });
    } catch {
      if (this.contextFallbackEl) this.contextFallbackEl.style.display = 'flex';
      return;
    }

    this.isSoftwareGl = detectSoftwareGl(renderer);
    const pr = this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = !this.isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;

    this.canvasEl.addEventListener('webglcontextlost', e => {
      e.preventDefault();
      this.contextLost = true;
      if (this.contextFallbackEl) this.contextFallbackEl.style.display = 'flex';
    });
    this.canvasEl.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      if (this.contextFallbackEl) this.contextFallbackEl.style.display = 'none';
      this.lastClockTime = performance.now();
    });

    const scene = new THREE.Scene();
    this.scene = scene;

    const maxAniso = Math.min(16, renderer.capabilities.getMaxAnisotropy() || 1);
    const atmo = resolveAtmosphere(m);
    const kits = resolveMatchKits(m.fixture.homeColors, m.fixture.awayColors);

    // Custom HDR Stadium Sky + Floodlights + Pitch Environment Map
    this.pmremEnv = createStadiumEnvironmentTexture(renderer, atmo);
    scene.environment = this.pmremEnv.texture;

    // Telephoto Broadcast Lens (31 deg FOV gives true TV sports broadcast scale & depth)
    const camera = new THREE.PerspectiveCamera(31, w / h, 0.5, 450);
    camera.position.set(0, 34, 62);
    this.camera = camera;

    const controls = new OrbitControls(camera, this.canvasEl);
    controls.enableDamping = !this.isSoftwareGl;
    controls.dampingFactor = 0.07;
    controls.maxPolarAngle = Math.PI * 0.46;
    controls.minDistance = 12;
    controls.maxDistance = 138;
    controls.enabled = false;
    controls.addEventListener('start', () => {
      this.userCameraOverride = true;
    });
    this.controls = controls;

    this.stadium = buildStadiumAndAtmosphere(scene, m, atmo, maxAniso, this.isSoftwareGl, kits.homeJersey, kits.awayJersey);
    this.players = buildPlayersManager(scene, this.slots, kits, this.isSoftwareGl, atmo.tempC <= 4 || atmo.season === 'winter');
    this.players.setLabelsVisible(this.showNames);

    this.physics = new MatchPhysicsWorld(atmo.weather, {
      onKickImpact: (strength) => {
        this.audio.playKick(strength);
        if (this.physics && strength > 0.65) {
          const bp = this.physics.ballPos;
          const bv = this.physics.ballVel;
          const spd = Math.hypot(bv.x, bv.z);
          this.stadium?.triggerTurfSpray(bp.x, bp.z, bv.x / Math.max(1, spd), bv.z / Math.max(1, spd), strength);
          if (spd > 15) {
            this.shotSpeedKmh = Math.round(spd * 3.6);
            this.shotSpeedTimer = 2.6;
          }
        }
      },
      onPostHit: (side) => {
        this.audio.playPostPing();
        this.stadium?.triggerGoalNet(side, 0.75);
        this.camShake = Math.max(this.camShake, 0.52);
      },
      onNetHit: (side) => {
        this.stadium?.triggerGoalNet(side, 1.5);
        this.camShake = Math.max(this.camShake, 0.38);
      },
      onSaveDeflect: () => {
        this.audio.playKick(0.85);
        this.camShake = Math.max(this.camShake, 0.28);
      },
    });

    // HDR MSAA EffectComposer (UnrealBloom + DLSS-CAS Sharpening + OutputPass) on GPU
    if (!this.isSoftwareGl) {
      const rt = new THREE.WebGLRenderTarget(Math.round(w * pr), Math.round(h * pr), {
        type: THREE.HalfFloatType,
        samples: 4,
      });
      this.composerRt = rt;
      const composer = new EffectComposer(renderer, rt);
      composer.setPixelRatio(pr);
      composer.setSize(w, h);

      const renderPass = new RenderPass(scene, camera);
      composer.addPass(renderPass);

      const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(w, h),
        atmo.isNight ? 0.38 : atmo.isSunset ? 0.30 : 0.20,
        0.55,
        0.86
      );
      this.bloomPass = bloomPass;
      composer.addPass(bloomPass);

      const casPass = new ShaderPass(BroadcastCasVignetteShader);
      casPass.uniforms.uResolution.value.set(w * pr, h * pr);
      casPass.uniforms.uSharpness.value = 0.78;
      casPass.uniforms.uVignette.value = 0.26;
      casPass.uniforms.uContrast.value = 1.05;
      this.casPass = casPass;
      composer.addPass(casPass);

      const outputPass = new OutputPass();
      composer.addPass(outputPass);
      this.composer = composer;

      renderer.compile(scene, camera);
    }

    this.resizeObs = new ResizeObserver(() => {
      if (!this.stageEl || !this.renderer || !this.camera) return;
      const rw = Math.max(320, this.stageEl.clientWidth);
      const rh = Math.max(240, this.stageEl.clientHeight);
      this.camera.aspect = rw / rh;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(rw, rh, false);
      if (this.composer && !this.isSoftwareGl) {
        const curPr = this.renderer.getPixelRatio();
        this.composer.setSize(rw, rh);
        this.bloomPass?.setSize(rw, rh);
        this.casPass?.uniforms.uResolution.value.set(rw * curPr, rh * curPr);
      }
    });
    this.resizeObs.observe(this.stageEl);
  }

  private getSegmentAtPlay(pSec: number): PlaySegment | null {
    const segs = this.timeline.segments;
    if (!segs.length) return null;
    for (let i = 0; i < segs.length; i++) {
      if (pSec <= segs[i].playEndSec) return segs[i];
    }
    return segs[segs.length - 1];
  }

  private computeMatchSecAt(pSec: number): number {
    const seg = this.getSegmentAtPlay(pSec);
    if (!seg) return 0;
    const span = Math.max(0.05, seg.playEndSec - seg.playStartSec);
    const u = THREE.MathUtils.clamp((pSec - seg.playStartSec) / span, 0, 1);
    return THREE.MathUtils.lerp(seg.startSec, seg.endSec, u);
  }

  private syncHudImmediate(): void {
    const seg = this.getSegmentAtPlay(this.playSec);
    if (this.clockEl) this.clockEl.textContent = formatClock(this.simMatchSec);
    if (this.scoreEl) {
      const sc = seg ? seg.score : [this.payload?.fixture.hg ?? 0, this.payload?.fixture.ag ?? 0];
      this.scoreEl.textContent = `${sc[0] ?? 0} : ${sc[1] ?? 0}`;
    }
    if (this.tickerEl && seg) {
      this.tickerEl.textContent = seg.text;
    }
    if (this.scrubFillEl && this.scrubThumbEl) {
      const total = Math.max(1, this.timeline.totalPlaySec);
      const pct = Math.max(0, Math.min(100, (this.playSec / total) * 100));
      this.scrubFillEl.style.width = `${pct.toFixed(2)}%`;
      this.scrubThumbEl.style.left = `${pct.toFixed(2)}%`;
    }
  }

  private applySubAndCardVisibility(): void {
    if (!this.players) return;
    this.slots.forEach(s => {
      s.active = s.isStarter;
      s.sentOff = false;
    });
    for (const seg of this.timeline.segments) {
      if (seg.playStartSec > this.playSec) break;
      if (seg.subPair) {
        const outSlot = this.slots.find(s => s.id === seg.subPair!.outId);
        const inSlot = this.slots.find(s => s.id === seg.subPair!.inId);
        if (outSlot) outSlot.active = false;
        if (inSlot) {
          inSlot.active = true;
          if (outSlot) {
            inSlot.baseX = outSlot.baseX;
            inSlot.baseZ = outSlot.baseZ;
          }
        }
      }
      if (seg.isCard === 'red' && seg.actorIds[0]) {
        const redSlot = this.slots.find(s => s.id === seg.actorIds[0]);
        if (redSlot) {
          redSlot.sentOff = true;
          redSlot.active = false;
        }
      }
    }
    this.players.rigs.forEach(rig => {
      rig.root.visible = rig.slot.active && !rig.slot.sentOff;
    });
  }

  private stepSimulation(dt: number): void {
    if (this.playing) {
      this.playSec += dt * this.speed;
      if (this.playSec >= this.timeline.totalPlaySec) {
        this.playSec = this.timeline.totalPlaySec;
        if (this.payload?.fixture.status !== 'live') {
          this.playing = false;
          this.updatePlayButton();
        }
      }
    }

    this.simMatchSec = this.computeMatchSecAt(this.playSec);
    const activeSeg = this.getSegmentAtPlay(this.playSec);
    if (!activeSeg || !this.players || !this.stadium || !this.physics) return;

    this.applySubAndCardVisibility();

    if (activeSeg.id !== this.lastTriggeredSegId) {
      this.lastTriggeredSegId = activeSeg.id;
      this.syncHudImmediate();
      if (!activeSeg.isSynthesized && !activeSeg.isBuildup && this.onActiveEventChange) {
        this.onActiveEventChange(activeSeg.evIndex);
      }

      if (activeSeg.isSetPiece === 'kickoff' || activeSeg.isHalftime || activeSeg.isFulltime) {
        this.audio.playWhistle(activeSeg.isFulltime ? 'double' : 'long');
      } else if (activeSeg.type === 'foul' || activeSeg.isCard || activeSeg.isSetPiece === 'penalty') {
        this.audio.playWhistle('short');
      }

      if (activeSeg.isCard) {
        setRefereeCardColor(this.players.refereeRig, activeSeg.isCard);
      }

      if (activeSeg.isGoal && activeSeg.goalSide) {
        const col = activeSeg.team === 'away'
          ? (this.payload?.fixture.awayColors?.primary || '#e53935')
          : (this.payload?.fixture.homeColors?.primary || '#1e88e5');
        this.stadium.triggerConfetti(activeSeg.goalSide, col);
        this.audio.swellCrowd('goal');
        this.goalMood = 1.0;
        this.goalBannerTimer = 3.8;
        this.actionCamTimer = 3.1;
        this.goalBannerTeam = activeSeg.team === 'away'
          ? (this.payload?.fixture.awayName || 'Гости')
          : (this.payload?.fixture.homeName || 'Хозяева');
        for (const aid of activeSeg.actorIds) {
          const r = this.players.rigs.get(aid);
          if (r) r.celebrateTimer = 3.4;
        }
      } else if (activeSeg.isPost || activeSeg.isSave || activeSeg.type === 'shot') {
        this.audio.swellCrowd('chance');
        this.actionCamTimer = 1.6;
      }

      const primaryRig = activeSeg.actorIds[0] ? this.players.rigs.get(activeSeg.actorIds[0]) : undefined;
      if (primaryRig && !activeSeg.isCard && !activeSeg.isHalftime && !activeSeg.isFulltime && !activeSeg.subPair) {
        primaryRig.kickDuration = 0.56;
        primaryRig.kickTimer = 0.56;
      }
      if (activeSeg.type === 'tackle' && primaryRig) {
        primaryRig.tackleTimer = 0.65;
        this.stadium.triggerTurfSpray(primaryRig.curX, primaryRig.curZ, Math.sin(primaryRig.facing), Math.cos(primaryRig.facing), 1.1);
      }
      if (activeSeg.isSave || activeSeg.isGoal) {
        const defSide = activeSeg.team === 'home' ? 'away' : 'home';
        this.players.rigs.forEach(r => {
          if (r.slot.side === defSide && r.slot.isGk) {
            r.diveTimer = 1.05;
            r.diveDir = activeSeg.ballEnd[2] >= 0 ? 1 : -1;
          }
        });
      }
    }

    const physDt = this.playing ? dt * Math.min(2.2, this.speed) : 0;
    if (physDt > 0) {
      this.physics.step(physDt, activeSeg, this.playSec - activeSeg.playStartSec);
    }

    const ballPos = this.physics.ballPos;
    const ballVel = this.physics.ballVel;

    const secondHalf = this.simMatchSec >= 45 * 60;
    const shiftX = ballPos.x * 0.34;
    const shiftZ = ballPos.z * 0.24;
    this.activeActorIds.clear();
    for (const id of activeSeg.actorIds) this.activeActorIds.add(id);

    this.slotTargetMap.clear();
    this.players.rigs.forEach(rig => {
      if (!rig.root.visible) return;
      const s = rig.slot;
      let tx = secondHalf ? -s.baseX : s.baseX;
      let tz = secondHalf ? -s.baseZ : s.baseZ;

      if (s.isGk) {
        tx = tx < 0 ? -49.2 : 49.2;
        tz = Math.max(-3.5, Math.min(3.5, ballPos.z * 0.32));
      } else {
        tx = Math.max(-47, Math.min(47, tx + shiftX));
        tz = Math.max(-31, Math.min(31, tz + shiftZ));

        if (activeSeg.isSetPiece === 'corner') {
          const targetBoxX = activeSeg.ballStart[0] > 0 ? 43 : -43;
          if (Math.abs(tx - targetBoxX) < 34) {
            tx = THREE.MathUtils.lerp(tx, targetBoxX, 0.45);
            tz = THREE.MathUtils.lerp(tz, 0, 0.45);
          }
        }
      }
      this.slotTargetMap.set(s.id, [tx, tz]);
    });

    const p0Id = activeSeg.actorIds[0];
    const p1Id = activeSeg.actorIds[1];
    const segDurPlay = Math.max(0.1, activeSeg.playEndSec - activeSeg.playStartSec);
    const fracPlay = THREE.MathUtils.clamp((this.playSec - activeSeg.playStartSec) / segDurPlay, 0, 1);

    if (p0Id && !activeSeg.isHalftime && !activeSeg.isFulltime && !activeSeg.subPair) {
      if (activeSeg.type === 'dribble') {
        this.slotTargetMap.set(p0Id, [ballPos.x - Math.sign(ballVel.x || 1) * 0.45, ballPos.z]);
      } else {
        const kickDirX = Math.sign(activeSeg.ballEnd[0] - activeSeg.ballStart[0] || 1);
        this.slotTargetMap.set(p0Id, [activeSeg.ballStart[0] - kickDirX * 0.55, activeSeg.ballStart[2]]);
      }
    }
    if (p1Id && !activeSeg.isHalftime && !activeSeg.isFulltime && !activeSeg.subPair) {
      const p1Rig = this.players.rigs.get(p1Id);
      if (p1Rig && !p1Rig.slot.isGk) {
        const lead = THREE.MathUtils.clamp(fracPlay * 1.15, 0, 1);
        const rx = THREE.MathUtils.lerp(p1Rig.curX, activeSeg.ballEnd[0], 0.35 + lead * 0.65);
        const rz = THREE.MathUtils.lerp(p1Rig.curZ, activeSeg.ballEnd[2] + (activeSeg.type === 'duel' ? 0.9 : 0), 0.35 + lead * 0.65);
        this.slotTargetMap.set(p1Id, [Math.max(-48, Math.min(48, rx)), Math.max(-31, Math.min(31, rz))]);
      }
    }

    if (activeSeg.isCard && p0Id && this.players.rigs.get(p0Id)) {
      const cardRig = this.players.rigs.get(p0Id)!;
      this.refTarget[0] = cardRig.curX + 1.8;
      this.refTarget[1] = cardRig.curZ + 1.4;
    } else {
      this.refTarget[0] = Math.max(-40, Math.min(40, ballPos.x - 5.0));
      this.refTarget[1] = Math.max(-28, Math.min(28, ballPos.z - 9.0));
    }

    const simStepDt = this.playing ? dt * Math.min(2.2, this.speed) : 0;
    if (simStepDt > 0) {
      stepPlayersSteering(
        this.players.rigs,
        this.players.refereeRig,
        this.slotTargetMap,
        this.refTarget,
        simStepDt,
        this.physics.profile.playerTraction,
        p0Id || null
      );
    }

    this.players.updateLabelsVisibility(this.activeActorIds, this.cameraMode === 'tactical');
    this.players.animateRigs(dt, this.elapsedReal, p0Id || null, ballPos);

    this.goalMood = Math.max(0, this.goalMood - dt * 0.38);
    if (this.actionCamTimer > 0) this.actionCamTimer = Math.max(0, this.actionCamTimer - dt);

    if (this.shotBadgeEl) {
      if (this.shotSpeedTimer > 0) {
        this.shotSpeedTimer = Math.max(0, this.shotSpeedTimer - dt);
        this.shotBadgeEl.style.display = 'inline-block';
        this.shotBadgeEl.textContent = `⚡ УДАР ${this.shotSpeedKmh} км/ч`;
      } else {
        this.shotBadgeEl.style.display = 'none';
      }
    }

    if (this.goalFlashEl) {
      if (this.goalBannerTimer > 0) {
        this.goalBannerTimer = Math.max(0, this.goalBannerTimer - dt);
        this.goalFlashEl.style.display = 'block';
        const gt = this.goalFlashEl.querySelector('.m3d-goal-team');
        if (gt) gt.textContent = this.goalBannerTeam;
      } else {
        this.goalFlashEl.style.display = 'none';
      }
    }

    this.stadium.update(dt, this.elapsedReal, ballPos, ballVel, this.goalMood, this.physics.ballQuat);
    this.updateCamera(dt, activeSeg, ballPos);

    if (this.clockEl) this.clockEl.textContent = formatClock(this.simMatchSec);
    if (this.scrubFillEl && this.scrubThumbEl) {
      const total = Math.max(1, this.timeline.totalPlaySec);
      const pct = Math.max(0, Math.min(100, (this.playSec / total) * 100));
      this.scrubFillEl.style.width = `${pct.toFixed(2)}%`;
      this.scrubThumbEl.style.left = `${pct.toFixed(2)}%`;
    }
  }

  private updateCamera(dt: number, activeSeg: PlaySegment, ballPos: THREE.Vector3): void {
    if (!this.camera || !this.controls) return;
    if (this.userCameraOverride && (this.cameraMode === 'free' || this.cameraMode === 'tactical')) {
      this.controls.update();
      return;
    }

    this.camFocus.x = THREE.MathUtils.damp(this.camFocus.x, ballPos.x, 4.4, dt);
    this.camFocus.y = THREE.MathUtils.damp(this.camFocus.y, ballPos.y, 4.4, dt);
    this.camFocus.z = THREE.MathUtils.damp(this.camFocus.z, ballPos.z, 4.4, dt);

    const bx = this.camFocus.x;
    const bz = this.camFocus.z;

    if (this.camShake > 0.005) {
      this.camShake = Math.max(0, this.camShake - dt * 2.4);
    }
    const shakeX = this.camShake > 0 ? Math.sin(this.elapsedReal * 52) * this.camShake * 0.35 : 0;
    const shakeY = this.camShake > 0 ? Math.cos(this.elapsedReal * 47) * this.camShake * 0.25 : 0;

    if (this.cameraMode === 'tv') {
      // Dynamic Broadcast Director: telephoto pitchside close-up on goals/chances, then smooth return to gantry
      if (this.actionCamTimer > 0 && Math.abs(bx) > 20) {
        const sideSign = bz >= 0 ? -1 : 1;
        this.camDesiredTarget.set(bx * 0.92, 1.15, bz * 0.72);
        this.camDesiredPos.set(bx * 0.72 + shakeX, 9.5 + shakeY, sideSign * 26);
      } else {
        const boxFocus = Math.abs(bx) > 30 ? 0.78 : 1.0;
        this.camDesiredTarget.set(bx * 0.72, 0.95, bz * 0.46);
        this.camDesiredPos.set(bx * 0.45 + shakeX, 34 * boxFocus + 4 + shakeY, 62 * boxFocus + bz * 0.2);
      }
      this.camTarget.x = THREE.MathUtils.damp(this.camTarget.x, this.camDesiredTarget.x, 4.4, dt);
      this.camTarget.y = THREE.MathUtils.damp(this.camTarget.y, this.camDesiredTarget.y, 4.4, dt);
      this.camTarget.z = THREE.MathUtils.damp(this.camTarget.z, this.camDesiredTarget.z, 4.4, dt);
      this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, this.camDesiredPos.x, 3.8, dt);
      this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, this.camDesiredPos.y, 3.8, dt);
      this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, this.camDesiredPos.z, 3.8, dt);
      this.camera.lookAt(this.camTarget);
    } else if (this.cameraMode === 'tactical') {
      this.camDesiredPos.set(bx * 0.22, 82, 54);
      this.camDesiredTarget.set(bx * 0.25, 0, bz * 0.2);
      this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, this.camDesiredPos.x, 4.0, dt);
      this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, this.camDesiredPos.y, 4.0, dt);
      this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, this.camDesiredPos.z, 4.0, dt);
      this.camTarget.x = THREE.MathUtils.damp(this.camTarget.x, this.camDesiredTarget.x, 4.0, dt);
      this.camTarget.y = THREE.MathUtils.damp(this.camTarget.y, this.camDesiredTarget.y, 4.0, dt);
      this.camTarget.z = THREE.MathUtils.damp(this.camTarget.z, this.camDesiredTarget.z, 4.0, dt);
      this.camera.lookAt(this.camTarget);
    } else if (this.cameraMode === 'goal') {
      const atkRight = activeSeg.ballEnd[0] >= 0;
      const gCamX = atkRight ? 68 : -68;
      this.camDesiredPos.set(gCamX + shakeX, 12.5 + shakeY, bz * 0.35);
      this.camDesiredTarget.set(bx * 0.72, 1.2, bz * 0.5);
      this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, this.camDesiredPos.x, 4.5, dt);
      this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, this.camDesiredPos.y, 4.5, dt);
      this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, this.camDesiredPos.z, 4.5, dt);
      this.camTarget.x = THREE.MathUtils.damp(this.camTarget.x, this.camDesiredTarget.x, 4.5, dt);
      this.camTarget.y = THREE.MathUtils.damp(this.camTarget.y, this.camDesiredTarget.y, 4.5, dt);
      this.camTarget.z = THREE.MathUtils.damp(this.camTarget.z, this.camDesiredTarget.z, 4.5, dt);
      this.camera.lookAt(this.camTarget);
    } else {
      this.controls.update();
    }
  }

  private startLoop(): void {
    this.lastClockTime = performance.now();
    const afterDraw = (cb: () => void) => {
      if (!this.renderer) return;
      const gl = this.renderer.getContext() as WebGL2RenderingContext;
      if (gl && typeof gl.fenceSync === 'function') {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const poll = () => {
          if (this.destroyed) {
            if (sync) gl.deleteSync(sync);
            return;
          }
          const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
          if (state === gl.UNSIGNALED) {
            this.afterDrawTimeout = window.setTimeout(poll, 5);
          } else {
            if (sync) gl.deleteSync(sync);
            this.afterDrawTimeout = window.setTimeout(cb, 80);
          }
        };
        this.afterDrawTimeout = window.setTimeout(poll, 5);
      } else {
        this.afterDrawTimeout = window.setTimeout(cb, 80);
      }
    };

    const tick = () => {
      if (this.destroyed) return;
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0.001, (now - this.lastClockTime) / 1000));
      this.lastClockTime = now;

      if (!this.hiddenPaused && !this.contextLost && this.renderer && this.scene && this.camera) {
        this.elapsedReal += dt;
        this.stepSimulation(dt);
        if (!this.isSoftwareGl && this.rtxEnabled && this.composer) {
          this.composer.render();
        } else {
          this.renderer.render(this.scene, this.camera);
        }
      }

      if (this.isSoftwareGl) afterDraw(tick);
      else this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
  }

  public destroy(): void {
    this.destroyed = true;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.afterDrawTimeout) clearTimeout(this.afterDrawTimeout);
    this.rafId = 0;
    this.afterDrawTimeout = 0;

    if (this.keyDownHandler) {
      window.removeEventListener('keydown', this.keyDownHandler);
      this.keyDownHandler = null;
    }

    this.resizeObs?.disconnect();
    this.resizeObs = null;

    this.stadium?.dispose();
    this.stadium = null;
    this.players?.dispose();
    this.players = null;
    this.physics = null;
    this.controls?.dispose();
    this.controls = null;
    this.composer?.dispose();
    this.composer = null;
    this.composerRt?.dispose();
    this.composerRt = null;
    this.bloomPass = null;
    this.casPass = null;
    this.pmremEnv?.dispose();
    this.pmremEnv = null;

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
    this.scene = null;
    this.camera = null;
    this.audio.dispose();

    if (this.host) {
      this.host.innerHTML = '';
      this.host = null;
    }
    this.matchId = null;
  }

  public buildDemo(
    preset: DemoPresetId = 'night_rain',
    customClubs?: Parameters<typeof buildDemoMatch>[1]
  ) {
    return buildDemoMatch(preset, customClubs);
  }
}

const instance = new Match3DEngine();

declare global {
  interface Window {
    Match3D?: Match3DEngine;
  }
}

window.Match3D = instance;

export default instance;
