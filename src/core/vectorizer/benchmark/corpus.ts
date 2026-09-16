/**
 * Prexyon Vectorization Engine V2 — Benchmark Corpus (Etapa V2.2)
 *
 * Manifesto estruturado contendo os 8 casos de teste representando
 * as categorias essenciais para avaliação rigorosa de motores de vetorização.
 */

import { RgbaBitmap, VectorBenchmarkCase } from './types';

/**
 * Utilitário determinístico para criação de bitmaps RGBA em memória.
 */
function createBlankBitmap(width: number, height: number, bgColor = [255, 255, 255, 255]): RgbaBitmap {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = bgColor[0];
    data[i + 1] = bgColor[1];
    data[i + 2] = bgColor[2];
    data[i + 3] = bgColor[3];
  }
  return { data, width, height };
}

function setPixel(bitmap: RgbaBitmap, x: number, y: number, r: number, g: number, b: number, a = 255): void {
  if (x < 0 || x >= bitmap.width || y < 0 || y >= bitmap.height) return;
  const idx = (y * bitmap.width + x) * 4;
  bitmap.data[idx] = r;
  bitmap.data[idx + 1] = g;
  bitmap.data[idx + 2] = b;
  bitmap.data[idx + 3] = a;
}

function drawFilledRect(
  bitmap: RgbaBitmap,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: [number, number, number, number?]
): void {
  const minX = Math.max(0, Math.min(x1, x2));
  const maxX = Math.min(bitmap.width - 1, Math.max(x1, x2));
  const minY = Math.max(0, Math.min(y1, y2));
  const maxY = Math.min(bitmap.height - 1, Math.max(y1, y2));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      setPixel(bitmap, x, y, color[0], color[1], color[2], color[3] ?? 255);
    }
  }
}

function drawFilledCircle(
  bitmap: RgbaBitmap,
  cx: number,
  cy: number,
  radius: number,
  color: [number, number, number, number?]
): void {
  const rSq = radius * radius;
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(bitmap.width - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(bitmap.height - 1, Math.ceil(cy + radius));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= rSq) {
        setPixel(bitmap, x, y, color[0], color[1], color[2], color[3] ?? 255);
      }
    }
  }
}

