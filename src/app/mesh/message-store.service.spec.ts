import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject } from 'rxjs';
import { MeshClientService, MeshTextMessage } from './mesh-client.service';
import { MessageStoreService } from './message-store.service';

const SELF = 0x0acb0984;
const OTHER = 0x11111111;

class FakeClient {
  readonly incoming = new Subject<MeshTextMessage>();
  readonly messages$ = this.incoming.asObservable();
  readonly myNodeNum$ = new BehaviorSubject<number | null>(SELF);
  sent: Array<{ text: string; to?: number }> = [];
  sendText(text: string, to?: number): Promise<number> {
    this.sent.push({ text, to });
    return Promise.resolve(7);
  }
}

function incoming(id: number, text: string): MeshTextMessage {
  return { id, from: OTHER, to: 0xffffffff, text, at: new Date('2026-10-18T10:00:00Z'), direction: 'incoming' };
}

describe('MessageStoreService', () => {
  let client: FakeClient;
  let store: MessageStoreService;
  let latest: MeshTextMessage[];

  beforeEach(() => {
    client = new FakeClient();
    TestBed.configureTestingModule({ providers: [{ provide: MeshClientService, useValue: client }] });
    store = TestBed.inject(MessageStoreService);
    store.messages$.subscribe(list => (latest = list));
  });

  it('appends each incoming message once', () => {
    client.incoming.next(incoming(1, 'hello'));

    expect(latest.length).toBe(1);
    expect(latest[0].text).toBe('hello');
  });

  it('broadcasts when no destination is given and records one outgoing entry', async () => {
    await store.send('hi');

    expect(client.sent).toEqual([{ text: 'hi', to: undefined }]);
    expect(latest.length).toBe(1);
    expect(latest[0]).toEqual(jasmine.objectContaining({ id: 7, from: SELF, text: 'hi', direction: 'outgoing' }));
  });

  it('rejects text over 228 bytes before sending anything', async () => {
    const longCyrillic = 'ж'.repeat(150); // 300 bytes

    await expectAsync(store.send(longCyrillic)).toBeRejectedWithError('Message is longer than 228 bytes');
    expect(client.sent).toEqual([]);
    expect(latest).toEqual([]);
  });

  it('accepts text of exactly 228 bytes', async () => {
    await store.send('ж'.repeat(114));

    expect(client.sent.length).toBe(1);
  });

  it('forgets the history on clear', () => {
    client.incoming.next(incoming(1, 'hello'));
    store.clear();

    expect(latest).toEqual([]);
  });

  it('keeps at most 200 messages, dropping the oldest', () => {
    for (let i = 1; i <= 205; i++) client.incoming.next(incoming(i, `m${i}`));

    expect(latest.length).toBe(200);
    expect(latest[0].id).toBe(6);
    expect(latest[199].id).toBe(205);
  });
});
