import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Download, Sliders, Layers, Monitor, Image as ImageIcon, Zap, Palette, Trash2, ArrowRight, Plus, X, Grid, Cpu, Activity, Tv, MoveHorizontal, Box } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import gifFrames from 'gif-frames';
import GIF from 'gif.js';
import chroma from 'chroma-js';

// Pre-calculation of Bayer matrix for crispy dither
const bayerMatrix8x8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21]
];

const DITHER_ALGOS = {
  'Bayer': { type: 'ordered' },
  'Floyd-Steinberg': {
    type: 'diffusion',
    kernel: [
      { x: 1, y: 0, w: 7 / 16 },
      { x: -1, y: 1, w: 3 / 16 },
      { x: 0, y: 1, w: 5 / 16 },
      { x: 1, y: 1, w: 1 / 16 }
    ]
  },
  'Atkinson': {
    type: 'diffusion',
    kernel: [
      { x: 1, y: 0, w: 1 / 8 },
      { x: 2, y: 0, w: 1 / 8 },
      { x: -1, y: 1, w: 1 / 8 },
      { x: 0, y: 1, w: 1 / 8 },
      { x: 1, y: 1, w: 1 / 8 },
      { x: 0, y: 2, w: 1 / 8 }
    ]
  },
  'Sierra Lite': {
    type: 'diffusion',
    kernel: [
      { x: 1, y: 0, w: 2 / 4 },
      { x: -1, y: 1, w: 1 / 4 },
      { x: 0, y: 1, w: 1 / 4 }
    ]
  }
};

const PRESET_PALETTES = {
  'True Color': null,
  'Gameboy': ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  'CGA': ['#000000', '#55FFFF', '#FF55FF', '#FFFFFF'],
  'NES': ['#000000', '#fc9838', '#80d010', '#38b4f8', '#d8f878', '#fc44ce', '#f8d878', '#ffffff'],
  'C64': ['#000000', '#FFFFFF', '#880000', '#AAFFEE', '#CC44CC', '#00CC55', '#0000AA', '#EEEE77', '#DD8855', '#664400', '#FF7777', '#333333', '#777777', '#AAFF66', '#0088FF', '#BBBBBB'],
  'Cyber': ['#050505', '#00f2ff', '#ff00ea', '#7000ff']
};

