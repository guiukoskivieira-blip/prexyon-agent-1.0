/**
 * Prexyon Agent — Tool Execution Receipt Builder (Etapa 6.8)
 *
 * Constrói recibos tipados e estruturados de evidência para cada ferramenta executada pelo agente.
 * Totalmente isolado de tokens, prompts internos ou logs de raciocínio da IA.
 */

import { ExecutedToolRecord } from '../../agent/types';
import { PrexyonDocument } from '../../pdm/types';
import { ToolExecutionReceipt } from './types';

export function buildToolExecutionReceipt(
  record: ExecutedToolRecord,
  beforeDoc?: PrexyonDocument,
  afterDoc?: PrexyonDocument
): ToolExecutionReceipt {
  const toolName = record.toolName;
  const res = record.result as any;
  const isSuccess = Boolean(res?.success);
  const args = (record.args || {}) as Record<string, unknown>;
  const resData = (res?.data || {}) as Record<string, unknown>;

  const receiptId = `receipt_${toolName}_${record.timestamp || Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

  let title = 'Operação de Ferramenta';
  let summary = res?.message || (res?.error?.message ? `Erro: ${res.error.message}` : 'Operação executada.');
  const affectedNodeIds: string[] = [];
  const affectedNodeNames: string[] = [];
  const warnings: string[] = [];
  const evidence: ToolExecutionReceipt['evidence'] = {};

  const docForNames = afterDoc || beforeDoc;

  const resolveNodeName = (id: string): string => {
    if (docForNames?.nodes?.[id]?.name) return docForNames.nodes[id].name;
    return id;
  };

  switch (toolName) {
    case 'create_cut_contour': {
      title = 'Criação de Faca de Corte';
      const offset = Number(args.offset_mm ?? resData.offset_mm ?? 2.0);
      const sourceId = String(args.sourceNodeId || resData.sourceNodeId || '');
      const cutId = String(resData.cutContourNodeId || '');

      if (sourceId) {
        affectedNodeIds.push(sourceId);
        affectedNodeNames.push(resolveNodeName(sourceId));
      }
      if (cutId && cutId !== sourceId) {
        affectedNodeIds.push(cutId);
        affectedNodeNames.push(resolveNodeName(cutId));
      }

      evidence.offset_mm = offset;
      evidence.contoursCount = Number(resData.contoursCount ?? 1);

      if (isSuccess) {
        summary = `Faca de corte criada com ${offset} mm de offset externo em volta do objeto selecionado.`;
      } else {
        summary = `Falha ao criar faca de corte: ${res?.error?.message || 'Erro desconhecido'}`;
      }
      break;
    }

    case 'create_production_package': {
      title = 'Pacote Final de Produção';
      const pkg = resData as any;
      const profileName = pkg?.profile?.name || 'Perfil Genérico de Adesivos';
      const status = pkg?.status || (isSuccess ? 'READY' : 'BLOCKED');
      const artifacts = Array.isArray(pkg?.artifacts) ? pkg.artifacts : [];

      evidence.packageStatus = status;
      evidence.artifactsCount = artifacts.length + (pkg?.zipArtifact ? 1 : 0);
      if (pkg?.dimensions_mm) {
        evidence.dimensions_mm = {
          width_mm: pkg.dimensions_mm.width_mm,
          height_mm: pkg.dimensions_mm.height_mm,
        };
      }

      if (Array.isArray(pkg?.validation?.warnings)) {
        warnings.push(...pkg.validation.warnings);
      }

      if (isSuccess) {
        const fileNames = artifacts.map((a: any) => a.fileName).join(', ');
        summary = `Pacote de produção preparado com sucesso (${profileName}). Artefatos gerados: ${fileNames}${pkg?.zipArtifact ? ` e ${pkg.zipArtifact.fileName}` : ''}.`;
      } else {
        summary = `Pacote de produção bloqueado por inconsistências técnicas: ${res?.error?.message || 'Verifique as regras de pré-impressão.'}`;
      }
      break;
    }

    case 'vectorize_raster': {
      title = 'Vetorização de Imagem';
      const nodeId = String(args.nodeId || args.node_id || '');
      if (nodeId) {
        affectedNodeIds.push(nodeId);
        affectedNodeNames.push(resolveNodeName(nodeId));
      }
      if (resData.createdGroupNodeId) {
        const gid = String(resData.createdGroupNodeId);
        affectedNodeIds.push(gid);
        affectedNodeNames.push(resolveNodeName(gid));
      }
      summary = isSuccess
        ? `Imagem raster convertida em caminhos vetoriais com preset "${args.preset || 'logo'}".`
        : `Falha na vetorização: ${res?.error?.message || 'Erro'}`;
      break;
    }

    case 'move_node': {
      title = 'Movimentação de Objeto';
      const nodeId = String(args.nodeId || '');
      if (nodeId) {
        affectedNodeIds.push(nodeId);
        affectedNodeNames.push(resolveNodeName(nodeId));
      }
      const coords = [];
      if (args.x_mm !== undefined) coords.push(`X = ${args.x_mm} mm`);
      if (args.y_mm !== undefined) coords.push(`Y = ${args.y_mm} mm`);
      if (args.deltaX_mm !== undefined) coords.push(`ΔX = ${args.deltaX_mm} mm`);
      if (args.deltaY_mm !== undefined) coords.push(`ΔY = ${args.deltaY_mm} mm`);
      summary = `Objeto posicionado em ${coords.join(', ')}.`;
      break;
    }

    case 'resize_node': {
      title = 'Redimensionamento de Objeto';
      const nodeId = String(args.nodeId || '');
      if (nodeId) {
        affectedNodeIds.push(nodeId);
        affectedNodeNames.push(resolveNodeName(nodeId));
      }
      summary = `Dimensões alteradas para ${args.width_mm || 'auto'} x ${args.height_mm || 'auto'} mm.`;
      break;
    }

    case 'update_cut_contour': {
      title = 'Atualização de Faca de Corte';
      const cutId = String(args.cutContourNodeId || '');
      if (cutId) {
        affectedNodeIds.push(cutId);
        affectedNodeNames.push(resolveNodeName(cutId));
      }
      summary = `Parâmetros da faca recalculados com sucesso.`;
      break;
    }

    case 'center_cut_contour': {
      title = 'Centralização de Faca de Corte';
      const cutId = String(args.cutContourNodeId || '');
      if (cutId) {
        affectedNodeIds.push(cutId);
        affectedNodeNames.push(resolveNodeName(cutId));
      }
      summary = `Faca de corte perfeitamente alinhada e centrada sobre a arte de origem.`;
      break;
    }

    case 'validate_production': {
      title = 'Validação de Pré-impressão';
      summary = isSuccess ? 'Documento auditado contra regras técnicas de produção.' : 'Falha na validação.';
      break;
    }

    case 'export_production': {
      title = 'Exportação de Artefato';
      const fmt = String(args.format || '').toUpperCase();
      summary = isSuccess ? `Arquivo de produção no formato ${fmt} gerado para download.` : 'Falha na exportação.';
      break;
    }

    default: {
      title = `Execução: ${toolName}`;
      summary = res?.message || 'Ferramenta executada.';
    }
  }

  let status: ToolExecutionReceipt['status'] = isSuccess ? 'success' : 'failure';
  if (isSuccess && warnings.length > 0) {
    status = 'warning';
  }

  return {
    id: receiptId,
    toolName,
    timestamp: record.timestamp || Date.now(),
    status,
    title,
    summary,
    affectedNodeIds,
    affectedNodeNames,
    parameters: args,
    resultData: resData,
    warnings: warnings.length > 0 ? warnings : undefined,
    error: res?.error
      ? {
          code: res.error.code || 'ERROR',
          message: res.error.message || 'Erro de execução',
        }
      : undefined,
    evidence,
  };
}
