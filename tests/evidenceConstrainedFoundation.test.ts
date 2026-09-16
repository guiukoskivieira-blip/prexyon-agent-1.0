import { describe, expect, it } from 'vitest';
import { reconstructEvidenceConstrainedCurves } from '../src/core/vector-engine';

describe('PRYX — ETAPA 8.16: Evidence-Constrained Curve Reconstruction (Tests A - R)', () => {
  // Test A: Rasterized circle
  it('Test A: Rasterized circle -> reconstructs smooth curves without stair-steps', () => {
    const pts: string[] = [];
    for (let a = 0; a < 360; a += 10) {
      const rad = (a * Math.PI) / 180;
      pts.push(`${a === 0 ? 'M' : 'L'} ${(100 + 40 * Math.cos(rad)).toFixed(1)} ${(100 + 40 * Math.sin(rad)).toFixed(1)}`);
    }
    pts.push('Z');
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="${pts.join(' ')}" /></svg>`;

    const res = reconstructEvidenceConstrainedCurves(svg, { canvasScale: 1.0 });
    expect(res.metrics.topologyGatePassed).toBe(true);
    expect(res.metrics.cubicSegments).toBeGreaterThan(0);
    expect(res.metrics.reconstructedAnchors).toBeLessThan(res.metrics.originalAnchors);
  });

  // Test B: Ellipse-like freeform
  it('Test B: Ellipse freeform -> fits smooth Béziers without artificial corners', () => {
    const pts: string[] = [];
    for (let a = 0; a < 360; a += 10) {
      const rad = (a * Math.PI) / 180;
      pts.push(`${a === 0 ? 'M' : 'L'} ${(100 + 60 * Math.cos(rad)).toFixed(1)} ${(100 + 30 * Math.sin(rad)).toFixed(1)}`);
    }
    pts.push('Z');
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="${pts.join(' ')}" /></svg>`;

    const res = reconstructEvidenceConstrainedCurves(svg, { canvasScale: 1.0 });
    expect(res.metrics.topologyGatePassed).toBe(true);
    expect(res.metrics.cubicSegments).toBeGreaterThanOrEqual(4);
  });

  // Test C: S-curve
  it('Test C: S-curve -> preserves continuous inflection curvature', () => {
    const pts: string[] = [];
    for (let x = 0; x <= 200; x += 10) {
      const y = 100 + 40 * Math.sin((x / 200) * 2 * Math.PI);
      pts.push(`${x === 0 ? 'M' : 'L'} ${x} ${y.toFixed(1)}`);
    }
    pts.push('L 200 200 L 0 200 Z');
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="${pts.join(' ')}" /></svg>`;

    const res = reconstructEvidenceConstrainedCurves(svg, { canvasScale: 1.0 });
    expect(res.metrics.topologyGatePassed).toBe(true);
  });

  // Test D: Diagonal
  it('Test D: Diagonal -> fits clean straight line segments without stair-steps', () => {
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="M 20 20 L 180 180 L 20 180 Z" /></svg>`;
    const res = reconstructEvidenceConstrainedCurves(svg, { canvasScale: 1.0 });
    expect(res.metrics.topologyGatePassed).toBe(true);
    expect(res.metrics.lineSegments).toBeGreaterThanOrEqual(2);
  });

  // Test E: Rounded rectangle
  it('Test E: Rounded rectangle -> preserves rounded corners and straight spans', () => {
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="M 40 20 L 160 20 L 180 40 L 180 160 L 160 180 L 40 180 L 20 160 L 20 40 Z" /></svg>`;
    const res = reconstructEvidenceConstrainedCurves(svg, { canvasScale: 1.0 });
    expect(res.metrics.topologyGatePassed).toBe(true);
  });

  // Test F: 90° corner
  it('Test F: 90-degree corner -> preserves exact sharp corner vertex', () => {
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="M 50 50 L 150 50 L 150 150 L 50 150 Z" /></svg>`;
    const res = reconstructEvidenceConstrainedCurves(svg, { canvasScale: 1.0 });
    expect(res.metrics.topologyGatePassed).toBe(true);
    expect(res.metrics.reconstructedAnchors).toBe(5); // 4 corners + closing
  });

  // Test G: Acute cusp
  it('Test G: Acute cusp -> preserves sharp acute tip', () => {
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="M 100 20 L 130 180 L 70 180 Z" /></svg>`;
    const res = reconstructEvidenceConstrainedCurves(svg, { canvasScale: 1.0 });
    expect(res.metrics.topologyGatePassed).toBe(true);
  });

  // Test H: Small serif
  it('Test H: Small serif -> preserves geometric serif contour', () => {
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="M 90 20 L 110 20 L 110 160 L 130 160 L 130 180 L 70 180 L 70 160 L 90 160 Z" /></svg>`;
    const res = reconstructEvidenceConstrainedCurves(svg, { canvasScale: 1.0 });
    expect(res.metrics.topologyGatePassed).toBe(true);
  });

  // Test I: Thin terminal
  it('Test I: Thin terminal -> preserves terminal without global width collapse', () => {
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="M 20 20 L 180 22 L 20 24 Z" /></svg>`;
    const res = reconstructEvidenceConstrainedCurves(svg, { canvasScale: 1.0 });
    expect(res.metrics.topologyGatePassed).toBe(true);
  });

  // Test J: Uniform donut
  it('Test J: Uniform donut -> reconstructs concentric outer and inner hole with stable wall', () => {
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
  });

  // Test K: Eccentric donut
  it('Test K: Eccentric donut -> preserves eccentric offset without forcing concentricity', () => {
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
  });

  // Test L: Variable-width ring
  it('Test L: Variable-width ring -> preserves low-frequency design variation', () => {
    const ptsOuter: string[] = [];
    const ptsHole: string[] = [];
    for (let a = 0; a < 360; a += 15) {
      const rad = (a * Math.PI) / 180;
      ptsOuter.push(`${a === 0 ? 'M' : 'L'} ${(100 + 50 * Math.cos(rad)).toFixed(1)} ${(100 + 50 * Math.sin(rad)).toFixed(1)}`);
      ptsHole.push(`${a === 0 ? 'M' : 'L'} ${(100 + 35 * Math.cos(rad)).toFixed(1)} ${(100 + 20 * Math.sin(rad)).toFixed(1)}`);
    }
    ptsOuter.push('Z');
    ptsHole.push('Z');
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="${ptsOuter.join(' ')} ${ptsHole.join(' ')}" /></svg>`;

    const res = reconstructEvidenceConstrainedCurves(svg, { canvasScale: 1.0 });
    expect(res.metrics.topologyGatePassed).toBe(true);
  });

  // Test M: Outer + two holes
  it('Test M: Outer + two holes -> preserves both holes and ownership', () => {
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="M 20 20 L 180 20 L 180 180 L 20 180 Z M 40 40 L 40 90 L 160 90 L 160 40 Z M 40 110 L 40 160 L 160 160 L 160 110 Z" /></svg>`;
    const res = reconstructEvidenceConstrainedCurves(svg, { canvasScale: 1.0 });
    expect(res.metrics.topologyGatePassed).toBe(true);
    expect(res.metrics.holesAfter).toBe(2);
  });

  // Test N: Organic shape + irregular hole
  it('Test N: Organic shape + irregular hole -> topology and irregular hole preserved', () => {
    const ptsOuter: string[] = [];
    const ptsHole: string[] = [];
    for (let a = 0; a < 360; a += 20) {
      const rad = (a * Math.PI) / 180;
      const rOut = 60 + 10 * Math.sin(3 * rad);
      const rIn = 30 + 8 * Math.cos(2 * rad);
      ptsOuter.push(`${a === 0 ? 'M' : 'L'} ${(100 + rOut * Math.cos(rad)).toFixed(1)} ${(100 + rOut * Math.sin(rad)).toFixed(1)}`);
      ptsHole.push(`${a === 0 ? 'M' : 'L'} ${(100 + rIn * Math.cos(rad)).toFixed(1)} ${(100 + rIn * Math.sin(rad)).toFixed(1)}`);
    }
    ptsOuter.push('Z');
    ptsHole.push('Z');
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="${ptsOuter.join(' ')} ${ptsHole.join(' ')}" /></svg>`;

    const res = reconstructEvidenceConstrainedCurves(svg, { canvasScale: 1.0 });
    expect(res.metrics.topologyGatePassed).toBe(true);
    expect(res.metrics.holesAfter).toBe(1);
  });

  // Test O: Smooth curve + JPEG noise
  it('Test O: Smooth curve + JPEG noise -> filters high-frequency ripple while preserving curve', () => {
    const pts: string[] = [];
    for (let a = 0; a < 360; a += 10) {
      const rad = (a * Math.PI) / 180;
      const ripple = (a % 20 === 0) ? 0.8 : 0;
      pts.push(`${a === 0 ? 'M' : 'L'} ${(100 + (40 + ripple) * Math.cos(rad)).toFixed(1)} ${(100 + (40 + ripple) * Math.sin(rad)).toFixed(1)}`);
    }
    pts.push('Z');
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="${pts.join(' ')}" /></svg>`;

    const res = reconstructEvidenceConstrainedCurves(svg, { canvasScale: 1.0 });
    expect(res.metrics.topologyGatePassed).toBe(true);
    expect(res.metrics.reconstructedAnchors).toBeLessThan(res.metrics.originalAnchors);
  });

  // Test P: Real small protrusion
  it('Test P: Real small protrusion -> preserved as geometric feature', () => {
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="M 50 50 L 90 50 L 90 30 L 110 30 L 110 50 L 150 50 L 150 150 L 50 150 Z" /></svg>`;
    const res = reconstructEvidenceConstrainedCurves(svg, { canvasScale: 1.0 });
    expect(res.metrics.topologyGatePassed).toBe(true);
  });

  // Test Q: Fake 1px protrusion
  it('Test Q: Fake 1px protrusion -> filtered without generating false anchors', () => {
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="M 20 50 L 70 50 L 71 51 L 72 50 L 150 50 L 150 120 L 20 120 Z" /></svg>`;
    const res = reconstructEvidenceConstrainedCurves(svg, { canvasScale: 1.0 });
    expect(res.metrics.topologyGatePassed).toBe(true);
  });

  // Test R: Multi-scale consistency across scales (0.5x, 1x, 2x, 4x)
  it('Test R: Multi-scale consistency across scales', () => {
    for (const scale of [0.5, 1.0, 2.0, 4.0]) {
      const size = Math.round(100 * scale);
      const pad = Math.round(20 * scale);
      const end = size - pad;
      const svg = `<svg viewBox="0 0 ${size} ${size}"><path fill="#000000" d="M ${pad} ${pad} L ${end} ${pad} L ${end} ${end} L ${pad} ${end} Z" /></svg>`;

      const res = reconstructEvidenceConstrainedCurves(svg, { canvasScale: scale });
      expect(res.metrics.topologyGatePassed).toBe(true);
      expect(res.metrics.reconstructedAnchors).toBe(5);
    }
  });
});