export default function App() {
  const [originalGif, setOriginalGif] = useState(null);
  const [frames, setFrames] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [outputGif, setOutputGif] = useState(null);
  const [progress, setProgress] = useState(0);

  // Core Controls
  const [retro, setRetro] = useState({ start: 50, end: 50, animate: false });
  const [glitch, setGlitch] = useState({ start: 0, end: 100, animate: false });
  const [painterly, setPainterly] = useState({ start: 0, end: 100, animate: false });
  const [crt, setCrt] = useState({ start: 30, end: 30, animate: false });
  const [glow, setGlow] = useState({ start: 0, end: 50, animate: false });
  const [pixelSort, setPixelSort] = useState({ start: 0, end: 100, animate: false, threshold: 50 });
  const [downscale, setDownscale] = useState(1);

  const [frameRange, setFrameRange] = useState([0, 100]);
  const [falloff, setFalloff] = useState(20);
  const [status, setStatus] = useState('');
  const [ditherAlgo, setDitherAlgo] = useState('Bayer');
  const [compareSplit, setCompareSplit] = useState(50);
  const [showComparison, setShowComparison] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [isDragging, setIsDragging] = useState(false);

  // Selection Tool State
  const [useSelection, setUseSelection] = useState(false);
  const [selection, setSelection] = useState({ x: 10, y: 10, w: 80, h: 80 });
  const [isResizingSelection, setIsResizingSelection] = useState(false);
  const [selectionStart, setSelectionStart] = useState({ x: 0, y: 0 });

  // History & Persistence State
  const [history, setHistory] = useState([]);
  const [sidebarWidth, setSidebarWidth] = useState(380);
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [showHistory, setShowHistory] = useState(true);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  // Handle Resize for Mobile Check
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Palette State
  const [selectedPaletteName, setSelectedPaletteName] = useState('True Color');
  const [customPalette, setCustomPalette] = useState([]);
  const [isAutoClustering, setIsAutoClustering] = useState(false);

  const fileInputRef = useRef(null);
  const comparisonRef = useRef(null);
  const previewImageRef = useRef(null);
  const previewWrapperRef = useRef(null);

  // Helper: Get the actual rendered bounds of the image within its container
  const getImageBounds = useCallback(() => {
    const img = previewImageRef.current;
    const wrapper = previewWrapperRef.current;
    if (!img || !wrapper) return null;

    const wrapperRect = wrapper.getBoundingClientRect();
    const imgNaturalWidth = dimensions.width || img.naturalWidth;
    const imgNaturalHeight = dimensions.height || img.naturalHeight;

    if (!imgNaturalWidth || !imgNaturalHeight) return null;

    // Calculate how the image is rendered with object-fit: contain
    const wrapperAspect = wrapperRect.width / wrapperRect.height;
    const imgAspect = imgNaturalWidth / imgNaturalHeight;

    let renderedWidth, renderedHeight, offsetX, offsetY;

    if (imgAspect > wrapperAspect) {
      // Image is wider - letterbox top/bottom
      renderedWidth = wrapperRect.width;
      renderedHeight = wrapperRect.width / imgAspect;
      offsetX = 0;
      offsetY = (wrapperRect.height - renderedHeight) / 2;
    } else {
      // Image is taller - letterbox left/right
      renderedHeight = wrapperRect.height;
      renderedWidth = wrapperRect.height * imgAspect;
      offsetX = (wrapperRect.width - renderedWidth) / 2;
      offsetY = 0;
    }

    return {
      wrapperRect,
      offsetX,
      offsetY,
      renderedWidth,
      renderedHeight
    };
  }, [dimensions]);

  // Convert client coordinates to image percentage coordinates
  const clientToImagePercent = useCallback((clientX, clientY) => {
    const bounds = getImageBounds();
    if (!bounds) return { x: 0, y: 0, inBounds: false };

    const { wrapperRect, offsetX, offsetY, renderedWidth, renderedHeight } = bounds;

    // Position relative to wrapper
    const relX = clientX - wrapperRect.left;
    const relY = clientY - wrapperRect.top;

    // Position relative to the actual image area
    const imgX = relX - offsetX;
    const imgY = relY - offsetY;

    // Check if within image bounds
    const inBounds = imgX >= 0 && imgX <= renderedWidth && imgY >= 0 && imgY <= renderedHeight;

    // Convert to percentage (clamped to 0-100)
    const percentX = Math.max(0, Math.min(100, (imgX / renderedWidth) * 100));
    const percentY = Math.max(0, Math.min(100, (imgY / renderedHeight) * 100));

    return { x: percentX, y: percentY, inBounds };
  }, [getImageBounds]);

  // Hydrate from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('dither-lab-settings');
    if (saved) {
      try {
        const settings = JSON.parse(saved);
        if (settings.retro) setRetro(settings.retro);
        if (settings.glitch) setGlitch(settings.glitch);
        if (settings.painterly) setPainterly(settings.painterly);
        if (settings.crt) setCrt(settings.crt);
        if (settings.glow) setGlow(settings.glow);
        if (settings.pixelSort) setPixelSort(settings.pixelSort);
        if (settings.downscale) setDownscale(settings.downscale);
        if (settings.selectedPaletteName) setSelectedPaletteName(settings.selectedPaletteName);
        if (settings.customPalette) setCustomPalette(settings.customPalette);
        if (settings.ditherAlgo) setDitherAlgo(settings.ditherAlgo);
        if (settings.sidebarWidth) setSidebarWidth(settings.sidebarWidth);
        if (settings.collapsedGroups) setCollapsedGroups(settings.collapsedGroups);
      } catch (e) {
        console.error("Failed to hydrate settings", e);
      }
    }
  }, []);

  // Save to localStorage
  useEffect(() => {
    const settings = {
      retro, glitch, painterly, crt, glow, pixelSort, downscale,
      selectedPaletteName, customPalette, ditherAlgo, sidebarWidth, collapsedGroups
    };
    localStorage.setItem('dither-lab-settings', JSON.stringify(settings));
  }, [retro, glitch, painterly, crt, glow, pixelSort, downscale, selectedPaletteName, customPalette, ditherAlgo, sidebarWidth, collapsedGroups]);

  // Resizable Sidebar Handling
  const startResizing = useCallback((e) => {
    e.preventDefault();
    setIsResizingSidebar(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizingSidebar(false);
  }, []);

  const resize = useCallback((e) => {
    if (isResizingSidebar && !isMobile) {
      const newWidth = window.innerWidth - e.clientX;
      if (newWidth > 250 && newWidth < 800) {
        setSidebarWidth(newWidth);
      }
    }
  }, [isResizingSidebar, isMobile]);

  useEffect(() => {
    if (isResizingSidebar) {
      window.addEventListener('mousemove', resize);
      window.addEventListener('mouseup', stopResizing);
    }
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [isResizingSidebar, resize, stopResizing]);

  // Comparison slider mouse/touch handling
  const handleSliderInteraction = useCallback((clientX) => {
    if (!comparisonRef.current) return;
    const rect = comparisonRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setCompareSplit(percentage);
  }, []);

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
    handleSliderInteraction(e.clientX);
  }, [handleSliderInteraction]);

  const handleMouseMove = useCallback((e) => {
    if (!isDragging) return;
    handleSliderInteraction(e.clientX);
  }, [isDragging, handleSliderInteraction]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleTouchStart = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
    handleSliderInteraction(e.touches[0].clientX);
  }, [handleSliderInteraction]);

  const handleTouchMove = useCallback((e) => {
    if (!isDragging) return;
    handleSliderInteraction(e.touches[0].clientX);
  }, [isDragging, handleSliderInteraction]);

  // Selection mouse handling - now using image-relative coordinates
  const handleSelectionStart = useCallback((e) => {
    if (!useSelection || showComparison) return;

    const { x, y, inBounds } = clientToImagePercent(e.clientX, e.clientY);
    if (!inBounds) return;

    setSelectionStart({ x, y });
    setIsResizingSelection(true);
    setSelection({ x, y, w: 0, h: 0 });
  }, [useSelection, showComparison, clientToImagePercent]);

  const handleSelectionMove = useCallback((e) => {
    if (!isResizingSelection) return;

    const { x, y } = clientToImagePercent(e.clientX, e.clientY);

    setSelection({
      x: Math.min(x, selectionStart.x),
      y: Math.min(y, selectionStart.y),
      w: Math.abs(x - selectionStart.x),
      h: Math.abs(y - selectionStart.y)
    });
  }, [isResizingSelection, selectionStart, clientToImagePercent]);

  const handleSelectionEnd = useCallback(() => {
    setIsResizingSelection(false);
  }, []);

  // Add global mouse/touch listeners when dragging
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleTouchMove);
      window.addEventListener('touchend', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp, handleTouchMove]);

  // Global listeners for selection dragging
  useEffect(() => {
    if (isResizingSelection) {
      const moveHandler = (e) => handleSelectionMove(e);
      window.addEventListener('mousemove', moveHandler);
      window.addEventListener('mouseup', handleSelectionEnd);
      return () => {
        window.removeEventListener('mousemove', moveHandler);
        window.removeEventListener('mouseup', handleSelectionEnd);
      };
    }
  }, [isResizingSelection, handleSelectionMove, handleSelectionEnd]);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setStatus('Loading frames...');
    setIsProcessing(true);
    try {
      const url = URL.createObjectURL(file);
      setOriginalGif(url);
      const frameData = await gifFrames({ url, frames: 'all', outputType: 'canvas', cumulative: true });
      const extractedFrames = frameData.map(f => f.getImage());
      const first = extractedFrames[0];
      setDimensions({ width: first.width, height: first.height });
      setFrames(extractedFrames);
      setFrameRange([0, extractedFrames.length - 1]);
      setStatus('GIF loaded.');
    } catch (err) {
      console.error(err);
      setStatus('Error loading GIF');
    } finally {
      setIsProcessing(false);
    }
  };

  const getNearestColor = (r, g, b, cachedPalette) => {
    let minDistance = Infinity;
    let closestR = r, closestG = g, closestB = b;
    for (let i = 0; i < cachedPalette.length; i++) {
      const p = cachedPalette[i];
      const dr = r - p[0], dg = g - p[1], db = b - p[2];
      const dist = dr * dr + dg * dg + db * db;
      if (dist < minDistance) {
        minDistance = dist;
        closestR = p[0]; closestG = p[1]; closestB = p[2];
      }
    }
    return [closestR, closestG, closestB];
  };

  const runKMeans = () => {
    if (frames.length === 0) return;
    setIsAutoClustering(true);
    setStatus('Analyzing colors...');
    setTimeout(() => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const firstFrame = frames[0];
      canvas.width = firstFrame.width; canvas.height = firstFrame.height;
      ctx.drawImage(firstFrame, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const samples = [];
      const step = Math.floor(data.length / 4000) * 4;
      for (let i = 0; i < data.length; i += step) {
        samples.push([data[i], data[i + 1], data[i + 2]]);
      }
      let centroids = samples.slice(0, 8);
      for (let iter = 0; iter < 5; iter++) {
        const clusters = Array.from({ length: 8 }, () => []);
        for (const s of samples) {
          let bestDist = Infinity, bestIdx = 0;
          for (let i = 0; i < centroids.length; i++) {
            const d = Math.pow(s[0] - centroids[i][0], 2) + Math.pow(s[1] - centroids[i][1], 2) + Math.pow(s[2] - centroids[i][2], 2);
            if (d < bestDist) { bestDist = d; bestIdx = i; }
          }
          clusters[bestIdx].push(s);
        }
        centroids = clusters.map(c => {
          if (c.length === 0) return [Math.random() * 255, Math.random() * 255, Math.random() * 255];
          const sum = c.reduce((acc, val) => [acc[0] + val[0], acc[1] + val[1], acc[2] + val[2]], [0, 0, 0]);
          return [sum[0] / c.length, sum[1] / c.length, sum[2] / c.length];
        });
      }
      setCustomPalette(centroids.map(c => chroma(c).hex()));
      setSelectedPaletteName('Custom');
      setIsAutoClustering(false);
      setStatus('Palette generated!');
    }, 100);
  };

  const lerp = (v0, v1, t) => v0 * (1 - t) + v1 * t;

  const performPixelSort = (canvas, amount, threshold, isInSelection) => {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    // Simple vertical pixel sort
    for (let x = 0; x < width; x++) {
      let column = [];
      for (let y = 0; y < height; y++) {
        const i = (y * width + x) * 4;
        const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
        column.push({ r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3], bness: brightness, inSel: isInSelection(x, y, width, height) });
      }

      // Sort segments based on threshold - only within selection
      let start = 0;
      while (start < height) {
        let end = start;
        while (end < height && column[end].bness > (threshold / 100) * 255 && column[end].inSel) end++;

        if (end > start && Math.random() < amount / 100) {
          const segment = column.slice(start, end).sort((a, b) => a.bness - b.bness);
          for (let y = 0; y < segment.length; y++) {
            const i = ((start + y) * width + x) * 4;
            data[i] = segment[y].r;
            data[i + 1] = segment[y].g;
            data[i + 2] = segment[y].b;
            data[i + 3] = segment[y].a;
          }
        }
        start = end + 1;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  };

  const processGif = async () => {
    if (frames.length === 0) return;
    setIsProcessing(true);
    setProgress(0);
    setStatus('Preparing Palette...');

    const rawPalette = selectedPaletteName === 'Custom' ? customPalette : PRESET_PALETTES[selectedPaletteName];
    const cachedPalette = rawPalette ? rawPalette.map(c => chroma(c).rgb()) : null;

    // Downscale targets
    const baseWidth = frames[0].width;
    const baseHeight = frames[0].height;
    const workWidth = Math.floor(baseWidth / downscale);
    const workHeight = Math.floor(baseHeight / downscale);

    const gif = new GIF({
      workers: 4, quality: 10,
      width: baseWidth, height: baseHeight,
      workerScript: '/gif.worker.js'
    });

    const start = frameRange[0];
    const end = frameRange[1];
    const totalSelected = end - start + 1;

    // Precompute selection bounds in pixels (for current working dimensions)
    // Selection is stored as percentages of the image
    const getSelectionBounds = (w, h) => {
      if (!useSelection || selection.w === 0 || selection.h === 0) {
        return { sx: 0, sy: 0, sw: w, sh: h, enabled: false };
      }
      return {
        sx: Math.floor((selection.x / 100) * w),
        sy: Math.floor((selection.y / 100) * h),
        sw: Math.floor((selection.w / 100) * w),
        sh: Math.floor((selection.h / 100) * h),
        enabled: true
      };
    };

    for (let index = 0; index < frames.length; index++) {
      const originalFrame = frames[index];
      const canvas = document.createElement('canvas');
      canvas.width = baseWidth;
      canvas.height = baseHeight;
      const ctx = canvas.getContext('2d');

      // Draw original frame
      ctx.drawImage(originalFrame, 0, 0, baseWidth, baseHeight);

      let t = 0;
      if (index >= start && index <= end) {
        t = 1;
        const distFromStart = index - start, distFromEnd = end - index;
        const falloffFrames = Math.floor((falloff / 100) * totalSelected) || 1;
        if (distFromStart < falloffFrames) t = distFromStart / falloffFrames;
        if (distFromEnd < falloffFrames) t = Math.min(t, distFromEnd / falloffFrames);
      }

      // Check if pixel is in selection
      const isInSelection = (px, py, w, h) => {
        if (!useSelection || selection.w === 0 || selection.h === 0) return true;
        const sx = (selection.x / 100) * w;
        const sy = (selection.y / 100) * h;
        const sw = (selection.w / 100) * w;
        const sh = (selection.h / 100) * h;
        return px >= sx && px < sx + sw && py >= sy && py < sy + sh;
      };

      if (t > 0) {
        const animProgress = (index - start) / totalSelected;
        const currentRetro = retro.animate ? lerp(retro.start, retro.end, animProgress) : retro.start;
        const currentGlitch = glitch.animate ? lerp(glitch.start, glitch.end, animProgress) : glitch.start;
        const currentPainterly = painterly.animate ? lerp(painterly.start, painterly.end, animProgress) : painterly.start;
        const currentCRT = crt.animate ? lerp(crt.start, crt.end, animProgress) : crt.start;
        const currentGlow = glow.animate ? lerp(glow.start, glow.end, animProgress) : glow.start;
        const currentSort = pixelSort.animate ? lerp(pixelSort.start, pixelSort.end, animProgress) : pixelSort.start;

        // 1. Resolution Downscale (Internal resampling)
        if (downscale > 1) {
          const offCanvas = document.createElement('canvas');
          offCanvas.width = workWidth; offCanvas.height = workHeight;
          const offCtx = offCanvas.getContext('2d');
          offCtx.imageSmoothingEnabled = false;
          offCtx.drawImage(canvas, 0, 0, workWidth, workHeight);

          canvas.width = workWidth; canvas.height = workHeight;
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(offCanvas, 0, 0);
        }

        const width = canvas.width;
        const height = canvas.height;
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;

        // Store original data for non-selected pixels
        const originalData = new Uint8ClampedArray(data);

        const strength = (currentRetro / 100) * t;
        const pStep = Math.floor(currentPainterly / 10) + 1;
        const algo = DITHER_ALGOS[ditherAlgo];

        // Dithering loop
        if (algo.type === 'diffusion') {
          const errorBuffer = new Float32Array(data.length);
          for (let i = 0; i < data.length; i++) errorBuffer[i] = data[i];

          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const i = (y * width + x) * 4;
              let r = errorBuffer[i], g = errorBuffer[i + 1], b = errorBuffer[i + 2];

              if (isInSelection(x, y, width, height)) {
                if (currentPainterly > 0) {
                  r = Math.round(r / (pStep * 20)) * (pStep * 20);
                  g = Math.round(g / (pStep * 20)) * (pStep * 20);
                  b = Math.round(b / (pStep * 20)) * (pStep * 20);
                }

                let [nr, ng, nb] = cachedPalette ? getNearestColor(r, g, b, cachedPalette) : [r > 127 ? 255 : 0, g > 127 ? 255 : 0, b > 127 ? 255 : 0];

                const blendR = r + (nr - r) * strength, blendG = g + (ng - g) * strength, blendB = b + (nb - b) * strength;
                data[i] = blendR; data[i + 1] = blendG; data[i + 2] = blendB;

                const er = r - blendR, eg = g - blendG, eb = b - blendB;
                for (const k of algo.kernel) {
                  const nx = x + k.x, ny = y + k.y;
                  if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                    const ni = (ny * width + nx) * 4;
                    errorBuffer[ni] += er * k.w; errorBuffer[ni + 1] += eg * k.w; errorBuffer[ni + 2] += eb * k.w;
                  }
                }

                if (currentGlitch > 0 && Math.random() < (currentGlitch / 5000) * t) data[i] = data[i + 20] || data[i];
                if (currentCRT > 0 && y % 2 === 0) { const s = 1 - (currentCRT / 150) * t; data[i] *= s; data[i + 1] *= s; data[i + 2] *= s; }
              } else {
                // Keep original pixel data for non-selected areas
                data[i] = originalData[i];
                data[i + 1] = originalData[i + 1];
                data[i + 2] = originalData[i + 2];
              }
            }
          }
        } else {
          for (let i = 0; i < data.length; i += 4) {
            const x = (i / 4) % width, y = Math.floor((i / 4) / width);

            if (isInSelection(x, y, width, height)) {
              let r = data[i], g = data[i + 1], b = data[i + 2];

              if (currentPainterly > 0) {
                r = Math.round(r / (pStep * 20)) * (pStep * 20);
                g = Math.round(g / (pStep * 20)) * (pStep * 20);
                b = Math.round(b / (pStep * 20)) * (pStep * 20);
              }
              if (currentRetro > 0) {
                const threshold = bayerMatrix8x8[y % 8][x % 8] / 64 * 255;
                const dr = r > threshold ? 255 : 0, dg = g > threshold ? 255 : 0, db = b > threshold ? 255 : 0;
                r = r + (dr - r) * strength; g = g + (dg - g) * strength; b = b + (db - b) * strength;
              }
              if (cachedPalette) { const [nr, ng, nb] = getNearestColor(r, g, b, cachedPalette); r = nr; g = ng; b = nb; }
              if (currentGlitch > 0 && Math.random() < (currentGlitch / 5000) * t) r = data[i + 20] || r;
              if (currentCRT > 0 && y % 2 === 0) { const s = 1 - (currentCRT / 150) * t; r *= s; g *= s; b *= s; }
              data[i] = r; data[i + 1] = g; data[i + 2] = b;
            }
            // Non-selected pixels already have original data, no need to change
          }
        }
        ctx.putImageData(imageData, 0, 0);

        // 2. Pixel Sort (with selection awareness)
        if (currentSort > 0) {
          performPixelSort(canvas, currentSort, pixelSort.threshold, isInSelection);
        }

        // 3. Glow (Bloom) - only apply to selected region
        if (currentGlow > 0) {
          const glowCanvas = document.createElement('canvas');
          glowCanvas.width = width; glowCanvas.height = height;
          const glowCtx = glowCanvas.getContext('2d');

          // If selection is enabled, mask the glow to the selection area
          if (useSelection && selection.w > 0 && selection.h > 0) {
            const selBounds = getSelectionBounds(width, height);
            glowCtx.filter = `blur(${Math.max(1, currentGlow / 10)}px)`;
            glowCtx.drawImage(canvas, selBounds.sx, selBounds.sy, selBounds.sw, selBounds.sh,
              selBounds.sx, selBounds.sy, selBounds.sw, selBounds.sh);

            // Create a mask for the selection area
            ctx.save();
            ctx.beginPath();
            ctx.rect(selBounds.sx, selBounds.sy, selBounds.sw, selBounds.sh);
            ctx.clip();
            ctx.globalAlpha = (currentGlow / 150) * t;
            ctx.globalCompositeOperation = 'screen';
            ctx.drawImage(glowCanvas, 0, 0);
            ctx.restore();
          } else {
            glowCtx.filter = `blur(${Math.max(1, currentGlow / 10)}px)`;
            glowCtx.drawImage(canvas, 0, 0);
            ctx.globalAlpha = (currentGlow / 150) * t;
            ctx.globalCompositeOperation = 'screen';
            ctx.drawImage(glowCanvas, 0, 0);
          }
          ctx.globalAlpha = 1.0; ctx.globalCompositeOperation = 'source-over';
        }

        // 4. Upscale back to original size if downscaled
        if (downscale > 1) {
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = baseWidth; tempCanvas.height = baseHeight;
          const tempCtx = tempCanvas.getContext('2d');
          tempCtx.imageSmoothingEnabled = false;
          tempCtx.drawImage(canvas, 0, 0, baseWidth, baseHeight);
          canvas.width = baseWidth; canvas.height = baseHeight;
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(tempCanvas, 0, 0);
        }
      }

      gif.addFrame(canvas, { delay: 100, copy: true });
      setProgress(Math.round(((index + 1) / frames.length) * 50));
      setStatus(`Processing: ${index + 1}/${frames.length}`);
      if (index % 5 === 0) await new Promise(r => setTimeout(r, 0));
    }
    gif.on('progress', p => { setProgress(50 + Math.round(p * 50)); setStatus(`Rendering: ${Math.round(p * 100)}%`); });
    gif.on('finished', blob => {
      const url = URL.createObjectURL(blob);
      setOutputGif(url);
      setIsProcessing(false);
      setStatus('Done!');
      setShowComparison(true);

      // Add to history
      setHistory(prev => [{
        id: Date.now(),
        url,
        timestamp: new Date().toLocaleTimeString(),
        settings: { ditherAlgo, palette: selectedPaletteName, retro: retro.start }
      }, ...prev].slice(0, 10)); // Keep last 10
    });
    gif.render();
  };

  const ControlSlider = ({ title, value, onChange, icon: Icon, extra, id }) => {
    const isCollapsed = collapsedGroups[id];
    return (
      <div className={`control-group ${isCollapsed ? 'collapsed' : ''}`}>
        <div className="control-header" onClick={() => id && setCollapsedGroups(prev => ({ ...prev, [id]: !prev[id] }))} style={{ cursor: id ? 'pointer' : 'default' }}>
          <h3><Icon size={14} /> {title}</h3>
          <div className="header-controls">
            {onChange && (
              <button className={`animate-toggle ${value.animate ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); onChange({ ...value, animate: !value.animate }); }}><Activity size={12} /></button>
            )}
            {id && <button className="collapse-btn">{isCollapsed ? <Plus size={12} /> : <X size={12} />}</button>}
          </div>
        </div>
        {!isCollapsed && (
          <>
            {onChange && (!value.animate ? (
              <div className="slider-container">
                <div className="slider-label"><span>Static</span><span>{Math.round(value.start)}%</span></div>
                <input type="range" value={value.start} onChange={(e) => onChange({ ...value, start: parseInt(e.target.value), end: parseInt(e.target.value) })} />
              </div>
            ) : (
              <div className="animation-sliders">
                <div className="slider-container">
                  <div className="slider-label"><span>Start</span><span>{Math.round(value.start)}%</span></div>
                  <input type="range" value={value.start} onChange={(e) => onChange({ ...value, start: parseInt(e.target.value) })} />
                </div>
                <div className="slider-container">
                  <div className="slider-label"><span>End</span><span>{Math.round(value.end)}%</span></div>
                  <input type="range" value={value.end} onChange={(e) => onChange({ ...value, end: parseInt(e.target.value) })} />
                </div>
              </div>
            ))}
            {extra}
          </>
        )}
      </div>
    );
  };

  // Calculate selection box position relative to the actual image for display
  const getSelectionStyle = useCallback(() => {
    const bounds = getImageBounds();
    if (!bounds || !useSelection) return { display: 'none' };

    const { offsetX, offsetY, renderedWidth, renderedHeight } = bounds;

    return {
      left: `${offsetX + (selection.x / 100) * renderedWidth}px`,
      top: `${offsetY + (selection.y / 100) * renderedHeight}px`,
      width: `${(selection.w / 100) * renderedWidth}px`,
      height: `${(selection.h / 100) * renderedHeight}px`,
    };
  }, [getImageBounds, useSelection, selection]);

  return (
    <div className="app-container">
      <header>
        <div className="header-brand">
          <div className="logo">GIF DITHER LAB</div>
          <div className="instructions">
            <span>1. Upload GIF</span>
            <ArrowRight size={10} />
            <span>2. Tweak Effects</span>
            <ArrowRight size={10} />
            <span>3. Mask Region</span>
            <ArrowRight size={10} />
            <span>4. Export</span>
          </div>
        </div>
        <div className="header-actions">
          {originalGif && (
            <button className="preset-button" onClick={() => { setOriginalGif(null); setFrames([]); setOutputGif(null); setCustomPalette([]); setShowComparison(false); }}><Trash2 size={16} /> Reset</button>
          )}
        </div>
      </header>
      <main>
        <section className="preview-area">
          <div className={`upload-zone ${!originalGif ? 'empty' : ''}`} onClick={() => !originalGif && fileInputRef.current.click()}>
            <input type="file" ref={fileInputRef} hidden accept="image/gif" onChange={handleFileUpload} />
            {!originalGif ? (
              <div className="upload-prompt">
                <motion.div animate={{ y: [0, -10, 0] }} transition={{ repeat: Infinity, duration: 2 }}><Upload size={48} color="var(--primary-color)" /></motion.div>
                <h2>Drop your GIF here</h2>
                <p>or click to browse</p>
              </div>
            ) : (
              <div className="preview-container">
                {outputGif && showComparison ? (
                  <div
                    ref={comparisonRef}
                    className="comparison-slider"
                    style={{
                      '--split': `${compareSplit}%`,
                      aspectRatio: `${dimensions.width} / ${dimensions.height}`,
                      maxWidth: '100%',
                      maxHeight: '100%',
                      cursor: 'ew-resize'
                    }}
                    onMouseDown={handleMouseDown}
                    onTouchStart={handleTouchStart}
                  >
                    <img src={originalGif} className="compare-original" alt="Original" draggable={false} />
                    <img src={outputGif} className="compare-output" alt="Result" draggable={false} />
                    <div className="compare-handle" style={{ left: `${compareSplit}%` }}>
                      <div className="handle-line"></div>
                      <div className="handle-circle">
                        <MoveHorizontal size={16} />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    ref={previewWrapperRef}
                    className="preview-wrapper"
                    onMouseDown={handleSelectionStart}
                    style={{ cursor: useSelection ? 'crosshair' : 'default' }}
                  >
                    <img
                      ref={previewImageRef}
                      src={outputGif || originalGif}
                      alt="Preview"
                      draggable={false}
                      style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                    />
                    {useSelection && !outputGif && selection.w > 0 && selection.h > 0 && (
                      <div
                        className="selection-box"
                        style={getSelectionStyle()}
                      >
                        <div className="selection-label">Target Region ({Math.round(selection.w)}% × {Math.round(selection.h)}%)</div>
                      </div>
                    )}
                  </div>
                )}

                {/* History Gallery Overlay */}
                {history.length > 0 && (
                  <div className={`history-gallery ${!showHistory ? 'hidden' : ''}`}>
                    <button className="gallery-toggle" onClick={() => setShowHistory(!showHistory)}>
                      {showHistory ? <X size={14} /> : <ImageIcon size={14} />} {showHistory ? 'Hide History' : 'Show History'}
                    </button>
                    <div className="history-header">
                      <h3><Activity size={14} /> Session History</h3>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{history.length} versions</span>
                    </div>
                    <div className="history-items">
                      {history.map(item => (
                        <div
                          key={item.id}
                          className={`history-item ${outputGif === item.url ? 'active' : ''}`}
                          onClick={() => { setOutputGif(item.url); setShowComparison(true); }}
                        >
                          <img src={item.url} alt="History version" />
                          <div className="item-time">{item.timestamp}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {isProcessing && <div className="processing-overlay"><div className="loader"></div><p>{status} {progress}%</p></div>}
              </div>
            )}
          </div>
          {frames.length > 0 && (
            <div className="timeline-container">
              <div className="timeline-header">
                <h3><Layers size={14} /> Dither Range: {frameRange[0]} - {frameRange[1]}</h3>
                <div className="timeline-controls"><span>Falloff: {falloff}%</span><input type="range" value={falloff} onChange={(e) => setFalloff(parseInt(e.target.value))} style={{ width: '80px' }} /></div>
              </div>
              <div className="timeline-slider">
                <input type="range" min="0" max={frames.length - 1} value={frameRange[0]} onChange={(e) => setFrameRange([Math.min(parseInt(e.target.value), frameRange[1]), frameRange[1]])} />
                <input type="range" min="0" max={frames.length - 1} value={frameRange[1]} onChange={(e) => setFrameRange([frameRange[0], Math.max(parseInt(e.target.value), frameRange[0])])} />
              </div>
            </div>
          )}
        </section>

        <div className={`sidebar-resizer ${isResizingSidebar ? 'active' : ''}`} onMouseDown={startResizing} />

        <aside className="controls-panel" style={{ width: isMobile ? '100%' : `${sidebarWidth}px` }}>
          <div className="control-group">
            <h3><Palette size={14} /> Color Library</h3>
            <div className="preset-grid">
              {Object.keys(PRESET_PALETTES).map(name => (
                <button key={name} className={`preset-button ${selectedPaletteName === name ? 'active' : ''}`} onClick={() => setSelectedPaletteName(name)}>{name}</button>
              ))}
              <button className={`preset-button ${selectedPaletteName === 'Custom' ? 'active' : ''}`} onClick={() => setSelectedPaletteName('Custom')}>Custom</button>
            </div>
            <div className="palette-preview">{(selectedPaletteName === 'Custom' ? customPalette : PRESET_PALETTES[selectedPaletteName])?.map((c, i) => <div key={i} className="palette-swatch" style={{ background: c }}></div>)}</div>
            {selectedPaletteName === 'Custom' && (
              <div className="custom-palette-actions">
                <button className="preset-button" onClick={runKMeans} disabled={isAutoClustering}>{isAutoClustering ? 'Analyzing...' : 'Auto-Extract'}</button>
                <div className="color-adder"><input type="color" onChange={(e) => setCustomPalette([...customPalette, e.target.value])} title="Add Color" /><button className="preset-button" onClick={() => setCustomPalette([])}><Plus size={14} /></button></div>
              </div>
            )}
          </div>
          <div className="control-group">
            <h3><Grid size={14} /> Dither Algorithm</h3>
            <div className="preset-grid">{Object.keys(DITHER_ALGOS).map(algo => <button key={algo} className={`preset-button ${ditherAlgo === algo ? 'active' : ''}`} onClick={() => setDitherAlgo(algo)}>{algo}</button>)}</div>
          </div>

          <div className="control-group">
            <div className="control-header" onClick={() => setUseSelection(!useSelection)} style={{ cursor: 'pointer' }}>
              <h3><Layers size={14} /> Region Mask</h3>
              <button className={`animate-toggle ${useSelection ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); setUseSelection(!useSelection); setShowComparison(false); setOutputGif(null); }} title="Toggle Selection Tool">
                <Box size={14} />
              </button>
            </div>
            {useSelection && (
              <>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: '4px' }}>
                  Click and drag on the preview to select a region. Only this area will be dithered.
                </p>
                {selection.w > 0 && selection.h > 0 && (
                  <p style={{ fontSize: '0.75rem', color: 'var(--primary-color)', marginTop: '4px' }}>
                    Selection: {Math.round(selection.x)}%, {Math.round(selection.y)}% → {Math.round(selection.w)}% × {Math.round(selection.h)}%
                  </p>
                )}
              </>
            )}
          </div>

          <ControlSlider id="downscale" title="Downscale Factor" value={{ start: downscale }} onChange={null} icon={Box} extra={
            <div className="slider-container">
              <div className="slider-label"><span>Factor</span><span>{downscale}x</span></div>
              <input type="range" min="1" max="8" step="1" value={downscale} onChange={(e) => setDownscale(parseInt(e.target.value))} />
            </div>
          } />

          <ControlSlider id="pixelSort" title="Pixel Sort" value={pixelSort} onChange={setPixelSort} icon={ArrowRight} extra={
            <div className="slider-container">
              <div className="slider-label"><span>Threshold</span><span>{pixelSort.threshold}%</span></div>
              <input type="range" value={pixelSort.threshold} onChange={(e) => setPixelSort({ ...pixelSort, threshold: parseInt(e.target.value) })} />
            </div>
          } />

          <ControlSlider id="retro" title="Dither Strength" value={retro} onChange={setRetro} icon={Activity} />
          <ControlSlider id="crt" title="CRT Scanlines" value={crt} onChange={setCrt} icon={Tv} />
          <ControlSlider id="glow" title="Phosphor Glow" value={glow} onChange={setGlow} icon={Zap} />
          <div className="control-group">
            <h3><Activity size={14} /> Utility</h3>
            <div className="slider-container"><div className="slider-label"><span>Noisy Glitch</span><span>{glitch.start}%</span></div><input type="range" value={glitch.start} onChange={(e) => setGlitch({ ...glitch, start: parseInt(e.target.value), end: parseInt(e.target.value) })} /></div>
            <div className="slider-container"><div className="slider-label"><span>Painterly</span><span>{painterly.start}%</span></div><input type="range" value={painterly.start} onChange={(e) => setPainterly({ ...painterly, start: parseInt(e.target.value), end: parseInt(e.target.value) })} /></div>
          </div>
          <button className="action-button" disabled={!originalGif || isProcessing} onClick={processGif}>{isProcessing ? 'Processing...' : 'Run Lab'}</button>
          {outputGif && <a href={outputGif} download="dithered.gif" className="action-button" style={{ textAlign: 'center', textDecoration: 'none', background: 'var(--primary-color)', color: 'black' }}>Download Result <Download size={16} /></a>}
        </aside>
      </main>
      <AnimatePresence>{status && <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} className="status-toast"><div className="status-dot"></div>{status}</motion.div>}</AnimatePresence>
    </div>
  );
}
