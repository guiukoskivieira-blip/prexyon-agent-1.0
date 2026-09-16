import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  reconstructSubpixelBoundaries,
  RgbaRaster,
} from '../src/core/vector-engine';

const root = path.resolve(__dirname, '..');
const decodeExe = path.join(root, 'scratch/v81a-typescript-equivalence/DecodeRgba.exe');
const inputPath = path.join(root, 'scratch/vector-development-corpus/logo dificil.jpg');
const v811eSvgPath = path.join(root, 'scratch/v811e-topology-first/corel-review/logo-dificil-v811e.svg');

const outDir = path.join(root, 'scratch/v813-subpixel-boundary');
fs.mkdirSync(outDir, { recursive: true });

function decodeImage(filePath: string): RgbaRaster {
  const tmpRgba = path.join(os.tmpdir(), `v813_decode_${Date.now()}_${Math.random().toString(36).slice(2)}.rgba`);
  execFileSync(decodeExe, [`${filePath}|${tmpRgba}`]);
  const dimStr = fs.readFileSync(`${tmpRgba}.dimensions`, 'utf-8').trim();
  const [width, height] = dimStr.split('x').map(Number);
  const rgbaData = new Uint8Array(fs.readFileSync(tmpRgba));
  fs.unlinkSync(tmpRgba);
  fs.unlinkSync(`${tmpRgba}.dimensions`);
  return { width, height, data: rgbaData };
}

describe('PRYX — ETAPA 8.13: Logo Difícil Subpixel Boundary Audit', () => {
  it(
    'executes continuous subpixel boundary estimation on Logo Difícil and compares with discrete grid boundary',
    () => {
      expect(fs.existsSync(inputPath)).toBe(true);
      expect(fs.existsSync(v811eSvgPath)).toBe(true);

      const raster = decodeImage(inputPath);
      const svgString = fs.readFileSync(v811eSvgPath, 'utf-8');

      const result = reconstructSubpixelBoundaries(svgString, raster, {
        minContrastDistance: 15.0,
        maxSubpixelShift: 0.75,
        confidenceThreshold: 0.50,
      });

      console.log('=== LOGO DIFICIL SUBPIXEL BOUNDARY METRICS ===');
      console.log('Samples Analyzed:', result.samplesAnalyzed);
      console.log('Samples Refined:', result.samplesRefined);
      console.log('Low Confidence Preserved:', result.samplesPreservedLowConfidence);
      console.log('Grid-Locked Samples Before:', result.gridLockedSamplesBefore);
      console.log('Grid-Locked Samples After:', result.gridLockedSamplesAfter);
      console.log('Stair-Step Transitions Before:', result.stairStepTransitionsBefore);
      console.log('Stair-Step Transitions After:', result.stairStepTransitionsAfter);
      console.log('Mean Subpixel Movement:', result.meanSubpixelMovement, 'px');
      console.log('P95 Subpixel Movement:', result.p95SubpixelMovement, 'px');
      console.log('Max Subpixel Movement:', result.maxSubpixelMovement, 'px');
      console.log('Mean Color Mixture Residual:', result.meanColorMixtureResidual);
      console.log('P95 Color Mixture Residual:', result.p95ColorMixtureResidual);
      console.log('Topology Validation Is Valid:', result.topologyValidation.isValid);
      console.log('Holes Before / After:', result.holesBefore, '/', result.holesAfter);
      console.log('Components Before / After:', result.componentsBefore, '/', result.componentsAfter);

      fs.writeFileSync(path.join(outDir, 'logo-dificil-subpixel-refined.svg'), result.svg, 'utf-8');
      fs.writeFileSync(path.join(outDir, 'subpixel-evidence.json'), JSON.stringify(result, null, 2), 'utf-8');

      expect(result.samplesAnalyzed).toBeGreaterThan(500);
      expect(result.samplesRefined).toBeGreaterThan(100);
      expect(result.gridLockedSamplesAfter).toBeLessThan(result.gridLockedSamplesBefore);
      expect(result.topologyValidation.isValid).toBe(true);
    },
    60000
  );
});
