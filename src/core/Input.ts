/** Unified driving input from keyboard, gamepad and touch. */
export interface DriveInput {
  steer: number; // -1 (left) .. 1 (right)
  throttle: number; // 0..1
  brake: number; // 0..1
  handbrake: boolean;
  boost: boolean;
  horn: boolean;
}

export type InputAction =
  | 'reset' | 'camera' | 'help' | 'quality' | 'pause' | 'mute' | 'weather' | 'chat'
  | 'emote1' | 'emote2' | 'emote3' | 'emote4';

const typing = (e: Event) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
};

export class Input {
  readonly state: DriveInput = { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false, horn: false };
  /** Set from code (tests, AI, replays) to bypass devices. */
  override: Partial<DriveInput> | null = null;

  private keys = new Set<string>();
  private touch = { left: false, right: false, gas: false, brake: false, drift: false, boost: false };
  private listeners: Array<(a: InputAction) => void> = [];
  private padPrev: boolean[] = [];
  onFirstGesture: (() => void) | null = null;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat || typing(e)) return;
      this.gesture();
      this.keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      switch (e.code) {
        case 'KeyR': this.emit('reset'); break;
        case 'KeyC': this.emit('camera'); break;
        case 'KeyH': this.emit('help'); break;
        case 'KeyG': this.emit('quality'); break;
        case 'KeyM': this.emit('mute'); break;
        case 'KeyT': this.emit('weather'); break;
        case 'Enter': this.emit('chat'); e.preventDefault(); break;
        case 'Digit1': this.emit('emote1'); break;
        case 'Digit2': this.emit('emote2'); break;
        case 'Digit3': this.emit('emote3'); break;
        case 'Digit4': this.emit('emote4'); break;
        case 'Escape': this.emit('pause'); break;
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('pointerdown', () => this.gesture());
  }

  on(fn: (a: InputAction) => void) {
    this.listeners.push(fn);
  }

  private emit(a: InputAction) {
    for (const l of this.listeners) l(a);
  }

  private gesture() {
    if (this.onFirstGesture) {
      this.onFirstGesture();
      this.onFirstGesture = null;
    }
  }

  private k(...codes: string[]) {
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  /** Builds on-screen controls. Only shown on touch devices. */
  mountTouchControls(root: HTMLElement) {
    if (!('ontouchstart' in window) && navigator.maxTouchPoints === 0) return;
    const wrap = document.createElement('div');
    wrap.className = 'touch';
    const mk = (cls: string, label: string, key: keyof Input['touch']) => {
      const b = document.createElement('button');
      b.className = `tbtn ${cls}`;
      b.textContent = label;
      const set = (v: boolean) => (e: Event) => {
        e.preventDefault();
        this.touch[key] = v;
        if (v) this.gesture();
      };
      b.addEventListener('pointerdown', set(true));
      b.addEventListener('pointerup', set(false));
      b.addEventListener('pointercancel', set(false));
      b.addEventListener('pointerleave', set(false));
      wrap.appendChild(b);
    };
    mk('t-left', '◀', 'left');
    mk('t-right', '▶', 'right');
    mk('t-gas', 'GAS', 'gas');
    mk('t-brake', 'BRK', 'brake');
    mk('t-drift', 'DRIFT', 'drift');
    mk('t-boost', 'BOOST', 'boost');
    root.appendChild(wrap);
  }

  update() {
    const s = this.state;
    let steer = 0;
    let throttle = 0;
    let brake = 0;
    let handbrake = false;
    let boost = false;
    let horn = false;

    if (this.k('KeyA', 'ArrowLeft') || this.touch.left) steer -= 1;
    if (this.k('KeyD', 'ArrowRight') || this.touch.right) steer += 1;
    if (this.k('KeyW', 'ArrowUp') || this.touch.gas) throttle = 1;
    if (this.k('KeyS', 'ArrowDown') || this.touch.brake) brake = 1;
    if (this.k('Space') || this.touch.drift) handbrake = true;
    if (this.k('ShiftLeft', 'ShiftRight', 'KeyN') || this.touch.boost) boost = true;
    if (this.k('KeyE')) horn = true;

    const pad = navigator.getGamepads?.().find((p) => p && p.connected);
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
      const ax = dz(pad.axes[0] ?? 0);
      if (Math.abs(ax) > Math.abs(steer)) steer = ax;
      const b = (i: number) => pad.buttons[i]?.value ?? 0;
      throttle = Math.max(throttle, b(7));
      brake = Math.max(brake, b(6));
      if (b(0) > 0.5) handbrake = true;
      if (b(2) > 0.5 || b(1) > 0.5 || b(5) > 0.5) boost = true;
      if (b(10) > 0.5) horn = true;
      const edge = (i: number, a: InputAction) => {
        const down = b(i) > 0.5;
        if (down && !this.padPrev[i]) this.emit(a);
        this.padPrev[i] = down;
      };
      edge(3, 'camera');
      edge(8, 'reset');
      edge(9, 'pause');
      if (throttle > 0 || brake > 0) this.gesture();
    }

    s.steer = steer;
    s.throttle = throttle;
    s.brake = brake;
    s.handbrake = handbrake;
    s.boost = boost;
    s.horn = horn;
    if (this.override) Object.assign(s, this.override);
  }
}
