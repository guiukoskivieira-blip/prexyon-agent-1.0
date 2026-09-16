/**
 * PRYX Vectorization Cache & Idempotency Layer
 *
 * Gerencia cache por SHA-256 da imagem + parâmetros e deduplicação de requisições concorrentes.
 */

import * as crypto from 'crypto';
import { VectorizationProviderResult, VectorizationOptions } from '../providers/types';

export function computeVectorizationHash(buffer: Uint8Array | Buffer, options?: VectorizationOptions): string {
  const hash = crypto.createHash('sha256');
  hash.update(buffer);
  if (options) {
    const canonicalOpts = {
      mode: options.mode || 'test',
      preset: options.preset || 'default',
      maxColors: options.maxColors || 0,
    };
    hash.update(JSON.stringify(canonicalOpts));
  }
  return hash.digest('hex');
}

export class VectorCacheManager {
  private cache: Map<string, VectorizationProviderResult> = new Map();
  private inFlightRequests: Map<string, Promise<VectorizationProviderResult>> = new Map();

  public get(key: string): VectorizationProviderResult | undefined {
    return this.cache.get(key);
  }

  public set(key: string, result: VectorizationProviderResult): void {
    this.cache.set(key, { ...result, cached: true });
  }

  public has(key: string): boolean {
    return this.cache.has(key);
  }

  public clear(): void {
    this.cache.clear();
    this.inFlightRequests.clear();
  }

  /**
   * Executa operação com deduplicação: se a mesma chave estiver em voo, reutiliza a Promise.
   */
  public async executeWithDeduplication(
    key: string,
    operation: () => Promise<VectorizationProviderResult>
  ): Promise<VectorizationProviderResult> {
    const cached = this.get(key);
    if (cached) {
      return { ...cached, cached: true };
    }

    const inFlight = this.inFlightRequests.get(key);
    if (inFlight) {
      return inFlight;
    }

    const promise = (async () => {
      try {
        const result = await operation();
        this.set(key, result);
        return result;
      } finally {
        this.inFlightRequests.delete(key);
      }
    })();

    this.inFlightRequests.set(key, promise);
    return promise;
  }
}

export const defaultVectorCache = new VectorCacheManager();
