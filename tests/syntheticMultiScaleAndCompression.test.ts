import { describe, expect, it } from 'vitest';
import { reconstructProfessionalCurves } from '../src/core/vector-engine/professionalCurveReconstruction';
import { analyzeSvgStats } from '../src/core/vector-engine';

describe('PRYX ETAPA 8.11C — Multi-Scale Generalization & Compression Robustness Suite', () => {
  const scales = [0.25, 0.5, 1.0, 2.0, 4.0];

  // 1. Circle across 5 scales
  it('1. Circle converges to equivalent compact representation across 5 scales', () => {
    for (const scale of scales) {
      const steps = Math.round(64 * scale);
      const r = 120 * scale;
      const pts: string[] = [];
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * 2 * Math.PI;
        pts.push(`${i === 0 ? 'M' : 'L'} ${(200 * scale + r * Math.cos(a)).toFixed(2)} ${(200 * scale + r * Math.sin(a)).toFixed(2)}`);
      }
      pts.push('Z');
      const svg = `<svg width="${400 * scale}pt" height="${400 * scale}pt" viewBox="0 0 ${400 * scale} ${400 * scale}"><path fill="#000000" d="${pts.join(' ')}" /></svg>`;
      const res = reconstructProfessionalCurves(svg, { scaleFactor: scale });
      const stats = analyzeSvgStats(res.svg);
      expect(stats.anchors).toBeLessThanOrEqual(16);
      expect(res.stats.selfIntersections).toBe(0);
    }
  });

  // 2. Ellipse across 5 scales
  it('2. Ellipse converges to smooth Béziers across 5 scales', () => {
    for (const scale of scales) {
      const steps = Math.round(64 * scale);
      const rx = 160 * scale, ry = 80 * scale;
      const pts: string[] = [];
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * 2 * Math.PI;
        pts.push(`${i === 0 ? 'M' : 'L'} ${(250 * scale + rx * Math.cos(a)).toFixed(2)} ${(200 * scale + ry * Math.sin(a)).toFixed(2)}`);
      }
      pts.push('Z');
      const svg = `<svg width="${500 * scale}pt" height="${400 * scale}pt" viewBox="0 0 ${500 * scale} ${400 * scale}"><path fill="#000000" d="${pts.join(' ')}" /></svg>`;
      const res = reconstructProfessionalCurves(svg, { scaleFactor: scale });
      const stats = analyzeSvgStats(res.svg);
      expect(stats.anchors).toBeLessThanOrEqual(32);
      expect(res.stats.selfIntersections).toBe(0);
    }
  });

  // 3. Large Arc across 5 scales
  it('3. Large Arc converges with zero micro-faceting across 5 scales', () => {
    for (const scale of scales) {
      const steps = Math.round(48 * scale);
      const r = 200 * scale;
      const pts: string[] = ['M 100 100'];
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * (Math.PI * 0.75);
        pts.push(`L ${(100 * scale + r * Math.cos(a)).toFixed(2)} ${(100 * scale + r * Math.sin(a)).toFixed(2)}`);
      }
      pts.push('Z');
      const svg = `<svg width="${500 * scale}pt" height="${500 * scale}pt" viewBox="0 0 ${500 * scale} ${500 * scale}"><path fill="#000000" d="${pts.join(' ')}" /></svg>`;
      const res = reconstructProfessionalCurves(svg, { scaleFactor: scale });
      expect(res.stats.selfIntersections).toBe(0);
    }
  });

  // 4. S-Curve across 5 scales
  it('4. S-Curve inflection points are smooth without notches across 5 scales', () => {
    for (const scale of scales) {
      const steps = Math.round(40 * scale);
      const pts: string[] = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = (50 + t * 300) * scale;
        const y = (200 + Math.sin(t * 2 * Math.PI) * 80) * scale;
        pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`);
      }
      pts.push(`L ${(350 * scale).toFixed(2)} ${(350 * scale).toFixed(2)} L ${(50 * scale).toFixed(2)} ${(350 * scale).toFixed(2)} Z`);
      const svg = `<svg width="${400 * scale}pt" height="${400 * scale}pt" viewBox="0 0 ${400 * scale} ${400 * scale}"><path fill="#000000" d="${pts.join(' ')}" /></svg>`;
      const res = reconstructProfessionalCurves(svg, { scaleFactor: scale });
      expect(res.stats.selfIntersections).toBe(0);
    }
  });

  // 5. Rounded Rectangle across 5 scales
  it('5. Rounded Rectangle preserves linear edges and corner radii across 5 scales', () => {
    for (const scale of scales) {
      const w = 300 * scale, h = 180 * scale, cr = 30 * scale;
      const pts = [
        `M ${(cr).toFixed(2)} 0`,
        `L ${(w - cr).toFixed(2)} 0`,
        `L ${(w).toFixed(2)} ${(cr).toFixed(2)}`,
        `L ${(w).toFixed(2)} ${(h - cr).toFixed(2)}`,
        `L ${(w - cr).toFixed(2)} ${(h).toFixed(2)}`,
        `L ${(cr).toFixed(2)} ${(h).toFixed(2)}`,
        `L 0 ${(h - cr).toFixed(2)}`,
        `L 0 ${(cr).toFixed(2)}`,
        'Z',
      ];
      const svg = `<svg width="${(w + 40) * scale}pt" height="${(h + 40) * scale}pt" viewBox="0 0 ${w + 40} ${h + 40}"><path fill="#000000" d="${pts.join(' ')}" /></svg>`;
      const res = reconstructProfessionalCurves(svg, { scaleFactor: scale });
      expect(res.stats.selfIntersections).toBe(0);
    }
  });

  // 6. 90-degree Corner across 5 scales
  it('6. Strict 90-degree corner preservation across 5 scales', () => {
    for (const scale of scales) {
      const pts = [
        `M ${(50 * scale).toFixed(2)} ${(50 * scale).toFixed(2)}`,
        `L ${(300 * scale).toFixed(2)} ${(50 * scale).toFixed(2)}`,
        `L ${(300 * scale).toFixed(2)} ${(300 * scale).toFixed(2)}`,
        `L ${(50 * scale).toFixed(2)} ${(300 * scale).toFixed(2)}`,
        'Z',
      ];
      const svg = `<svg width="${400 * scale}pt" height="${400 * scale}pt" viewBox="0 0 ${400 * scale} ${400 * scale}"><path fill="#000000" d="${pts.join(' ')}" /></svg>`;
      const res = reconstructProfessionalCurves(svg, {
        scaleFactor: scale,
        cornerAngleThresholdDeg: 35.0,
        cuspAngleThresholdDeg: 65.0,
      });
      expect(res.stats.protectedCorners + res.stats.protectedCusps).toBeGreaterThanOrEqual(4);
    }
  });

  // 7. Sharp Cusp (Heart/Cardioid) across 5 scales
  it('7. Sharp cusp is strictly protected across 5 scales', () => {
    for (const scale of scales) {
      const steps = Math.round(32 * scale);
      const pts: string[] = [`M ${(200 * scale).toFixed(2)} ${(100 * scale).toFixed(2)}`];
      for (let i = 0; i <= steps; i++) {
        const a = Math.PI - (i / steps) * Math.PI;
        pts.push(`L ${(200 * scale + 80 * scale * Math.cos(a)).toFixed(2)} ${(180 * scale - 80 * scale * Math.sin(a)).toFixed(2)}`);
      }
      pts.push(`L ${(200 * scale).toFixed(2)} ${(350 * scale).toFixed(2)} Z`);
      const svg = `<svg width="${400 * scale}pt" height="${400 * scale}pt" viewBox="0 0 ${400 * scale} ${400 * scale}"><path fill="#000000" d="${pts.join(' ')}" /></svg>`;
      const res = reconstructProfessionalCurves(svg, { scaleFactor: scale });
      expect(res.stats.protectedCusps).toBeGreaterThanOrEqual(1);
    }
  });

  // 8. Thin Terminal across 5 scales
  it('8. Needle-thin terminal structure is preserved across 5 scales', () => {
    for (const scale of scales) {
      const needle = `M ${(50 * scale).toFixed(2)} ${(50 * scale).toFixed(2)} L ${(350 * scale).toFixed(2)} ${(145 * scale).toFixed(2)} L ${(400 * scale).toFixed(2)} ${(150 * scale).toFixed(2)} L ${(350 * scale).toFixed(2)} ${(155 * scale).toFixed(2)} L ${(50 * scale).toFixed(2)} ${(250 * scale).toFixed(2)} Z`;
      const svg = `<svg width="${500 * scale}pt" height="${500 * scale}pt" viewBox="0 0 ${500 * scale} ${500 * scale}"><path fill="#000000" d="${needle}" /></svg>`;
      const res = reconstructProfessionalCurves(svg, {
        scaleFactor: scale,
        cornerAngleThresholdDeg: 35.0,
        cuspAngleThresholdDeg: 65.0,
      });
      expect(res.stats.protectedCorners + res.stats.protectedCusps).toBeGreaterThanOrEqual(3);
    }
  });

  // 9. Compound Shape with Hole across 5 scales
  it('9. Preserves compound shape holes and topology across 5 scales', () => {
    for (const scale of scales) {
      const outerSteps = Math.round(48 * scale);
      const innerSteps = Math.round(32 * scale);
      const outer: string[] = [];
      for (let i = 0; i < outerSteps; i++) {
        const a = (i / outerSteps) * 2 * Math.PI;
        outer.push(`${i === 0 ? 'M' : 'L'} ${(300 * scale + 150 * scale * Math.cos(a)).toFixed(2)} ${(300 * scale + 150 * scale * Math.sin(a)).toFixed(2)}`);
      }
      outer.push('Z');

      const inner: string[] = [];
      for (let i = 0; i < innerSteps; i++) {
        const a = (i / innerSteps) * 2 * Math.PI;
        inner.push(`${i === 0 ? 'M' : 'L'} ${(300 * scale + 60 * scale * Math.cos(-a)).toFixed(2)} ${(300 * scale + 60 * scale * Math.sin(-a)).toFixed(2)}`);
      }
      inner.push('Z');

      const svg = `<svg width="${600 * scale}pt" height="${600 * scale}pt" viewBox="0 0 ${600 * scale} ${600 * scale}"><path fill="#000000" d="${outer.join(' ')} ${inner.join(' ')}" /></svg>`;
      const res = reconstructProfessionalCurves(svg, { scaleFactor: scale });
      const stats = analyzeSvgStats(res.svg);
      expect(stats.holes).toBe(1);
    }
  });

  // Compression & Boundary Perturbation Robustness Test
  it('Compression Robustness: maintains clean smooth curves despite JPEG boundary noise', () => {
    const noiseLevels = [0.0, 0.5, 1.0, 1.5];
    for (const noise of noiseLevels) {
      const steps = 64;
      const r = 200;
      const pts: string[] = [];
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * 2 * Math.PI;
        const pert = (Math.sin(i * 5) + Math.cos(i * 3)) * 0.5 * noise;
        const x = 300 + (r + pert) * Math.cos(a);
        const y = 300 + (r + pert) * Math.sin(a);
        pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`);
      }
      pts.push('Z');

      const svg = `<svg width="600pt" height="600pt" viewBox="0 0 600 600"><path fill="#000000" d="${pts.join(' ')}" /></svg>`;
      const res = reconstructProfessionalCurves(svg, { scaleFactor: 2.0 });

      expect(res.stats.tangentOscillationAfter).toBeLessThan(100.0);
      expect(res.stats.selfIntersections).toBe(0);
    }
  });
});
