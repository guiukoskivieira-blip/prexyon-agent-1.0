/**
 * Prexyon Agent — Client Pre-Execution Module (Hotfix 7.6B.2)
 *
 * Executa exclusivamente as operações técnicas que demandam pixels raster no lado do cliente
 * (remoção de fundo, máscaras de separação DTF UV e vetorização VTracer) ANTES de sanitizar
 * o documento para transporte de rede.
 *
 * REGRA ARQUITETURAL:
 * O cliente NÃO realiza nenhuma interpretação semântica de medidas (mm/cm), largura, altura,
 * offset ou sangria. Todo o planejamento semântico é de responsabilidade exclusiva do backend.
 */

import { PrexyonDocument, DocumentNode, RasterNode, VectorGroupNode } from '../pdm/types';
import { ClientExecutionReceipt } from './types';
import { detectClientRasterIntents } from './planner/clientRasterClassifier';
import { getVTracerOptionsForPreset, type VectorizePresetId } from '../vectorizer/presets';
import { vtracerBridge as defaultVTracerBridge } from '../vectorizer/vtracerBridge';

export interface ClientPreExecutionOptions {
  selectedNodeId?: string | null;
  vtracerBridgeInstance?: {
    vectorizeRasterNode: (
      node: RasterNode,
      options?: any,
      requestedPreset?: VectorizePresetId
    ) => Promise<{ groupNode: VectorGroupNode; pathNodes: any[] }>;
  };
}

export interface ClientPreExecutionResult {
  doc: PrexyonDocument;
  receipts: ClientExecutionReceipt[];
}

/**
 * Executa as rotinas técnicas do cliente em imagens raster antes do transporte para o backend.
 */
