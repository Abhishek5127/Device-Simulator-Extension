"use client"
import {
  memo,
  Suspense,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls, useGLTF } from "@react-three/drei"
import { MathUtils, MOUSE } from "three";
import type { Group, Material, Mesh, Object3D, Texture } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import DeviceSidebar, { devices } from "./components/deviceSidebar";

const DEFAULT_CAMERA_POSITION: [number, number, number] = [0, 0, 3];
const DEFAULT_CANVAS_BACKGROUND_COLOR = "#18181b";
const DEFAULT_MODEL_ROTATION: [number, number, number] = [0, 0, 0];
const DEFAULT_MODEL_POSITION: [number, number, number] = [0, 0, 0];
const MODEL_ROTATION_DAMPING = 24;
const MODEL_ROTATION_SENSITIVITY = 0.008;
const RECORDING_VIDEO_BITS_PER_SECOND = 16_000_000;
const TEXTURE_KEYS = [
  "map",
  "emissiveMap",
  "roughnessMap",
  "metalnessMap",
  "normalMap",
  "aoMap",
  "alphaMap",
] as const;
const RECORDING_MIME_TYPES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];
type DisplayCaptureConstraints = MediaTrackConstraints & {
  cursor?: "always" | "motion" | "never";
  displaySurface?: "browser" | "window" | "monitor";
  resizeMode?: "none" | "crop-and-scale";
};

type DisplayMediaOptionsWithHints = DisplayMediaStreamOptions & {
  preferCurrentTab?: boolean;
  selfBrowserSurface?: "include" | "exclude";
  surfaceSwitching?: "include" | "exclude";
};

function HandIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12" />
      <path d="M11 12V4.5a1.5 1.5 0 0 1 3 0V12" />
      <path d="M14 12V6.5a1.5 1.5 0 0 1 3 0V13" />
      <path d="M17 13v-2.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-14 0v-2" />
      <path d="M5 11.5 7.5 14" />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </svg>
  );
}

