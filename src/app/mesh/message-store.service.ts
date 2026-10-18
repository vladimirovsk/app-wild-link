import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { MeshClientService, MeshTextMessage } from './mesh-client.service';
import { utf8Length } from './mesh-mappers';

/** Meshtastic's text payload limit, in UTF-8 bytes. */
export const MAX_TEXT_BYTES = 228;
const MAX_MESSAGES = 200;

/** Chat history for this session: text heard over LoRa plus what this app sent. */
@Injectable({ providedIn: 'root' })
export class MessageStoreService implements OnDestroy {
  private readonly list$ = new BehaviorSubject<MeshTextMessage[]>([]);
  /** Newest last */
  readonly messages$: Observable<MeshTextMessage[]> = this.list$.asObservable();
  private readonly sub: Subscription;

  constructor(private readonly client: MeshClientService) {
    this.sub = client.messages$.subscribe(m => this.append(m));
  }

  /** Sends to one node, or broadcasts to the channel when `to` is omitted. */
  async send(text: string, to?: number): Promise<void> {
    if (utf8Length(text) > MAX_TEXT_BYTES) {
      throw new Error(`Message is longer than ${MAX_TEXT_BYTES} bytes`);
    }
    const id = await this.client.sendText(text, to);
    this.append({
      id,
      from: this.client.myNodeNum$.value ?? 0,
      to: to ?? 0xffffffff,
      text,
      at: new Date(),
      direction: 'outgoing',
    });
  }

  clear(): void {
    this.list$.next([]);
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }

  private append(message: MeshTextMessage): void {
    this.list$.next([...this.list$.value, message].slice(-MAX_MESSAGES));
  }
}
