import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import os from 'os';
import {
  runCompleteRootCauseAudit,
  generateRegionProvenanceSvg,
} from '../src/core/vector-engine/rootCauseAudit816b';
import type { RgbaRaster } from '../src/core/vector-engine/types';

const root = path.resolve(__dirname, '..');
const decodeExe = path.join(root, 'scratch/v81a-typescript-equivalence/DecodeRgba.exe');
const inputJpgPath = path.join(root, 'scratch/vector-development-corpus/logo dificil.jpg');
const candidateSvgPath = path.join(root, 'scratch/v816a-human-gate-correction/logo-dificil-v816a.svg');
const outDir = path.join(root, 'scratch/v816b-root-cause-audit');

function decodeImage(filePath: string): RgbaRaster | null {
  if (!fs.existsSync(filePath) || !fs.existsSync(decodeExe)) return null;
  const tmpRgba = path.join(os.tmpdir(), `audit_dec_${Date.now()}_${Math.random().toString(36).slice(2)}.rgba`);
  try {
    execFileSync(decodeExe, [`${filePath}|${tmpRgba}`]);
    const dimStr = fs.readFileSync(`${tmpRgba}.dimensions`, 'utf-8').trim();
    const [width, height] = dimStr.split('x').map(Number);
    const rgbaData = new Uint8Array(fs.readFileSync(tmpRgba));
    fs.unlinkSync(tmpRgba);
    fs.unlinkSync(`${tmpRgba}.dimensions`);
    return { width, height, data: rgbaData };
  } catch {
    return null;
  }
}

