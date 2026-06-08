"use client";

/**
 * Client bridge to the Device Simulator browser extension.
 *
 * The extension projects a real, logged-in browser tab onto the device screen:
 * the captured tab's live MediaStream is delivered here over a local WebRTC
 * loopback (the page is the answerer), and normalized pointer/keyboard events
 * from the device screen are sent back to be replayed into the real tab.
 *
 * All page <-> extension traffic goes through `window.postMessage` to the
 * extension's content script (see `chrome-extension/content.js`).
 */

const PAGE_SOURCE = "device-simulator-page";
const EXTENSION_SOURCE = "device-simulator-recorder-extension";

export type CaptureStatus = "idle" | "connecting" | "live" | "error";

export type CaptureTab = {
  favIconUrl?: string;
  id: number;
  title?: string;
  url?: string;
};

export type CaptureViewport = { height: number; width: number };

export type CaptureInput = {
  button?: number;
  clickCount?: number;
  code?: string;
  deltaX?: number;
  deltaY?: number;
  key?: string;
  keyCode?: number;
  kind: "move" | "down" | "up" | "wheel" | "keydown" | "keyup";
  modifiers?: number;
  text?: string;
  // Pointer position in surface UV space (0..1). Absent for keyboard events.
  u?: number;
  v?: number;
};

type CaptureSignal =
  | { description: RTCSessionDescriptionInit; kind: "sdp" }
  | { candidate: RTCIceCandidateInit; kind: "ice" };

type BridgeEventMap = {
  availability: boolean;
  error: string;
  status: CaptureStatus;
  stream: MediaStream | null;
  viewport: CaptureViewport | null;
};

type Listener<Key extends keyof BridgeEventMap> = (
  value: BridgeEventMap[Key],
) => void;

class ExtensionBridge {
  private available = false;
  private initialized = false;
  private peer: RTCPeerConnection | null = null;
  private requestId = 0;
  private readonly pending = new Map<
    number,
    (response: Record<string, unknown>) => void
  >();
  private readonly listeners: {
    [Key in keyof BridgeEventMap]: Set<Listener<Key>>;
  } = {
    availability: new Set(),
    error: new Set(),
    status: new Set(),
    stream: new Set(),
    viewport: new Set(),
  };

  init() {
    if (this.initialized || typeof window === "undefined") {
      return;
    }

    this.initialized = true;
    window.addEventListener("message", this.handleMessage);
    this.post({ type: "DEVICE_SIM_PING_EXTENSION" });
  }

  isAvailable() {
    return this.available;
  }

  on<Key extends keyof BridgeEventMap>(event: Key, listener: Listener<Key>) {
    this.listeners[event].add(listener);

    return () => {
      this.listeners[event].delete(listener);
    };
  }

  async startCapture(target: {
    height?: number;
    tabId?: number;
    url?: string;
    width?: number;
  }) {
    this.resetPeer();
    this.emit("status", "connecting");
    this.emit("error", "");

    const response = await this.request({
      height: target.height,
      tabId: target.tabId,
      type: "DEVICE_SIM_START_CAPTURE",
      url: target.url,
      width: target.width,
    });

    if (!response.ok) {
      this.emit("status", "error");

      const message =
        typeof response.error === "string"
          ? response.error
          : "Could not start tab capture.";

      this.emit("error", message);
      return { error: message, ok: false as const };
    }

    return {
      ok: true as const,
      tabId: typeof response.tabId === "number" ? response.tabId : undefined,
    };
  }

  async stopCapture() {
    this.resetPeer();
    this.emit("stream", null);
    this.emit("viewport", null);
    this.emit("status", "idle");
    await this.request({ type: "DEVICE_SIM_STOP_CAPTURE" });
  }

  async listTabs(): Promise<CaptureTab[]> {
    const response = await this.request({ type: "DEVICE_SIM_LIST_TABS" });

    return Array.isArray(response.tabs) ? (response.tabs as CaptureTab[]) : [];
  }

  sendInput(input: CaptureInput) {
    this.post({ input, type: "DEVICE_SIM_INPUT" });
  }