export async function runClientPreExecution(
  message: string,
  doc: PrexyonDocument,
  options?: ClientPreExecutionOptions
): Promise<ClientPreExecutionResult> {
  let activeDoc = doc;
  const clientIntents = detectClientRasterIntents(message);
  const wantsCutOrVectorize = clientIntents.wantsCutOrVectorize;
  const wantsRemoveBg = clientIntents.wantsRemoveBg;
  const wantsWhiteUnderbase = clientIntents.wantsWhiteUnderbase;
  const wantsClearArtwork = clientIntents.wantsClearArtwork;

  const clientReceipts: ClientExecutionReceipt[] = [];
  const selectedNodeId = options?.selectedNodeId;
  const vtracer = options?.vtracerBridgeInstance || defaultVTracerBridge;

  // 1. Remoção de fundo no cliente se demandado e se houver imagem raster com base64
  if (wantsRemoveBg && activeDoc.nodes) {
    const nodes = Object.values(activeDoc.nodes) as DocumentNode[];
    const targetRaster = (selectedNodeId && activeDoc.nodes[selectedNodeId]?.type === 'raster_image'
      ? activeDoc.nodes[selectedNodeId]
      : nodes.find((n) => n && (n.type === 'raster_image' || (n as any).type === 'raster'))) as RasterNode | undefined;

    if (targetRaster && targetRaster.src && targetRaster.src.startsWith('data:')) {
      try {
        const { removeBackgroundTool } = await import('../tools/definitions/removeBackgroundTool');
        const bgRes = await removeBackgroundTool.execute(
          { sourceNodeId: targetRaster.id, colorTolerance: 25 },
          { doc: activeDoc, selectedNodeId: selectedNodeId || undefined }
        );
        if (bgRes.success && bgRes.doc) {
          activeDoc = bgRes.doc;
          clientReceipts.push({
            action: 'remove_background',
            status: 'success',
            sourceNodeId: targetRaster.id,
            timestamp: Date.now(),
          });
        }
      } catch (bgErr) {
        console.warn('Remoção de fundo local no cliente falhou:', bgErr);
      }
    }
  }

  // 2. Geração de máscara White Underbase para DTF UV no cliente
  if (wantsWhiteUnderbase && activeDoc.nodes) {
    try {
      const { generateWhiteUnderbaseMask } = await import('../dtf/whiteUnderbaseEngine');
      const whiteRes = generateWhiteUnderbaseMask(activeDoc, { dpi: 300 });
      if (whiteRes && whiteRes.separation) {
        activeDoc = {
          ...activeDoc,
          separations: {
            ...(activeDoc.separations || {}),
            white: whiteRes.separation,
          },
        };
        clientReceipts.push({
          action: 'generate_white_underbase',
          status: 'success',
          separationId: whiteRes.separation.id,
          timestamp: Date.now(),
        });
      }
    } catch (wErr) {
      console.warn('Geração local da base branca falhou:', wErr);
    }
  }

  // 3. Geração de máscara Clear ARTWORK para DTF UV no cliente
  if (wantsClearArtwork && activeDoc.nodes) {
    try {
      const { generateClearSeparationMask } = await import('../dtf/clearSeparationEngine');
      const clearRes = generateClearSeparationMask(activeDoc, { mode: 'ARTWORK', dpi: 300 });
      if (clearRes && clearRes.separation) {
        activeDoc = {
          ...activeDoc,
          separations: {
            ...(activeDoc.separations || {}),
            clear: clearRes.separation,
          },
        };
        clientReceipts.push({
          action: 'generate_clear_separation',
          status: 'success',
          separationId: clearRes.separation.id,
          timestamp: Date.now(),
        });
      }
    } catch (cErr) {
      console.warn('Geração local do verniz ARTWORK falhou:', cErr);
    }
  }

  // 4. Vetorização da imagem raster no cliente se demandado por faca/vetorização
  if (wantsCutOrVectorize && activeDoc.nodes) {
    const nodes = Object.values(activeDoc.nodes) as DocumentNode[];
    let targetRaster = (selectedNodeId && activeDoc.nodes[selectedNodeId]?.type === 'raster_image'
      ? activeDoc.nodes[selectedNodeId]
      : nodes.find((n) => n && (n.type === 'raster_image' || (n as any).type === 'raster'))) as RasterNode | undefined;

    if (targetRaster && targetRaster.src && targetRaster.src.startsWith('data:')) {
      const currentNodes = Object.values(activeDoc.nodes) as DocumentNode[];
      const existingGroup = currentNodes.find(
        (n) =>
          n &&
          (n.type === 'group' || (n as any).type === 'vector_group') &&
          ((n as any).sourceRasterNodeId === targetRaster!.id || n.name === `Vetor: ${targetRaster!.name}`)
      ) as VectorGroupNode | undefined;

      const isVectorFresh =
        existingGroup &&
        Math.abs(existingGroup.physicalWidth_mm - targetRaster.physicalWidth_mm) < 0.1 &&
        Math.abs(existingGroup.physicalHeight_mm - targetRaster.physicalHeight_mm) < 0.1 &&
        Math.abs((existingGroup.position_mm?.x ?? 0) - (targetRaster.position_mm?.x ?? 0)) < 0.1 &&
        Math.abs((existingGroup.position_mm?.y ?? 0) - (targetRaster.position_mm?.y ?? 0)) < 0.1;

      if (existingGroup && isVectorFresh) {
        clientReceipts.push({
          action: 'vectorize_raster',
          status: 'success',
          sourceNodeId: targetRaster.id,
          resultNodeId: existingGroup.id,
          timestamp: Date.now(),
          sourceGeometry: {
            physicalWidth_mm: targetRaster.physicalWidth_mm,
            physicalHeight_mm: targetRaster.physicalHeight_mm,
            x: targetRaster.position_mm?.x ?? 0,
            y: targetRaster.position_mm?.y ?? 0,
          },
        });
      } else {
        try {
          const options = getVTracerOptionsForPreset('logo');
          const vResult = await vtracer.vectorizeRasterNode(targetRaster, options, 'logo');
          const updatedNodes = { ...activeDoc.nodes };
          if (existingGroup && existingGroup.id) {
            delete updatedNodes[existingGroup.id];
          }
          updatedNodes[vResult.groupNode.id] = vResult.groupNode;
          for (const pNode of vResult.pathNodes) {
            updatedNodes[pNode.id] = pNode;
          }
          const filteredRootIds = activeDoc.rootNodeIds.filter((id) => id !== existingGroup?.id);
          activeDoc = {
            ...activeDoc,
            nodes: updatedNodes,
            rootNodeIds: [...filteredRootIds, vResult.groupNode.id],
          };
          clientReceipts.push({
            action: 'vectorize_raster',
            status: 'success',
            sourceNodeId: targetRaster.id,
            resultNodeId: vResult.groupNode.id,
            timestamp: Date.now(),
            sourceGeometry: {
              physicalWidth_mm: targetRaster.physicalWidth_mm,
              physicalHeight_mm: targetRaster.physicalHeight_mm,
              x: targetRaster.position_mm?.x ?? 0,
              y: targetRaster.position_mm?.y ?? 0,
            },
          });
        } catch (vErr) {
          console.warn('Vetorização local no cliente não pôde ser executada:', vErr);
        }
      }
    }
  }

  return {
    doc: activeDoc,
    receipts: clientReceipts,
  };
}
