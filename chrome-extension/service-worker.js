/* global chrome */

const CONTENT_SOURCE = "device-simulator-recorder-content";
const OFFSCREEN_SOURCE = "device-simulator-recorder-offscreen";
const SERVICE_SOURCE = "device-simulator-recorder-service";
const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
const OFFSCREEN_BOOT_DELAY_MS = 100;
const CAPTURE_FPS = 24;
const CAPTURE_INTERVAL_MS = Math.round(1000 / CAPTURE_FPS);
const SCREENSHOT_QUALITY = 92;

let activeTabId = null;
let activeWindowId = null;
let captureTimerId = null;
let hasDeliveredFrame = false;
let isCaptureInFlight = false;
let isStoppingRecording = false;

const getOffscreenUrl = () => chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);

const wait = (delay) =>
  new Promise((resolve) => {
    setTimeout(resolve, delay);
  });

const getErrorMessage = (error, fallbackMessage) =>
  error instanceof Error ? error.message : fallbackMessage;

const ensureOffscreenDocument = async () => {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [getOffscreenUrl()],
  });

  if (existingContexts.length > 0) {
    return;
  }

  await chrome.offscreen.createDocument({
    justification:
      "Encodes the local Device Simulator recording and relays the live tab capture stream.",
    reasons: ["USER_MEDIA", "BLOBS"],
    url: OFFSCREEN_DOCUMENT_PATH,
  });
  await wait(OFFSCREEN_BOOT_DELAY_MS);
};

const sendToActiveTab = (message) => {
  if (!activeTabId) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      activeTabId,
      {
        ...message,
        source: SERVICE_SOURCE,
      },
      () => {
        resolve(!chrome.runtime.lastError);
      },
    );
  });
};

const sendToOffscreen = (message) =>
  new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (response?.ok === false) {
        reject(new Error(response.error ?? "Offscreen recorder failed."));
        return;
      }

      resolve(response);
    });
  });

const postToOffscreen = (message) => {
  chrome.runtime.sendMessage(message);
};

const captureVisibleFrame = (windowId) =>
  new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(
      windowId,
      {
        format: "jpeg",
        quality: SCREENSHOT_QUALITY,
      },
      (dataUrl) => {
        if (chrome.runtime.lastError || !dataUrl) {
          reject(
            new Error(
              chrome.runtime.lastError?.message ??
                "Chrome did not return screenshot frame data.",
            ),
          );
          return;
        }

        resolve(dataUrl);
      },
    );
  });

const clearCaptureTimer = () => {
  if (captureTimerId) {
    clearTimeout(captureTimerId);
    captureTimerId = null;
  }
};

const resetCaptureState = () => {
  clearCaptureTimer();
  activeWindowId = null;
  hasDeliveredFrame = false;
  isCaptureInFlight = false;
  isStoppingRecording = false;
};

const sendRecordingError = async (message) => {
  await sendToActiveTab({
    error: message,
    type: "DEVICE_SIM_EXTENSION_RECORDING_ERROR",
  }).catch(() => {});

  try {
    await sendToOffscreen({
      source: SERVICE_SOURCE,
      type: "STOP_RECORDING",
    });
  } catch {
    // The offscreen recorder may already be closed or inactive.
  }

  resetCaptureState();
};

const captureFrame = async () => {
  if (!activeWindowId || isCaptureInFlight || isStoppingRecording) {
    return;
  }

  isCaptureInFlight = true;

  try {
    const dataUrl = await captureVisibleFrame(activeWindowId);

    hasDeliveredFrame = true;
    postToOffscreen({
      dataUrl,
      source: SERVICE_SOURCE,
      type: "DRAW_FRAME",
    });
  } catch (error) {
    if (!isStoppingRecording) {
      await sendRecordingError(
        getErrorMessage(error, "Could not capture the simulator frame."),
      );
    }
  } finally {
    isCaptureInFlight = false;
  }
};

