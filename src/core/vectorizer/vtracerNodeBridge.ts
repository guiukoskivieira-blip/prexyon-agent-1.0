/**
 * Ponte exclusiva do backend para o VTracer.
 *
 * A distribuição Node decodifica PNG/JPG diretamente no WASM, evitando qualquer
 * dependência de Image, Canvas ou DOM no AgentRuntime executado pelo servidor.
 */
import { convertBuffer } from '@visioncortex/vtracer';
import { RasterNode } from '../pdm/types';
import { buildVectorGroupFromSvg } from './svgParser';
import { VectorizationResult } from './vtracerBridge';
import { VTracerOptions } from './vtracerWasmCore';

function decodeRasterDataUrl(src: string): Uint8Array {
  const commaIndex = src.indexOf(',');
  if (!src.startsWith('data:') || commaIndex < 0) {
    throw new Error('A imagem raster precisa estar incorporada como Data URL para vetorização no servidor.');
  }

  const metadata = src.slice(5, commaIndex);
  const payload = src.slice(commaIndex + 1);
  if (!payload) {
    throw new Error('A imagem raster incorporada não contém bytes para vetorização.');
  }

  if (!metadata.includes(';base64')) {
    return new TextEncoder().encode(decodeURIComponent(payload));
  }

  return new Uint8Array(Buffer.from(payload, 'base64'));
}

export const vtracerNodeBridge = {
  async vectorizeRasterNode(
    node: RasterNode,
    options: VTracerOptions = { mode: 'spline', clustering: 'color-cluster' }
  ): Promise<VectorizationResult> {
    const encodedBytes = decodeRasterDataUrl(node.src);
    const startedAt = performance.now();
    const svgString = convertBuffer(encodedBytes, options);
    const durationMs = Math.round(performance.now() - startedAt);

    const vectorGroup = buildVectorGroupFromSvg({
      svgString,
      sourceRasterNodeId: node.id,
      name: `Vetor: ${node.name}`,
      physicalWidth_mm: node.physicalWidth_mm,
      physicalHeight_mm: node.physicalHeight_mm,
      position_mm: { x: node.position_mm.x, y: node.position_mm.y },
      vectorizationTimeMs: durationMs,
      preset: options.mode ?? 'spline',
    });

    return {
      ...vectorGroup,
      svgString,
      durationMs,
    };
  },
};
