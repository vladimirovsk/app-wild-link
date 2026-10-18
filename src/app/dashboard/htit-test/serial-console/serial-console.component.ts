import {
  Component, OnInit, OnDestroy, AfterViewChecked, ViewChild, ElementRef
} from '@angular/core';
import { Subscription } from 'rxjs';
import { DeviceLogLine, MeshClientService, MeshStatus } from '../../../mesh/mesh-client.service';

const MAX_LINES = 500;

/** Device log records received through the Meshtastic client API. */
@Component({
  selector: 'app-serial-console',
  templateUrl: './serial-console.component.html',
  styleUrls: ['./serial-console.component.scss']
})
export class SerialConsoleComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('consoleEl') consoleEl!: ElementRef<HTMLDivElement>;

  autoScroll = true;
  status: MeshStatus = 'disconnected';
  lines: DeviceLogLine[] = [];
  private shouldScrollBottom = false;
  private subs = new Subscription();

  constructor(private mesh: MeshClientService) {}

  ngOnInit(): void {
    this.subs.add(this.mesh.status$.subscribe(s => { this.status = s; }));
    this.subs.add(this.mesh.deviceLog$.subscribe(line => {
      this.lines = [...this.lines, line].slice(-MAX_LINES);
      this.shouldScrollBottom = this.autoScroll;
    }));
  }

  clearConsole(): void { this.lines = []; }

  ngAfterViewChecked(): void {
    if (this.shouldScrollBottom && this.consoleEl) {
      const el = this.consoleEl.nativeElement;
      el.scrollTop = el.scrollHeight;
      this.shouldScrollBottom = false;
    }
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }
}
