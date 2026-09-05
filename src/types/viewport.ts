/**
 * Viewport Types - Etapa 1
 * Define propriedades exclusivas da camada de visualização/interação.
 * NÃO contém regras de negócio ou modelo definitivo de documento.
 */

export interface ArtboardConfig {
  /** Largura física nominal da prancheta em milímetros */
  widthMm: number;
  /** Altura física nominal da prancheta em milímetros */
  heightMm: number;
  /** DPI de referência para cálculo da escala de tela */
  dpi: number;
  /** Cor de fundo da prancheta */
  backgroundColor: string;
}

export interface ViewportState {
  /** Fator de zoom atual (1.0 = 100%) */
  zoom: number;
  /** Posição X do pan do canvas em pixels */
  panX: number;
  /** Posição Y do pan do canvas em pixels */
  panY: number;
  /** Coordenadas atuais do cursor do mouse em milímetros relativos à prancheta */
  cursorMm: { x: number; y: number } | null;
}
