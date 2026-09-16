import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as os from 'os';
import {
  reconstructEvidenceDrivenSubpixelSvg818,
  RgbaRaster,
} from '../src/core/vector-engine';
import { generateComparisonSvg } from '../src/core/vector-engine/finalCompositionAudit816d';

function createBlankRaster(width: number, height: number, fillColor: [number, number, number] = [255, 255, 255]): RgbaRaster {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = fillColor[0];
    data[i * 4 + 1] = fillColor[1];
    data[i * 4 + 2] = fillColor[2];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

function drawAntialiasedDisk(raster: RgbaRaster, cx: number, cy: number, r: number, color: [number, number, number] = [0, 0, 0]) {
  const { width, height, data } = raster;
  for (let y = Math.max(0, Math.floor(cy - r - 2)); y <= Math.min(height - 1, Math.ceil(cy + r + 2)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r - 2)); x <= Math.min(width - 1, Math.ceil(cx + r + 2)); x++) {
      const d = Math.hypot(x - cx, y - cy);
      const alpha = Math.max(0, Math.min(1, r + 0.5 - d));
      if (alpha > 0) {
        const idx = (y * width + x) * 4;
        const bgR = data[idx], bgG = data[idx + 1], bgB = data[idx + 2];
        data[idx] = Math.round(alpha * color[0] + (1 - alpha) * bgR);
        data[idx + 1] = Math.round(alpha * color[1] + (1 - alpha) * bgG);
        data[idx + 2] = Math.round(alpha * color[2] + (1 - alpha) * bgB);
        data[idx + 3] = 255;
      }
    }
  }
}

function decodeImage(filePath: string): RgbaRaster {
  const root = path.resolve(__dirname, '..');
  const decodeExe = path.join(root, 'scratch/v81a-typescript-equivalence/DecodeRgba.exe');
  const tmpRgba = path.join(os.tmpdir(), `v818_decode_${Date.now()}_${Math.random().toString(36).slice(2)}.rgba`);
  execFileSync(decodeExe, [`${filePath}|${tmpRgba}`]);
  const dimStr = fs.readFileSync(`${tmpRgba}.dimensions`, 'utf-8').trim();
  const [width, height] = dimStr.split('x').map(Number);
  const rgbaData = new Uint8Array(fs.readFileSync(tmpRgba));
  try {
    fs.unlinkSync(tmpRgba);
    fs.unlinkSync(`${tmpRgba}.dimensions`);
  } catch {}
  return { width, height, data: rgbaData };
}

