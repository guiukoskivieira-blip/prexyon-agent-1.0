/**
 * Prexyon VTracer Web Worker
 *
 * Executa a vetorização em uma thread isolada para manter a UI 100% fluida e responsiva.
 */

import { VTracerWasmInstance, VTracerOptions } from '../vectorizer/vtracerWasmCore';

const wasmInstance = new VTracerWasmInstance();
let isInitialized = false;

export interface VectorizeWorkerRequest {
  type: 'VECTORIZE';
  id: string;
  rgba: Uint8Array;
  width: number;
  height: number;
  options: VTracerOptions;
  wasmUrl: string;
}

export interface VectorizeWorkerResponse {
  type: 'SUCCESS' | 'ERROR';
  id: string;
  svg?: string;
  durationMs?: number;
  error?: string;
}

self.onmessage = async (e: MessageEvent<VectorizeWorkerRequest>) => {
  const data = e.data;
  if (!data || data.type !== 'VECTORIZE') return;

  const startTime = performance.now();

  try {
    if (!isInitialized) {
      const response = await fetch(data.wasmUrl);
      if (!response.ok) {
        throw new Error(`Falha ao carregar binário WASM do VTracer (${response.statusText}).`);
      }
      const wasmBuffer = await response.arrayBuffer();
      await wasmInstance.init(wasmBuffer);
      isInitialized = true;
    }

    const svg = wasmInstance.vectorizeRgba(
      data.rgba,
      data.width,
      data.height,
      data.options
    );

    const durationMs = Math.round(performance.now() - startTime);

    self.postMessage({
      type: 'SUCCESS',
      id: data.id,
      svg,
      durationMs,
    } as VectorizeWorkerResponse);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Erro desconhecido na vetorização WASM.';
    self.postMessage({
      type: 'ERROR',
      id: data.id,
      error: errorMsg,
    } as VectorizeWorkerResponse);
  }
};
