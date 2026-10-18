import { TestBed, discardPeriodicTasks, fakeAsync, tick } from '@angular/core/testing';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { BackendDeviceService, HeartbeatPayload, RegisterDevicePayload } from '../shared/backend-device.service';
import { BackendSyncService } from './backend-sync.service';
import { MeshClientService, MeshStatus } from './mesh-client.service';
import { NodeStoreService } from './node-store.service';

const SELF = 0x0acb0984;
const rxTime = new Date('2026-10-18T10:00:00Z');

class FakeClient {
  readonly status$ = new BehaviorSubject<MeshStatus>('disconnected');
  readonly myNodeNum$ = new BehaviorSubject<number | null>(null);
}

class FakeBackend {
  registered: RegisterDevicePayload[] = [];
  heartbeats: Array<{ deviceId: string; payload: HeartbeatPayload }> = [];
  disconnected: string[] = [];
  failHeartbeats = 0;

  register(payload: RegisterDevicePayload): Observable<unknown> {
    this.registered.push(payload);
    return of(null);
  }
  heartbeat(deviceId: string, payload: HeartbeatPayload): Observable<unknown> {
    if (this.failHeartbeats > 0) {
      this.failHeartbeats--;
      return throwError(() => new Error('502'));
    }
    this.heartbeats.push({ deviceId, payload });
    return of(null);
  }
  disconnect(deviceId: string): Observable<unknown> {
    this.disconnected.push(deviceId);
    return of(null);
  }
}

describe('BackendSyncService', () => {
  let client: FakeClient;
  let backend: FakeBackend;
  let store: NodeStoreService;
  let sync: BackendSyncService;

  beforeEach(() => {
    client = new FakeClient();
    backend = new FakeBackend();
    TestBed.configureTestingModule({
      providers: [
        { provide: MeshClientService, useValue: client },
        { provide: BackendDeviceService, useValue: backend },
      ],
    });
    store = TestBed.inject(NodeStoreService);
    sync = TestBed.inject(BackendSyncService);
  });

  function connectSelf(): void {
    client.myNodeNum$.next(SELF);
    store.setSelf(SELF);
    store.applyPosition(SELF, { latitudeI: 510447000, longitudeI: -1140719000, altitude: 1045 }, rxTime);
    store.applyBattery(SELF, 87, 4.1, rxTime);
    client.status$.next('connected');
  }

  it('registers its own device once when connected', fakeAsync(() => {
    sync.start();
    sync.start();
    connectSelf();

    expect(backend.registered).toEqual([{ deviceId: '0acb0984', connectionType: 'serial' }]);
    discardPeriodicTasks();
  }));

  it('sends a heartbeat with its own position and battery every 30 s', fakeAsync(() => {
    sync.start();
    connectSelf();

    tick(29_999);
    expect(backend.heartbeats.length).toBe(0);
    tick(1);

    expect(backend.heartbeats).toEqual([{
      deviceId: '0acb0984',
      payload: { lat: 51.0447, lng: -114.0719, alt: 1045, battery: 87, voltage: 4.1 },
    }]);
    discardPeriodicTasks();
  }));

  it('reports disconnect and stops heartbeats when the device goes away', fakeAsync(() => {
    sync.start();
    connectSelf();

    client.status$.next('disconnected');
    tick(60_000);

    expect(backend.disconnected).toEqual(['0acb0984']);
    expect(backend.heartbeats.length).toBe(0);
  }));

  it('keeps sending heartbeats after a failed one', fakeAsync(() => {
    sync.start();
    connectSelf();
    backend.failHeartbeats = 1;

    tick(60_000);

    expect(backend.heartbeats.length).toBe(1);
    discardPeriodicTasks();
  }));

  it('does nothing until it knows its own node number', fakeAsync(() => {
    sync.start();
    client.status$.next('connected');
    tick(30_000);

    expect(backend.registered).toEqual([]);
    expect(backend.heartbeats).toEqual([]);
    discardPeriodicTasks();
  }));
});
