import {
  Component, OnDestroy, AfterViewInit,
  ElementRef, ViewChild, ChangeDetectorRef,
  ChangeDetectionStrategy
} from '@angular/core';
import * as L from 'leaflet';
import { DeviceService } from '../../shared/device.service';
import { Device } from '../../shared/device.model';

// Voyager: readable neutral terrain — darkened via CSS filter in SCSS
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

  constructor(
    private deviceService: DeviceService,
    private cdr: ChangeDetectorRef
  ) {}

  ngAfterViewInit(): void {
    this.map = L.map(this.mapContainer.nativeElement, {
      center: [50.82, -115.25],
      zoom: 9,
      zoomControl: false,
    });

    setTimeout(() => this.map.invalidateSize(), 0);

    L.tileLayer(TILE_URL, {
      attribution: TILE_ATTR,
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(this.map);

    this.deviceService.getDevices().subscribe(devices => {
      devices.forEach(device => {
        const marker = L.marker([device.lat, device.lng], { icon: makeMarkerIcon(device.status) });
        marker.bindTooltip(device.name, {
          direction: 'top', className: 'wl-tooltip', offset: [0, -14],
        });
        marker.on('click', () => {
          this.selectedDevice = device;
          this.cdr.markForCheck();
        });
        marker.addTo(this.map);
      });
    });
  }

  ngOnDestroy(): void {
    this.map?.remove();
  }

  zoomIn(): void  { this.map?.zoomIn(); }
  zoomOut(): void { this.map?.zoomOut(); }

  fitDevices(): void {
    if (!this.map) return;
    this.deviceService.getDevices().subscribe(devices => {
      if (!devices.length) return;
      const bounds = L.latLngBounds(devices.map(d => [d.lat, d.lng] as L.LatLngTuple));
      this.map.fitBounds(bounds, { padding: [60, 60] });
    });
  }

  closeInfo(): void {
    this.selectedDevice = null;
  }
}
