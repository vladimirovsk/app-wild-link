import { Component } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { SerialConnectionService } from '../shared/serial-connection.service';

type View = 'map' | 'devices' | 'test';

const VIEW_KEY = 'wl_active_view';
const VALID_VIEWS: View[] = ['map', 'devices', 'test'];

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent {
  activeView: View;

  constructor(
    public auth: AuthService,
    public serial: SerialConnectionService,
  ) {
    const saved = localStorage.getItem(VIEW_KEY) as View;
    this.activeView = VALID_VIEWS.includes(saved) ? saved : 'map';
  }

  setView(view: View): void {
    this.activeView = view;
    localStorage.setItem(VIEW_KEY, view);
  }
}
