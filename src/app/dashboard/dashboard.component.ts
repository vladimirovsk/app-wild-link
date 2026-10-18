import { Component } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { MeshClientService, MeshStatus } from '../mesh/mesh-client.service';
import { MessageStoreService } from '../mesh/message-store.service';

type View = 'map' | 'devices' | 'test' | 'messages';

const VIEW_KEY = 'wl_active_view';
const VALID_VIEWS: View[] = ['map', 'devices', 'test', 'messages'];

const STATUS_TEXT: Record<MeshStatus, string> = {
  unsupported: 'This browser cannot open USB devices. Use Chrome or Edge on a computer.',
  disconnected: 'Not connected',
  connecting: 'Connecting…',
  configuring: 'Reading the mesh…',
  connected: 'Connected',
  error: 'Could not open the device. Check the cable and try again.',
};

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent {
  activeView: View;
  readonly statusText = STATUS_TEXT;

  constructor(
    public auth: AuthService,
    public mesh: MeshClientService,
    public messages: MessageStoreService,
  ) {
    const saved = localStorage.getItem(VIEW_KEY) as View;
    this.activeView = VALID_VIEWS.includes(saved) ? saved : 'map';
  }

  setView(view: View): void {
    this.activeView = view;
    localStorage.setItem(VIEW_KEY, view);
  }

  toggleConnection(status: MeshStatus): void {
    if (status === 'connected' || status === 'configuring') {
      void this.mesh.disconnect();
    } else {
      void this.mesh.connect();
    }
  }
}
