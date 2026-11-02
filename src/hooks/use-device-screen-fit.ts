import { useState, useEffect, useMemo } from "react";

export type DeviceCategory = "iphone" | "android_phone" | "tablet" | "desktop";

export interface DeviceScreenProfile {
  deviceCategory: DeviceCategory;
  deviceBrand: string;
  deviceModelHint: string;
  availWidth: number;
  availHeight: number;
  screenWidth: number;
  screenHeight: number;
  pixelRatio: number;
  orientationAngle: number;
  landscapeAspectRatio: number;
  isPortraitViewport: boolean;
  isCompactLandscape: boolean;
  isMobileDevice: boolean;
  hasTouchScreen: boolean;
  hasMotionSensors: boolean;
  isFullscreen: boolean;
}

export interface PoolStageFitMetrics {
  stageWidthPx: number;
  stageHeightPx: number;
  hudHeightPx: number;
  tableWidthPx: number;
  tableHeightPx: number;
  leftDockWidthPx: number;
  rightDockWidthPx: number;
  dockHeightPx: number;
  railPaddingPx: number;
  isCompactLandscape: boolean;
  fitSummaryLabel: string;
}

export interface RacingStageFitMetrics {
  stageWidthPx: number;
  stageHeightPx: number;
  canvasWidth: number;
  canvasHeight: number;
  aspectRatio: number;
  isRotatedPortrait: boolean;
  isCompactLandscape: boolean;
  orientationAngle: number;
  fitSummaryLabel: string;
}

export interface BoardStageFitMetrics {
  stageWidthPx: number;
  stageHeightPx: number;
  squareBoardSizePx: number;
  owarePitSizePx: number;
  slashCanvasHeightPx: number;
  isCompactViewport: boolean;
  isShortViewport: boolean;
  fitSummaryLabel: string;
}

let cachedHighEntropyModel = "";

function detectDeviceBrandAndCategory(
  ua: string,
  screenW: number,
  screenH: number
): {
  deviceCategory: DeviceCategory;
  deviceBrand: string;
  deviceModelHint: string;
  isMobileDevice: boolean;
} {
  const lower = `${ua} ${cachedHighEntropyModel}`.toLowerCase();
  const shortSide = Math.min(screenW, screenH);
  const longSide = Math.max(screenW, screenH);
  const coarsePointer =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  const touchPoints =
    typeof navigator !== "undefined" ? Number(navigator.maxTouchPoints || 0) : 0;

  if (
    /ipad|tablet|playbook|silk/i.test(lower) ||
    (/macintosh/i.test(lower) && touchPoints > 1 && shortSide >= 600)
  ) {
    return {
      deviceCategory: "tablet",
      deviceBrand: /ipad|macintosh/i.test(lower) ? "iPad" : "Tablet",
      deviceModelHint: `${shortSide}×${longSide} Tablet`,
      isMobileDevice: true,
    };
  }

  if (/iphone|ipod/i.test(lower)) {
    const modelHint =
      longSide >= 896
        ? "iPhone Pro Max / Plus"
        : longSide >= 812
        ? "iPhone Pro / Standard"
        : "iPhone Compact";
    return {
      deviceCategory: "iphone",
      deviceBrand: "iPhone",
      deviceModelHint: modelHint,
      isMobileDevice: true,
    };
  }

  if (
    /android/i.test(lower) ||
    ((shortSide <= 580 || coarsePointer) && touchPoints > 0 && shortSide < 960)
  ) {
    let brand = "Android";
    if (/samsung|sm-|gt-/i.test(lower)) brand = "Samsung";
    else if (/tecno/i.test(lower)) brand = "Tecno";
    else if (/infinix/i.test(lower)) brand = "Infinix";
    else if (/itel/i.test(lower)) brand = "itel";
    else if (/xiaomi|redmi|poco/i.test(lower)) brand = "Xiaomi";
    else if (/pixel/i.test(lower)) brand = "Pixel";
    else if (/huawei|honor/i.test(lower)) brand = "Huawei";
    else if (/oppo/i.test(lower)) brand = "Oppo";
    else if (/realme/i.test(lower)) brand = "Realme";
    else if (/vivo/i.test(lower)) brand = "Vivo";
    else if (/oneplus/i.test(lower)) brand = "OnePlus";
    else if (/nokia/i.test(lower)) brand = "Nokia";
    else if (/motorola|moto/i.test(lower)) brand = "Motorola";

    const isTabletSize = shortSide >= 600;
    const modelLabel = cachedHighEntropyModel
      ? `${brand} ${cachedHighEntropyModel}`
      : `${brand} (${longSide}×${shortSide})`;

    return {
      deviceCategory: isTabletSize ? "tablet" : "android_phone",
      deviceBrand: brand,
      deviceModelHint: modelLabel,
      isMobileDevice: true,
    };
  }

  return {
    deviceCategory: "desktop",
    deviceBrand: "Desktop",
    deviceModelHint: `Display ${screenW}×${screenH}`,
    isMobileDevice: shortSide < 768 || (coarsePointer && touchPoints > 0),
  };
}

