"use client";

import { useState } from "react";

export const devices = [
  {
    id: 1,
    name: "iPhone 17",
    dimensions: '6.1"',
    color: "bg-cyan-300",
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
    color: "bg-orange-300",
    modelPath: "/models/iPhone17Orange.glb",
    modelScale: 1,
    screen: {
      viewport: { width: 376, height: 806 },
      position: [-0.12, 0.025, 0.035],
      rotation: [0, 0, 0],
      scale: 0.082,
      radius: 58,
    },
  },
  
  {
    id: 2,
    name: "iPad 13",
    dimensions: '11"',
    color: "bg-emerald-300",
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
    color: "bg-amber-300",
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
  mediaTracks,
  onSelectedMediaTrackChange,
  selectedDeviceId,
  selectedMediaTrackId,
  onSelectDevice,
  screenContentName,
  screenContentType,
  websiteUrl,
  onMediaUpload,
  onUseWebsiteContent,
  onWebsiteChange,
}) => {
  const [draftUrl, setDraftUrl] = useState(websiteUrl);
  const [draftCanvasBackgroundColor, setDraftCanvasBackgroundColor] = useState(
    canvasBackgroundColor,
  );
  const availableMediaTracks = mediaTracks ?? [];

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

  const handleMediaUpload = (event) => {
    const file = event.target.files?.[0];

    if (file) {
      onMediaUpload(file);
    }

    event.target.value = "";
  };

  return (
    <aside className="max-h-[46vh] w-full shrink-0 overflow-y-auto border-b border-white/10 bg-zinc-950/95 px-4 py-4 text-zinc-100 shadow-2xl shadow-black/30 lg:h-screen lg:max-h-none lg:w-80 lg:border-b-0 lg:border-r">
      <div className="mb-5 rounded-lg border border-white/10 bg-white/[0.035] px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200/80">
          Device Studio
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          3D Simulator
        </h1>
        <p className="mt-1 text-xs text-zinc-500">
          Stage, capture, and animate product previews.
        </p>
      </div>

      <form className="mb-4 rounded-lg border border-white/10 bg-zinc-900/55 p-3" onSubmit={handleSubmit}>
        <label
          htmlFor="website-url"
          className="mb-2 block text-xs font-semibold uppercase tracking-wide text-zinc-400"
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
            className="min-w-0 flex-1 rounded-md border border-white/10 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/15"
          />
          <button
            type="submit"
            className="rounded-md bg-cyan-300 px-3 py-2 text-sm font-semibold text-zinc-950 shadow-lg shadow-cyan-950/30 transition hover:bg-cyan-200"
          >
            Go
          </button>
        </div>
      </form>

      <div className="mb-4 rounded-lg border border-white/10 bg-zinc-900/55 p-3">
        <label
          htmlFor="screen-media"
          className="mb-2 block text-xs font-semibold uppercase tracking-wide text-zinc-400"
        >
          Photo / Video
        </label>
        <input
          id="screen-media"
          type="file"
          accept="image/*,video/*"
          onChange={handleMediaUpload}
          className="block w-full cursor-pointer rounded-md border border-white/10 bg-zinc-950/80 text-sm text-zinc-100 file:mr-3 file:border-0 file:bg-zinc-200 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-zinc-950 hover:file:bg-white"
        />
        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-zinc-500">
          <span className="min-w-0 truncate">
            {screenContentType === "website"
              ? "Website active"
              : `${screenContentType}: ${screenContentName}`}
          </span>
          {screenContentType !== "website" ? (
            <button
              type="button"
              onClick={onUseWebsiteContent}
              className="shrink-0 rounded-md border border-white/10 bg-zinc-950/70 px-2 py-1 font-semibold text-zinc-300 transition hover:border-cyan-300/60 hover:text-zinc-100"
            >
              Website
            </button>
          ) : null}
        </div>
      </div>

      <div className="mb-5 rounded-lg border border-white/10 bg-zinc-900/55 p-3">
        <label
          htmlFor="canvas-background-color"
          className="mb-2 block text-xs font-semibold uppercase tracking-wide text-zinc-400"
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
            className="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-white/10 bg-zinc-950/80 p-1"
          />
          <input
            id="canvas-background-color"
            type="text"
            value={draftCanvasBackgroundColor}
            onChange={(event) =>
              handleCanvasBackgroundColorChange(event.target.value)
            }
            placeholder="#18181b"
            className="min-w-0 flex-1 rounded-md border border-white/10 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/15"
          />
        </div>
        {availableMediaTracks.length > 1 ? (
          <label className="mt-3 block text-xs font-semibold text-zinc-400">
            <span className="mb-1 block uppercase tracking-wide">Add to</span>
            <select
              value={selectedMediaTrackId}
              onChange={(event) =>
                onSelectedMediaTrackChange(event.target.value)
              }
              className="w-full rounded-md border border-white/10 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/15"
            >
              {availableMediaTracks.map((track) => (
                <option key={track.id} value={track.id}>
                  {track.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="mb-2 flex items-center justify-between px-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Devices
        </p>
        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] font-semibold text-zinc-400">
          {devices.length}
        </span>
      </div>
      <div className="space-y-2">
        {devices.map((device) => {
          const isSelected = selectedDeviceId === device.id;

          return (
            <button
              key={device.id}
              type="button"
              onClick={() => onSelectDevice(device)}
              className={`flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left transition ${
                isSelected
                  ? "border-cyan-300/70 bg-cyan-300/10 shadow-lg shadow-cyan-950/20"
                  : "border-white/10 bg-zinc-900/35 hover:border-white/20 hover:bg-zinc-900/80"
              }`}
            >
              <span
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-md ${device.color} text-sm font-bold text-zinc-950 shadow-inner shadow-white/30`}
              >
                {device.name.charAt(0)}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold">{device.name}</span>
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
