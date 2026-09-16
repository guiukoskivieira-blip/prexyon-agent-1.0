/**
 * PRYX Vectorization Providers Registry & Factory
 *
 * Exporta contratos e instâncias de provedores de vetorização suportados.
 */

export * from './types';
export * from './vectorizerAiProvider';

import { VectorizationProvider } from './types';
import { VectorizerAIProvider } from './vectorizerAiProvider';

const providersRegistry = new Map<string, VectorizationProvider>();

// Registra provider oficial do Vectorizer.AI
const vectorizerAiInstance = new VectorizerAIProvider();
providersRegistry.set(vectorizerAiInstance.id, vectorizerAiInstance);

export function getVectorizationProvider(id: string = 'vectorizer_ai'): VectorizationProvider {
  const provider = providersRegistry.get(id);
  if (!provider) {
    throw new Error(`Provedor de vetorização "${id}" não está registrado.`);
  }
  return provider;
}

export function registerVectorizationProvider(provider: VectorizationProvider): void {
  providersRegistry.set(provider.id, provider);
}

export function listRegisteredProviders(): string[] {
  return Array.from(providersRegistry.keys());
}
