import { Injectable, OnDestroy } from '@angular/core';
import { Observable, Subscription, combineLatest, interval, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { BackendDeviceService, HeartbeatPayload } from '../shared/backend-device.service';
import { MeshClientService } from './mesh-client.service';
import { nodeIdFromNum } from './mesh-mappers';
import { NodeStoreService } from './node-store.service';

export const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Keeps the backend's record of this app's own device current.
 * Off the safety path: every backend failure is ignored.
 */
@Injectable({ providedIn: 'root' })
export class BackendSyncService implements OnDestroy {
  private started = false;
  private readonly subs = new Subscription();
  private heartbeat: Subscription | null = null;
  private activeDeviceId: string | null = null;

  constructor(
    private readonly client: MeshClientService,
    private readonly store: NodeStoreService,
    private readonly backend: BackendDeviceService,
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;

    this.subs.add(combineLatest([this.client.status$, this.client.myNodeNum$]).subscribe(([status, myNum]) => {
      if (status === 'connected' && myNum !== null) {
        this.onConnected(nodeIdFromNum(myNum).slice(1), myNum);
      } else if (status !== 'connected' && this.activeDeviceId) {
        this.onDisconnected(this.activeDeviceId);
      }
    }));
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    this.heartbeat?.unsubscribe();
  }

  private onConnected(deviceId: string, myNum: number): void {
    if (this.activeDeviceId === deviceId) return;
    this.activeDeviceId = deviceId;
    this.quiet(this.backend.register({ deviceId, connectionType: 'serial' })).subscribe();

    this.heartbeat?.unsubscribe();
    this.heartbeat = interval(HEARTBEAT_INTERVAL_MS).subscribe(() => {
      this.quiet(this.backend.heartbeat(deviceId, this.selfPayload(myNum))).subscribe();
    });
  }

  private onDisconnected(deviceId: string): void {
    this.activeDeviceId = null;
    this.heartbeat?.unsubscribe();
    this.heartbeat = null;
    this.quiet(this.backend.disconnect(deviceId)).subscribe();
  }

  private selfPayload(myNum: number): HeartbeatPayload {
    const self = this.store.snapshot().find(n => n.num === myNum);
    const payload: HeartbeatPayload = {};
    if (self?.lat !== undefined) payload.lat = self.lat;
    if (self?.lng !== undefined) payload.lng = self.lng;
    if (self?.alt !== undefined) payload.alt = self.alt;
    if (self?.battery !== undefined) payload.battery = self.battery;
    if (self?.voltage !== undefined) payload.voltage = self.voltage;
    return payload;
  }

  private quiet<T>(request: Observable<T>): Observable<T | null> {
    return request.pipe(catchError(() => of(null)));
  }
}
