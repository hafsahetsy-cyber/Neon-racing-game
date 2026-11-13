import type { Vehicle } from '../vehicles/Vehicle';

const ARC = 2 * Math.PI * 86 * 0.75; // 270° arc length at r=86

/** In-game overlay: speedometer, gear, boost meter, drift readout, toasts, help. */
export class Hud {
  private speedEl: HTMLElement;
  private gearEl: HTMLElement;
  private arcEl: SVGCircleElement;
  private rpmEl: SVGCircleElement;
  private boostEl: HTMLElement;
  private boostWrap: HTMLElement;
  private driftEl: HTMLElement;
  private fpsEl: HTMLElement;
  private toastEl: HTMLElement;
  private helpEl: HTMLElement;
  private root: HTMLElement;
  private toastTimer = 0;
  private driftScore = 0;
  private driftHold = 0;
  private frames = 0;
  private fpsTime = 0;
  fps = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="fps" data-fps></div>
      <div class="toast" data-toast></div>
      <div class="drift" data-drift></div>
      <div class="help" data-help>
        <h3>CONTROLS</h3>
        <div><b>W / ↑</b> accelerate</div><div><b>S / ↓</b> brake · reverse</div>
        <div><b>A D / ← →</b> steer</div><div><b>SPACE</b> handbrake · drift</div>
        <div><b>SHIFT</b> boost</div><div><b>E</b> horn</div>
        <div><b>C</b> camera</div><div><b>R</b> reset car</div>
        <div><b>G</b> graphics quality</div><div><b>M</b> mute · <b>H</b> hide help</div>
        <div class="pad">Gamepad: RT gas · LT brake · A drift · X boost · Y camera</div>
      </div>
      <div class="speedo">
        <svg viewBox="0 0 200 200">
          <circle class="track" cx="100" cy="100" r="86" />
          <circle class="arc" data-arc cx="100" cy="100" r="86" />
          <circle class="rpm-track" cx="100" cy="100" r="74" />
          <circle class="rpm" data-rpm cx="100" cy="100" r="74" />
        </svg>
        <div class="readout">
          <div class="speed" data-speed>0</div>
          <div class="unit">KM/H</div>
          <div class="gear" data-gear>1</div>
        </div>
        <div class="boost" data-boostwrap><div class="boost-fill" data-boost></div><span>BOOST</span></div>
      </div>`;
    parent.appendChild(this.root);
    const q = <T extends Element>(s: string) => this.root.querySelector(s) as T;
    this.speedEl = q('[data-speed]');
    this.gearEl = q('[data-gear]');
    this.arcEl = q('[data-arc]');
    this.rpmEl = q('[data-rpm]');
    this.boostEl = q('[data-boost]');
    this.boostWrap = q('[data-boostwrap]');
    this.driftEl = q('[data-drift]');
    this.fpsEl = q('[data-fps]');
    this.toastEl = q('[data-toast]');
    this.helpEl = q('[data-help]');
    const rpmArc = 2 * Math.PI * 74 * 0.75;
    this.arcEl.style.strokeDasharray = `${ARC} 999`;
    this.rpmEl.style.strokeDasharray = `${rpmArc} 999`;
  }

  toast(text: string) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this.toastTimer = 1.8;
  }

  toggleHelp() {
    this.helpEl.classList.toggle('hidden');
  }

  update(dt: number, v: Vehicle) {
    const kmh = Math.round(v.speed * 3.6);
    this.speedEl.textContent = String(kmh);
    this.gearEl.textContent = v.gear === 0 ? 'R' : String(v.gear);
    const maxKmh = v.config.engine.topSpeed * v.config.boost.topSpeedMul * 3.6;
    const frac = Math.min(1, kmh / maxKmh);
    this.arcEl.style.strokeDashoffset = String(ARC * (1 - frac));
    const rpmArc = 2 * Math.PI * 74 * 0.75;
    this.rpmEl.style.strokeDashoffset = String(rpmArc * (1 - v.rpm));
    this.boostEl.style.transform = `scaleX(${v.boost.toFixed(3)})`;
    this.boostWrap.classList.toggle('active', v.boosting);
    this.root.classList.toggle('boosting', v.boosting);

    // drift score
    if (v.drifting && v.speed > 8) {
      this.driftScore += dt * v.speed * (0.5 + v.driftAmount) * 4;
      this.driftHold = 1.2;
    } else if (this.driftHold > 0) {
      this.driftHold -= dt;
      if (this.driftHold <= 0) this.driftScore = 0;
    }
    if (this.driftScore > 30) {
      this.driftEl.textContent = `DRIFT  ${Math.round(this.driftScore)}`;
      this.driftEl.classList.add('show');
    } else this.driftEl.classList.remove('show');

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }

    this.frames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.frames / this.fpsTime);
      this.fpsEl.textContent = `${this.fps} FPS`;
      this.frames = 0;
      this.fpsTime = 0;
    }
  }
}
