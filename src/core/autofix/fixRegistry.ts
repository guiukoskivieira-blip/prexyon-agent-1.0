/**
 * Prexyon Agent — Fix Registry (Etapa 6.9)
 *
 * Registro determinístico que conecta explicitamente cada código de problema
 * a uma ferramenta real existente no ToolRegistry, com parâmetros estritos e seguros.
 * 
 * Regra Arquitetural: O LLM NÃO inventa ferramentas ou parâmetros.
 * O FixRegistry dita o mapeamento: Issue -> Fix -> Tool -> Parâmetros Validados.
 */

import { PrexyonDocument } from '../pdm/types';
import { PrepressIssue, PrepressIssueCode, AutoFixPlanItem, FixClassification } from './types';

export interface FixDefinition {
  /** Código da issue tratada por este fix */
  issueCode: PrepressIssueCode;

  /** Nome da ferramenta real registrada no ToolRegistry */
  toolName: string;

  /** Classificação de segurança do fix */
  classification: FixClassification;

  /** Título legível do fix */
  title: string;

  /** Descrição detalhada da operação executada */
  description: string;

  /**
   * Valida se os pré-requisitos técnicos no documento estão atendidos antes da execução.
   */
  canApply(issue: PrepressIssue, doc: PrexyonDocument): boolean;

  /**
   * Resolve os parâmetros exatos e seguros a serem enviados para a ferramenta.
   */
  resolveParameters(issue: PrepressIssue, doc: PrexyonDocument): Record<string, unknown>;
}

export class FixRegistry {
  private fixes: Map<PrepressIssueCode, FixDefinition> = new Map();

  constructor(initialFixes: FixDefinition[] = []) {
    for (const fix of initialFixes) {
      this.register(fix);
    }
  }

  public register(fix: FixDefinition): void {
    this.fixes.set(fix.issueCode, fix);
  }

  public getFix(code: PrepressIssueCode): FixDefinition | undefined {
    return this.fixes.get(code);
  }

  public getAllFixes(): FixDefinition[] {
    return Array.from(this.fixes.values());
  }

  public isAutoFixable(issue: PrepressIssue, doc: PrexyonDocument): boolean {
    if (issue.fixClassification !== 'AUTO_FIXABLE') return false;
    const fix = this.getFix(issue.code);
    if (!fix) return false;
    if (fix.classification !== 'AUTO_FIXABLE') return false;
    return fix.canApply(issue, doc);
  }

  /**
   * Converte uma issue em um item executável do plano de auto-fix.
   */
  public createPlanItem(issue: PrepressIssue, doc: PrexyonDocument): AutoFixPlanItem | null {
    const fix = this.getFix(issue.code);
    if (!fix || !fix.canApply(issue, doc)) return null;

    const parameters = fix.resolveParameters(issue, doc);
    const fixId = `fix_${issue.code.toLowerCase()}_${issue.affectedNodeId || 'doc'}_${Date.now()}`;

    return {
      fixId,
      issue,
      toolName: fix.toolName,
      parameters,
      targetNodeId: issue.affectedNodeId,
      safetyLevel: fix.classification === 'AUTO_FIXABLE' ? 'AUTO_FIXABLE' : 'REQUIRES_CONFIRMATION',
      description: fix.description,
    };
  }
}

/**
 * Fix 1: Faca Ausente (MISSING_CUT_CONTOUR -> create_cut_contour)
 */
export const missingCutContourFix: FixDefinition = {
  issueCode: 'MISSING_CUT_CONTOUR',
  toolName: 'create_cut_contour',
  classification: 'AUTO_FIXABLE',
  title: 'Adicionar Faca de Corte Automática',
  description: 'Gera um contorno de corte externo com offset padrão seguro de 2.0 mm.',
  canApply(issue, doc) {
    if (!issue.affectedNodeId) return false;
    const node = doc.nodes[issue.affectedNodeId];
    return !!node && (node.type === 'group' || !!(node as any).vectorTwinId);
  },
  resolveParameters(issue) {
    const requestedOffset = (issue.suggestedParams?.offset_mm as number) ?? 2.0;
    const safeOffset = Math.min(Math.max(requestedOffset, 0.5), 10.0);
    const joinStyle = (issue.suggestedParams?.joinStyle as string) || 'round';

    return {
      sourceNodeId: issue.affectedNodeId,
      offset_mm: safeOffset,
      joinStyle: joinStyle,
      includeInnerContours: false,
    };
  },
};

/**
 * Fix 2: Faca Desalinhada (CUT_CONTOUR_MISALIGNED -> center_cut_contour)
 */
export const misalignedCutContourFix: FixDefinition = {
  issueCode: 'CUT_CONTOUR_MISALIGNED',
  toolName: 'center_cut_contour',
  classification: 'AUTO_FIXABLE',
  title: 'Centralizar Faca de Corte',
  description: 'Alinha geometricamente a faca de corte sobre o centro do seu vetor de origem.',
  canApply(issue, doc) {
    if (!issue.affectedNodeId) return false;
    const node = doc.nodes[issue.affectedNodeId];
    return !!node && node.type === 'cut_contour';
  },
  resolveParameters(issue) {
    return {
      nodeId: issue.affectedNodeId,
    };
  },
};

