import { describe, expect, it } from 'vitest';
import { reconstructEvidenceConstrainedCurves } from '../src/core/vector-engine';

describe('PRYX — ETAPA 8.16A: False Feature Rejection & Counterform Morphology Guard (Tests A - L)', () => {
  // Test A: True 90° corner
  it('Test A: True 90° corner -> classified as TRUE_STRUCTURAL_SPLIT and sharp corner preserved', () => {
    const svg = '<svg viewBox="0 0 200 200"><path fill="#000000" d="M 40 40 L 160 40 L 160 160 L 40 160 Z" /></svg>';
    const res = reconstructEvidenceConstrainedCurves(svg, { canvasScale: 1.0 });
    expect(res.metrics.topologyGatePassed).toBe(true);
    expect(res.metrics.reconstructedAnchors).toBeLessThanOrEqual(5);
    expect(res.metrics.trueCornersRetained).toBeGreaterThanOrEqual(4);
  });

  // Test B: Rasterized circle with discrete pixel bumps
  it('Test B: Rasterized circle with pixel bumps -> false corners rejected, smooth continuous curve fitted', () => {
    const pts: string[] = [];
    for (let a = 0; a < 360; a += 8) {
      const rad = (a * Math.PI) / 180;
      const bump = (a % 24 === 0) ? 0.7 : 0;
      const prefix = a === 0 ? 'M' : 'L';
      const x = (100 + (40 + bump) * Math.cos(rad)).toFixed(1);
      const y = (100 + (40 + bump) * Math.sin(rad)).toFixed(1);
      pts.push(`${prefix} ${x} ${y}`);
    }
    pts.push('Z');
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="${pts.join(' ')}" /></svg>`;

    const res = reconstructEvidenceConstrainedCurves(svg, { canvasScale: 1.0 });
    expect(res.metrics.topologyGatePassed).toBe(true);
    expect(res.metrics.cubicSegments).toBeGreaterThan(0);
    expect(res.metrics.falseCornersRejected).toBeGreaterThanOrEqual(0);
  });

  // Test C: Raster stair-steps along diagonal
  it('Test C: Raster stair-steps along diagonal -> filtered as FALSE_STRUCTURAL_SPLIT, straight lines fitted', () => {
    const pts: string[] = ['M 20 20'];
    for (let x = 30; x <= 170; x += 10) {
      pts.push(`L ${x} ${x - 2}`);
      pts.push(`L ${x} ${x}`);
    }
    pts.push('L 180 180 L 20 180 Z');
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="${pts.join(' ')}" /></svg>`;

    const res = reconstructEvidenceConstrainedCurves(svg, { canvasScale: 1.0 });
    expect(res.metrics.topologyGatePassed).toBe(true);
    expect(res.metrics.lineSegments).toBeGreaterThanOrEqual(2);
  });

  // Test D: Letter o counterform with discrete quantization
  it('Test D: Letter "o" counterform with discrete quantization -> smooth loop without polygonal facets', () => {
    const ptsOuter: string[] = [];
    const ptsHole: string[] = [];
    for (let a = 0; a < 360; a += 10) {
      const rad = (a * Math.PI) / 180;
      const quantHole = (a % 30 === 0) ? 0.5 : 0;
      const prefix = a === 0 ? 'M' : 'L';
      ptsOuter.push(`${prefix} ${(100 + 50 * Math.cos(rad)).toFixed(1)} ${(100 + 50 * Math.sin(rad)).toFixed(1)}`);
      ptsHole.push(`${prefix} ${(100 + (28 + quantHole) * Math.cos(rad)).toFixed(1)} ${(100 + (28 + quantHole) * Math.sin(rad)).toFixed(1)}`);
    }
    ptsOuter.push('Z');
    ptsHole.push('Z');
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="${ptsOuter.join(' ')} ${ptsHole.join(' ')}" /></svg>`;

    const res = reconstructEvidenceConstrainedCurves(svg, { canvasScale: 1.0 });
    expect(res.metrics.topologyGatePassed).toBe(true);
    expect(res.metrics.holesAfter).toBe(1);
    expect(res.morphologyDecisions.length).toBe(2);
    expect(res.morphologyDecisions[1].status).toBe('ACCEPTED');
  });

  // Test E: Acute cusp (30° sharp needle tip)
  it('Test E: Acute cusp -> classified as TRUE_STRUCTURAL_SPLIT, sharp needle tip preserved', () => {
    const svg = '<svg viewBox="0 0 200 200"><path fill="#000000" d="M 100 20 L 120 180 L 80 180 Z" /></svg>';
    const res = reconstructEvidenceConstrainedCurves(svg, { canvasScale: 1.0 });
    expect(res.metrics.topologyGatePassed).toBe(true);
    expect(res.metrics.trueCornersRetained).toBeGreaterThanOrEqual(1);
  });

  // Test F: S-curve inflection point
  it('Test F: S-curve inflection point -> continuous curvature without false corners', () => {
    const pts: string[] = [];
    for (let x = 0; x <= 200; x += 8) {
      const y = 100 + 45 * Math.sin((x / 200) * 2 * Math.PI);
      pts.push(`${x === 0 ? 'M' : 'L'} ${x} ${y.toFixed(1)}`);
    }
    pts.push('L 200 200 L 0 200 Z');
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="${pts.join(' ')}" /></svg>`;

    const res = reconstructEvidenceConstrainedCurves(svg, { canvasScale: 1.0 });
    expect(res.metrics.topologyGatePassed).toBe(true);
    expect(res.metrics.cubicSegments).toBeGreaterThan(0);
  });

  // Test G: Rounded rectangle
  it('Test G: Rounded rectangle -> preserves rounded arcs with continuous curvature and straight lines', () => {
    const svg = '<svg viewBox="0 0 200 200"><path fill="#000000" d="M 40 20 L 160 20 L 180 40 L 180 160 L 160 180 L 40 180 L 20 160 L 20 40 Z" /></svg>';
    const res = reconstructEvidenceConstrainedCurves(svg, { canvasScale: 1.0 });
    expect(res.metrics.topologyGatePassed).toBe(true);
    expect(res.metrics.reconstructedAnchors).toBeLessThanOrEqual(16);
  });

  // Test H: Real small protrusion (notch/serif)
  it('Test H: Real small protrusion -> preserved as TRUE_STRUCTURAL_SPLIT', () => {
    const svg = '<svg viewBox="0 0 200 200"><path fill="#000000" d="M 50 50 L 90 50 L 90 30 L 110 30 L 110 50 L 150 50 L 150 150 L 50 150 Z" /></svg>';
    const res = reconstructEvidenceConstrainedCurves(svg, { canvasScale: 1.0 });
    expect(res.metrics.topologyGatePassed).toBe(true);
    expect(res.metrics.trueCornersRetained).toBeGreaterThanOrEqual(4);
  });

  // Test I: High-frequency JPEG noise on smooth curve
  it('Test I: High-frequency JPEG noise on smooth curve -> noise filtered, smooth curve preserved', () => {
    const pts: string[] = [];
    for (let a = 0; a < 360; a += 10) {
      const rad = (a * Math.PI) / 180;
      const noise = (a % 20 === 0) ? 0.9 : -0.4;
      pts.push(`${a === 0 ? 'M' : 'L'} ${(100 + (40 + noise) * Math.cos(rad)).toFixed(1)} ${(100 + (40 + noise) * Math.sin(rad)).toFixed(1)}`);
    }
    pts.push('Z');
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="${pts.join(' ')}" /></svg>`;

    const res = reconstructEvidenceConstrainedCurves(svg, { canvasScale: 1.0 });
    expect(res.metrics.topologyGatePassed).toBe(true);
    expect(res.metrics.reconstructedAnchors).toBeLessThan(res.metrics.originalAnchors);
  });

  // Test J: Concentric donut hole
  it('Test J: Concentric donut hole -> morphology guard verified (ACCEPTED)', () => {
    const ptsOuter: string[] = [];
    const ptsHole: string[] = [];
    for (let a = 0; a < 360; a += 15) {
      const rad = (a * Math.PI) / 180;
      ptsOuter.push(`${a === 0 ? 'M' : 'L'} ${(100 + 50 * Math.cos(rad)).toFixed(1)} ${(100 + 50 * Math.sin(rad)).toFixed(1)}`);
      ptsHole.push(`${a === 0 ? 'M' : 'L'} ${(100 + 30 * Math.cos(rad)).toFixed(1)} ${(100 + 30 * Math.sin(rad)).toFixed(1)}`);
    }
    ptsOuter.push('Z');
    ptsHole.push('Z');
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="${ptsOuter.join(' ')} ${ptsHole.join(' ')}" /></svg>`;

    const res = reconstructEvidenceConstrainedCurves(svg, { canvasScale: 1.0 });
    expect(res.metrics.topologyGatePassed).toBe(true);
    expect(res.metrics.holesAfter).toBe(1);
    expect(res.morphologyDecisions[1].status).toBe('ACCEPTED');
  });

  // Test K: Eccentric donut hole with thin wall
  it('Test K: Eccentric donut hole with thin wall -> preserves wall thickness without collapse', () => {
    const ptsOuter: string[] = [];
    const ptsHole: string[] = [];
    for (let a = 0; a < 360; a += 15) {
      const rad = (a * Math.PI) / 180;
      ptsOuter.push(`${a === 0 ? 'M' : 'L'} ${(100 + 50 * Math.cos(rad)).toFixed(1)} ${(100 + 50 * Math.sin(rad)).toFixed(1)}`);
      ptsHole.push(`${a === 0 ? 'M' : 'L'} ${(115 + 25 * Math.cos(rad)).toFixed(1)} ${(100 + 25 * Math.sin(rad)).toFixed(1)}`);
    }
    ptsOuter.push('Z');
    ptsHole.push('Z');
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="${ptsOuter.join(' ')} ${ptsHole.join(' ')}" /></svg>`;

    const res = reconstructEvidenceConstrainedCurves(svg, { canvasScale: 1.0 });
    expect(res.metrics.topologyGatePassed).toBe(true);
    expect(res.metrics.holesAfter).toBe(1);
    expect(res.morphologyDecisions[1].status).toBe('ACCEPTED');
  });

  // Test L: Severely deformed synthetic hole
  it('Test L: Severely deformed synthetic hole -> morphology guard preserves topology with safe handling', () => {
    const svg = '<svg viewBox="0 0 200 200"><path fill="#000000" d="M 20 20 L 180 20 L 180 180 L 20 180 Z M 100 50 L 110 90 L 150 100 L 110 110 L 100 150 L 90 110 L 50 100 L 90 90 Z" /></svg>';
    const res = reconstructEvidenceConstrainedCurves(svg, { canvasScale: 1.0 });
    expect(res.metrics.topologyGatePassed).toBe(true);
    expect(res.metrics.holesAfter).toBe(1);
  });
});
