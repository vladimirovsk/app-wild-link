import { Component, OnDestroy, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, Subscription } from 'rxjs';
import { withClock } from '../../mesh/map-markers';
import { NodeStoreService } from '../../mesh/node-store.service';
import { BackendDevice, BackendDeviceService } from '../../shared/backend-device.service';
import { DeviceRow, toDeviceRows } from './device-rows';

@Component({
  selector: 'app-devices',
  templateUrl: './devices.component.html',
  styleUrls: ['./devices.component.scss']
})
export class DevicesComponent implements OnInit, OnDestroy {
  rows: DeviceRow[] = [];
  loading = true;
  private registered$ = new BehaviorSubject<BackendDevice[] | null>(null);
  private subs = new Subscription();

  constructor(
    private backend: BackendDeviceService,
    private nodeStore: NodeStoreService,
  ) {}

  ngOnInit(): void {
    this.subs.add(this.backend.getAll().subscribe(devices => this.registered$.next(devices)));
    this.subs.add(combineLatest([withClock(this.nodeStore.nodes$), this.registered$]).subscribe(([{ value: nodes, now }, registered]) => {
      this.loading = registered === null && nodes.length === 0;
      this.rows = toDeviceRows(nodes, registered ?? [], now);
    }));
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  get onlineCount():  number { return this.rows.filter(d => d.active).length; }
  get offlineCount(): number { return this.rows.filter(d => !d.active).length; }

  formatLastSeen(d: DeviceRow): string {
    const diff = Math.floor((Date.now() - d.lastHeard.getTime()) / 1000);
    if (diff < 5)    return 'just now';
    if (diff < 60)   return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  }

  editingId: string | null = null;
  editingName = '';
  savingId: string | null = null;
  deletingId: string | null = null;

  startEdit(d: DeviceRow): void {
    this.editingId   = d.deviceId;
    this.editingName = d.name;
    this.deletingId  = null;
  }

  cancelEdit(): void {
    this.editingId = null;
  }

  saveEdit(deviceId: string): void {
    const name = this.editingName.trim();
    if (!name || name === this.rows.find(r => r.deviceId === deviceId)?.name) {
      this.cancelEdit();
      return;
    }
    this.savingId = deviceId;
    this.backend.rename(deviceId, name).subscribe(res => {
      this.savingId = null;
      if (res) {
        const registered = this.registered$.value ?? [];
        this.registered$.next(registered.map(d => (d.deviceId === deviceId ? { ...d, name: res.name } : d)));
      }
      this.editingId = null;
    });
  }

  confirmDelete(deviceId: string): void {
    this.deletingId = deviceId;
  }

  cancelDelete(): void {
    this.deletingId = null;
  }

  deleteDevice(deviceId: string): void {
    this.backend.remove(deviceId).subscribe(res => {
      if (res.deleted) {
        const registered = this.registered$.value ?? [];
        this.registered$.next(registered.filter(d => d.deviceId !== deviceId));
      }
      this.deletingId = null;
    });
  }
}
