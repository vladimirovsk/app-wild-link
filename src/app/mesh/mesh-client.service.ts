import { Inject, Injectable, NgZone, OnDestroy } from '@angular/core';
import { Protobuf, Types } from '@meshtastic/core';
import { BehaviorSubject, Observable, Subject, Subscription, interval } from 'rxjs';
import { MESH_DEVICE_FACTORY, MESH_TRANSPORT_FACTORY, MeshDeviceLike, WEB_SERIAL_SUPPORTED } from './mesh-tokens';
import { NodeStoreService } from './node-store.service';
import { tapTransportStatus } from './status-tap';

export type MeshStatus = 'unsupported' | 'disconnected' | 'connecting' | 'configuring' | 'connected' | 'error';

export interface MeshTextMessage {
  id: number;
  from: number;
  to: number;
  text: string;
  at: Date;
  direction: 'incoming' | 'outgoing';
}

export interface DeviceLogLine {
  at: Date;
  source: string;
  message: string;
}

/** The firmware drops a serial client it has not heard from in 15 minutes. */
export const SERIAL_HEARTBEAT_MS = 60_000;

interface Session {
  device: MeshDeviceLike;
  transport: Types.Transport;
}

/** A device without a GPS fix or mesh time stamps packets with 0 (1970). */
function arrivalTime(rxTime: Date): Date {
  return rxTime.getTime() > 0 ? rxTime : new Date();
}

/**
 * Connection to the head device through the Meshtastic client API.
 * Routes every packet the device hands over into the node store; the app
 * never polls other nodes — they broadcast on their own.
 */
@Injectable({ providedIn: 'root' })
export class MeshClientService implements OnDestroy {
  readonly status$: BehaviorSubject<MeshStatus>;
  readonly myNodeNum$ = new BehaviorSubject<number | null>(null);

  private readonly incoming$ = new Subject<MeshTextMessage>();
  /** Text messages from other nodes */
  readonly messages$: Observable<MeshTextMessage> = this.incoming$.asObservable();

  private readonly log$ = new Subject<DeviceLogLine>();
  /** Log records the firmware sends to the client (needs the device's debug log API enabled) */
  readonly deviceLog$: Observable<DeviceLogLine> = this.log$.asObservable();

  private session: Session | null = null;
  private unsubscribers: Array<() => void> = [];
  private heartbeat: Subscription | null = null;

  constructor(
    @Inject(MESH_TRANSPORT_FACTORY) private readonly transportFactory: () => Promise<Types.Transport>,
    @Inject(MESH_DEVICE_FACTORY) private readonly deviceFactory: (transport: Types.Transport) => MeshDeviceLike,
    @Inject(WEB_SERIAL_SUPPORTED) private readonly supported: boolean,
    private readonly store: NodeStoreService,
    private readonly zone: NgZone,
  ) {
    this.status$ = new BehaviorSubject<MeshStatus>(supported ? 'disconnected' : 'unsupported');
  }

  async connect(): Promise<void> {
    if (!this.supported) return;
    if (['connecting', 'configuring', 'connected'].includes(this.status$.value)) return;

    this.status$.next('connecting');
    let session: Session | null = null;
    try {
      const raw = await this.transportFactory();
      const transport = tapTransportStatus(raw, status => this.zone.run(() => {
        if (session && this.session === session) this.onStatus(status);
      }));
      const device = this.deviceFactory(transport);
      session = { device, transport };
      this.session = session;
      this.subscribe(device);
      this.status$.next('configuring');
      await device.configure();
    } catch {
      // The user disconnected (or the board was unplugged) while this was pending.
      if (session && this.session !== session) return;
      await this.closeSession();
      this.status$.next('error');
    }
  }

  async disconnect(): Promise<void> {
    await this.closeSession();
    if (this.supported) this.status$.next('disconnected');
  }

  async sendText(text: string, to?: number): Promise<number> {
    if (!this.session || this.status$.value !== 'connected') {
      throw new Error('Not connected to a device');
    }
    return this.session.device.sendText(text, to);
  }

  ngOnDestroy(): void {
    void this.disconnect();
  }

  private subscribe(device: MeshDeviceLike): void {
    const e = device.events;
    const run = <T>(handler: (value: T) => void) => (value: T) => this.zone.run(() => handler(value));
    // While configuring, the library replays its node database as position/user
    // events stamped "now"; those are not fresh receptions.
    const heard = (rxTime: Date): Date | undefined =>
      this.status$.value === 'configuring' ? undefined : arrivalTime(rxTime);

    this.unsubscribers = [
      e.onDeviceStatus.subscribe(run(status => this.onStatus(status))),
      e.onMyNodeInfo.subscribe(run(info => {
        this.myNodeNum$.next(info.myNodeNum);
        this.store.setSelf(info.myNodeNum);
      })),
      e.onNodeInfoPacket.subscribe(run(info => this.onNodeInfo(info))),
      e.onPositionPacket.subscribe(run(p => this.store.applyPosition(p.from, p.data, heard(p.rxTime)))),
      e.onTelemetryPacket.subscribe(run(t => {
        if (t.data.variant.case === 'deviceMetrics') {
          const metrics = t.data.variant.value;
          this.store.applyBattery(t.from, metrics.batteryLevel, metrics.voltage, arrivalTime(t.rxTime));
        }
      })),
      e.onUserPacket.subscribe(run(u => this.store.applyName(u.from, u.data.shortName, u.data.longName, heard(u.rxTime)))),
      e.onMessagePacket.subscribe(run(m => {
        if (m.from === this.myNodeNum$.value) return;
        this.incoming$.next({ id: m.id, from: m.from, to: m.to, text: m.data, at: arrivalTime(m.rxTime), direction: 'incoming' });
      })),
      e.onLogRecord.subscribe(run(r => this.log$.next({
        at: r.time ? new Date(r.time * 1000) : new Date(),
        source: r.source,
        message: r.message,
      }))),
    ];
  }

  private onStatus(status: Types.DeviceStatusEnum): void {
    if (status === Types.DeviceStatusEnum.DeviceConfigured) {
      this.status$.next('connected');
      this.startHeartbeat();
    } else if (status === Types.DeviceStatusEnum.DeviceDisconnected && this.session) {
      void this.closeSession();
      this.status$.next('disconnected');
    }
  }

  private startHeartbeat(): void {
    const device = this.session?.device;
    if (!device) return;
    this.heartbeat?.unsubscribe();
    this.heartbeat = interval(SERIAL_HEARTBEAT_MS).subscribe(() => {
      device.heartbeat().catch(() => undefined);
    });
  }

  private onNodeInfo(info: Protobuf.Mesh.NodeInfo): void {
    this.store.applyNodeInfo({
      num: info.num,
      shortName: info.user?.shortName,
      longName: info.user?.longName,
      position: info.position,
      batteryLevel: info.deviceMetrics?.batteryLevel,
      voltage: info.deviceMetrics?.voltage,
      snr: info.snr,
      hopsAway: info.hopsAway,
      lastHeard: info.lastHeard || undefined,
    });
  }

  /** Stops listening and closes the port; never throws (the stream may already be dead). */
  private async closeSession(): Promise<void> {
    const session = this.session;
    this.session = null;
    this.unsubscribers.forEach(unsubscribe => unsubscribe());
    this.unsubscribers = [];
    this.heartbeat?.unsubscribe();
    this.heartbeat = null;
    if (!session) return;

    try { await session.device.disconnect(); } catch { /* outgoing stream locked or already errored */ }
    try { await session.transport.disconnect(); } catch { /* port already closed */ }
  }
}
