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
      "Encodes the local Device Simulator recording in a hidden canvas.",
    reasons: ["BLOBS"],
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.source === OFFSCREEN_SOURCE) {
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
});
