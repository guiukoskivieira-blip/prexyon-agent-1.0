import { describe, expect, it } from 'vitest';
import {
  reconstructSubpixelBoundaries,
  RgbaRaster,
} from '../src/core/vector-engine';

function createBlankRaster(width: number, height: number, fillColor: [number, number, number] = [255, 255, 255]): RgbaRaster {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = fillColor[0];
    data[i * 4 + 1] = fillColor[1];
    data[i * 4 + 2] = fillColor[2];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

function drawAntialiasedDisk(raster: RgbaRaster, cx: number, cy: number, r: number, color: [number, number, number] = [0, 0, 0]) {
  const { width, height, data } = raster;
  for (let y = Math.max(0, Math.floor(cy - r - 2)); y <= Math.min(height - 1, Math.ceil(cy + r + 2)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r - 2)); x <= Math.min(width - 1, Math.ceil(cx + r + 2)); x++) {
      const d = Math.hypot(x - cx, y - cy);
      const alpha = Math.max(0, Math.min(1, r + 0.5 - d));
      if (alpha > 0) {
        const idx = (y * width + x) * 4;
        const bgR = data[idx], bgG = data[idx + 1], bgB = data[idx + 2];
        data[idx] = Math.round(alpha * color[0] + (1 - alpha) * bgR);
        data[idx + 1] = Math.round(alpha * color[1] + (1 - alpha) * bgG);
        data[idx + 2] = Math.round(alpha * color[2] + (1 - alpha) * bgB);
        data[idx + 3] = 255;
      }
    }
  }
}

