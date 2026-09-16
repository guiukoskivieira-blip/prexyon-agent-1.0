import { describe, expect, it } from 'vitest';
import {
  buildPlanarRegionMapFromSvg,
  computeTopologySignature,
  validateTopologyInvariants,
} from '../src/core/vector-engine';

describe('PRYX — ETAPA 8.12: Topology-First Vector Reconstruction Foundation (Tests A - H)', () => {
  // Test A: Donut / Letter O (1 outer, 1 hole)
  it('Test A: Donut / Letter O -> constructs planar map with 1 outer contour and 1 hole', () => {
    const svg = `<svg viewBox="0 0 800 1200">
      <path fill="#000000" d="M 500 400 C 500 460 460 500 400 500 C 340 500 300 460 300 400 C 300 340 340 300 400 300 C 460 300 500 340 500 400 Z M 450 400 C 450 370 430 350 400 350 C 370 350 350 370 350 400 C 350 430 370 450 400 450 C 430 450 450 430 450 400 Z" />
    </svg>`;
    const map = buildPlanarRegionMapFromSvg(svg);
    expect(map.totalComponents).toBe(1);
    expect(map.totalHoles).toBe(1);

    const sig = computeTopologySignature(map);
    expect(sig.componentCount).toBe(1);
    expect(sig.holeCount).toBe(1);
  });

  // Test B: Letter B (1 outer, 2 holes)
  it('Test B: Letter B -> constructs planar map with 1 outer contour and 2 holes', () => {
    const svg = `<svg viewBox="0 0 800 1200">
      <path fill="#111111" d="M 100 100 L 400 100 C 450 100 480 130 480 180 C 480 220 450 240 420 250 C 460 260 490 290 490 340 C 490 390 450 420 400 420 L 100 420 Z M 200 150 L 350 150 C 380 150 400 165 400 190 C 400 215 380 230 350 230 L 200 230 Z M 200 270 L 360 270 C 390 270 410 285 410 310 C 410 335 390 350 360 350 L 200 350 Z" />
    </svg>`;
    const map = buildPlanarRegionMapFromSvg(svg);
    expect(map.totalComponents).toBe(1);
    expect(map.totalHoles).toBe(2);

    const sig = computeTopologySignature(map);
    expect(sig.componentCount).toBe(1);
    expect(sig.holeCount).toBe(2);
  });

  // Test C: Two adjacent regions (1 shared boundary)
  it('Test C: Two adjacent regions -> extracts adjacency edge and shared boundary relation', () => {
    // Region A (Left rectangle: x=100..300, y=100..300) and Region B (Right rectangle: x=300..500, y=100..300) touching along x=300
    const svg = `<svg viewBox="0 0 800 1200">
      <path fill="#ff0000" d="M 100 100 L 300 100 L 300 300 L 100 300 Z" />
      <path fill="#0000ff" d="M 300 100 L 500 100 L 500 300 L 300 300 Z" />
    </svg>`;
    const map = buildPlanarRegionMapFromSvg(svg);
    expect(map.totalComponents).toBe(2);
    expect(map.sharedBoundaries.size).toBeGreaterThanOrEqual(1);

    const sig = computeTopologySignature(map);
    expect(sig.adjacencyEdgeCount).toBeGreaterThanOrEqual(1);
  });

  // Test D: Nested regions (outer -> hole -> island)
  it('Test D: Nested regions -> extracts parent-child containment hierarchy and nesting depth', () => {
    // Outer donut (x=100..600) + inner island (x=300..400)
    const svg = `<svg viewBox="0 0 800 1200">
      <path fill="#222222" d="M 100 100 L 600 100 L 600 600 L 100 600 Z M 200 200 L 200 500 L 500 500 L 500 200 Z" />
      <path fill="#eeeeee" d="M 300 300 L 400 300 L 400 400 L 300 400 Z" />
    </svg>`;
    const map = buildPlanarRegionMapFromSvg(svg);
    expect(map.totalComponents).toBe(2);
    expect(map.totalHoles).toBe(1);
    expect(map.maxNestingDepth).toBeGreaterThanOrEqual(1);

    const sig = computeTopologySignature(map);
    expect(sig.maxNestingDepth).toBeGreaterThanOrEqual(1);
  });

  // Test E: Two separated objects (2 connected components)
  it('Test E: Two separated objects -> identifies 2 disconnected components with 0 holes', () => {
    const svg = `<svg viewBox="0 0 800 1200">
      <path fill="#aa0000" d="M 100 100 L 200 100 L 200 200 L 100 200 Z" />
      <path fill="#00aa00" d="M 400 100 L 500 100 L 500 200 L 400 200 Z" />
    </svg>`;
    const map = buildPlanarRegionMapFromSvg(svg);
    expect(map.totalComponents).toBe(2);
    expect(map.totalHoles).toBe(0);
    expect(map.sharedBoundaries.size).toBe(0);
  });

  // Test F: Shape with hole close to boundary
  it('Test F: Shape with hole close to boundary -> preserves distinct hole without merging into outer contour', () => {
    // Outer rect (100..400) + hole at (105..200), very close to left wall (5px distance)
    const svg = `<svg viewBox="0 0 800 1200">
      <path fill="#333333" d="M 100 100 L 400 100 L 400 400 L 100 400 Z M 105 150 L 105 350 L 200 350 L 200 150 Z" />
    </svg>`;
    const map = buildPlanarRegionMapFromSvg(svg);
    expect(map.totalComponents).toBe(1);
    expect(map.totalHoles).toBe(1);
  });

  // Test G: Curved shared boundary
  it('Test G: Curved shared boundary -> extracts shared boundary samples between two curved shapes', () => {
    const svg = `<svg viewBox="0 0 800 1200">
      <path fill="#ff8800" d="M 100 100 C 200 100 250 200 250 300 L 100 300 Z" />
      <path fill="#0088ff" d="M 250 300 C 250 200 200 100 100 100 L 400 100 L 400 300 Z" />
    </svg>`;
    const map = buildPlanarRegionMapFromSvg(svg);
    expect(map.totalComponents).toBe(2);
    expect(map.sharedBoundaries.size).toBeGreaterThanOrEqual(1);
  });

  // Test H: Purposely destructive simplification -> Topology Gate REJECTS
  it('Test H: Destructive simplification -> Topology Gate detects violation and rejects candidate', () => {
    const baselineSvg = `<svg viewBox="0 0 800 1200">
      <path fill="#000000" d="M 500 400 C 500 460 460 500 400 500 C 340 500 300 460 300 400 C 300 340 340 300 400 300 C 460 300 500 340 500 400 Z M 450 400 C 450 370 430 350 400 350 C 370 350 350 370 350 400 C 350 430 370 450 400 450 C 430 450 450 430 450 400 Z" />
    </svg>`;
    // Degraded candidate where inner hole was accidentally dropped / merged
    const degradedCandidateSvg = `<svg viewBox="0 0 800 1200">
      <path fill="#000000" d="M 500 400 C 500 460 460 500 400 500 C 340 500 300 460 300 400 C 300 340 340 300 400 300 C 460 300 500 340 500 400 Z" />
    </svg>`;

    const baseMap = buildPlanarRegionMapFromSvg(baselineSvg);
    const candidateMap = buildPlanarRegionMapFromSvg(degradedCandidateSvg);

    const baseSig = computeTopologySignature(baseMap);
    const candidateSig = computeTopologySignature(candidateMap);

    const gateResult = validateTopologyInvariants(baseSig, candidateSig);
    expect(gateResult.isValid).toBe(false);
    expect(gateResult.rejected).toBe(1);
    expect(gateResult.holeCollapsesPrevented).toBe(1);
    expect(gateResult.violations.length).toBeGreaterThan(0);
  });
});
