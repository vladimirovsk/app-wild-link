import { Component, OnDestroy, OnInit } from '@angular/core';
import { combineLatest, Subscription } from 'rxjs';
import { BackendDevice, BackendDeviceService } from '../../shared/backend-device.service';
import { DeviceStoreService } from '../../shared/device-store.service';
import { formatLastSeen } from '../../shared/device.model';

export interface DeviceRow {
  deviceId: string;
  name: string;
  model: string;
  registeredAt: Date;
  lastSeenAt: Date;
  usbVendorId?: number;
  usbProductId?: number;
  // live telemetry (null if not currently connected)
  active: boolean;
  lat?: number;
  lng?: number;
  alt?: number;
  battery?: number;
  voltage?: number;
  uptime?: number;
  sats?: number;
  airUtilTx?: number;
  hasGps: boolean;
}

@Component({
  selector: 'app-devices',
  templateUrl: './devices.component.html',
  styleUrls: ['./devices.component.scss']
})
export class DevicesComponent implements OnInit, OnDestroy {
  rows: DeviceRow[] = [];
  loading = true;
  private sub!: Subscription;

  constructor(
    private backend: BackendDeviceService,
    private liveStore: DeviceStoreService,
  ) {}

  ngOnInit(): void {
    this.sub = combineLatest([
      this.backend.getAll(),
      this.liveStore.devices$,
    ]).subscribe(([dbDevices, liveDevices]) => {
      this.loading = false;
      this.rows = this.merge(dbDevices, liveDevices);
    });
  }

  private merge(db: BackendDevice[], live: import('../../shared/device.model').Device[]): DeviceRow[] {
    const liveMap = new Map(live.map(d => [d.nodeId, d]));
    const matchedLive = new Set<string>();

    // Process real nodeId entries first so they claim the VID:PID live placeholder
    // before any leftover VID:PID DB entries (e.g. 'usb-303a-1001') can grab it.
    const sortedDb = [...db].sort((a) => a.deviceId.startsWith('usb-') ? 1 : -1);

    const rows: DeviceRow[] = sortedDb.map(d => {
      // 1. Direct nodeId match
      let lv = liveMap.get(d.deviceId);
      if (lv && matchedLive.has(lv.nodeId)) lv = undefined; // already claimed

      // 2. VID:PID fallback: find an unmatched usb-placeholder with same USB IDs
      let lvPlaceholder: import('../../shared/device.model').Device | undefined;
      if (!lv && d.usbVendorId !== undefined) {
        for (const [nodeId, lvDev] of liveMap) {
          if (!matchedLive.has(nodeId) &&
              nodeId.startsWith('usb-') &&
              lvDev.usbVendorId === d.usbVendorId &&
              lvDev.usbProductId === d.usbProductId) {
            lvPlaceholder = lvDev;
            break;
          }
        }
      }

      const matched = lv ?? lvPlaceholder;
      if (matched) matchedLive.add(matched.nodeId);

      const liveActive = !!matched && matched.status === 'online';
      return {
        deviceId:     d.deviceId,
        name:         d.name,
        model:        d.model,
        registeredAt: new Date(d.registeredAt),
        lastSeenAt:   liveActive ? new Date() : new Date(d.lastSeenAt),
        usbVendorId:  d.usbVendorId,
        usbProductId: d.usbProductId,
        active:       liveActive,
        // Telemetry: prefer direct nodeId match (has real data), fall back to DB.
        // VID:PID placeholder has only default zeros — don't use it for telemetry.
        lat:      lv?.lat      ?? d.lat,
        lng:      lv?.lng      ?? d.lng,
        alt:      lv?.alt      ?? d.alt,
        battery:  lv?.battery  ?? d.battery,
        voltage:  lv?.voltage  ?? d.voltage,
        uptime:   lv?.uptime   ?? d.uptime,
        sats:     lv?.sats     ?? d.sats,
        airUtilTx: lv?.airUtilTx ?? d.airUtilTx,
        hasGps:   lv?.hasGps  ?? (!!d.lat && d.lat !== 0),
      };
    });

    // Live-only rows: real nodeId devices not yet persisted to DB.
    // Skip VID:PID placeholders (usb-*) — they are shown via DB entry matched above.
    for (const lv of live) {
      if (matchedLive.has(lv.nodeId)) continue;
      if (lv.nodeId.startsWith('usb-')) continue;
      if (!db.find(d => d.deviceId === lv.nodeId)) {
        rows.push({
          deviceId:     lv.nodeId,
          name:         lv.name,
          model:        'htit-wb32-laf-v4.2',
          registeredAt: lv.connectedAt,
          lastSeenAt:   lv.lastSeenAt,
          usbVendorId:  lv.usbVendorId,
          usbProductId: lv.usbProductId,
          active:    lv.status === 'online',
          lat:       lv.lat,  lng:     lv.lng,  alt:     lv.alt,
          battery:   lv.battery, voltage: lv.voltage,
          uptime:    lv.uptime,  sats:    lv.sats,
          airUtilTx: lv.airUtilTx,
          hasGps:    lv.hasGps,
        });
      }
    }

    return rows.sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return b.registeredAt.getTime() - a.registeredAt.getTime();
    });
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }

  get onlineCount():  number { return this.rows.filter(d => d.active).length; }
  get offlineCount(): number { return this.rows.filter(d => !d.active).length; }

  formatLastSeen(d: DeviceRow): string {
    const diff = Math.floor((Date.now() - d.lastSeenAt.getTime()) / 1000);
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
        this.rows = this.rows.map(r =>
          r.deviceId === deviceId ? { ...r, name: res.name } : r
        );
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
        this.liveStore.remove(deviceId);
        this.rows = this.rows.filter(r => r.deviceId !== deviceId);
      }
      this.deletingId = null;
    });
  }

  formatUptime(s?: number): string {
    if (!s) return '—';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${s % 60}s`;
  }
}