function readOrientationAngle(): number {
  if (typeof window === "undefined") return 0;
  try {
    if (
      window.screen &&
      window.screen.orientation &&
      typeof window.screen.orientation.angle === "number"
    ) {
      return window.screen.orientation.angle;
    }
    const legacyAngle = (window as any).orientation;
    if (typeof legacyAngle === "number") {
      return legacyAngle;
    }
  } catch {
    // ignore orientation read errors
  }
  return 0;
}

function readViewportSnapshot(): DeviceScreenProfile {
  if (typeof window === "undefined") {
    return {
      deviceCategory: "desktop",
      deviceBrand: "Desktop",
      deviceModelHint: "Desktop",
      availWidth: 1024,
      availHeight: 640,
      screenWidth: 1024,
      screenHeight: 640,
      pixelRatio: 1,
      orientationAngle: 0,
      landscapeAspectRatio: 16 / 9,
      isPortraitViewport: false,
      isCompactLandscape: false,
      isMobileDevice: false,
      hasTouchScreen: false,
      hasMotionSensors: false,
      isFullscreen: false,
    };
  }

  const vv = window.visualViewport;
  const rawW = vv ? vv.width : window.innerWidth || document.documentElement.clientWidth;
  const rawH = vv ? vv.height : window.innerHeight || document.documentElement.clientHeight;

  const availWidth = Math.max(260, Math.round(rawW));
  const availHeight = Math.max(220, Math.round(rawH));
  const screenWidth = Math.round(window.screen?.width || availWidth);
  const screenHeight = Math.round(window.screen?.height || availHeight);
  const pixelRatio = Number((window.devicePixelRatio || 1).toFixed(2));
  const orientationAngle = readOrientationAngle();

  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const { deviceCategory, deviceBrand, deviceModelHint, isMobileDevice } =
    detectDeviceBrandAndCategory(ua, screenWidth, screenHeight);

  const isPortraitViewport = availHeight > availWidth;
  const longEdge = Math.max(availWidth, availHeight);
  const shortEdge = Math.max(1, Math.min(availWidth, availHeight));
  const landscapeAspectRatio = Number((longEdge / shortEdge).toFixed(3));
  const isCompactLandscape = shortEdge <= 500 || isMobileDevice;
  const isFullscreen = Boolean(
    document.fullscreenElement || (document as any).webkitFullscreenElement
  );
  const hasTouchScreen =
    (typeof navigator !== "undefined" && Number(navigator.maxTouchPoints || 0) > 0) ||
    "ontouchstart" in window;
  const hasMotionSensors =
    typeof window !== "undefined" &&
    ("DeviceOrientationEvent" in window || "DeviceMotionEvent" in window);

  return {
    deviceCategory,
    deviceBrand,
    deviceModelHint,
    availWidth,
    availHeight,
    screenWidth,
    screenHeight,
    pixelRatio,
    orientationAngle,
    landscapeAspectRatio,
    isPortraitViewport,
    isCompactLandscape,
    isMobileDevice,
    hasTouchScreen,
    hasMotionSensors,
    isFullscreen,
  };
}

/**
 * Real-time Device & Screen-Size Auto-Detection Hook.
 * Tracks `window.visualViewport`, `window.screen.orientation`, `navigator.userAgentData`,
 * orientation changes, and fullscreen transitions to compute exact pixel dimensions that fit 100% of the screen.
 */
