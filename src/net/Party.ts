import type { Vehicle } from '../vehicles/Vehicle';
import { type PlayerInfo, type Transport, makeTransport } from './Transport';

export const MAX_PLAYERS = 8;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I

/** Position snapshot: [x,y,z, qx,qy,qz,qw, vx,vy,vz, steer, flags]. */
export type Snapshot = number[];
export const FLAG_BOOST = 1, FLAG_BRAKE = 2, FLAG_DRIFT = 4, FLAG_HORN = 8;

export interface ChatLine {
  from: string;
  name: string;
  text: string;
  emote?: boolean;
}

export function makeCode(cityPrefix: string) {
  let s = '';
  for (let i = 0; i < 3; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return `${cityPrefix}-${s}`;
}

/** Accepts "khi7q2", "KHI-7Q2", " khi 7q2 " … */
export function normaliseCode(raw: string) {
  const c = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === 6 ? `${c.slice(0, 3)}-${c.slice(3)}` : '';
}

function sessionId() {
  let id = sessionStorage.getItem('neoncruise.pid');
  if (!id) {
    id = Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem('neoncruise.pid', id);
  }
  return id;
}

/** A party of up to eight players cruising the same city. */
export class Party {
  readonly id = sessionId();
  code = '';
  players: PlayerInfo[] = [];
  connected = false;
  onRoster: (players: PlayerInfo[]) => void = () => {};
  onSnapshot: (from: string, s: Snapshot) => void = () => {};
  onChat: (line: ChatLine) => void = () => {};
  /** Other game systems (race mode) can listen for their own events. */
  onEvent: (event: string, from: string, payload: unknown) => void = () => {};

  private transport: Transport | null = null;
  private me!: PlayerInfo;
  private sendTimer = 0;
  private lastMoving = 0;

  get isHost() {
    return this.connected && this.host?.id === this.id;
  }

  get host(): PlayerInfo | undefined {
    return [...this.players].sort((a, b) => a.joined - b.joined || (a.id < b.id ? -1 : 1))[0];
  }

  nameOf(id: string) {
    return this.players.find((p) => p.id === id)?.name ?? 'Driver';
  }

  async join(code: string, info: Omit<PlayerInfo, 'id' | 'joined'>) {
    this.leave();
    const t = makeTransport();
    this.me = { ...info, id: this.id, joined: Date.now() };
    t.onRoster = (list) => {
      this.players = list.slice(0, MAX_PLAYERS + 4);
      this.onRoster(this.players);
    };
    t.onMessage = (event, from, payload) => {
      if (event === 's') this.onSnapshot(from, payload as Snapshot);
      else if (event === 'chat') {
        const p = payload as { t: string; e?: boolean };
        this.onChat({ from, name: this.nameOf(from), text: String(p.t).slice(0, 140), emote: p.e });
      } else this.onEvent(event, from, payload);
    };
    await t.join(code, this.me);
    this.transport = t;
    this.code = code;
    this.connected = true;
  }

  leave() {
    this.transport?.leave();
    this.transport = null;
    this.connected = false;
    this.code = '';
    this.players = [];
    this.onRoster([]);
  }

  /** Call when the local player changes vehicle, colours or name. */
  updateInfo(info: Omit<PlayerInfo, 'id' | 'joined'>) {
    if (!this.transport) return;
    this.me = { ...this.me, ...info };
    this.transport.updateInfo(this.me);
  }

  chat(text: string, emote = false) {
    const t = text.trim().slice(0, 140);
    if (!t || !this.transport) return;
    this.transport.send('chat', { t, e: emote });
    this.onChat({ from: this.id, name: this.me.name, text: t, emote });
  }

  send(event: string, payload: unknown) {
    this.transport?.send(event, payload);
  }

  /** Call every frame; sends position updates at a rate that fits the server's message budget. */
  update(dt: number, v: Vehicle, horn: boolean, extra?: number[]) {
    if (!this.transport || this.players.length < 2) return;
    this.sendTimer -= dt;
    const moving = v.speed > 0.3 || horn;
    if (moving) this.lastMoving = 0;
    else this.lastMoving += dt;
    if (this.sendTimer > 0) return;
    // ~10 Hz each, backing off as the party fills so the room stays under ~80 messages/s; idle cars send rarely
    const n = this.players.length;
    this.sendTimer = this.lastMoving > 1 ? 0.7 : Math.max(0.1, n / 80);
    const r = (x: number, k = 100) => Math.round(x * k) / k;
    const p = v.body.translation();
    const q = v.body.rotation();
    const flags = (v.boosting ? FLAG_BOOST : 0) | (v.braking ? FLAG_BRAKE : 0) | (v.drifting ? FLAG_DRIFT : 0) | (horn ? FLAG_HORN : 0);
    this.transport.send('s', [
      r(p.x), r(p.y), r(p.z), r(q.x, 1000), r(q.y, 1000), r(q.z, 1000), r(q.w, 1000),
      r(v.velocity.x, 10), r(v.velocity.y, 10), r(v.velocity.z, 10), r(v.steer, 10), flags,
      ...(extra ?? []),
    ]);
  }
}