const scheduleNextCapture = () => {
  clearCaptureTimer();

  if (!activeWindowId || isStoppingRecording) {
    return;
  }

  captureTimerId = setTimeout(async () => {
    await captureFrame();
    scheduleNextCapture();
  }, CAPTURE_INTERVAL_MS);
};

const startCaptureLoop = () => {
  void captureFrame();
  scheduleNextCapture();
};

const startRecording = async (message, sender) => {
  const tabId = sender.tab?.id;
  const windowId = sender.tab?.windowId;

  if (!tabId || typeof windowId !== "number") {
    throw new Error("Could not find the simulator tab.");
  }

  resetCaptureState();
  activeTabId = tabId;
  activeWindowId = windowId;

  await ensureOffscreenDocument();
  await sendToOffscreen({
    backgroundColor: message.backgroundColor,
    fps: CAPTURE_FPS,
    pixelRatio: message.pixelRatio,
    source: SERVICE_SOURCE,
    stageRect: message.stageRect,
    type: "START_RECORDING",
    viewport: message.viewport,
  });

  await sendToActiveTab({
    type: "DEVICE_SIM_EXTENSION_RECORDING_STARTED",
  });
  startCaptureLoop();
};

const stopRecording = async () => {
  isStoppingRecording = true;
  clearCaptureTimer();

  if (!hasDeliveredFrame) {
    await sendRecordingError("Recording stopped before any video frame was captured.");
    return;
  }

  await sendToOffscreen({
    source: SERVICE_SOURCE,
    type: "STOP_RECORDING",
  });
  resetCaptureState();
};

/* ----------------------------------------------------------------------------
 * Live tab capture + interactivity
 *
 * Projects a real, logged-in browser tab onto the simulator's device screen:
 *   - getMediaStreamId(targetTab) -> offscreen getUserMedia -> WebRTC -> page
 *   - normalized pointer/key events from the device screen are replayed into the
 *     real tab through the DevTools protocol (chrome.debugger).
 * ------------------------------------------------------------------------- */

const CAPTURE_DEBUGGER_VERSION = "1.3";
const CAPTURE_MOUSE_BUTTONS = ["left", "middle", "right"];

let simulatorTabId = null;
let captureTabId = null;
let captureWindowId = null; // set only when WE opened the tab (so we may close it)
let captureViewport = null;
let isDebuggerAttached = false;

const clamp01 = (value) => Math.max(0, Math.min(1, value));

const pushToSimulator = (message) => {
  if (simulatorTabId == null) {
    return;
  }

  chrome.tabs.sendMessage(
    simulatorTabId,
    { ...message, source: SERVICE_SOURCE },
    () => {
      void chrome.runtime.lastError;
    },
  );
};

const waitForTabComplete = (tabId, timeoutMs = 20000) =>
  new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve();
    };

    const onUpdated = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === "complete") {
        finish();
      }
    };

    // A partially-loaded page still captures fine, so resolve on timeout too.
    const timer = setTimeout(finish, timeoutMs);

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        finish();
        return;
      }

      if (tab && tab.status === "complete") {
        finish();
      }
    });
  });

const getMediaStreamId = (targetTabId) =>
  new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId }, (streamId) => {
      if (chrome.runtime.lastError || !streamId) {
        reject(
          new Error(
            chrome.runtime.lastError?.message ??
              "Chrome did not return a capture stream id.",
          ),
        );
        return;
      }

      resolve(streamId);
    });
  });

const detachCaptureDebugger = () =>
  new Promise((resolve) => {
    if (!isDebuggerAttached || captureTabId == null) {
      isDebuggerAttached = false;
      resolve();
      return;
    }

    chrome.debugger.detach({ tabId: captureTabId }, () => {
      void chrome.runtime.lastError;
      isDebuggerAttached = false;
      resolve();
    });
  });

const stopCapture = async () => {
  await detachCaptureDebugger();

  try {
    await sendToOffscreen({ source: SERVICE_SOURCE, type: "STOP_CAPTURE" });
  } catch {
    // The offscreen document may already be gone.
  }

  if (captureWindowId != null) {
    chrome.windows.remove(captureWindowId, () => {
      void chrome.runtime.lastError;
    });
  }

  captureWindowId = null;
  captureTabId = null;
  captureViewport = null;
};

