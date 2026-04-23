import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Routes } from '@angular/router';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { DashboardComponent } from './dashboard.component';
import { MapComponent } from './map/map.component';
import { DevicesComponent } from './devices/devices.component';
import { HtitTestComponent } from './htit-test/htit-test.component';
import { SerialConsoleComponent } from './htit-test/serial-console/serial-console.component';

const routes: Routes = [
  { path: '', component: DashboardComponent }
];

@NgModule({
  declarations: [
    DashboardComponent,
    MapComponent,
    DevicesComponent,
    HtitTestComponent,
    SerialConsoleComponent,
  ],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    RouterModule.forChild(routes),
  ]
})
export class DashboardModule {}
