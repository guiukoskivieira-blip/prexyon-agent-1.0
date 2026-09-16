import { describe, expect, it } from 'vitest';
import {
  analyzeSvgMultiscaleFeatures,
} from '../src/core/vector-engine';

describe('PRYX — ETAPA 8.14: Multiscale Feature Evidence & Local-Scale Geometry (Tests A - N)', () => {
  // Test A: Circle in low resolution
  it('Test A: Low-res circle -> classifies smooth contour without false persistent corners', () => {
    const polyPts: string[] = [];
    for (let a = 0; a < 360; a += 15) {
      const rad = (a * Math.PI) / 180;
      const px = Math.round(50 + 20 * Math.cos(rad));
      const py = Math.round(50 + 20 * Math.sin(rad));
      polyPts.push(`${a === 0 ? 'M' : 'L'} ${px} ${py}`);
    }
    polyPts.push('Z');
    const svg = `<svg viewBox="0 0 100 100"><path fill="#000000" d="${polyPts.join(' ')}" /></svg>`;

    const res = analyzeSvgMultiscaleFeatures(svg, 0.5);
    expect(res.persistentCorners).toBe(0);
    expect(res.persistentCusps).toBe(0);
  });

  // Test B: Circle in high resolution
  it('Test B: High-res circle -> constant smooth curvature and low high-frequency energy', () => {
    const polyPts: string[] = [];
    for (let a = 0; a < 360; a += 5) {
      const rad = (a * Math.PI) / 180;
      const px = Math.round(500 + 300 * Math.cos(rad));
      const py = Math.round(500 + 300 * Math.sin(rad));
      polyPts.push(`${a === 0 ? 'M' : 'L'} ${px} ${py}`);
    }
    polyPts.push('Z');
    const svg = `<svg viewBox="0 0 1000 1000"><path fill="#000000" d="${polyPts.join(' ')}" /></svg>`;

    const res = analyzeSvgMultiscaleFeatures(svg, 2.0);
    expect(res.persistentCusps).toBe(0);
    expect(res.highFrequencyCurvatureEnergy).toBeLessThan(0.05);
  });

  // Test C: Diagonal with raster stair-steps
  it('Test C: Diagonal with stair-steps -> classifies stepped ripples as LIKELY_RASTER_ARTIFACT', () => {
    // Stepped staircase
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="M 20 20 L 30 20 L 30 30 L 40 30 L 40 40 L 50 40 L 50 50 L 20 50 Z" /></svg>`;
    const res = analyzeSvgMultiscaleFeatures(svg, 1.0);
    expect(res.likelyRasterArtifacts).toBeGreaterThanOrEqual(1);
  });

  // Test D: Organic S-curve
  it('Test D: Organic S-curve -> accurately identifies inflection points', () => {
    const pts: string[] = [];
    for (let x = 0; x <= 200; x += 10) {
      const y = 100 + 40 * Math.sin((x / 200) * 2 * Math.PI);
      pts.push(`${x === 0 ? 'M' : 'L'} ${x} ${y}`);
    }
    pts.push('L 200 200 L 0 200 Z');
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="${pts.join(' ')}" /></svg>`;

    const res = analyzeSvgMultiscaleFeatures(svg, 1.0);
    expect(res.inflections).toBeGreaterThanOrEqual(1);
  });

  // Test E: 90-degree real sharp corner
  it('Test E: 90-degree corner -> classifies vertices as PERSISTENT_CORNER', () => {
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="M 50 50 L 150 50 L 150 150 L 50 150 Z" /></svg>`;
    const res = analyzeSvgMultiscaleFeatures(svg, 1.0);
    expect(res.persistentCorners + res.persistentCusps).toBeGreaterThanOrEqual(4);
  });

  // Test F: Acute cusp (30-degree)
  it('Test F: Acute cusp -> classifies sharp tip as PERSISTENT_CUSP', () => {
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="M 100 20 L 130 180 L 70 180 Z" /></svg>`;
    const res = analyzeSvgMultiscaleFeatures(svg, 1.0);
    expect(res.persistentCusps).toBeGreaterThanOrEqual(1);
  });

  // Test G: Small serif
  it('Test G: Small serif -> preserves small feature scale and corner evidence', () => {
    // Stem + small serif foot
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="M 90 20 L 110 20 L 110 160 L 130 160 L 130 180 L 70 180 L 70 160 L 90 160 Z" /></svg>`;
    const res = analyzeSvgMultiscaleFeatures(svg, 1.0);
    expect(res.persistentCorners + res.persistentCusps).toBeGreaterThanOrEqual(4);
    expect(res.localScales.mean).toBeLessThan(3.0);
  });

  // Test H: Thin terminal
  it('Test H: Thin terminal -> identifies thin stroke width and high turn angle', () => {
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="M 20 20 L 180 22 L 20 24 Z" /></svg>`;
    const res = analyzeSvgMultiscaleFeatures(svg, 1.0);
    expect(res.thinTerminals + res.persistentCusps).toBeGreaterThanOrEqual(1);
  });

  // Test I: Donut / Letter O
  it('Test I: Donut / Letter O -> identifies inner hole as COUNTERFORM_BOUNDARY', () => {
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="M 20 20 L 180 20 L 180 180 L 20 180 Z M 60 60 L 60 140 L 140 140 L 140 60 Z" /></svg>`;
    const res = analyzeSvgMultiscaleFeatures(svg, 1.0);
    expect(res.counterformBoundaries).toBeGreaterThanOrEqual(1);
  });

  // Test J: Letter P/B with counterform
  it('Test J: Letter P/B -> separates outer contour from inner counterforms with feature linkage', () => {
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="M 20 20 L 120 20 L 120 120 L 20 120 Z M 40 40 L 40 80 L 80 80 L 80 40 Z" /></svg>`;
    const res = analyzeSvgMultiscaleFeatures(svg, 1.0);
    expect(res.boundariesAnalyzed).toBe(2);
    expect(res.persistentCorners).toBeGreaterThanOrEqual(4);
  });

  // Test K: Smooth curve with JPEG ringing noise
  it('Test K: Smooth curve with ringing noise -> filters high-frequency noise from true corners', () => {
    const pts: string[] = [];
    for (let a = 0; a < 360; a += 10) {
      const rad = (a * Math.PI) / 180;
      // Inject synthetic 0.8px high-frequency ripple
      const ripple = (a % 20 === 0) ? 0.8 : 0;
      const px = 100 + (40 + ripple) * Math.cos(rad);
      const py = 100 + (40 + ripple) * Math.sin(rad);
      pts.push(`${a === 0 ? 'M' : 'L'} ${px.toFixed(2)} ${py.toFixed(2)}`);
    }
    pts.push('Z');
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="${pts.join(' ')}" /></svg>`;

    const res = analyzeSvgMultiscaleFeatures(svg, 1.0);
    expect(res.persistentCusps).toBe(0);
  });

  // Test L: Multi-scale consistency (0.5x, 1x, 2x, 4x)
  it('Test L: Multi-scale consistency across resolutions', () => {
    for (const scale of [0.5, 1.0, 2.0, 4.0]) {
      const size = Math.round(100 * scale);
      const pad = Math.round(20 * scale);
      const end = size - pad;
      const svg = `<svg viewBox="0 0 ${size} ${size}"><path fill="#000000" d="M ${pad} ${pad} L ${end} ${pad} L ${end} ${end} L ${pad} ${end} Z" /></svg>`;
      const res = analyzeSvgMultiscaleFeatures(svg, scale);
      expect(res.persistentCorners + res.persistentCusps).toBeGreaterThanOrEqual(4);
    }
  });

  // Test M: Real small protrusion
  it('Test M: Real small protrusion -> verified as PERSISTENT feature across scales', () => {
    // Rectangle with real 15px geometric tab
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="M 50 50 L 90 50 L 90 30 L 110 30 L 110 50 L 150 50 L 150 150 L 50 150 Z" /></svg>`;
    const res = analyzeSvgMultiscaleFeatures(svg, 1.0);
    expect(res.persistentCorners + res.persistentCusps).toBeGreaterThanOrEqual(6);
  });

  // Test N: Artificial 1-pixel jitter
  it('Test N: Artificial 1-pixel jitter -> classified as LIKELY_RASTER_ARTIFACT', () => {
    // Straight line with isolated 1-pixel raster jitter spike
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="M 20 50 L 70 50 L 71 51 L 72 50 L 150 50 L 150 120 L 20 120 Z" /></svg>`;
    const res = analyzeSvgMultiscaleFeatures(svg, 1.0);
    expect(res.likelyRasterArtifacts).toBeGreaterThanOrEqual(1);
  });
});