  private readonly handleMessage = (event: MessageEvent) => {
    if (event.source !== window) {
      return;
    }

    const message = event.data as Record<string, unknown> | null;

    if (!message || message.source !== EXTENSION_SOURCE) {
      return;
    }

    const type = message.type as string;

    if (type === "DEVICE_SIM_EXTENSION_READY") {
      if (!this.available) {
        this.available = true;
        this.emit("availability", true);
      }
      return;
    }

    if (
      type === "DEVICE_SIM_CAPTURE_RESULT" ||
      type === "DEVICE_SIM_TABS_RESULT"
    ) {
      const resolver =
        typeof message.requestId === "number"
          ? this.pending.get(message.requestId)
          : undefined;

      if (resolver && typeof message.requestId === "number") {
        this.pending.delete(message.requestId);
        resolver(message);
      }
      return;
    }

    if (type === "DEVICE_SIM_CAPTURE_SIGNAL") {
      void this.handleSignal(message.signal as CaptureSignal);
      return;
    }

    if (type === "DEVICE_SIM_CAPTURE_STATUS") {
      const status = message.status as CaptureStatus;

      if (message.viewport) {
        this.emit("viewport", message.viewport as CaptureViewport);
      }

      this.emit("status", status ?? "idle");
      return;
    }

    if (type === "DEVICE_SIM_CAPTURE_ERROR") {
      this.emit("status", "error");
      this.emit(
        "error",
        typeof message.error === "string" ? message.error : "Capture failed.",
      );
      this.resetPeer();
      this.emit("stream", null);
    }
  };

  private async handleSignal(signal: CaptureSignal | undefined) {
    if (!signal) {
      return;
    }

    if (signal.kind === "sdp") {
      const peer = this.ensurePeer();

      try {
        await peer.setRemoteDescription(signal.description);

        if (signal.description.type === "offer") {
          const answer = await peer.createAnswer();

          await peer.setLocalDescription(answer);
          this.post({
            signal: {
              description: { sdp: answer.sdp, type: answer.type },
              kind: "sdp",
            },
            type: "DEVICE_SIM_CAPTURE_SIGNAL",
          });
        }
      } catch {
        // A stale offer can arrive after teardown; ignore.
      }
      return;
    }

    if (signal.kind === "ice" && this.peer) {
      try {
        await this.peer.addIceCandidate(signal.candidate);
      } catch {
        // Candidates may arrive before the remote description; safe to drop.
      }
    }
  }

  private ensurePeer() {
    if (this.peer) {
      return this.peer;
    }

    const peer = new RTCPeerConnection();

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        this.post({
          signal: { candidate: event.candidate.toJSON(), kind: "ice" },
          type: "DEVICE_SIM_CAPTURE_SIGNAL",
        });
      }
    };

    peer.ontrack = (event) => {
      const [stream] = event.streams;

      if (stream) {
        this.emit("stream", stream);
      }
    };

    this.peer = peer;
    return peer;
  }

  private resetPeer() {
    if (this.peer) {
      this.peer.onicecandidate = null;
      this.peer.ontrack = null;
      this.peer.close();
      this.peer = null;
    }
  }

  private request(
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (typeof window === "undefined") {
      return Promise.resolve({ ok: false });
    }

    this.requestId += 1;
    const requestId = this.requestId;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.has(requestId)) {
          this.pending.delete(requestId);
          resolve({ error: "The extension did not respond.", ok: false });
        }
      }, 30000);

      this.pending.set(requestId, (response) => {
        clearTimeout(timer);
        resolve(response);
      });

      this.post({ ...payload, requestId });
    });
  }

  private post(payload: Record<string, unknown>) {
    if (typeof window === "undefined") {
      return;
    }

    window.postMessage(
      { ...payload, source: PAGE_SOURCE },
      window.location.origin,
    );
  }

  private emit<Key extends keyof BridgeEventMap>(
    event: Key,
    value: BridgeEventMap[Key],
  ) {
    this.listeners[event].forEach((listener) => listener(value));
  }
}

export const extensionBridge = new ExtensionBridge();