export const VECTOR_BENCHMARK_CORPUS: VectorBenchmarkCase[] = [
  // 1. LOGO_MONO_TYPOGRAPHY
  {
    id: 'CASE_01_LOGO_MONO_TYPOGRAPHY',
    category: 'LOGO_MONO_TYPOGRAPHY',
    name: 'Logo Monocromática com Tipografia e Furo',
    description: 'Glifo/letra com contorno externo contínuo e vazado interno fechado (letra O ou símbolo com furo).',
    source: 'synthetic',
    dimensions: { width: 128, height: 128, dpi: 300 },
    expectedColorCount: 1, // 1 cor de preenchimento (preto sobre fundo branco)
    expectedObjectCount: 1, // 1 objeto com compound path
    expectedHoleCount: 1, // 1 furo preservado
    referenceAvailable: false,
    notes: 'Valida se o motor preserva o vazado interno com fill-rule correto sem preencher o miolo de preto.',
    getBitmap: () => {
      const bmp = createBlankBitmap(128, 128);
      // Letra O: Círculo externo preto (raio 48), miolo interno branco (raio 24)
      drawFilledCircle(bmp, 64, 64, 48, [0, 0, 0]);
      drawFilledCircle(bmp, 64, 64, 24, [255, 255, 255]);
      return bmp;
    },
  },

  // 2. LOGO_GEOMETRIC
  {
    id: 'CASE_02_LOGO_GEOMETRIC',
    category: 'LOGO_GEOMETRIC',
    name: 'Logo Geométrica com Cantos Vivos (45° e 90°)',
    description: 'Formas geométricas com retas ortogonais, vértices retos e losango rotacionado a 45°.',
    source: 'synthetic',
    dimensions: { width: 128, height: 128, dpi: 300 },
    expectedColorCount: 1,
    expectedObjectCount: 2,
    expectedHoleCount: 0,
    referenceAvailable: false,
    notes: 'Valida se o motor mantém cantos vivos de 90° e retas limpas em vez de curvas onduladas.',
    getBitmap: () => {
      const bmp = createBlankBitmap(128, 128);
      // Retângulo ortogonal
      drawFilledRect(bmp, 16, 16, 60, 112, [0, 0, 0]);
      // Losango (canto a 45°)
      for (let y = 16; y <= 112; y++) {
        for (let x = 68; x <= 112; x++) {
          const dx = Math.abs(x - 90);
          const dy = Math.abs(y - 64);
          if (dx + dy <= 22) {
            setPixel(bmp, x, y, 0, 0, 0);
          }
        }
      }
      return bmp;
    },
  },

  // 3. LOGO_MULTICOLOR
  {
    id: 'CASE_03_LOGO_MULTICOLOR',
    category: 'LOGO_MULTICOLOR',
    name: 'Logo Multicolorida (3 Cores Sólidas Planas)',
    description: 'Emblema composto por 3 regiões de cores planas puras sem gradientes (Vermelho, Azul, Amarelo).',
    source: 'synthetic',
    dimensions: { width: 128, height: 128, dpi: 300 },
    expectedColorCount: 3,
    expectedObjectCount: 3,
    expectedHoleCount: 0,
    referenceAvailable: false,
    notes: 'Valida a separação precisa por cor e a ausência de cores fantasmas/intermediárias nas fronteiras.',
    getBitmap: () => {
      const bmp = createBlankBitmap(128, 128);
      // Vermelho #E11D48
      drawFilledCircle(bmp, 44, 44, 30, [225, 29, 72]);
      // Azul #2563EB
      drawFilledCircle(bmp, 84, 44, 30, [37, 99, 235]);
      // Amarelo #F59E0B
      drawFilledCircle(bmp, 64, 84, 30, [245, 158, 11]);
      return bmp;
    },
  },

  // 4. LOGO_JPEG_NOISY
  {
    id: 'CASE_04_LOGO_JPEG_NOISY',
    category: 'LOGO_JPEG_NOISY',
    name: 'Logo com Ruído de Compressão JPEG / WhatsApp',
    description: 'Logo monocromática de alto contraste degradada com artefatos de compressão e ruído de borda.',
    source: 'synthetic',
    dimensions: { width: 128, height: 128, dpi: 300 },
    expectedColorCount: 1,
    expectedObjectCount: 1,
    expectedHoleCount: 0,
    referenceAvailable: false,
    notes: 'Valida se o motor sofre com micro-polígonos parasitas e serrilhado em imagens de baixa qualidade.',
    getBitmap: () => {
      const bmp = createBlankBitmap(128, 128);
      // Forma principal
      drawFilledCircle(bmp, 64, 64, 40, [20, 20, 20]);
      // Adiciona ruído de compressão simulado ao redor da borda (ringing JPEG)
      for (let y = 10; y < 118; y++) {
        for (let x = 10; x < 118; x++) {
          const dist = Math.hypot(x - 64, y - 64);
          if (dist >= 36 && dist <= 46) {
            const noise = ((x * 17 + y * 31) % 43) - 21;
            const current = dist <= 40 ? 20 : 255;
            const val = Math.max(0, Math.min(255, current + noise * 4));
            setPixel(bmp, x, y, val, val, val);
          }
        }
      }
      return bmp;
    },
  },

  // 5. LOGO_FINE_DETAILS
  {
    id: 'CASE_05_LOGO_FINE_DETAILS',
    category: 'LOGO_FINE_DETAILS',
    name: 'Logo com Linhas Finas e Detalhes Pequenos (Hairlines)',
    description: 'Linhas de 1 a 2 pixels de espessura e pequenas cruzes geométricas de precisão.',
    source: 'synthetic',
    dimensions: { width: 128, height: 128, dpi: 300 },
    expectedColorCount: 1,
    expectedObjectCount: 3,
    expectedHoleCount: 0,
    referenceAvailable: false,
    notes: 'Valida a capacidade do motor de não eliminar nem quebrar traços finos (hairlines < 0.5 mm).',
    getBitmap: () => {
      const bmp = createBlankBitmap(128, 128);
      // Linha horizontal fina (1px)
      drawFilledRect(bmp, 16, 64, 112, 64, [0, 0, 0]);
      // Linha vertical fina (1px)
      drawFilledRect(bmp, 64, 16, 64, 112, [0, 0, 0]);
      // Círculo fino externo (espessura 2px)
      for (let y = 0; y < 128; y++) {
        for (let x = 0; x < 128; x++) {
          const d = Math.hypot(x - 64, y - 64);
          if (d >= 48 && d <= 50) {
            setPixel(bmp, x, y, 0, 0, 0);
          }
        }
      }
      return bmp;
    },
  },

  // 6. GRAPHIC_ART_FLAT
  {
    id: 'CASE_06_GRAPHIC_ART_FLAT',
    category: 'GRAPHIC_ART_FLAT',
    name: 'Ilustração Vetorial com 6 Cores Planas',
    description: 'Composição gráfica estilo sticker com múltiplos blocos de cor (mascote / badge gráfico).',
    source: 'synthetic',
    dimensions: { width: 128, height: 128, dpi: 300 },
    expectedColorCount: 6,
    expectedObjectCount: 6,
    expectedHoleCount: 0,
    referenceAvailable: false,
    notes: 'Valida a fidelidade de cores e contornos em arte gráfica intermediária.',
    getBitmap: () => {
      const bmp = createBlankBitmap(128, 128);
      // Camada 1: Fundo verde escuro #059669
      drawFilledCircle(bmp, 64, 64, 52, [5, 150, 105]);
      // Camada 2: Miolo ciano #06B6D4
      drawFilledCircle(bmp, 64, 64, 40, [6, 182, 212]);
      // Camada 3: Quadrado roxo #7C3AED
      drawFilledRect(bmp, 44, 44, 84, 84, [124, 58, 237]);
      // Camada 4: Círculo laranja #EA580C
      drawFilledCircle(bmp, 64, 64, 16, [234, 88, 12]);
      // Camada 5: Detalhe amarelo #EAB308
      drawFilledRect(bmp, 60, 60, 68, 68, [234, 179, 8]);
      // Camada 6: Ponto preto central #000000
      drawFilledCircle(bmp, 64, 64, 4, [0, 0, 0]);
      return bmp;
    },
  },

  // 7. GRAPHIC_ART_SHADED
  {
    id: 'CASE_07_GRAPHIC_ART_SHADED',
    category: 'GRAPHIC_ART_SHADED',
    name: 'Arte com Sombreamento em Camadas Posterizadas',
    description: 'Esfera com iluminação modelada em 4 níveis de sombra/luz (faixas de cor posterizadas).',
    source: 'synthetic',
    dimensions: { width: 128, height: 128, dpi: 300 },
    expectedColorCount: 4,
    expectedObjectCount: 4,
    expectedHoleCount: 0,
    referenceAvailable: false,
    notes: 'Valida como o motor se comporta com gradientes posterizados e curvas de sombra.',
    getBitmap: () => {
      const bmp = createBlankBitmap(128, 128);
      // Base da esfera (sombra escura #1E1B4B)
      drawFilledCircle(bmp, 64, 64, 48, [30, 27, 75]);
      // Meia luz (#4338CA)
      drawFilledCircle(bmp, 58, 58, 38, [67, 56, 202]);
      // Luz média (#6366F1)
      drawFilledCircle(bmp, 52, 52, 26, [99, 102, 241]);
      // Brilho especular (#A5B4FC)
      drawFilledCircle(bmp, 46, 46, 12, [165, 180, 252]);
      return bmp;
    },
  },

  // 8. COMPLEX_BADGE
  {
    id: 'CASE_08_COMPLEX_BADGE',
    category: 'COMPLEX_BADGE',
    name: 'Badge / Brasão Complexo com Ornamentos e Textos',
    description: 'Emblema circular com anéis concêntricos, múltiplos dentes de engrenagem e estrela central.',
    source: 'synthetic',
    dimensions: { width: 128, height: 128, dpi: 300 },
    expectedColorCount: 2,
    expectedObjectCount: 8,
    expectedHoleCount: 2,
    referenceAvailable: false,
    notes: 'Valida a capacidade de processamento de artes com alta densidade de detalhes e múltiplos caminhos.',
    getBitmap: () => {
      const bmp = createBlankBitmap(128, 128);
      // Anel externo com dentes de engrenagem (12 dentes)
      for (let i = 0; i < 12; i++) {
        const angle = (i * Math.PI * 2) / 12;
        const tx = 64 + Math.cos(angle) * 52;
        const ty = 64 + Math.sin(angle) * 52;
        drawFilledCircle(bmp, tx, ty, 8, [15, 23, 42]);
      }
      // Anel principal preto
      drawFilledCircle(bmp, 64, 64, 48, [15, 23, 42]);
      // Anel interno branco
      drawFilledCircle(bmp, 64, 64, 40, [255, 255, 255]);
      // Círculo central azul escuro #1E3A8A
      drawFilledCircle(bmp, 64, 64, 32, [30, 58, 138]);
      // Estrela central de 4 pontas branca
      for (let y = 48; y <= 80; y++) {
        for (let x = 48; x <= 80; x++) {
          const dx = Math.abs(x - 64);
          const dy = Math.abs(y - 64);
          if (dx * dy <= 12 && dx + dy <= 18) {
            setPixel(bmp, x, y, 255, 255, 255);
          }
        }
      }
      return bmp;
    },
  },
];