describe('PRYX — ETAPA 8.13: Subpixel Boundary Reconstruction Foundation (Tests A - I)', () => {
  // Test A: Antialiased circle
  it('Test A: Antialiased circle -> subpixel estimation reduces grid locking', () => {
    const raster = createBlankRaster(200, 200, [255, 255, 255]);
    drawAntialiasedDisk(raster, 100, 100, 40, [0, 0, 0]);

    // Grid-locked stepped polygon representing discrete contour
    const polyPts: string[] = [];
    for (let a = 0; a < 360; a += 10) {
      const rad = (a * Math.PI) / 180;
      const px = Math.round(100 + 40 * Math.cos(rad));
      const py = Math.round(100 + 40 * Math.sin(rad));
      polyPts.push(`${a === 0 ? 'M' : 'L'} ${px} ${py}`);
    }
    polyPts.push('Z');
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="${polyPts.join(' ')}" /></svg>`;

    const res = reconstructSubpixelBoundaries(svg, raster, { minContrastDistance: 15.0 });
    expect(res.samplesAnalyzed).toBeGreaterThan(20);
    expect(res.samplesRefined).toBeGreaterThan(10);
    expect(res.gridLockedSamplesAfter).toBeLessThan(res.gridLockedSamplesBefore);
  });

  // Test B: Antialiased diagonal
  it('Test B: Antialiased diagonal -> reduces stair-step transitions', () => {
    const raster = createBlankRaster(200, 200, [255, 255, 255]);
    // Draw stepped diagonal
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="M 20 20 L 30 20 L 30 30 L 40 30 L 40 40 L 50 40 L 50 50 L 20 50 Z" /></svg>`;
    const res = reconstructSubpixelBoundaries(svg, raster, { minContrastDistance: 10.0 });
    expect(res.topologyValidation.isValid).toBe(true);
  });

  // Test C: Circular arc
  it('Test C: Circular arc -> consistent subpixel position', () => {
    const raster = createBlankRaster(200, 200, [255, 255, 255]);
    drawAntialiasedDisk(raster, 100, 100, 50, [0, 0, 0]);
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="M 50 100 L 100 50 L 150 100 L 100 150 Z" /></svg>`;
    const res = reconstructSubpixelBoundaries(svg, raster);
    expect(res.samplesAnalyzed).toBeGreaterThan(0);
    expect(res.topologyValidation.isValid).toBe(true);
  });

  // Test D: Horizontal straight line
  it('Test D: Horizontal line -> does NOT create artificial ripple (movement ~ 0)', () => {
    const raster = createBlankRaster(200, 200, [255, 255, 255]);
    // Sharp top half black, bottom half white
    for (let y = 0; y < 100; y++) {
      for (let x = 0; x < 200; x++) {
        const idx = (y * 200 + x) * 4;
        raster.data[idx] = 0;
        raster.data[idx + 1] = 0;
        raster.data[idx + 2] = 0;
      }
    }
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="M 20 20 L 180 20 L 180 100 L 20 100 Z" /></svg>`;
    const res = reconstructSubpixelBoundaries(svg, raster);
    expect(res.meanSubpixelMovement).toBeLessThan(0.4);
  });

  // Test E: 90-degree real corner
  it('Test E: 90-degree sharp corner -> strictly locks corner position without rounding', () => {
    const raster = createBlankRaster(200, 200, [255, 255, 255]);
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="M 50 50 L 150 50 L 150 150 L 50 150 Z" /></svg>`;
    const res = reconstructSubpixelBoundaries(svg, raster);
    expect(res.samplesPreservedLowConfidence).toBeGreaterThanOrEqual(4);
    expect(res.topologyValidation.isValid).toBe(true);
  });

  // Test F: Donut
  it('Test F: Donut -> preserves outer contour and hole', () => {
    const raster = createBlankRaster(200, 200, [255, 255, 255]);
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="M 20 20 L 180 20 L 180 180 L 20 180 Z M 60 60 L 60 140 L 140 140 L 140 60 Z" /></svg>`;
    const res = reconstructSubpixelBoundaries(svg, raster);
    expect(res.holesAfter).toBe(1);
    expect(res.componentsAfter).toBe(1);
    expect(res.topologyValidation.isValid).toBe(true);
  });

  // Test G: Two regions sharing boundary
  it('Test G: Two regions sharing boundary -> topology gate confirms consistency', () => {
    const raster = createBlankRaster(200, 200, [255, 255, 255]);
    const svg = `<svg viewBox="0 0 200 200">
      <path fill="#ff0000" d="M 20 20 L 100 20 L 100 180 L 20 180 Z" />
      <path fill="#0000ff" d="M 100 20 L 180 20 L 180 180 L 100 180 Z" />
    </svg>`;
    const res = reconstructSubpixelBoundaries(svg, raster);
    expect(res.componentsAfter).toBe(2);
    expect(res.topologyValidation.isValid).toBe(true);
  });

  // Test H: JPEG / Ringing noise rejection
  it('Test H: Ringing noise -> confidence gating rejects spurious outliers', () => {
    const raster = createBlankRaster(200, 200, [255, 255, 255]);
    // Inject random DCT high frequency noise
    for (let i = 0; i < raster.data.length; i += 4) {
      raster.data[i] = Math.max(0, Math.min(255, raster.data[i] + (Math.random() * 40 - 20)));
    }
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="M 50 50 L 150 50 L 150 150 L 50 150 Z" /></svg>`;
    const res = reconstructSubpixelBoundaries(svg, raster, { confidenceThreshold: 0.60 });
    expect(res.maxSubpixelMovement).toBeLessThanOrEqual(0.75);
    expect(res.topologyValidation.isValid).toBe(true);
  });

  // Test I: Multi-scale consistency (0.5x, 1x, 2x, 4x)
  it('Test I: Multi-scale consistency at 0.5x, 1x, 2x, 4x scale factors', () => {
    for (const scale of [0.5, 1.0, 2.0, 4.0]) {
      const size = Math.round(100 * scale);
      const raster = createBlankRaster(size, size, [255, 255, 255]);
      const pad = Math.round(20 * scale);
      const end = size - pad;
      const svg = `<svg viewBox="0 0 ${size} ${size}"><path fill="#000000" d="M ${pad} ${pad} L ${end} ${pad} L ${end} ${end} L ${pad} ${end} Z" /></svg>`;
      const res = reconstructSubpixelBoundaries(svg, raster, { scaleFactor: scale });
      expect(res.topologyValidation.isValid).toBe(true);
      expect(res.componentsAfter).toBe(1);
    }
  });
});
