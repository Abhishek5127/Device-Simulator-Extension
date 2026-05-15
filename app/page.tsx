"use client"
import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Html, OrbitControls, useGLTF } from "@react-three/drei"
import { MOUSE } from "three";
import type { Material, Mesh, Object3D, Texture } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import DeviceSidebar, { devices } from "./components/deviceSidebar";

const DEFAULT_CAMERA_POSITION: [number, number, number] = [0, 0, 3];
const DEFAULT_MODEL_ROTATION: [number, number, number] = [0, 0, 0];
const DEFAULT_MODEL_POSITION: [number, number, number] = [0, 0, 0];
const TEXTURE_KEYS = [
  "map",
  "emissiveMap",
  "roughnessMap",
  "metalnessMap",
  "normalMap",
  "aoMap",
  "alphaMap",
] as const;

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

const addVector3 = (
  first: [number, number, number],
  second: [number, number, number],
): [number, number, number] => [
  first[0] + second[0],
  first[1] + second[1],
  first[2] + second[2],
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

function WebsiteScreen({
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
            pointerEvents: isRotateMode ? "none" : "auto",
            textRendering: "geometricPrecision",
          }}
        />
      </div>
    </Html>
  );
}

function DeviceModel({
  device,
  isDraggingDevice,
  websiteUrl,
  isRotateMode,
  modelPositionOffset,
  modelRotationOffset,
  onDeviceDragEnd,
  onDeviceDragMove,
  onDeviceDragStart,
  onDeviceHoverEnd,
  onDeviceHoverStart,
}: {
  device: (typeof devices)[number];
  isDraggingDevice: boolean;
  websiteUrl: string;
  isRotateMode: boolean;
  modelPositionOffset: [number, number, number];
  modelRotationOffset: [number, number, number];
  onDeviceDragEnd: () => void;
  onDeviceDragMove: (movementX: number, movementY: number) => void;
  onDeviceDragStart: () => void;
  onDeviceHoverEnd: () => void;
  onDeviceHoverStart: () => void;
}) {
  const { scene } = useGLTF(device.modelPath);
  const { gl } = useThree();
  const { modelRotation } = getDeviceViewDefaults(device.id);
  const rotation = addVector3(modelRotation, modelRotationOffset);

  useEffect(() => {
    improveTextureQuality(scene, gl.capabilities.getMaxAnisotropy());
  }, [gl, scene]);

  return (
    <group
      position={modelPositionOffset}
      rotation={rotation}
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
        onDeviceDragMove(event.nativeEvent.movementX, event.nativeEvent.movementY);
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
        onDeviceDragMove={onDeviceDragMove}
        onDeviceDragStart={onDeviceDragStart}
        onDeviceHoverEnd={onDeviceHoverEnd}
        onDeviceHoverStart={onDeviceHoverStart}
      />
    </group>
  );
}

export default function Home() {
  const [selectedDevice, setSelectedDevice] = useState(devices[0]);
  const [websiteUrl, setWebsiteUrl] = useState("https://githance.in");
  const [isRotateMode, setIsRotateMode] = useState(true);
  const [isPointerOnDevice, setIsPointerOnDevice] = useState(false);
  const [isDraggingBackground, setIsDraggingBackground] = useState(false);
  const [isDraggingDevice, setIsDraggingDevice] = useState(false);
  const [modelPositionOffset, setModelPositionOffset] = useState<
    [number, number, number]
  >(DEFAULT_MODEL_POSITION);
  const [modelRotationOffset, setModelRotationOffset] = useState<
    [number, number, number]
  >(DEFAULT_MODEL_ROTATION);
  const [resetSignal, setResetSignal] = useState(0);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const controlsEnabled =
    isRotateMode &&
    !isDraggingDevice &&
    (isDraggingBackground || !isPointerOnDevice);

  const resetInteractiveView = () => {
    setIsDraggingBackground(false);
    setIsDraggingDevice(false);
    setIsPointerOnDevice(false);
    setModelPositionOffset(DEFAULT_MODEL_POSITION);
    setModelRotationOffset(DEFAULT_MODEL_ROTATION);
    controlsRef.current?.reset();
    setResetSignal((currentSignal) => currentSignal + 1);
  };

  const handleSelectDevice = (device: (typeof devices)[number]) => {
    setSelectedDevice(device);
    setIsDraggingBackground(false);
    setIsDraggingDevice(false);
    setIsPointerOnDevice(false);
    setModelPositionOffset(DEFAULT_MODEL_POSITION);
    setModelRotationOffset(DEFAULT_MODEL_ROTATION);
    setResetSignal((currentSignal) => currentSignal + 1);
  };

  return (
    <main className="flex min-h-screen bg-zinc-950">
      <DeviceSidebar
        selectedDeviceId={selectedDevice.id}
        onSelectDevice={handleSelectDevice}
        websiteUrl={websiteUrl}
        onWebsiteChange={setWebsiteUrl}
      />
      <section className="relative h-screen flex-1 bg-zinc-900">
        <button
          type="button"
          onClick={() => setIsRotateMode((currentMode) => !currentMode)}
          title={isRotateMode ? "Rotation mode" : "Website interaction mode"}
          className={`absolute right-5 top-5 z-20 rounded-md border px-4 py-2 text-sm font-semibold transition ${
            isRotateMode
              ? "border-sky-300 bg-sky-400 text-zinc-950"
              : "border-zinc-700 bg-zinc-950 text-zinc-100 hover:border-zinc-500"
          }`}
        >
          Hand
        </button>
        <button
          type="button"
          onClick={resetInteractiveView}
          title="Reset view"
          className="absolute right-5 top-[68px] z-20 rounded-md border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500"
        >
          Reset View
        </button>
        <Canvas
          camera={{ position: DEFAULT_CAMERA_POSITION, fov: 45 }}
          dpr={[1, 2]}
          gl={{ antialias: true, powerPreference: "high-performance" }}
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
          <color attach="background" args={["#18181b"]} />
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
              modelRotationOffset={modelRotationOffset}
              onDeviceDragEnd={() => setIsDraggingDevice(false)}
              onDeviceDragMove={(movementX, movementY) => {
                setModelRotationOffset(([x, y, z]) => [
                  x + movementY * 0.01,
                  y + movementX * 0.01,
                  z,
                ]);
              }}
              onDeviceDragStart={() => {
                setIsDraggingBackground(false);
                setIsDraggingDevice(true);
              }}
              onDeviceHoverEnd={() => setIsPointerOnDevice(false)}
              onDeviceHoverStart={() => setIsPointerOnDevice(true)}
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
    </main>
  );
}
