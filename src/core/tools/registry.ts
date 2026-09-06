/**
 * Prexyon Agent — Tool Registry (v1.0)
 *
 * Catálogo e orquestrador determinístico de ferramentas para o agente de IA.
 */

import {
  ToolDefinition,
  ToolDeclaration,
  ToolExecutionContext,
  ToolResult,
} from './types';

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  constructor(initialTools: ToolDefinition[] = []) {
    for (const tool of initialTools) {
      this.register(tool);
    }
  }

  /**
   * Registra uma nova ferramenta no catálogo.
   */
  public register(tool: ToolDefinition): void {
    if (!tool || !tool.name) {
      throw new Error('A ferramenta deve possuir um nome válido.');
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * Obtém a definição de uma ferramenta pelo nome.
   */
  public getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Retorna todas as ferramentas registradas.
   */
  public getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Retorna as declarações de ferramentas compatíveis com esquemas de Function Calling de LLMs (Gemini, OpenAI, Anthropic).
   */
  public getToolDeclarations(): ToolDeclaration[] {
    return this.getAllTools().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  /**
   * Executa uma ferramenta pelo nome de forma determinística e segura.
   *
   * @param name Nome da ferramenta registrada.
   * @param args Argumentos passados para a ferramenta.
   * @param context Contexto de execução contendo o PDM e histórico.
   * @returns Resultado estruturado ou erro estruturado.
   */
  public async executeTool<TArgs = any, TResult = any>(
    name: string,
    args: TArgs,
    context: ToolExecutionContext
  ): Promise<ToolResult<TResult>> {
    if (!name || typeof name !== 'string') {
      return {
        success: false,
        error: {
          code: 'TOOL_NOT_FOUND',
          message: 'O nome da ferramenta deve ser uma string válida.',
        },
      };
    }

    const tool = this.tools.get(name);
    if (!tool) {
      const availableTools = Array.from(this.tools.keys()).join(', ');
      return {
        success: false,
        error: {
          code: 'TOOL_NOT_FOUND',
          message: `Ferramenta "${name}" não encontrada no Tool Registry. Ferramentas disponíveis: ${availableTools}.`,
        },
      };
    }

    if (!context || !context.doc) {
      return {
        success: false,
        error: {
          code: 'INVALID_ARGUMENTS',
          message: 'Contexto de execução inválido: documento PDM não fornecido.',
        },
      };
    }

    try {
      return await tool.execute(args, context);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro interno durante a execução da ferramenta.';
      return {
        success: false,
        error: {
          code: 'EXECUTION_FAILED',
          message: msg,
          details: err,
        },
      };
    }
  }
}
