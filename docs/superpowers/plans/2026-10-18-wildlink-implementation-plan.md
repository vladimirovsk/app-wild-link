# WildLink Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the debug-log prototype with a real Meshtastic client link in webApp-wildlink (Phase 1), as the base for groups, Guardian Alert and SOS in later phases.

**Architecture:** The app talks to its own (head) device through the official Meshtastic client API (`@meshtastic/core` + Web Serial transport), keeps every mesh node's latest state in an in-app store, and sends/receives text over LoRa itself. The backend (ITCoderNest `devices` module) stays only for registration and heartbeat; it is never on the alert path.

**Tech Stack:** Angular 15, TypeScript 4.9, RxJS 7.8, Leaflet 1.9, Karma/Jasmine; `@meshtastic/core` 2.6.7, `@meshtastic/transport-web-serial` 0.2.5; backend NestJS + MongoDB (ITCoderNest).

**Spec:** "WildLink: Solution Options" (Claude Docs) — https://claude.ai/code/artifact/7264cdaa-c3ca-44fa-a9f2-bed408b84373 — sections Requirements, Baseline scenario: no internet, Power and device roles, Roadmap.

---

## Part A — Where things stand (audit 2026-10-18)

| Area | Done | Partial / WIP | Not started |
| --- | --- | --- | --- |
| Landing (`WildLink/StartPage`) | Full marketing page, waitlist, FAQ, partnership | — | Copy fix for iOS ("any phone, no app store" is false on iOS) |
| Webapp link to device | Web Serial connect, auto-connect, hot-plug; debug-log regex parser (own node id, own GPS, own telemetry, text lines) | Uncommitted: chat via backend relay, parser changes; `package-lock.json` deleted; `node_modules` missing | Official client API; other nodes' positions; sending over LoRa; BLE |
| Webapp UI | Login (JWT against ITCoderNest), dashboard, Leaflet map, devices list, serial console | Messages screen (uncommitted) | Groups, alarms, offline tiles |
| Webapp tests | Karma target configured | — | No `*.spec.ts` files at all |
| Backend (`ITCoderNest/apps/rest/src`) | `devices`: register, heartbeat, disconnect, rename, delete, with specs; JWT auth | `lora`: relay of log-parsed messages + WebSocket; `/lora/send` stores only; `DELETE /lora/messages` is a stub | Groups, track history |
| Firmware | Stock Meshtastic on HTIT-WB32LAF | — | WildLink module (phase 5) |

Requirement coverage: R1 partial (own device only), R5 given by Meshtastic, R2–R4, R6–R8, R11 not started.

## Part B — Phases and their plans

Each phase gets its own detailed plan when it starts. Only Phase 1 is detailed below.

| Phase | Outcome | Main pieces | Exit criteria (from the spec) |
| --- | --- | --- | --- |
| 1. Real device link (this plan) | App sees every node and sends text over LoRa | `@meshtastic/core`, node store, map/devices/messages on it, log parser and `lora` relay removed | With 3 boards, each app shows all 3 on the map and text goes both ways over LoRa, no regex parsing |
| 2. Group + safety, no internet | Guardian Alert, lost contact, SOS work offline | Group = private channel (random AES-256 key, QR join); roster in app; position interval 30–60 s, all devices CLIENT role; Guardian service (out of radius on 2 consecutive positions, lost contact after 3 intervals); SOS = text with bell char + private-port ack; alarm (sound, vibration, red pin); offline map tiles (R11); Web Bluetooth transport for Android Chrome | In Kananaskis with no internet: leaving the radius alerts other phones within one interval; switching a device off raises lost contact; map shows with no signal; battery life at the chosen interval measured |
| 3. Phone delivery | Works on iPhone and Android, screen locked | Capacitor shell around the Angular app, native BLE plugin, background mode, notifications | Alerts fire on a locked iPhone and Android phone |
| 4. Backend sync | History and dashboard when back online | Groups and tracks in backend; upload queue in the app; dashboard history; decide whether WildLink leaves ITCoderNest | A trip recorded offline appears in the dashboard after reconnecting |
| 5. Firmware module | Phoneless child device reacts on its own | Physical SOS button, LED ring, on-device Guardian Alert, private-port messages | A device with no phone beeps and blinks when its wearer leaves the radius; its SOS reaches every phone |

