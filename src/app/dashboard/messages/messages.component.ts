import {
  AfterViewChecked,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { FormControl, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';
import { nodeLabel } from '../../mesh/map-markers';
import { MeshClientService, MeshTextMessage } from '../../mesh/mesh-client.service';
import { nodeIdFromNum, parseNodeId, utf8Length } from '../../mesh/mesh-mappers';
import { MAX_TEXT_BYTES, MessageStoreService } from '../../mesh/message-store.service';
import { NodeStoreService } from '../../mesh/node-store.service';

const BROADCAST = 0xffffffff;

@Component({
  selector: 'app-messages',
  templateUrl: './messages.component.html',
  styleUrls: ['./messages.component.scss'],
})
export class MessagesComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('scrollAnchor') private scrollAnchor!: ElementRef<HTMLElement>;

  messages: MeshTextMessage[] = [];
  private subs = new Subscription();
  private shouldScroll = false;

  sendText  = new FormControl('', [Validators.required]);
  toNodeId  = new FormControl('');   // empty = broadcast
  sending   = false;
  sendError = '';

  constructor(
    public mesh: MeshClientService,
    private store: MessageStoreService,
    private nodes: NodeStoreService,
  ) {}

  ngOnInit(): void {
    this.subs.add(this.store.messages$.subscribe(msgs => {
      this.messages = msgs;
      this.shouldScroll = true;
    }));
  }

  ngAfterViewChecked(): void {
    if (this.shouldScroll) {
      this.scrollToBottom();
      this.shouldScroll = false;
    }
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  get bytesLeft(): number {
    return MAX_TEXT_BYTES - utf8Length(this.sendText.value ?? '');
  }

  async send(): Promise<void> {
    const text = this.sendText.value?.trim();
    if (!text || this.sending) return;

    const to = parseNodeId(this.toNodeId.value ?? '');
    if (to === null) {
      this.sendError = 'Node id must look like !0acb0984, or leave it blank to send to everyone.';
      return;
    }

    this.sending   = true;
    this.sendError = '';
    try {
      await this.store.send(text, to);
      this.sendText.reset();
    } catch (err) {
      this.sendError = err instanceof Error ? err.message : 'Send failed';
    } finally {
      this.sending = false;
    }
  }

  clear(): void {
    this.store.clear();
  }

  private scrollToBottom(): void {
    try {
      this.scrollAnchor.nativeElement.scrollIntoView({ behavior: 'smooth' });
    } catch { /* ignore */ }
  }

  /** Display label for a node number */
  label(num: number): string {
    if (num === BROADCAST) return 'ALL';
    const node = this.nodes.snapshot().find(n => n.num === num);
    return node ? nodeLabel(node) : nodeIdFromNum(num);
  }
}
