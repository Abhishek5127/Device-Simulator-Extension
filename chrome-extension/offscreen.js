/* global chrome */

const SERVICE_SOURCE = "device-simulator-recorder-service";
const OFFSCREEN_SOURCE = "device-simulator-recorder-offscreen";
const MAX_RECORDING_WIDTH = 1920;
const MAX_RECORDING_HEIGHT = 1080;
const RECORDING_BITS_PER_SECOND = 16_000_000;
const DEFAULT_RECORDING_FPS = 24;
const FINAL_VIDEO_CHUNK_SIZE = 192 * 1024;
const RECORDING_MIME_TYPES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

let canvas = null;
let context = null;
let mediaRecorder = null;
let outputStream = null;
let recordedChunks = [];
let activeMimeType = "";
let activeStageRect = null;
let activeViewport = null;
let activeBackgroundColor = "#18181b";
let pendingFrameDataUrl = null;
let isDrawingFrame = false;

const getRecordingMimeType = () =>
  RECORDING_MIME_TYPES.find((mimeType) =>
    MediaRecorder.isTypeSupported(mimeType),
  ) ?? "";

const sendToService = (message) =>
  new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        source: OFFSCREEN_SOURCE,
        ...message,
      },
      () => {
        resolve(!chrome.runtime.lastError);
      },
    );
  });

const stopTracks = (stream) => {
  stream?.getTracks().forEach((track) => track.stop());
};

const discardRecorder = () => {
  if (!mediaRecorder) {
    return;
  }

  if (mediaRecorder.state !== "inactive") {
    mediaRecorder.ondataavailable = null;
    mediaRecorder.onstop = null;
    mediaRecorder.stop();
  }

  mediaRecorder = null;
};

const resetFrameState = () => {
  pendingFrameDataUrl = null;
  isDrawingFrame = false;
};

const cleanup = () => {
  resetFrameState();
  discardRecorder();
  stopTracks(outputStream);
  outputStream = null;
  canvas = null;
  context = null;
  activeStageRect = null;
  activeViewport = null;
};

const getOutputSize = (stageRect, pixelRatio = 1) => {
  const rawWidth = Math.max(2, Math.round(stageRect.width * pixelRatio));
  const rawHeight = Math.max(2, Math.round(stageRect.height * pixelRatio));
  const fitScale = Math.min(
    1,
    MAX_RECORDING_WIDTH / rawWidth,
    MAX_RECORDING_HEIGHT / rawHeight,
  );

  return {
    height: Math.max(2, Math.round(rawHeight * fitScale)),
    width: Math.max(2, Math.round(rawWidth * fitScale)),
  };
};

const readBlobAsDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(reader.error);
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });

const sendChunkedRecording = async (blob) => {
  const dataUrl = await readBlobAsDataUrl(blob);
  const transferId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const totalChunks = Math.ceil(dataUrl.length / FINAL_VIDEO_CHUNK_SIZE);
  const fileName = `device-simulator-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}.webm`;

  await sendToService({
    fileName,
    totalChunks,
    transferId,
    type: "DEVICE_SIM_EXTENSION_RECORDING_TRANSFER_START",
  });

  for (let index = 0; index < totalChunks; index += 1) {
    await sendToService({
      chunk: dataUrl.slice(
        index * FINAL_VIDEO_CHUNK_SIZE,
        (index + 1) * FINAL_VIDEO_CHUNK_SIZE,
      ),
      index,
      transferId,
      type: "DEVICE_SIM_EXTENSION_RECORDING_TRANSFER_CHUNK",
    });
  }

  await sendToService({
    fileName,
    totalChunks,
    transferId,
    type: "DEVICE_SIM_EXTENSION_RECORDING_TRANSFER_END",
  });
};

const getFrameBlob = async (dataUrl) => {
  const response = await fetch(dataUrl);

  return response.blob();
};

