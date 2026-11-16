import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MatchAudioEngine } from './audio';
import { buildMatchTimeline, buildPlayerSlots, type TimelineBuild } from './choreography';
import { buildPlayersManager, resolveMatchKits, setRefereeCardColor, type PlayersManager } from './players';
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
  private timeline: TimelineBuild = { segments: [], startTimeSec: 0, endTimeSec: 5400, keyEventSecs: [] };

  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private controls: OrbitControls | null = null;
  private pmremEnv: THREE.WebGLRenderTarget | null = null;
  private stadium: StadiumRig | null = null;
  private players: PlayersManager | null = null;
  private audio = new MatchAudioEngine();

  private isSoftwareGl = false;
  private resizeObs: ResizeObserver | null = null;
  private rafId = 0;
  private afterDrawTimeout = 0;
  private destroyed = false;
  private hiddenPaused = false;
  private contextLost = false;

  // Simulation state
  private simSec = 0;
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
  private onActiveEventChange?: (evIndex: number) => void;

  // Pre-allocated math objects (zero allocations in tick loop)
  private readonly ballPos = new THREE.Vector3(0, 0.24, 0);
  private readonly prevBallPos = new THREE.Vector3(0, 0.24, 0);
  private readonly ballVel = new THREE.Vector3(0, 0, 0);
  private readonly camTarget = new THREE.Vector3(0, 0, 0);
  private readonly camDesiredPos = new THREE.Vector3(0, 32, 48);
  private readonly camDesiredTarget = new THREE.Vector3(0, 0, 0);
  private readonly activeActorIds = new Set<string>();
  private readonly slotTargetMap = new Map<string, [number, number]>();

  // UI elements
  private stageEl: HTMLElement | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private hudRootEl: HTMLElement | null = null;
  private dockEl: HTMLElement | null = null;
  private scoreEl: HTMLElement | null = null;
  private clockEl: HTMLElement | null = null;
  private tickerEl: HTMLElement | null = null;
  private goalFlashEl: HTMLElement | null = null;
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

    // For completed matches, start right at kickoff or first event; for live matches start near latest event
    if (payload.fixture.status === 'live' && this.timeline.segments.length) {
      const lastSeg = this.timeline.segments[this.timeline.segments.length - 1];
      this.simSec = Math.max(0, lastSeg.startSec);
    } else {
      const kickoffSeg = this.timeline.segments.find(s => s.startSec >= 0) || this.timeline.segments[0];
      this.simSec = kickoffSeg ? kickoffSeg.startSec : 0;
    }

    this.playing = true;
    this.hiddenPaused = false;
    this.userCameraOverride = false;
    this.lastTriggeredSegId = '';
    this.goalBannerTimer = 0;
    this.goalMood = 0;

    this.buildDom(container, payload);
    this.initThree(payload);
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

    // If a brand-new live SSE event just arrived and user is near the live edge, smoothly animate it!
    if (this.events.length > prevLen && payload.fixture.status === 'live') {
      const newestSeg = this.timeline.segments[this.timeline.segments.length - 1];
      if (newestSeg && newestSeg.startSec - this.simSec < 95) {
        this.simSec = newestSeg.startSec;
        this.playing = true;
      }
    }
    this.syncHudImmediate();
  }

  public jumpToEvent(evIndex: number): void {
    const seg = this.timeline.segments.find(s => s.evIndex === evIndex && !s.isSynthesized)
      || this.timeline.segments.find(s => s.evIndex === evIndex);
    if (!seg) return;
    this.simSec = seg.startSec;
    this.lastTriggeredSegId = '';
    this.playing = true;
    this.updatePlayButton();
    this.syncHudImmediate();
    this.stageEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  public setPausedIfHidden(hidden: boolean): void {
    this.hiddenPaused = hidden;
    if (!hidden && !this.destroyed && this.renderer) {
      this.lastClockTime = performance.now();
    }
  }

  private buildDom(container: HTMLElement, m: MatchPayload): void {
    const f = m.fixture;
    const hCol = f.homeColors?.primary || '#1e88e5';
    const aCol = f.awayColors?.primary || '#e53935';
    const weatherStr = m.ctx?.weather || f.weather || '';
    const isLive = f.status === 'live';

    container.innerHTML = `
      <div class="m3d-shell" style="position:relative;border-radius:12px;overflow:hidden;background:#08120e;border:1px solid #20382d;box-shadow:0 8px 28px rgba(10,25,18,0.28);margin-bottom:16px;user-select:none">
        <div class="m3d-stage" style="position:relative;width:100%;height:clamp(340px,54vh,560px);background:#091321">
          <canvas class="m3d-canvas" style="display:block;width:100%;height:100%;touch-action:none"></canvas>

          <div class="m3d-fallback" style="display:none;position:absolute;inset:0;background:#0c1713;color:#e2eee7;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center;gap:8px;z-index:25">
            <div style="font:700 16px Unbounded,sans-serif">3D-рендер временно недоступен</div>
            <div style="font-size:13px;color:#9bb3a5;max-width:420px">Контекст WebGL был сброшен или не поддерживается браузером. Текстовая хроника матча ниже продолжает работать в обычном режиме.</div>
          </div>

          <div class="m3d-hud" style="position:absolute;inset:0;pointer-events:none;z-index:10">
            <!-- Top Broadcast Scorebug (pointer-events only on interactive buttons) -->
            <div style="position:absolute;top:12px;left:12px;right:12px;display:flex;align-items:flex-start;justify-content:space-between;gap:8px;flex-wrap:wrap">
              <div style="pointer-events:auto;display:flex;align-items:center;background:rgba(9,18,14,0.88);border:1px solid rgba(255,255,255,0.14);border-radius:6px;overflow:hidden;color:#fff;font-size:12.5px">
                <span style="padding:6px 9px;background:${isLive ? '#c62828' : '#1b5c3f'};font:700 11px Unbounded,sans-serif;letter-spacing:.03em;color:#fff">${isLive ? 'ЭФИР' : '3D ПОВТОР'}</span>
                <span style="width:5px;align-self:stretch;background:${escapeHtml(hCol)}"></span>
                <span style="padding:6px 10px;font-weight:700;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(f.homeName)}</span>
                <span class="m3d-score" style="padding:5px 10px;background:rgba(255,255,255,0.1);font:800 15px Unbounded,sans-serif;color:#f0c419">0 : 0</span>
                <span style="padding:6px 10px;font-weight:700;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(f.awayName)}</span>
                <span style="width:5px;align-self:stretch;background:${escapeHtml(aCol)}"></span>
                <span class="m3d-clock" style="padding:6px 10px;background:rgba(0,0,0,0.35);font:700 12px ui-monospace,Consolas,monospace;color:#cfe8d9;min-width:58px;text-align:center">00:00</span>
              </div>

              <div style="pointer-events:auto;display:flex;align-items:center;gap:6px">
                ${weatherStr ? `<span style="padding:5px 9px;background:rgba(9,18,14,0.82);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:#cde0d5;font-size:11.5px;white-space:nowrap">${escapeHtml(weatherStr.split(',')[0])}</span>` : ''}
                <button type="button" data-act="toggle-hud" title="Скрыть/показать интерфейс [H]" style="cursor:pointer;padding:6px 10px;background:rgba(9,18,14,0.84);border:1px solid rgba(255,255,255,0.16);border-radius:6px;color:#e6f2ec;font-size:12px;font-weight:600">HUD</button>
                <button type="button" data-act="fullscreen" title="Во весь экран" style="cursor:pointer;padding:6px 10px;background:rgba(9,18,14,0.84);border:1px solid rgba(255,255,255,0.16);border-radius:6px;color:#e6f2ec;font-size:12px;font-weight:600">⛶</button>
              </div>
            </div>

            <!-- Goal Flash Lower-Third Banner -->
            <div class="m3d-goal-flash" style="display:none;position:absolute;left:50%;top:62px;transform:translateX(-50%);background:rgba(13,47,33,0.95);border:2px solid #f0c419;border-radius:8px;padding:10px 22px;color:#fff;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,0.45)">
              <div style="font:800 20px Unbounded,sans-serif;color:#f0c419;letter-spacing:.04em">ГОООЛ!</div>
              <div class="m3d-goal-team" style="font:600 13px Onest,sans-serif;color:#e7f4ec;margin-top:2px"></div>
            </div>

            <!-- Live Event Commentary Ticker -->
            <div class="m3d-ticker-wrap" style="position:absolute;left:12px;right:12px;bottom:10px;display:flex;justify-content:center">
              <div class="m3d-ticker" style="background:rgba(9,18,14,0.86);border:1px solid rgba(255,255,255,0.12);border-radius:6px;padding:7px 14px;color:#eef7f2;font-size:13px;line-height:1.35;max-width:760px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Подготовка к матчу…</div>
            </div>
          </div>
        </div>

        <!-- Collapsible Unified Bottom Control Dock -->
        <div class="m3d-dock" style="background:#0c1914;border-top:1px solid #1e372c;color:#e4f0e9;padding:10px 12px;display:flex;flex-direction:column;gap:8px">
          <!-- Timeline Scrubber Bar -->
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
    this.hudRootEl = container.querySelector('.m3d-hud');
    this.dockEl = container.querySelector('.m3d-dock');
    this.scoreEl = container.querySelector('.m3d-score');
    this.clockEl = container.querySelector('.m3d-clock');
    this.tickerEl = container.querySelector('.m3d-ticker');
    this.goalFlashEl = container.querySelector('.m3d-goal-flash');
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
          if (this.playing && this.simSec >= this.timeline.endTimeSec - 0.5) {
            const k0 = this.timeline.segments.find(s => s.startSec >= 0) || this.timeline.segments[0];
            this.simSec = k0 ? k0.startSec : 0;
            this.lastTriggeredSegId = '';
          }
          this.updatePlayButton();
        } else if (act === 'prev') {
          this.stepKeyMoment(-1);
        } else if (act === 'next') {
          this.stepKeyMoment(1);
        } else if (act === 'golive') {
          const lastSeg = this.timeline.segments[this.timeline.segments.length - 1];
          if (lastSeg) {
            this.simSec = lastSeg.startSec;
            this.playing = true;
            this.updatePlayButton();
            this.syncHudImmediate();
          }
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

    // Scrubber drag/click
    const scrub = container.querySelector('.m3d-scrub') as HTMLElement | null;
    if (scrub) {
      const seekAtClientX = (clientX: number) => {
        const rect = scrub.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
        const minS = Math.max(0, this.timeline.startTimeSec);
        const maxS = Math.max(minS + 60, this.timeline.endTimeSec);
        this.simSec = minS + pct * (maxS - minS);
        this.lastTriggeredSegId = '';
        this.syncHudImmediate();
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

    // Keyboard shortcut [H] for HUD toggle (when not typing in an input)
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
    const minS = Math.max(0, this.timeline.startTimeSec);
    const span = Math.max(60, this.timeline.endTimeSec - minS);
    this.scrubMarkersEl.innerHTML = this.timeline.keyEventSecs.map(k => {
      const pct = Math.max(0, Math.min(100, ((k.sec - minS) / span) * 100));
      const color = k.type === 'goal' || k.type === 'own_goal' ? '#f0c419' : k.type === 'red' ? '#ef4444' : '#38bdf8';
      return `<span title="${escapeHtml(k.label)}" style="position:absolute;left:${pct.toFixed(2)}%;top:-2px;width:4px;height:10px;border-radius:2px;background:${color};transform:translateX(-50%)"></span>`;
    }).join('');
  }

  private stepKeyMoment(dir: -1 | 1): void {
    const keys = this.timeline.keyEventSecs;
    if (!keys.length) {
      this.simSec = Math.max(this.timeline.startTimeSec, Math.min(this.timeline.endTimeSec, this.simSec + dir * 240));
      this.syncHudImmediate();
      return;
    }
    if (dir === 1) {
      const next = keys.find(k => k.sec > this.simSec + 2) || keys[0];
      this.simSec = next.sec;
    } else {
      const prevList = keys.filter(k => k.sec < this.simSec - 2);
      const prev = prevList.length ? prevList[prevList.length - 1] : keys[keys.length - 1];
      this.simSec = prev.sec;
    }
    this.lastTriggeredSegId = '';
    this.syncHudImmediate();
  }

  private updatePlayButton(): void {
    if (!this.playBtnEl) return;
    this.playBtnEl.textContent = this.playing ? '⏸ Пауза' : '▶ Играть';
  }

  private initThree(m: MatchPayload): void {
    if (!this.canvasEl || !this.stageEl) return;

    const w = Math.max(320, this.stageEl.clientWidth || 800);
    const h = Math.max(260, this.stageEl.clientHeight || 440);

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
    if (this.isSoftwareGl) {
      // Recreate with lightweight AA off if software fallback detected, or scale pixelRatio cleanly
      renderer.setPixelRatio(1);
    } else {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    }

    renderer.setSize(w, h, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
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

    // RoomEnvironment IBL for natural metallic/turf sheen
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    this.pmremEnv = pmrem.fromScene(room, 0.04);
    scene.environment = this.pmremEnv.texture;
    room.dispose();
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(42, w / h, 0.5, 420);
    camera.position.set(0, 34, 52);
    this.camera = camera;

    const controls = new OrbitControls(camera, this.canvasEl);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.maxPolarAngle = Math.PI * 0.46;
    controls.minDistance = 12;
    controls.maxDistance = 128;
    controls.enabled = false;
    controls.addEventListener('start', () => {
      this.userCameraOverride = true;
    });
    this.controls = controls;

    const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy() || 1);
    const atmo = resolveAtmosphere(m);
    const kits = resolveMatchKits(m.fixture.homeColors, m.fixture.awayColors);

    this.stadium = buildStadiumAndAtmosphere(scene, m, atmo, maxAniso, this.isSoftwareGl, kits.homeJersey, kits.awayJersey);
    this.players = buildPlayersManager(scene, this.slots, kits, this.isSoftwareGl);
    this.players.setLabelsVisible(this.showNames);

    this.resizeObs = new ResizeObserver(() => {
      if (!this.stageEl || !this.renderer || !this.camera) return;
      const rw = Math.max(320, this.stageEl.clientWidth);
      const rh = Math.max(240, this.stageEl.clientHeight);
      this.camera.aspect = rw / rh;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(rw, rh, false);
    });
    this.resizeObs.observe(this.stageEl);
  }

  private getSegmentAt(sec: number): PlaySegment | null {
    const segs = this.timeline.segments;
    if (!segs.length) return null;
    for (let i = 0; i < segs.length; i++) {
      if (sec <= segs[i].endSec) return segs[i];
    }
    return segs[segs.length - 1];
  }

  private syncHudImmediate(): void {
    const seg = this.getSegmentAt(this.simSec);
    if (this.clockEl) this.clockEl.textContent = formatClock(this.simSec);
    if (this.scoreEl) {
      const sc = seg ? seg.score : [this.payload?.fixture.hg ?? 0, this.payload?.fixture.ag ?? 0];
      this.scoreEl.textContent = `${sc[0] ?? 0} : ${sc[1] ?? 0}`;
    }
    if (this.tickerEl && seg) {
      this.tickerEl.textContent = seg.text;
    }
    if (this.scrubFillEl && this.scrubThumbEl) {
      const minS = Math.max(0, this.timeline.startTimeSec);
      const span = Math.max(60, this.timeline.endTimeSec - minS);
      const pct = Math.max(0, Math.min(100, ((this.simSec - minS) / span) * 100));
      this.scrubFillEl.style.width = `${pct.toFixed(2)}%`;
      this.scrubThumbEl.style.left = `${pct.toFixed(2)}%`;
    }
  }

  private applySubAndCardVisibility(): void {
    if (!this.players) return;
    // Reset to starter defaults, then replay subs & red cards up to simSec
    this.slots.forEach(s => {
      s.active = s.isStarter;
      s.sentOff = false;
    });
    for (const seg of this.timeline.segments) {
      if (seg.startSec > this.simSec) break;
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
    const seg = this.getSegmentAt(this.simSec);

    if (this.playing && seg) {
      // Smart pacing: compressed midfield filler, natural cinematic playback for key highlights
      const pace = seg.isSynthesized ? 26 * this.speed : 1.55 * this.speed;
      this.simSec += dt * pace;
      if (this.simSec >= this.timeline.endTimeSec) {
        this.simSec = this.timeline.endTimeSec;
        if (this.payload?.fixture.status !== 'live') {
          this.playing = false;
          this.updatePlayButton();
        }
      }
    }

    const activeSeg = this.getSegmentAt(this.simSec);
    if (!activeSeg || !this.players || !this.stadium) return;

    this.applySubAndCardVisibility();

    // Trigger one-shot audio & visual effects on segment transitions
    if (activeSeg.id !== this.lastTriggeredSegId) {
      this.lastTriggeredSegId = activeSeg.id;
      this.syncHudImmediate();
      if (!activeSeg.isSynthesized && this.onActiveEventChange) {
        this.onActiveEventChange(activeSeg.evIndex);
      }

      if (activeSeg.isSetPiece === 'kickoff' || activeSeg.isHalftime || activeSeg.isFulltime) {
        this.audio.playWhistle(activeSeg.isFulltime ? 'double' : 'long');
      } else if (activeSeg.type === 'foul' || activeSeg.isCard || activeSeg.isSetPiece === 'penalty') {
        this.audio.playWhistle('short');
      } else if (!activeSeg.isSynthesized) {
        this.audio.playKick(activeSeg.isGoal || activeSeg.isSave || activeSeg.isPost ? 1.1 : 0.65);
      }

      if (activeSeg.isCard) {
        setRefereeCardColor(this.players.refereeRig, activeSeg.isCard);
      }

      if (activeSeg.isGoal && activeSeg.goalSide) {
        this.stadium.triggerGoalNet(activeSeg.goalSide, 1.35);
        const col = activeSeg.team === 'away'
          ? (this.payload?.fixture.awayColors?.primary || '#e53935')
          : (this.payload?.fixture.homeColors?.primary || '#1e88e5');
        this.stadium.triggerConfetti(activeSeg.goalSide, col);
        this.audio.swellCrowd('goal');
        this.goalMood = 1.0;
        this.goalBannerTimer = 3.6;
        this.goalBannerTeam = activeSeg.team === 'away'
          ? (this.payload?.fixture.awayName || 'Гости')
          : (this.payload?.fixture.homeName || 'Хозяева');
        for (const aid of activeSeg.actorIds) {
          const r = this.players.rigs.get(aid);
          if (r) r.celebrateTimer = 3.2;
        }
      } else if (activeSeg.isPost && activeSeg.ballEnd[0] !== 0) {
        this.audio.playPostPing();
        this.stadium.triggerGoalNet(activeSeg.ballEnd[0] < 0 ? 'left' : 'right', 0.6);
        this.audio.swellCrowd('chance');
      } else if (activeSeg.isSave || activeSeg.type === 'shot') {
        this.audio.swellCrowd('chance');
      }

      // Actor kick / dive / tackle pose impulses
      const primaryRig = activeSeg.actorIds[0] ? this.players.rigs.get(activeSeg.actorIds[0]) : undefined;
      if (primaryRig && !activeSeg.isCard && !activeSeg.isHalftime && !activeSeg.isFulltime) {
        primaryRig.kickTimer = 0.42;
      }
      if (activeSeg.type === 'tackle' && primaryRig) {
        primaryRig.tackleTimer = 0.55;
      }
      if (activeSeg.isSave || activeSeg.isGoal) {
        const defSide = activeSeg.team === 'home' ? 'away' : 'home';
        this.players.rigs.forEach(r => {
          if (r.slot.side === defSide && r.slot.isGk) {
            r.diveTimer = 0.95;
            r.diveDir = activeSeg.ballEnd[2] >= 0 ? 1 : -1;
          }
        });
      }
    }

    // Interpolate Football 3D trajectory (parabolic height + lateral curl)
    const segDur = Math.max(0.1, activeSeg.endSec - activeSeg.startSec);
    const u = Math.max(0, Math.min(1, (this.simSec - activeSeg.startSec) / segDur));
    const easeU = activeSeg.isGoal || activeSeg.isSave || activeSeg.isPost ? u : u * (2 - u);

    this.prevBallPos.copy(this.ballPos);
    const bx = THREE.MathUtils.lerp(activeSeg.ballStart[0], activeSeg.ballEnd[0], easeU);
    const bz = THREE.MathUtils.lerp(activeSeg.ballStart[2], activeSeg.ballEnd[2], easeU)
      + Math.sin(u * Math.PI) * activeSeg.ballCurveZ;
    const by = THREE.MathUtils.lerp(activeSeg.ballStart[1], activeSeg.ballEnd[1], u)
      + 4 * (activeSeg.ballPeakY - 0.24) * u * (1 - u);

    this.ballPos.set(bx, Math.max(0.24, by), bz);
    if (dt > 0.0001) {
      this.ballVel.subVectors(this.ballPos, this.prevBallPos).divideScalar(dt);
    }

    // Compute tactical target positions for all 22 players + referee
    const secondHalf = this.simSec >= 45 * 60;
    const shiftX = this.ballPos.x * 0.36;
    const shiftZ = this.ballPos.z * 0.26;
    this.activeActorIds.clear();
    for (const id of activeSeg.actorIds) this.activeActorIds.add(id);

    this.slotTargetMap.clear();
    this.players.rigs.forEach(rig => {
      if (!rig.root.visible) return;
      const s = rig.slot;
      let tx = secondHalf ? -s.baseX : s.baseX;
      let tz = secondHalf ? -s.baseZ : s.baseZ;

      if (s.isGk) {
        // GK stays near goal line and tracks ball lateral Z
        tx = tx < 0 ? -49.2 : 49.2;
        tz = Math.max(-3.6, Math.min(3.6, this.ballPos.z * 0.35));
      } else {
        tx = Math.max(-47, Math.min(47, tx + shiftX));
        tz = Math.max(-31, Math.min(31, tz + shiftZ));

        // Pack box during corner kicks
        if (activeSeg.isSetPiece === 'corner') {
          const targetBoxX = activeSeg.ballStart[0] > 0 ? 43 : -43;
          if (Math.abs(tx - targetBoxX) < 35) {
            tx = THREE.MathUtils.lerp(tx, targetBoxX, 0.45);
            tz = THREE.MathUtils.lerp(tz, 0, 0.45);
          }
        }
      }
      this.slotTargetMap.set(s.id, [tx, tz]);
    });

    // Primary ball carrier runs along ball start -> active point
    const p0Id = activeSeg.actorIds[0];
    const p1Id = activeSeg.actorIds[1];
    if (p0Id && !activeSeg.isHalftime && !activeSeg.isFulltime) {
      if (activeSeg.type === 'dribble') {
        this.slotTargetMap.set(p0Id, [this.ballPos.x, this.ballPos.z]);
      } else {
        this.slotTargetMap.set(p0Id, [activeSeg.ballStart[0] - Math.sign(activeSeg.ballEnd[0] - activeSeg.ballStart[0] || 1) * 0.45, activeSeg.ballStart[2]]);
      }
    }
    if (p1Id && !activeSeg.isHalftime && !activeSeg.isFulltime) {
      const p1TargetX = activeSeg.isSave ? activeSeg.ballEnd[0] : activeSeg.ballEnd[0];
      const p1TargetZ = activeSeg.isSave ? activeSeg.ballEnd[2] : activeSeg.ballEnd[2] + (activeSeg.type === 'duel' ? 0.9 : 0);
      const p1Rig = this.players.rigs.get(p1Id);
      if (p1Rig && !p1Rig.slot.isGk) {
        this.slotTargetMap.set(p1Id, [Math.max(-48, Math.min(48, p1TargetX)), Math.max(-31, Math.min(31, p1TargetZ))]);
      }
    }

    // Smoothly damp every player toward their target
    const moveDamp = Math.min(1, dt * 4.2);
    this.players.rigs.forEach(rig => {
      if (!rig.root.visible) return;
      const target = this.slotTargetMap.get(rig.slot.id);
      if (!target) return;
      rig.curX = THREE.MathUtils.lerp(rig.curX, target[0], moveDamp);
      rig.curZ = THREE.MathUtils.lerp(rig.curZ, target[1], moveDamp);
    });

    // Referee follows play from smart angle
    const refTargetX = activeSeg.isCard && p0Id && this.players.rigs.get(p0Id)
      ? this.players.rigs.get(p0Id)!.curX + 1.8
      : Math.max(-40, Math.min(40, this.ballPos.x - 4.5));
    const refTargetZ = activeSeg.isCard && p0Id && this.players.rigs.get(p0Id)
      ? this.players.rigs.get(p0Id)!.curZ + 1.4
      : Math.max(-28, Math.min(28, this.ballPos.z - 9.5));
    this.players.refereeRig.curX = THREE.MathUtils.lerp(this.players.refereeRig.curX, refTargetX, moveDamp);
    this.players.refereeRig.curZ = THREE.MathUtils.lerp(this.players.refereeRig.curZ, refTargetZ, moveDamp);

    this.players.updateLabelsVisibility(this.activeActorIds, this.cameraMode === 'tactical');
    this.players.animateRigs(dt, this.elapsedReal, p0Id || null);

    // Goal mood & flash banner decay
    this.goalMood = Math.max(0, this.goalMood - dt * 0.38);
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

    this.stadium.update(dt, this.elapsedReal, this.ballPos, this.ballVel, this.goalMood);
    this.updateCamera(dt, activeSeg);

    // Refresh progress bar smoothly
    if (this.clockEl) this.clockEl.textContent = formatClock(this.simSec);
    if (this.scrubFillEl && this.scrubThumbEl) {
      const minS = Math.max(0, this.timeline.startTimeSec);
      const span = Math.max(60, this.timeline.endTimeSec - minS);
      const pct = Math.max(0, Math.min(100, ((this.simSec - minS) / span) * 100));
      this.scrubFillEl.style.width = `${pct.toFixed(2)}%`;
      this.scrubThumbEl.style.left = `${pct.toFixed(2)}%`;
    }
  }

  private updateCamera(dt: number, activeSeg: PlaySegment): void {
    if (!this.camera || !this.controls) return;
    if (this.userCameraOverride && (this.cameraMode === 'free' || this.cameraMode === 'tactical')) {
      this.controls.update();
      return;
    }

    const bx = this.ballPos.x;
    const bz = this.ballPos.z;
    const damp = 1 - Math.exp(-3.4 * dt);

    if (this.cameraMode === 'tv') {
      const boxFocus = Math.abs(bx) > 30 ? 0.72 : 1.0;
      this.camDesiredTarget.set(bx * 0.68, 0.8, bz * 0.45);
      this.camTarget.lerp(this.camDesiredTarget, damp);
      this.camDesiredPos.set(bx * 0.52, 31 * boxFocus + 6, 46 * boxFocus + bz * 0.22);
      this.camera.position.lerp(this.camDesiredPos, damp);
      this.camera.lookAt(this.camTarget);
    } else if (this.cameraMode === 'tactical') {
      this.camDesiredPos.set(bx * 0.22, 64, 42);
      this.camera.position.lerp(this.camDesiredPos, damp);
      this.camDesiredTarget.set(bx * 0.25, 0, bz * 0.2);
      this.camTarget.lerp(this.camDesiredTarget, damp);
      this.camera.lookAt(this.camTarget);
    } else if (this.cameraMode === 'goal') {
      const atkRight = activeSeg.ballEnd[0] >= 0;
      const gCamX = atkRight ? 61 : -61;
      this.camDesiredPos.set(gCamX, 11.5, bz * 0.35);
      this.camera.position.lerp(this.camDesiredPos, damp);
      this.camDesiredTarget.set(bx * 0.7, 1.2, bz * 0.5);
      this.camTarget.lerp(this.camDesiredTarget, damp);
      this.camera.lookAt(this.camTarget);
    } else {
      this.controls.update();
    }
  }

  private startLoop(): void {
    this.lastClockTime = performance.now();
    const afterDraw = (cb: () => void) => {
      this.rafId = requestAnimationFrame(() => {
        this.afterDrawTimeout = window.setTimeout(cb, 0);
      });
    };

    const tick = () => {
      if (this.destroyed) return;
      const now = performance.now();
      const dt = Math.min(0.08, Math.max(0.001, (now - this.lastClockTime) / 1000));
      this.lastClockTime = now;

      if (!this.hiddenPaused && !this.contextLost && this.renderer && this.scene && this.camera) {
        this.elapsedReal += dt;
        this.stepSimulation(dt);
        this.renderer.render(this.scene, this.camera);
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
    this.controls?.dispose();
    this.controls = null;
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
}

const instance = new Match3DEngine();

declare global {
  interface Window {
    Match3D?: Match3DEngine;
  }
}

window.Match3D = instance;

export default instance;
