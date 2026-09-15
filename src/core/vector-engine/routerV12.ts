import type { VectorEngineFeatures, VectorEngineRoute } from './types';
export function routeVectorEngineV12({ cpoly, wramp }: VectorEngineFeatures): VectorEngineRoute {
  if (cpoly >= 80) return { backend:'REGION_GRAPH', preferredBackend:'REGION_GRAPH', requiresValidation:false };
  if (wramp <= 9.5) return { backend:'DIRECT_VECTO', preferredBackend:'DIRECT_VECTO', requiresValidation:false };
  return { backend:'ROUTE_UNCERTAIN', preferredBackend:'DIRECT_VECTO', requiresValidation:true };
}