const startCapture = async (message, sender) => {
  simulatorTabId = sender.tab?.id ?? simulatorTabId;
  const simulatorWindowId = sender.tab?.windowId ?? null;

  await stopCapture();

  let targetTabId = message.tabId ?? null;

  if (targetTabId == null) {
    if (!message.url) {
      throw new Error("Provide a URL or a tab to project.");
    }

    // Open the site in the user's normal profile so existing logins apply.
    // Sized to the device viewport (when provided) so the page lays itself out
    // at the device's resolution; a popup keeps browser chrome minimal so the
    // captured frame closely matches the device screen.
    const requestedWidth =
      typeof message.width === "number"
        ? Math.max(320, Math.min(2560, Math.round(message.width)))
        : undefined;
    const requestedHeight =
      typeof message.height === "number"
        ? Math.max(320, Math.min(1600, Math.round(message.height)))
        : undefined;

    const createdWindow = await chrome.windows.create({
      focused: true,
      height: requestedHeight,
      type: "popup",
      url: message.url,
      width: requestedWidth,
    });

    captureWindowId = createdWindow.id ?? null;
    targetTabId = createdWindow.tabs?.[0]?.id ?? null;

    if (targetTabId == null) {
      throw new Error("Could not open the capture tab.");
    }

    await waitForTabComplete(targetTabId);
  }

  captureTabId = targetTabId;
  pushToSimulator({ status: "connecting", type: "DEVICE_SIM_CAPTURE_STATUS" });

  const streamId = await getMediaStreamId(targetTabId);

  await ensureOffscreenDocument();
  await sendToOffscreen({
    source: SERVICE_SOURCE,
    streamId,
    type: "START_CAPTURE",
  });

  // Return the user to the studio window.
  if (simulatorWindowId != null) {
    chrome.windows.update(simulatorWindowId, { focused: true }, () => {
      void chrome.runtime.lastError;
    });
  }

  return { tabId: targetTabId };
};

const ensureCaptureDebugger = () =>
  new Promise((resolve, reject) => {
    if (isDebuggerAttached) {
      resolve();
      return;
    }

    if (captureTabId == null) {
      reject(new Error("No captured tab to interact with."));
      return;
    }

    chrome.debugger.attach(
      { tabId: captureTabId },
      CAPTURE_DEBUGGER_VERSION,
      () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        isDebuggerAttached = true;
        resolve();
      },
    );
  });

