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
  SRGBColorSpace,
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
const MODEL_ROTATION_SENSITIVITY = 0.008;
const RECORDING_MAX_HEIGHT = 1080;
const RECORDING_MAX_WIDTH = 1920;
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
      velocity[0];
    const targetY =
      basePosition[1] +
      Math.cos(elapsedTime * 0.18) * idleOrbit * 0.35 +
      impulse[1] +
      velocity[1] +
      (1 - entranceProgress) * 0.04;
    const targetZ =
      basePosition[2] +
      Math.sin(elapsedTime * 0.16) * idleDolly +
      impulse[2] +
      velocity[2] +
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
  });

  return null;
}

const WebsiteScreen = memo(function WebsiteScreen({
  isVisible,
  device,
  websiteUrl,
  isRotateMode,
  onDeviceDragEnd,
  onDeviceDragMove,
  onDeviceDragStart,
  onDeviceHoverEnd,
  onDeviceHoverStart,
}: {
  isVisible: boolean;
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
      eps={0.001}
      zIndexRange={[1, 0]}
    >
      <div
        className="overflow-hidden bg-white"
        style={{
          opacity: isVisible ? 1 : 0,
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
            transform: "translate3d(0, 0, 0)",
            willChange: "transform",
          }}
        />
      </div>
    </Html>
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
  websiteUrl,
  isRotateMode,
  modelPositionOffset,
  resetSignal,
  speedProfile,
  onDeviceDragEnd,
  onDeviceDragStart,
  onDeviceHoverEnd,
  onDeviceHoverStart,
}: {
  activeMovement: MovementPreset | null;
  device: (typeof devices)[number];
  gestureImpulse: GestureImpulse;
  isDraggingDevice: boolean;
  isPointerOnDevice: boolean;
  movementPlaySignal: number;
  motionProfile: MotionProfile;
  websiteUrl: string;
  isRotateMode: boolean;
  modelPositionOffset: [number, number, number];
  resetSignal: number;
  speedProfile: SpeedProfile;
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
  const currentPositionRef = useRef<[number, number, number]>([
    ...DEFAULT_MODEL_POSITION,
  ]);
  const hoverInfluenceRef = useRef<[number, number]>([0, 0]);
  const hoverTargetRef = useRef<[number, number]>([0, 0]);

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
  const [isScreenVisible, setIsScreenVisible] = useState(true);

  const rotateDevice = useCallback((movementX: number, movementY: number) => {
    movementAnimationRef.current = null;
    groupRef.current?.position.set(...modelPositionOffset);
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
  }, [modelPositionOffset, motionProfile, speedProfile]);

  useEffect(() => {
    improveTextureQuality(scene, gl.capabilities.getMaxAnisotropy());
  }, [gl, scene]);

  useLayoutEffect(() => {
    const { modelRotation } = getDeviceViewDefaults(device.id);
    const nextRotation: [number, number, number] = [...modelRotation];

    currentRotationRef.current = [...nextRotation];
    currentPositionRef.current = [...modelPositionOffset];
    targetRotationRef.current = [...nextRotation];
    movementAnimationRef.current = null;
    rotationVelocityRef.current = [0, 0, 0];
    groupRef.current?.position.set(...modelPositionOffset);
    groupRef.current?.rotation.set(...nextRotation);
  }, [device.id, modelPositionOffset, resetSignal]);

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
      basePosition: [...modelPositionOffset],
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
    modelPositionOffset,
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

      const normalizedY =
        ((currentRotation[1] % (Math.PI * 2)) + Math.PI * 2) %
        (Math.PI * 2);

      const isBackSide =
        normalizedY > Math.PI / 2 &&
        normalizedY < Math.PI * 1.5;

      setIsScreenVisible(!isBackSide);

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
    const normalizedY =
      ((currentRotation[1] % (Math.PI * 2)) + Math.PI * 2) %
      (Math.PI * 2);

    const isBackSide =
      normalizedY > Math.PI / 2 &&
      normalizedY < Math.PI * 1.5;

    setIsScreenVisible(!isBackSide);
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
      <primitive object={scene} />
      <WebsiteScreen
        isVisible={isScreenVisible}
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
  const [isTransitionsOpen, setIsTransitionsOpen] = useState(false);
  const [activeMovement, setActiveMovement] = useState<MovementPreset | null>(
    null,
  );
  const [activeTrackClipId, setActiveTrackClipId] = useState<number | null>(
    null,
  );
  const [isPointerOnDevice, setIsPointerOnDevice] = useState(false);
  const [isDraggingBackground, setIsDraggingBackground] = useState(false);
  const [isDraggingDevice, setIsDraggingDevice] = useState(false);
  const [isTrackPlaying, setIsTrackPlaying] = useState(false);
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
  const [transitionTrack, setTransitionTrack] = useState<TransitionClip[]>([]);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const [recordedFileName, setRecordedFileName] = useState(
    "device-simulator-recording.webm",
  );
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
  const stageRef = useRef<HTMLElement | null>(null);
  const transitionClipIdRef = useRef(0);
  const trackPlaybackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const motionProfile = MOTION_PROFILES[0];
  const speedProfile = SPEED_PROFILES[1];
  const transitionTrackDuration = useMemo(
    () =>
      transitionTrack.reduce(
        (totalDuration, clip) =>
          totalDuration + getMovementDuration(clip, motionProfile, speedProfile),
        0,
      ),
    [motionProfile, speedProfile, transitionTrack],
  );
  const controlsEnabled =
    isRotateMode &&
    !isDraggingDevice &&
    (isDraggingBackground || !isPointerOnDevice);

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
    setIsTrackPlaying(false);
  };

  const playMovement = (movement: MovementPreset) => {
    setActiveMovement(movement);
    setMovementPlaySignal((currentSignal) => currentSignal + 1);
  };

  const playTransitionTrack = () => {
    if (!transitionTrack.length) {
      return;
    }

    stopTransitionTrack();
    setIsTrackPlaying(true);

    const playClipAtIndex = (clipIndex: number) => {
      const clip = transitionTrack[clipIndex];

      if (!clip) {
        setActiveTrackClipId(null);
        setIsTrackPlaying(false);
        trackPlaybackTimeoutRef.current = null;
        return;
      }

      setActiveTrackClipId(clip.clipId);
      playMovement(clip);
      trackPlaybackTimeoutRef.current = setTimeout(
        () => playClipAtIndex(clipIndex + 1),
        (getMovementDuration(clip, motionProfile, speedProfile) + 0.25) *
        1000,
      );
    };

    playClipAtIndex(0);
  };

  const playTrackClip = (clip: TransitionClip) => {
    stopTransitionTrack();
    setActiveTrackClipId(clip.clipId);
    playMovement(clip);
    trackPlaybackTimeoutRef.current = setTimeout(() => {
      setActiveTrackClipId(null);
      trackPlaybackTimeoutRef.current = null;
    }, getMovementDuration(clip, motionProfile, speedProfile) * 1000);
  };

  const addMovementToTrack = (movement: MovementPreset) => {
    setTransitionTrack((currentTrack) => {
      transitionClipIdRef.current += 1;

      return [
        ...currentTrack,
        {
          ...movement,
          clipId: transitionClipIdRef.current,
        },
      ];
    });
    playMovement(movement);
  };

  const clearTransitionTrack = () => {
    stopTransitionTrack();
    setTransitionTrack([]);
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

  const handleStageWheel = useCallback(
    (event: React.WheelEvent<HTMLElement>) => {
      if (!isRotateMode) {
        return;
      }

      event.preventDefault();
      const deltaX = MathUtils.clamp(event.deltaX, -140, 140);
      const deltaY = MathUtils.clamp(event.deltaY, -140, 140);

      setGestureImpulse((currentImpulse) => ({
        deltaX,
        deltaY,
        signal: currentImpulse.signal + 1,
        target: isPointerOnDevice ? "device" : "scene",
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
        websiteUrl={websiteUrl}
        onWebsiteChange={handleWebsiteChange}
      />
      <section
        className="flex h-screen min-w-0 flex-1 flex-col"
        style={{ backgroundColor: canvasBackgroundColor }}
      >
        <div
          ref={stageRef}
          className="relative min-h-0 flex-1 [&_canvas]:h-full [&_canvas]:w-full"
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
            />

            <Suspense fallback={null}>
              <DeviceModel
                key={selectedDevice.modelPath}
                activeMovement={activeMovement}
                device={selectedDevice}
                gestureImpulse={gestureImpulse}
                isDraggingDevice={isDraggingDevice}
                isPointerOnDevice={isPointerOnDevice}
                movementPlaySignal={movementPlaySignal}
                motionProfile={motionProfile}
                websiteUrl={websiteUrl}
                isRotateMode={isRotateMode}
                modelPositionOffset={modelPositionOffset}
                resetSignal={resetSignal}
                speedProfile={speedProfile}
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
        </div>
        <div className="h-32 shrink-0 border-t border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-100">
          <div className="flex h-full flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  disabled={!transitionTrack.length}
                  onClick={
                    isTrackPlaying ? stopTransitionTrack : playTransitionTrack
                  }
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-md border transition ${transitionTrack.length
                    ? "border-sky-400 bg-sky-400 text-zinc-950 hover:bg-sky-300"
                    : "cursor-not-allowed border-zinc-800 bg-zinc-900 text-zinc-600"
                    }`}
                  title={isTrackPlaying ? "Stop track" : "Play track"}
                >
                  <PlayTrackIcon isPlaying={isTrackPlaying} />
                </button>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Product Timeline
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    {transitionTrack.length
                      ? `${transitionTrack.length} shots · ${formatDuration(
                        transitionTrackDuration,
                      )}`
                      : "Add a shot, then press play"}
                  </p>
                </div>
                {isRecording ? (
                  <span className="rounded border border-red-500/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-red-200">
                    Rec
                  </span>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsTransitionsOpen((isOpen) => !isOpen)}
                  className={`h-8 rounded-md border px-3 text-xs font-semibold transition ${isTransitionsOpen
                    ? "border-sky-400 bg-sky-400 text-zinc-950"
                    : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600 hover:text-zinc-100"
                    }`}
                >
                  Add Shot
                </button>
                {transitionTrack.length > 0 ? (
                  <button
                    type="button"
                    onClick={clearTransitionTrack}
                    className="h-8 rounded-md border border-zinc-800 px-3 text-xs font-semibold text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-100"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>
            {isTransitionsOpen ? (
              <div className="flex h-8 items-center gap-1 overflow-x-auto">
                {MOVEMENT_PRESETS.map((movement) => (
                  <button
                    key={movement.id}
                    type="button"
                    onClick={() => addMovementToTrack(movement)}
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
            <div className="flex min-h-0 flex-1 items-center gap-2 overflow-x-auto rounded-md border border-zinc-800 bg-zinc-900/70 px-2">
              {transitionTrack.length > 0 ? (
                transitionTrack.map((clip, index) => (
                  <button
                    key={clip.clipId}
                    type="button"
                    onClick={() => playTrackClip(clip)}
                    className={`flex h-11 min-w-40 items-center gap-2 rounded border px-2 text-left transition ${activeTrackClipId === clip.clipId
                      ? "border-sky-400 bg-zinc-800"
                      : "border-zinc-700 bg-zinc-950 hover:border-sky-400"
                      }`}
                  >
                    <span
                      className={`grid h-7 w-7 shrink-0 place-items-center rounded text-[10px] font-bold ${clip.colorClass}`}
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold">
                        {clip.name}
                      </span>
                      <span className="block text-[11px] text-zinc-500">
                        {formatDuration(
                          getMovementDuration(
                            clip,
                            motionProfile,
                            speedProfile,
                          ),
                        )}
                      </span>
                    </span>
                  </button>
                ))
              ) : (
                <button
                  type="button"
                  onClick={() => setIsTransitionsOpen(true)}
                  className="flex h-11 min-w-48 items-center rounded-md border border-dashed border-zinc-700 px-3 text-xs font-semibold text-zinc-500 transition hover:border-zinc-500 hover:text-zinc-300"
                >
                  Add product movement
                </button>
              )}
            </div>
          </div>
        </div>
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
