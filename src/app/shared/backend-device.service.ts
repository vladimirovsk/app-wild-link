import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export type ConnectionType = 'serial' | 'bluetooth' | 'wifi' | 'lora';

export interface BackendDevice {
  _id: string;
  userId: string;
  /** Stable hardware node ID — lowercase hex derived from ESP32 MAC (e.g. "0acb0984") */
  deviceId: string;
  name: string;
  model: string;
  connectionType: ConnectionType;
  isActive: boolean;
  usbVendorId?: number;
  usbProductId?: number;
  registeredAt: string;
  lastSeenAt: string;
  lat?: number;
  lng?: number;
  alt?: number;
  battery?: number;
  voltage?: number;
  uptime?: number;
  sats?: number;
  airUtilTx?: number;
}

export interface RegisterDevicePayload {
  deviceId: string;
  name?: string;
  model?: string;
  connectionType?: ConnectionType;
  usbVendorId?: number;
  usbProductId?: number;
}

export interface HeartbeatPayload {
  lat?: number;
  lng?: number;
  alt?: number;
  battery?: number;
  voltage?: number;
  uptime?: number;
  sats?: number;
  airUtilTx?: number;
}

@Injectable({ providedIn: 'root' })
export class BackendDeviceService {
  private readonly base = `${environment.apiUrl}/devices`;

  constructor(private http: HttpClient) {}

  getAll(): Observable<BackendDevice[]> {
    return this.http.get<BackendDevice[]>(this.base).pipe(
      catchError(() => of([]))
    );
  }

  findOne(deviceId: string): Observable<BackendDevice | null> {
    return this.http.get<BackendDevice>(`${this.base}/${deviceId}`).pipe(
      catchError(() => of(null))
    );
  }

  register(payload: RegisterDevicePayload): Observable<BackendDevice | null> {
    return this.http.post<BackendDevice>(this.base, payload).pipe(
      catchError(() => of(null))
    );
  }

  heartbeat(deviceId: string, payload: HeartbeatPayload): Observable<BackendDevice | null> {
    return this.http.put<BackendDevice>(`${this.base}/${deviceId}/heartbeat`, payload).pipe(
      catchError(() => of(null))
    );
  }

  rename(deviceId: string, name: string): Observable<BackendDevice | null> {
    return this.http.patch<BackendDevice>(`${this.base}/${deviceId}`, { name }).pipe(
      catchError(() => of(null))
    );
  }

  /** Mark device as disconnected (isActive = false) in the database */
  disconnect(deviceId: string): Observable<BackendDevice | null> {
    return this.http.put<BackendDevice>(`${this.base}/${deviceId}/disconnect`, {}).pipe(
      catchError(() => of(null))
    );
  }

  remove(deviceId: string): Observable<{ deleted: boolean }> {
    return this.http.delete<{ deleted: boolean }>(`${this.base}/${deviceId}`).pipe(
      catchError(() => of({ deleted: false }))
    );
  }
}