const drawFrameBitmap = (bitmap) => {
  if (!context || !canvas || !activeStageRect || !activeViewport) {
    return;
  }

  const scaleX = bitmap.width / activeViewport.width;
  const scaleY = bitmap.height / activeViewport.height;
  const sourceX = Math.max(0, activeStageRect.left * scaleX);
  const sourceY = Math.max(0, activeStageRect.top * scaleY);
  const sourceWidth = Math.min(
    bitmap.width - sourceX,
    activeStageRect.width * scaleX,
  );
  const sourceHeight = Math.min(
    bitmap.height - sourceY,
    activeStageRect.height * scaleY,
  );

  context.fillStyle = activeBackgroundColor;
  context.fillRect(0, 0, canvas.width, canvas.height);

  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return;
  }

  context.drawImage(
    bitmap,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );
};

const drawQueuedFrames = async () => {
  if (isDrawingFrame) {
    return;
  }

  isDrawingFrame = true;

  while (pendingFrameDataUrl) {
    const frameDataUrl = pendingFrameDataUrl;

    pendingFrameDataUrl = null;

    try {
      const frameBlob = await getFrameBlob(frameDataUrl);
      const bitmap = await createImageBitmap(frameBlob);

      drawFrameBitmap(bitmap);
      bitmap.close();
    } catch {
      // Dropping a bad frame is better than stalling the recording.
    }
  }

  isDrawingFrame = false;
};

const queueFrame = (dataUrl) => {
  pendingFrameDataUrl = dataUrl;
  void drawQueuedFrames();
};

const startRecording = ({
  backgroundColor,
  fps,
  pixelRatio,
  stageRect,
  viewport,
}) => {
  cleanup();
  recordedChunks = [];
  activeMimeType = getRecordingMimeType();
  activeStageRect = stageRect;
  activeViewport = viewport;
  activeBackgroundColor = backgroundColor || "#18181b";

  if (!stageRect || !viewport) {
    throw new Error("Recorder did not receive the simulator stage bounds.");
  }

  const { height, width } = getOutputSize(stageRect, pixelRatio);

  canvas = document.createElement("canvas");
  canvas.height = height;
  canvas.width = width;
  context = canvas.getContext("2d", {
    alpha: false,
    desynchronized: true,
  });

  if (!context) {
    throw new Error("Could not create extension recording canvas.");
  }

  context.fillStyle = activeBackgroundColor;
  context.fillRect(0, 0, width, height);

  outputStream = canvas.captureStream(fps || DEFAULT_RECORDING_FPS);

  const [outputTrack] = outputStream.getVideoTracks();

  if (outputTrack) {
    outputTrack.contentHint = "motion";
  }

  const recorderOptions = {
    videoBitsPerSecond: RECORDING_BITS_PER_SECOND,
  };

  if (activeMimeType) {
    recorderOptions.mimeType = activeMimeType;
  }

  mediaRecorder = new MediaRecorder(outputStream, recorderOptions);

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  mediaRecorder.onstop = async () => {
    const blob = new Blob(recordedChunks, {
      type: activeMimeType || "video/webm",
    });

    cleanup();
    mediaRecorder = null;

    if (!blob.size) {
      void sendToService({
        error: "Recording did not capture any video data.",
        type: "DEVICE_SIM_EXTENSION_RECORDING_ERROR",
      });
      return;
    }

    try {
      await sendChunkedRecording(blob);
    } catch {
      void sendToService({
        error: "Could not prepare the recording preview.",
        type: "DEVICE_SIM_EXTENSION_RECORDING_ERROR",
      });
    }
  };

  mediaRecorder.start(500);
  void sendToService({ type: "DEVICE_SIM_EXTENSION_RECORDING_STARTED" });
};

const stopRecording = () => {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
    return;
  }

  cleanup();
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.source !== SERVICE_SOURCE) {
    return;
  }

  if (message.type === "START_RECORDING") {
    try {
      startRecording(message);
      sendResponse({ ok: true });
    } catch (error) {
      cleanup();
      sendResponse({
        error:
          error instanceof Error
            ? error.message
            : "Could not start extension recording.",
        ok: false,
      });
    }
    return true;
  }

  if (message.type === "DRAW_FRAME") {
    if (message.dataUrl) {
      queueFrame(message.dataUrl);
    }

    return;
  }

  if (message.type === "STOP_RECORDING") {
    sendResponse({ ok: true });
    stopRecording();
    return true;
  }
});
