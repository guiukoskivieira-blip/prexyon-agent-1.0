import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { describe, expect, it } from 'vitest';

import {
  extractInputFeatures,
  routeVectorEngineV12,
  vectorizeWithRecoveredEngine,
  NodeCliVectoExecutor,
} from '../src/core/vector-engine';
import { parseSvgString } from '../src/core/vectorizer/svgParser';

const root = path.resolve(__dirname, '..');
const decodeExe = path.join(root, 'scratch/v81a-typescript-equivalence/DecodeRgba.exe');
const vectoExecutor = new NodeCliVectoExecutor();

const outBaseDir = path.join(root, 'scratch/v83-real-vector-human-gate');
const corelReviewDir = path.join(outBaseDir, 'corel-review');

fs.mkdirSync(outBaseDir, { recursive: true });
fs.mkdirSync(corelReviewDir, { recursive: true });

const cases = [
  {
    id: '01-berryvibe',
    name: 'berryvibe',
    label: 'Berryvibe / Blueberry',
    sourcePath: path.join(root, 'scratch/v61-positive-regression-gate/berryvibe/original.png'),
  },
  {
    id: '02-dona-benta',
    name: 'dona-benta',
    label: 'Dona Benta',
    sourcePath: null,
  },
  {
    id: '03-black-face',
    name: 'black-face',
    label: 'Black Face',
    sourcePath: path.join(root, 'scratch/v61-positive-regression-gate/black-face/original.png'),
  },
  {
    id: '04-neuza',
    name: 'neuza',
    label: 'Neuza (logo media 1)',
    sourcePath: path.join(root, 'scratch/v52-unseen-inputs/logo media 1.jpg'),
  },
  {
    id: '05-gela-tony',
    name: 'gela-tony',
    label: 'Gela Tony (logo media 2)',
    sourcePath: path.join(root, 'scratch/v52-unseen-inputs/logo media 2.jpg'),
  },
  {
    id: '06-velvette',
    name: 'velvette',
    label: 'Velvette (logo escrita 1)',
    sourcePath: path.join(root, 'scratch/v52-unseen-inputs/logo escrita 1.jpg'),
  },
  {
    id: '07-urban-bite',
    name: 'urban-bite',
    label: 'Urban Bite (logo complexa 3)',
    sourcePath: path.join(root, 'scratch/v52-unseen-inputs/logo complexa 3.jpg'),
  },
];

function analyzeSvg(svgString) {
  const parsed = parseSvgString(svgString);
  let pathCount = parsed.paths.length;
  let subpathCount = 0;
  let anchorCount = 0;
  let holes = 0;
  let compoundPaths = 0;
  const fills = new Set();
  const strokes = new Set();

  for (const p of parsed.paths) {
    if (p.fill) fills.add(p.fill);
    if (p.stroke) strokes.add(p.stroke);

    const d = p.d;
    const commands = d.match(/[MmLlHhVvCcSsQqTtAaZz]/g) || [];
    anchorCount += commands.length;

    const mMatches = d.match(/[Mm]/g) || [];
    subpathCount += mMatches.length;
    if (mMatches.length > 1) {
      compoundPaths++;
      holes += (mMatches.length - 1);
    }
  }

  return {
    viewBox: parsed.viewBox,
    pathCount,
    subpathCount,
    anchorCount,
    holes,
    compoundPaths,
    fills: Array.from(fills),
    strokes: Array.from(strokes),
  };
}

