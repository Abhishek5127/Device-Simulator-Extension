"use client"
import {
  memo,
  Suspense,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls, useGLTF } from "@react-three/drei";
import {
  ACESFilmicToneMapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  MathUtils,
  MOUSE,
  PCFSoftShadowMap,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three";
import type {
  Group,
  Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Texture,
} from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import DeviceSidebar, { devices } from "./components/deviceSidebar";

const DEFAULT_CAMERA_POSITION: [number, number, number] = [0, 0, 3];
const DEFAULT_CANVAS_BACKGROUND_COLOR = "#18181b";
const DEFAULT_MODEL_ROTATION: [number, number, number] = [0, 0, 0];
const DEFAULT_MODEL_POSITION: [number, number, number] = [0, 0, 0];
const DEFAULT_WEBSITE_URL = "https://githance.in";
const DEFAULT_ANIMATION_TRACK_ID = "animation-track-1";
const DEFAULT_MEDIA_TRACK_ID = "media-track-1";
const DEFAULT_STILL_DURATION = 5;
const MIN_CLIP_DURATION = 0.25;
const MODEL_DEPTH_WHEEL_SENSITIVITY = 0.0015;
const MODEL_DEPTH_LIMIT = 1.25;
const MODEL_POSITION_DRAG_SENSITIVITY = 0.003;
const MODEL_POSITION_LIMIT = 1.75;
const MODEL_ROTATION_SENSITIVITY = 0.01;
const RECORDING_MAX_HEIGHT = 1080;
const RECORDING_MAX_WIDTH = 1920;
const RECORDING_VIDEO_BITS_PER_SECOND = 16_000_000;
const SNAP_INTERVAL = 0.25;
const TIMELINE_BASE_PIXELS_PER_SECOND = 86;
const TEXTURE_KEYS = [
  "map",
  "emissiveMap",
  "roughnessMap",
  "metalnessMap",
  "normalMap",
  "aoMap",
  "alphaMap",
] as const;
type MotionProfileId =
  | "cinematic"
  | "fast"
  | "floating"
  | "aggressive"
  | "minimal";
type SpeedProfileId = "slow" | "normal" | "fast" | "hyper";

type MovementPreset = {
  camera: [number, number, number];
  colorClass: string;
  duration: number;
  durationLabel: string;
  id: string;
  name: string;
  position: [number, number, number];
  rotation: [number, number, number];
  shortLabel: string;
};

type TransitionClip = MovementPreset & {
  clipId: number;
  duration: number;
  enabled: boolean;
  start: number;
  trackId: string;
};

type MotionProfile = {
  cameraDolly: number;
  cameraMomentum: number;
  cameraOrbit: number;
  depthDistance: number;
  durationScale: number;
  gestureBoost: number;
  hoverLift: number;
  id: MotionProfileId;
  label: string;
  movementDistance: number;
  overshoot: number;
  rotationIntensity: number;
  settleDamping: number;
};

type SpeedProfile = {
  durationScale: number;
  gestureGain: number;
  id: SpeedProfileId;
  label: string;
  spinGain: number;
};

type GestureImpulse = {
  deltaX: number;
  deltaY: number;
  signal: number;
  target: "device" | "scene";
};

type ScreenContent = {
  label: string;
  mimeType?: string;
  type: "website" | "image" | "video";
  url: string;
};

type TimelineTrackKind = "media" | "animation";

type TimelineTrack = {
  id: string;
  kind: TimelineTrackKind;
  muted: boolean;
  name: string;
  order: number;
};

type MediaTimelineClip = {
  clipId: number;
  duration: number;
  enabled: boolean;
  kind: ScreenContent["type"];
  label: string;
  start: number;
  trackId: string;
};

type TimelineAnimationSample = {
  camera: [number, number, number];
  position: [number, number, number];
  rotation: [number, number, number];
};

type ClipEditMode = "move" | "trim-start" | "trim-end";

type ClipEditState = {
  clipId: number;
  initialDuration: number;
  initialStart: number;
  kind: TimelineTrackKind;
  mode: ClipEditMode;
  pointerX: number;
};

const MOTION_PROFILES: MotionProfile[] = [
  {
    cameraDolly: 0.16,
    cameraMomentum: 1.05,
    cameraOrbit: 0.08,
    depthDistance: 0.42,
    durationScale: 1,
    gestureBoost: 1,
    hoverLift: 0.035,
    id: "cinematic",
    label: "Cinematic",
    movementDistance: 1,
    overshoot: 0.12,
    rotationIntensity: 1,
    settleDamping: 16,
  },
  {
    cameraDolly: 0.1,
    cameraMomentum: 0.9,
    cameraOrbit: 0.06,
    depthDistance: 0.3,
    durationScale: 0.72,
    gestureBoost: 1.18,
    hoverLift: 0.025,
    id: "fast",
    label: "Fast",
    movementDistance: 0.85,
    overshoot: 0.08,
    rotationIntensity: 1.15,
    settleDamping: 20,
  },
  {
    cameraDolly: 0.18,
    cameraMomentum: 1.25,
    cameraOrbit: 0.1,
    depthDistance: 0.34,
    durationScale: 1.18,
    gestureBoost: 0.86,
    hoverLift: 0.055,
    id: "floating",
    label: "Floating",
    movementDistance: 1.15,
    overshoot: 0.16,
    rotationIntensity: 0.82,
    settleDamping: 12,
  },
  {
    cameraDolly: 0.22,
    cameraMomentum: 1.45,
    cameraOrbit: 0.13,
    depthDistance: 0.56,
    durationScale: 0.88,
    gestureBoost: 1.45,
    hoverLift: 0.03,
    id: "aggressive",
    label: "Aggressive",
    movementDistance: 1.35,
    overshoot: 0.24,
    rotationIntensity: 1.55,
    settleDamping: 18,
  },
  {
    cameraDolly: 0.06,
    cameraMomentum: 0.7,
    cameraOrbit: 0.035,
    depthDistance: 0.16,
    durationScale: 1.05,
    gestureBoost: 0.66,
    hoverLift: 0.018,
    id: "minimal",
    label: "Minimal",
    movementDistance: 0.58,
    overshoot: 0.05,
    rotationIntensity: 0.52,
    settleDamping: 24,
  },
];

const SPEED_PROFILES: SpeedProfile[] = [
  {
    durationScale: 1.35,
    gestureGain: 0.58,
    id: "slow",
    label: "Slow",
    spinGain: 0.72,
  },
  {
    durationScale: 1,
    gestureGain: 1,
    id: "normal",
    label: "Normal",
    spinGain: 1,
  },
  {
    durationScale: 0.72,
    gestureGain: 1.45,
    id: "fast",
    label: "Fast",
    spinGain: 1.35,
  },
  {
    durationScale: 0.48,
    gestureGain: 2.15,
    id: "hyper",
    label: "Hyper",
    spinGain: 1.9,
  },
];

const MOVEMENT_PRESETS: MovementPreset[] = [
  {
    camera: [0.08, 0.02, -0.1],
    colorClass: "bg-sky-400 text-zinc-950",
    duration: 1.8,
    durationLabel: "1.8s",
    id: "hero-orbit",
    name: "Hero Orbit",
    position: [0.08, 0.03, 0],
    rotation: [-Math.PI / 22, Math.PI / 2.8, Math.PI / 36],
    shortLabel: "HO",
  },
  {
    camera: [-0.08, 0.02, -0.08],
    colorClass: "bg-cyan-300 text-zinc-950",
    duration: 2.1,
    durationLabel: "2.1s",
    id: "slow-reveal",
    name: "Slow Reveal",
    position: [-0.14, 0.02, 0.02],
    rotation: [-Math.PI / 14, -Math.PI / 2.9, -Math.PI / 40],
    shortLabel: "SR",
  },
  {
    camera: [0, 0.06, -0.12],
    colorClass: "bg-emerald-400 text-zinc-950",
    duration: 1.7,
    durationLabel: "1.7s",
    id: "glass-tilt",
    name: "Glass Tilt",
    position: [0, 0.08, 0.03],
    rotation: [-Math.PI / 6.5, Math.PI / 12, Math.PI / 28],
    shortLabel: "GT",
  },
  {
    camera: [0.04, -0.04, -0.06],
    colorClass: "bg-lime-300 text-zinc-950",
    duration: 1.9,
    durationLabel: "1.9s",
    id: "macro-dip",
    name: "Macro Dip",
    position: [0.04, -0.08, 0.04],
    rotation: [Math.PI / 7.5, -Math.PI / 14, -Math.PI / 32],
    shortLabel: "MD",
  },
  {
    camera: [0.12, 0.01, -0.1],
    colorClass: "bg-amber-400 text-zinc-950",
    duration: 2,
    durationLabel: "2.0s",
    id: "table-sweep",
    name: "Table Sweep",
    position: [0.18, 0.02, 0],
    rotation: [Math.PI / 20, Math.PI / 3.6, -Math.PI / 18],
    shortLabel: "TS",
  },
  {
    camera: [-0.12, 0.01, -0.1],
    colorClass: "bg-rose-400 text-zinc-950",
    duration: 2,
    durationLabel: "2.0s",
    id: "reverse-sweep",
    name: "Reverse Sweep",
    position: [-0.18, 0.02, 0],
    rotation: [Math.PI / 22, -Math.PI / 3.6, Math.PI / 18],
    shortLabel: "RS",
  },
  {
    camera: [0, 0.02, -0.16],
    colorClass: "bg-violet-300 text-zinc-950",
    duration: 2.4,
    durationLabel: "2.4s",
    id: "premium-spin",
    name: "Premium Spin",
    position: [0, 0.04, 0.05],
    rotation: [-Math.PI / 18, Math.PI * 0.95, 0],
    shortLabel: "PS",
  },
  {
    camera: [0.08, 0.06, -0.14],
    colorClass: "bg-fuchsia-300 text-zinc-950",
    duration: 2.2,
    durationLabel: "2.2s",
    id: "showcase",
    name: "Showcase Arc",
    position: [0.1, 0.07, 0.03],
    rotation: [-Math.PI / 8, Math.PI / 3.2, Math.PI / 14],
    shortLabel: "SC",
  },
  {
    camera: [-0.04, 0.04, -0.06],
    colorClass: "bg-teal-300 text-zinc-950",
    duration: 1.8,
    durationLabel: "1.8s",
    id: "final-settle",
    name: "Final Settle",
    position: [-0.04, 0.04, 0.02],
    rotation: [Math.PI / 12, -Math.PI / 5.5, -Math.PI / 40],
    shortLabel: "FS",
  },
];
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

function TransitionsIcon() {
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
      <path d="M4 7h6" />
      <path d="M14 7h6" />
      <path d="M10 7l4-4v8z" />
      <path d="M4 17h6" />
      <path d="M14 17h6" />
      <path d="M14 17l-4-4v8z" />
    </svg>
  );
}