describe('PRYX — ETAPA 8.16B: Human-Gate Root-Cause Audit (Tests A - I + Live Logo Audit)', () => {
  it('Test A: antialias strip between two legitimate colors -> classified as LIKELY_ANTIALIAS_MIXTURE', () => {
    const svg = `<svg viewBox="0 0 200 200">
      <path fill="#792823" d="M 0 0 L 100 0 L 100 200 L 0 200 Z" />
      <path fill="#ffe0d1" d="M 100 0 L 104 0 L 104 200 L 100 200 Z" />
      <path fill="#fefce0" d="M 104 0 L 200 0 L 200 200 L 104 200 Z" />
    </svg>`;
    const res = runCompleteRootCauseAudit(svg, null);
    const strip = res.colorMixtureEvaluations.find((c) => c.fillColor === '#ffe0d1' || c.regionThickness < 5);
    expect(strip).toBeDefined();
    expect(strip?.classification).toBe('LIKELY_ANTIALIAS_MIXTURE');
  });

  it('Test B: legitimate third-color thin region -> not classified as red/beige antialias', () => {
    const svg = `<svg viewBox="0 0 200 200">
      <path fill="#792823" d="M 0 0 L 100 0 L 100 200 L 0 200 Z" />
      <path fill="#059d3d" d="M 100 0 L 104 0 L 104 200 L 100 200 Z" />
      <path fill="#fefce0" d="M 104 0 L 200 0 L 200 200 L 104 200 Z" />
    </svg>`;
    const res = runCompleteRootCauseAudit(svg, null);
    const greenObj = res.lightRegions.find((r) => r.fillColor === '#059d3d');
    expect(greenObj).toBeUndefined();
  });

  it('Test C: JPEG transition artifact -> classified as LIKELY_JPEG_TRANSIENT for micro areas', () => {
    const svg = `<svg viewBox="0 0 200 200">
      <path fill="#792823" d="M 0 0 L 200 0 L 200 200 L 0 200 Z" />
      <path fill="#fefce0" d="M 50 50 L 54 50 L 54 54 L 50 54 Z" />
    </svg>`;
    const res = runCompleteRootCauseAudit(svg, null);
    const micro = res.colorMixtureEvaluations.find((c) => c.regionId === 'path_1_sub_0');
    expect(micro?.classification).toBe('LIKELY_JPEG_TRANSIENT');
  });

  it('Test D: actual white object -> correctly identified in whiteObjects', () => {
    const svg = `<svg viewBox="0 0 200 200">
      <path fill="#792823" d="M 0 0 L 200 0 L 200 200 L 0 200 Z" />
      <path fill="#ffffff" d="M 80 80 L 120 80 L 120 120 L 80 120 Z" />
    </svg>`;
    const res = runCompleteRootCauseAudit(svg, null);
    expect(res.whiteObjects.length).toBeGreaterThan(0);
    expect(res.whiteObjects[0].classification).toBe('ACTUAL_WHITE_OBJECT');
  });

  it('Test E: transparent gap -> detected between independent boundaries', () => {
    const svg = `<svg viewBox="0 0 200 200">
      <path fill="#fefce0" d="M 0 0 L 200 0 L 200 200 L 0 200 Z M 50 50 L 150 50 L 150 150 L 50 150 Z" />
      <path fill="#792823" d="M 52 52 L 148 52 L 148 148 L 52 148 Z" />
    </svg>`;
    const res = runCompleteRootCauseAudit(svg, null);
    expect(res.metrics.transparentGapsCount).toBeGreaterThan(0);
    expect(res.sharedBoundaryEvaluations[0].relationship).toBe('INDEPENDENT_BOUNDARIES');
  });
  it('Test F: compound-path hole -> identifies subpaths that cut out holes', () => {
    const svg = `<svg viewBox="0 0 200 200">
      <path fill="#792823" fill-rule="evenodd" d="M 10 10 L 190 10 L 190 190 L 10 190 Z M 50 50 L 150 50 L 150 150 L 50 150 Z" />
    </svg>`;
    const res = runCompleteRootCauseAudit(svg, null);
    expect(res.compoundPathEvaluations[0].holeSubpaths).toBe(1);
    expect(res.compoundPathEvaluations[0].revealsBackgroundOrCanvas).toBe(true);
  });

  it('Test G: shared boundary -> identifies coinciding vertex boundaries', () => {
    const svg = `<svg viewBox="0 0 200 200">
      <path fill="#fefce0" d="M 0 0 L 200 0 L 200 200 L 0 200 Z M 50 50 L 150 50 L 150 150 L 50 150 Z" />
      <path fill="#792823" d="M 50 50 L 150 50 L 150 150 L 50 150 Z" />
    </svg>`;
    const res = runCompleteRootCauseAudit(svg, null);
    expect(res.sharedBoundaryEvaluations[0].relationship).toBe('SHARED_BOUNDARY');
    expect(res.sharedBoundaryEvaluations[0].maxGapDistance).toBeLessThanOrEqual(0.05);
  });

  it('Test H: closed smooth loop -> invariant across rotated start index', () => {
    const pts: string[] = [];
    for (let a = 0; a < 360; a += 15) {
      const rad = (a * Math.PI) / 180;
      pts.push(`${a === 0 ? 'M' : 'L'} ${(100 + 40 * Math.cos(rad)).toFixed(2)} ${(100 + 40 * Math.sin(rad)).toFixed(2)}`);
    }
    pts.push('Z');
    const svg = `<svg viewBox="0 0 200 200"><path fill="#792823" d="${pts.join(' ')}" /></svg>`;
    const res = runCompleteRootCauseAudit(svg, null);
    expect(res.closedLoopSeamEvaluations.length).toBeGreaterThanOrEqual(1);
    expect(res.closedLoopSeamEvaluations[0].startPointDependentSeam).toBe(false);
  });

  it('Test I: intentionally broken Z seam -> detected by start-index rotational challenge', () => {
    const pts: string[] = [];
    for (let a = 0; a < 300; a += 20) {
      const rad = (a * Math.PI) / 180;
      pts.push(`${a === 0 ? 'M' : 'L'} ${(100 + 40 * Math.cos(rad)).toFixed(2)} ${(100 + 40 * Math.sin(rad)).toFixed(2)}`);
    }
    pts.push('L 20 20 Z');
    const svg = `<svg viewBox="0 0 200 200"><path fill="#792823" d="${pts.join(' ')}" /></svg>`;
    const res = runCompleteRootCauseAudit(svg, null);
    expect(res.closedLoopSeamEvaluations[0].startPointDependentFailures).toBeGreaterThan(0);
    expect(res.closedLoopSeamEvaluations[0].startPointDependentSeam).toBe(true);
  });

  it('generates all required 8.16B root-cause audit artifacts in scratch/v816b-root-cause-audit', () => {
    if (!fs.existsSync(candidateSvgPath)) {
      console.warn('Candidate SVG not found, skipping real logo audit.');
      return;
    }

    const svgContent = fs.readFileSync(candidateSvgPath, 'utf-8');
    const raster = fs.existsSync(inputJpgPath) ? decodeImage(inputJpgPath) : null;

    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const result = runCompleteRootCauseAudit(svgContent, raster);

    fs.writeFileSync(
      path.join(outDir, 'light-region-provenance.json'),
      JSON.stringify(result.lightRegions, null, 2),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(outDir, 'color-mixture-analysis.json'),
      JSON.stringify(result.colorMixtureEvaluations, null, 2),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(outDir, 'shared-boundary-audit.json'),
      JSON.stringify(result.sharedBoundaryEvaluations, null, 2),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(outDir, 'compound-path-audit.json'),
      JSON.stringify(result.compoundPathEvaluations, null, 2),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(outDir, 'closed-loop-seam-audit.json'),
      JSON.stringify(result.closedLoopSeamEvaluations, null, 2),
      'utf-8'
    );

    const diagnosticSvg = generateRegionProvenanceSvg(svgContent, result.lightRegions);
    fs.writeFileSync(
      path.join(outDir, 'logo-dificil-region-provenance.svg'),
      diagnosticSvg,
      'utf-8'
    );

    console.log('\n======================================================');
    console.log('PRYX 8.16B ROOT CAUSE AUDIT SUMMARY');
    console.log('======================================================');
    console.log(`Total Light Regions Audited: ${result.metrics.totalLightRegions}`);
    console.log(`White Vector Objects: ${result.metrics.whiteObjectsCount}`);
    console.log(`Light-Beige Vector Objects: ${result.metrics.lightBeigeObjectsCount}`);
    console.log(`Likely Antialias Mixtures: ${result.metrics.likelyAntialiasCount}`);
    console.log(`Likely JPEG Transients: ${result.metrics.likelyJpegCount}`);
    console.log(`Background Fragments / Outer: ${result.metrics.backgroundFragmentsCount}`);
    console.log(`Independent Boundaries (Transparent Gaps): ${result.metrics.independentBoundariesCount}`);
    console.log(`Compound Cutouts Revealing Canvas: ${result.metrics.compoundCutoutsCount}`);
    console.log(`Closed Loops Tested: ${result.metrics.loopsTested}`);
    console.log(`Verdict: ${result.verdict}`);
    console.log('======================================================\n');

    expect(result.verdict).toBe('ROOT_CAUSE_IDENTIFIED');
    expect(fs.existsSync(path.join(outDir, 'light-region-provenance.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'color-mixture-analysis.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'shared-boundary-audit.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'compound-path-audit.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'closed-loop-seam-audit.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'logo-dificil-region-provenance.svg'))).toBe(true);
  });
});