describe('PRYX ETAPA 8.3 — Real Vector Human Gate Generator', () => {
  it('processes all corpus artworks through Vector Engine V1 and outputs CorelDRAW package', async () => {
    const results = [];

    for (const c of cases) {
      console.log(`\n========================================`);
      console.log(`Processing: ${c.label} (${c.id})`);

      if (!c.sourcePath || !fs.existsSync(c.sourcePath)) {
        console.log(`STATUS: FILE_NOT_FOUND`);
        results.push({
          id: c.id,
          name: c.name,
          label: c.label,
          status: 'FILE_NOT_FOUND',
        });
        continue;
      }

      const ext = path.extname(c.sourcePath);
      const caseDir = path.join(outBaseDir, c.id);
      fs.mkdirSync(caseDir, { recursive: true });

      // 1. Copy original
      const caseOriginalPath = path.join(caseDir, `original${ext}`);
      fs.copyFileSync(c.sourcePath, caseOriginalPath);

      const corelOriginalPath = path.join(corelReviewDir, `${c.name}-original${ext}`);
      fs.copyFileSync(c.sourcePath, corelOriginalPath);

      // 2. Hash & Decode
      const fileBytes = fs.readFileSync(c.sourcePath);
      const sha256 = crypto.createHash('sha256').update(fileBytes).digest('hex').toUpperCase();

      const tmpRgba = path.join(os.tmpdir(), `human_gate_${c.name}_${Date.now()}.rgba`);
      execFileSync(decodeExe, [`${c.sourcePath}|${tmpRgba}`]);

      const dimStr = fs.readFileSync(`${tmpRgba}.dimensions`, 'utf-8');
      const [w, h] = dimStr.split('x').map(Number);
      const rgbaData = new Uint8Array(fs.readFileSync(tmpRgba));

      fs.unlinkSync(tmpRgba);
      fs.unlinkSync(`${tmpRgba}.dimensions`);

      const raster = { width: w, height: h, data: rgbaData };

      // 3. Feature extraction & Routing
      const features = extractInputFeatures(raster);
      const route = routeVectorEngineV12(features);

      console.log(`  Dimensions: ${w}x${h} (${w * h} px)`);
      console.log(`  SHA-256: ${sha256}`);
      console.log(`  Wramp: ${features.wramp.toFixed(1)}, Cpoly: ${features.cpoly}`);
      console.log(`  Route: ${route.backend}, Preferred: ${route.preferredBackend}, ReqVal: ${route.requiresValidation}`);

      // 4. Vectorize with recovered Vector Engine
      const t0 = Date.now();
      const engineResult = await vectorizeWithRecoveredEngine(raster, {
        directVecto: vectoExecutor,
        regionGraphVecto: vectoExecutor,
      });
      const durationMs = Date.now() - t0;

      console.log(`  Vectorized via ${engineResult.backend} in ${durationMs} ms`);

      // 5. Save SVGs
      const caseSvgPath = path.join(caseDir, 'result.svg');
      fs.writeFileSync(caseSvgPath, engineResult.svg, 'utf-8');

      const corelSvgPath = path.join(corelReviewDir, `${c.name}-pryx.svg`);
      fs.writeFileSync(corelSvgPath, engineResult.svg, 'utf-8');

      // 6. Detailed SVG Analysis
      const svgStats = analyzeSvg(engineResult.svg);
      console.log(`  SVG Stats: paths=${svgStats.pathCount}, subpaths=${svgStats.subpathCount}, anchors=${svgStats.anchorCount}, holes=${svgStats.holes}, compound=${svgStats.compoundPaths}`);

      const evidence = {
        id: c.id,
        name: c.name,
        label: c.label,
        sourceFile: path.basename(c.sourcePath),
        sha256,
        dimensions: { width: w, height: h, pixels: w * h },
        features: {
          wramp: features.wramp,
          cpoly: features.cpoly,
        },
        routing: {
          route: route.backend,
          backendUsed: engineResult.backend,
          requiresValidation: route.requiresValidation,
        },
        durationMs,
        svgStats,
        fillFirst: engineResult.fillFirst,
        regionGraphMetrics: engineResult.regionGraph ?? null,
        status: 'SUCCESS',
      };

      fs.writeFileSync(path.join(caseDir, 'evidence.json'), JSON.stringify(evidence, null, 2), 'utf-8');
      results.push(evidence);
    }

    fs.writeFileSync(path.join(outBaseDir, 'human-gate-manifest.json'), JSON.stringify(results, null, 2), 'utf-8');
    console.log('\n========================================');
    console.log('ETAPA 8.3 Execution Complete. Manifest saved.');

    expect(results.length).toBe(7);
    const successCount = results.filter((r) => r.status === 'SUCCESS').length;
    expect(successCount).toBe(6);
    const notFoundCount = results.filter((r) => r.status === 'FILE_NOT_FOUND').length;
    expect(notFoundCount).toBe(1);
  }, 300_000);
});
