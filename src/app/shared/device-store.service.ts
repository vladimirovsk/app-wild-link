import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Device, makeEmptyDevice } from './device.model';

@Injectable({ providedIn: 'root' })
export class DeviceStoreService {
  private readonly store$ = new BehaviorSubject<Device[]>([]);

  readonly devices$ = this.store$.asObservable();

  upsert(nodeId: string, patch: Partial<Device>, portInfo?: SerialPortInfo): void {
    const current = this.store$.value;
    const idx = current.findIndex(d => d.nodeId === nodeId);
    const now = new Date();

    if (idx >= 0) {
      const updated = [...current];
      updated[idx] = { ...updated[idx], ...patch, nodeId, lastSeenAt: now };
      this.store$.next(updated);
    } else {
      const device: Device = { ...makeEmptyDevice(nodeId, portInfo), ...patch, nodeId };
      this.store$.next([...current, device]);
    }
  }

  setOffline(nodeId: string): void {
    const current = this.store$.value;
    const idx = current.findIndex(d => d.nodeId === nodeId);
    if (idx < 0) return;
    const updated = [...current];
    updated[idx] = { ...updated[idx], status: 'offline' };
    this.store$.next(updated);
  }

  /** Rename device: merge oldId entry into newId, removing oldId */
  rename(oldId: string, newId: string): void {
    const current = this.store$.value;
    const oldEntry = current.find(d => d.nodeId === oldId);
    if (!oldEntry) return;
    const withoutOld = current.filter(d => d.nodeId !== oldId);
    const existingNew = withoutOld.find(d => d.nodeId === newId);
    const merged: Device = existingNew
      ? { ...oldEntry, ...existingNew, nodeId: newId }
      : { ...oldEntry, nodeId: newId, name: `!${newId}` };
    const others = withoutOld.filter(d => d.nodeId !== newId);
    this.store$.next([...others, merged]);
  }

  remove(nodeId: string): void {
    this.store$.next(this.store$.value.filter(d => d.nodeId !== nodeId));
  }

  snapshot(): Device[] {
    return this.store$.value;
  }
}