function PlayTrackIcon({ isPlaying }: { isPlaying: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      {isPlaying ? (
        <path d="M7 6h4v12H7zM13 6h4v12h-4z" />
      ) : (
        <path d="M8 5v14l11-7z" />
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
      className={`grid h-11 w-11 place-items-center rounded-md border transition ${active
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

const easeInOutCubic = (value: number) =>
  value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;

const easeOutExpo = (value: number) =>
  value === 1 ? 1 : 1 - Math.pow(2, -10 * value);

const easeOutBack = (value: number, overshoot: number) => {
  const tunedOvershoot = 1.70158 + overshoot * 4;
  const shiftedValue = value - 1;

  return (
    1 +
    (tunedOvershoot + 1) * shiftedValue * shiftedValue * shiftedValue +
    tunedOvershoot * shiftedValue * shiftedValue
  );
};

const getMovementDuration = (
  movement: MovementPreset,
  motionProfile: MotionProfile,
  speedProfile: SpeedProfile,
) => movement.duration * motionProfile.durationScale * speedProfile.durationScale;

const formatDuration = (duration: number) => `${duration.toFixed(1)}s`;

const formatMediaDuration = (duration: number) => {
  if (!Number.isFinite(duration) || duration <= 0) {
    return "Video";
  }

  const minutes = Math.floor(duration / 60);
  const seconds = Math.floor(duration % 60);

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const snapTimelineTime = (time: number) =>
  Math.max(0, Math.round(time / SNAP_INTERVAL) * SNAP_INTERVAL);

const getTimelineEnd = (clips: Array<{ duration: number; start: number }>) =>
  clips.reduce(
    (latestEnd, clip) => Math.max(latestEnd, clip.start + clip.duration),
    0,
  );

const getOrderedTracks = (tracks: TimelineTrack[], kind: TimelineTrackKind) =>
  tracks
    .filter((track) => track.kind === kind)
    .slice()
    .sort((firstTrack, secondTrack) => firstTrack.order - secondTrack.order);

const getTrackMutedMap = (tracks: TimelineTrack[]) =>
  new Map(tracks.map((track) => [track.id, track.muted]));

const sampleAnimationTimeline = (
  time: number,
  clips: TransitionClip[],
  tracks: TimelineTrack[],
  motionProfile: MotionProfile,
): TimelineAnimationSample | null => {
  const trackMutedMap = getTrackMutedMap(tracks);
  const sample: TimelineAnimationSample = {
    camera: [0, 0, 0],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
  };
  let hasSample = false;

  clips.forEach((clip) => {
    if (
      !clip.enabled ||
      trackMutedMap.get(clip.trackId) ||
      time < clip.start ||
      time > clip.start + clip.duration
    ) {
      return;
    }

    const progress = MathUtils.clamp((time - clip.start) / clip.duration, 0, 1);
    const easedProgress = easeInOutCubic(progress);
    const arcProgress = Math.sin(progress * Math.PI);

    hasSample = true;
    sample.rotation[0] +=
      clip.rotation[0] * motionProfile.rotationIntensity * easedProgress;
    sample.rotation[1] +=
      clip.rotation[1] * motionProfile.rotationIntensity * easedProgress;
    sample.rotation[2] +=
      clip.rotation[2] * motionProfile.rotationIntensity * easedProgress;
    sample.position[0] +=
      clip.position[0] * motionProfile.movementDistance * arcProgress;
    sample.position[1] +=
      clip.position[1] * motionProfile.movementDistance * arcProgress;
    sample.position[2] +=
      (clip.position[2] * motionProfile.movementDistance +
        motionProfile.depthDistance * 0.45) *
      arcProgress;
    sample.camera[0] += clip.camera[0] * motionProfile.cameraMomentum * arcProgress;
    sample.camera[1] += clip.camera[1] * motionProfile.cameraMomentum * arcProgress;
    sample.camera[2] += clip.camera[2] * motionProfile.cameraMomentum * arcProgress;
  });

  return hasSample ? sample : null;
};

const clampModelPosition = (
  position: [number, number, number],
): [number, number, number] => [
  MathUtils.clamp(position[0], -MODEL_POSITION_LIMIT, MODEL_POSITION_LIMIT),
  MathUtils.clamp(position[1], -MODEL_POSITION_LIMIT, MODEL_POSITION_LIMIT),
  MathUtils.clamp(position[2], -MODEL_DEPTH_LIMIT, MODEL_DEPTH_LIMIT),
];

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
        texture.magFilter = LinearFilter;
        texture.minFilter = LinearMipmapLinearFilter;
        texture.generateMipmaps = true;

        if (key === "map" || key === "emissiveMap") {
          texture.colorSpace = SRGBColorSpace;
        }

        texture.needsUpdate = true;
      });

      const standardMaterial = material as MeshStandardMaterial;

      if ("envMapIntensity" in standardMaterial) {
        standardMaterial.envMapIntensity = 1.1;
      }

      if ("roughness" in standardMaterial) {
        standardMaterial.roughness = Math.min(0.82, standardMaterial.roughness);
      }

      standardMaterial.needsUpdate = true;
    });
  });
};

function SceneCameraDefaults({
  activeMovement,
  controlsRef,
  deviceId,
  gestureImpulse,
  isPointerOnDevice,
  motionProfile,
  movementPlaySignal,
  resetSignal,
  speedProfile,
  timelineCameraOffset,
}: {
  activeMovement: MovementPreset | null;
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
  deviceId: number;
  gestureImpulse: GestureImpulse;
  isPointerOnDevice: boolean;
  motionProfile: MotionProfile;
  movementPlaySignal: number;
  resetSignal: number;
  speedProfile: SpeedProfile;
  timelineCameraOffset: [number, number, number];
}) {
  const { camera } = useThree();
  const cameraRef = useRef(camera);
  const cameraBaseRef = useRef<[number, number, number]>([
    ...DEFAULT_CAMERA_POSITION,
  ]);
  const cameraImpulseRef = useRef<[number, number, number]>([0, 0, 0]);
  const cameraVelocityRef = useRef<[number, number, number]>([0, 0, 0]);
  const entranceRef = useRef({ elapsed: 0, running: true });

  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  useEffect(() => {
    const { cameraPosition } = getDeviceViewDefaults(deviceId);
    const sceneCamera = controlsRef.current?.object ?? cameraRef.current;

    cameraBaseRef.current = [...cameraPosition];
    entranceRef.current = { elapsed: 0, running: true };
    sceneCamera.position.set(
      cameraPosition[0],
      cameraPosition[1] + 0.04,
      cameraPosition[2] + 0.28,
    );
    sceneCamera.updateProjectionMatrix();

    if (controlsRef.current) {
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
      controlsRef.current.saveState();
    }
  }, [controlsRef, deviceId, resetSignal]);

  useEffect(() => {
    if (!activeMovement || movementPlaySignal === 0) {
      return;
    }

    const duration = getMovementDuration(
      activeMovement,
      motionProfile,
      speedProfile,
    );
    const impulse = cameraImpulseRef.current;

    impulse[0] +=
      activeMovement.camera[0] * motionProfile.cameraMomentum * 0.75;
    impulse[1] +=
      activeMovement.camera[1] * motionProfile.cameraMomentum * 0.75;
    impulse[2] +=
      activeMovement.camera[2] *
      motionProfile.cameraMomentum *
      Math.max(0.75, 1.8 / duration);
  }, [activeMovement, motionProfile, movementPlaySignal, speedProfile]);

  useEffect(() => {
    if (gestureImpulse.signal === 0 || gestureImpulse.target !== "scene") {
      return;
    }

    const velocity = cameraVelocityRef.current;
    const gain =
      speedProfile.gestureGain * motionProfile.gestureBoost * 0.00055;

    velocity[0] += gestureImpulse.deltaX * gain;
    velocity[1] += -gestureImpulse.deltaY * gain * 0.42;
    velocity[2] += gestureImpulse.deltaY * gain * 0.7;
  }, [gestureImpulse, motionProfile, speedProfile]);

  useFrame(({ clock }, delta) => {
    const sceneCamera = controlsRef.current?.object ?? cameraRef.current;
    const basePosition = cameraBaseRef.current;
    const elapsedTime = clock.getElapsedTime();
    const impulse = cameraImpulseRef.current;
    const velocity = cameraVelocityRef.current;
    const entrance = entranceRef.current;

    if (entrance.running) {
      entrance.elapsed += delta;

      if (entrance.elapsed >= 1.1) {
        entrance.running = false;
      }
    }

    const entranceProgress = entrance.running
      ? easeOutExpo(Math.min(entrance.elapsed / 1.1, 1))
      : 1;
    const idleOrbit = isPointerOnDevice ? 0.004 : motionProfile.cameraOrbit;
    const idleDolly = isPointerOnDevice ? 0.006 : motionProfile.cameraDolly;
    const targetX =
      basePosition[0] +
      Math.sin(elapsedTime * 0.22) * idleOrbit +
      impulse[0] +
      velocity[0] +
      timelineCameraOffset[0];
    const targetY =
      basePosition[1] +
      Math.cos(elapsedTime * 0.18) * idleOrbit * 0.35 +
      impulse[1] +
      velocity[1] +
      timelineCameraOffset[1] +
      (1 - entranceProgress) * 0.04;
    const targetZ =
      basePosition[2] +
      Math.sin(elapsedTime * 0.16) * idleDolly +
      impulse[2] +
      velocity[2] +
      timelineCameraOffset[2] +
      (1 - entranceProgress) * 0.28;
    const cameraDamping = Math.max(
      8,
      motionProfile.settleDamping * 0.58 * speedProfile.spinGain,
    );

    /* eslint-disable react-hooks/immutability -- R3F camera animation is intentionally imperative. */
    sceneCamera.position.x = MathUtils.damp(
      sceneCamera.position.x,
      targetX,
      cameraDamping,
      delta,
    );
    sceneCamera.position.y = MathUtils.damp(
      sceneCamera.position.y,
      targetY,
      cameraDamping,
      delta,
    );
    sceneCamera.position.z = MathUtils.damp(
      sceneCamera.position.z,
      targetZ,
      cameraDamping,
      delta,
    );
    /* eslint-enable react-hooks/immutability */

    impulse[0] = MathUtils.damp(impulse[0], 0, 3.8, delta);
    impulse[1] = MathUtils.damp(impulse[1], 0, 3.8, delta);
    impulse[2] = MathUtils.damp(impulse[2], 0, 3.8, delta);
    velocity[0] = MathUtils.damp(velocity[0], 0, 4.6, delta);
    velocity[1] = MathUtils.damp(velocity[1], 0, 4.6, delta);
    velocity[2] = MathUtils.damp(velocity[2], 0, 4.6, delta);

    if (controlsRef.current) {
      controlsRef.current.target.x = MathUtils.damp(
        controlsRef.current.target.x,
        impulse[0] * 0.18,
        7,
        delta,
      );
      controlsRef.current.target.y = MathUtils.damp(
        controlsRef.current.target.y,
        impulse[1] * 0.18,
        7,
        delta,
      );
      controlsRef.current.target.z = MathUtils.damp(
        controlsRef.current.target.z,
        0,
        7,
        delta,
      );
      controlsRef.current.update();
    }
  }, -2);

  return null;
}

const WebsiteScreen = memo(function WebsiteScreen({
  device,
  mediaClipStart,
  isMediaPlaying,
  isRotateMode,
  mediaTimelineTime,
  mediaPlaySignal,
  screenContent,
  onDeviceDragEnd,
  onDeviceDragMove,
  onDeviceDragStart,
  onDeviceHoverEnd,
  onDeviceHoverStart,
  onMediaDurationChange,
  onMediaEnded,
  onMediaPlayStateChange,
}: {
  device: (typeof devices)[number];
  mediaClipStart: number;
  isMediaPlaying: boolean;
  isRotateMode: boolean;
  mediaTimelineTime: number;
  mediaPlaySignal: number;
  screenContent: ScreenContent;
  onDeviceDragEnd: () => void;
  onDeviceDragMove: (movementX: number, movementY: number) => void;
  onDeviceDragStart: () => void;
  onDeviceHoverEnd: () => void;
  onDeviceHoverStart: () => void;
  onMediaDurationChange: (duration: number) => void;
  onMediaEnded: () => void;
  onMediaPlayStateChange: (isPlaying: boolean) => void;
}) {
  const { screen } = device;
  const position = screen.position as [number, number, number];
  const rotation = screen.rotation as [number, number, number];
  const { camera } = useThree();
  const isDraggingScreen = useRef(false);
  const screenElementRef = useRef<HTMLDivElement | null>(null);
  const screenGroupRef = useRef<Group | null>(null);
  const screenIsFacingCameraRef = useRef(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const screenNormalRef = useRef(new Vector3());
  const screenPositionRef = useRef(new Vector3());
  const cameraDirectionRef = useRef(new Vector3());
  const worldQuaternionRef = useRef(new Quaternion());

  const stopScreenEvent = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  useFrame(() => {
    const screenElement = screenElementRef.current;
    const screenGroup = screenGroupRef.current;

    if (!screenElement || !screenGroup) {
      return;
    }

    const screenPosition = screenPositionRef.current;
    const screenNormal = screenNormalRef.current;
    const cameraDirection = cameraDirectionRef.current;
    const worldQuaternion = worldQuaternionRef.current;

    screenGroup.getWorldPosition(screenPosition);
    screenGroup.getWorldQuaternion(worldQuaternion);
    screenNormal.set(0, 0, 1).applyQuaternion(worldQuaternion).normalize();
    cameraDirection.subVectors(camera.position, screenPosition).normalize();

    const facingScore = screenNormal.dot(cameraDirection);
    const wasFacingCamera = screenIsFacingCameraRef.current;
    const isFacingCamera = wasFacingCamera
      ? facingScore > -0.08
      : facingScore > 0.08;

    if (isFacingCamera === wasFacingCamera) {
      return;
    }

    screenIsFacingCameraRef.current = isFacingCamera;
    screenElement.style.opacity = isFacingCamera ? "1" : "0";
    screenElement.style.pointerEvents = isFacingCamera ? "auto" : "none";
    screenElement.style.visibility = isFacingCamera ? "visible" : "hidden";
  }, -0.5);

  useEffect(() => {
    const video = videoRef.current;

    if (screenContent.type !== "video" || !video) {
      return;
    }

    const targetTime = MathUtils.clamp(
      mediaTimelineTime - mediaClipStart,
      0,
      Number.isFinite(video.duration) ? video.duration : mediaTimelineTime,
    );

    if (Math.abs(video.currentTime - targetTime) > 0.035) {
      video.currentTime = targetTime;
    }

    if (isMediaPlaying) {
      void video.play().catch(() => {
        onMediaPlayStateChange(false);
      });
      return;
    }

    video.pause();
  }, [
    isMediaPlaying,
    mediaClipStart,
    mediaPlaySignal,
    mediaTimelineTime,
    onMediaPlayStateChange,
    screenContent,
  ]);

  return (
    <group ref={screenGroupRef} position={position} rotation={rotation}>
      <Html
        transform
        center
        scale={screen.scale}
        eps={0.001}
        zIndexRange={[1, 0]}
      >
      <div
        ref={screenElementRef}
        className="overflow-hidden bg-white"
        style={{
          opacity: 1,
          transition: "opacity 0.2s ease",
          width: screen.viewport.width,
          height: screen.viewport.height,
          borderRadius: screen.radius,
          backfaceVisibility: "hidden",
          clipPath: `inset(0 round ${screen.radius}px)`,
          contain: "paint",
          isolation: "isolate",
          pointerEvents: "auto",
          transform: "translate3d(0, 0, 0)",
          transformStyle: "preserve-3d",
          willChange: "transform, opacity",
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
        {screenContent.type === "website" ? (
          <iframe
            key={`${device.id}-${screenContent.url}`}
            title={`${device.name} website preview`}
            src={screenContent.url}
            className="h-full w-full border-0 bg-white"
            loading="eager"
            style={{
              backfaceVisibility: "hidden",
              borderRadius: "inherit",
              clipPath: "inherit",
              display: "block",
              pointerEvents: isRotateMode ? "none" : "auto",
              textRendering: "geometricPrecision",
              transform: "translate3d(0, 0, 0)",
              willChange: "transform",
            }}
          />
        ) : screenContent.type === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- Uploaded object URLs cannot be optimized through next/image.
          <img
            key={screenContent.url}
            alt=""
            src={screenContent.url}
            className="h-full w-full bg-black object-cover"
            draggable={false}
            style={{
              backfaceVisibility: "hidden",
              borderRadius: "inherit",
              clipPath: "inherit",
              display: "block",
              pointerEvents: "none",
              transform: "translate3d(0, 0, 0)",
              willChange: "transform",
            }}
          />
        ) : (
          <video
            key={screenContent.url}
            ref={videoRef}
            src={screenContent.url}
            className="h-full w-full bg-black object-cover"
            controls={!isRotateMode}
            playsInline
            preload="auto"
            style={{
              backfaceVisibility: "hidden",
              borderRadius: "inherit",
              clipPath: "inherit",
              display: "block",
              pointerEvents: isRotateMode ? "none" : "auto",
              transform: "translate3d(0, 0, 0)",
              willChange: "transform",
            }}
            onEnded={() => {
              onMediaEnded();
              onMediaPlayStateChange(false);
            }}
            onLoadedMetadata={(event) => {
              onMediaDurationChange(event.currentTarget.duration);
            }}
            onPause={() => onMediaPlayStateChange(false)}
            onPlay={() => onMediaPlayStateChange(true)}
          />
        )}
      </div>
      </Html>
    </group>
  );
});

const DeviceModel = memo(function DeviceModel({
  activeMovement,
  device,
  gestureImpulse,
  isDraggingDevice,
  isPointerOnDevice,
  movementPlaySignal,
  motionProfile,
  isMediaPlaying,
  isRotateMode,
  mediaClipStart,
  mediaTimelineTime,
  mediaPlaySignal,
  modelPositionOffset,
  resetSignal,
  screenContent,
  speedProfile,
  timelineSample,
  onDeviceDragEnd,
  onDeviceDragStart,
  onDeviceHoverEnd,
  onDeviceHoverStart,
  onMediaDurationChange,
  onMediaEnded,
  onMediaPlayStateChange,
}: {
  activeMovement: MovementPreset | null;
  device: (typeof devices)[number];
  gestureImpulse: GestureImpulse;
  isDraggingDevice: boolean;
  isMediaPlaying: boolean;
  isPointerOnDevice: boolean;
  movementPlaySignal: number;
  motionProfile: MotionProfile;
  isRotateMode: boolean;
  mediaClipStart: number;
  mediaTimelineTime: number;
  mediaPlaySignal: number;
  modelPositionOffset: [number, number, number];
  resetSignal: number;
  screenContent: ScreenContent;
  speedProfile: SpeedProfile;
  timelineSample: TimelineAnimationSample | null;
  onDeviceDragEnd: () => void;
  onDeviceDragStart: () => void;
  onDeviceHoverEnd: () => void;
  onDeviceHoverStart: () => void;
  onMediaDurationChange: (duration: number) => void;
  onMediaEnded: () => void;
  onMediaPlayStateChange: (isPlaying: boolean) => void;
}) {
  const { scene } = useGLTF(device.modelPath);
  const { gl } = useThree();
  const groupRef = useRef<Group | null>(null);
  const currentRotationRef = useRef<[number, number, number]>([
    ...DEFAULT_MODEL_ROTATION,
  ]);
  const currentPositionRef = useRef<[number, number, number]>([
    ...DEFAULT_MODEL_POSITION,
  ]);
  const hoverInfluenceRef = useRef<[number, number]>([0, 0]);
  const hoverTargetRef = useRef<[number, number]>([0, 0]);
  const modelPositionOffsetRef = useRef<[number, number, number]>([
    ...modelPositionOffset,
  ]);

  const movementAnimationRef = useRef<{
    basePosition: [number, number, number];
    duration: number;
    elapsed: number;
    fromRotation: [number, number, number];
    motionProfile: MotionProfile;
    peakPosition: [number, number, number];
    speedProfile: SpeedProfile;
    toRotation: [number, number, number];
  } | null>(null);
  const rotationVelocityRef = useRef<[number, number, number]>([0, 0, 0]);
  const targetRotationRef = useRef<[number, number, number]>([
    ...DEFAULT_MODEL_ROTATION,
  ]);

  const rotateDevice = useCallback((movementX: number, movementY: number) => {
    movementAnimationRef.current = null;
    const targetRotation = targetRotationRef.current;
    const rotationVelocity = rotationVelocityRef.current;
    const gestureGain =
      speedProfile.spinGain * motionProfile.gestureBoost * 0.65;

    rotationVelocity[0] +=
      movementY * MODEL_ROTATION_SENSITIVITY * gestureGain * 0.18;
    rotationVelocity[1] +=
      movementX * MODEL_ROTATION_SENSITIVITY * gestureGain * 0.18;
    targetRotation[0] += movementY * MODEL_ROTATION_SENSITIVITY * gestureGain;
    targetRotation[1] += movementX * MODEL_ROTATION_SENSITIVITY * gestureGain;
  }, [motionProfile, speedProfile]);

  useLayoutEffect(() => {
    modelPositionOffsetRef.current = [...modelPositionOffset];
  }, [modelPositionOffset]);

  useEffect(() => {
    improveTextureQuality(scene, gl.capabilities.getMaxAnisotropy());
  }, [gl, scene]);

  useLayoutEffect(() => {
    const { modelRotation } = getDeviceViewDefaults(device.id);
    const nextRotation: [number, number, number] = [...modelRotation];
    const nextPosition: [number, number, number] = [
      ...modelPositionOffsetRef.current,
    ];

    currentRotationRef.current = [...nextRotation];
    currentPositionRef.current = [...nextPosition];
    targetRotationRef.current = [...nextRotation];
    movementAnimationRef.current = null;
    rotationVelocityRef.current = [0, 0, 0];
    groupRef.current?.position.set(...nextPosition);
    groupRef.current?.rotation.set(...nextRotation);
  }, [device.id, resetSignal]);

  useEffect(() => {
    if (!activeMovement || movementPlaySignal === 0) {
      return;
    }

    const fromRotation: [number, number, number] = [
      ...currentRotationRef.current,
    ];
    const duration = getMovementDuration(
      activeMovement,
      motionProfile,
      speedProfile,
    );
    const toRotation: [number, number, number] = [
      fromRotation[0] +
      activeMovement.rotation[0] * motionProfile.rotationIntensity,
      fromRotation[1] +
      activeMovement.rotation[1] * motionProfile.rotationIntensity,
      fromRotation[2] +
      activeMovement.rotation[2] * motionProfile.rotationIntensity,
    ];

    targetRotationRef.current = [...toRotation];
    movementAnimationRef.current = {
      basePosition: [...modelPositionOffsetRef.current],
      duration,
      elapsed: 0,
      fromRotation,
      motionProfile,
      peakPosition: [
        activeMovement.position[0] * motionProfile.movementDistance,
        activeMovement.position[1] * motionProfile.movementDistance,
        activeMovement.position[2] * motionProfile.movementDistance +
        motionProfile.depthDistance,
      ],
      speedProfile,
      toRotation,
    };
  }, [
    activeMovement,
    motionProfile,
    movementPlaySignal,
    speedProfile,
  ]);

  useEffect(() => {
    if (gestureImpulse.signal === 0 || gestureImpulse.target !== "device") {
      return;
    }

    const rotationVelocity = rotationVelocityRef.current;
    const targetRotation = targetRotationRef.current;
    const gain =
      MODEL_ROTATION_SENSITIVITY *
      speedProfile.gestureGain *
      speedProfile.spinGain *
      motionProfile.gestureBoost *
      0.65;

    rotationVelocity[0] += gestureImpulse.deltaY * gain;
    rotationVelocity[1] += gestureImpulse.deltaX * gain;
    rotationVelocity[2] += (gestureImpulse.deltaX - gestureImpulse.deltaY) * gain * 0.18;
    targetRotation[0] += gestureImpulse.deltaY * gain * 1.45;
    targetRotation[1] += gestureImpulse.deltaX * gain * 1.45;
    targetRotation[2] +=
      (gestureImpulse.deltaX - gestureImpulse.deltaY) * gain * 0.25;
  }, [gestureImpulse, motionProfile, speedProfile]);

  useFrame((_, delta) => {
    const group = groupRef.current;

    if (!group) {
      return;
    }

    if (timelineSample) {
      movementAnimationRef.current = null;
      const hoverInfluence = hoverInfluenceRef.current;
      const hoverTarget = hoverTargetRef.current;

      hoverInfluence[0] = MathUtils.damp(
        hoverInfluence[0],
        isPointerOnDevice ? hoverTarget[0] : 0,
        10,
        delta,
      );
      hoverInfluence[1] = MathUtils.damp(
        hoverInfluence[1],
        isPointerOnDevice ? hoverTarget[1] : 0,
        10,
        delta,
      );

      const sampledRotation: [number, number, number] = [
        timelineSample.rotation[0] + hoverInfluence[1] * 0.075,
        timelineSample.rotation[1] + hoverInfluence[0] * 0.085,
        timelineSample.rotation[2] - hoverInfluence[0] * 0.035,
      ];
      const sampledPosition: [number, number, number] = [
        modelPositionOffset[0] +
        timelineSample.position[0] +
        hoverInfluence[0] * 0.012,
        modelPositionOffset[1] +
        timelineSample.position[1] -
        hoverInfluence[1] * 0.012,
        modelPositionOffset[2] +
        timelineSample.position[2] +
        (isPointerOnDevice ? motionProfile.hoverLift : 0),
      ];

      currentRotationRef.current = [...sampledRotation];
      currentPositionRef.current = [...sampledPosition];
      targetRotationRef.current = [...sampledRotation];
      rotationVelocityRef.current = [0, 0, 0];
      group.position.set(...sampledPosition);
      group.rotation.set(...sampledRotation);
      return;
    }

    const movementAnimation = movementAnimationRef.current;

    if (movementAnimation) {
      movementAnimation.elapsed += delta;

      const progress = Math.min(
        movementAnimation.elapsed / movementAnimation.duration,
        1,
      );
      const cinematicProgress = easeInOutCubic(progress);
      const easedProgress = easeOutBack(
        cinematicProgress,
        movementAnimation.motionProfile.overshoot,
      );
      const currentRotation = currentRotationRef.current;

      currentRotation[0] = MathUtils.lerp(
        movementAnimation.fromRotation[0],
        movementAnimation.toRotation[0],
        easedProgress,
      );
      currentRotation[1] = MathUtils.lerp(
        movementAnimation.fromRotation[1],
        movementAnimation.toRotation[1],
        easedProgress,
      );
      currentRotation[2] = MathUtils.lerp(
        movementAnimation.fromRotation[2],
        movementAnimation.toRotation[2],
        easedProgress,
      );

      const movementArc = Math.sin(progress * Math.PI);
      const flyInDepth =
        Math.pow(1 - progress, 2) *
        movementAnimation.motionProfile.depthDistance *
        0.55;
      const breathingLift =
        Math.sin(progress * Math.PI * 2) *
        0.012 *
        movementAnimation.speedProfile.spinGain;
      const basePosition = movementAnimation.basePosition;
      const peakPosition = movementAnimation.peakPosition;

      const nextPosition: [number, number, number] = [
        basePosition[0] + peakPosition[0] * movementArc,
        basePosition[1] + peakPosition[1] * movementArc + breathingLift,
        basePosition[2] + peakPosition[2] * movementArc + flyInDepth,
      ];

      currentPositionRef.current = nextPosition;
      group.position.set(...nextPosition);
      group.rotation.set(
        currentRotation[0],
        currentRotation[1],
        currentRotation[2],
      );

      if (progress >= 1) {
        targetRotationRef.current = [...movementAnimation.toRotation];
        currentPositionRef.current = [...movementAnimation.basePosition];
        group.position.set(...movementAnimation.basePosition);
        movementAnimationRef.current = null;
      }

      return;
    }

    const currentRotation = currentRotationRef.current;
    const targetRotation = targetRotationRef.current;
    const rotationVelocity = rotationVelocityRef.current;
    const hoverInfluence = hoverInfluenceRef.current;
    const hoverTarget = hoverTargetRef.current;

    hoverInfluence[0] = MathUtils.damp(
      hoverInfluence[0],
      isPointerOnDevice ? hoverTarget[0] : 0,
      10,
      delta,
    );
    hoverInfluence[1] = MathUtils.damp(
      hoverInfluence[1],
      isPointerOnDevice ? hoverTarget[1] : 0,
      10,
      delta,
    );
    targetRotation[0] += rotationVelocity[0] * delta;
    targetRotation[1] += rotationVelocity[1] * delta;
    targetRotation[2] += rotationVelocity[2] * delta;
    rotationVelocity[0] = MathUtils.damp(rotationVelocity[0], 0, 4.4, delta);
    rotationVelocity[1] = MathUtils.damp(rotationVelocity[1], 0, 4.4, delta);
    rotationVelocity[2] = MathUtils.damp(rotationVelocity[2], 0, 4.4, delta);

    currentRotation[0] = MathUtils.damp(
      currentRotation[0],
      targetRotation[0] + hoverInfluence[1] * 0.075,
      motionProfile.settleDamping,
      delta,
    );
    currentRotation[1] = MathUtils.damp(
      currentRotation[1],
      targetRotation[1] + hoverInfluence[0] * 0.085,
      motionProfile.settleDamping,
      delta,
    );
    currentRotation[2] = MathUtils.damp(
      currentRotation[2],
      targetRotation[2] - hoverInfluence[0] * 0.035,
      motionProfile.settleDamping,
      delta,
    );

    const targetPosition: [number, number, number] = [
      modelPositionOffset[0] + hoverInfluence[0] * 0.012,
      modelPositionOffset[1] - hoverInfluence[1] * 0.012,
      modelPositionOffset[2] +
      (isPointerOnDevice ? motionProfile.hoverLift : 0),
    ];
    const currentPosition = currentPositionRef.current;

    currentPosition[0] = MathUtils.damp(
      currentPosition[0],
      targetPosition[0],
      13,
      delta,
    );
    currentPosition[1] = MathUtils.damp(
      currentPosition[1],
      targetPosition[1],
      13,
      delta,
    );
    currentPosition[2] = MathUtils.damp(
      currentPosition[2],
      targetPosition[2],
      13,
      delta,
    );

    group.position.set(
      currentPosition[0],
      currentPosition[1],
      currentPosition[2],
    );
    group.rotation.set(
      currentRotation[0],
      currentRotation[1],
      currentRotation[2],
    );
  }, -1);

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
        if (!isRotateMode) {
          return;
        }

        event.stopPropagation();

        if (isDraggingDevice) {
          rotateDevice(event.nativeEvent.movementX, event.nativeEvent.movementY);
          return;
        }

        hoverTargetRef.current = [
          MathUtils.clamp(event.point.x, -1, 1),
          MathUtils.clamp(event.point.y, -1, 1),
        ];
      }}
      onPointerOut={() => {
        hoverTargetRef.current = [0, 0];

        if (!isDraggingDevice) {
          onDeviceHoverEnd();
        }
      }}
      onPointerOver={(event) => {
        if (!isRotateMode) {
          return;
        }

        event.stopPropagation();
        hoverTargetRef.current = [
          MathUtils.clamp(event.point.x, -1, 1),
          MathUtils.clamp(event.point.y, -1, 1),
        ];
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
      <primitive
        object={scene}
        rotation={
          device.id === 4
            ? [0, Math.PI / 2, 0]
            : [0, 0, 0]
        }
      />
      <WebsiteScreen
        device={device}
        mediaClipStart={mediaClipStart}
        isMediaPlaying={isMediaPlaying}
        isRotateMode={isRotateMode}
        mediaTimelineTime={mediaTimelineTime}
        mediaPlaySignal={mediaPlaySignal}
        screenContent={screenContent}
        onDeviceDragEnd={onDeviceDragEnd}
        onDeviceDragMove={rotateDevice}
        onDeviceDragStart={onDeviceDragStart}
        onDeviceHoverEnd={onDeviceHoverEnd}
        onDeviceHoverStart={onDeviceHoverStart}
        onMediaDurationChange={onMediaDurationChange}
        onMediaEnded={onMediaEnded}
        onMediaPlayStateChange={onMediaPlayStateChange}
      />
    </group>
  );
});

function TimelineEditor({
  activeAnimationClipId,
  animationClips,
  animationTracks,
  isAnimationPlaying,
  isMasterPlaying,
  isMediaPlaying,
  isPresetListOpen,
  mediaClips,
  mediaTrackLabel,
  mediaTrackSubtitle,
  mediaTracks,
  timelineDuration,
  timelineTime,
  timelineZoom,
  onAddMovementToTrack,
  onAddTrack,
  onClearAnimations,
  onClipDelete,
  onClipSelect,
  onClipUpdate,
  onDeleteTrack,
  onDuplicateTrack,
  onMuteTrack,
  onReorderTrack,
  onSeek,
  onTimelineZoomChange,
  onToggleAnimationPlayback,
  onToggleMasterPlayback,
  onToggleMediaPlayback,
  onTogglePresetList,
}: {
  activeAnimationClipId: number | null;
  animationClips: TransitionClip[];
  animationTracks: TimelineTrack[];
  isAnimationPlaying: boolean;
  isMasterPlaying: boolean;
  isMediaPlaying: boolean;
  isPresetListOpen: boolean;
  mediaClips: MediaTimelineClip[];
  mediaTrackLabel: string;
  mediaTrackSubtitle: string;
  mediaTracks: TimelineTrack[];
  timelineDuration: number;
  timelineTime: number;
  timelineZoom: number;
  onAddMovementToTrack: (movement: MovementPreset) => void;
  onAddTrack: (kind: TimelineTrackKind) => void;
  onClearAnimations: () => void;
  onClipDelete: (kind: TimelineTrackKind, clipId: number) => void;
  onClipSelect: (clip: TransitionClip) => void;
  onClipUpdate: (
    kind: TimelineTrackKind,
    clipId: number,
    update: Partial<Pick<MediaTimelineClip, "duration" | "start" | "trackId">>,
  ) => void;
  onDeleteTrack: (kind: TimelineTrackKind, trackId: string) => void;
  onDuplicateTrack: (kind: TimelineTrackKind, track: TimelineTrack) => void;
  onMuteTrack: (kind: TimelineTrackKind, trackId: string) => void;
  onReorderTrack: (
    kind: TimelineTrackKind,
    trackId: string,
    direction: -1 | 1,
  ) => void;
  onSeek: (time: number) => void;
  onTimelineZoomChange: (zoom: number) => void;
  onToggleAnimationPlayback: () => void;
  onToggleMasterPlayback: () => void;
  onToggleMediaPlayback: () => void;
  onTogglePresetList: () => void;
}) {
  const timelineRootRef = useRef<HTMLDivElement | null>(null);
  const [clipEdit, setClipEdit] = useState<ClipEditState | null>(null);
  const pixelsPerSecond = TIMELINE_BASE_PIXELS_PER_SECOND * timelineZoom;
  const timelineWidth = Math.max(900, timelineDuration * pixelsPerSecond + 120);
  const playheadX = timelineTime * pixelsPerSecond;
  const orderedMediaTracks = getOrderedTracks(mediaTracks, "media");
  const orderedAnimationTracks = getOrderedTracks(animationTracks, "animation");

  const beginClipEdit = (
    kind: TimelineTrackKind,
    clip: MediaTimelineClip | TransitionClip,
    mode: ClipEditMode,
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    timelineRootRef.current?.setPointerCapture(event.pointerId);
    setClipEdit({
      clipId: clip.clipId,
      initialDuration: clip.duration,
      initialStart: clip.start,
      kind,
      mode,
      pointerX: event.clientX,
    });
  };

  const updateClipEdit = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!clipEdit) {
      return;
    }

    const deltaSeconds = (event.clientX - clipEdit.pointerX) / pixelsPerSecond;

    if (clipEdit.mode === "move") {
      onClipUpdate(clipEdit.kind, clipEdit.clipId, {
        start: snapTimelineTime(clipEdit.initialStart + deltaSeconds),
      });
      return;
    }

    if (clipEdit.mode === "trim-start") {
      const nextStart = snapTimelineTime(clipEdit.initialStart + deltaSeconds);
      const maxStart =
        clipEdit.initialStart + clipEdit.initialDuration - MIN_CLIP_DURATION;

      onClipUpdate(clipEdit.kind, clipEdit.clipId, {
        duration:
          clipEdit.initialDuration +
          clipEdit.initialStart -
          Math.min(nextStart, maxStart),
        start: Math.min(nextStart, maxStart),
      });
      return;
    }

    onClipUpdate(clipEdit.kind, clipEdit.clipId, {
      duration: Math.max(
        MIN_CLIP_DURATION,
        snapTimelineTime(clipEdit.initialDuration + deltaSeconds),
      ),
    });
  };

  const endClipEdit = (event: React.PointerEvent<HTMLDivElement>) => {
    setClipEdit(null);

    if (timelineRootRef.current?.hasPointerCapture(event.pointerId)) {
      timelineRootRef.current.releasePointerCapture(event.pointerId);
    }
  };

  const renderClip = (
    kind: TimelineTrackKind,
    clip: MediaTimelineClip | TransitionClip,
  ) => {
    const left = clip.start * pixelsPerSecond;
    const width = Math.max(36, clip.duration * pixelsPerSecond);
    const isAnimationClip = kind === "animation";
    const animationClip = clip as TransitionClip;
    const mediaClip = clip as MediaTimelineClip;

    return (
      <div
        key={`${kind}-${clip.clipId}`}
        className={`group absolute top-2 flex h-10 items-center overflow-hidden rounded border text-left shadow-lg transition ${isAnimationClip && activeAnimationClipId === clip.clipId
          ? "border-sky-300 bg-sky-400/20 shadow-sky-400/20"
          : "border-zinc-700 bg-zinc-950 hover:border-sky-400"
          }`}
        style={{ left, width }}
        onDoubleClick={() => {
          if (isAnimationClip) {
            onClipSelect(animationClip);
          }
        }}
        onPointerDown={(event) => beginClipEdit(kind, clip, "move", event)}
      >
        <div
          className="h-full w-2 cursor-ew-resize bg-zinc-700 transition group-hover:bg-sky-400"
          onPointerDown={(event) => beginClipEdit(kind, clip, "trim-start", event)}
        />
        <div className="min-w-0 flex-1 px-2">
          <p className="truncate text-xs font-semibold text-zinc-100">
            {isAnimationClip ? animationClip.name : mediaClip.label}
          </p>
          <p className="text-[10px] text-zinc-500">
            {formatDuration(clip.start)} - {formatDuration(clip.start + clip.duration)}
          </p>
        </div>
        <button
          type="button"
          className="mr-1 grid h-6 w-6 shrink-0 place-items-center rounded text-zinc-500 opacity-0 transition hover:bg-zinc-800 hover:text-zinc-100 group-hover:opacity-100"
          onClick={(event) => {
            event.stopPropagation();
            onClipDelete(kind, clip.clipId);
          }}
        >
          x
        </button>
        <div
          className="h-full w-2 cursor-ew-resize bg-zinc-700 transition group-hover:bg-sky-400"
          onPointerDown={(event) => beginClipEdit(kind, clip, "trim-end", event)}
        />
      </div>
    );
  };

  const renderSection = (
    kind: TimelineTrackKind,
    title: string,
    subtitle: string,
    tracks: TimelineTrack[],
    clips: Array<MediaTimelineClip | TransitionClip>,
    isPlaying: boolean,
    onTogglePlayback: () => void,
  ) => (
    <div className="min-h-0 rounded-md border border-zinc-800 bg-zinc-950/70">
      <div className="flex h-12 items-center justify-between gap-3 border-b border-zinc-800 px-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            disabled={kind === "animation" && !animationClips.length}
            onClick={onTogglePlayback}
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-md border transition ${kind === "media" || animationClips.length
              ? "border-sky-400 bg-sky-400 text-zinc-950 hover:bg-sky-300"
              : "cursor-not-allowed border-zinc-800 bg-zinc-900 text-zinc-600"
              }`}
            title={isPlaying ? `Pause ${title}` : `Play ${title}`}
          >
            <PlayTrackIcon isPlaying={isPlaying} />
          </button>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {title}
            </p>
            <p className="truncate text-[11px] text-zinc-500">{subtitle}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {kind === "animation" ? (
            <>
              <button
                type="button"
                onClick={onTogglePresetList}
                className={`h-8 rounded-md border px-3 text-xs font-semibold transition ${isPresetListOpen
                  ? "border-sky-400 bg-sky-400 text-zinc-950"
                  : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600 hover:text-zinc-100"
                  }`}
              >
                Add Shot
              </button>
              <button
                type="button"
                onClick={onClearAnimations}
                className="h-8 rounded-md border border-zinc-800 px-3 text-xs font-semibold text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-100"
              >
                Clear
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => onAddTrack(kind)}
            className="h-8 rounded-md border border-zinc-800 px-2 text-xs font-semibold text-zinc-300 transition hover:border-zinc-600 hover:text-zinc-100"
          >
            Track +
          </button>
        </div>
      </div>
      <div className="max-h-32 overflow-auto">
        {tracks.map((track) => (
          <div
            key={track.id}
            className="grid h-16 border-b border-zinc-900 last:border-b-0"
            style={{ gridTemplateColumns: "156px 1fr" }}
          >
            <div className="flex items-center gap-1 border-r border-zinc-800 px-2">
              <button
                type="button"
                onClick={() => onMuteTrack(kind, track.id)}
                className={`grid h-7 w-7 place-items-center rounded border text-[10px] font-bold ${track.muted
                  ? "border-red-400 bg-red-500 text-white"
                  : "border-zinc-800 bg-zinc-900 text-zinc-300"
                  }`}
                title={track.muted ? "Unmute track" : "Mute track"}
              >
                M
              </button>
              <button
                type="button"
                onClick={() => onReorderTrack(kind, track.id, -1)}
                className="grid h-7 w-7 place-items-center rounded border border-zinc-800 bg-zinc-900 text-xs text-zinc-300"
                title="Move track up"
              >
                ^
              </button>
              <button
                type="button"
                onClick={() => onReorderTrack(kind, track.id, 1)}
                className="grid h-7 w-7 place-items-center rounded border border-zinc-800 bg-zinc-900 text-xs text-zinc-300"
                title="Move track down"
              >
                v
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-zinc-200">
                  {track.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onDuplicateTrack(kind, track)}
                className="grid h-7 w-7 place-items-center rounded border border-zinc-800 bg-zinc-900 text-xs text-zinc-300"
                title="Duplicate track"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => onDeleteTrack(kind, track.id)}
                className="grid h-7 w-7 place-items-center rounded border border-zinc-800 bg-zinc-900 text-xs text-zinc-300"
                title="Delete track"
              >
                x
              </button>
            </div>
            <div className="relative overflow-hidden">
              <div className="relative h-full" style={{ width: timelineWidth }}>
                <div
                  className="absolute inset-y-0 w-px bg-sky-300 shadow-[0_0_16px_rgba(56,189,248,0.9)]"
                  style={{ left: playheadX }}
                />
                {clips
                  .filter((clip) => clip.trackId === track.id)
                  .map((clip) => renderClip(kind, clip))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div
      ref={timelineRootRef}
      className="h-72 shrink-0 border-t border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-100"
      onPointerMove={updateClipEdit}
      onPointerUp={endClipEdit}
    >
      <div className="flex h-full flex-col gap-2">
        <div className="flex items-center gap-3 rounded-md border border-zinc-800 bg-zinc-950/80 px-2 py-2">
          <button
            type="button"
            onClick={onToggleMasterPlayback}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-sky-400 bg-sky-400 text-zinc-950 transition hover:bg-sky-300"
            title={isMasterPlaying ? "Pause all timelines" : "Play all timelines"}
          >
            <PlayTrackIcon isPlaying={isMasterPlaying} />
          </button>
          <div className="w-20 text-xs font-semibold text-zinc-400">
            {formatDuration(timelineTime)}
          </div>
          <input
            aria-label="Master timeline playhead"
            type="range"
            min={0}
            max={timelineDuration}
            step={1 / 60}
            value={timelineTime}
            onChange={(event) => onSeek(Number(event.target.value))}
            className="min-w-0 flex-1 accent-sky-400"
          />
          <input
            aria-label="Jump to timestamp"
            type="number"
            min={0}
            max={timelineDuration}
            step={0.1}
            value={Number(timelineTime.toFixed(2))}
            onChange={(event) => onSeek(Number(event.target.value))}
            className="h-9 w-20 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-100 outline-none focus:border-sky-400"
          />
          <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Zoom
            <input
              aria-label="Timeline zoom"
              type="range"
              min={0.55}
              max={2.6}
              step={0.05}
              value={timelineZoom}
              onChange={(event) => onTimelineZoomChange(Number(event.target.value))}
              className="w-28 accent-sky-400"
            />
          </label>
        </div>
        {isPresetListOpen ? (
          <div className="flex h-9 items-center gap-1 overflow-x-auto">
            {MOVEMENT_PRESETS.map((movement) => (
              <button
                key={movement.id}
                type="button"
                onClick={() => onAddMovementToTrack(movement)}
                className="flex h-8 shrink-0 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-xs font-semibold text-zinc-200 transition hover:border-sky-400 hover:bg-zinc-800"
              >
                <span
                  className={`grid h-5 w-5 place-items-center rounded text-[9px] font-bold ${movement.colorClass}`}
                >
                  {movement.shortLabel}
                </span>
                {movement.name}
              </button>
            ))}
          </div>
        ) : null}
        <div className="grid min-h-0 flex-1 grid-rows-2 gap-2">
          {renderSection(
            "media",
            "Media Track",
            `${mediaTrackLabel} - ${mediaTrackSubtitle}`,
            orderedMediaTracks,
            mediaClips,
            isMediaPlaying,
            onToggleMediaPlayback,
          )}
          {renderSection(
            "animation",
            "Animation Track",
            animationClips.length
              ? `${animationClips.length} shots - ${formatDuration(getTimelineEnd(animationClips))}`
              : "Add a shot, then press play",
            orderedAnimationTracks,
            animationClips,
            isAnimationPlaying,
            onToggleAnimationPlayback,
          )}
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [canvasBackgroundColor, setCanvasBackgroundColor] = useState(
    DEFAULT_CANVAS_BACKGROUND_COLOR,
  );
  const [selectedDevice, setSelectedDevice] = useState(devices[0]);
  const [websiteUrl, setWebsiteUrl] = useState(DEFAULT_WEBSITE_URL);
  const [screenContent, setScreenContent] = useState<ScreenContent>({
    label: "Website",
    type: "website",
    url: DEFAULT_WEBSITE_URL,
  });
  const [isRotateMode, setIsRotateMode] = useState(true);
  const [isMediaPlaying, setIsMediaPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTransitionsOpen, setIsTransitionsOpen] = useState(false);
  const [timelineTime, setTimelineTime] = useState(0);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [isMasterPlaying, setIsMasterPlaying] = useState(false);
  const [isAnimationTimelinePlaying, setIsAnimationTimelinePlaying] =
    useState(false);
  const [isMediaTimelinePlaying, setIsMediaTimelinePlaying] = useState(false);
  const [activeMovement, setActiveMovement] = useState<MovementPreset | null>(
    null,
  );
  const [activeTrackClipId, setActiveTrackClipId] = useState<number | null>(
    null,
  );
  const [isPointerOnDevice, setIsPointerOnDevice] = useState(false);
  const [isDraggingBackground, setIsDraggingBackground] = useState(false);
  const [isDraggingDevice, setIsDraggingDevice] = useState(false);
  const [movementPlaySignal, setMovementPlaySignal] = useState(0);
  const [modelPositionOffset, setModelPositionOffset] = useState<
    [number, number, number]
  >(DEFAULT_MODEL_POSITION);
  const [gestureImpulse, setGestureImpulse] = useState<GestureImpulse>({
    deltaX: 0,
    deltaY: 0,
    signal: 0,
    target: "scene",
  });
  const [mediaTracks, setMediaTracks] = useState<TimelineTrack[]>([
    {
      id: DEFAULT_MEDIA_TRACK_ID,
      kind: "media",
      muted: false,
      name: "Media 1",
      order: 0,
    },
  ]);
  const [animationTracks, setAnimationTracks] = useState<TimelineTrack[]>([
    {
      id: DEFAULT_ANIMATION_TRACK_ID,
      kind: "animation",
      muted: false,
      name: "Animation 1",
      order: 0,
    },
  ]);
  const [mediaClips, setMediaClips] = useState<MediaTimelineClip[]>([
    {
      clipId: 1,
      duration: DEFAULT_STILL_DURATION,
      enabled: true,
      kind: "website",
      label: "Website",
      start: 0,
      trackId: DEFAULT_MEDIA_TRACK_ID,
    },
  ]);
  const [transitionTrack, setTransitionTrack] = useState<TransitionClip[]>([]);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const [recordedFileName, setRecordedFileName] = useState(
    "device-simulator-recording.webm",
  );
  const [mediaDuration, setMediaDuration] = useState(0);
  const [mediaPlaySignal, setMediaPlaySignal] = useState(0);
  const [recordingError, setRecordingError] = useState("");
  const [resetSignal, setResetSignal] = useState(0);
  const captureStreamRef = useRef<MediaStream | null>(null);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);
  const recordingAnimationFrameRef = useRef<number | null>(null);
  const recordingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const recordingVideoRef = useRef<HTMLVideoElement | null>(null);
  const recordedVideoUrlRef = useRef<string | null>(null);
  const backgroundDragStartRef = useRef<{
    pointerX: number;
    pointerY: number;
    position: [number, number, number];
  } | null>(null);
  const isPointerOnDeviceRef = useRef(false);
  const mediaClipIdRef = useRef(1);
  const playbackAnimationFrameRef = useRef<number | null>(null);
  const playbackStateRef = useRef({
    animation: false,
    duration: DEFAULT_STILL_DURATION,
    master: false,
    media: false,
    time: 0,
  });
  const screenMediaObjectUrlRef = useRef<string | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const transitionClipIdRef = useRef(0);
  const trackPlaybackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const motionProfile = MOTION_PROFILES[0];
  const speedProfile = SPEED_PROFILES[1];
  const transitionTrackDuration = useMemo(
    () =>
      getTimelineEnd(transitionTrack),
    [transitionTrack],
  );
  const mediaTrackDuration = useMemo(
    () => getTimelineEnd(mediaClips),
    [mediaClips],
  );
  const timelineDuration = Math.max(
    DEFAULT_STILL_DURATION,
    mediaTrackDuration,
    transitionTrackDuration,
  );
  const timelineAnimationSample = useMemo(
    () =>
      sampleAnimationTimeline(
        timelineTime,
        transitionTrack,
        animationTracks,
        motionProfile,
      ),
    [animationTracks, motionProfile, timelineTime, transitionTrack],
  );
  const activeMediaClip = useMemo(() => {
    const mutedTracks = getTrackMutedMap(mediaTracks);

    return mediaClips.find(
      (clip) =>
        clip.enabled &&
        !mutedTracks.get(clip.trackId) &&
        timelineTime >= clip.start &&
        timelineTime <= clip.start + clip.duration,
    );
  }, [mediaClips, mediaTracks, timelineTime]);
  const mediaClipStart = activeMediaClip?.start ?? 0;
  const mediaTimelineTime = activeMediaClip
    ? timelineTime
    : screenContent.type === "video"
      ? 0
      : timelineTime;
  const timelineActiveAnimationClipId = useMemo(
    () =>
      transitionTrack.find(
        (clip) =>
          timelineTime >= clip.start && timelineTime <= clip.start + clip.duration,
      )?.clipId ?? null,
    [timelineTime, transitionTrack],
  );
  const mediaTrackLabel =
    screenContent.type === "website"
      ? "Website"
      : screenContent.type === "image"
        ? "Photo"
        : "Video";
  const mediaTrackSubtitle =
    screenContent.type === "video"
      ? formatMediaDuration(mediaDuration)
      : screenContent.type === "image"
        ? "Still"
        : "Live page";
  const controlsEnabled = false;

  useEffect(() => {
    isPointerOnDeviceRef.current = isPointerOnDevice;
  }, [isPointerOnDevice]);

  useEffect(() => {
    setMediaClips((currentClips) => {
      const nextDuration =
        screenContent.type === "video"
          ? Math.max(mediaDuration || DEFAULT_STILL_DURATION, MIN_CLIP_DURATION)
          : DEFAULT_STILL_DURATION;
      const [firstClip] = currentClips;

      if (!firstClip) {
        mediaClipIdRef.current += 1;

        return [
          {
            clipId: mediaClipIdRef.current,
            duration: nextDuration,
            enabled: true,
            kind: screenContent.type,
            label: screenContent.label,
            start: 0,
            trackId: mediaTracks[0]?.id ?? DEFAULT_MEDIA_TRACK_ID,
          },
        ];
      }

      return [
        {
          ...firstClip,
          duration: nextDuration,
          kind: screenContent.type,
          label: screenContent.label,
        },
        ...currentClips.slice(1),
      ];
    });
  }, [mediaDuration, mediaTracks, screenContent]);

  useEffect(() => {
    playbackStateRef.current = {
      animation: isAnimationTimelinePlaying,
      duration: timelineDuration,
      master: isMasterPlaying,
      media: isMediaTimelinePlaying,
      time: timelineTime,
    };
  }, [
    isAnimationTimelinePlaying,
    isMasterPlaying,
    isMediaTimelinePlaying,
    timelineDuration,
    timelineTime,
  ]);

  const revokeUploadedScreenMedia = () => {
    if (screenMediaObjectUrlRef.current) {
      URL.revokeObjectURL(screenMediaObjectUrlRef.current);
      screenMediaObjectUrlRef.current = null;
    }
  };

  useEffect(() => {
    const shouldPlay =
      isMasterPlaying || isAnimationTimelinePlaying || isMediaTimelinePlaying;

    if (!shouldPlay) {
      if (playbackAnimationFrameRef.current !== null) {
        cancelAnimationFrame(playbackAnimationFrameRef.current);
        playbackAnimationFrameRef.current = null;
      }
      return;
    }

    let previousFrameTime = performance.now();

    const tick = (frameTime: number) => {
      const deltaSeconds = Math.min(
        Math.max((frameTime - previousFrameTime) / 1000, 0),
        0.08,
      );

      previousFrameTime = frameTime;

      setTimelineTime((currentTime) => {
        const nextTime = Math.min(
          currentTime + deltaSeconds,
          playbackStateRef.current.duration,
        );

        if (nextTime >= playbackStateRef.current.duration) {
          setIsMasterPlaying(false);
          setIsAnimationTimelinePlaying(false);
          setIsMediaTimelinePlaying(false);
        }

        return nextTime;
      });

      playbackAnimationFrameRef.current = requestAnimationFrame(tick);
    };

    playbackAnimationFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (playbackAnimationFrameRef.current !== null) {
        cancelAnimationFrame(playbackAnimationFrameRef.current);
        playbackAnimationFrameRef.current = null;
      }
    };
  }, [isAnimationTimelinePlaying, isMasterPlaying, isMediaTimelinePlaying]);

  const stopCaptureStream = () => {
    if (recordingAnimationFrameRef.current !== null) {
      cancelAnimationFrame(recordingAnimationFrameRef.current);
      recordingAnimationFrameRef.current = null;
    }

    if (recordingVideoRef.current) {
      recordingVideoRef.current.pause();
      recordingVideoRef.current.srcObject = null;
      recordingVideoRef.current = null;
    }

    captureStreamRef.current?.getTracks().forEach((track) => track.stop());
    captureStreamRef.current = null;
    displayStreamRef.current?.getTracks().forEach((track) => track.stop());
    displayStreamRef.current = null;
    recordingCanvasRef.current = null;
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

  const getStageRecordingSize = (stageRect: DOMRect) => {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const rawWidth = Math.max(2, Math.round(stageRect.width * pixelRatio));
    const rawHeight = Math.max(2, Math.round(stageRect.height * pixelRatio));
    const fitScale = Math.min(
      1,
      RECORDING_MAX_WIDTH / rawWidth,
      RECORDING_MAX_HEIGHT / rawHeight,
    );

    return {
      height: Math.max(2, Math.round(rawHeight * fitScale)),
      width: Math.max(2, Math.round(rawWidth * fitScale)),
    };
  };

  const createStageRecordingStream = async (sourceStream: MediaStream) => {
    const stage = stageRef.current;

    if (!stage) {
      throw new Error("Canvas stage is not ready for recording.");
    }

    const stageRect = stage.getBoundingClientRect();
    const { height, width } = getStageRecordingSize(stageRect);
    const recordingCanvas = document.createElement("canvas");
    const recordingContext = recordingCanvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    });

    if (!recordingContext) {
      throw new Error("Could not create the recording canvas.");
    }

    const sourceVideo = document.createElement("video");

    recordingCanvas.height = height;
    recordingCanvas.width = width;
    sourceVideo.muted = true;
    sourceVideo.playsInline = true;
    sourceVideo.srcObject = sourceStream;

    await sourceVideo.play();

    const drawFrame = () => {
      if (!stageRef.current || !sourceVideo.videoWidth || !sourceVideo.videoHeight) {
        recordingAnimationFrameRef.current = requestAnimationFrame(drawFrame);
        return;
      }

      const liveStageRect = stageRef.current.getBoundingClientRect();
      const scaleX = sourceVideo.videoWidth / window.innerWidth;
      const scaleY = sourceVideo.videoHeight / window.innerHeight;
      const sourceX = Math.max(0, liveStageRect.left * scaleX);
      const sourceY = Math.max(0, liveStageRect.top * scaleY);
      const sourceWidth = Math.min(
        sourceVideo.videoWidth - sourceX,
        liveStageRect.width * scaleX,
      );
      const sourceHeight = Math.min(
        sourceVideo.videoHeight - sourceY,
        liveStageRect.height * scaleY,
      );

      recordingContext.fillStyle = canvasBackgroundColor;
      recordingContext.fillRect(0, 0, width, height);

      if (sourceWidth > 0 && sourceHeight > 0) {
        recordingContext.drawImage(
          sourceVideo,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          0,
          0,
          width,
          height,
        );
      }

      recordingAnimationFrameRef.current = requestAnimationFrame(drawFrame);
    };

    drawFrame();

    const outputStream = recordingCanvas.captureStream(60);

    const [outputVideoTrack] = outputStream.getVideoTracks();

    if (outputVideoTrack) {
      outputVideoTrack.contentHint = "motion";
    }

    recordingCanvasRef.current = recordingCanvas;
    recordingVideoRef.current = sourceVideo;

    return outputStream;
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
      const sourceStream = await getLiveRecordingStream();

      displayStreamRef.current = sourceStream;

      const stream = await createStageRecordingStream(sourceStream);
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

      sourceStream.getVideoTracks()[0]?.addEventListener(
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
      if (trackPlaybackTimeoutRef.current) {
        clearTimeout(trackPlaybackTimeoutRef.current);
      }

      if (playbackAnimationFrameRef.current !== null) {
        cancelAnimationFrame(playbackAnimationFrameRef.current);
      }

      stopCaptureStream();

      if (recordedVideoUrlRef.current) {
        URL.revokeObjectURL(recordedVideoUrlRef.current);
      }

      revokeUploadedScreenMedia();
    },
    [],
  );

  const resetInteractiveView = () => {
    backgroundDragStartRef.current = null;
    isPointerOnDeviceRef.current = false;
    setIsMasterPlaying(false);
    setIsAnimationTimelinePlaying(false);
    setIsMediaTimelinePlaying(false);
    setIsDraggingBackground(false);
    setIsDraggingDevice(false);
    setIsPointerOnDevice(false);
    setModelPositionOffset(DEFAULT_MODEL_POSITION);
    setGestureImpulse((currentImpulse) => ({
      deltaX: 0,
      deltaY: 0,
      signal: currentImpulse.signal + 1,
      target: "scene",
    }));
    controlsRef.current?.reset();
    setResetSignal((currentSignal) => currentSignal + 1);
  };

  const stopTransitionTrack = () => {
    if (trackPlaybackTimeoutRef.current) {
      clearTimeout(trackPlaybackTimeoutRef.current);
      trackPlaybackTimeoutRef.current = null;
    }

    setActiveTrackClipId(null);
    setIsAnimationTimelinePlaying(false);
    setIsMasterPlaying(false);
  };

  const playMovement = (movement: MovementPreset) => {
    setActiveMovement(movement);
    setMovementPlaySignal((currentSignal) => currentSignal + 1);
  };

  const playTrackClip = (clip: TransitionClip) => {
    stopTransitionTrack();
    setActiveTrackClipId(clip.clipId);
    setTimelineTime(clip.start);
    playMovement(clip);
  };

  const addMovementToTrack = (movement: MovementPreset) => {
    setTransitionTrack((currentTrack) => {
      transitionClipIdRef.current += 1;
      const duration = getMovementDuration(movement, motionProfile, speedProfile);
      const trackId =
        getOrderedTracks(animationTracks, "animation")[0]?.id ??
        DEFAULT_ANIMATION_TRACK_ID;

      return [
        ...currentTrack,
        {
          ...movement,
          clipId: transitionClipIdRef.current,
          duration,
          enabled: true,
          start: snapTimelineTime(getTimelineEnd(currentTrack)),
          trackId,
        },
      ];
    });
  };

  const clearTransitionTrack = () => {
    stopTransitionTrack();
    setTransitionTrack([]);
  };

  const seekTimeline = (time: number) => {
    const nextTime = MathUtils.clamp(time, 0, timelineDuration);

    setTimelineTime(nextTime);
  };

  const toggleMasterPlayback = () => {
    const shouldPlay = !isMasterPlaying;

    setIsMasterPlaying(shouldPlay);
    setIsAnimationTimelinePlaying(shouldPlay);
    setIsMediaTimelinePlaying(shouldPlay);
    setIsMediaPlaying(shouldPlay && screenContent.type === "video");
    setMediaPlaySignal((currentSignal) => currentSignal + 1);
  };

  const toggleAnimationTimelinePlayback = () => {
    setIsAnimationTimelinePlaying((isPlaying) => !isPlaying);
    setIsMasterPlaying(false);
  };

  const toggleMediaTimelinePlayback = () => {
    const shouldPlay = !isMediaTimelinePlaying;

    setIsMediaTimelinePlaying(shouldPlay);
    setIsMediaPlaying(shouldPlay && screenContent.type === "video");
    setIsMasterPlaying(false);
    setMediaPlaySignal((currentSignal) => currentSignal + 1);
  };

  const updateTracks = (
    kind: TimelineTrackKind,
    updater: (tracks: TimelineTrack[]) => TimelineTrack[],
  ) => {
    if (kind === "media") {
      setMediaTracks(updater);
      return;
    }

    setAnimationTracks(updater);
  };

  const addTimelineTrack = (kind: TimelineTrackKind) => {
    updateTracks(kind, (currentTracks) => [
      ...currentTracks,
      {
        id: `${kind}-track-${Date.now()}`,
        kind,
        muted: false,
        name: `${kind === "media" ? "Media" : "Animation"} ${currentTracks.length + 1}`,
        order: currentTracks.length,
      },
    ]);
  };

  const duplicateTimelineTrack = (kind: TimelineTrackKind, track: TimelineTrack) => {
    const nextTrackId = `${kind}-track-${Date.now()}`;

    updateTracks(kind, (currentTracks) => [
      ...currentTracks,
      {
        ...track,
        id: nextTrackId,
        muted: false,
        name: `${track.name} Copy`,
        order: currentTracks.length,
      },
    ]);

    if (kind === "animation") {
      setTransitionTrack((currentClips) => [
        ...currentClips,
        ...currentClips
          .filter((clip) => clip.trackId === track.id)
          .map((clip) => {
            transitionClipIdRef.current += 1;

            return {
              ...clip,
              clipId: transitionClipIdRef.current,
              start: snapTimelineTime(clip.start + clip.duration),
              trackId: nextTrackId,
            };
          }),
      ]);
      return;
    }

    setMediaClips((currentClips) => [
      ...currentClips,
      ...currentClips
        .filter((clip) => clip.trackId === track.id)
        .map((clip) => {
          mediaClipIdRef.current += 1;

          return {
            ...clip,
            clipId: mediaClipIdRef.current,
            start: snapTimelineTime(clip.start + clip.duration),
            trackId: nextTrackId,
          };
        }),
    ]);
  };

  const deleteTimelineTrack = (kind: TimelineTrackKind, trackId: string) => {
    updateTracks(kind, (currentTracks) => {
      if (currentTracks.length <= 1) {
        return currentTracks;
      }

      return currentTracks
        .filter((track) => track.id !== trackId)
        .map((track, order) => ({ ...track, order }));
    });

    if (kind === "animation") {
      setTransitionTrack((currentClips) =>
        currentClips.filter((clip) => clip.trackId !== trackId),
      );
      return;
    }

    setMediaClips((currentClips) =>
      currentClips.filter((clip) => clip.trackId !== trackId),
    );
  };

  const toggleTimelineTrackMute = (kind: TimelineTrackKind, trackId: string) => {
    updateTracks(kind, (currentTracks) =>
      currentTracks.map((track) =>
        track.id === trackId ? { ...track, muted: !track.muted } : track,
      ),
    );
  };

  const reorderTimelineTrack = (
    kind: TimelineTrackKind,
    trackId: string,
    direction: -1 | 1,
  ) => {
    updateTracks(kind, (currentTracks) => {
      const orderedTracks = getOrderedTracks(currentTracks, kind);
      const currentIndex = orderedTracks.findIndex((track) => track.id === trackId);
      const nextIndex = MathUtils.clamp(
        currentIndex + direction,
        0,
        orderedTracks.length - 1,
      );

      if (currentIndex === -1 || currentIndex === nextIndex) {
        return currentTracks;
      }

      const [movedTrack] = orderedTracks.splice(currentIndex, 1);

      orderedTracks.splice(nextIndex, 0, movedTrack);

      return orderedTracks.map((track, order) => ({ ...track, order }));
    });
  };

  const updateTimelineClip = (
    kind: TimelineTrackKind,
    clipId: number,
    updater: (
      clip: TransitionClip | MediaTimelineClip,
    ) => TransitionClip | MediaTimelineClip,
  ) => {
    if (kind === "animation") {
      setTransitionTrack((currentClips) =>
        currentClips.map((clip) =>
          clip.clipId === clipId ? (updater(clip) as TransitionClip) : clip,
        ),
      );
      return;
    }

    setMediaClips((currentClips) =>
      currentClips.map((clip) =>
        clip.clipId === clipId ? (updater(clip) as MediaTimelineClip) : clip,
      ),
    );
  };

  const deleteTimelineClip = (kind: TimelineTrackKind, clipId: number) => {
    if (kind === "animation") {
      setTransitionTrack((currentClips) =>
        currentClips.filter((clip) => clip.clipId !== clipId),
      );
      return;
    }

    setMediaClips((currentClips) =>
      currentClips.filter((clip) => clip.clipId !== clipId),
    );
  };

  const handleSelectDevice = (device: (typeof devices)[number]) => {
    backgroundDragStartRef.current = null;
    isPointerOnDeviceRef.current = false;
    setSelectedDevice(device);
    setIsDraggingBackground(false);
    setIsDraggingDevice(false);
    setIsPointerOnDevice(false);
    setModelPositionOffset(DEFAULT_MODEL_POSITION);
    setResetSignal((currentSignal) => currentSignal + 1);
  };

  const handleWebsiteChange = (url: string) => {
    revokeUploadedScreenMedia();
    setWebsiteUrl(url);
    setScreenContent({
      label: "Website",
      type: "website",
      url,
    });
    setIsMediaPlaying(false);
    setIsMediaTimelinePlaying(false);
    setIsMasterPlaying(false);
    setMediaDuration(0);
  };

  const handleScreenMediaUpload = (file: File) => {
    const isVideoFile = file.type.startsWith("video/");
    const isImageFile = file.type.startsWith("image/");

    if (!isVideoFile && !isImageFile) {
      return;
    }

    revokeUploadedScreenMedia();

    const mediaUrl = URL.createObjectURL(file);

    screenMediaObjectUrlRef.current = mediaUrl;
    setScreenContent({
      label: file.name,
      mimeType: file.type,
      type: isVideoFile ? "video" : "image",
      url: mediaUrl,
    });
    setIsMediaPlaying(false);
    setIsMediaTimelinePlaying(false);
    setIsMasterPlaying(false);
    setMediaDuration(0);
    setMediaPlaySignal((currentSignal) => currentSignal + 1);
  };

  const handleUseWebsiteContent = () => {
    handleWebsiteChange(websiteUrl);
  };

  const handleDeviceDragEnd = useCallback(() => {
    setIsDraggingDevice(false);
  }, []);

  const handleDeviceDragStart = useCallback(() => {
    backgroundDragStartRef.current = null;
    isPointerOnDeviceRef.current = true;
    setIsDraggingBackground(false);
    setIsDraggingDevice(true);
  }, []);

  const handleDeviceHoverEnd = useCallback(() => {
    isPointerOnDeviceRef.current = false;
    setIsPointerOnDevice(false);
  }, []);

  const handleDeviceHoverStart = useCallback(() => {
    isPointerOnDeviceRef.current = true;
    setIsPointerOnDevice(true);
  }, []);

  const handleStagePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (
        !isRotateMode ||
        event.button !== 0 ||
        isDraggingDevice ||
        isPointerOnDeviceRef.current
      ) {
        return;
      }

      event.preventDefault();
      backgroundDragStartRef.current = {
        pointerX: event.clientX,
        pointerY: event.clientY,
        position: [...modelPositionOffset],
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsDraggingBackground(true);
      setIsDraggingDevice(false);
    },
    [isDraggingDevice, isRotateMode, modelPositionOffset],
  );

  const handleStagePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const dragStart = backgroundDragStartRef.current;

      if (!isRotateMode || !isDraggingBackground || !dragStart) {
        return;
      }

      if (event.buttons === 0) {
        backgroundDragStartRef.current = null;
        setIsDraggingBackground(false);
        return;
      }

      event.preventDefault();
      const deltaX = event.clientX - dragStart.pointerX;
      const deltaY = event.clientY - dragStart.pointerY;

      setModelPositionOffset(
        clampModelPosition([
          dragStart.position[0] + deltaX * MODEL_POSITION_DRAG_SENSITIVITY,
          dragStart.position[1] - deltaY * MODEL_POSITION_DRAG_SENSITIVITY,
          dragStart.position[2],
        ]),
      );
    },
    [isDraggingBackground, isRotateMode],
  );

  const handleStagePointerEnd = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      backgroundDragStartRef.current = null;
      setIsDraggingBackground(false);
      setIsDraggingDevice(false);

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [],
  );

  const handleStageWheel = useCallback(
    (event: React.WheelEvent<HTMLElement>) => {
      if (!isRotateMode) {
        return;
      }

      event.preventDefault();
      const deltaX = MathUtils.clamp(event.deltaX, -140, 140);
      const deltaY = MathUtils.clamp(event.deltaY, -140, 140);

      setModelPositionOffset((currentPosition) =>
        clampModelPosition([
          currentPosition[0],
          currentPosition[1],
          currentPosition[2] - deltaY * MODEL_DEPTH_WHEEL_SENSITIVITY,
        ]),
      );

      if (!isPointerOnDevice || Math.abs(deltaX) < 2) {
        return;
      }

      setGestureImpulse((currentImpulse) => ({
        deltaX,
        deltaY: 0,
        signal: currentImpulse.signal + 1,
        target: "device",
      }));
    },
    [isPointerOnDevice, isRotateMode],
  );

  return (
    <main className="flex min-h-screen bg-zinc-950">
      <DeviceSidebar
        canvasBackgroundColor={canvasBackgroundColor}
        onCanvasBackgroundColorChange={setCanvasBackgroundColor}
        selectedDeviceId={selectedDevice.id}
        onSelectDevice={handleSelectDevice}
        screenContentName={screenContent.label}
        screenContentType={screenContent.type}
        websiteUrl={websiteUrl}
        onMediaUpload={handleScreenMediaUpload}
        onUseWebsiteContent={handleUseWebsiteContent}
        onWebsiteChange={handleWebsiteChange}
      />
      <section
        className="flex h-screen min-w-0 flex-1 flex-col"
        style={{ backgroundColor: canvasBackgroundColor }}
      >
        <div
          ref={stageRef}
          className="relative min-h-0 flex-1 [&_canvas]:h-full [&_canvas]:w-full"
          onPointerDown={handleStagePointerDown}
          onPointerLeave={handleStagePointerEnd}
          onPointerMove={handleStagePointerMove}
          onPointerUp={handleStagePointerEnd}
          onWheel={handleStageWheel}
        >
          <Canvas
            className="h-full w-full"
            camera={{ position: DEFAULT_CAMERA_POSITION, fov: 45 }}
            dpr={[1, 2]}
            shadows={{ enabled: true, type: PCFSoftShadowMap }}
            gl={{
              alpha: false,
              antialias: true,
              depth: true,
              outputColorSpace: SRGBColorSpace,
              powerPreference: "high-performance",
              stencil: false,
              toneMapping: ACESFilmicToneMapping,
              toneMappingExposure: 1.08,
            }}
          >
            <color attach="background" args={[canvasBackgroundColor]} />
            <hemisphereLight args={["#f8fbff", "#111118", 0.45]} />
            <ambientLight intensity={0.7} />
            <directionalLight castShadow position={[3, 4, 5]} intensity={2.2} />
            <directionalLight position={[-4, 2, -3]} intensity={0.8} />
            <pointLight position={[-2.5, 1.8, 2.2]} intensity={0.55} />
            <pointLight
              color="#ffd6a6"
              position={[2.2, -1.4, 2.8]}
              intensity={0.35}
            />
            <spotLight
              angle={0.38}
              penumbra={0.82}
              position={[0, 3.5, 4]}
              intensity={1.1}
            />
            <SceneCameraDefaults
              activeMovement={activeMovement}
              controlsRef={controlsRef}
              deviceId={selectedDevice.id}
              gestureImpulse={gestureImpulse}
              isPointerOnDevice={isPointerOnDevice}
              motionProfile={motionProfile}
              movementPlaySignal={movementPlaySignal}
              resetSignal={resetSignal}
              speedProfile={speedProfile}
              timelineCameraOffset={timelineAnimationSample?.camera ?? [0, 0, 0]}
            />

            <Suspense fallback={null}>
              <DeviceModel
                key={selectedDevice.modelPath}
                activeMovement={activeMovement}
                device={selectedDevice}
                gestureImpulse={gestureImpulse}
                isDraggingDevice={isDraggingDevice}
                isMediaPlaying={
                  isMediaPlaying &&
                  !!activeMediaClip &&
                  screenContent.type === "video"
                }
                isPointerOnDevice={isPointerOnDevice}
                movementPlaySignal={movementPlaySignal}
                motionProfile={motionProfile}
                isRotateMode={isRotateMode}
                mediaClipStart={mediaClipStart}
                mediaTimelineTime={mediaTimelineTime}
                mediaPlaySignal={mediaPlaySignal}
                modelPositionOffset={modelPositionOffset}
                resetSignal={resetSignal}
                screenContent={screenContent}
                speedProfile={speedProfile}
                timelineSample={timelineAnimationSample}
                onDeviceDragEnd={handleDeviceDragEnd}
                onDeviceDragStart={handleDeviceDragStart}
                onDeviceHoverEnd={handleDeviceHoverEnd}
                onDeviceHoverStart={handleDeviceHoverStart}
                onMediaDurationChange={setMediaDuration}
                onMediaEnded={() => setIsMediaPlaying(false)}
                onMediaPlayStateChange={setIsMediaPlaying}
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
        </div>
        <TimelineEditor
          activeAnimationClipId={activeTrackClipId ?? timelineActiveAnimationClipId}
          animationClips={transitionTrack}
          animationTracks={animationTracks}
          isAnimationPlaying={isAnimationTimelinePlaying}
          isMasterPlaying={isMasterPlaying}
          isMediaPlaying={isMediaTimelinePlaying}
          isPresetListOpen={isTransitionsOpen}
          mediaClips={mediaClips}
          mediaTrackLabel={mediaTrackLabel}
          mediaTrackSubtitle={mediaTrackSubtitle}
          mediaTracks={mediaTracks}
          timelineDuration={timelineDuration}
          timelineTime={timelineTime}
          timelineZoom={timelineZoom}
          onAddMovementToTrack={addMovementToTrack}
          onAddTrack={addTimelineTrack}
          onClearAnimations={clearTransitionTrack}
          onClipDelete={deleteTimelineClip}
          onClipSelect={playTrackClip}
          onClipUpdate={(kind, clipId, update) =>
            updateTimelineClip(kind, clipId, (clip) => ({
              ...clip,
              duration:
                update.duration === undefined
                  ? clip.duration
                  : Math.max(MIN_CLIP_DURATION, update.duration),
              start:
                update.start === undefined
                  ? clip.start
                  : snapTimelineTime(update.start),
              trackId: update.trackId ?? clip.trackId,
            }))
          }
          onDeleteTrack={deleteTimelineTrack}
          onDuplicateTrack={duplicateTimelineTrack}
          onMuteTrack={toggleTimelineTrackMute}
          onReorderTrack={reorderTimelineTrack}
          onSeek={seekTimeline}
          onTimelineZoomChange={setTimelineZoom}
          onToggleAnimationPlayback={toggleAnimationTimelinePlayback}
          onToggleMasterPlayback={toggleMasterPlayback}
          onToggleMediaPlayback={toggleMediaTimelinePlayback}
          onTogglePresetList={() => setIsTransitionsOpen((isOpen) => !isOpen)}
        />
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
        <ToolButton
          active={isTransitionsOpen}
          label="Transitions"
          onClick={() => setIsTransitionsOpen((isOpen) => !isOpen)}
        >
          <TransitionsIcon />
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
