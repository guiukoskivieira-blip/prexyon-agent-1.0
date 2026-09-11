/**
 * Tool: create_production_package
 *
 * Gera o Pacote Final de Produção (Print PNG + Cut SVG + Manifest JSON + ZIP)
 * para adesivos e rótulos com validação determinística de pré-impressão.
 */

import { ToolDefinition, ToolResult } from '../types';
import { PackageBuildOptions, ProductionPackage } from '../../production/package/types';
import { buildProductionPackage } from '../../production/package/packageBuilder';

export interface CreateProductionPackageArgs extends PackageBuildOptions {}

export const createProductionPackageTool: ToolDefinition<CreateProductionPackageArgs, ProductionPackage> = {
  name: 'create_production_package',
  description: 'Gera o Pacote Final de Produção para adesivos (Print PNG + Cut SVG isolado + Manifesto JSON técnico + arquivo ZIP consolidado) com validação de pré-impressão antes da liberação.',
  parameters: {
    type: 'object',
    properties: {
      profileId: {
        type: 'string',
        description: 'Identificador do perfil de produção (padrão: "generic-sticker").',
        default: 'generic-sticker',
      },
      dpi: {
        type: 'number',
        description: 'Resolução em DPI para a arte de impressão PNG (72, 150 ou 300). Padrão: 300.',
        enum: [72, 150, 300],
        default: 300,
      },
      cutOffset_mm: {
        type: 'number',
        description: 'Offset da faca de corte em mm.',
        default: 2.0,
      },
      includeBleed: {
        type: 'boolean',
        description: 'Se verdadeiro, inclui a área de sangria na arte de impressão.',
        default: false,
      },
      transparentBackground: {
        type: 'boolean',
        description: 'Se verdadeiro, preserva canal alfa transparente na arte de impressão.',
        default: true,
      },
      generateZip: {
        type: 'boolean',
        description: 'Se verdadeiro, gera o arquivo consolidado .zip contendo todos os artefatos.',
        default: true,
      },
      ignoreValidationErrors: {
        type: 'boolean',
        description: 'Se verdadeiro, força a criação do pacote mesmo com erros críticos de validação.',
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
      const pkg = await buildProductionPackage(doc, args || {});

      if (pkg.status === 'BLOCKED' && !args?.ignoreValidationErrors) {
        return {
          success: false,
          error: {
            code: 'PACKAGE_VALIDATION_BLOCKED',
            message: `Pacote de produção bloqueado por falhas técnicas: ${pkg.validation.blockers.join(' | ')}`,
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
        message: `Pacote de produção (${pkg.profile.name}) gerado com sucesso. Status: ${pkg.status}. Arquivos: ${fileList}.${warningsSummary}`,
        data: pkg,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao gerar pacote de produção.';
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
