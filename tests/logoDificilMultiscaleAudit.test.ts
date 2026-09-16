import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { analyzeSvgMultiscaleFeatures } from '../src/core/vector-engine';

describe('PRYX — ETAPA 8.14: Logo Dificil Multiscale Feature Audit', () => {
  it('analyzes multiscale features on Logo Dificil and generates diagnostic evidence', () => {
    const inputSvgPath = path.resolve('scratch/v811e-topology-first/corel-review/logo-dificil-v811e.svg');
    const svgContent = fs.readFileSync(inputSvgPath, 'utf-8');

    const summary = analyzeSvgMultiscaleFeatures(svgContent, 1.0);

    const outDir = path.resolve('scratch/v814-multiscale-feature-evidence');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    // Write JSON summary
    fs.writeFileSync(
      path.join(outDir, 'feature-evidence.json'),
      JSON.stringify(summary, null, 2),
      'utf-8'
    );

    // Build diagnostic visual SVG overlay
    let overlayMarkers = '';
    for (const prof of summary.profiles) {
      for (const fp of prof.featurePoints) {
        let color = '#888888';
        let r = 1.0;
        if (fp.classification === 'PERSISTENT_CORNER') {
          color = '#ff0000'; // Red
          r = 2.5;
        } else if (fp.classification === 'PERSISTENT_CUSP') {
          color = '#ff00ff'; // Magenta
          r = 2.8;
        } else if (fp.classification === 'THIN_TERMINAL') {
          color = '#00ffff'; // Cyan
          r = 2.5;
        } else if (fp.classification === 'INFLECTION') {
          color = '#ffff00'; // Yellow
          r = 2.0;
        } else if (fp.classification === 'LIKELY_RASTER_ARTIFACT') {
          color = '#ff8800'; // Orange
          r = 2.2;
        } else if (fp.classification === 'COUNTERFORM_BOUNDARY') {
          color = '#00ff88'; // Bright green
          r = 1.2;
        }

        if (fp.classification !== 'SMOOTH_CONTINUATION') {
          overlayMarkers += `<circle cx="${fp.point.x.toFixed(2)}" cy="${fp.point.y.toFixed(2)}" r="${r}" fill="${color}" stroke="#000" stroke-width="0.3"><title>${fp.classification} (kF=${fp.curvatureFine}, turn=${fp.turnAngleDeg}°)</title></circle>\n`;
        }
      }
    }

    const viewBoxMatch = svgContent.match(/viewBox\s*=\s*["']([^"']+)["']/i);
    const vb = viewBoxMatch ? viewBoxMatch[1] : '0 0 500 500';

    const overlaySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">
  <!-- Base Geometry with Opacity -->
  <g opacity="0.65">
    ${svgContent.replace(/<svg[^>]*>|<\/svg>/gi, '')}
  </g>
  <!-- Multiscale Feature Markers -->
  <g id="multiscale-features">
    ${overlayMarkers}
  </g>
</svg>`;

    fs.writeFileSync(path.join(outDir, 'logo-dificil-feature-overlay.svg'), overlaySvg, 'utf-8');

    // Build standalone visual analysis diagram with legend
    const analysisSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 650" width="800" height="650" style="background:#1e1e1e; font-family:sans-serif;">
  <rect width="800" height="650" fill="#181824" />
  <text x="20" y="35" fill="#ffffff" font-size="18" font-weight="bold">PRYX 8.14 — Multiscale Feature Evidence Overlay</text>
  <text x="20" y="55" fill="#9999aa" font-size="12">Curvature Scale Space (CSS) &amp; Feature Persistence Analysis</text>

  <!-- Legend -->
  <g transform="translate(20, 75)">
    <rect width="760" height="45" fill="#252538" rx="6" />
    <circle cx="20" cy="22" r="5" fill="#ff0000" /><text x="32" y="26" fill="#fff" font-size="11">Persistent Corner (${summary.persistentCorners})</text>
    <circle cx="170" cy="22" r="5" fill="#ff00ff" /><text x="182" y="26" fill="#fff" font-size="11">Persistent Cusp (${summary.persistentCusps})</text>
    <circle cx="310" cy="22" r="5" fill="#00ffff" /><text x="322" y="26" fill="#fff" font-size="11">Thin Terminal (${summary.thinTerminals})</text>
    <circle cx="440" cy="22" r="5" fill="#ffff00" /><text x="452" y="26" fill="#fff" font-size="11">Inflection (${summary.inflections})</text>
    <circle cx="560" cy="22" r="5" fill="#ff8800" /><text x="572" y="26" fill="#fff" font-size="11">Raster Artifact (${summary.likelyRasterArtifacts})</text>
  </g>

  <!-- Artwork Container -->
  <g transform="translate(150, 140)">
    <svg viewBox="${vb}" width="500" height="480">
      <g opacity="0.6">
        ${svgContent.replace(/<svg[^>]*>|<\/svg>/gi, '')}
      </g>
      <g>
        ${overlayMarkers}
      </g>
    </svg>
  </g>
</svg>`;

    fs.writeFileSync(path.join(outDir, 'logo-dificil-feature-analysis.svg'), analysisSvg, 'utf-8');

    expect(summary.boundariesAnalyzed).toBeGreaterThan(0);
    expect(summary.featuresDetected).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(outDir, 'feature-evidence.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'logo-dificil-feature-overlay.svg'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'logo-dificil-feature-analysis.svg'))).toBe(true);
  });
});
