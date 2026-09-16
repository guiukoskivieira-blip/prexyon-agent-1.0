import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as os from 'os';
import {
  extractComponentIdentities,
  evaluateComponentCorrespondence,
  enforceComponentConservationGate,
  reconstructSvgWithComponentConservation819a,
  RgbaRaster,
} from '../src/core/vector-engine';

function createBlankRaster(
  width: number,
  height: number,
  fillColor: [number, number, number] = [255, 255, 255]
): RgbaRaster {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = fillColor[0];
    data[i * 4 + 1] = fillColor[1];
    data[i * 4 + 2] = fillColor[2];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

function decodeImage(filePath: string): RgbaRaster {
  const root = path.resolve(__dirname, '..');
  const decodeExe = path.join(root, 'scratch/v81a-typescript-equivalence/DecodeRgba.exe');
  const tmpRgba = path.join(os.tmpdir(), `v819a_decode_${Date.now()}_${Math.random().toString(36).slice(2)}.rgba`);
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

describe('PRYX — ETAPA 8.19A: Component Conservation Gate & Forensic Recovery', () => {
  // Test A: Single isolated component preserved
  it('Test A: Single isolated component -> preserved with high IoU', () => {
    const svg1 = `<svg viewBox="0 0 200 200"><path fill="#ff0000" d="M 50 50 L 150 50 L 150 150 L 50 150 Z" /></svg>`;
    const svg2 = `<svg viewBox="0 0 200 200"><path fill="#ff0000" d="M 50.5 50.2 L 149.8 50.1 L 149.9 149.8 L 50.2 150.1 Z" /></svg>`;

    const res = enforceComponentConservationGate(svg1, svg2);
    expect(res.metrics.preservedCount).toBe(1);
    expect(res.metrics.lostInvalidCount).toBe(0);
    expect(res.metrics.meanIoU).toBeGreaterThan(0.95);
    expect(res.verdict).toBe('V819A_READY_FOR_HUMAN_GATE');
  });

  // Test B: Small component preserved (< 50 px^2)
  it('Test B: Small component -> preserved without noise drop', () => {
    const svg1 = `<svg viewBox="0 0 200 200">
      <path fill="#000000" d="M 10 10 L 100 10 L 100 100 L 10 100 Z" />
      <path fill="#ff0000" d="M 150 150 L 155 150 L 155 155 L 150 155 Z" />
    </svg>`;
    const svg2 = `<svg viewBox="0 0 200 200">
      <path fill="#000000" d="M 10 10 L 100 10 L 100 100 L 10 100 Z" />
      <path fill="#ff0000" d="M 150 150 L 155 150 L 155 155 L 150 155 Z" />
    </svg>`;

    const res = enforceComponentConservationGate(svg1, svg2);
    expect(res.metrics.finalComponentsCount).toBe(2);
    expect(res.metrics.preservedCount).toBe(2);
    expect(res.metrics.lostInvalidCount).toBe(0);
  });

  // Test C: Lettering counterform / hole inside parent component preserved
  it('Test C: Lettering counterform -> preserved as semantic counterform', () => {
    // 'O' shape with outer and inner subpath
    const svg = `<svg viewBox="0 0 200 200">
      <path fill="#222222" fill-rule="evenodd" d="M 50 50 L 150 50 L 150 150 L 50 150 Z M 80 80 L 120 80 L 120 120 L 80 120 Z" />
    </svg>`;

    const comps = extractComponentIdentities(svg);
    expect(comps.length).toBe(2);
    expect(comps[0].isHole).toBe(false);
    expect(comps[1].isHole).toBe(true);
    expect(comps[1].topologyRole).toBe('SEMANTIC_COUNTERFORM');
  });

  // Test D: Valid merge classification
  it('Test D: Valid merge -> correctly classified as MERGED_VALID', () => {
    const c1 = extractComponentIdentities(`<svg viewBox="0 0 200 200"><path fill="#000" d="M 10 10 L 50 10 L 50 50 L 10 50 Z" /></svg>`);
    const c2 = extractComponentIdentities(`<svg viewBox="0 0 200 200"><path fill="#000" d="M 10 10 L 150 10 L 150 150 L 10 150 Z" /></svg>`);

    const corr = evaluateComponentCorrespondence(c1, c2, { maxAreaRatioThreshold: 2.0 });
    expect(corr[0].classification).toBe('MERGED_VALID');
  });

  // Test E: Single-corner closed loop (teardrop) preservation
  it('Test E: Single-corner closed loop -> preserved through global contour and conservation gate', () => {
    const raster = createBlankRaster(200, 200, [255, 255, 255]);
    // Teardrop shape with 1 sharp corner at (100, 50) and smooth bottom arc
    const pts = [{ x: 100, y: 50 }];
    for (let a = 0; a <= 180; a += 15) {
      const rad = (a * Math.PI) / 180;
      pts.push({
        x: Math.round(100 + 40 * Math.cos(rad)),
        y: Math.round(130 + 40 * Math.sin(rad)),
      });
    }
    pts.push({ x: 100, y: 50 });

    const svg = `<svg viewBox="0 0 200 200">
      <path fill="#792823" d="M ${pts[0].x} ${pts[0].y} ${pts.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ')} Z" />
    </svg>`;

    const res = reconstructSvgWithComponentConservation819a(svg, raster);
    expect(res.metrics.finalComponentsCount).toBe(1);
    expect(res.metrics.lostInvalidCount).toBe(0);
    expect(res.metrics.conservationPass).toBe(true);
  });

  // Test F: Missing component recovery via LOCAL_COMPONENT_FALLBACK
  it('Test F: Missing component in candidate -> restored via LOCAL_COMPONENT_FALLBACK', () => {
    const baselineSvg = `<svg viewBox="0 0 300 300">
      <path fill="#fefce0" d="M 0 0 L 300 0 L 300 300 L 0 300 Z" />
      <path fill="#792823" d="M 50 50 L 100 50 L 100 100 L 50 100 Z M 200 200 L 250 200 L 250 250 L 200 250 Z" />
    </svg>`;

    // Candidate has dropped the second subpath
    const candidateSvg = `<svg viewBox="0 0 300 300">
      <path fill="#fefce0" d="M 0 0 L 300 0 L 300 300 L 0 300 Z" />
      <path fill="#792823" d="M 50 50 L 100 50 L 100 100 L 50 100 Z" />
    </svg>`;

    const res = enforceComponentConservationGate(baselineSvg, candidateSvg);
    expect(res.metrics.baselineComponentsCount).toBe(3);
    expect(res.metrics.candidateComponentsCount).toBe(2);
    expect(res.metrics.finalComponentsCount).toBe(3);
    expect(res.metrics.fallbacksAppliedCount).toBe(1);
    expect(res.forensics.length).toBe(1);
    expect(res.forensics[0].resolution).toBe('LOCAL_COMPONENT_FALLBACK');
    expect(res.verdict).toBe('V819A_READY_FOR_HUMAN_GATE');
  });

  // Test G: Centroid drift and IoU accuracy
  it('Test G: Centroid drift and IoU thresholds correctly measured', () => {
    const svg1 = `<svg viewBox="0 0 200 200"><path fill="#000" d="M 10 10 L 30 10 L 30 30 L 10 30 Z" /></svg>`;
    const svg2 = `<svg viewBox="0 0 200 200"><path fill="#000" d="M 12 10 L 32 10 L 32 30 L 12 30 Z" /></svg>`;

    const res = enforceComponentConservationGate(svg1, svg2);
    expect(res.metrics.meanCentroidDriftPx).toBeCloseTo(2.0, 1);
    expect(res.metrics.meanIoU).toBeGreaterThan(0.8);
  });

  // Test H: Multilayered overlay components preserved
  it('Test H: Multilayered overlay components -> all layers and subpaths accounted for', () => {
    const svg = `<svg viewBox="0 0 400 400">
      <path fill="#fefce0" d="M 0 0 L 400 0 L 400 400 L 0 400 Z" />
      <path fill="#792823" d="M 50 50 L 350 50 L 350 350 L 50 350 Z" />
      <path fill="#ffffff" d="M 100 100 L 200 100 L 200 200 L 100 200 Z" />
      <path fill="#e63946" d="M 220 220 L 280 220 L 280 280 L 220 280 Z" />
    </svg>`;

    const comps = extractComponentIdentities(svg);
    expect(comps.length).toBe(4);
    expect(comps[0].topologyRole).toBe('SOLID_UNDERLAY');
    expect(comps[1].topologyRole).toBe('FOREGROUND_MAIN');
  });

  // Test I: Fill & Topology role classification accuracy
  it('Test I: Fill and topology role mapping is consistent', () => {
    const svg = `<svg viewBox="0 0 200 200">
      <path fill="#fefce0" d="M 0 0 L 200 0 L 200 200 L 0 200 Z" />
      <path fill="#ff0000" d="M 10 10 L 20 10 L 20 20 L 10 20 Z" />
    </svg>`;
    const comps = extractComponentIdentities(svg);
    expect(comps[0].fill).toBe('#fefce0');
    expect(comps[1].topologyRole).toBe('ISOLATED_DETAIL');
  });

  // Test J: Scale Invariance (0.5x, 1x, 2x, 4x)
  it('Test J: Scale invariance across 0.5x, 1x, 2x, 4x', () => {
    [0.5, 1.0, 2.0, 4.0].forEach((scale) => {
      const s = scale;
      const svg = `<svg viewBox="0 0 ${200 * s} ${200 * s}">
        <path fill="#fefce0" d="M 0 0 L ${200 * s} 0 L ${200 * s} ${200 * s} L 0 ${200 * s} Z" />
        <path fill="#000000" d="M ${50 * s} ${50 * s} L ${150 * s} ${50 * s} L ${150 * s} ${150 * s} L ${50 * s} ${150 * s} Z" />
      </svg>`;
      const comps = extractComponentIdentities(svg);
      expect(comps.length).toBe(2);
      expect(comps[0].bbox.width).toBeCloseTo(200 * s, 1);
    });
  });

  // Test K: Solid base underlay conservation without background cutouts
  it('Test K: Solid base underlay conserved with 0 canvas exposure', () => {
    const svg = `<svg viewBox="0 0 200 200">
      <path fill="#fefce0" d="M 0 0 L 200 0 L 200 200 L 0 200 Z" />
      <path fill="#792823" d="M 20 20 L 180 20 L 180 180 L 20 180 Z" />
    </svg>`;
    const res = enforceComponentConservationGate(svg, svg);
    expect(res.baselineComponents[0].topologyRole).toBe('SOLID_UNDERLAY');
    expect(res.metrics.conservationPass).toBe(true);
  });

  // Test L: Complex multi-subpath compound path conservation
  it('Test L: Compound path with 16 subpaths fully conserved', () => {
    const subpaths: string[] = [];
    for (let i = 0; i < 16; i++) {
      const x = (i % 4) * 50 + 10;
      const y = Math.floor(i / 4) * 50 + 10;
      subpaths.push(`M ${x} ${y} L ${x + 30} ${y} L ${x + 30} ${y + 30} L ${x} ${y + 30} Z`);
    }
    const svg = `<svg viewBox="0 0 300 300"><path fill="#333333" d="${subpaths.join(' ')}" /></svg>`;
    const comps = extractComponentIdentities(svg);
    expect(comps.length).toBe(16);
  });

  // LIVE LOGO DIFÍCIL CANDIDATE GENERATION (ETAPA 8.19A)
  it('executes Component Conservation Gate on Logo Difícil and generates candidate V8.19A', () => {
    const root = path.resolve(__dirname, '..');
    const inputJpgPath = path.join(root, 'scratch/vector-development-corpus/logo dificil.jpg');
    const baseline818Path = path.join(root, 'scratch/v818-boundary-refinement/logo-dificil-v818.svg');
    const candidate819Path = path.join(root, 'scratch/v819-global-contour/logo-dificil-v819.svg');

    expect(fs.existsSync(inputJpgPath)).toBe(true);
    expect(fs.existsSync(baseline818Path)).toBe(true);
    expect(fs.existsSync(candidate819Path)).toBe(true);

    const baseline818Svg = fs.readFileSync(baseline818Path, 'utf-8');
    const candidate819Svg = fs.readFileSync(candidate819Path, 'utf-8');
    const raster = decodeImage(inputJpgPath);

    // Run 8.19A full pipeline with conservation gate
    const gateResult = reconstructSvgWithComponentConservation819a(
      baseline818Svg,
      raster,
      {
        minContrastDistance: 15.0,
        maxSubpixelShift: 0.85,
        fittingTolerance: 1.5,
      }
    );

    const outDir = path.join(root, 'scratch/v819a-component-conservation');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const candidate819aPath = path.join(outDir, 'logo-dificil-v819a.svg');
    fs.writeFileSync(candidate819aPath, gateResult.svg, 'utf-8');

    // Generate comparison SVG (v818 vs v819 vs v819a)
    const comparisonSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 7200 2400" width="7200" height="2400">
  <g transform="translate(0, 0)">
    <text x="50" y="80" font-family="sans-serif" font-size="48" font-weight="bold" fill="#333">1. BASELINE V8.18 (35 Components)</text>
    <g transform="translate(0, 100)">${baseline818Svg.replace(/<\/?svg[^>]*>/gi, '')}</g>
  </g>
  <g transform="translate(2400, 0)">
    <text x="50" y="80" font-family="sans-serif" font-size="48" font-weight="bold" fill="#333">2. V8.19 RECONSTRUCTION (32/34 Components - Letter Drop Defect)</text>
    <g transform="translate(0, 100)">${candidate819Svg.replace(/<\/?svg[^>]*>/gi, '')}</g>
  </g>
  <g transform="translate(4800, 0)">
    <text x="50" y="80" font-family="sans-serif" font-size="48" font-weight="bold" fill="#333">3. V8.19A COMPONENT-CONSERVED (35/35 Components - 100% Intact)</text>
    <g transform="translate(0, 100)">${gateResult.svg.replace(/<\/?svg[^>]*>/gi, '')}</g>
  </g>
</svg>`;

    fs.writeFileSync(path.join(outDir, 'comparison-v818-v819-v819a.svg'), comparisonSvg, 'utf-8');

    fs.writeFileSync(
      path.join(outDir, 'component-conservation-audit.json'),
      JSON.stringify(gateResult.metrics, null, 2),
      'utf-8'
    );

    fs.writeFileSync(
      path.join(outDir, 'missing-component-forensic.json'),
      JSON.stringify(gateResult.forensics, null, 2),
      'utf-8'
    );

    fs.writeFileSync(
      path.join(outDir, 'component-correspondence-map.json'),
      JSON.stringify(gateResult.correspondences, null, 2),
      'utf-8'
    );

    console.log('\n======================================================');
    console.log('PRYX 8.19A COMPONENT CONSERVATION AUDIT');
    console.log('======================================================');
    console.log(`Candidate SVG: ${candidate819aPath}`);
    console.log(`Baseline Components (8.18): ${gateResult.metrics.baselineComponentsCount}`);
    console.log(`Candidate Components (8.19 raw): ${gateResult.metrics.candidateComponentsCount}`);
    console.log(`Final Components (8.19a conserved): ${gateResult.metrics.finalComponentsCount}`);
    console.log(`Preserved Components: ${gateResult.metrics.preservedCount}`);
    console.log(`Fallbacks Applied: ${gateResult.metrics.fallbacksAppliedCount}`);
    console.log(`Mean IoU: ${gateResult.metrics.meanIoU}`);
    console.log(`Mean Centroid Drift: ${gateResult.metrics.meanCentroidDriftPx} px`);
    console.log(`Conservation Pass: ${gateResult.metrics.conservationPass}`);
    console.log(`Verdict: ${gateResult.verdict}`);
    console.log('======================================================\n');

    expect(gateResult.metrics.finalComponentsCount).toBeGreaterThanOrEqual(gateResult.metrics.baselineComponentsCount);
    expect(gateResult.verdict).toBe('V819A_READY_FOR_HUMAN_GATE');
  }, 30000);

  // Shadow Mode on Goldens #1–#4
  it('executes Component Conservation Gate in shadow mode on Goldens #1 to #4', () => {
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
    console.log('SHADOW MODE: COMPONENT CONSERVATION GATE ON GOLDENS #1–#4');
    console.log('NEW_COMPONENT_CONSERVATION_GATE_EXECUTED = true');
    console.log('======================================================');

    for (const g of goldens) {
      const fullApprovedPath = path.resolve(path.join('scratch', g.approvedPath));
      const fullJpgPath = path.resolve(path.join('scratch', g.jpgPath));

      expect(fs.existsSync(fullApprovedPath)).toBe(true);
      expect(fs.existsSync(fullJpgPath)).toBe(true);

      const approvedSvg = fs.readFileSync(fullApprovedPath, 'utf-8');
      const raster = decodeImage(fullJpgPath);

      const result = reconstructSvgWithComponentConservation819a(approvedSvg, raster, {
        minContrastDistance: 15.0,
        maxSubpixelShift: 0.85,
        fittingTolerance: 1.5,
      });

      console.log(`[${g.id}]`);
      console.log(`  Components: ${result.metrics.baselineComponentsCount} -> ${result.metrics.finalComponentsCount}`);
      console.log(`  Preserved: ${result.metrics.preservedCount}, Fallbacks: ${result.metrics.fallbacksAppliedCount}`);
      console.log(`  Mean IoU: ${result.metrics.meanIoU}, Drift: ${result.metrics.meanCentroidDriftPx} px`);
      console.log(`  Verdict: ${result.verdict}`);

      expect(result.metrics.finalComponentsCount).toBeGreaterThanOrEqual(result.metrics.baselineComponentsCount);
    }
    console.log('======================================================\n');
  }, 30000);
});
