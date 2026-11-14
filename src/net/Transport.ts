import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

/** What every player announces about themselves (presence). */
export interface PlayerInfo {
  id: string;
  name: string;
  vehicle: string;
  paint: number;
  neon: number;
  accent: number;
  /** ms since epoch when they joined; the earliest joiner is the host. */
  joined: number;
}

/**
 * Minimal realtime room: presence (who is here) + broadcast (small messages to everyone else).
 * The game only talks to this interface, so the backend can be swapped (Supabase today;
 * PartyKit / Colyseus later if we outgrow it).
 */
export interface Transport {
  join(room: string, me: PlayerInfo): Promise<void>;
  leave(): void;
  updateInfo(me: PlayerInfo): void;
  send(event: string, payload: unknown): void;
  onMessage: (event: string, from: string, payload: unknown) => void;
  onRoster: (players: PlayerInfo[]) => void;
}

// The publishable key is designed to ship in client code; it grants only what the project's
// public policies allow (here: public Realtime channels, no database tables).
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? 'https://kydyfmgftfvvbkcyiivy.supabase.co';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY ?? 'sb_publishable_rweCUKMOtDNZpx2LM0j9dA_KNOnx4kK';

export class SupabaseTransport implements Transport {
  onMessage: Transport['onMessage'] = () => {};
  onRoster: Transport['onRoster'] = () => {};
  private client: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;
  private me!: PlayerInfo;

  async join(room: string, me: PlayerInfo) {
    this.me = me;
    // loaded on demand: solo players never download the realtime client
    const { createClient } = await import('@supabase/supabase-js');
    this.client ??= createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 20 } },
    });
    const ch = this.client.channel(`party:${room}`, { config: { broadcast: { self: false, ack: false }, presence: { key: me.id } } });
    this.channel = ch;
    ch.on('broadcast', { event: '*' }, (msg) => {
      const p = msg.payload as { f: string; d: unknown };
      if (p && p.f !== this.me.id) this.onMessage(msg.event, p.f, p.d);
    });
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState<PlayerInfo>();
      const list: PlayerInfo[] = [];
      for (const key of Object.keys(state)) {
        const latest = state[key][state[key].length - 1];
        if (latest) list.push(latest as unknown as PlayerInfo);
      }
      this.onRoster(list);
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out connecting to the party server')), 12000);
      ch.subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timer);
          void ch.track(this.me);
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timer);
          reject(err ?? new Error(`Party server: ${status}`));
        }
      });
    });
  }

  updateInfo(me: PlayerInfo) {
    this.me = me;
    void this.channel?.track(me);
  }

  send(event: string, payload: unknown) {
    void this.channel?.send({ type: 'broadcast', event, payload: { f: this.me.id, d: payload } });
  }

  leave() {
    if (this.channel) void this.client?.removeChannel(this.channel);
    this.channel = null;
  }
}

/** Same-browser transport over BroadcastChannel: lets two tabs play together offline (dev + tests). */
export class LocalTransport implements Transport {
  onMessage: Transport['onMessage'] = () => {};
  onRoster: Transport['onRoster'] = () => {};
  private bc: BroadcastChannel | null = null;
  private me!: PlayerInfo;
  private peers = new Map<string, { info: PlayerInfo; seen: number }>();
  private timer = 0;

  async join(room: string, me: PlayerInfo) {
    this.me = me;
    this.bc = new BroadcastChannel(`neoncruise:${room}`);
    this.bc.onmessage = (e) => {
      const m = e.data as { e: string; f: string; d: unknown };
      if (m.f === this.me.id) return;
      if (m.e === '__hello' || m.e === '__info') {
        const known = this.peers.has(m.f);
        this.peers.set(m.f, { info: m.d as PlayerInfo, seen: performance.now() });
        if (m.e === '__hello') this.raw('__info', this.me);
        if (!known || m.e === '__info') this.roster();
      } else if (m.e === '__bye') {
        this.peers.delete(m.f);
        this.roster();
      } else this.onMessage(m.e, m.f, m.d);
    };
    this.raw('__hello', me);
    this.timer = window.setInterval(() => {
      this.raw('__info', this.me);
      const now = performance.now();
      let changed = false;
      for (const [id, p] of this.peers)
        if (now - p.seen > 6000) {
          this.peers.delete(id);
          changed = true;
        }
      if (changed) this.roster();
    }, 2000);
    window.addEventListener('pagehide', () => this.raw('__bye', null));
    this.roster();
  }

  private raw(e: string, d: unknown) {
    this.bc?.postMessage({ e, f: this.me.id, d });
  }

  private roster() {
    this.onRoster([this.me, ...[...this.peers.values()].map((p) => p.info)]);
  }

  updateInfo(me: PlayerInfo) {
    this.me = me;
    this.raw('__info', me);
    this.roster();
  }

  send(event: string, payload: unknown) {
    this.raw(event, payload);
  }

  leave() {
    this.raw('__bye', null);
    clearInterval(this.timer);
    this.bc?.close();
    this.bc = null;
    this.peers.clear();
  }
}

export function makeTransport(): Transport {
  return new URLSearchParams(location.search).get('net') === 'local' ? new LocalTransport() : new SupabaseTransport();
}
