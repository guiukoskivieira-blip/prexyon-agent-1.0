/**
 * Prexyon Agent — Testes da Etapa 6.7
 * Pacote Genérico Final de Produção para Adesivos (Print + Cut + Manifest JSON + ZIP)
 */

import { describe, expect, it, vi } from 'vitest';
import { createDocument, createRasterNode, addVectorGroup } from '../src/core/pdm/document';
import { buildVectorGroupFromSvg } from '../src/core/vectorizer/svgParser';
import { generateCutContour } from '../src/core/geometry/cutContourEngine';
import { createCutContourNode } from '../src/core/pdm/document';
import { PrexyonDocument, VectorGroupNode } from '../src/core/pdm/types';
import { GENERIC_STICKER_PROFILE, getProductionProfile } from '../src/core/production/profile';
import { validateDocumentForPackage } from '../src/core/production/package/packageValidator';
import { buildProductionPackage } from '../src/core/production/package/packageBuilder';
import { SimpleZipBuilder, computeCrc32 } from '../src/core/production/package/zipWriter';
import { defaultToolRegistry, executeTool } from '../src/core/tools';
import { processAgentChatRequest } from '../src/core/agent/server/chatEndpoint';
import { MockAIProvider } from '../src/core/agent/providers/mockProvider';
import { materializeAgentExports } from '../src/core/agent/clientExportMaterializer';
import { ExecutedToolRecord } from '../src/core/agent/types';

const SAMPLE_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQAAAADsdIMmAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAAB3YoTpAAAAAd0SU1FB+oJCwkwLq1bd4cAAAAPSURBVAjXY/jP0IgE/wMAKDAFBa2/+K0AAAAASUVORK5CYII=';

function createCompleteStickerDocument(options: {
  lowDpi?: boolean;
  withoutCutContour?: boolean;
} = {}): { doc: PrexyonDocument; rasterId: string; vectorGroupId: string; cutContourId?: string } {
  let doc = createDocument({ width_mm: 100, height_mm: 100 });

  // 1. Nó Raster (8x8 px -> se 40mm, dpi ~ 5.08 -> lowDpi; se 0.5mm, dpi ~ 406.4 -> highDpi)
  const physicalSize = options.lowDpi ? 40 : 0.5;
  const raster = createRasterNode({
    id: 'raster_sticker_logo',
    name: 'Logo Adesivo',
    src: SAMPLE_PNG_DATA_URL,
    naturalWidth: 8,
    naturalHeight: 8,
    physicalWidth_mm: physicalSize,
    physicalHeight_mm: physicalSize,
    position_mm: { x: 10, y: 10 },
    mimeType: 'image/png',
    fileName: 'logo.png',
  });

  doc = {
    ...doc,
    nodes: { ...doc.nodes, [raster.id]: raster },
    rootNodeIds: [...doc.rootNodeIds, raster.id],
  };

  // 2. Grupo Vetorial derivado
  const { groupNode, pathNodes } = buildVectorGroupFromSvg({
    svgString: '<svg viewBox="0 0 40 40"><path d="M 0 0 L 40 0 L 40 40 L 0 40 Z" fill="#FF5500"/></svg>',
    name: 'Vetor: Logo Adesivo',
    sourceRasterNodeId: raster.id,
    physicalWidth_mm: 40,
    physicalHeight_mm: 40,
    position_mm: { x: 10, y: 10 },
  });

  const vectorGroupId = 'group_vector_sticker_1';
  groupNode.id = vectorGroupId;
  doc = addVectorGroup(doc, groupNode, pathNodes);

  let cutContourId: string | undefined;

  // 3. Faca de corte (se solicitada)
  if (!options.withoutCutContour) {
    const group = doc.nodes[vectorGroupId] as VectorGroupNode;
    const cutResult = generateCutContour(group, doc, {
      offset_mm: 2.0,
      joinStyle: 'round',
      includeInnerContours: false,
    });

    const cutNode = createCutContourNode({
      name: `Faca: ${group.name}`,
      sourceNodeId: group.id,
      offset_mm: cutResult.offset_mm,
      joinStyle: cutResult.joinStyle,
      includeInnerContours: false,
      contours: cutResult.contours,
      physicalWidth_mm: cutResult.boundingBox_mm.width_mm,
      physicalHeight_mm: cutResult.boundingBox_mm.height_mm,
      position_mm: {
        x: cutResult.boundingBox_mm.minX,
        y: cutResult.boundingBox_mm.minY,
      },
      strokeWidth_mm: 0.3,
    });

    cutContourId = cutNode.id;
    doc = {
      ...doc,
      nodes: { ...doc.nodes, [cutNode.id]: cutNode },
      rootNodeIds: [...doc.rootNodeIds, cutNode.id],
    };
  }

  return { doc, rasterId: raster.id, vectorGroupId, cutContourId };
}

