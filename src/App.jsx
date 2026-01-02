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
  const [selection, setSelection] = useState({ x: 10, y: 10, w: 80, h: 80 }); // Percentages
  const [isResizingSelection, setIsResizingSelection] = useState(false);
  const [selectionStart, setSelectionStart] = useState({ x: 0, y: 0 });

  // Palette State
  const [selectedPaletteName, setSelectedPaletteName] = useState('True Color');
  const [customPalette, setCustomPalette] = useState([]);
  const [isAutoClustering, setIsAutoClustering] = useState(false);

  const fileInputRef = useRef(null);
  const comparisonRef = useRef(null);
  const previewImgRef = useRef(null);

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

  // Selection mouse handling
  const handleSelectionStart = (e) => {
    if (!useSelection || showComparison || !previewImgRef.current) return;
    const rect = previewImgRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
    setSelectionStart({ x, y });
    setIsResizingSelection(true);
    setSelection({ x, y, w: 0, h: 0 });
  };

  const handleSelectionMove = (e) => {
    if (!isResizingSelection || !previewImgRef.current) return;
    const rect = previewImgRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));

    setSelection({
      x: Math.min(x, selectionStart.x),
      y: Math.min(y, selectionStart.y),
      w: Math.abs(x - selectionStart.x),
      h: Math.abs(y - selectionStart.y)
    });
  };

  const handleSelectionEnd = () => {
    setIsResizingSelection(false);
  };

  // Add global mouse/touch listeners when dragging
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleTouchMove);
      window.addEventListener('touchend', handleMouseUp);
    }
    if (isResizingSelection) {
      window.addEventListener('mouseup', handleSelectionEnd);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleMouseUp);
      window.removeEventListener('mouseup', handleSelectionEnd);
    };
  }, [isDragging, handleMouseMove, handleMouseUp, handleTouchMove, isResizingSelection]);

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

  const performPixelSort = (canvas, amount, threshold) => {
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
        column.push({ r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3], bness: brightness });
      }

      // Sort segments based on threshold
      let start = 0;
      while (start < height) {
        let end = start;
        while (end < height && column[end].bness > (threshold / 100) * 255) end++;

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

    for (let index = 0; index < frames.length; index++) {
      const originalFrame = frames[index];
      const canvas = document.createElement('canvas');
      canvas.width = baseWidth;
      canvas.height = baseHeight;
      const ctx = canvas.getContext('2d');

      // Draw centered or scaled original for processing
      ctx.drawImage(originalFrame, 0, 0, baseWidth, baseHeight);

      let t = 0;
      if (index >= start && index <= end) {
        t = 1;
        const distFromStart = index - start, distFromEnd = end - index;
        const falloffFrames = Math.floor((falloff / 100) * totalSelected) || 1;
        if (distFromStart < falloffFrames) t = distFromStart / falloffFrames;
        if (distFromEnd < falloffFrames) t = Math.min(t, distFromEnd / falloffFrames);
      }

      // Check if pixel is in selection (use base dimensions, not working dimensions)
      const isInSelection = (px, py, currentW, currentH) => {
        if (!useSelection || selection.w === 0 || selection.h === 0) return true;
        // Convert percentage to pixel in current working dimensions
        const sx = (selection.x / 100) * currentW;
        const sy = (selection.y / 100) * currentH;
        const sw = (selection.w / 100) * currentW;
        const sh = (selection.h / 100) * currentH;
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
                data[i] = originalFrame.width === canvas.width ? errorBuffer[i] : data[i];
                data[i + 1] = originalFrame.width === canvas.width ? errorBuffer[i + 1] : data[i + 1];
                data[i + 2] = originalFrame.width === canvas.width ? errorBuffer[i + 2] : data[i + 2];
              }
            }
          }
        } else {
          for (let i = 0; i < data.length; i += 4) {
            let r = data[i], g = data[i + 1], b = data[i + 2];
            const x = (i / 4) % width, y = Math.floor((i / 4) / width);

            if (isInSelection(x, y, width, height)) {
              if (currentPainterly > 0) { r = Math.round(r / (pStep * 20)) * (pStep * 20); g = Math.round(g / (pStep * 20)) * (pStep * 20); b = Math.round(b / (pStep * 20)) * (pStep * 20); }
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
          }
        }
        ctx.putImageData(imageData, 0, 0);

        // 2. Pixel Sort
        if (currentSort > 0) {
          performPixelSort(canvas, currentSort, pixelSort.threshold);
        }

        // 3. Glow (Bloom)
        if (currentGlow > 0) {
          const glowCanvas = document.createElement('canvas');
          glowCanvas.width = width; glowCanvas.height = height;
          const glowCtx = glowCanvas.getContext('2d');
          glowCtx.filter = `blur(${Math.max(1, currentGlow / 10)}px)`;
          glowCtx.drawImage(canvas, 0, 0);
          ctx.globalAlpha = (currentGlow / 150) * t;
          ctx.globalCompositeOperation = 'screen';
          ctx.drawImage(glowCanvas, 0, 0);
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
    gif.on('finished', blob => { setOutputGif(URL.createObjectURL(blob)); setIsProcessing(false); setStatus('Done!'); setShowComparison(true); });
    gif.render();
  };

  const ControlSlider = ({ title, value, onChange, icon: Icon, extra }) => (
    <div className="control-group">
      <div className="control-header">
        <h3><Icon size={14} /> {title}</h3>
        {onChange && (
          <button className={`animate-toggle ${value.animate ? 'active' : ''}`} onClick={() => onChange({ ...value, animate: !value.animate })}><Activity size={12} /></button>
        )}
      </div>
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
    </div>
  );

  return (
    <div className="app-container">
      <header>
        <div className="logo">DITHER LAB</div>
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
                    className="preview-wrapper"
                    onMouseDown={handleSelectionStart}
                    onMouseMove={handleSelectionMove}
                  >
                    <img
                      ref={previewImgRef}
                      src={outputGif || originalGif}
                      alt="Preview"
                      draggable={false}
                    />
                    {useSelection && !outputGif && selection.w > 0 && selection.h > 0 && (
                      <div
                        className="selection-box"
                        style={{
                          left: `${selection.x}%`,
                          top: `${selection.y}%`,
                          width: `${selection.w}%`,
                          height: `${selection.h}%`
                        }}
                      >
                        <div className="selection-label">Target Region</div>
                      </div>
                    )}
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
        <aside className="controls-panel">
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
            <div className="control-header">
              <h3><Layers size={14} /> Region Mask</h3>
              <button className={`animate-toggle ${useSelection ? 'active' : ''}`} onClick={() => { setUseSelection(!useSelection); setShowComparison(false); }} title="Toggle Selection Tool">
                <Box size={14} />
              </button>
            </div>
            {useSelection && <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: '4px' }}>Click and drag on the preview to select a region.</p>}
          </div>

          <ControlSlider title="Downscale Factor" value={{ start: downscale }} onChange={(v) => setDownscale(v.start)} icon={Box} extra={
            <div className="slider-container">
              <div className="slider-label"><span>Factor</span><span>{downscale}x</span></div>
              <input type="range" min="1" max="8" step="1" value={downscale} onChange={(e) => setDownscale(parseInt(e.target.value))} />
            </div>
          } />

          <ControlSlider title="Pixel Sort" value={pixelSort} onChange={setPixelSort} icon={ArrowRight} extra={
            <div className="slider-container">
              <div className="slider-label"><span>Threshold</span><span>{pixelSort.threshold}%</span></div>
              <input type="range" value={pixelSort.threshold} onChange={(e) => setPixelSort({ ...pixelSort, threshold: parseInt(e.target.value) })} />
            </div>
          } />

          <ControlSlider title="Dither Strength" value={retro} onChange={setRetro} icon={Activity} />
          <ControlSlider title="CRT Scanlines" value={crt} onChange={setCrt} icon={Tv} />
          <ControlSlider title="Phosphor Glow" value={glow} onChange={setGlow} icon={Zap} />
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
