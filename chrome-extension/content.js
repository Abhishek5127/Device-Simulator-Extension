/* global chrome */

const PAGE_SOURCE = "device-simulator-page";
const EXTENSION_SOURCE = "device-simulator-recorder-extension";
const CONTENT_SOURCE = "device-simulator-recorder-content";

const postToPage = (message) => {
  window.postMessage(
    {
      source: EXTENSION_SOURCE,
      ...message,
    },
    window.location.origin,
  );
};

const postRecordingError = (error, fallbackMessage) => {
  postToPage({
    error:
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : fallbackMessage,
    type: "DEVICE_SIM_EXTENSION_RECORDING_ERROR",
  });
};

const sendRecorderMessage = (message, fallbackMessage) => {
  try {
    chrome.runtime.sendMessage(message, (response) => {
      if (!chrome.runtime.lastError) {
        if (response?.ok === false) {
          postRecordingError(response.error, fallbackMessage);
          return;
        }

        if (message.type === "START_RECORDING") {
          postToPage({ type: "DEVICE_SIM_EXTENSION_RECORDING_STARTED" });
        }

        return;
      }

      postRecordingError(chrome.runtime.lastError.message, fallbackMessage);
    });
  } catch (error) {
    postRecordingError(error, fallbackMessage);
  }
};

const getRecordingStagePayload = () => {
  const stage =
    document.querySelector("[data-recording-stage]") ??
    document.querySelector("section");

  if (!stage) {
    throw new Error("Could not find the simulator canvas stage.");
  }

  const rect = stage.getBoundingClientRect();
  const computedStyle = getComputedStyle(stage);
  const stageLeft = Math.max(0, Math.round(rect.left));
  const stageTop = Math.max(0, Math.round(rect.top));
  const stageWidth = Math.max(1, Math.round(rect.width));
  const stageHeight = Math.max(1, Math.round(rect.height));

  return {
    backgroundColor: computedStyle.backgroundColor || "#18181b",
    stageRect: {
      height: stageHeight,
      left: stageLeft,
      top: stageTop,
      width: stageWidth,
    },
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    viewport: {
      height: window.innerHeight,
      width: window.innerWidth,
    },
  };
};

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) {
    return;
  }

  const message = event.data;

  if (message?.source !== PAGE_SOURCE) {
    return;
  }

  if (message.type === "DEVICE_SIM_PING_EXTENSION") {
    postToPage({ type: "DEVICE_SIM_EXTENSION_READY" });
    return;
  }

  if (message.type === "DEVICE_SIM_START_EXTENSION_RECORDING") {
    try {
      sendRecorderMessage(
        {
          source: CONTENT_SOURCE,
          type: "START_RECORDING",
          ...getRecordingStagePayload(),
        },
        "Could not start extension recording.",
      );
    } catch (error) {
      postRecordingError(error, "Could not start extension recording.");
    }

    return;
  }

  if (message.type === "DEVICE_SIM_STOP_EXTENSION_RECORDING") {
    sendRecorderMessage(
      {
        source: CONTENT_SOURCE,
        type: "STOP_RECORDING",
      },
      "Could not stop extension recording.",
    );
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.source !== "device-simulator-recorder-service") {
    return;
  }

  if (message.type === "DEVICE_SIM_GET_RECORDING_STAGE") {
    try {
      sendResponse({
        ok: true,
        payload: getRecordingStagePayload(),
      });
    } catch (error) {
      sendResponse({
        error:
          error instanceof Error
            ? error.message
            : "Could not measure the recording stage.",
        ok: false,
      });
    }
    return true;
  }

  postToPage(message);
  sendResponse({ ok: true });
  return true;
});

postToPage({ type: "DEVICE_SIM_EXTENSION_READY" });
