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
  isPortraitViewport: boolean;
  isCompactLandscape: boolean;
  isMobileDevice: boolean;
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
  const lower = ua.toLowerCase();
  const shortSide = Math.min(screenW, screenH);
  const longSide = Math.max(screenW, screenH);

  if (
    /ipad|tablet|playbook|silk/i.test(lower) ||
    (/macintosh/i.test(lower) && navigator.maxTouchPoints > 1 && shortSide >= 600)
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

  if (/android/i.test(lower) || (shortSide <= 540 && navigator.maxTouchPoints > 0)) {
    let brand = "Android";
    if (/samsung|sm-|gt-/i.test(lower)) brand = "Samsung";
    else if (/tecno/i.test(lower)) brand = "Tecno";
    else if (/infinix/i.test(lower)) brand = "Infinix";
    else if (/itel/i.test(lower)) brand = "itel";
    else if (/xiaomi|redmi|poco/i.test(lower)) brand = "Xiaomi";
    else if (/pixel/i.test(lower)) brand = "Pixel";
    else if (/huawei|honor/i.test(lower)) brand = "Huawei";
    else if (/oppo|realme|oneplus|vivo/i.test(lower)) brand = "Android";

    const isTabletSize = shortSide >= 600;
    return {
      deviceCategory: isTabletSize ? "tablet" : "android_phone",
      deviceBrand: brand,
      deviceModelHint: `${brand} (${longSide}×${shortSide})`,
      isMobileDevice: true,
    };
  }

  return {
    deviceCategory: "desktop",
    deviceBrand: "Desktop",
    deviceModelHint: `Display ${screenW}×${screenH}`,
    isMobileDevice: shortSide < 768,
  };
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
      isPortraitViewport: false,
      isCompactLandscape: false,
      isMobileDevice: false,
      isFullscreen: false,
    };
  }

  const vv = window.visualViewport;
  const rawW = vv ? vv.width : document.documentElement.clientWidth || window.innerWidth;
  const rawH = vv ? vv.height : document.documentElement.clientHeight || window.innerHeight;

  const availWidth = Math.max(280, Math.round(rawW));
  const availHeight = Math.max(240, Math.round(rawH));
  const screenWidth = Math.round(window.screen?.width || availWidth);
  const screenHeight = Math.round(window.screen?.height || availHeight);
  const pixelRatio = Number((window.devicePixelRatio || 1).toFixed(2));

  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const { deviceCategory, deviceBrand, deviceModelHint, isMobileDevice } =
    detectDeviceBrandAndCategory(ua, screenWidth, screenHeight);

  const isPortraitViewport = availHeight > availWidth && availWidth < 960;
  const isCompactLandscape = availWidth > availHeight && availHeight <= 480;
  const isFullscreen = Boolean(document.fullscreenElement);

  return {
    deviceCategory,
    deviceBrand,
    deviceModelHint,
    availWidth,
    availHeight,
    screenWidth,
    screenHeight,
    pixelRatio,
    isPortraitViewport,
    isCompactLandscape,
    isMobileDevice,
    isFullscreen,
  };
}

/**
 * Real-time Device & Screen-Size Auto-Detection Hook.
 * Tracks `window.visualViewport` (accurate across iOS Safari, Android Chrome, Samsung, Tecno & Infinix browsers),
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

    handleUpdate();
    // Run a delayed re-measurement after orientation/toolbar settle on mobile browsers
    const settleTimer = window.setTimeout(handleUpdate, 180);

    window.addEventListener("resize", handleUpdate);
    window.addEventListener("orientationchange", handleUpdate);
    document.addEventListener("fullscreenchange", handleUpdate);

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", handleUpdate);
      vv.addEventListener("scroll", handleUpdate);
    }

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(settleTimer);
      window.removeEventListener("resize", handleUpdate);
      window.removeEventListener("orientationchange", handleUpdate);
      document.removeEventListener("fullscreenchange", handleUpdate);
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

      // When forcedLandscape is active on a portrait phone, the stage is rotated 90deg so width & height swap
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

      // Exact 2:1 aspect ratio solver guaranteed to fit BOTH width and height of the device screen
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

  const computeBoardStageMetrics = useMemo(() => {
    return (
      gameType: "oware" | "ludo" | "dame" | "slash",
      opts?: { reservedTopPx?: number }
    ): BoardStageFitMetrics => {
      const reservedTopPx = opts?.reservedTopPx ?? 38;
      const stageWidthPx = profile.availWidth;
      const stageHeightPx = Math.max(280, profile.availHeight - reservedTopPx);
      const isCompactViewport = stageWidthPx < 640 || stageHeightPx < 680;
      const isShortViewport = stageHeightPx < 580;

      const horizontalPad = isCompactViewport ? 16 : 36;
      const maxWidthForBoard = Math.max(250, stageWidthPx - horizontalPad);

      // Reserve vertical space for each game's HUD & controls so the board never overflows the screen
      let verticalChromeForSquare = 150;
      let maxCapSquare = 520;
      if (gameType === "ludo") {
        // Ludo has top status bar + player chips + bottom 3D Dice dock
        verticalChromeForSquare = isShortViewport ? 148 : isCompactViewport ? 172 : 210;
        maxCapSquare = 500;
      } else if (gameType === "dame") {
        // Dame has top bar + compact score strip + bottom status bar
        verticalChromeForSquare = isShortViewport ? 116 : isCompactViewport ? 136 : 180;
        maxCapSquare = 460;
      }

      const maxHeightForSquare = Math.max(230, stageHeightPx - verticalChromeForSquare);
      const squareBoardSizePx = Math.floor(
        Math.min(maxWidthForBoard, maxHeightForSquare, maxCapSquare)
      );

      // Oware pit size calculation so 2 rows of 6 pits + Kulo storehouses + turn banner fit inside stageHeightPx
      const owareMaxPitByWidth = Math.floor((maxWidthForBoard - 68) / 6);
      const owareMaxPitByHeight = Math.floor((stageHeightPx - (isCompactViewport ? 210 : 260)) / 2.4);
      const owarePitSizePx = Math.max(
        46,
        Math.min(92, owareMaxPitByWidth, owareMaxPitByHeight)
      );

      // Market Slash canvas height so the top HUD + canvas fit inside stageHeightPx
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
    computeBoardStageMetrics,
  };
}