const sendDebuggerCommand = (method, params) =>
  new Promise((resolve) => {
    if (captureTabId == null) {
      resolve();
      return;
    }

    chrome.debugger.sendCommand({ tabId: captureTabId }, method, params, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });

const forwardInput = async (input) => {
  if (!input || captureTabId == null || !captureViewport) {
    return;
  }

  try {
    await ensureCaptureDebugger();
  } catch {
    return;
  }

  const x = Math.round(clamp01(input.u) * captureViewport.width);
  const y = Math.round(clamp01(input.v) * captureViewport.height);
  const modifiers = input.modifiers ?? 0;

  if (input.kind === "move" || input.kind === "down" || input.kind === "up") {
    const type =
      input.kind === "move"
        ? "mouseMoved"
        : input.kind === "down"
          ? "mousePressed"
          : "mouseReleased";
    const isPress = input.kind !== "move";
    const button = isPress
      ? CAPTURE_MOUSE_BUTTONS[input.button ?? 0] ?? "left"
      : "none";

    await sendDebuggerCommand("Input.dispatchMouseEvent", {
      button,
      buttons: isPress ? (input.button ?? 0) + 1 : 0,
      clickCount: isPress ? input.clickCount ?? 1 : 0,
      modifiers,
      type,
      x,
      y,
    });
    return;
  }

  if (input.kind === "wheel") {
    await sendDebuggerCommand("Input.dispatchMouseEvent", {
      deltaX: input.deltaX ?? 0,
      deltaY: input.deltaY ?? 0,
      modifiers,
      type: "mouseWheel",
      x,
      y,
    });
    return;
  }

  if (input.kind === "keydown" || input.kind === "keyup") {
    await sendDebuggerCommand("Input.dispatchKeyEvent", {
      code: input.code,
      key: input.key,
      modifiers,
      text: input.kind === "keydown" ? input.text : undefined,
      type: input.kind === "keydown" ? "keyDown" : "keyUp",
      windowsVirtualKeyCode: input.keyCode,
    });
  }
};

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId === captureTabId) {
    isDebuggerAttached = false;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === captureTabId) {
    // The captured tab is gone; tear down without re-closing its window.
    captureWindowId = null;
    void stopCapture();
    pushToSimulator({ status: "idle", type: "DEVICE_SIM_CAPTURE_STATUS" });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.source === OFFSCREEN_SOURCE) {
    if (message.type === "CAPTURE_SIGNAL") {
      pushToSimulator({
        signal: message.signal,
        type: "DEVICE_SIM_CAPTURE_SIGNAL",
      });
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === "CAPTURE_READY") {
      captureViewport = message.viewport ?? null;
      pushToSimulator({
        status: "live",
        type: "DEVICE_SIM_CAPTURE_STATUS",
        viewport: message.viewport,
      });
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === "CAPTURE_ERROR") {
      pushToSimulator({ error: message.error, type: "DEVICE_SIM_CAPTURE_ERROR" });
      void stopCapture();
      sendResponse({ ok: true });
      return true;
    }

    sendToActiveTab(message).finally(() => {
      if (
        message.type === "DEVICE_SIM_EXTENSION_RECORDING_ERROR" ||
        message.type === "DEVICE_SIM_EXTENSION_RECORDING_TRANSFER_END"
      ) {
        activeTabId = null;
        resetCaptureState();
      }

      sendResponse({ ok: true });
    });
    return true;
  }

  if (message?.source !== CONTENT_SOURCE) {
    return;
  }

  simulatorTabId = sender.tab?.id ?? simulatorTabId;

  if (message.type === "START_RECORDING") {
    startRecording(message, sender)
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        const errorMessage = getErrorMessage(
          error,
          "Could not start extension recording.",
        );

        resetCaptureState();
        sendResponse({ error: errorMessage, ok: false });
      });
    return true;
  }

  if (message.type === "STOP_RECORDING") {
    stopRecording()
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        sendResponse({
          error: getErrorMessage(error, "Could not stop extension recording."),
          ok: false,
        });
      });
    return true;
  }

  if (message.type === "START_CAPTURE") {
    startCapture(message, sender)
      .then((result) => {
        sendResponse({ ok: true, ...result });
      })
      .catch((error) => {
        void stopCapture();
        pushToSimulator({ status: "idle", type: "DEVICE_SIM_CAPTURE_STATUS" });
        sendResponse({
          error: getErrorMessage(error, "Could not start tab capture."),
          ok: false,
        });
      });
    return true;
  }

  if (message.type === "STOP_CAPTURE") {
    stopCapture()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "LIST_TABS") {
    chrome.tabs.query({}, (tabs) => {
      const list = (tabs ?? [])
        .filter(
          (tab) => tab.id != null && /^https?:/i.test(tab.url ?? ""),
        )
        .map((tab) => ({
          favIconUrl: tab.favIconUrl,
          id: tab.id,
          title: tab.title,
          url: tab.url,
        }));

      sendResponse({ ok: true, tabs: list });
    });
    return true;
  }

  if (message.type === "CAPTURE_SIGNAL") {
    sendToOffscreen({
      signal: message.signal,
      source: SERVICE_SOURCE,
      type: "CAPTURE_SIGNAL",
    }).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "INPUT") {
    void forwardInput(message.input);
    sendResponse({ ok: true });
    return true;
  }
});
