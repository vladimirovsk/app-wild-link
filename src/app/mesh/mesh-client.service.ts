import { Inject, Injectable, NgZone, OnDestroy } from '@angular/core';
import { Protobuf, Types } from '@meshtastic/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { MESH_DEVICE_FACTORY, MESH_TRANSPORT_FACTORY, MeshDeviceLike, WEB_SERIAL_SUPPORTED } from './mesh-tokens';
import { NodeStoreService } from './node-store.service';

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

  private device: MeshDeviceLike | null = null;
  private unsubscribers: Array<() => void> = [];

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
    try {
      const transport = await this.transportFactory();
      const device = this.deviceFactory(transport);
      this.device = device;
      this.subscribe(device);
      this.status$.next('configuring');
      await device.configure();
    } catch {
      this.release();
      this.status$.next('error');
    }
  }

  async disconnect(): Promise<void> {
    const device = this.device;
    this.release();
    try {
      await device?.disconnect();
    } finally {
      if (this.supported) this.status$.next('disconnected');
    }
  }

  async sendText(text: string, to?: number): Promise<number> {
    if (!this.device || this.status$.value !== 'connected') {
      throw new Error('Not connected to a device');
    }
    return this.device.sendText(text, to);
  }

  ngOnDestroy(): void {
    void this.disconnect();
  }

  private subscribe(device: MeshDeviceLike): void {
    const e = device.events;
    const run = <T>(handler: (value: T) => void) => (value: T) => this.zone.run(() => handler(value));

    this.unsubscribers = [
      e.onDeviceStatus.subscribe(run(status => this.onStatus(status))),
      e.onMyNodeInfo.subscribe(run(info => {
        this.myNodeNum$.next(info.myNodeNum);
        this.store.setSelf(info.myNodeNum);
      })),
      e.onNodeInfoPacket.subscribe(run(info => this.onNodeInfo(info))),
      e.onPositionPacket.subscribe(run(p => this.store.applyPosition(p.from, p.data, p.rxTime))),
      e.onTelemetryPacket.subscribe(run(t => {
        if (t.data.variant.case === 'deviceMetrics') {
          this.store.applyBattery(t.from, t.data.variant.value.batteryLevel, t.data.variant.value.voltage, t.rxTime);
        }
      })),
      e.onUserPacket.subscribe(run(u => this.store.applyName(u.from, u.data.shortName, u.data.longName, u.rxTime))),
      e.onMessagePacket.subscribe(run(m => {
        if (m.from === this.myNodeNum$.value) return;
        this.incoming$.next({ id: m.id, from: m.from, to: m.to, text: m.data, at: m.rxTime, direction: 'incoming' });
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
    } else if (status === Types.DeviceStatusEnum.DeviceDisconnected) {
      this.release();
      this.status$.next('disconnected');
    }
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

  private release(): void {
    this.unsubscribers.forEach(unsubscribe => unsubscribe());
    this.unsubscribers = [];
    this.device = null;
  }
}
