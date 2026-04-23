import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { Device } from './device.model';

const MOCK_DEVICES: Device[] = [
  { id: 'WL-001', name: 'Base Camp Alpha',      lat: 50.9303, lng: -115.1712, status: 'online',  battery: 87, lastSeen: '2 min ago' },
  { id: 'WL-002', name: 'Trail Head Ribbon',    lat: 50.8841, lng: -115.1834, status: 'online',  battery: 62, lastSeen: '5 min ago' },
  { id: 'WL-003', name: 'Summit North Ridge',   lat: 50.7502, lng: -115.4013, status: 'offline', battery: 14, lastSeen: '3 hrs ago' },
  { id: 'WL-004', name: 'Spray Lakes Relay',    lat: 50.8762, lng: -115.2134, status: 'online',  battery: 95, lastSeen: 'just now'  },
  { id: 'WL-005', name: 'Peter Lougheed Node',  lat: 50.6071, lng: -115.1485, status: 'warning', battery: 31, lastSeen: '18 min ago'},
  { id: 'WL-006', name: 'Canmore Gateway',      lat: 51.0892, lng: -115.3523, status: 'online',  battery: 76, lastSeen: '1 min ago' },
];

@Injectable({ providedIn: 'root' })
export class DeviceService {
  private readonly API_URL = 'http://localhost:9087/api/v1';

  constructor(private http: HttpClient) {}

  // TODO: replace with real endpoint when available
  getDevices(): Observable<Device[]> {
    return of(MOCK_DEVICES);
  }
}