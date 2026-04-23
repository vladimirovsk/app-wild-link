import { Component, OnInit } from '@angular/core';
import { DeviceService } from '../../shared/device.service';
import { Device } from '../../shared/device.model';

@Component({
  selector: 'app-devices',
  templateUrl: './devices.component.html',
  styleUrls: ['./devices.component.scss']
})
export class DevicesComponent implements OnInit {
  devices: Device[] = [];

  constructor(private deviceService: DeviceService) {}

  ngOnInit(): void {
    this.deviceService.getDevices().subscribe(d => this.devices = d);
  }

  get onlineCount(): number  { return this.devices.filter(d => d.status === 'online').length; }
  get warningCount(): number { return this.devices.filter(d => d.status === 'warning').length; }
  get offlineCount(): number { return this.devices.filter(d => d.status === 'offline').length; }
}
