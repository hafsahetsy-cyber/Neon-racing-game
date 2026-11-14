import { QUALITY, QUALITY_ORDER, type QualityLevel } from '../core/Quality';
import { type VehicleConfig, realTopSpeed } from '../vehicles/VehicleConfig';

export type Screen = 'title' | 'garage' | 'pause' | 'settings' | 'party' | 'race' | 'results' | 'photo' | 'none';

export interface RaceView {
  routes: { name: string; blurb: string; len: number; best?: string }[];
  /** Why the player cannot start a race, or '' if they can. */
  blocked: string;
  routeName: string;
  results: { place: number; name: string; time: string; self: boolean }[];
  newBest: boolean;
  /** A race is in progress for this player. */
  active: boolean;
}

export interface PartyView {
  code: string;
  connected: boolean;
  hostId: string;
  selfId: string;
  players: { id: string; name: string; vehicle: string; neon: number }[];
}

export interface MenuHost {
  vehicles: VehicleConfig[];
  currentVehicle(): VehicleConfig;
  selectVehicle(cfg: VehicleConfig): Promise<void>;
  setColors(paint: number, neon: number, accent: number): void;
  drive(): void;
  resume(): void;
  toTitle(): void;
  quality(): QualityLevel;
  setQuality(q: QualityLevel): void;
  volumes(): { music: number; sfx: number };
  setVolumes(music: number, sfx: number): void;
  party(): PartyView;
  race(): RaceView;
  startRace(route: number): void;
  endRace(): void;
  savePhoto(): void;
  exitPhoto(): void;
  playerName(): string;
  setName(name: string): void;
  createParty(): Promise<void>;
  joinParty(code: string): Promise<void>;
  leaveParty(): void;
  raining(): boolean;
  setRain(on: boolean): void;
}

const PAINTS = [0x12b8a6, 0xd4122e, 0x2a1a6e, 0xf2c200, 0xf5f5f0, 0x101014, 0xff6a13, 0x1560ff, 0x1fa34a, 0xb0126f];
const NEONS = [0x00f0ff, 0xff2bd6, 0x7dff5a, 0xffa630, 0x7a5cff, 0xff3040, 0xffffff, 0xfff04a];
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

/** Title screen, garage, pause and settings — plain DOM over the live 3D scene. */
export class Menu {
  screen: Screen = 'title';
  private root: HTMLElement;
  private back: Screen = 'title';
  private error = '';
  private routePick = 0;
  private busy = false;
  /** Pre-filled join code (from a shared ?party= link). */
  pendingCode = '';