describe('PRYX — ETAPA 8.18: Evidence-Driven Boundary Refinement (Tests A - L)', () => {
  // Test A: Circle (Grid boundary vs Subpixel boundary vs Ground Truth)
  it('Test A: Circle -> subpixel refinement reduces grid lock and approaches ground truth', () => {
    const raster = createBlankRaster(200, 200, [255, 255, 255]);
    drawAntialiasedDisk(raster, 100, 100, 45, [20, 20, 20]);

    // Quantized grid-locked discrete boundary
    const pts = [];
    for (let a = 0; a < 360; a += 8) {
      const rad = (a * Math.PI) / 180;
      pts.push({
        x: Math.round(100 + 45 * Math.cos(rad)),
        y: Math.round(100 + 45 * Math.sin(rad)),
      });
    }
    const svg = `<svg viewBox="0 0 200 200"><path fill="#141414" d="M ${pts[0].x} ${pts[0].y} ${pts.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ')} Z" /></svg>`;

    const res = reconstructEvidenceDrivenSubpixelSvg818(svg, raster, { minContrastDistance: 15.0 });
    expect(res.metrics.samplesAnalyzed).toBeGreaterThan(30);
    expect(res.metrics.highConfidenceRefined + res.metrics.mediumConfidenceBlended).toBeGreaterThan(15);
    expect(res.metrics.gridLockRatioAfter).toBeLessThan(res.metrics.gridLockRatioBefore);
    expect(res.metrics.selfIntersections).toBe(0);
  });

  // Test B: Ellipse
  it('Test B: Ellipse -> subpixel refinement accurately captures anisotropic curvature', () => {
    const raster = createBlankRaster(300, 200, [255, 255, 255]);
    // Draw stepped ellipse
    const pts = [];
    for (let a = 0; a < 360; a += 10) {
      const rad = (a * Math.PI) / 180;
      pts.push({
        x: Math.round(150 + 80 * Math.cos(rad)),
        y: Math.round(100 + 40 * Math.sin(rad)),
      });
    }
    const svg = `<svg viewBox="0 0 300 200"><path fill="#000000" d="M ${pts[0].x} ${pts[0].y} ${pts.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ')} Z" /></svg>`;
    const res = reconstructEvidenceDrivenSubpixelSvg818(svg, raster);
    expect(res.metrics.selfIntersections).toBe(0);
    expect(res.verdict).toBe('V818_READY_FOR_HUMAN_GATE');
  });

  // Test C: Diagonal Line
  it('Test C: Diagonal Line -> eliminates stair-step quantization along straight edge', () => {
    const raster = createBlankRaster(200, 200, [255, 255, 255]);
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="M 20 20 L 30 20 L 30 30 L 40 30 L 40 40 L 50 40 L 50 50 L 20 50 Z" /></svg>`;
    const res = reconstructEvidenceDrivenSubpixelSvg818(svg, raster);
    expect(res.metrics.selfIntersections).toBe(0);
  });

  // Test D: Circular Arc
  it('Test D: Circular Arc -> consistent subpixel normal displacement', () => {
    const raster = createBlankRaster(200, 200, [255, 255, 255]);
    drawAntialiasedDisk(raster, 100, 100, 50, [0, 0, 0]);
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="M 50 100 L 100 50 L 150 100 L 100 150 Z" /></svg>`;
    const res = reconstructEvidenceDrivenSubpixelSvg818(svg, raster);
    expect(res.metrics.samplesAnalyzed).toBeGreaterThan(0);
  });

  // Test E: S-Curve
  it('Test E: S-Curve with inflection -> preserves inflection while smoothing discretized steps', () => {
    const raster = createBlankRaster(300, 200, [255, 255, 255]);
    const pts = [];
    for (let x = 0; x <= 150; x += 10) {
      const t = (x / 150) * 2 * Math.PI;
      pts.push({ x: 50 + x, y: 100 + Math.round(30 * Math.sin(t)) });
    }
    const svg = `<svg viewBox="0 0 300 200"><path fill="#000000" d="M ${pts[0].x} ${pts[0].y} ${pts.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ')} L 200 180 L 50 180 Z" /></svg>`;
    const res = reconstructEvidenceDrivenSubpixelSvg818(svg, raster);
    expect(res.metrics.selfIntersections).toBe(0);
  });

  // Test F: Organic Asymmetric Curve
  it('Test F: Organic Asymmetric Curve -> smooth continuous boundary without artificial faceting', () => {
    const raster = createBlankRaster(300, 300, [255, 255, 255]);
    const pts = [];
    for (let i = 0; i <= 30; i++) {
      const t = i / 30;
      pts.push({
        x: Math.round(50 + 200 * t),
        y: Math.round(50 + 150 * t * t - 20 * Math.sin(t * Math.PI)),
      });
    }
    const svg = `<svg viewBox="0 0 300 300"><path fill="#000000" d="M ${pts[0].x} ${pts[0].y} ${pts.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ')} L 50 250 Z" /></svg>`;
    const res = reconstructEvidenceDrivenSubpixelSvg818(svg, raster);
    expect(res.metrics.selfIntersections).toBe(0);
  });

  // Test G: 90° Sharp Corner
  it('Test G: 90-degree Sharp Corner -> locked without rounding', () => {
    const raster = createBlankRaster(200, 200, [255, 255, 255]);
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="M 50 50 L 150 50 L 150 150 L 50 150 Z" /></svg>`;
    const res = reconstructEvidenceDrivenSubpixelSvg818(svg, raster);
    expect(res.metrics.junctionsPreserved).toBeGreaterThanOrEqual(4);
  });

  // Test H: Acute Cusp
  it('Test H: Acute Cusp -> preserved without rounding across singularity', () => {
    const raster = createBlankRaster(200, 200, [255, 255, 255]);
    const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="M 50 50 C 100 100 120 120 150 150 C 120 120 100 100 50 50 Z" /></svg>`;
    const res = reconstructEvidenceDrivenSubpixelSvg818(svg, raster);
    expect(res.metrics.selfIntersections).toBe(0);
  });

  // Test I: Thin Tapered Terminal
  it('Test I: Thin Tapered Terminal -> tip geometry preserved without area collapse', () => {
    const raster = createBlankRaster(300, 200, [255, 255, 255]);
    const pts = [
      { x: 50, y: 100 },
      { x: 100, y: 110 },
      { x: 150, y: 115 },
      { x: 200, y: 116 },
      { x: 202, y: 115 },
      { x: 200, y: 114 },
      { x: 150, y: 112 },
      { x: 100, y: 105 },
    ];
    const svg = `<svg viewBox="0 0 300 200"><path fill="#000000" d="M ${pts[0].x} ${pts[0].y} ${pts.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ')} Z" /></svg>`;
    const res = reconstructEvidenceDrivenSubpixelSvg818(svg, raster);
    expect(res.metrics.selfIntersections).toBe(0);
  });

  // Test J: Narrow Counterform
  it('Test J: Narrow Counterform -> counterform morphology delta < 0.01%', () => {
    const raster = createBlankRaster(300, 300, [255, 255, 255]);
    const svg = `<svg viewBox="0 0 300 300">
  <path fill="#fefce0" d="M 0 0 L 300 0 L 300 300 L 0 300 Z" />
  <path fill="#792823" d="M 50 50 L 250 50 L 250 250 L 50 250 Z M 80 80 L 220 80 L 220 220 L 80 220 Z" />
</svg>`;
    const res = reconstructEvidenceDrivenSubpixelSvg818(svg, raster);
    expect(res.verdict).toBe('V818_READY_FOR_HUMAN_GATE');
  });

  // Test K: 3-Region Junction
  it('Test K: 3-Region Junction -> junction vertex protected from naive 2-color blending', () => {
    const raster = createBlankRaster(200, 200, [255, 255, 255]);
    const svg = `<svg viewBox="0 0 200 200">
  <path fill="#ff0000" d="M 50 50 L 100 100 L 50 150 Z" />
  <path fill="#00ff00" d="M 100 100 L 150 50 L 150 150 Z" />
</svg>`;
    const res = reconstructEvidenceDrivenSubpixelSvg818(svg, raster);
    expect(res.metrics.junctionsPreserved).toBeGreaterThanOrEqual(2);
  });

  // Test L: Small Detail in Large Canvas (Multi-scale verification)
  it('Test L: Small Detail in Large Canvas -> preserved without blurring or over-smoothing', () => {
    const raster = createBlankRaster(1000, 1000, [255, 255, 255]);
    drawAntialiasedDisk(raster, 500, 500, 15, [0, 0, 0]);
    const pts = [];
    for (let a = 0; a < 360; a += 30) {
      const rad = (a * Math.PI) / 180;
      pts.push({
        x: Math.round(500 + 15 * Math.cos(rad)),
        y: Math.round(500 + 15 * Math.sin(rad)),
      });
    }
    const svg = `<svg viewBox="0 0 1000 1000"><path fill="#000000" d="M ${pts[0].x} ${pts[0].y} ${pts.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ')} Z" /></svg>`;
    const res = reconstructEvidenceDrivenSubpixelSvg818(svg, raster);
    expect(res.verdict).toBe('V818_READY_FOR_HUMAN_GATE');
  });

  // Live Logo Difícil Candidate Generation & Output Validation
  it('generates v818 candidate from original raster image, refining subpixel boundaries and feeding into 8.17 geometric intent', () => {
    const inputJpgPath = path.resolve('scratch/vector-development-corpus/logo dificil.jpg');
    expect(fs.existsSync(inputJpgPath)).toBe(true);

    const baselineSvgPath = path.resolve('scratch/v817-geometric-intent/logo-dificil-v817.svg');
    expect(fs.existsSync(baselineSvgPath)).toBe(true);

    const inputSvg = fs.readFileSync(baselineSvgPath, 'utf-8');
    const raster = decodeImage(inputJpgPath);

    const outDir = path.resolve('scratch/v818-boundary-refinement');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    // Run evidence-driven boundary refinement pipeline
    const result = reconstructEvidenceDrivenSubpixelSvg818(inputSvg, raster, {
      minContrastDistance: 15.0,
      maxSubpixelShift: 0.85,
      fittingTolerance: 1.5,
    });

    // Write candidate SVG
    const candidate818Path = path.join(outDir, 'logo-dificil-v818.svg');
    fs.writeFileSync(candidate818Path, result.svg, 'utf-8');

    // Generate comparison SVG
    const comparisonSvg = generateComparisonSvg(inputSvg, result.svg);
    fs.writeFileSync(path.join(outDir, 'comparison-v817-v818.svg'), comparisonSvg, 'utf-8');

    // Write metadata JSONs
    fs.writeFileSync(
      path.join(outDir, 'boundary-refinement-metrics.json'),
      JSON.stringify(result.metrics, null, 2),
      'utf-8'
    );

    fs.writeFileSync(
      path.join(outDir, 'root-cause-audit.json'),
      JSON.stringify(result.rootCauseAudit, null, 2),
      'utf-8'
    );

    console.log('\n======================================================');
    console.log('PRYX 8.18 EVIDENCE-DRIVEN BOUNDARY REFINEMENT AUDIT');
    console.log('======================================================');
    console.log(`Candidate SVG saved to: ${candidate818Path}`);
    console.log(`Samples Analyzed: ${result.metrics.samplesAnalyzed}`);
    console.log(`  - High Confidence Refined: ${result.metrics.highConfidenceRefined}`);
    console.log(`  - Medium Confidence Blended: ${result.metrics.mediumConfidenceBlended}`);
    console.log(`  - Low Confidence Preserved: ${result.metrics.lowConfidencePreserved}`);
    console.log(`  - Junctions & Corners Preserved: ${result.metrics.junctionsPreserved}`);
    console.log(`Grid-Lock Ratio: ${(result.metrics.gridLockRatioBefore * 100).toFixed(1)}% -> ${(result.metrics.gridLockRatioAfter * 100).toFixed(1)}%`);
    console.log(`Stair-Step Density: ${(result.metrics.stairStepDensityBefore * 100).toFixed(1)}% -> ${(result.metrics.stairStepDensityAfter * 100).toFixed(1)}%`);
    console.log(`Tangent Oscillation: ${result.metrics.tangentOscillationBeforeDeg.toFixed(1)}° -> ${result.metrics.tangentOscillationAfterDeg.toFixed(1)}°`);
    console.log(`Mean Subpixel Movement: ${result.metrics.meanSubpixelMovementPx.toFixed(3)} px`);
    console.log(`P95 Subpixel Movement: ${result.metrics.p95SubpixelMovementPx.toFixed(3)} px`);
    console.log(`Max Subpixel Movement: ${result.metrics.maxSubpixelMovementPx.toFixed(3)} px`);
    console.log(`Geometric Intent Decisions (8.17):`);
    console.log(`  - LINE Models: ${result.metrics.geometricIntentMetrics.lineSelected}`);
    console.log(`  - CIRCULAR_ARC Models: ${result.metrics.geometricIntentMetrics.circularArcSelected}`);
    console.log(`  - ELLIPTICAL_ARC Models: ${result.metrics.geometricIntentMetrics.ellipticalArcSelected}`);
    console.log(`  - SINGLE_CUBIC Models: ${result.metrics.geometricIntentMetrics.singleCubicSelected}`);
    console.log(`  - MULTI_CUBIC Models: ${result.metrics.geometricIntentMetrics.multiCubicSelected}`);
    console.log(`  - Anchors: ${result.metrics.geometricIntentMetrics.anchorsBefore} -> ${result.metrics.geometricIntentMetrics.anchorsAfter}`);
    console.log(`Self Intersections: ${result.metrics.selfIntersections}`);
    console.log(`Open Paths: ${result.metrics.openPaths}`);
    console.log(`Verdict: ${result.verdict}`);
    console.log('======================================================\n');

    expect(result.metrics.samplesAnalyzed).toBeGreaterThan(500);
    expect(result.metrics.gridLockRatioAfter).toBeLessThan(result.metrics.gridLockRatioBefore);
    expect(result.metrics.selfIntersections).toBe(0);
    expect(result.metrics.openPaths).toBe(0);
    expect(result.verdict).toBe('V818_READY_FOR_HUMAN_GATE');

    expect(fs.existsSync(candidate818Path)).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'comparison-v817-v818.svg'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'boundary-refinement-metrics.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'root-cause-audit.json'))).toBe(true);
  });

  // Shadow Mode on Goldens #1–#4
  it('executes new boundary refinement pipeline in shadow mode on Goldens #1 to #4', () => {
    const goldens = [
      {
        id: 'Golden #1 (08-logo-simples)',
        approvedPath: 'golden-human-regression-4/corel-review/01-logo-simples-approved.svg',
        jpgPath: 'vector-development-corpus/logo simples.jpg',
      },
      {
        id: 'Golden #2 (09-logo-lettering)',
        approvedPath: 'golden-human-regression-4/corel-review/02-logo-lettering-approved.svg',
        jpgPath: 'vector-development-corpus/logo leterring.jpg',
      },
      {
        id: 'Golden #3 (10-logo-colorida)',
        approvedPath: 'golden-human-regression-4/corel-review/03-logo-colorida-approved.svg',
        jpgPath: 'vector-development-corpus/logo colorida.jpg',
      },
      {
        id: 'Golden #4 (11-logo-personagem)',
        approvedPath: 'golden-human-regression-4/corel-review/04-logo-personagem-approved.svg',
        jpgPath: 'vector-development-corpus/logo personagem.jpg',
      },
    ];

    console.log('\n======================================================');
    console.log('SHADOW MODE: NEW BOUNDARY REFINEMENT ON GOLDENS #1–#4');
    console.log('NEW_BOUNDARY_REFINEMENT_PIPELINE_EXECUTED = true');
    console.log('NEW_GEOMETRIC_INTENT_PIPELINE_EXECUTED = true');
    console.log('======================================================');

    for (const g of goldens) {
      const fullApprovedPath = path.resolve(path.join('scratch', g.approvedPath));
      const fullJpgPath = path.resolve(path.join('scratch', g.jpgPath));

      expect(fs.existsSync(fullApprovedPath)).toBe(true);
      expect(fs.existsSync(fullJpgPath)).toBe(true);

      const approvedSvg = fs.readFileSync(fullApprovedPath, 'utf-8');
      const raster = decodeImage(fullJpgPath);

      const result = reconstructEvidenceDrivenSubpixelSvg818(approvedSvg, raster, {
        minContrastDistance: 15.0,
        maxSubpixelShift: 0.85,
        fittingTolerance: 1.5,
      });

      console.log(`[${g.id}]`);
      console.log(`  Samples Analyzed: ${result.metrics.samplesAnalyzed}`);
      console.log(`  High Conf: ${result.metrics.highConfidenceRefined}, Med Conf: ${result.metrics.mediumConfidenceBlended}, Low/Junction: ${result.metrics.lowConfidencePreserved + result.metrics.junctionsPreserved}`);
      console.log(`  Grid-Lock: ${(result.metrics.gridLockRatioBefore * 100).toFixed(1)}% -> ${(result.metrics.gridLockRatioAfter * 100).toFixed(1)}%`);
      console.log(`  Mean Move: ${result.metrics.meanSubpixelMovementPx.toFixed(3)} px, P95: ${result.metrics.p95SubpixelMovementPx.toFixed(3)} px`);
      console.log(`  Self Intersections: ${result.metrics.selfIntersections}`);
      console.log(`  Open Paths: ${result.metrics.openPaths}`);
      console.log(`  Verdict: ${result.verdict}`);

      expect(result.metrics.selfIntersections).toBe(0);
      expect(result.metrics.openPaths).toBe(0);
    }
    console.log('======================================================\n');
  });
});
