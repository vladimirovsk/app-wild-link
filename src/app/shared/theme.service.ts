import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type Theme = 'dark' | 'light';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly STORAGE_KEY = 'wl_theme';

  private _theme = new BehaviorSubject<Theme>(this.loadSaved());
  readonly theme$ = this._theme.asObservable();

  get current(): Theme { return this._theme.value; }
  get isLight(): boolean { return this._theme.value === 'light'; }

  constructor() {
    this.apply(this._theme.value);
  }

  toggle(): void {
    const next: Theme = this._theme.value === 'dark' ? 'light' : 'dark';
    this._theme.next(next);
    this.apply(next);
    localStorage.setItem(this.STORAGE_KEY, next);
  }

  private apply(theme: Theme): void {
    document.documentElement.setAttribute('data-theme', theme);
  }

  private loadSaved(): Theme {
    return (localStorage.getItem(this.STORAGE_KEY) as Theme) ?? 'dark';
  }
}
