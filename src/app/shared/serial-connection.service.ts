import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject, Subscription, interval } from 'rxjs';
import { switchMap, filter } from 'rxjs/operators';
import { DeviceStoreService } from './device-store.service';
import { MeshtasticParserService } from './meshtastic-parser.service';
import { BackendDeviceService } from './backend-device.service';

export type SerialStatus = 'unsupported' | 'idle' | 'connecting' | 'open' | 'error';

export interface ConsoleEntry {
  ts: string;
  text: string;
  kind: 'rx' | 'tx' | 'info' | 'error';
}

export interface SerialConnectOptions {
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: 'none' | 'even' | 'odd';
}

const SETTINGS_KEY  = 'wl_serial_opts';
const AUTO_KEY      = 'wl_serial_auto';
const DEFAULT_OPTS: SerialConnectOptions = {
  baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none'
};

function vidPidId(pi: SerialPortInfo): string {
  const vid = (pi.usbVendorId  ?? 0).toString(16).padStart(4, '0');
  const pid = (pi.usbProductId ?? 0).toString(16).padStart(4, '0');
  return `usb-${vid}-${pid}`;
}

const HEARTBEAT_INTERVAL_MS = 30_000;

@Injectable({ providedIn: 'root' })
export class SerialConnectionService implements OnDestroy {
  readonly isSupported = 'serial' in navigator;

  readonly status$          = new BehaviorSubject<SerialStatus>(
    'serial' in navigator ? 'idle' : 'unsupported'
  );
  readonly entries$         = new BehaviorSubject<ConsoleEntry[]>([]);
  readonly portInfo$        = new BehaviorSubject<SerialPortInfo | null>(null);
  readonly rxBytes$         = new BehaviorSubject<number>(0);
  readonly autoConnect$     = new BehaviorSubject<boolean>(
    localStorage.getItem(AUTO_KEY) !== 'false'   // default: true
  );

  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private readLoopActive = false;
  private decoder  = new TextDecoder();
  private rxBuffer = '';

  // nodeId used as key in DeviceStore for the current session
  private sessionNodeId: string | null = null;
  private heartbeatSub: Subscription | null = null;

  constructor(
    private zone: NgZone,
    private store: DeviceStoreService,
    private parser: MeshtasticParserService,
    private backendDevices: BackendDeviceService,
  ) {
    if (this.isSupported) {
      this.setupHotplug();
      this.tryAutoConnect();
    }
  }

  get isOpen(): boolean { return this.status$.value === 'open'; }

  // ── Manual connect ────────────────────────────────────────────────────────

