"use client";

import { useState } from "react";

export const devices = [
  {
    id: 1,
    name: "iPhone 17",
    dimensions: '6.1"',
    color: "bg-sky-500",
    modelPath: "/models/iPhone17.glb",
    modelScale: 11,
    screen: {
      viewport: { width: 398, height: 852 },
      position: [0, 0, 0.0045],
      rotation: [0, 0, 0],
      scale: 0.0069,
      radius: 68,
    },
  },
  {
    id: 4,
    name: "iPhone 17 Orange",
    dimensions: '6.1"',
    color: "bg-sky-500",
    modelPath: "/models/iPhone17Orange.glb",
    modelScale: 1,
    screen: {
      viewport: { width: 398, height: 852 },
      position: [-0.12, 0, 0],
      rotation: [0, 0, 0],
      scale: 0.082,
      radius: 68,
    },
  },
  
  {
    id: 2,
    name: "iPad 13",
    dimensions: '11"',
    color: "bg-emerald-500",
    modelPath: "/models/iPad13.glb",
    modelScale: 5.5,
    screen: {
      viewport: { width: 1200, height: 920 },
      position: [0, 0.004, 0],
      rotation: [-Math.PI / 2, 0, Math.PI / 2],
      scale: 0.0092,
      radius: 38,
    },
  },
  {
    id: 3,
    name: "MacBook",
    dimensions: '14"',
    color: "bg-amber-500",
    modelPath: "/models/macbook.glb",
    modelScale: 1.25,
    screen: {
      viewport: { width: 1620, height: 1110 },
      position: [0, 0.115, -0.107],
      rotation: [0, 0, 0],
      scale: 0.00755,
      radius: 30,
    },
  },
];

const normalizeUrl = (value) => {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return "https://githance.in";
  }

  if (/^https?:\/\//i.test(trimmedValue)) {
    return trimmedValue;
  }

  return `https://${trimmedValue}`;
};

const isValidCssColor = (value) => {
  if (typeof CSS === "undefined") {
    return /^#[0-9a-f]{6}$/i.test(value);
  }

  return CSS.supports("color", value);
};

const normalizeCssColor = (value) => {
  if (typeof document === "undefined") {
    return value;
  }

  const swatch = document.createElement("span");

  swatch.style.color = value;
  document.body.appendChild(swatch);

  const normalizedColor = getComputedStyle(swatch).color;

  swatch.remove();

  return normalizedColor || value;
};

const getColorPickerValue = (value) =>
  /^#[0-9a-f]{6}$/i.test(value) ? value : "#18181b";

const DeviceSidebar = ({
  canvasBackgroundColor,
  onCanvasBackgroundColorChange,
  selectedDeviceId,
  onSelectDevice,
  websiteUrl,
  onWebsiteChange,
}) => {
  const [draftUrl, setDraftUrl] = useState(websiteUrl);
  const [draftCanvasBackgroundColor, setDraftCanvasBackgroundColor] = useState(
    canvasBackgroundColor,
  );

  const handleSubmit = (event) => {
    event.preventDefault();
    onWebsiteChange(normalizeUrl(draftUrl));
  };

  const handleCanvasBackgroundColorChange = (value) => {
    setDraftCanvasBackgroundColor(value);

    const trimmedValue = value.trim();

    if (isValidCssColor(trimmedValue)) {
      onCanvasBackgroundColorChange(normalizeCssColor(trimmedValue));
    }
  };

  return (
    <aside className="h-screen w-72 shrink-0 border-r border-zinc-800 bg-zinc-950 px-4 py-5 text-zinc-100">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Devices
        </p>
        <h1 className="mt-1 text-xl font-semibold">3D Simulator</h1>
      </div>

      <form className="mb-5" onSubmit={handleSubmit}>
        <label
          htmlFor="website-url"
          className="mb-2 block text-xs font-semibold uppercase tracking-wide text-zinc-500"
        >
          Website
        </label>
        <div className="flex gap-2">
          <input
            id="website-url"
            type="url"
            value={draftUrl}
            onChange={(event) => setDraftUrl(event.target.value)}
            placeholder="https://example.com"
            className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-sky-400"
          />
          <button
            type="submit"
            className="rounded-md bg-sky-400 px-3 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-sky-300"
          >
            Go
          </button>
        </div>
      </form>

      <div className="mb-5">
        <label
          htmlFor="canvas-background-color"
          className="mb-2 block text-xs font-semibold uppercase tracking-wide text-zinc-500"
        >
          Canvas Background
        </label>
        <div className="flex gap-2">
          <input
            type="color"
            aria-label="Pick canvas background color"
            value={getColorPickerValue(canvasBackgroundColor)}
            onChange={(event) =>
              handleCanvasBackgroundColorChange(event.target.value)
            }
            className="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-zinc-800 bg-zinc-900 p-1"
          />
          <input
            id="canvas-background-color"
            type="text"
            value={draftCanvasBackgroundColor}
            onChange={(event) =>
              handleCanvasBackgroundColorChange(event.target.value)
            }
            placeholder="#18181b"
            className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-sky-400"
          />
        </div>
      </div>

      <div className="space-y-2">
        {devices.map((device) => {
          const isSelected = selectedDeviceId === device.id;

          return (
            <button
              key={device.id}
              type="button"
              onClick={() => onSelectDevice(device)}
              className={`flex w-full items-center gap-3 rounded-md border px-3 py-3 text-left transition ${
                isSelected
                  ? "border-sky-400 bg-zinc-900"
                  : "border-zinc-800 bg-zinc-950 hover:border-zinc-600 hover:bg-zinc-900"
              }`}
            >
              <span
                className={`grid h-10 w-10 shrink-0 place-items-center rounded ${device.color} text-sm font-bold text-zinc-950`}
              >
                {device.name.charAt(0)}
              </span>
              <span className="min-w-0">
                <span className="block font-medium">{device.name}</span>
                <span className="block text-sm text-zinc-500">
                  {device.dimensions} preview
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
};

export default DeviceSidebar;
