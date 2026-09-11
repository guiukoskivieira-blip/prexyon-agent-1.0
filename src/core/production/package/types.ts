/**
 * Prexyon Agent — Production Package Types (Etapa 6.7)
 *
 * Tipos e contratos para a montagem, validação e entrega do Pacote Final de Produção.
 */

import { ProductionProfile } from '../profile/types';
import { ValidationReport } from '../../validation/types';

export type PackageStatus = 'READY' | 'READY_WITH_WARNINGS' | 'BLOCKED';

export interface ProductionArtifact {
  /** Nome do arquivo gerado */
  fileName: string;
  /** Tipo MIME */
  mimeType: string;
  /** Formato do artefato */
  format: 'png' | 'cut-svg' | 'manifest-json' | 'zip';
  /** Descrição técnica da finalidade */
  description: string;
  /** Tamanho em bytes (se calculado) */
  size_bytes?: number;
  /** Blob contendo os dados brutos para download */
  blob?: Blob;
  /** Conteúdo textual (para SVG, JSON ou visualização) */
  dataString?: string;
  /** Data URL (se gerado) */
  dataUrl?: string;
  /** Largura física em mm */
  width_mm?: number;
  /** Altura física em mm */
  height_mm?: number;
}

export interface PackageValidationReport {
  /** Status consolidado do pacote */
  status: PackageStatus;
  /** Lista de erros críticos impeditivos (bloqueadores) */
  blockers: string[];
  /** Lista de avisos não críticos (atenção) */
  warnings: string[];
  /** Regras técnicas verificadas */
  checkedRules: {
    rule: string;
    passed: boolean;
    severity: 'error' | 'warning' | 'info';
    message: string;
  }[];
  /** Relatório detalhado do motor de validação gráfica (Etapa 5) */
  engineValidation?: ValidationReport;
}

export interface ProductionPackage {
  /** Identificador único do pacote */
  id: string;
  /** Perfil de produção utilizado */
  profile: ProductionProfile;
  /** Status final de prontidão */
  status: PackageStatus;
  /** ID do documento de origem */
  documentId: string;
  /** Nome do documento */
  documentName: string;
  /** Dimensões físicas finais em mm */
  dimensions_mm: {
    width_mm: number;
    height_mm: number;
    unit: 'mm';
  };
  /** Artefatos individuais do pacote (Print, Cut, Manifest) */
  artifacts: ProductionArtifact[];
  /** Arquivo agrupado ZIP (se gerado) */
  zipArtifact?: ProductionArtifact;
  /** Relatório de validação do pacote */
  validation: PackageValidationReport;
  /** Data e hora de geração (ISO 8601) */
  createdAt: string;
}

export interface PackageBuildOptions {
  /** Perfil desejado (padrão: 'generic-sticker') */
  profileId?: string;
  /** Offset da faca em mm */
  cutOffset_mm?: number;
  /** Resolução em DPI para arte de impressão (default: 300) */
  dpi?: number;
  /** Se deve incluir sangria na arte */
  includeBleed?: boolean;
  /** Fundo transparente para impressão PNG */
  transparentBackground?: boolean;
  /** Se deve gerar o arquivo ZIP agrupado */
  generateZip?: boolean;
  /** Se true, não bloqueia a criação do pacote mesmo com erros de validação */
  ignoreValidationErrors?: boolean;
}
