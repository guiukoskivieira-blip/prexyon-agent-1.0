import { describe, expect, it, vi } from 'vitest';
import { getVTracerOptionsForPreset } from '../src/core/vectorizer/presets';
import { resolveAdaptiveVTracerOptions } from '../src/core/vectorizer/v2/adaptiveVTracerSelector';
import type { RgbaBitmap } from '../src/core/vectorizer/v2/adaptiveRasterAnalyzer';
import { buildVectorGroupFromSvg } from '../src/core/vectorizer/svgParser';
import { VectorizeCommand } from '../src/core/commands/types';
import { addNode, createDocument, createRasterNode } from '../src/core/pdm/document';

function cleanBitmap(): RgbaBitmap {
  const data = new Uint8Array(128 * 128 * 4).fill(255);
  for (let y = 24; y < 104; y++) for (let x = 24; x < 104; x++) {
    const offset = (y * 128 + x) * 4;
    data[offset] = 0; data[offset + 1] = 0; data[offset + 2] = 0;
  }
  return { data, width: 128, height: 128 };
}

function noisyBitmap(): RgbaBitmap {
  const data = new Uint8Array(128 * 128 * 4).fill(255);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const distance = Math.hypot(x - 64, y - 64);
    if (distance > 46) continue;
    const base = distance <= 40 ? 20 : 255;
    const noise = distance >= 36 ? (((x * 17 + y * 31) % 43) - 21) * 4 : 0;
    const value = Math.max(0, Math.min(255, base + noise));
    const offset = (y * 128 + x) * 4;
    data[offset] = value; data[offset + 1] = value; data[offset + 2] = value;
  }
  return { data, width: 128, height: 128 };
}

describe('V2.9 controlled adaptive VTracer integration', () => {
  it('keeps clean logo on baseline and selects NOISY_LOGO for JPEG-like evidence', () => {
    const base = getVTracerOptionsForPreset('logo');
    const clean = resolveAdaptiveVTracerOptions('logo', cleanBitmap(), base);
    const noisy = resolveAdaptiveVTracerOptions('logo', noisyBitmap(), base);

    expect(clean.effectiveStrategy).toBe('BASELINE_LOGO');
    expect(clean.options).toEqual(base);
    expect(noisy.effectiveStrategy).toBe('NOISY_LOGO');
    expect(noisy.options).toEqual({
      ...base,
      filterSpeckle: 14,
      colorPrecision: 5,
      layerDifference: 24,
      simplify: 2,
    });
  });

  it('keeps alpha logo on baseline and falls back when analyzer throws', () => {
    const base = getVTracerOptionsForPreset('logo');
    const alpha = noisyBitmap();
    alpha.data[3] = 128;
    expect(resolveAdaptiveVTracerOptions('logo', alpha, base).effectiveStrategy).toBe('BASELINE_LOGO');
    const failure = resolveAdaptiveVTracerOptions('logo', noisyBitmap(), base, () => {
      throw new Error('analysis failed');
    });
    expect(failure.effectiveStrategy).toBe('BASELINE_LOGO');
    expect(failure.reason).toBe('ANALYZER_FAILURE');
    expect(failure.options).toEqual(base);
  });

  it.each(['simple', 'detailed'] as const)('leaves preset %s exactly unchanged', (preset) => {
    const base = getVTracerOptionsForPreset(preset);
    const analyzer = vi.fn();
    const result = resolveAdaptiveVTracerOptions(preset, noisyBitmap(), base, analyzer);
    expect(result.options).toBe(base);
    expect(result.effectiveStrategy).toBe('NOT_APPLICABLE');
    expect(analyzer).not.toHaveBeenCalled();
  });

  it('is deterministic and emits only internal factual strategy metadata', () => {
    const base = getVTracerOptionsForPreset('logo');
    const bitmap = noisyBitmap();
    const first = resolveAdaptiveVTracerOptions('logo', bitmap, base);
    const second = resolveAdaptiveVTracerOptions('logo', bitmap, base);
    expect(first).toEqual(second);
    expect(first.metadata).toEqual({ requestedPreset: 'logo', effectiveStrategy: 'NOISY_LOGO' });
  });

  it('preserves valid VectorGroup nodes, source raster, dimensions and Undo/Redo', () => {
    const raster = createRasterNode({
      name: 'logo.png', src: 'data:image/png;base64,AA==', naturalWidth: 128, naturalHeight: 128,
      physicalWidth_mm: 50, physicalHeight_mm: 40, position_mm: { x: 10, y: 20 },
      mimeType: 'image/png', fileSize_bytes: 1, fileName: 'logo.png',
    });
    const vector = buildVectorGroupFromSvg({
      svgString: '<svg viewBox="0 0 128 128"><path d="M0 0 L128 0 L128 128 Z" fill="#000"/></svg>',
      sourceRasterNodeId: raster.id,
      name: `Vetor: ${raster.name}`,
      physicalWidth_mm: raster.physicalWidth_mm,
      physicalHeight_mm: raster.physicalHeight_mm,
      position_mm: raster.position_mm,
    });
    const command = new VectorizeCommand(vector.groupNode, vector.pathNodes, raster.id);
    const initial = addNode(createDocument({ width_mm: 100, height_mm: 100 }), raster);
    const executed = command.execute(initial);
    const undone = command.undo(executed.doc);
    const redone = command.execute(undone.doc);

    expect(vector.groupNode.sourceRasterNodeId).toBe(raster.id);
    expect(vector.groupNode.physicalWidth_mm).toBe(50);
    expect(vector.groupNode.physicalHeight_mm).toBe(40);
    expect(executed.doc.nodes[vector.groupNode.id]).toBeDefined();
    expect(undone.doc.nodes[vector.groupNode.id]).toBeUndefined();
    expect(redone.doc.nodes[vector.groupNode.id]).toBeDefined();
  });
});
