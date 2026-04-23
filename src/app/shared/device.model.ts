export interface Device {
  id: string;
  name: string;
  lat: number;
  lng: number;
  status: 'online' | 'offline' | 'warning';
  battery: number;
  lastSeen: string;
}