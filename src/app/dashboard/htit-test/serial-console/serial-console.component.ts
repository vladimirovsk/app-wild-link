import {
  Component, OnInit, OnDestroy, AfterViewChecked, ViewChild, ElementRef
} from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';
import {
  SerialConnectionService, SerialStatus, ConsoleEntry
} from '../../../shared/serial-connection.service';

const BAUD_RATES = [9600, 19200, 38400, 57600, 74880, 115200, 230400, 921600];

@Component({
  selector: 'app-serial-console',
  templateUrl: './serial-console.component.html',
  styleUrls: ['./serial-console.component.scss']
})
export class SerialConsoleComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('consoleEl') consoleEl!: ElementRef<HTMLDivElement>;

  readonly baudRates = BAUD_RATES;
  form: FormGroup;
  autoScroll = true;
  private shouldScrollBottom = false;
  private subs = new Subscription();

  // Local copies for template binding
  status: SerialStatus = 'idle';
  entries: ConsoleEntry[] = [];
  portInfo: SerialPortInfo | null = null;
  rxBytes = 0;

  constructor(
    private fb: FormBuilder,
    public serial: SerialConnectionService,
  ) {
    this.form = this.fb.group({
      baudRate:   [115200, [Validators.required]],
      dataBits:   [8],
      stopBits:   [1],
      parity:     ['none'],
      lineEnding: ['\r\n'],
    });
  }

  ngOnInit(): void {
    this.subs.add(this.serial.status$.subscribe(s => { this.status = s; }));
    this.subs.add(this.serial.entries$.subscribe(e => {
      this.entries = e;
      this.shouldScrollBottom = this.autoScroll;
    }));
    this.subs.add(this.serial.portInfo$.subscribe(p => { this.portInfo = p; }));
    this.subs.add(this.serial.rxBytes$.subscribe(b => { this.rxBytes = b; }));
  }

  get isOpen():      boolean { return this.status === 'open'; }
  get isSupported(): boolean { return this.serial.isSupported; }

  connect(): void {
    const { baudRate, dataBits, stopBits, parity } = this.form.value;
    this.serial.connect({ baudRate, dataBits, stopBits, parity });
  }

  disconnect(): void { this.serial.disconnect(); }

  sendText(text: string): void {
    this.serial.send(text, this.form.value.lineEnding);
  }

  clearConsole(): void { this.serial.clear(); }

  ngAfterViewChecked(): void {
    if (this.shouldScrollBottom && this.consoleEl) {
      const el = this.consoleEl.nativeElement;
      el.scrollTop = el.scrollHeight;
      this.shouldScrollBottom = false;
    }
  }

  // Only unsubscribe — port stays open in the service
  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }
}
