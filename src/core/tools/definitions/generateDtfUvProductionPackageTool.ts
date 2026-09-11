/**
 * Tool: generate_dtf_uv_production_package
 *
 * Gera o Pacote Técnico de Produção DTF UV (Color PNG + White PNG + Clear PNG + Manifesto JSON técnico + arquivo ZIP consolidado)
 * com validação determinística de pré-impressão e governança de separações.
 */

import { ToolDefinition, ToolResult } from '../types';
import { ProductionPackage } from '../../production/package/types';
import { DtfUvPackageBuildOptions, buildDtfUvProductionPackage } from '../../dtf/dtfUvPackageEngine';

export interface GenerateDtfUvProductionPackageArgs extends DtfUvPackageBuildOptions {}

export const generateDtfUvProductionPackageTool: ToolDefinition<GenerateDtfUvProductionPackageArgs, ProductionPackage> = {
  name: 'generate_dtf_uv_production_package',
  description: 'Gera o Pacote Técnico de Produção DTF UV (Color PNG de alta resolução + White PNG + Clear PNG + Manifesto JSON estruturado + arquivo ZIP consolidado) com validação de pré-impressão e governança de separações antes da liberação.',
  parameters: {
    type: 'object',
    properties: {
      dpi: {
        type: 'number',
        description: 'Resolução em DPI para a arte COLOR e separações técnicas (72, 150 ou 300). Padrão: 300.',
        enum: [72, 150, 300],
        default: 300,
      },
      includeBleed: {
        type: 'boolean',
        description: 'Se verdadeiro, inclui a área de sangria na arte COLOR.',
        default: false,
      },
      generateZip: {
        type: 'boolean',
        description: 'Se verdadeiro, gera o arquivo consolidado .zip contendo todos os artefatos DTF UV.',
        default: true,
      },
      whitePolicy: {
        type: 'string',
        description: 'Política para a máscara de Base Branca ("OPTIONAL", "REQUIRED", "DISABLED", "RIP_CONTROLLED").',
        enum: ['OPTIONAL', 'REQUIRED', 'DISABLED', 'RIP_CONTROLLED'],
        default: 'OPTIONAL',
      },
      clearPolicy: {
        type: 'string',
        description: 'Política para a máscara de Verniz / Clear ("OPTIONAL", "REQUIRED", "DISABLED", "RIP_CONTROLLED").',
        enum: ['OPTIONAL', 'REQUIRED', 'DISABLED', 'RIP_CONTROLLED'],
        default: 'OPTIONAL',
      },
      ignoreValidationErrors: {
        type: 'boolean',
        description: 'Se verdadeiro, força a criação do pacote mesmo com erros de validação.',
        default: false,
      },
    },
    required: [],
  },
  async execute(args, context): Promise<ToolResult<ProductionPackage>> {
    const { doc } = context;

    if (!doc) {
      return {
        success: false,
        error: {
          code: 'INVALID_ARGUMENTS',
          message: 'Documento PDM não fornecido no contexto de execução.',
        },
      };
    }

    try {
      const pkg = await buildDtfUvProductionPackage(doc, args || {});

      if (pkg.status === 'BLOCKED' && !args?.ignoreValidationErrors) {
        return {
          success: false,
          error: {
            code: 'PACKAGE_VALIDATION_BLOCKED',
            message: `Pacote DTF UV bloqueado por falhas técnicas: ${pkg.validation.blockers.join(' | ')}`,
            details: pkg.validation,
          },
        };
      }

      const fileList = [
        ...pkg.artifacts.map((a) => a.fileName),
        ...(pkg.zipArtifact ? [pkg.zipArtifact.fileName] : []),
      ].join(', ');

      const warningsSummary =
        pkg.validation.warnings.length > 0
          ? ` Avisos: ${pkg.validation.warnings.join(' | ')}.`
          : '';

      return {
        success: true,
        message: `Pacote técnico DTF UV preparado com sucesso. Arquivos gerados: ${fileList}.${warningsSummary}`,
        data: pkg,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao gerar pacote técnico DTF UV.';
      return {
        success: false,
        error: {
          code: 'EXECUTION_FAILED',
          message: msg,
          details: err,
        },
      };
    }
  },
};