function RecordIcon({ isRecording }: { isRecording: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      {isRecording ? (
        <rect height="10" rx="1.5" width="10" x="7" y="7" />
      ) : (
        <circle cx="12" cy="12" r="6" />
      )}
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function ToolButton({
  active = false,
  children,
  danger = false,
  label,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  danger?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid h-11 w-11 place-items-center rounded-md border transition ${
        active
          ? danger
            ? "border-red-300 bg-red-500 text-white"
            : "border-sky-300 bg-sky-400 text-zinc-950"
          : "border-zinc-800 bg-zinc-950 text-zinc-100 hover:border-zinc-500 hover:bg-zinc-900"
      }`}
    >
      {children}
    </button>
  );
}

const getDeviceViewDefaults = (deviceId: number) => ({
  cameraPosition:
    deviceId === 3
      ? ([0, 0, 2.55] as [number, number, number])
      : DEFAULT_CAMERA_POSITION,
  modelRotation:
    deviceId === 2
      ? ([Math.PI / 2, 0, 0] as [number, number, number])
      : DEFAULT_MODEL_ROTATION,
});

const improveTextureQuality = (scene: Object3D, maxAnisotropy: number) => {
  scene.traverse((object) => {
    const mesh = object as Mesh;

    if (!mesh.isMesh || !mesh.material) {
      return;
    }

    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];

    materials.forEach((material) => {
      TEXTURE_KEYS.forEach((key) => {
        const texture = (material as Material & Record<string, Texture | null>)[
          key
        ];

        if (!texture?.isTexture) {
          return;
        }

        texture.anisotropy = maxAnisotropy;
        texture.needsUpdate = true;
      });
    });
  });
};

function SceneCameraDefaults({
  controlsRef,
  deviceId,
  resetSignal,
}: {
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
  deviceId: number;
  resetSignal: number;
}) {
  const { camera } = useThree();

  useEffect(() => {
    const { cameraPosition } = getDeviceViewDefaults(deviceId);

    camera.position.set(...cameraPosition);
    camera.updateProjectionMatrix();

    if (controlsRef.current) {
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
      controlsRef.current.saveState();
    }
  }, [camera, controlsRef, deviceId, resetSignal]);

  return null;
}

const WebsiteScreen = memo(function WebsiteScreen({
  device,
  websiteUrl,
  isRotateMode,
  onDeviceDragEnd,
  onDeviceDragMove,
  onDeviceDragStart,
  onDeviceHoverEnd,
  onDeviceHoverStart,
}: {
  device: (typeof devices)[number];
  websiteUrl: string;
  isRotateMode: boolean;
  onDeviceDragEnd: () => void;
  onDeviceDragMove: (movementX: number, movementY: number) => void;
  onDeviceDragStart: () => void;
  onDeviceHoverEnd: () => void;
  onDeviceHoverStart: () => void;
}) {
  const { screen } = device;
  const position = screen.position as [number, number, number];
  const rotation = screen.rotation as [number, number, number];
  const isDraggingScreen = useRef(false);

  const stopScreenEvent = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <Html
      transform
      center
      position={position}
      rotation={rotation}
      scale={screen.scale}
      occlude
      zIndexRange={[10, 0]}
    >
      <div
        className="overflow-hidden bg-white"
        style={{
          width: screen.viewport.width,
          height: screen.viewport.height,
          borderRadius: screen.radius,
          backfaceVisibility: "hidden",
          clipPath: `inset(0 round ${screen.radius}px)`,
          contain: "paint",
          isolation: "isolate",
          pointerEvents: "auto",
          transform: "translateZ(0)",
          transformStyle: "preserve-3d",
          willChange: "transform",
        }}
        onPointerDown={(event) => {
          if (!isRotateMode) {
            return;
          }

          stopScreenEvent(event);
          isDraggingScreen.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          onDeviceHoverStart();
          onDeviceDragStart();
        }}
        onPointerEnter={() => {
          if (isRotateMode) {
            onDeviceHoverStart();
          }
        }}
        onPointerLeave={() => {
          if (!isDraggingScreen.current) {
            onDeviceHoverEnd();
          }
        }}
        onPointerMove={(event) => {
          if (!isRotateMode || !isDraggingScreen.current) {
            return;
          }

          stopScreenEvent(event);
          onDeviceDragMove(event.movementX, event.movementY);
        }}
        onPointerUp={(event) => {
          if (!isDraggingScreen.current) {
            return;
          }

          stopScreenEvent(event);
          isDraggingScreen.current = false;
          event.currentTarget.releasePointerCapture(event.pointerId);
          onDeviceDragEnd();
        }}
      >
        <iframe
          key={`${device.id}-${websiteUrl}`}
          title={`${device.name} website preview`}
          src={websiteUrl}
          className="h-full w-full border-0 bg-white"
          loading="eager"
          style={{
            backfaceVisibility: "hidden",
            borderRadius: "inherit",
            clipPath: "inherit",
            display: "block",
            pointerEvents: isRotateMode ? "none" : "auto",
            textRendering: "geometricPrecision",
          }}
        />
      </div>
    </Html>
  );
});

const DeviceModel = memo(function DeviceModel({
  device,
  isDraggingDevice,
  websiteUrl,
  isRotateMode,
  modelPositionOffset,
  resetSignal,
  onDeviceDragEnd,
  onDeviceDragStart,
  onDeviceHoverEnd,
  onDeviceHoverStart,
}: {
  device: (typeof devices)[number];
  isDraggingDevice: boolean;
  websiteUrl: string;
  isRotateMode: boolean;
  modelPositionOffset: [number, number, number];
  resetSignal: number;
  onDeviceDragEnd: () => void;
  onDeviceDragStart: () => void;
  onDeviceHoverEnd: () => void;
  onDeviceHoverStart: () => void;
}) {
  const { scene } = useGLTF(device.modelPath);
  const { gl } = useThree();
  const groupRef = useRef<Group | null>(null);
  const currentRotationRef = useRef<[number, number, number]>([
    ...DEFAULT_MODEL_ROTATION,
  ]);
  const targetRotationRef = useRef<[number, number, number]>([
    ...DEFAULT_MODEL_ROTATION,
  ]);

  const rotateDevice = useCallback((movementX: number, movementY: number) => {
    const targetRotation = targetRotationRef.current;

    targetRotation[0] += movementY * MODEL_ROTATION_SENSITIVITY;
    targetRotation[1] += movementX * MODEL_ROTATION_SENSITIVITY;
  }, []);

  useEffect(() => {
    improveTextureQuality(scene, gl.capabilities.getMaxAnisotropy());
  }, [gl, scene]);

  useLayoutEffect(() => {
    const { modelRotation } = getDeviceViewDefaults(device.id);
    const nextRotation: [number, number, number] = [...modelRotation];

    currentRotationRef.current = [...nextRotation];
    targetRotationRef.current = [...nextRotation];
    groupRef.current?.position.set(...modelPositionOffset);
    groupRef.current?.rotation.set(...nextRotation);
  }, [device.id, modelPositionOffset, resetSignal]);

  useFrame((_, delta) => {
    const group = groupRef.current;

    if (!group) {
      return;
    }

    const currentRotation = currentRotationRef.current;
    const targetRotation = targetRotationRef.current;

    currentRotation[0] = MathUtils.damp(
      currentRotation[0],
      targetRotation[0],
      MODEL_ROTATION_DAMPING,
      delta,
    );
    currentRotation[1] = MathUtils.damp(
      currentRotation[1],
      targetRotation[1],
      MODEL_ROTATION_DAMPING,
      delta,
    );
    currentRotation[2] = MathUtils.damp(
      currentRotation[2],
      targetRotation[2],
      MODEL_ROTATION_DAMPING,
      delta,
    );

    group.rotation.set(
      currentRotation[0],
      currentRotation[1],
      currentRotation[2],
    );
  });

  return (
    <group
      ref={groupRef}
      position={modelPositionOffset}
      scale={device.modelScale}
      onPointerDown={(event) => {
        if (!isRotateMode) {
          return;
        }

        event.stopPropagation();
        (event.target as Element | null)?.setPointerCapture(event.pointerId);
        onDeviceDragStart();
      }}
      onPointerMove={(event) => {
        if (!isRotateMode || !isDraggingDevice) {
          return;
        }

        event.stopPropagation();
        rotateDevice(event.nativeEvent.movementX, event.nativeEvent.movementY);
      }}
      onPointerOut={() => {
        if (!isDraggingDevice) {
          onDeviceHoverEnd();
        }
      }}
      onPointerOver={(event) => {
        if (!isRotateMode) {
          return;
        }

        event.stopPropagation();
        onDeviceHoverStart();
      }}
      onPointerUp={(event) => {
        if (!isDraggingDevice) {
          return;
        }

        event.stopPropagation();
        (event.target as Element | null)?.releasePointerCapture(event.pointerId);
        onDeviceDragEnd();
      }}
    >
      <primitive object={scene} />
      <WebsiteScreen
        device={device}
        websiteUrl={websiteUrl}
        isRotateMode={isRotateMode}
        onDeviceDragEnd={onDeviceDragEnd}
        onDeviceDragMove={rotateDevice}
        onDeviceDragStart={onDeviceDragStart}
        onDeviceHoverEnd={onDeviceHoverEnd}
        onDeviceHoverStart={onDeviceHoverStart}
      />
    </group>
  );
});

export default function Home() {
  const [canvasBackgroundColor, setCanvasBackgroundColor] = useState(
    DEFAULT_CANVAS_BACKGROUND_COLOR,
  );
  const [selectedDevice, setSelectedDevice] = useState(devices[0]);
  const [websiteUrl, setWebsiteUrl] = useState("https://githance.in");
  const [isRotateMode, setIsRotateMode] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [isPointerOnDevice, setIsPointerOnDevice] = useState(false);
  const [isDraggingBackground, setIsDraggingBackground] = useState(false);
  const [isDraggingDevice, setIsDraggingDevice] = useState(false);
  const [modelPositionOffset, setModelPositionOffset] = useState<
    [number, number, number]
  >(DEFAULT_MODEL_POSITION);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const [recordedFileName, setRecordedFileName] = useState(
    "device-simulator-recording.webm",
  );
  const [recordingError, setRecordingError] = useState("");
  const [resetSignal, setResetSignal] = useState(0);
  const captureStreamRef = useRef<MediaStream | null>(null);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);
  const recordedVideoUrlRef = useRef<string | null>(null);
  const controlsEnabled =
    isRotateMode &&
    !isDraggingDevice &&
    (isDraggingBackground || !isPointerOnDevice);

  const stopCaptureStream = () => {
    captureStreamRef.current?.getTracks().forEach((track) => track.stop());
    captureStreamRef.current = null;
  };

  const closeRecordingPreview = () => {
    if (recordedVideoUrlRef.current) {
      URL.revokeObjectURL(recordedVideoUrlRef.current);
      recordedVideoUrlRef.current = null;
    }

    setRecordedVideoUrl(null);
  };

  const getRecordingMimeType = () =>
    RECORDING_MIME_TYPES.find((mimeType) =>
      MediaRecorder.isTypeSupported(mimeType),
    ) ?? "";

  const getLiveRecordingStream = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error("Live screen recording is not available in this browser.");
    }

    const videoConstraints: DisplayCaptureConstraints = {
      cursor: "never",
      displaySurface: "browser",
      frameRate: { ideal: 60, max: 60 },
      height: { ideal: 1080 },
      resizeMode: "none",
      width: { ideal: 1920 },
    };

    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: "include",
      surfaceSwitching: "exclude",
      video: videoConstraints,
    } as DisplayMediaOptionsWithHints);

    const [videoTrack] = stream.getVideoTracks();

    if (videoTrack) {
      videoTrack.contentHint = "motion";

      try {
        await videoTrack.applyConstraints({
          cursor: "never",
          frameRate: { ideal: 60, max: 60 },
          resizeMode: "none",
        } as DisplayCaptureConstraints);
      } catch {
        // Some browsers ignore cursor capture constraints.
      }
    }

    return stream;
  };

  const startRecording = async () => {
    if (isRecording) {
      return;
    }

    if (typeof MediaRecorder === "undefined") {
      setRecordingError("Recording is not available in this browser.");
      return;
    }

    closeRecordingPreview();
    setRecordingError("");
    recordedChunksRef.current = [];

    try {
      const stream = await getLiveRecordingStream();
      const mimeType = getRecordingMimeType();
      const recorderOptions: MediaRecorderOptions = {
        videoBitsPerSecond: RECORDING_VIDEO_BITS_PER_SECOND,
      };

      if (mimeType) {
        recorderOptions.mimeType = mimeType;
      }

      const recorder = new MediaRecorder(stream, recorderOptions);

      captureStreamRef.current = stream;
      mediaRecorderRef.current = recorder;

      stream.getVideoTracks()[0]?.addEventListener(
        "ended",
        () => {
          if (mediaRecorderRef.current?.state === "recording") {
            mediaRecorderRef.current.stop();
            return;
          }

          stopCaptureStream();
          setIsRecording(false);
        },
        { once: true },
      );

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, {
          type: mimeType || "video/webm",
        });
        const videoUrl = URL.createObjectURL(blob);

        stopCaptureStream();
        mediaRecorderRef.current = null;
        setIsRecording(false);

        if (blob.size > 0) {
          recordedVideoUrlRef.current = videoUrl;
          setRecordedVideoUrl(videoUrl);
          setRecordedFileName(
            `device-simulator-${new Date()
              .toISOString()
              .replace(/[:.]/g, "-")}.webm`,
          );
        } else {
          URL.revokeObjectURL(videoUrl);
          setRecordingError("Recording did not capture any video data.");
        }
      };

      recorder.start(1000);
      setIsRecording(true);
    } catch (error) {
      stopCaptureStream();
      mediaRecorderRef.current = null;
      setIsRecording(false);

      if (error instanceof DOMException) {
        setRecordingError(
          error.name === "NotAllowedError"
            ? "Recording needs browser screen capture permission. Select this tab/window to include the live website screen."
            : `Could not start recording: ${error.name}.`,
        );
        return;
      }

      setRecordingError(
        error instanceof Error ? error.message : "Could not start recording.",
      );
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;

    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }

    stopCaptureStream();
    setIsRecording(false);
  };

  useEffect(
    () => () => {
      stopCaptureStream();

      if (recordedVideoUrlRef.current) {
        URL.revokeObjectURL(recordedVideoUrlRef.current);
      }
    },
    [],
  );

  const resetInteractiveView = () => {
    setIsDraggingBackground(false);
    setIsDraggingDevice(false);
    setIsPointerOnDevice(false);
    setModelPositionOffset(DEFAULT_MODEL_POSITION);
    controlsRef.current?.reset();
    setResetSignal((currentSignal) => currentSignal + 1);
  };

  const handleSelectDevice = (device: (typeof devices)[number]) => {
    setSelectedDevice(device);
    setIsDraggingBackground(false);
    setIsDraggingDevice(false);
    setIsPointerOnDevice(false);
    setModelPositionOffset(DEFAULT_MODEL_POSITION);
    setResetSignal((currentSignal) => currentSignal + 1);
  };

  const handleWebsiteChange = (url: string) => {
    setWebsiteUrl(url);
  };

  const handleDeviceDragEnd = useCallback(() => {
    setIsDraggingDevice(false);
  }, []);

  const handleDeviceDragStart = useCallback(() => {
    setIsDraggingBackground(false);
    setIsDraggingDevice(true);
  }, []);

  const handleDeviceHoverEnd = useCallback(() => {
    setIsPointerOnDevice(false);
  }, []);

  const handleDeviceHoverStart = useCallback(() => {
    setIsPointerOnDevice(true);
  }, []);

  return (
    <main className="flex min-h-screen bg-zinc-950">
      <DeviceSidebar
        canvasBackgroundColor={canvasBackgroundColor}
        onCanvasBackgroundColorChange={setCanvasBackgroundColor}
        selectedDeviceId={selectedDevice.id}
        onSelectDevice={handleSelectDevice}
        websiteUrl={websiteUrl}
        onWebsiteChange={handleWebsiteChange}
      />
      <section
        className="relative h-screen flex-1"
        style={{ backgroundColor: canvasBackgroundColor }}
      >
        <Canvas
          camera={{ position: DEFAULT_CAMERA_POSITION, fov: 45 }}
          dpr={[1, 2]}
          gl={{
            alpha: false,
            antialias: true,
            depth: true,
            powerPreference: "high-performance",
            stencil: false,
          }}
          onPointerDown={() => {
            if (isRotateMode && !isPointerOnDevice) {
              setIsDraggingBackground(true);
              setIsDraggingDevice(false);
            }
          }}
          onPointerLeave={() => {
            setIsDraggingBackground(false);
            setIsDraggingDevice(false);
            setIsPointerOnDevice(false);
          }}
          onPointerUp={() => {
            setIsDraggingBackground(false);
            setIsDraggingDevice(false);
          }}
        >
          <color attach="background" args={[canvasBackgroundColor]} />
          <ambientLight intensity={1.25} />
          <directionalLight position={[3, 4, 5]} intensity={2} />
          <directionalLight position={[-4, 2, -3]} intensity={0.8} />
          <SceneCameraDefaults
            controlsRef={controlsRef}
            deviceId={selectedDevice.id}
            resetSignal={resetSignal}
          />

          <Suspense fallback={null}>
            <DeviceModel
              key={selectedDevice.modelPath}
              device={selectedDevice}
              isDraggingDevice={isDraggingDevice}
              websiteUrl={websiteUrl}
              isRotateMode={isRotateMode}
              modelPositionOffset={modelPositionOffset}
              resetSignal={resetSignal}
              onDeviceDragEnd={handleDeviceDragEnd}
              onDeviceDragStart={handleDeviceDragStart}
              onDeviceHoverEnd={handleDeviceHoverEnd}
              onDeviceHoverStart={handleDeviceHoverStart}
            />
          </Suspense>
          <OrbitControls
            ref={controlsRef}
            makeDefault
            enableDamping
            enablePan
            enableRotate={false}
            enabled={controlsEnabled}
            mouseButtons={{
              LEFT: MOUSE.PAN,
              MIDDLE: MOUSE.DOLLY,
              RIGHT: MOUSE.PAN,
            }}
            panSpeed={1.1}
            screenSpacePanning
          />
        </Canvas>
      </section>
      <aside className="flex h-screen w-16 shrink-0 flex-col items-center gap-3 border-l border-zinc-800 bg-zinc-950 py-4 text-zinc-100">
        <ToolButton
          active={isRotateMode}
          label={isRotateMode ? "Rotation mode" : "Website interaction mode"}
          onClick={() => setIsRotateMode((currentMode) => !currentMode)}
        >
          <HandIcon />
        </ToolButton>
        <ToolButton label="Reset view" onClick={resetInteractiveView}>
          <ResetIcon />
        </ToolButton>
        <ToolButton
          active={isRecording}
          danger={isRecording}
          label={isRecording ? "Stop recording" : "Start recording"}
          onClick={isRecording ? stopRecording : startRecording}
        >
          <RecordIcon isRecording={isRecording} />
        </ToolButton>
      </aside>
      {recordingError ? (
        <div
          role="alert"
          className="fixed bottom-5 right-20 z-40 max-w-sm rounded-md border border-red-500/60 bg-red-950 px-4 py-3 text-sm text-red-100"
        >
          {recordingError}
        </div>
      ) : null}
      {recordedVideoUrl ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6">
          <div className="w-full max-w-3xl rounded-md border border-zinc-800 bg-zinc-950 p-4 text-zinc-100 shadow-2xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
                Recording Preview
              </h2>
              <button
                type="button"
                aria-label="Close preview"
                title="Close preview"
                onClick={closeRecordingPreview}
                className="grid h-9 w-9 place-items-center rounded-md border border-zinc-800 bg-zinc-950 text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-900"
              >
                <CloseIcon />
              </button>
            </div>
            <video
              className="aspect-video w-full rounded-md bg-black"
              controls
              src={recordedVideoUrl}
            />
            <div className="mt-4 flex justify-end">
              <a
                aria-label="Download recording"
                title="Download recording"
                href={recordedVideoUrl}
                download={recordedFileName}
                className="grid h-11 w-11 place-items-center rounded-md border border-sky-300 bg-sky-400 text-zinc-950 transition hover:bg-sky-300"
              >
                <DownloadIcon />
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
