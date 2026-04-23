import { Component, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Subject, timer } from 'rxjs';
import { takeUntil, switchMap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error';

export interface ModuleResponse {
  timestamp: string;
  moduleId: string;
  signal: number;
  temperature?: number;
  humidity?: number;
  voltage?: number;
  raw?: unknown;
}

@Component({
  selector: 'app-htit-test',
  templateUrl: './htit-test.component.html',
  styleUrls: ['./htit-test.component.scss']
})
export class HtitTestComponent implements OnDestroy {
  activeTab: 'serial' | 'api' = 'serial';
  form: FormGroup;
  status: ConnectionStatus = 'idle';
  lastResponse: ModuleResponse | null = null;
  errorMessage = '';
  log: string[] = [];

  private destroy$ = new Subject<void>();

  constructor(private fb: FormBuilder, private http: HttpClient) {
    this.form = this.fb.group({
      moduleId:  ['htit-wb32-laf-v4.2', [Validators.required]],
      host:      ['localhost', [Validators.required]],
      port:      [9087, [Validators.required, Validators.min(1), Validators.max(65535)]],
      protocol:  ['http'],
      interval:  [5, [Validators.required, Validators.min(1), Validators.max(60)]],
    });
  }

  get apiUrl(): string {
    const { protocol, host, port } = this.form.value;
    return `${protocol}://${host}:${port}/api/v1`;
  }

  connect(): void {
    if (this.form.invalid) return;

    this.status = 'connecting';
    this.errorMessage = '';
    this.addLog(`Connecting to ${this.apiUrl}/module/${this.form.value.moduleId} ...`);

    const intervalMs = this.form.value.interval * 1000;

    timer(0, intervalMs).pipe(
      takeUntil(this.destroy$),
      switchMap(() =>
        this.http.get<ModuleResponse>(`${this.apiUrl}/module/${this.form.value.moduleId}`).pipe(
          catchError(err => {
            const msg = err?.error?.message ?? err?.message ?? 'Connection failed';
            return of({ error: msg } as any);
          })
        )
      )
    ).subscribe(res => {
      if (res?.error) {
        this.status = 'error';
        this.errorMessage = res.error;
        this.addLog(`[ERROR] ${res.error}`);
        this.disconnect();
        return;
      }
      this.status = 'connected';
      this.lastResponse = res as ModuleResponse;
      this.addLog(`[OK] Received data — signal: ${res.signal ?? '?'} dBm`);
    });
  }

  disconnect(): void {
    this.destroy$.next();
    this.destroy$ = new Subject<void>();
    if (this.status === 'connected') {
      this.addLog('Disconnected.');
    }
    if (this.status !== 'error') {
      this.status = 'idle';
    }
  }

  reset(): void {
    this.disconnect();
    this.status = 'idle';
    this.lastResponse = null;
    this.errorMessage = '';
    this.log = [];
  }

  private addLog(msg: string): void {
    const ts = new Date().toLocaleTimeString();
    this.log = [`[${ts}] ${msg}`, ...this.log].slice(0, 50);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