export function useDeviceScreenFit() {
  const [profile, setProfile] = useState<DeviceScreenProfile>(() => readViewportSnapshot());

  useEffect(() => {
    let rafId = 0;
    const handleUpdate = () => {
      window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(() => {
        setProfile(readViewportSnapshot());
      });
    };

    // Query Client Hints high-entropy model name on Android Chrome/Edge if supported
    const navAny = typeof navigator !== "undefined" ? (navigator as any) : null;
    if (
      navAny?.userAgentData &&
      typeof navAny.userAgentData.getHighEntropyValues === "function" &&
      !cachedHighEntropyModel
    ) {
      navAny.userAgentData
        .getHighEntropyValues(["model", "platform"])
        .then((vals: any) => {
          if (vals?.model && typeof vals.model === "string") {
            cachedHighEntropyModel = vals.model.trim();
            handleUpdate();
          }
        })
        .catch(() => {});
    }

    handleUpdate();
    const settleTimer1 = window.setTimeout(handleUpdate, 120);
    const settleTimer2 = window.setTimeout(handleUpdate, 360);

    window.addEventListener("resize", handleUpdate);
    window.addEventListener("orientationchange", handleUpdate);
    document.addEventListener("fullscreenchange", handleUpdate);
    document.addEventListener("webkitfullscreenchange", handleUpdate);

    const screenOrientation = window.screen?.orientation;
    if (screenOrientation && typeof screenOrientation.addEventListener === "function") {
      screenOrientation.addEventListener("change", handleUpdate);
    }

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", handleUpdate);
      vv.addEventListener("scroll", handleUpdate);
    }

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(settleTimer1);
      window.clearTimeout(settleTimer2);
      window.removeEventListener("resize", handleUpdate);
      window.removeEventListener("orientationchange", handleUpdate);
      document.removeEventListener("fullscreenchange", handleUpdate);
      document.removeEventListener("webkitfullscreenchange", handleUpdate);
      if (screenOrientation && typeof screenOrientation.removeEventListener === "function") {
        screenOrientation.removeEventListener("change", handleUpdate);
      }
      if (vv) {
        vv.removeEventListener("resize", handleUpdate);
        vv.removeEventListener("scroll", handleUpdate);
      }
    };
  }, []);

  const computePoolStageMetrics = useMemo(() => {
    return (opts?: {
      forcedLandscape?: boolean;
      reservedTopPx?: number;
    }): PoolStageFitMetrics => {
      const forcedLandscape = Boolean(opts?.forcedLandscape);
      const reservedTopPx = opts?.reservedTopPx ?? 0;

      const effectiveW =
        forcedLandscape && profile.isPortraitViewport
          ? profile.availHeight
          : profile.availWidth;
      const effectiveH =
        forcedLandscape && profile.isPortraitViewport
          ? profile.availWidth
          : Math.max(240, profile.availHeight - reservedTopPx);

      const isCompact = effectiveH <= 460 || effectiveW <= 860;

      const hudHeightPx = isCompact ? 28 : 34;
      const leftDockWidthPx = isCompact ? 42 : 54;
      const rightDockWidthPx = isCompact ? 46 : 58;
      const horizontalChromePx = leftDockWidthPx + rightDockWidthPx + (isCompact ? 16 : 28);
      const verticalChromePx = hudHeightPx + (isCompact ? 10 : 20);

      const maxTableW = Math.max(220, Math.min(980, effectiveW - horizontalChromePx));
      const maxTableH = Math.max(110, Math.min(490, effectiveH - verticalChromePx));

      const tableHeightPx = Math.floor(Math.min(maxTableH, maxTableW / 2));
      const tableWidthPx = Math.floor(tableHeightPx * 2);
      const railPaddingPx = isCompact ? 6 : 12;

      return {
        stageWidthPx: effectiveW,
        stageHeightPx: effectiveH,
        hudHeightPx,
        tableWidthPx,
        tableHeightPx,
        leftDockWidthPx,
        rightDockWidthPx,
        dockHeightPx: tableHeightPx,
        railPaddingPx,
        isCompactLandscape: isCompact,
        fitSummaryLabel: `${profile.deviceBrand} ${effectiveW}×${effectiveH}`,
      };
    };
  }, [profile]);

  const computeRacingStageMetrics = useMemo(() => {
    return (opts?: { forcedLandscape?: boolean }): RacingStageFitMetrics => {
      const forcedLandscape = opts?.forcedLandscape ?? true;
      const isRotatedPortrait = forcedLandscape && profile.isPortraitViewport;

      const stageWidthPx = isRotatedPortrait ? profile.availHeight : profile.availWidth;
      const stageHeightPx = isRotatedPortrait ? profile.availWidth : profile.availHeight;

      const rawAspect = stageWidthPx / Math.max(1, stageHeightPx);
      const clampedAspect = Math.max(1.45, Math.min(2.4, rawAspect));

      // Internal 3D render buffer matches the exact device widescreen aspect ratio
      const canvasHeight = 540;
      const canvasWidth = Math.round(canvasHeight * clampedAspect);

      return {
        stageWidthPx,
        stageHeightPx,
        canvasWidth,
        canvasHeight,
        aspectRatio: Number(clampedAspect.toFixed(3)),
        isRotatedPortrait,
        isCompactLandscape: stageHeightPx <= 480 || profile.isMobileDevice,
        orientationAngle: profile.orientationAngle,
        fitSummaryLabel: `${profile.deviceBrand} ${stageWidthPx}×${stageHeightPx}`,
      };
    };
  }, [profile]);

  const computeBoardStageMetrics = useMemo(() => {
    return (
      gameType: "oware" | "ludo" | "dame" | "slash" | "candy",
      opts?: { reservedTopPx?: number }
    ): BoardStageFitMetrics => {
      const reservedTopPx = opts?.reservedTopPx ?? 38;
      const stageWidthPx = profile.availWidth;
      const stageHeightPx = Math.max(280, profile.availHeight - reservedTopPx);
      const isCompactViewport = stageWidthPx < 640 || stageHeightPx < 680;
      const isShortViewport = stageHeightPx < 580;

      const horizontalPad = isCompactViewport ? 16 : 36;
      const maxWidthForBoard = Math.max(250, stageWidthPx - horizontalPad);

      let verticalChromeForSquare = 150;
      let maxCapSquare = 520;
      if (gameType === "ludo") {
        verticalChromeForSquare = isShortViewport ? 148 : isCompactViewport ? 172 : 210;
        maxCapSquare = 500;
      } else if (gameType === "dame") {
        verticalChromeForSquare = isShortViewport ? 116 : isCompactViewport ? 136 : 180;
        maxCapSquare = 460;
      } else if (gameType === "candy") {
        verticalChromeForSquare = isShortViewport ? 138 : isCompactViewport ? 162 : 196;
        maxCapSquare = 470;
      }

      const maxHeightForSquare = Math.max(230, stageHeightPx - verticalChromeForSquare);
      const squareBoardSizePx = Math.floor(
        Math.min(maxWidthForBoard, maxHeightForSquare, maxCapSquare)
      );

      const owareMaxPitByWidth = Math.floor((maxWidthForBoard - 68) / 6);
      const owareMaxPitByHeight = Math.floor(
        (stageHeightPx - (isCompactViewport ? 210 : 260)) / 2.4
      );
      const owarePitSizePx = Math.max(
        46,
        Math.min(92, owareMaxPitByWidth, owareMaxPitByHeight)
      );

      const slashCanvasHeightPx = Math.max(
        260,
        Math.min(540, stageHeightPx - (isCompactViewport ? 96 : 124))
      );

      return {
        stageWidthPx,
        stageHeightPx,
        squareBoardSizePx,
        owarePitSizePx,
        slashCanvasHeightPx,
        isCompactViewport,
        isShortViewport,
        fitSummaryLabel: `${profile.deviceBrand} ${profile.availWidth}×${profile.availHeight}`,
      };
    };
  }, [profile]);

  return {
    ...profile,
    computePoolStageMetrics,
    computeRacingStageMetrics,
    computeBoardStageMetrics,
  };
}
