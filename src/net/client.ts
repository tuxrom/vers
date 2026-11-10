import { PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from './protocol';

/** URL du serveur de salons : même origine que la page, chemin `/ws` (proxifié par nginx, voir nginx.conf). */
export function defaultServerUrl(loc: Pick<Location, 'protocol' | 'host'> = location): string {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`;
}

export type NetStatus = 'closed' | 'connecting' | 'open';

/**
 * Connexion WebSocket au serveur de salons : messages typés, mesure de latence (ping toutes les 2 s, moyenne lissée)
 * et signalement de la fermeture. La reconnexion après une coupure est pilotée par `OnlineController` (nouvelle
 * connexion + message `resume`).
 */
export class NetClient {
  private ws: WebSocket | null = null;
  private pingTimer = 0;
  private seq = 0;
  private sent = new Map<number, number>();
  status: NetStatus = 'closed';
  /** Identifiant attribué par le serveur (message `welcome`). */
  id = '';
  /** Secret de la connexion (message `welcome`) : sert à reprendre sa place après une coupure. */
  key = '';
  /** Latence aller-retour lissée (ms), -1 tant qu'inconnue. */
  rtt = -1;
  onMessage: (m: ServerMsg) => void = () => {};
  onClose: (reason: string) => void = () => {};

  constructor(private now: () => number = () => performance.now()) {}

  /** Ouvre la connexion et envoie `hello` ; résout quand le serveur a répondu `welcome`. */
  connect(url: string, name: string, timeoutMs = 8000): Promise<void> {
    return new Promise((resolve, reject) => {
      this.close();
      this.status = 'connecting';
      let settled = false;
      const fail = (why: string): void => { if (!settled) { settled = true; this.status = 'closed'; reject(new Error(why)); } };
      const timer = window.setTimeout(() => { fail('timeout'); this.ws?.close(); }, timeoutMs);
      let ws: WebSocket;
      try { ws = new WebSocket(url); } catch (e) { window.clearTimeout(timer); fail(String(e)); return; }
      this.ws = ws;
      ws.onopen = () => this.send({ t: 'hello', v: PROTOCOL_VERSION, name });
      ws.onmessage = (ev) => {
        let m: ServerMsg;
        try { m = JSON.parse(String(ev.data)) as ServerMsg; } catch { return; }
        if (m.t === 'welcome') {
          this.id = m.id;
          this.key = m.key;
          this.status = 'open';
          this.startPing();
          if (!settled) { settled = true; window.clearTimeout(timer); resolve(); }
        } else if (m.t === 'pong') {
          const t0 = this.sent.get(m.n);
          if (t0 !== undefined) {
            this.sent.delete(m.n);
            const sample = this.now() - t0;
            const first = this.rtt < 0;
            this.rtt = first ? sample : this.rtt * 0.7 + sample * 0.3;
            if (first) this.send({ t: 'ping', n: ++this.seq, rtt: Math.round(this.rtt) }); // la 1re mesure est annoncée tout de suite (salon)
          }
        }
        this.onMessage(m);
      };
      ws.onerror = () => fail('error');
      ws.onclose = (ev) => {
        window.clearTimeout(timer);
        window.clearInterval(this.pingTimer);
        const was = this.status;
        this.status = 'closed';
        fail('closed');
        if (was === 'open') this.onClose(ev.reason || 'connexion fermée');
      };
    });
  }

  private startPing(): void {
    window.clearInterval(this.pingTimer);
    const tick = (): void => {
      const n = ++this.seq;
      this.sent.set(n, this.now());
      if (this.sent.size > 20) this.sent.delete(this.sent.keys().next().value as number);
      this.send({ t: 'ping', n, rtt: Math.round(this.rtt) });
    };
    tick();
    this.pingTimer = window.setInterval(tick, 2000);
  }

  send(m: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  /** Coupe la connexion comme le ferait une panne réseau (tests : déclenche la reprise automatique). */
  drop(): void { this.ws?.close(); }

  close(): void {
    window.clearInterval(this.pingTimer);
    const ws = this.ws;
    this.ws = null;
    if (ws) { ws.onclose = null; ws.onmessage = null; ws.onerror = null; try { ws.close(); } catch { /* déjà fermée */ } }
    this.status = 'closed';
  }
}