Known cross-phase risk: Angular 15 is out of support. Upgrade only if Task 1's gate fails, or as its own plan before Phase 3 (Capacitor).

---

## Phase 1 — Real device link

## Global Constraints

- Code, comments, commit messages in English.
- Pin `@meshtastic/core@2.6.7` and `@meshtastic/transport-web-serial@0.2.5` exactly.
- Serial baud rate: 115200.
- Text message limit: 228 bytes of UTF-8 (not characters; Cyrillic takes 2 bytes per letter).
- Meshtastic node id format: `!` + node number in lowercase hex, 8 digits (e.g. `!0acb0984`).
- Position fields from the device are integers × 1e-7 (`latitudeI`, `longitudeI`).
- Backend base URL comes only from `environment.apiUrl`; nothing safety-related may depend on the backend answering.
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` when made by an agent.
- Work on branch `feat/meshtastic-client-api` in `WildLink/webApp-wildlink`.

## Review Focus

1. A position packet without a GPS fix (`latitudeI` and `longitudeI` both 0 or missing) — the node must not be drawn at 0,0 in the Atlantic; it keeps its last known position. Test in Task 3.
2. Battery level 101 (Meshtastic's "external power") — show "powered", never "101%". Test in Task 3.
3. The board is unplugged mid-session — status goes to `disconnected`, known nodes stay on the map, reconnect works without reloading. Test in Task 4.
4. A browser without Web Serial (Safari, Firefox) — a clear "not supported in this browser" state, no exception on load. Test in Task 4.
5. A message longer than 228 bytes in Cyrillic (e.g. 150 Russian letters = 300 bytes) — rejected before sending with a visible error. Test in Task 6.

---

### Task 0: Clean starting point

**Files:**
- Modify: working tree of `WildLink/webApp-wildlink`

- [ ] **Step 1: Keep the WIP on its own branch**

```bash
cd ~/Project/WildLink/webApp-wildlink
git checkout -b wip/log-parsing-chat
git checkout HEAD -- package-lock.json   # restore the deleted lock file first
git add -A src package.json
git commit -m "wip: log-parsing chat prototype (superseded by Meshtastic client API)"
git checkout main
git checkout -b feat/meshtastic-client-api
```

- [ ] **Step 2: Install and check the baseline builds**

Run: `npm ci && npx ng build --configuration development`
Expected: build succeeds (warnings allowed). If `npm ci` fails because the lock file no longer matches, run `npm install` once and commit the regenerated lock file.

- [ ] **Step 3: Prove the test runner works with one smoke spec**

Create `src/app/app.component.spec.ts` asserting `AppComponent` is created (`TestBed.configureTestingModule({ declarations: [AppComponent], imports: [RouterTestingModule] })`).
Run: `npx ng test --watch=false --browsers=ChromeHeadless`
Expected: `1 SUCCESS`.

- [ ] **Step 4: Commit**

```bash
git add package-lock.json src/app/app.component.spec.ts
git commit -m "test: add smoke spec and restore lock file"
```

### Task 1: Meshtastic packages compile under Angular 15 (gate)

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `src/app/mesh/mesh-packages.spec.ts`

**Interfaces:**
- Produces: importable `MeshDevice`, `Types`, `Protobuf` from `@meshtastic/core`; `TransportWebSerial` from `@meshtastic/transport-web-serial`.

- [ ] **Step 1: Write the failing test**

```ts
import { MeshDevice } from '@meshtastic/core';
import { TransportWebSerial } from '@meshtastic/transport-web-serial';

