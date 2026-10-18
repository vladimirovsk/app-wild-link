import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, map } from 'rxjs';
import { MeshNode } from './mesh-node.model';
import { ProtoPosition, batteryFromProto, nodeIdFromNum, positionFromProto } from './mesh-mappers';

/** Node info as the device's node database reports it on configure. */
export interface NodeInfoInput {
  num: number;
  shortName?: string;
  longName?: string;
  position?: ProtoPosition;
  batteryLevel?: number;
  voltage?: number;
  snr?: number;
  hopsAway?: number;
  /** Unix seconds */
  lastHeard?: number;
}

/** Latest state of every mesh node, keyed by node number. */
@Injectable({ providedIn: 'root' })
export class NodeStoreService {
  private readonly store$ = new BehaviorSubject<Map<number, MeshNode>>(new Map());
  private selfNum: number | null = null;

  readonly nodes$: Observable<MeshNode[]> = this.store$.pipe(map(nodes => Array.from(nodes.values())));

  snapshot(): MeshNode[] {
    return Array.from(this.store$.value.values());
  }

  setSelf(num: number): void {
    this.selfNum = num;
    const next = new Map<number, MeshNode>();
    this.store$.value.forEach((node, key) => next.set(key, { ...node, isSelf: key === num }));
    this.store$.next(next);
  }

  applyNodeInfo(info: NodeInfoInput): void {
    const heard = info.lastHeard ? new Date(info.lastHeard * 1000) : undefined;
    const position = info.position ? positionFromProto(info.position) : null;
    const hasBattery = info.batteryLevel !== undefined || info.voltage !== undefined;

    this.patch(info.num, heard, node => ({
      ...node,
      ...(info.shortName !== undefined ? { shortName: info.shortName } : {}),
      ...(info.longName !== undefined ? { longName: info.longName } : {}),
      ...(position ? this.positionPatch(position) : {}),
      ...(hasBattery ? batteryFromProto(info.batteryLevel, info.voltage) : {}),
      ...(info.snr !== undefined ? { snr: info.snr } : {}),
      ...(info.hopsAway !== undefined ? { hopsAway: info.hopsAway } : {}),
    }));
  }

  applyPosition(num: number, p: ProtoPosition, rxTime: Date): void {
    const position = positionFromProto(p);
    this.patch(num, rxTime, node => (position ? { ...node, ...this.positionPatch(position) } : node));
  }

  applyBattery(num: number, level: number | undefined, voltage: number | undefined, rxTime: Date): void {
    this.patch(num, rxTime, node => ({ ...node, ...batteryFromProto(level, voltage) }));
  }

  applyName(num: number, shortName: string, longName: string, rxTime: Date): void {
    this.patch(num, rxTime, node => ({ ...node, shortName, longName }));
  }

  clear(): void {
    this.store$.next(new Map());
  }

  private patch(num: number, heard: Date | undefined, update: (node: MeshNode) => MeshNode): void {
    const current = this.store$.value.get(num) ?? this.emptyNode(num, heard);
    const updated = update(current);
    const next = new Map(this.store$.value);
    next.set(num, heard ? { ...updated, lastHeard: heard } : updated);
    this.store$.next(next);
  }

  private emptyNode(num: number, heard: Date | undefined): MeshNode {
    return {
      num,
      id: nodeIdFromNum(num),
      externalPower: false,
      lastHeard: heard ?? new Date(0),
      isSelf: num === this.selfNum,
    };
  }

  private positionPatch(p: { lat: number; lng: number; alt?: number; at?: Date }): Partial<MeshNode> {
    return {
      lat: p.lat,
      lng: p.lng,
      ...(p.alt !== undefined ? { alt: p.alt } : {}),
      ...(p.at ? { positionAt: p.at } : {}),
    };
  }
}