describe('Prexyon Agent — Etapa 6.7 — Pacote Final de Produção para Adesivos', () => {
  describe('1. Production Profile (Generic Sticker Profile)', () => {
    it('deve possuir o perfil genérico de adesivos configurado com unidade mm e offset 2.0mm', () => {
      const profile = getProductionProfile('generic-sticker');
      expect(profile).toBeDefined();
      expect(profile.id).toBe('generic-sticker');
      expect(profile.units).toBe('mm');
      expect(profile.cutContour.required).toBe(true);
      expect(profile.cutContour.defaultOffset_mm).toBe(2.0);
      expect(profile.printArtifact.format).toBe('png');
      expect(profile.cutArtifact.format).toBe('cut-svg');
      expect(profile.manifestArtifact.format).toBe('manifest-json');
      expect(profile.archiveArtifact.format).toBe('zip');
    });

    it('fallback seguro para perfis desconhecidos retorna o generic-sticker', () => {
      const profile = getProductionProfile('unsupported-profile');
      expect(profile.id).toBe('generic-sticker');
    });
  });

  describe('2. SimpleZipBuilder (PKZIP Zero-Dependency)', () => {
    it('deve gerar arquivo ZIP válido contendo arquivos de texto e binários', () => {
      const zip = new SimpleZipBuilder();
      zip.addFile('test.txt', 'Olá mundo!');
      zip.addFile('data.json', JSON.stringify({ ok: true }));

      const bytes = zip.buildUint8Array();
      expect(bytes.length).toBeGreaterThan(60);

      // Assinatura PKZIP Local File Header: 0x50, 0x4b, 0x03, 0x04
      expect(bytes[0]).toBe(0x50);
      expect(bytes[1]).toBe(0x4b);
      expect(bytes[2]).toBe(0x03);
      expect(bytes[3]).toBe(0x04);

      // CRC32 verification
      const crc = computeCrc32(new TextEncoder().encode('Olá mundo!'));
      expect(typeof crc).toBe('number');
      expect(crc).toBeGreaterThan(0);
    });
  });

  describe('3. Caso A — Pacote Válido (READY com todos os artefatos)', () => {
    it('deve gerar pacote com status READY, arte PNG, faca Cut-SVG, manifesto JSON e ZIP', async () => {
      const { doc } = createCompleteStickerDocument();
      const pkg = await buildProductionPackage(doc, { profileId: 'generic-sticker' });

      expect(pkg.status).toBe('READY');
      expect(pkg.validation.blockers).toHaveLength(0);
      expect(pkg.artifacts.length).toBe(3);

      const formats = pkg.artifacts.map((a) => a.format);
      expect(formats).toContain('png');
      expect(formats).toContain('cut-svg');
      expect(formats).toContain('manifest-json');

      expect(pkg.zipArtifact).toBeDefined();
      expect(pkg.zipArtifact?.format).toBe('zip');
      expect(pkg.zipArtifact?.fileName).toContain('-pacote-producao.zip');
    });
  });

  describe('4. Caso B — Ausência de Faca de Corte (BLOCKED)', () => {
    it('deve bloquear a liberação do pacote quando a faca de corte estiver ausente', async () => {
      const { doc } = createCompleteStickerDocument({ withoutCutContour: true });
      const pkg = await buildProductionPackage(doc, { profileId: 'generic-sticker' });

      expect(pkg.status).toBe('BLOCKED');
      expect(pkg.validation.blockers.length).toBeGreaterThan(0);
      expect(pkg.validation.blockers[0]).toContain('Faca de corte');
      expect(pkg.artifacts).toHaveLength(0);
    });

    it('a ferramenta create_production_package deve retornar erro estruturado quando bloqueada', async () => {
      const { doc } = createCompleteStickerDocument({ withoutCutContour: true });
      const result = await executeTool('create_production_package', {}, { doc });

      expect(result.success).toBe(false);
      expect((result as any).error.code).toBe('PACKAGE_VALIDATION_BLOCKED');
    });
  });

  describe('5. Caso C — Warning não crítico (READY_WITH_WARNINGS)', () => {
    it('deve retornar READY_WITH_WARNINGS quando houver imagens de baixa resolução', async () => {
      const { doc } = createCompleteStickerDocument({ lowDpi: true });
      const pkg = await buildProductionPackage(doc, { profileId: 'generic-sticker' });

      expect(pkg.status).toBe('READY_WITH_WARNINGS');
      expect(pkg.validation.blockers).toHaveLength(0);
      expect(pkg.validation.warnings.length).toBeGreaterThan(0);
      expect(pkg.validation.warnings[0]).toContain('DPI');
      expect(pkg.artifacts.length).toBe(3);
    });
  });

  describe('6. Caso D — Manifesto JSON Técnico', () => {
    it('o manifesto gerado deve ser um JSON válido e conter todos os metadados do pacote', async () => {
      const { doc } = createCompleteStickerDocument();
      const pkg = await buildProductionPackage(doc, { profileId: 'generic-sticker' });

      const manifestArtifact = pkg.artifacts.find((a) => a.format === 'manifest-json');
      expect(manifestArtifact).toBeDefined();
      expect(manifestArtifact?.dataString).toBeDefined();

      const parsed = JSON.parse(manifestArtifact!.dataString!);
      expect(parsed.manifestVersion).toBe('1.0.0');
      expect(parsed.profile.id).toBe('generic-sticker');
      expect(parsed.document.id).toBe(doc.id);
      expect(parsed.document.dimensions.width_mm).toBe(doc.dimensions.width_mm);
      expect(parsed.cutContour.present).toBe(true);
      expect(parsed.cutContour.offset_mm).toBe(2.0);
      expect(Array.isArray(parsed.artifacts)).toBe(true);
      expect(parsed.validation.status).toBe('READY');
    });
  });

  describe('7. Caso E — Cut-SVG Isolado', () => {
    it('o arquivo cut-svg gerado deve ser XML/SVG válido com traçado da faca', async () => {
      const { doc } = createCompleteStickerDocument();
      const pkg = await buildProductionPackage(doc, { profileId: 'generic-sticker' });

      const cutArtifact = pkg.artifacts.find((a) => a.format === 'cut-svg');
      expect(cutArtifact).toBeDefined();
      expect(cutArtifact?.dataString).toBeDefined();

      const svgStr = cutArtifact!.dataString!;
      expect(svgStr).toContain('<svg');
      expect(svgStr).toContain('</svg>');
      expect(svgStr).toContain('<path');
      expect(svgStr).toContain('stroke="');
      expect(svgStr).toContain('fill="none"');
      expect(svgStr).not.toContain('<image'); // Sem imagem na faca isolada
    });
  });

  describe('8. Caso F — Anti-alucinação e Tratamento de Erro no Chat', () => {
    it('o agente não declara pacote criado se a validação técnica do pacote falhar', async () => {
      const { doc } = createCompleteStickerDocument({ withoutCutContour: true });

      const provider = new MockAIProvider([
        {
          response: {
            functionCalls: [
              {
                name: 'create_production_package',
                args: { profileId: 'generic-sticker' },
              },
            ],
          },
        },
        {
          response: {
            text: 'Não foi possível gerar o pacote de produção pois a faca de corte é obrigatória e está ausente.',
            finishReason: 'STOP',
          },
        },
      ]);

      const result = await processAgentChatRequest(
        {
          message: 'Gere o pacote de produção.',
          doc,
        },
        provider
      );

      expect(result.success).toBe(false);
      expect(result.executedTools).toHaveLength(1);
      expect(result.executedTools[0].result.success).toBe(false);
      expect(result.reply).not.toContain('Pacote de produção preparado');
    });
  });

  describe('9. Caso G — Regressão 6.6 & Fluxo Completo de Adesivos no Chat', () => {
    it('quando o usuário pede "Prepare esse adesivo para produção com faca de 2 mm", executa faca + pacote na mesma solicitação', async () => {
      const { doc, rasterId, vectorGroupId } = createCompleteStickerDocument({ withoutCutContour: true });

      // Documento tem o vetor derivado da imagem, mas o raster continua selecionado
      const result = await processAgentChatRequest({
        message: 'Prepare esse adesivo para produção com faca de 2 mm.',
        doc,
        options: { selectedNodeId: rasterId },
      });

      expect(result.success).toBe(true);
      expect(result.executedTools.length).toBe(2);

      // Turn 1: create_cut_contour
      expect(result.executedTools[0].toolName).toBe('create_cut_contour');
      expect(result.executedTools[0].result.success).toBe(true);
      expect(result.executedTools[0].args.sourceNodeId).toBe(vectorGroupId);
      expect(result.executedTools[0].args.offset_mm).toBe(2);

      // Turn 2: create_production_package
      expect(result.executedTools[1].toolName).toBe('create_production_package');
      expect(result.executedTools[1].result.success).toBe(true);

      // Resposta limpa e sem código SVG/JSON bruto
      expect(result.reply).toContain('Pacote de produção preparado');
      expect(result.reply).not.toContain('<svg');
      expect(result.reply).not.toContain('{"manifestVersion"');
    });

    it('materializeAgentExports inicia downloads reais para o pacote de produção', async () => {
      const { doc } = createCompleteStickerDocument();
      const pkg = await buildProductionPackage(doc);

      const executedTools: ExecutedToolRecord[] = [
        {
          toolName: 'create_production_package',
          args: {},
          result: {
            success: true,
            message: 'Pacote pronto',
            data: pkg,
          },
        },
      ];

      const mockDownload = vi.fn().mockReturnValue(true);
      const materialized = await materializeAgentExports(executedTools, doc, {
        exportDocument: vi.fn(),
        downloadExportResult: mockDownload,
      });

      expect(materialized).toHaveLength(1);
      expect(materialized[0].fileName).toContain('-pacote-producao.zip');
      expect(mockDownload).toHaveBeenCalledTimes(1);
    });
  });
});
