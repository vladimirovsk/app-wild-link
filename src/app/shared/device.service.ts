import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { Device } from './device.model';
import { DeviceStoreService } from './device-store.service';

@Injectable({ providedIn: 'root' })
export class DeviceService {
  constructor(private store: DeviceStoreService) {}

  getDevices(): Observable<Device[]> {
    return this.store.devices$;
  }
}
