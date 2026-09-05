/**
 * Prexyon Document Model (PDM) - Abstração Arquitetural (Stub Etapa 1)
 *
 * REGRA ARQUITETURAL INVIOLÁVEL:
 * O Fabric.js NUNCA será a fonte da verdade do documento.
 * O PDM real será implementado a partir da Etapa 2 como a única fonte de dados da aplicação.
 * Este arquivo serve como documentação de tipos para garantir desacoplamento desde a Etapa 1.
 */

export type PhysicalUnit = 'mm' | 'pt' | 'in';

export interface PDMDocumentStub {
  version: '0.1.0';
  dimensions: {
    widthMm: number;
    heightMm: number;
    unit: PhysicalUnit;
  };
  // Objetos, vetores e facas serão formalizados a partir da Etapa 2
}
