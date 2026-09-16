import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { analyzeCoupledShapeConstraints } from '../src/core/vector-engine';

describe('PRYX — ETAPA 8.15: Logo Dificil Coupled Shape Constraints Audit', () => {
  it('analyzes coupled shape constraints on Logo Dificil and generates diagnostic evidence', () => {
    const inputSvgPath = path.resolve('scratch/v811e-topology-first/corel-review/logo-dificil-v811e.svg');
    const svgContent = fs.readFileSync(inputSvgPath, 'utf-8');

    const summary = analyzeCoupledShapeConstraints(svgContent, 1.0);

    const outDir = path.resolve('scratch/v815-coupled-shape-evidence');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    // 1. Write relationship-graph.json
    fs.writeFileSync(
      path.join(outDir, 'relationship-graph.json'),
      JSON.stringify(summary.graph, null, 2),
      'utf-8'
    );

    // 2. Write counterform-constraints.json
    fs.writeFileSync(
      path.join(outDir, 'counterform-constraints.json'),
      JSON.stringify(summary.counterformSignatures, null, 2),
      'utf-8'
    );

    // 3. Write width-profile-evidence.json
    fs.writeFileSync(
      path.join(outDir, 'width-profile-evidence.json'),
      JSON.stringify(summary.widthProfiles, null, 2),
      'utf-8'
    );

    // 4. Build diagnostic visual SVG overlay with coupled relationship lines and centroids
    let overlayElements = '';

    // Draw width profile sample rays
    for (const wp of summary.widthProfiles) {
      for (const s of wp.samples) {
        if (s.width < 120.0) {
          const strokeColor = s.isProtectedFeature ? '#00ffff' : '#ffaa00';
          overlayElements += `<line x1="${s.pointA.x.toFixed(2)}" y1="${s.pointA.y.toFixed(2)}" x2="${s.pointB.x.toFixed(2)}" y2="${s.pointB.y.toFixed(2)}" stroke="${strokeColor}" stroke-width="0.5" stroke-dasharray="1,1" opacity="0.6"><title>Width: ${s.width}px</title></line>\n`;
        }
      }
    }

    // Draw counterform centroids and links
    for (const sig of summary.counterformSignatures) {
      overlayElements += `<circle cx="${sig.centroid.x.toFixed(2)}" cy="${sig.centroid.y.toFixed(2)}" r="3.0" fill="#00ff88" stroke="#000" stroke-width="0.5"><title>Counterform ${sig.holeId}: wallMed=${sig.medianWallWidth}px, var=${sig.widthVariation}px</title></circle>\n`;
    }

    const viewBoxMatch = svgContent.match(/viewBox\s*=\s*["']([^"']+)["']/i);
    const vb = viewBoxMatch ? viewBoxMatch[1] : '0 0 500 500';

    const overlaySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">
  <!-- Base Geometry with Opacity -->
  <g opacity="0.6">
    ${svgContent.replace(/<svg[^>]*>|<\/svg>/gi, '')}
  </g>
  <!-- Coupled Shape Relationship Rays & Centroids -->
  <g id="coupled-relationships">
    ${overlayElements}
  </g>
</svg>`;

    fs.writeFileSync(path.join(outDir, 'logo-dificil-relationship-overlay.svg'), overlaySvg, 'utf-8');

    console.log('=== LOGO DIFICIL COUPLED SHAPE SUMMARY ===');
    console.log('regionsAnalyzed:', summary.regionsAnalyzed);
    console.log('boundariesAnalyzed:', summary.boundariesAnalyzed);
    console.log('outerHoleRelationships:', summary.outerHoleRelationships);
    console.log('oppositeBoundaryRelationships:', summary.oppositeBoundaryRelationships);
    console.log('thinWallRelationships:', summary.thinWallRelationships);
    console.log('counterformsAnalyzed:', summary.counterformsAnalyzed);
    console.log('widthProfilesCreated:', summary.widthProfilesCreated);
    console.log('meanWidthVariation:', summary.meanWidthVariation);
    console.log('highFrequencyWidthJitter:', summary.highFrequencyWidthJitter);
    console.log('protectedFeatureInteractions:', summary.protectedFeatureInteractions);
    console.log('featureSupportSummary:', summary.featureSupportSummary);
    console.log('evidenceData:', summary.evidenceData);
    console.log('==========================================');

    expect(summary.regionsAnalyzed).toBeGreaterThan(0);
    expect(summary.counterformsAnalyzed).toBeGreaterThan(0);
    expect(summary.evidenceData.topologyDataConsumed).toBe(true);
    expect(summary.evidenceData.subpixelDataConsumed).toBe(true);
    expect(summary.evidenceData.multiscaleDataConsumed).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'relationship-graph.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'counterform-constraints.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'width-profile-evidence.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'logo-dificil-relationship-overlay.svg'))).toBe(true);
  });
});
