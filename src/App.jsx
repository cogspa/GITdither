import React, { useState, useRef, useEffect } from 'react';
import { Upload, Download, Sliders, Layers, Monitor, Image as ImageIcon, Zap, Palette, Trash2, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import gifFrames from 'gif-frames';
import GIF from 'gif.js';

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

const ASPECT_RATIOS = [
  { label: '1:1', value: 1, icon: 'Square' },
  { label: '9:16', value: 9/16, icon: 'Smartphone' },
  { label: '16:9', value: 16/9, icon: 'Monitor' },
  { label: '4:5', value: 4/5, icon: 'Image' }
];

export default function App() {
  const [originalGif, setOriginalGif] = useState(null);
  const [frames, setFrames] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [outputGif, setOutputGif] = useState(null);
  const [progress, setProgress] = useState(0);
  
  // Controls
  const [retro, setRetro] = useState(50);
  const [glitch, setGlitch] = useState(0);
  const [painterly, setPainterly] = useState(0);
  const [frameRange, setFrameRange] = useState([0, 100]);
  const [falloff, setFalloff] = useState(20);
  const [aspectRatio, setAspectRatio] = useState(1);
  const [status, setStatus] = useState('');

  const fileInputRef = useRef(null);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setStatus('Loading frames...');
    setIsProcessing(true);
    
    try {
      const url = URL.createObjectURL(file);
      setOriginalGif(url);
      
      const frameData = await gifFrames({ 
        url, 
        frames: 'all', 
        outputType: 'canvas',
        cumulative: true 
      });
      
      setFrames(frameData.map(f => f.getImage()));
      setFrameRange([0, frameData.length - 1]);
      setStatus('GIF loaded.');
    } catch (err) {
      console.error(err);
      setStatus('Error loading GIF');
    } finally {
      setIsProcessing(false);
    }
  };

  const applyEffects = (canvas, t) => {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    // t is the effect strength (0 to 1)
    if (t === 0) return;

    // Painterly (Simplification)
    if (painterly > 0) {
      const step = Math.floor(painterly / 10) + 1;
      for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.round(data[i] / (step * 20)) * (step * 20);
        data[i+1] = Math.round(data[i+1] / (step * 20)) * (step * 20);
        data[i+2] = Math.round(data[i+2] / (step * 20)) * (step * 20);
      }
    }

    // Retro Dither (Bayer)
    if (retro > 0) {
      const strength = (retro / 100) * t;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          const threshold = bayerMatrix8x8[y % 8][x % 8] / 64 * 255;
          
          for (let c = 0; c < 3; c++) {
            const val = data[i + c];
            const dithered = val > threshold ? 255 : 0;
            data[i + c] = val + (dithered - val) * strength;
          }
        }
      }
    }

    // Noisy Glitch
    if (glitch > 0 && Math.random() < (glitch / 100) * t) {
      const shift = Math.floor((glitch / 10) * Math.random());
      const direction = Math.random() > 0.5 ? 1 : -1;
      
      // RGB Shift
      for (let i = 0; i < data.length - shift * 4; i += 4) {
        if (Math.random() < 0.1) {
           data[i] = data[i + shift * 4] || data[i]; // Red shift
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
  };

  const processGif = () => {
    if (frames.length === 0) return;
    
    setIsProcessing(true);
    setProgress(0);
    setStatus('Processing frames...');

    const gif = new GIF({
      workers: 2,
      quality: 10,
      width: frames[0].width,
      height: frames[0].height,
      workerScript: '/gif.worker.js'
    });

    const start = frameRange[0];
    const end = frameRange[1];
    const totalSelected = end - start + 1;

    frames.forEach((originalFrame, index) => {
      const canvas = document.createElement('canvas');
      canvas.width = originalFrame.width;
      canvas.height = originalFrame.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(originalFrame, 0, 0);

      // Calculate T based on range and falloff
      let t = 0;
      if (index >= start && index <= end) {
        t = 1;
        // Falloff logic
        const distFromStart = index - start;
        const distFromEnd = end - index;
        const falloffFrames = Math.floor((falloff / 100) * totalSelected);
        
        if (distFromStart < falloffFrames) t = distFromStart / falloffFrames;
        if (distFromEnd < falloffFrames) t = Math.min(t, distFromEnd / falloffFrames);
      }

      applyEffects(canvas, t);
      
      gif.addFrame(canvas, { delay: 100, copy: true });
      setProgress(Math.round(((index + 1) / frames.length) * 50));
    });

    gif.on('progress', (p) => {
      setProgress(50 + Math.round(p * 50));
      setStatus(`Rendering: ${Math.round(p * 100)}%`);
    });

    gif.on('finished', (blob) => {
      setOutputGif(URL.createObjectURL(blob));
      setIsProcessing(false);
      setStatus('Done!');
    });

    gif.render();
  };

  return (
    <div className="app-container">
      <header>
        <div className="logo">DITHER LAB</div>
        <div className="header-actions">
          {originalGif && (
            <button className="preset-button" onClick={() => {
              setOriginalGif(null);
              setFrames([]);
              setOutputGif(null);
            }}>
              <Trash2 size={16} /> Reset
            </button>
          )}
        </div>
      </header>

      <main>
        <section className="preview-area">
          <div 
            className={`upload-zone ${!originalGif ? 'empty' : ''}`}
            onClick={() => !originalGif && fileInputRef.current.click()}
          >
            <input 
              type="file" 
              ref={fileInputRef} 
              hidden 
              accept="image/gif" 
              onChange={handleFileUpload} 
            />
            
            {!originalGif ? (
              <div className="upload-prompt">
                <motion.div 
                  animate={{ y: [0, -10, 0] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                >
                  <Upload size={48} color="var(--primary-color)" />
                </motion.div>
                <h2>Drop your GIF here</h2>
                <p>or click to browse</p>
              </div>
            ) : (
              <div className="preview-container">
                <img src={outputGif || originalGif} alt="Preview" />
                {isProcessing && (
                  <div className="processing-overlay">
                    <div className="loader"></div>
                    <p>{status} {progress}%</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {frames.length > 0 && (
            <div className="timeline-container">
              <div className="timeline-header">
                <h3><Layers size={14} /> Frame Range: {frameRange[0]} - {frameRange[1]}</h3>
                <div className="timeline-controls">
                  <span>Falloff: {falloff}%</span>
                  <input 
                    type="range" 
                    value={falloff} 
                    onChange={(e) => setFalloff(parseInt(e.target.value))} 
                    style={{ width: '100px' }}
                  />
                </div>
              </div>
              <div className="timeline-slider">
                <input 
                  type="range" 
                  min="0" 
                  max={frames.length - 1} 
                  value={frameRange[0]} 
                  onChange={(e) => setFrameRange([Math.min(parseInt(e.target.value), frameRange[1]), frameRange[1]])}
                />
                <input 
                  type="range" 
                  min="0" 
                  max={frames.length - 1} 
                  value={frameRange[1]} 
                  onChange={(e) => setFrameRange([frameRange[0], Math.max(parseInt(e.target.value), frameRange[0])])}
                />
              </div>
            </div>
          )}
        </section>

        <aside className="controls-panel">
          <div className="control-group">
            <h3><Zap size={14} /> Master Effects</h3>
            
            <div className="slider-container">
              <div className="slider-label">
                <span>Crispy Retro</span>
                <span>{retro}%</span>
              </div>
              <input 
                type="range" 
                value={retro} 
                onChange={(e) => setRetro(parseInt(e.target.value))} 
              />
            </div>

            <div className="slider-container">
              <div className="slider-label">
                <span>Noisy Glitch</span>
                <span>{glitch}%</span>
              </div>
              <input 
                type="range" 
                value={glitch} 
                onChange={(e) => setGlitch(parseInt(e.target.value))} 
              />
            </div>

            <div className="slider-container">
              <div className="slider-label">
                <span>Painterly</span>
                <span>{painterly}%</span>
              </div>
              <input 
                type="range" 
                value={painterly} 
                onChange={(e) => setPainterly(parseInt(e.target.value))} 
              />
            </div>
          </div>

          <div className="control-group">
            <h3><Monitor size={14} /> Aspect Ratio</h3>
            <div className="preset-grid">
              {ASPECT_RATIOS.map(ratio => (
                <button 
                  key={ratio.label}
                  className={`preset-button ${aspectRatio === ratio.value ? 'active' : ''}`}
                  onClick={() => setAspectRatio(ratio.value)}
                >
                  {ratio.label}
                </button>
              ))}
            </div>
          </div>

          <button 
            className="action-button" 
            disabled={!originalGif || isProcessing}
            onClick={processGif}
          >
            {isProcessing ? 'Processing...' : 'Generate Dithered GIF'}
          </button>

          {outputGif && (
            <a href={outputGif} download="dithered.gif" className="action-button" style={{ textAlign: 'center', textDecoration: 'none', background: 'var(--primary-color)' }}>
              Download Result <Download size={16} />
            </a>
          )}
        </aside>
      </main>

      <AnimatePresence>
        {status && (
          <motion.div 
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 50, opacity: 0 }}
            className="status-toast"
          >
            <div className="status-dot"></div>
            {status}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
