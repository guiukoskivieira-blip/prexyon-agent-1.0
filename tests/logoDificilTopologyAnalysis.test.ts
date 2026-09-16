import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildPlanarRegionMapFromSvg,
  computeTopologySignature,
  validateTopologyInvariants,
} from '../src/core/vector-engine';

const root = path.resolve(__dirname, '..');
const v811eSvgPath = path.join(root, 'scratch/v811e-topology-first/corel-review/logo-dificil-v811e.svg');

describe('PRYX — ETAPA 8.12: Logo Difícil Planar Topology Audit', () => {
  it('analyzes planar region map, shared boundaries, and topological hierarchy of Logo Difícil', () => {
    expect(fs.existsSync(v811eSvgPath)).toBe(true);

    const svgString = fs.readFileSync(v811eSvgPath, 'utf-8');
    const planarMap = buildPlanarRegionMapFromSvg(svgString);
    const signature = computeTopologySignature(planarMap);

    console.log('--- LOGO DIFICIL TOPOLOGY AUDIT ---');
    console.log('Total Regions / Connected Components:', planarMap.totalComponents);
    console.log('Total Holes / Counterforms:', planarMap.totalHoles);
    console.log('Max Nesting Depth:', planarMap.maxNestingDepth);
    console.log('Adjacency Edges:', signature.adjacencyEdgeCount);
    console.log('Shared Boundaries:', planarMap.sharedBoundaries.size);

    // Validate topology invariants on self (consistency check)
    const selfValidation = validateTopologyInvariants(signature, signature);
    expect(selfValidation.isValid).toBe(true);
    expect(selfValidation.violations.length).toBe(0);

    expect(planarMap.totalComponents).toBe(35);
    expect(planarMap.totalHoles).toBe(36);
  });
});
