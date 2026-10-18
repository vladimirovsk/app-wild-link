import {
  Component, OnDestroy, AfterViewInit,
  ElementRef, ViewChild, ChangeDetectorRef,
  ChangeDetectionStrategy
} from '@angular/core';
import * as L from 'leaflet';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { MapMarker, nodeLabel, toMarkers, withClock } from '../../mesh/map-markers';
import { MeshNode } from '../../mesh/mesh-node.model';
import { NodeStoreService } from '../../mesh/node-store.service';

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const TILE_ATTR = '&copy; <a href="https://carto.com/">CARTO</a>';

type MarkerState = 'online' | 'offline';

const STATE_COLOR: Record<MarkerState, string> = {
  online:  '#FF5C00',
  offline: '#94A3B8',
};

function makeMarkerIcon(state: MarkerState): L.DivIcon {
  const color = STATE_COLOR[state];
  const pulse  = state === 'online'
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

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

@Component({
  selector: 'app-map',
  templateUrl: './map.component.html',
  styleUrls: ['./map.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MapComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapContainer') mapContainer!: ElementRef<HTMLDivElement>;

  selectedNode: MeshNode | null = null;
  private nodes: MeshNode[] = [];
  private map!: L.Map;
  private markers = new Map<string, L.Marker>();
  private destroy$ = new Subject<void>();

  constructor(
    private nodeStore: NodeStoreService,
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

    // Re-run on a clock as well, so markers turn grey when a node goes quiet.
    withClock(this.nodeStore.nodes$)
      .pipe(takeUntil(this.destroy$))
      .subscribe(({ value: nodes, now }) => {
        this.nodes = nodes;
        this.syncMarkers(toMarkers(nodes, now));
        this.cdr.markForCheck();
      });
  }

  private syncMarkers(markers: MapMarker[]): void {
    const liveIds = new Set<string>();

    for (const m of markers) {
      liveIds.add(m.id);
      const icon = makeMarkerIcon(m.stale ? 'offline' : 'online');
      const tooltip = this.tooltipContent(m);
      const existing = this.markers.get(m.id);

      if (existing) {
        existing.setLatLng([m.lat, m.lng]);
        existing.setIcon(icon);
        existing.setTooltipContent(tooltip);
      } else {
        const marker = L.marker([m.lat, m.lng], { icon });
        marker.bindTooltip(tooltip, { direction: 'top', className: 'wl-tooltip', offset: [0, -14] });
        marker.on('click', () => {
          this.selectedNode = this.nodes.find(n => n.id === m.id) ?? null;
          this.cdr.markForCheck();
        });
        marker.addTo(this.map);
        this.markers.set(m.id, marker);
      }
    }

    if (this.selectedNode) {
      this.selectedNode = this.nodes.find(n => n.id === this.selectedNode?.id) ?? null;
      this.cdr.markForCheck();
    }

    for (const [id, marker] of this.markers) {
      if (!liveIds.has(id)) {
        marker.remove();
        this.markers.delete(id);
      }
    }
  }

  private tooltipContent(m: MapMarker): string {
    const node = this.nodes.find(n => n.id === m.id);
    const power = node?.externalPower ? 'powered' : node?.battery !== undefined ? `${node.battery}%` : '—';
    return `<strong>${escapeHtml(m.label)}</strong><br>${m.id} · ${power}`;
  }

  label(node: MeshNode): string {
    return nodeLabel(node);
  }

  formatLastHeard(node: MeshNode): string {
    const diff = Math.floor((Date.now() - node.lastHeard.getTime()) / 1000);
    if (diff < 5)    return 'just now';
    if (diff < 60)   return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.map?.remove();
  }

  zoomIn():  void { this.map?.zoomIn(); }
  zoomOut(): void { this.map?.zoomOut(); }

  fitDevices(): void {
    const all = Array.from(this.markers.values());
    if (!all.length || !this.map) return;
    const group = L.featureGroup(all);
    this.map.fitBounds(group.getBounds(), { padding: [60, 60] });
  }

  closeInfo(): void {
    this.selectedNode = null;
  }
}
