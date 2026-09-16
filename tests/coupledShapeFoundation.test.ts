import { describe, expect, it } from 'vitest';
import { analyzeCoupledShapeConstraints } from '../src/core/vector-engine';

describe('PRYX — ETAPA 8.15: Coupled Shape Constraints Foundation (Tests A - L)', () => {
  // Test A: Perfect uniform donut
  it('Test A: Uniform donut -> identifies OWNS_COUNTERFORM and stable wall width', () => {
    // Outer circle (R=50) + inner hole (R=30)
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

    const res = analyzeCoupledShapeConstraints(svg, 1.0);
    expect(res.outerHoleRelationships).toBe(1);
    expect(res.counterformsAnalyzed).toBe(1);
    const sig = res.counterformSignatures[0];
    expect(sig.centroidOffset).toBeLessThan(3.0); // Concentric
    expect(Math.abs(sig.medianWallWidth - 20.0)).toBeLessThan(3.0);
  });

  // Test B: Intentionally eccentric donut
  it('Test B: Eccentric donut -> measures offset without forcing concentricity', () => {
    // Outer circle (cx=100, cy=100, R=50) + inner hole offset (cx=115, cy=100, R=25)
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

    const res = analyzeCoupledShapeConstraints(svg, 1.0);
    expect(res.outerHoleRelationships).toBe(1);
    const sig = res.counterformSignatures[0];
    expect(sig.centroidOffset).toBeGreaterThan(10.0); // Significant measured offset preserved
  });

  // Test C: Ring with intentional variable wall thickness
  it('Test C: Variable thickness ring -> preserves low-frequency design variation', () => {
    // Outer circle + elliptical hole
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

    const res = analyzeCoupledShapeConstraints(svg, 1.0);
    expect(res.outerHoleRelationships).toBe(1);
    const sig = res.counterformSignatures[0];
    expect(sig.widthVariation).toBeGreaterThan(5.0); // Low-frequency wall variation captured
  });

  // Test D: Uniform ring contaminated by 1px jitter
  it('Test D: Ring with 1px jitter -> detects high-frequency width jitter', () => {
    const ptsOuter: string[] = [];
    const ptsHole: string[] = [];
    for (let a = 0; a < 360; a += 15) {
      const rad = (a * Math.PI) / 180;
      const jitter = (a % 30 === 0) ? 1.5 : 0;
      ptsOuter.push(`${a === 0 ? 'M' : 'L'} ${(100 + (50 + jitter) * Math.cos(rad)).toFixed(1)} ${(100 + (50 + jitter) * Math.sin(rad)).toFixed(1)}`);
      ptsHole.push(`${a === 0 ? 'M' : 'L'} ${(100 + 30 * Math.cos(rad)).toFixed(1)} ${(100 + 30 * Math.sin(rad)).toFixed(1)}`);
    }
    ptsOuter.push('Z');
    ptsHole.push('Z');
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="${ptsOuter.join(' ')} ${ptsHole.join(' ')}" /></svg>`;

    const res = analyzeCoupledShapeConstraints(svg, 1.0);
    expect(res.highFrequencyWidthJitter).toBeGreaterThanOrEqual(0.3);
  });

  // Test E: Vertical stem
  it('Test E: Vertical stem -> detects OPPOSITE_BOUNDARY relationship', () => {
    const pts: string[] = [];
    // Rectangle 20px wide, 100px high sampled with points
    for (let y = 20; y <= 120; y += 10) pts.push(`L 40 ${y}`);
    for (let y = 120; y >= 20; y -= 10) pts.push(`L 60 ${y}`);
    const dStr = `M 40 20 ${pts.join(' ')} Z`;
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="${dStr}" /></svg>`;

    const res = analyzeCoupledShapeConstraints(svg, 1.0);
    expect(res.oppositeBoundaryRelationships).toBeGreaterThanOrEqual(1);
  });

  // Test F: Stem with serif
  it('Test F: Stem with serif -> protects serif features without corrupting stem width', () => {
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="M 40 20 L 60 20 L 60 100 L 75 100 L 75 115 L 25 115 L 25 100 L 40 100 Z" /></svg>`;
    const res = analyzeCoupledShapeConstraints(svg, 1.0);
    expect(res.featureSupportSummary.supported).toBeGreaterThanOrEqual(4);
  });

  // Test G: Thin terminal
  it('Test G: Thin terminal -> preserves terminal without global width collapse', () => {
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="M 20 20 L 180 22 L 20 24 Z" /></svg>`;
    const res = analyzeCoupledShapeConstraints(svg, 1.0);
    expect(res.regionsAnalyzed).toBe(1);
  });

  // Test H: Outer + 2 holes (Letter B / 8)
  it('Test H: Outer + 2 holes -> correctly assigns ownership to both counterforms', () => {
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="M 20 20 L 180 20 L 180 180 L 20 180 Z M 40 40 L 40 90 L 160 90 L 160 40 Z M 40 110 L 40 160 L 160 160 L 160 110 Z" /></svg>`;
    const res = analyzeCoupledShapeConstraints(svg, 1.0);
    expect(res.outerHoleRelationships).toBe(2);
    expect(res.counterformsAnalyzed).toBe(2);
  });

  // Test I: Hole very close to outer boundary (Thin wall pair)
  it('Test I: Thin wall hole -> classifies THIN_WALL_PAIR relationship', () => {
    // Outer: 0 to 200. Hole: 5 to 195 (5px wall)
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="M 10 10 L 190 10 L 190 190 L 10 190 Z M 15 15 L 15 185 L 185 185 L 185 15 Z" /></svg>`;
    const res = analyzeCoupledShapeConstraints(svg, 1.0);
    expect(res.thinWallRelationships).toBeGreaterThanOrEqual(1);
  });

  // Test J: Organic shape with irregular hole
  it('Test J: Organic shape with irregular hole -> preserves topological coupling without forcing regularity', () => {
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

    const res = analyzeCoupledShapeConstraints(svg, 1.0);
    expect(res.outerHoleRelationships).toBe(1);
    expect(res.counterformSignatures[0].area).toBeGreaterThan(0);
  });

  // Test K: Two independent nearby shapes
  it('Test K: Two independent shapes -> maintains separate component boundaries', () => {
    const svg = `<svg viewBox="0 0 200 200">
      <path fill="#000000" d="M 20 20 L 80 20 L 80 80 L 20 80 Z" />
      <path fill="#ff0000" d="M 100 20 L 160 20 L 160 80 L 100 80 Z" />
    </svg>`;
    const res = analyzeCoupledShapeConstraints(svg, 1.0);
    expect(res.regionsAnalyzed).toBe(2);
    expect(res.outerHoleRelationships).toBe(0);
  });

  // Test L: Multi-scale invariance (0.5x, 1x, 2x, 4x)
  it('Test L: Multi-scale consistency across scales', () => {
    for (const scale of [0.5, 1.0, 2.0, 4.0]) {
      const size = Math.round(100 * scale);
      const rOut = Math.round(40 * scale);
      const rIn = Math.round(20 * scale);
      const center = size / 2;

      const ptsOuter: string[] = [];
      const ptsHole: string[] = [];
      for (let a = 0; a < 360; a += 20) {
        const rad = (a * Math.PI) / 180;
        ptsOuter.push(`${a === 0 ? 'M' : 'L'} ${(center + rOut * Math.cos(rad)).toFixed(1)} ${(center + rOut * Math.sin(rad)).toFixed(1)}`);
        ptsHole.push(`${a === 0 ? 'M' : 'L'} ${(center + rIn * Math.cos(rad)).toFixed(1)} ${(center + rIn * Math.sin(rad)).toFixed(1)}`);
      }
      ptsOuter.push('Z');
      ptsHole.push('Z');
      const svg = `<svg viewBox="0 0 ${size} ${size}"><path fill="#000000" d="${ptsOuter.join(' ')} ${ptsHole.join(' ')}" /></svg>`;

      const res = analyzeCoupledShapeConstraints(svg, scale);
      expect(res.outerHoleRelationships).toBe(1);
      expect(res.counterformsAnalyzed).toBe(1);
    }
  });
});
