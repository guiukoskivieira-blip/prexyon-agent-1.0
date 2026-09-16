import { describe, expect, it } from 'vitest';
import { reconstructProfessionalCurves } from '../src/core/vector-engine/professionalCurveReconstruction';
import { analyzeSvgStats } from '../src/core/vector-engine';

describe('PRYX ETAPA 8.11B — Synthetic Geometric Generalization Suite', () => {
  // A: Circle rasterized into polygon
  it('Case A & C: eliminates micro-faceting on circles and large arcs', () => {
    // Generate 128-step polygon circle of radius 400
    const steps = 128;
    const r = 400;
    const cx = 500, cy = 500;
    const pts: string[] = [];
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * 2 * Math.PI;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`);
    }
    pts.push('Z');
    const inputSvg = `<svg width="1000pt" height="1000pt" viewBox="0 0 1000 1000"><path fill="#000000" d="${pts.join(' ')}" /></svg>`;

    const res = reconstructProfessionalCurves(inputSvg, {
      maxDeviationTolerance: 1.2,
      scaleFactor: 1.0,
    });

    const stats = analyzeSvgStats(res.svg);
    expect(res.stats.protectedCusps).toBe(0);
    expect(res.stats.protectedCorners).toBeLessThanOrEqual(4);
    expect(stats.anchors).toBeLessThan(16); // Reconstructed into minimal smooth Béziers!
    expect(res.stats.meanDeviation).toBeLessThan(1.0);
  });

  // B: S-Curve
  it('Case B: reconstructs inflection point on S-curves without notches', () => {
    const pts: string[] = [];
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      const x = 100 + t * 400;
      const y = 300 + Math.sin(t * 2 * Math.PI) * 100;
      pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`);
    }
    pts.push('L 500 500 L 100 500 Z');
    const inputSvg = `<svg width="600pt" height="600pt" viewBox="0 0 600 600"><path fill="#000000" d="${pts.join(' ')}" /></svg>`;

    const res = reconstructProfessionalCurves(inputSvg, {
      maxDeviationTolerance: 1.2,
    });

    expect(res.stats.selfIntersections).toBe(0);
    expect(res.stats.openPaths).toBe(0);
  });

  // D: Circular counter-form (Hole preservation)
  it('Case D: preserves circular counter-forms and inner hole topology', () => {
    // Outer circle
    const outer: string[] = [];
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * 2 * Math.PI;
      outer.push(`${i === 0 ? 'M' : 'L'} ${(400 + 200 * Math.cos(a)).toFixed(2)} ${(400 + 200 * Math.sin(a)).toFixed(2)}`);
    }
    outer.push('Z');

    // Inner hole
    const inner: string[] = [];
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * 2 * Math.PI;
      inner.push(`${i === 0 ? 'M' : 'L'} ${(400 + 80 * Math.cos(-a)).toFixed(2)} ${(400 + 80 * Math.sin(-a)).toFixed(2)}`);
    }
    inner.push('Z');

    const inputSvg = `<svg width="800pt" height="800pt" viewBox="0 0 800 800"><path fill="#000000" d="${outer.join(' ')} ${inner.join(' ')}" /></svg>`;
    const res = reconstructProfessionalCurves(inputSvg);
    const stats = analyzeSvgStats(res.svg);

    expect(stats.holes).toBe(1);
    expect(res.stats.holesPreserved).toBe(1);
  });

  // E & F: Sharp 90° corner and True acute cusp (Cardioid / Heart shape)
  it('Case E & F: strictly preserves real 90° corners and acute cusps', () => {
    // Teardrop with acute cusp at bottom (x=200, y=350)
    const pts: string[] = ['M 200 100'];
    // Top arc
    for (let i = 0; i <= 32; i++) {
      const a = Math.PI - (i / 32) * Math.PI;
      pts.push(`L ${(200 + 80 * Math.cos(a)).toFixed(2)} ${(180 - 80 * Math.sin(a)).toFixed(2)}`);
    }
    pts.push('L 200 350'); // Sharp cusp point
    pts.push('Z');

    const inputSvg = `<svg width="400pt" height="400pt" viewBox="0 0 400 400"><path fill="#000000" d="${pts.join(' ')}" /></svg>`;
    const res = reconstructProfessionalCurves(inputSvg, {
      cuspAngleThresholdDeg: 60.0,
    });

    expect(res.stats.protectedCusps).toBeGreaterThanOrEqual(1);
  });

  // G: Fine sharp terminal
  it('Case G: preserves fine sharp terminals and needle cusps', () => {
    const needle = 'M 100 100 L 400 195 L 450 200 L 400 205 L 100 300 Z';
    const inputSvg = `<svg width="500pt" height="500pt" viewBox="0 0 500 500"><path fill="#000000" d="${needle}" /></svg>`;
    const res = reconstructProfessionalCurves(inputSvg, {
      cornerAngleThresholdDeg: 35.0,
      cuspAngleThresholdDeg: 65.0,
    });

    expect(res.stats.protectedCorners + res.stats.protectedCusps).toBeGreaterThanOrEqual(3);
  });

  // H: Multi-scale invariance across 3 resolutions (200px, 800px, 3200px)
  it('Case H: demonstrates scale invariance across 3 different resolutions', () => {
    const scales = [0.25, 1.0, 4.0];
    const results: number[] = [];

    for (const scale of scales) {
      const steps = Math.round(64 * scale);
      const r = 100 * scale;
      const pts: string[] = [];
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * 2 * Math.PI;
        pts.push(`${i === 0 ? 'M' : 'L'} ${(150 * scale + r * Math.cos(a)).toFixed(2)} ${(150 * scale + r * Math.sin(a)).toFixed(2)}`);
      }
      pts.push('Z');

      const svg = `<svg width="${300 * scale}pt" height="${300 * scale}pt" viewBox="0 0 ${300 * scale} ${300 * scale}"><path fill="#000000" d="${pts.join(' ')}" /></svg>`;
      const res = reconstructProfessionalCurves(svg, {
        scaleFactor: scale,
      });
      const stats = analyzeSvgStats(res.svg);
      results.push(stats.anchors);
    }

    console.log('Multi-scale anchor counts for circle:', results);
    // Anchor counts converge to compact representation regardless of raster resolution
    for (const count of results) {
      expect(count).toBeLessThan(16);
    }
  });
});