  async connect(opts: SerialConnectOptions): Promise<void> {
    if (!this.isSupported || this.isOpen) return;
    try {
      this.status$.next('connecting');
      this.addEntry('info', 'Requesting port access...');
      this.port = await navigator.serial.requestPort();
      this.saveOptions(opts);
      await this.openPort(opts);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('No port selected')) {
        this.status$.next('idle');
        this.addEntry('info', 'Port selection cancelled.');
      } else {
        this.status$.next('error');
        this.addEntry('error', `Failed to open: ${msg}`);
      }
    }
  }

  // ── Disconnect ────────────────────────────────────────────────────────────

  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    this.readLoopActive = false;
    try { await this.reader?.cancel(); } catch { /* ignore */ }
    this.reader = null;
    try { await this.port?.close(); } catch { /* ignore */ }
    this.port = null;

    if (this.sessionNodeId) {
      this.store.setOffline(this.sessionNodeId);
      this.backendDevices.disconnect(this.sessionNodeId).subscribe();
      this.addEntry('info', `Device !${this.sessionNodeId} marked offline.`);
      this.sessionNodeId = null;
    }

    this.portInfo$.next(null);
    this.status$.next('idle');
    this.addEntry('info', 'Port closed.');
  }

  // ── Send ──────────────────────────────────────────────────────────────────

  async send(text: string, lineEnding: string): Promise<void> {
    if (!this.port?.writable || !text.trim()) return;
    const payload = text + lineEnding;
    const writer  = this.port.writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(payload));
      this.addEntry('tx', payload.replace(/\r\n|\r|\n/g, '↵'));
    } finally {
      writer.releaseLock();
    }
  }

  clear(): void {
    this.entries$.next([]);
    this.rxBytes$.next(0);
  }

  setAutoConnect(enabled: boolean): void {
    this.autoConnect$.next(enabled);
    localStorage.setItem(AUTO_KEY, String(enabled));
  }

  // ── Auto-connect: page load ───────────────────────────────────────────────

  private async tryAutoConnect(): Promise<void> {
    if (!this.autoConnect$.value) return;
    const ports = await navigator.serial.getPorts();
    if (!ports.length) return;

    this.port = ports[0];
    this.addEntry('info', 'Previously authorized port found — auto-connecting...');
    await this.openPort(this.loadOptions());
  }

  // ── Auto-connect: hotplug ─────────────────────────────────────────────────

  private setupHotplug(): void {
    navigator.serial.addEventListener('connect', (event) => {
      if (!this.autoConnect$.value || this.isOpen) return;
      const port = event.target;
      this.zone.run(async () => {
        this.port = port;
        this.addEntry('info', 'USB device plugged in — auto-connecting...');
        await this.openPort(this.loadOptions());
      });
    });

    navigator.serial.addEventListener('disconnect', (event) => {
      if (event.target !== this.port) return;
      this.zone.run(() => {
        this.stopHeartbeat();
        this.readLoopActive = false;
        this.reader = null;
        this.port   = null;
        this.portInfo$.next(null);
        this.status$.next('error');
        this.addEntry('error', 'USB device unplugged.');
        if (this.sessionNodeId) {
          this.store.setOffline(this.sessionNodeId);
          this.backendDevices.disconnect(this.sessionNodeId).subscribe();
        }
      });
    });
  }

  // ── Shared open logic ─────────────────────────────────────────────────────

  private async openPort(opts: SerialConnectOptions): Promise<void> {
    if (!this.port) return;
    try {
      this.status$.next('connecting');
      const pi = this.port.getInfo();
      this.portInfo$.next(pi);
      this.rxBuffer      = '';

      // ── VID:PID fallback ─────────────────────────────────────────────────
      // Create a device entry immediately so it appears in the list.
      // It will be "promoted" to the real Meshtastic nodeId once GPS fires.
      const fallbackId = vidPidId(pi);
      this.sessionNodeId = fallbackId;
      this.store.upsert(fallbackId, { status: 'online' }, pi);
      // ────────────────────────────────────────────────────────────────────

      await this.port.open({ ...opts, bufferSize: 4096 });

      this.status$.next('open');
      this.rxBytes$.next(0);
      this.addEntry('info',
        `Port opened — ${opts.baudRate} baud, ${opts.dataBits}/${opts.stopBits}/${opts.parity}` +
        (pi.usbVendorId !== undefined
          ? ` | VID:0x${pi.usbVendorId.toString(16).padStart(4, '0').toUpperCase()}` +
            ` PID:0x${(pi.usbProductId ?? 0).toString(16).padStart(4, '0').toUpperCase()}`
          : '')
      );

      this.startReadLoop();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.status$.next('error');
      this.addEntry('error', `Failed to open port: ${msg}`);
      this.port = null;
    }
  }

  // ── Read loop ─────────────────────────────────────────────────────────────

  private startReadLoop(): void {
    if (!this.port?.readable) return;
    this.readLoopActive = true;
    this.reader = this.port.readable.getReader();

    const loop = async () => {
      while (this.readLoopActive && this.reader) {
        try {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value?.length) {
            this.rxBytes$.next(this.rxBytes$.value + value.length);
            const text = this.decoder.decode(value, { stream: true });
            this.zone.run(() => this.appendRx(text));
          }
        } catch { break; }
      }
      if (this.status$.value === 'open') {
        this.zone.run(() => {
          this.status$.next('error');
          this.addEntry('error', 'Connection lost.');
          if (this.sessionNodeId) {
            this.store.setOffline(this.sessionNodeId);
            this.backendDevices.disconnect(this.sessionNodeId).subscribe();
          }
          this.stopHeartbeat();
        });
      }
    };

    loop();
  }

  // Matches ESC[ + params + letter  (e.g. \x1b[34m, \x1b[0m, \x1b[1;32m)
  private static readonly ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

  private appendRx(chunk: string): void {
    this.rxBuffer += chunk;
    const lines = this.rxBuffer.split(/\r?\n/);
    this.rxBuffer = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.replace(SerialConnectionService.ANSI_RE, '').trimEnd();
      if (!line.length) continue;
      this.addEntry('rx', line);
      this.processLine(line);
    }
  }

  private processLine(line: string): void {
    const result = this.parser.parseLine(line);
    if (!result.nodeId && !result.patch) return;

    // Promote VID:PID placeholder to real Meshtastic nodeId
    if (result.nodeId && this.sessionNodeId !== result.nodeId) {
      const oldId = this.sessionNodeId;
      this.sessionNodeId = result.nodeId;
      if (oldId) {
        this.store.rename(oldId, result.nodeId);
        this.addEntry('info', `Device identified: !${result.nodeId}`);
        // Register in backend and start periodic heartbeat
        this.registerInBackend(result.nodeId);
        this.startHeartbeat(result.nodeId);
      }
    }

    const nodeId = this.sessionNodeId;
    if (nodeId && result.patch) {
      this.store.upsert(nodeId, result.patch, this.portInfo$.value ?? undefined);

      // Show parsed fields as a single info line for confirmation
      const fields = Object.entries(result.patch)
        .filter(([k]) => !['status'].includes(k))
        .map(([k, v]) => {
          if (typeof v === 'number') return `${k}=${Number(v).toPrecision(6).replace(/\.?0+$/, '')}`;
          return `${k}=${v}`;
        })
        .join(' · ');
      if (fields) this.addEntry('info', `↳ [${nodeId}] ${fields}`);
    }
  }

  // ── Backend: register + heartbeat ────────────────────────────────────────

  private registerInBackend(nodeId: string): void {
    const pi  = this.portInfo$.value;
    const dev = this.store.snapshot().find(d => d.nodeId === nodeId);
    this.backendDevices.register({
      deviceId:    nodeId,
      name:        dev?.name  ?? `!${nodeId}`,
      model:       'htit-wb32-laf-v4.2',
      usbVendorId:  pi?.usbVendorId,
      usbProductId: pi?.usbProductId,
    }).subscribe(result => {
      if (result) {
        this.addEntry('info', `Backend: device ${result.deviceId} registered (id: ${result._id}).`);
      }
    });
  }

  private startHeartbeat(nodeId: string): void {
    this.stopHeartbeat();
    this.heartbeatSub = interval(HEARTBEAT_INTERVAL_MS).pipe(
      filter(() => this.isOpen),
      switchMap(() => {
        const d = this.store.snapshot().find(s => s.nodeId === nodeId);
        return this.backendDevices.heartbeat(nodeId, {
          lat:       d?.lat,
          lng:       d?.lng,
          alt:       d?.alt,
          battery:   d?.battery,
          voltage:   d?.voltage,
          uptime:    d?.uptime,
          sats:      d?.sats,
          airUtilTx: d?.airUtilTx,
        });
      })
    ).subscribe();
  }

  private stopHeartbeat(): void {
    this.heartbeatSub?.unsubscribe();
    this.heartbeatSub = null;
  }

  ngOnDestroy(): void {
    this.stopHeartbeat();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private addEntry(kind: ConsoleEntry['kind'], text: string): void {
    const ts      = new Date().toLocaleTimeString('uk-UA', { hour12: false });
    const current = this.entries$.value;
    this.entries$.next([...current.slice(-999), { ts, text, kind }]);
  }

  private saveOptions(opts: SerialConnectOptions): void {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(opts));
  }

  private loadOptions(): SerialConnectOptions {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? { ...DEFAULT_OPTS, ...JSON.parse(raw) } : DEFAULT_OPTS;
    } catch {
      return DEFAULT_OPTS;
    }
  }
}