/**
 * Fix 3: Objetos Vetoriais Invisíveis (INVISIBLE_VECTOR_OBJECT -> remove_invisible_vector_objects)
 */
export const removeInvisibleVectorObjectsFix: FixDefinition = {
  issueCode: 'INVISIBLE_VECTOR_OBJECT',
  toolName: 'remove_invisible_vector_objects',
  classification: 'AUTO_FIXABLE',
  title: 'Remover Objetos Vetoriais Invisíveis',
  description: 'Remove do documento elementos e traçados vetoriais tecnicamente invisíveis (sem cor, sem traço ou vazios).',
  canApply(issue, doc) {
    if (issue.affectedNodeId) {
      return !!doc.nodes[issue.affectedNodeId];
    }
    return Object.values(doc.nodes || {}).some((n) => n.type === 'vector_path');
  },
  resolveParameters(issue) {
    return {
      targetNodeId: issue.affectedNodeId,
      removeEmptyGroups: true,
    };
  },
};

/**
 * Fix 4: Faca de Corte Aberta (CUT_CONTOUR_OPEN -> close_cut_contour)
 */
export const closeCutContourFix: FixDefinition = {
  issueCode: 'CUT_CONTOUR_OPEN',
  toolName: 'close_cut_contour',
  classification: 'AUTO_FIXABLE',
  title: 'Fechar Faca de Corte Aberta',
  description: 'Fecha o contorno da faca de corte conectando as extremidades abertas.',
  canApply(issue, doc) {
    if (!issue.affectedNodeId) return false;
    const node = doc.nodes[issue.affectedNodeId];
    return !!node && node.type === 'cut_contour';
  },
  resolveParameters(issue) {
    const maxGap = (issue.suggestedParams?.maxGap_mm as number) || 0.5;
    return {
      nodeId: issue.affectedNodeId,
      maxGap_mm: maxGap,
    };
  },
};

/**
 * Fix 5: Pontos Duplicados Consecutivos (DUPLICATE_VECTOR_POINT -> remove_redundant_vector_points)
 */
export const duplicateVectorPointFix: FixDefinition = {
  issueCode: 'DUPLICATE_VECTOR_POINT',
  toolName: 'remove_redundant_vector_points',
  classification: 'AUTO_FIXABLE',
  title: 'Remover Pontos Duplicados do Vetor',
  description: 'Remove pontos geométricos idênticos e consecutivos sem alterar o contorno da arte.',
  canApply(issue, doc) {
    if (!issue.affectedNodeId) return false;
    const node = doc.nodes[issue.affectedNodeId];
    return !!node && (node.type === 'vector_path' || node.type === 'group');
  },
  resolveParameters(issue) {
    return {
      nodeId: issue.affectedNodeId,
    };
  },
};

/**
 * Fix 6: Segmentos de Comprimento Zero (ZERO_LENGTH_SEGMENT -> remove_redundant_vector_points)
 */
export const zeroLengthSegmentFix: FixDefinition = {
  issueCode: 'ZERO_LENGTH_SEGMENT',
  toolName: 'remove_redundant_vector_points',
  classification: 'AUTO_FIXABLE',
  title: 'Remover Segmentos de Comprimento Zero',
  description: 'Remove segmentos nulos sem deslocamento no caminho vetorial.',
  canApply(issue, doc) {
    if (!issue.affectedNodeId) return false;
    const node = doc.nodes[issue.affectedNodeId];
    return !!node && (node.type === 'vector_path' || node.type === 'group');
  },
  resolveParameters(issue) {
    return {
      nodeId: issue.affectedNodeId,
    };
  },
};

/**
 * Fix 7: Pontos Colineares Redundantes (REDUNDANT_COLLINEAR_POINT -> remove_redundant_vector_points)
 */
export const redundantCollinearPointFix: FixDefinition = {
  issueCode: 'REDUNDANT_COLLINEAR_POINT',
  toolName: 'remove_redundant_vector_points',
  classification: 'AUTO_FIXABLE',
  title: 'Remover Pontos Colineares Redundantes',
  description: 'Remove nós intermediários em segmentos retos dentro da tolerância técnica.',
  canApply(issue, doc) {
    if (!issue.affectedNodeId) return false;
    const node = doc.nodes[issue.affectedNodeId];
    return !!node && (node.type === 'vector_path' || node.type === 'group');
  },
  resolveParameters(issue) {
    return {
      nodeId: issue.affectedNodeId,
      collinearToleranceMm: (issue.suggestedParams?.collinearToleranceMm as number) ?? 0.005,
    };
  },
};

/**
 * Instância padrão global do FixRegistry com todos os fixes homologados.
 */
export const defaultFixRegistry = new FixRegistry([
  missingCutContourFix,
  misalignedCutContourFix,
  removeInvisibleVectorObjectsFix,
  closeCutContourFix,
  duplicateVectorPointFix,
  zeroLengthSegmentFix,
  redundantCollinearPointFix,
]);

