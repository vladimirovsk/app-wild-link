import {
  Component, OnDestroy, AfterViewInit,
  ElementRef, ViewChild, ChangeDetectorRef,
  ChangeDetectionStrategy
} from '@angular/core';
import * as L from 'leaflet';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { DeviceService } from '../../shared/device.service';
import { Device, formatLastSeen } from '../../shared/device.model';

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const TILE_ATTR = '&copy; <a href="https://carto.com/">CARTO</a>';

const STATUS_COLOR: Record<Device['status'], string> = {
  online:  '#FF5C00',
  warning: '#F59E0B',
  offline: '#94A3B8',
};

function makeMarkerIcon(status: Device['status']): L.DivIcon {
  const color = STATUS_COLOR[status];
  const pulse  = status === 'online'
    ? `<span class="marker-pulse" style="background:${color}"></span>` : '';
  return L.divIcon({
    className: '',
    iconSize:    [36, 36],
    iconAnchor:  [18, 18],
    popupAnchor: [0, -22],
    html: `<div class="device-marker" style="border-color:${color}">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="${color}">
        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
        <circle cx="12" cy="9" r="2.5" fill="#0F1F16"/>
      </svg>${pulse}</div>`,
  });
}

@Component({
  selector: 'app-map',
  templateUrl: './map.component.html',
  styleUrls: ['./map.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MapComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapContainer') mapContainer!: ElementRef<HTMLDivElement>;

  selectedDevice: Device | null = null;
  private map!: L.Map;
  private markers = new Map<string, L.Marker>();
  private destroy$ = new Subject<void>();

  constructor(
    private deviceService: DeviceService,
    private cdr: ChangeDetectorRef
  ) {}

  ngAfterViewInit(): void {
    this.map = L.map(this.mapContainer.nativeElement, {
      center: [51.1, -114.1],
      zoom: 10,
      zoomControl: false,
    });

    setTimeout(() => this.map.invalidateSize(), 0);

    L.tileLayer(TILE_URL, {
      attribution: TILE_ATTR,
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(this.map);

    this.deviceService.getDevices()
      .pipe(takeUntil(this.destroy$))
      .subscribe(devices => this.syncMarkers(devices));
  }

  private syncMarkers(devices: Device[]): void {
    const liveIds = new Set<string>();

    for (const device of devices) {
      if (!device.hasGps) continue;
      liveIds.add(device.nodeId);

      if (this.markers.has(device.nodeId)) {
        // Update existing marker
        const marker = this.markers.get(device.nodeId)!;
        marker.setLatLng([device.lat, device.lng]);
        marker.setIcon(makeMarkerIcon(device.status));
        marker.setTooltipContent(this.tooltipContent(device));
      } else {
        // Add new marker
        const marker = L.marker([device.lat, device.lng], {
          icon: makeMarkerIcon(device.status),
        });
        marker.bindTooltip(this.tooltipContent(device), {
          direction: 'top', className: 'wl-tooltip', offset: [0, -14],
        });
        marker.on('click', () => {
          this.selectedDevice = device;
          this.cdr.markForCheck();
        });
        marker.addTo(this.map);
        this.markers.set(device.nodeId, marker);
      }
    }

    // Update selectedDevice reference if it's still in the list
    if (this.selectedDevice) {
      const updated = devices.find(d => d.nodeId === this.selectedDevice!.nodeId);
      if (updated) {
        this.selectedDevice = updated;
        this.cdr.markForCheck();
      }
    }

    // Remove markers for disconnected devices without GPS
    for (const [id, marker] of this.markers) {
      if (!liveIds.has(id)) {
        marker.remove();
        this.markers.delete(id);
      }
    }
  }

  private tooltipContent(d: Device): string {
    return `<strong>!${d.nodeId}</strong><br>${d.battery}% · ${d.sats} sats`;
  }

  formatLastSeen = formatLastSeen;

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.map?.remove();
  }

  zoomIn():  void { this.map?.zoomIn(); }
  zoomOut(): void { this.map?.zoomOut(); }

  fitDevices(): void {
    const withGps = Array.from(this.markers.values());
    if (!withGps.length || !this.map) return;
    const group = L.featureGroup(withGps);
    this.map.fitBounds(group.getBounds(), { padding: [60, 60] });
  }

  closeInfo(): void {
    this.selectedDevice = null;
  }
}
