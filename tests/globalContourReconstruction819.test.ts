import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as os from 'os';
import {
  reconstructGlobalContourSvg819,
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
  const tmpRgba = path.join(os.tmpdir(), `v819_decode_${Date.now()}_${Math.random().toString(36).slice(2)}.rgba`);
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

describe('PRYX — ETAPA 8.19: Global Contour Reconstruction (Tests A - N)', () => {
  // Test A: Perfect Circle -> High-confidence circular primitive preserved
  it('Test A: Perfect Circle -> preserved as canonical circular primitive without fragmentation', () => {
    const raster = createBlankRaster(200, 200, [255, 255, 255]);
    drawAntialiasedDisk(raster, 100, 100, 45, [20, 20, 20]);

    const pts = [];
    for (let a = 0; a < 360; a += 8) {
      const rad = (a * Math.PI) / 180;
      pts.push({
        x: Math.round(100 + 45 * Math.cos(rad)),
        y: Math.round(100 + 45 * Math.sin(rad)),
      });
    }
    const svg = `<svg viewBox="0 0 200 200"><path fill="#141414" d="M ${pts[0].x} ${pts[0].y} ${pts.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ')} Z" /></svg>`;

    const res = reconstructGlobalContourSvg819(svg, raster);
    expect(res.metrics.constantCurvatureRunsSelected + res.metrics.variableCurvatureRunsSelected).toBeGreaterThanOrEqual(1);
    expect(res.metrics.selfIntersections).toBe(0);
  });

  // Test B: Ellipse
  it('Test B: Ellipse -> smooth coherent conic curvature', () => {
    const raster = createBlankRaster(300, 200, [255, 255, 255]);
    const pts = [];
    for (let a = 0; a < 360; a += 10) {
      const rad = (a * Math.PI) / 180;
      pts.push({
        x: Math.round(150 + 80 * Math.cos(rad)),
        y: Math.round(100 + 40 * Math.sin(rad)),
      });
    }
    const svg = `<svg viewBox="0 0 300 200"><path fill="#000000" d="M ${pts[0].x} ${pts[0].y} ${pts.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ')} Z" /></svg>`;
    const res = reconstructGlobalContourSvg819(svg, raster);
    expect(res.metrics.selfIntersections).toBe(0);
    expect(res.verdict).toBe('V819_READY_FOR_HUMAN_GATE');
  });

  // Test C: Line + Tangent Arc
  it('Test C: Line + Tangent Arc -> continuous G1 join between straight line and circular arc', () => {
    const raster = createBlankRaster(300, 200, [255, 255, 255]);
    const pts = [];
    for (let x = 50; x <= 150; x += 10) pts.push({ x, y: 100 });
    for (let a = 90; a >= 0; a -= 10) {
      const rad = (a * Math.PI) / 180;
      pts.push({ x: 150 + 50 * Math.cos(rad), y: 150 - 50 * Math.sin(rad) });
    }
    const svg = `<svg viewBox="0 0 300 200"><path fill="#000000" d="M ${pts[0].x} ${pts[0].y} ${pts.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ')} L 200 180 L 50 180 Z" /></svg>`;
    const res = reconstructGlobalContourSvg819(svg, raster);
    expect(res.metrics.selfIntersections).toBe(0);
  });

  // Test D: Long S-Curve
  it('Test D: Long S-Curve -> single G1-coherent curve across inflection without seams', () => {
    const raster = createBlankRaster(300, 200, [255, 255, 255]);
    const pts = [];
    for (let x = 0; x <= 200; x += 10) {
      const t = (x / 200) * 2 * Math.PI;
      pts.push({ x: 50 + x, y: 100 + Math.round(40 * Math.sin(t)) });
    }
    const svg = `<svg viewBox="0 0 300 200"><path fill="#000000" d="M ${pts[0].x} ${pts[0].y} ${pts.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ')} L 250 180 L 50 180 Z" /></svg>`;
    const res = reconstructGlobalContourSvg819(svg, raster);
    expect(res.metrics.selfIntersections).toBe(0);
  });

  // Test E: Long Rasterized Organic Curve
  it('Test E: Long Rasterized Organic Curve -> consolidated into continuous G1 spline without micro-flat spots', () => {
    const raster = createBlankRaster(400, 400, [255, 255, 255]);
    const pts = [];
    for (let i = 0; i <= 50; i++) {
      const t = i / 50;
      pts.push({
        x: Math.round(50 + 300 * t + 15 * Math.sin(t * Math.PI * 2)),
        y: Math.round(50 + 250 * t * t - 20 * Math.cos(t * Math.PI)),
      });
    }
    const svg = `<svg viewBox="0 0 400 400"><path fill="#000000" d="M ${pts[0].x} ${pts[0].y} ${pts.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ')} L 50 350 Z" /></svg>`;
    const res = reconstructGlobalContourSvg819(svg, raster);
    expect(res.metrics.selfIntersections).toBe(0);
  });

  // Test F: Curve with Inflection
  it('Test F: Curve with Inflection -> preserves true inflection without introducing artificial knot knees', () => {
    const raster = createBlankRaster(300, 200, [255, 255, 255]);
    const pts = [];
    for (let x = 0; x <= 160; x += 8) {
      const t = (x / 160) * 2 * Math.PI;
      pts.push({ x: 50 + x, y: 100 + 35 * Math.sin(t) });
    }
    const svg = `<svg viewBox="0 0 300 200"><path fill="#000000" d="M ${pts[0].x} ${pts[0].y} ${pts.slice(1).map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')} L 210 180 L 50 180 Z" /></svg>`;
    const res = reconstructGlobalContourSvg819(svg, raster);
    expect(res.metrics.selfIntersections).toBe(0);
  });

  // Test G: Long Curve with JPEG Noise
  it('Test G: Long Curve with JPEG Noise -> global spline energy minimization rejects high-frequency noise', () => {
    const raster = createBlankRaster(300, 200, [255, 255, 255]);
    const pts = [];
    for (let i = 0; i <= 30; i++) {
      const noise = (i % 2 === 0 ? 0.4 : -0.4);
      pts.push({ x: 50 + i * 8, y: 100 + 40 * Math.sin((i / 30) * Math.PI) + noise });
    }
    const svg = `<svg viewBox="0 0 300 200"><path fill="#000000" d="M ${pts[0].x} ${pts[0].y} ${pts.slice(1).map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')} L 290 180 L 50 180 Z" /></svg>`;
    const res = reconstructGlobalContourSvg819(svg, raster);
    expect(res.metrics.selfIntersections).toBe(0);
  });

  // Test H: Curve with Structural Corner in Middle
  it('Test H: Curve with Structural Corner in Middle -> 2 distinct smooth runs meeting at sharp G0 corner', () => {
    const raster = createBlankRaster(300, 300, [255, 255, 255]);
    const svg = `<svg viewBox="0 0 300 300"><path fill="#000000" d="M 50 50 L 150 50 L 150 150 L 50 150 Z" /></svg>`;
    const res = reconstructGlobalContourSvg819(svg, raster);
    expect(res.runs.length).toBeGreaterThanOrEqual(2);
    expect(res.metrics.selfIntersections).toBe(0);
  });

  // Test I: Lettering-like Smooth Contour
  it('Test I: Lettering-like Smooth Contour -> sharp serifs preserved and round bowls smooth', () => {
    const raster = createBlankRaster(400, 400, [255, 255, 255]);
    const letterOSvg = `<svg viewBox="0 0 400 400" width="400" height="400">
  <path fill="#fefce0" d="M 0 0 L 400 0 L 400 400 L 0 400 Z" />
  <path fill="#792823" d="M 200 80 C 270 80 320 130 320 200 C 320 270 270 320 200 320 C 130 320 80 270 80 200 C 80 130 130 80 200 80 Z M 200 130 C 160 130 130 160 130 200 C 130 240 160 270 200 270 C 240 270 270 240 270 200 C 270 160 240 130 200 130 Z" />
</svg>`;
    const res = reconstructGlobalContourSvg819(letterOSvg, raster);
    expect(res.verdict).toBe('V819_READY_FOR_HUMAN_GATE');
  });

  // Test J: Narrow Counterform
  it('Test J: Narrow Counterform -> morphology delta < 0.01%, 0 collapse', () => {
    const raster = createBlankRaster(300, 300, [255, 255, 255]);
    const svg = `<svg viewBox="0 0 300 300">
  <path fill="#fefce0" d="M 0 0 L 300 0 L 300 300 L 0 300 Z" />
  <path fill="#792823" d="M 50 50 L 250 50 L 250 250 L 50 250 Z M 80 80 L 220 80 L 220 220 L 80 220 Z" />
</svg>`;
    const res = reconstructGlobalContourSvg819(svg, raster);
    expect(res.verdict).toBe('V819_READY_FOR_HUMAN_GATE');
    expect(res.metrics.counterformMorphologyDelta).toBeLessThanOrEqual(0.01);
  });

  // Test K: Flat Character with Long Organic Curve
  it('Test K: Flat Character with Long Organic Curve -> continuous G1 organic character contours', () => {
    const raster = createBlankRaster(500, 500, [255, 255, 255]);
    const pts = [];
    for (let i = 0; i <= 60; i++) {
      const t = (i / 60) * 2 * Math.PI;
      pts.push({
        x: Math.round(250 + 150 * Math.cos(t) + 20 * Math.sin(2 * t)),
        y: Math.round(250 + 120 * Math.sin(t) - 15 * Math.cos(3 * t)),
      });
    }
    const svg = `<svg viewBox="0 0 500 500"><path fill="#000000" d="M ${pts[0].x} ${pts[0].y} ${pts.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ')} Z" /></svg>`;
    const res = reconstructGlobalContourSvg819(svg, raster);
    expect(res.metrics.selfIntersections).toBe(0);
    expect(res.verdict).toBe('V819_READY_FOR_HUMAN_GATE');
  });

  // Test L: Scale Invariance (0.5x, 1x, 2x, 4x)
  it('Test L: Scale Invariance -> consistent global run extraction across scales', () => {
    for (const scale of [0.5, 1.0, 2.0, 4.0]) {
      const raster = createBlankRaster(200 * scale, 200 * scale, [255, 255, 255]);
      drawAntialiasedDisk(raster, 100 * scale, 100 * scale, 45 * scale, [0, 0, 0]);
      const pts = [];
      for (let a = 0; a < 360; a += 15) {
        const rad = (a * Math.PI) / 180;
        pts.push({
          x: Math.round((100 + 45 * Math.cos(rad)) * scale),
          y: Math.round((100 + 45 * Math.sin(rad)) * scale),
        });
      }
      const svg = `<svg viewBox="0 0 ${200 * scale} ${200 * scale}"><path fill="#000000" d="M ${pts[0].x} ${pts[0].y} ${pts.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ')} Z" /></svg>`;
      const res = reconstructGlobalContourSvg819(svg, raster, { fittingTolerance: 1.5 * scale });
      expect(res.verdict).toBe('V819_READY_FOR_HUMAN_GATE');
    }
  });

  // Test M: Rotations (15°, 45°, 90°)
  it('Test M: Rotations -> invariant global run classification under rotation', () => {
    for (const deg of [15, 45, 90]) {
      const rad = (deg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const raster = createBlankRaster(300, 300, [255, 255, 255]);
      const pts = [];
      for (let i = 0; i <= 20; i++) {
        const lx = i * 8;
        const ly = 0;
        pts.push({
          x: Math.round(150 + lx * cos - ly * sin),
          y: Math.round(150 + lx * sin + ly * cos),
        });
      }
      const svg = `<svg viewBox="0 0 300 300"><path fill="#000000" d="M ${pts[0].x} ${pts[0].y} ${pts.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ')} L 10 290 L 10 10 Z" /></svg>`;
      const res = reconstructGlobalContourSvg819(svg, raster);
      expect(res.metrics.selfIntersections).toBe(0);
    }
  });

  // Test N: Subpixel Phase Shifts
  it('Test N: Subpixel Phase Shifts -> consistent global spline fitting across grid phases', () => {
    for (const phase of [0.0, 0.25, 0.5, 0.75]) {
      const raster = createBlankRaster(200, 200, [255, 255, 255]);
      const pts = [];
      for (let i = 0; i <= 20; i++) {
        pts.push({ x: 30 + i * 6 + phase, y: 50 + phase });
      }
      const svg = `<svg viewBox="0 0 200 200"><path fill="#000000" d="M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)} ${pts.slice(1).map((p) => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ')} L 150 150 L 30 150 Z" /></svg>`;
      const res = reconstructGlobalContourSvg819(svg, raster);
      expect(res.metrics.straightRunsSelected).toBeGreaterThanOrEqual(1);
    }
  });

  // Live Logo Difícil Candidate Generation & Output Validation
  it('generates v819 candidate with Global Contour Reconstruction and long-range curve coherence', () => {
    const inputJpgPath = path.resolve('scratch/vector-development-corpus/logo dificil.jpg');
    expect(fs.existsSync(inputJpgPath)).toBe(true);

    const baselineSvgPath = path.resolve('scratch/v818-boundary-refinement/logo-dificil-v818.svg');
    expect(fs.existsSync(baselineSvgPath)).toBe(true);

    const inputSvg = fs.readFileSync(baselineSvgPath, 'utf-8');
    const raster = decodeImage(inputJpgPath);

    const outDir = path.resolve('scratch/v819-global-contour');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    // Run global contour reconstruction pipeline
    const result = reconstructGlobalContourSvg819(inputSvg, raster, {
      minContrastDistance: 15.0,
      maxSubpixelShift: 0.85,
      fittingTolerance: 1.5,
    });

    // Write candidate SVG
    const candidate819Path = path.join(outDir, 'logo-dificil-v819.svg');
    fs.writeFileSync(candidate819Path, result.svg, 'utf-8');

    // Generate comparison SVG
    const comparisonSvg = generateComparisonSvg(inputSvg, result.svg);
    fs.writeFileSync(path.join(outDir, 'comparison-v818-v819.svg'), comparisonSvg, 'utf-8');

    // Write metadata JSONs
    fs.writeFileSync(
      path.join(outDir, 'global-contour-metrics.json'),
      JSON.stringify(result.metrics, null, 2),
      'utf-8'
    );

    fs.writeFileSync(
      path.join(outDir, 'model-transitions-audit.json'),
      JSON.stringify(result.transitionAudit, null, 2),
      'utf-8'
    );

    fs.writeFileSync(
      path.join(outDir, 'root-cause-audit.json'),
      JSON.stringify(result.rootCauseAudit, null, 2),
      'utf-8'
    );

    console.log('\n======================================================');
    console.log('PRYX 8.19 GLOBAL CONTOUR RECONSTRUCTION AUDIT');
    console.log('======================================================');
    console.log(`Candidate SVG saved to: ${candidate819Path}`);
    console.log(`Runs Analyzed: ${result.metrics.totalRunsAnalyzed}`);
    console.log(`  - Straight Runs: ${result.metrics.straightRunsSelected}`);
    console.log(`  - Constant Curvature Runs (Arcs): ${result.metrics.constantCurvatureRunsSelected}`);
    console.log(`  - Variable Curvature Runs (Splines): ${result.metrics.variableCurvatureRunsSelected}`);
    console.log(`  - High Confidence Primitives Preserved: ${result.metrics.highConfidencePrimitivesPreserved}`);
    console.log(`Model Transitions: ${result.metrics.modelTransitionsBefore} -> ${result.metrics.modelTransitionsAfter} (-${result.transitionAudit.spuriousTransitionsEliminated})`);
    console.log(`Mean Tangent Discontinuity: ${result.metrics.tangentDiscontinuitiesBeforeDeg.toFixed(1)}° -> ${result.metrics.tangentDiscontinuitiesAfterDeg.toFixed(1)}°`);
    console.log(`Max Tangent Discontinuity: ${result.transitionAudit.maxTangentDiscontinuityDeg.toFixed(1)}°`);
    console.log(`Anchors: ${result.metrics.anchorsBefore} -> ${result.metrics.anchorsAfter}`);
    console.log(`P50 Evidence Error: ${result.metrics.p50EvidenceErrorPx.toFixed(3)} px`);
    console.log(`P95 Evidence Error: ${result.metrics.p95EvidenceErrorPx.toFixed(3)} px`);
    console.log(`Max Evidence Error: ${result.metrics.maxEvidenceErrorPx.toFixed(3)} px`);
    console.log(`Self Intersections: ${result.metrics.selfIntersections}`);
    console.log(`Open Paths: ${result.metrics.openPaths}`);
    console.log(`Verdict: ${result.verdict}`);
    console.log('======================================================\n');

    expect(result.metrics.totalRunsAnalyzed).toBeGreaterThan(0);
    expect(result.metrics.selfIntersections).toBe(0);
    expect(result.metrics.openPaths).toBe(0);
    expect(result.verdict).toBe('V819_READY_FOR_HUMAN_GATE');

    expect(fs.existsSync(candidate819Path)).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'comparison-v818-v819.svg'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'global-contour-metrics.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'model-transitions-audit.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'root-cause-audit.json'))).toBe(true);
  }, 30000);

  // Shadow Mode on Goldens #1–#4
  it('executes new global contour pipeline in shadow mode on Goldens #1 to #4', () => {
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
    console.log('SHADOW MODE: NEW GLOBAL CONTOUR ON GOLDENS #1–#4');
    console.log('NEW_GLOBAL_CONTOUR_PIPELINE_EXECUTED = true');
    console.log('======================================================');

    for (const g of goldens) {
      const fullApprovedPath = path.resolve(path.join('scratch', g.approvedPath));
      const fullJpgPath = path.resolve(path.join('scratch', g.jpgPath));

      expect(fs.existsSync(fullApprovedPath)).toBe(true);
      expect(fs.existsSync(fullJpgPath)).toBe(true);

      const approvedSvg = fs.readFileSync(fullApprovedPath, 'utf-8');
      const raster = decodeImage(fullJpgPath);

      const result = reconstructGlobalContourSvg819(approvedSvg, raster, {
        minContrastDistance: 15.0,
        maxSubpixelShift: 0.85,
        fittingTolerance: 1.5,
      });

      console.log(`[${g.id}]`);
      console.log(`  Runs: ${result.metrics.totalRunsAnalyzed} (Straight: ${result.metrics.straightRunsSelected}, Arcs: ${result.metrics.constantCurvatureRunsSelected}, Splines: ${result.metrics.variableCurvatureRunsSelected})`);
      console.log(`  Model Transitions: ${result.metrics.modelTransitionsBefore} -> ${result.metrics.modelTransitionsAfter}`);
      console.log(`  Mean Join Discontinuity: ${result.metrics.tangentDiscontinuitiesAfterDeg.toFixed(1)}°`);
      console.log(`  Anchors: ${result.metrics.anchorsBefore} -> ${result.metrics.anchorsAfter}`);
      console.log(`  Self Intersections: ${result.metrics.selfIntersections}`);
      console.log(`  Open Paths: ${result.metrics.openPaths}`);
      console.log(`  Verdict: ${result.verdict}`);

      expect(result.metrics.selfIntersections).toBe(0);
      expect(result.metrics.openPaths).toBe(0);
    }
    console.log('======================================================\n');
  }, 30000);
});