  constructor(parent: HTMLElement, private host: MenuHost) {
    this.root = document.createElement('div');
    this.root.className = 'menu';
    parent.appendChild(this.root);
    this.root.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (t) this.act(t.dataset.act!, t.dataset.val);
    });
    this.root.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.in === 'name') this.host.setName(t.value.slice(0, 16));
      if (t.dataset.in === 'code') this.pendingCode = t.value;
      if (t.dataset.vol) {
        const v = this.host.volumes();
        if (t.dataset.vol === 'music') this.host.setVolumes(+t.value, v.sfx);
        else this.host.setVolumes(v.music, +t.value);
      }
    });
    window.addEventListener('keydown', (e) => {
      if (this.screen === 'none') return;
      const typing = (e.target as HTMLElement).tagName === 'INPUT';
      if (typing) {
        e.stopPropagation();
        if (e.code === 'Enter' && (e.target as HTMLElement).dataset.in === 'code') this.act('join');
        return;
      }
      if (e.code === 'Enter' && (this.screen === 'title' || this.screen === 'garage')) this.act('drive');
      if (this.screen === 'garage' && (e.code === 'ArrowLeft' || e.code === 'KeyA')) this.act('prev');
      if (this.screen === 'garage' && (e.code === 'ArrowRight' || e.code === 'KeyD')) this.act('next');
    });
    this.show('title');
  }

  show(screen: Screen) {
    this.screen = screen;
    this.root.dataset.screen = screen;
    this.render();
  }

  /** Re-draw after the roster changes, unless the player is mid-typing. */
  refresh() {
    if (this.screen === 'results' || this.screen === 'race') this.render();
    if (this.screen === 'party' && document.activeElement?.tagName !== 'INPUT') this.render();
  }

  private async net(fn: () => Promise<void>) {
    this.busy = true;
    this.error = '';
    this.render();
    try {
      await fn();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Could not connect';
    }
    this.busy = false;
    this.render();
  }

  private act(act: string, val?: string) {
    const h = this.host;
    const list = h.vehicles;
    const i = list.indexOf(h.currentVehicle());
    switch (act) {
      case 'drive': this.show('none'); h.drive(); break;
      case 'resume': this.show('none'); h.resume(); break;
      case 'garage': this.back = this.screen; this.show('garage'); break;
      case 'settings': this.back = this.screen; this.show('settings'); break;
      case 'party': this.back = this.screen; this.error = ''; this.show('party'); break;
      case 'race': if (this.screen !== 'party') this.back = this.screen; this.show('race'); break;
      case 'route': this.routePick = +val!; this.render(); break;
      case 'startrace': h.startRace(this.routePick); break;
      case 'endrace': h.endRace(); this.show('none'); h.drive(); break;
      case 'photosave': h.savePhoto(); break;
      case 'photoexit': h.exitPhoto(); break;
      case 'create': void this.net(() => h.createParty()); break;
      case 'join': void this.net(() => h.joinParty(this.pendingCode)); break;
      case 'leave': h.leaveParty(); this.render(); break;
      case 'copy': {
        const url = `${location.origin}${location.pathname}?party=${h.party().code}`;
        void navigator.clipboard?.writeText(url);
        this.error = 'Invite link copied';
        this.render();
        break;
      }
      case 'back': this.show(this.back === 'pause' ? 'pause' : 'title'); break;
      case 'title': h.toTitle(); this.show('title'); break;
      case 'prev': void h.selectVehicle(list[(i + list.length - 1) % list.length]).then(() => this.render()); break;
      case 'next': void h.selectVehicle(list[(i + 1) % list.length]).then(() => this.render()); break;
      case 'paint': { const c = h.currentVehicle().colors; h.setColors(+val!, c.neon, c.accent); this.render(); break; }
      case 'neon': { const c = h.currentVehicle().colors; h.setColors(c.paint, +val!, c.accent); this.render(); break; }
      case 'accent': { const c = h.currentVehicle().colors; h.setColors(c.paint, c.neon, +val!); this.render(); break; }
      case 'quality': h.setQuality(val as QualityLevel); this.render(); break;
      case 'rain': h.setRain(!h.raining()); this.render(); break;
    }
  }

  private render() {
    const h = this.host;
    if (this.screen === 'none') {
      this.root.innerHTML = '';
      return;
    }
    if (this.screen === 'title') {
      this.root.innerHTML = `
        <div class="title">
          <div class="logo">NEON<span>CRUISE</span></div>
          <div class="city">NEO KARACHI · SADDAR · 2099</div>
          <div class="btns">
            <button class="btn primary" data-act="drive">DRIVE</button>
            <button class="btn" data-act="race">RACE</button>
            <button class="btn" data-act="party">PARTY</button>
            <button class="btn" data-act="garage">GARAGE</button>
            <button class="btn" data-act="settings">SETTINGS</button>
          </div>
          <div class="hint">ENTER to drive · no timer, no rules — just cruise</div>
        </div>`;
      return;
    }
    if (this.screen === 'pause') {
      this.root.innerHTML = `
        <div class="panel centre">
          <h2>PAUSED</h2>
          <button class="btn primary" data-act="resume">RESUME</button>
          ${h.race().active ? '<button class="btn" data-act="endrace">QUIT RACE</button>' : ''}
          <button class="btn" data-act="race">RACE</button>
          <button class="btn" data-act="party">PARTY</button>
          <button class="btn" data-act="garage">GARAGE</button>
          <button class="btn" data-act="settings">SETTINGS</button>
          <button class="btn" data-act="title">MAIN MENU</button>
        </div>`;
      return;
    }
    if (this.screen === 'settings') {
      const v = h.volumes();
      this.root.innerHTML = `
        <div class="panel centre wide">
          <h2>SETTINGS</h2>
          <label>GRAPHICS</label>
          <div class="row">${QUALITY_ORDER.map((q) => `<button class="chip ${q === h.quality() ? 'on' : ''}" data-act="quality" data-val="${q}">${QUALITY[q].label}</button>`).join('')}</div>
          <label>MUSIC</label><input type="range" min="0" max="1" step="0.05" value="${v.music}" data-vol="music" />
          <label>ENGINE &amp; EFFECTS</label><input type="range" min="0" max="1" step="0.05" value="${v.sfx}" data-vol="sfx" />
          <label>WEATHER</label>
          <div class="row"><button class="chip ${h.raining() ? '' : 'on'}" data-act="rain">CLEAR</button><button class="chip ${h.raining() ? 'on' : ''}" data-act="rain">MONSOON</button></div>
          <button class="btn" data-act="back">BACK</button>
        </div>`;
      return;
    }
    if (this.screen === 'photo') {
      this.root.innerHTML = `
        <div class="photo-bar">
          <span>PHOTO MODE · drag to orbit · scroll to zoom</span>
          <button class="btn primary" data-act="photosave">SAVE PHOTO</button>
          <button class="btn" data-act="photoexit">EXIT</button>
        </div>`;
      return;
    }
    if (this.screen === 'race') {
      const r = h.race();
      this.root.innerHTML = `
        <div class="panel centre wide">
          <h2>RACE</h2>
          <div class="routes">${r.routes.map((x, i) => `<button class="route ${i === this.routePick ? 'on' : ''}" data-act="route" data-val="${i}"><b>${x.name}</b><span>${(x.len / 1000).toFixed(1)} km · ${x.blurb}${x.best ? ' · best ' + x.best : ''}</span></button>`).join('') || '<div class="note">No routes in this world.</div>'}</div>
          <div class="err">${r.blocked}</div>
          <div class="row end">
            <button class="btn" data-act="back">BACK</button>
            <button class="btn primary" data-act="startrace" ${r.blocked || !r.routes.length ? 'disabled' : ''}>START RACE</button>
          </div>
        </div>`;
      return;
    }
    if (this.screen === 'results') {
      const r = h.race();
      const safe = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
      this.root.innerHTML = `
        <div class="panel centre wide">
          <h2>FINISH</h2>
          <div class="note">${safe(r.routeName)}${r.newBest ? ' · NEW PERSONAL BEST' : ''}</div>
          <table class="results">${r.results.map((x) => `<tr class="${x.self ? 'me' : ''}"><td>${x.place}</td><td>${safe(x.name)}</td><td>${x.time}</td></tr>`).join('')}</table>
          <div class="row end"><button class="btn primary" data-act="endrace">BACK TO CRUISE</button></div>
        </div>`;
      return;
    }
    if (this.screen === 'party') {
      const p = h.party();
      const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
      if (!p.connected) {
        this.root.innerHTML = `
          <div class="panel centre wide">
            <h2>PARTY</h2>
            <label>YOUR NAME</label>
            <input class="field" data-in="name" maxlength="16" value="${esc(h.playerName())}" aria-label="Your name" />
            <button class="btn primary" data-act="create" ${this.busy ? 'disabled' : ''}>CREATE PARTY</button>
            <label>OR JOIN WITH A CODE</label>
            <input class="field code" data-in="code" maxlength="8" placeholder="KHI-7Q2" value="${esc(this.pendingCode)}" aria-label="Party code" />
            <button class="btn" data-act="join" ${this.busy ? 'disabled' : ''}>JOIN PARTY</button>
            <div class="err">${this.busy ? 'Connecting…' : esc(this.error)}</div>
            <button class="btn" data-act="back">BACK</button>
          </div>`;
      } else {
        this.root.innerHTML = `
          <div class="panel centre wide">
            <h2>PARTY</h2>
            <div class="bigcode">${esc(p.code)}</div>
            <div class="note">Share this code — up to 8 players cruise the same city.</div>
            <div class="plist">${p.players.map((x) => `<div style="--c:#${x.neon.toString(16).padStart(6, '0')}"><span>${esc(x.name)}${x.id === p.selfId ? ' (you)' : ''}</span><small>${x.id === p.hostId ? 'HOST · ' : ''}${esc(x.vehicle)}</small></div>`).join('')}</div>
            <div class="err">${esc(this.error)}</div>
            <div class="row">
              <button class="btn" data-act="copy">COPY LINK</button>
              <button class="btn" data-act="leave">LEAVE</button>
              <button class="btn" data-act="race">RACE</button>
              <button class="btn primary" data-act="drive">DRIVE</button>
            </div>
          </div>`;
      }
      return;
    }
    // garage
    const c = h.currentVehicle();
    const stat = (label: string, v: number) =>
      `<div class="stat"><span>${label}</span><div class="bar"><i style="width:${v * 10}%"></i></div></div>`;
    const sw = (act: string, list: number[], cur: number) =>
      list.map((x) => `<button class="sw ${x === cur ? 'on' : ''}" style="--c:${hex(x)}" data-act="${act}" data-val="${x}" aria-label="${act} ${hex(x)}"></button>`).join('');
    const kmh = Math.round(realTopSpeed(c) * 3.6);
    this.root.innerHTML = `
      <div class="garage-top"><h2>GARAGE</h2><div class="count">${h.vehicles.indexOf(c) + 1} / ${h.vehicles.length}</div></div>
      <button class="arrow left" data-act="prev" aria-label="Previous vehicle">◀</button>
      <button class="arrow right" data-act="next" aria-label="Next vehicle">▶</button>
      <div class="garage-panel">
        <div class="vinfo">
          <div class="vname">${c.name}</div>
          <div class="vtag">${c.tagline}</div>
          <div class="vspeed">${kmh} <small>KM/H TOP SPEED</small></div>
          ${stat('SPEED', c.stats.speed)}${stat('ACCEL', c.stats.accel)}${stat('HANDLING', c.stats.handling)}${stat('DRIFT', c.stats.drift)}
        </div>
        <div class="vcolors">
          <label>PAINT</label><div class="row">${sw('paint', PAINTS, c.colors.paint)}</div>
          <label>NEON</label><div class="row">${sw('neon', NEONS, c.colors.neon)}</div>
          <label>ACCENT</label><div class="row">${sw('accent', NEONS, c.colors.accent)}</div>
          <div class="row end">
            <button class="btn" data-act="back">BACK</button>
            <button class="btn primary" data-act="drive">DRIVE</button>
          </div>
        </div>
      </div>`;
  }
}