describe('meshtastic packages', () => {
  it('load in the Angular build', () => {
    expect(typeof MeshDevice).toBe('function');
    expect(typeof TransportWebSerial.create).toBe('function');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx ng test --watch=false --browsers=ChromeHeadless`
Expected: FAIL, module `@meshtastic/core` not found.

- [ ] **Step 3: Install the pinned packages**

Run: `npm install --save-exact @meshtastic/core@2.6.7 @meshtastic/transport-web-serial@0.2.5`
The core typings import `@meshtastic/protobufs`, `tslog` and `ste-simple-events`; if the compiler reports them missing, add them as direct dependencies at the versions core resolves to.

- [ ] **Step 4: Run tests and a production build**

Run: `npx ng test --watch=false --browsers=ChromeHeadless && npx ng build`
Expected: tests PASS and build succeeds.

**Gate:** if TypeScript 4.9 cannot parse the packages' typings or the Angular 15 builder cannot bundle them, stop here and report. The fallback is a separate plan to upgrade Angular (15 → current LTS) before continuing; do not hand-patch the packages.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/app/mesh/mesh-packages.spec.ts
git commit -m "build: add @meshtastic/core and web-serial transport"
```

### Task 2: Pure mappers from Meshtastic data to app values

**Files:**
- Create: `src/app/mesh/mesh-mappers.ts`
- Test: `src/app/mesh/mesh-mappers.spec.ts`

**Interfaces:**
- Produces:
  - `nodeIdFromNum(num: number): string`
  - `positionFromProto(p: { latitudeI?: number; longitudeI?: number; altitude?: number; time?: number }): { lat: number; lng: number; alt?: number; at?: Date } | null`
  - `batteryFromProto(level?: number, voltage?: number): { battery?: number; externalPower: boolean; voltage?: number }`
  - `utf8Length(text: string): number`

- [ ] **Step 1: Write the failing tests**

```ts
it('formats node ids', () => {
  expect(nodeIdFromNum(0x0acb0984)).toBe('!0acb0984');
  expect(nodeIdFromNum(0xff)).toBe('!000000ff');
});
it('scales integer coordinates', () => {
  expect(positionFromProto({ latitudeI: 510447000, longitudeI: -1140719000, altitude: 1045, time: 1792300000 }))
    .toEqual({ lat: 51.0447, lng: -114.0719, alt: 1045, at: new Date(1792300000 * 1000) });
});
it('returns null when there is no fix', () => {
  expect(positionFromProto({ latitudeI: 0, longitudeI: 0 })).toBeNull();
  expect(positionFromProto({})).toBeNull();
});
it('treats level 101 as external power', () => {
  expect(batteryFromProto(101, 4.2)).toEqual({ battery: undefined, externalPower: true, voltage: 4.2 });
  expect(batteryFromProto(87)).toEqual({ battery: 87, externalPower: false, voltage: undefined });
});
it('counts UTF-8 bytes', () => {
  expect(utf8Length('abc')).toBe(3);
  expect(utf8Length('привет')).toBe(12);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx ng test --watch=false --browsers=ChromeHeadless`
Expected: FAIL, `mesh-mappers` not found.

- [ ] **Step 3: Implement the four functions in `mesh-mappers.ts`**

Round coordinates to 7 decimals to avoid float noise; `level > 100` means external power; `utf8Length` uses `TextEncoder`.

- [ ] **Step 4: Run tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/mesh/mesh-mappers.ts src/app/mesh/mesh-mappers.spec.ts
git commit -m "feat(mesh): add mappers for node ids, positions, battery, text length"
```

### Task 3: Node store — latest state of every mesh node

**Files:**
- Create: `src/app/mesh/mesh-node.model.ts`, `src/app/mesh/node-store.service.ts`
- Test: `src/app/mesh/node-store.service.spec.ts`

**Interfaces:**
- Consumes: Task 2 mappers.
- Produces:

```ts
export interface MeshNode {
  num: number;
  id: string;              // '!0acb0984'
  shortName?: string;
  longName?: string;
  lat?: number; lng?: number; alt?: number;
  positionAt?: Date;
  battery?: number;        // 0–100, undefined on external power
  externalPower: boolean;
  voltage?: number;
  snr?: number;
  hopsAway?: number;
  lastHeard: Date;
  isSelf: boolean;
}
```

`NodeStoreService` (`providedIn: 'root'`):
- `readonly nodes$: Observable<MeshNode[]>`
- `snapshot(): MeshNode[]`
- `setSelf(num: number): void`
- `applyNodeInfo(n: { num: number; shortName?: string; longName?: string; position?: Parameters<typeof positionFromProto>[0]; batteryLevel?: number; voltage?: number; snr?: number; hopsAway?: number; lastHeard?: number }): void` — `lastHeard` in Unix seconds
- `applyPosition(num: number, p: Parameters<typeof positionFromProto>[0], rxTime: Date): void`
- `applyBattery(num: number, level: number | undefined, voltage: number | undefined, rxTime: Date): void`
- `applyName(num: number, shortName: string, longName: string, rxTime: Date): void`
- `clear(): void`

- [ ] **Step 1: Write the failing tests**

- `applyPosition` creates node `!0acb0984` with `lat 51.0447` and `lastHeard` = `rxTime`.
- A second `applyPosition` with `{ latitudeI: 0, longitudeI: 0 }` keeps `lat 51.0447` and still updates `lastHeard` (Review Focus 1).
- `applyBattery(num, 101, 4.2, t)` gives `externalPower: true`, `battery: undefined` (Review Focus 2).
- `applyNodeInfo` with position, battery and names fills all fields in one node.
- `setSelf(num)` marks exactly that node `isSelf: true`.
- `nodes$` emits a new array on every change (assert two emissions after two updates).

- [ ] **Step 2: Run to see them fail** — Expected: FAIL, service not found.

- [ ] **Step 3: Implement `NodeStoreService`** with a `BehaviorSubject<Map<number, MeshNode>>`, emitting `Array.from(map.values())`.

- [ ] **Step 4: Run tests** — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/mesh/mesh-node.model.ts src/app/mesh/node-store.service.ts src/app/mesh/node-store.service.spec.ts
git commit -m "feat(mesh): add node store for all mesh nodes"
```

### Task 4: Mesh client service — connect, configure, route events

**Files:**
- Create: `src/app/mesh/mesh-client.service.ts`, `src/app/mesh/mesh-tokens.ts`
- Test: `src/app/mesh/mesh-client.service.spec.ts`

**Interfaces:**
- Consumes: Task 3 `NodeStoreService`; `MeshDevice`, `Types.DeviceStatusEnum`, `TransportWebSerial` from Task 1.
- Produces:

```ts
// mesh-tokens.ts
export type MeshDeviceLike = Pick<MeshDevice, 'events' | 'configure' | 'sendText' | 'disconnect'>;
export const MESH_TRANSPORT_FACTORY: InjectionToken<() => Promise<Types.Transport>>;  // default: () => TransportWebSerial.create(115200)
export const MESH_DEVICE_FACTORY: InjectionToken<(t: Types.Transport) => MeshDeviceLike>; // default: t => new MeshDevice(t)
export const WEB_SERIAL_SUPPORTED: InjectionToken<boolean>;                              // default: 'serial' in navigator

// mesh-client.service.ts
export type MeshStatus = 'unsupported' | 'disconnected' | 'connecting' | 'configuring' | 'connected' | 'error';
export interface MeshTextMessage { id: number; from: number; to: number; text: string; at: Date; direction: 'incoming' | 'outgoing'; }

class MeshClientService {
  readonly status$: BehaviorSubject<MeshStatus>;
  readonly myNodeNum$: BehaviorSubject<number | null>;
  readonly messages$: Observable<MeshTextMessage>;   // incoming text from other nodes
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendText(text: string, to?: number): Promise<number>;  // to omitted = broadcast
}
```

Event routing: `onMyNodeInfo` → `myNodeNum$` + `store.setSelf`; `onNodeInfoPacket` → `store.applyNodeInfo` (fields from `NodeInfo.user`, `.position`, `.deviceMetrics`, `.snr`, `.hopsAway`, `.lastHeard`); `onPositionPacket` → `store.applyPosition(from, data, rxTime)`; `onTelemetryPacket` with `deviceMetrics` → `store.applyBattery`; `onUserPacket` → `store.applyName`; `onMessagePacket` from another node → `messages$`; `onDeviceStatus`: `DeviceConfigured` → `connected`, `DeviceDisconnected` → `disconnected`.

- [ ] **Step 1: Write the failing tests**

Use a fake device whose `events.onX` are tiny dispatchers (`subscribe(fn)` returns an unsubscribe function, `dispatch(v)` calls subscribers), provided through `MESH_DEVICE_FACTORY`; `MESH_TRANSPORT_FACTORY` returns `{}`.

- `connect()` calls `configure()` once and moves `connecting → configuring`; dispatching `DeviceConfigured` gives `connected`.
- A position packet `{ from: 0x0acb0984, rxTime, data: { latitudeI: 510447000, longitudeI: -1140719000 } }` lands in `NodeStoreService.snapshot()`.
- `onMyNodeInfo({ myNodeNum: 0x0acb0984 })` sets `myNodeNum$` and the node's `isSelf`.
- A message packet from another node is emitted on `messages$`; one from `myNodeNum` is not.
- Dispatching `DeviceDisconnected` sets `disconnected`, keeps nodes in the store, and a second `connect()` works (Review Focus 3).
- With `WEB_SERIAL_SUPPORTED` = `false`, the initial status is `unsupported` and `connect()` resolves without calling the transport factory (Review Focus 4).

- [ ] **Step 2: Run to see them fail** — Expected: FAIL, service not found.

- [ ] **Step 3: Implement the tokens and `MeshClientService`**

Run dispatcher callbacks inside `NgZone.run` so templates update. Keep unsubscribe functions and call them on `disconnect()`.

- [ ] **Step 4: Run tests** — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/mesh/mesh-tokens.ts src/app/mesh/mesh-client.service.ts src/app/mesh/mesh-client.service.spec.ts
git commit -m "feat(mesh): connect via Meshtastic client API and route events to the node store"
```

### Task 5: Map, devices list and connect button on the node store

**Files:**
- Create: `src/app/mesh/map-markers.ts`, test `src/app/mesh/map-markers.spec.ts`
- Modify: `src/app/dashboard/map/map.component.ts`, `src/app/dashboard/devices/devices.component.ts` (+ their templates), `src/app/dashboard/dashboard.component.ts`

**Interfaces:**
- Consumes: `NodeStoreService.nodes$`, `MeshClientService.status$ / connect() / disconnect()`.
- Produces: `toMarkers(nodes: MeshNode[]): { id: string; label: string; lat: number; lng: number; self: boolean; stale: boolean }[]` — nodes without a position are skipped; `stale` when `lastHeard` is older than 15 minutes (Meshtastic's default broadcast interval; Phase 2 replaces this with the group interval).

- [ ] **Step 1: Write the failing test** — three nodes, one without position → two markers; label falls back from `longName` to `shortName` to `id`; a node last heard 16 minutes ago has `stale: true`.
- [ ] **Step 2: Run to see it fail.**
- [ ] **Step 3: Implement `toMarkers`; switch the map and devices list from `DeviceService`/`DeviceStoreService` to `NodeStoreService`; the dashboard's connect button calls `MeshClientService.connect()` and shows `status$`, including the "not supported in this browser" text for `unsupported`.**
- [ ] **Step 4: Run tests and `npx ng build`** — Expected: PASS, build succeeds.
- [ ] **Step 5: Commit** — `feat(dashboard): show every mesh node from the node store`

### Task 6: Messages over LoRa

**Files:**
- Modify: `src/app/dashboard/messages/messages.component.ts` + template (restore with `git checkout wip/log-parsing-chat -- src/app/dashboard/messages` as a starting point, then drop its HTTP/socket code)
- Modify: `src/app/dashboard/dashboard.module.ts` — declare `MessagesComponent` (it exists only on the WIP branch)
- Create: `src/app/mesh/message-store.service.ts`, test `src/app/mesh/message-store.service.spec.ts`

**Interfaces:**
- Consumes: `MeshClientService.messages$`, `sendText`, `myNodeNum$`; `utf8Length`.
- Produces: `MessageStoreService.messages$: Observable<MeshTextMessage[]>` (newest last, capped at 200); `send(text: string, to?: number): Promise<void>` throws `Error('Message is longer than 228 bytes')` when `utf8Length(text) > 228`.

- [ ] **Step 1: Write the failing tests** — incoming message appended once; `send('hi')` calls `sendText('hi', undefined)` and appends one `outgoing` entry; `send` of 150 Cyrillic letters rejects with the 228-byte error and calls nothing (Review Focus 5); list never exceeds 200.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement the store; the component shows the byte error under the input.**
- [ ] **Step 4: Run tests** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(messages): send and receive text over LoRa`

### Task 7: Keep backend registration and heartbeat, fed from the node store

**Files:**
- Create: `src/app/mesh/backend-sync.service.ts`, test `src/app/mesh/backend-sync.service.spec.ts`
- Modify: `src/app/shared/backend-device.service.ts` (no API change)

**Interfaces:**
- Consumes: `MeshClientService.status$`, `myNodeNum$`; `NodeStoreService.nodes$`; `BackendDeviceService.register / heartbeat / disconnect`.
- Produces: `BackendSyncService.start(): void` — on `connected`, registers the self node (`deviceId` = id without `!`, `connectionType: 'serial'`); every 30 s sends a heartbeat with the self node's `lat/lng/alt/battery/voltage`; on `disconnected`, calls `disconnect`. Failures are swallowed (backend is off the safety path).

- [ ] **Step 1: Write the failing tests** with `fakeAsync` and a spy `BackendDeviceService`: register once on connect; heartbeat after `tick(30_000)` with the self node's position; disconnect on status change; an HTTP error does not stop later heartbeats.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(mesh): sync own device registration and heartbeat to the backend`

### Task 8: Remove the log-parsing path

**Files:**
- Delete: `src/app/shared/meshtastic-parser.service.ts`, `serial-connection.service.ts`, `device-store.service.ts`, `device.service.ts`, `device.model.ts`, `lora-message.service.ts` (if restored). Delete `src/types/web-serial.d.ts` only if the build reports duplicate declarations against `@types/w3c-web-serial`; `tsconfig.app.json` may exclude global types, in which case the local file is still needed.
- Modify: `src/app/dashboard/htit-test/*` — the console now prints `MeshDevice.events.onLogRecord` lines instead of raw serial text, or the component is removed if nothing else uses it
- Modify: `package.json` — remove `socket.io-client`

- [ ] **Step 1: Delete the files and fix every import the compiler reports.**
- [ ] **Step 2: Run** `npx ng test --watch=false --browsers=ChromeHeadless && npx ng build` — Expected: PASS, build succeeds, `grep -r "meshtastic-parser\|socket.io" src` returns nothing.
- [ ] **Step 3: Commit** — `refactor: remove debug-log parser and backend message relay`

### Task 9: Retire the backend `lora` relay (ITCoderNest)

**Files (repo `~/Project/ITCoder/ITCoderNest`, branch from a fresh `master`):**
- Delete: `apps/rest/src/lora/` (module, controller, service, gateway, schema, DTOs, spec)
- Modify: `apps/rest/src/app.module.ts` — drop `LoraModule`

- [ ] **Step 1: Create branch** `git checkout master && git pull && git checkout -b chore/remove-lora-relay`
- [ ] **Step 2: Delete the module and its import.**
- [ ] **Step 3: Run** `npm run test:rest` — Expected: all remaining specs PASS.
- [ ] **Step 4: Commit** — `chore(rest): remove LoRa message relay (WildLink now talks to the mesh directly)`. Do not push or deploy without the owner's go-ahead; the `lora-messages` collection is left in MongoDB.

### Task 10: Field check with three boards (manual)

- [ ] **Step 1:** Flash three boards with the same stock Meshtastic version, same channel; connect one to a laptop running `npx ng serve`.
- [ ] **Step 2:** Walk the other two apart outdoors. Expected: all three nodes on the map with positions and battery; positions refresh at the device broadcast interval.
- [ ] **Step 3:** Send a text from the app and from a second laptop on another board. Expected: received on both sides, no duplicates.
- [ ] **Step 4:** Unplug and replug the head board. Expected: status goes `disconnected` → `connected`, nodes stay on the map.
- [ ] **Step 5:** Record results (firmware version, distances, anything odd) in the spec doc under Roadmap → Phase 1.
