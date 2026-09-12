import React, { useState, useRef, useEffect } from 'react';
import {
  Bot,
  Send,
  Sparkles,
  AlertCircle,
  Loader2,
  CheckCircle2,
  User,
} from 'lucide-react';
import { PrexyonDocument, DocumentNode, RasterNode } from '@/core/pdm/types';
import { sanitizeDocumentForAgentTransport, mergeAgentResultDocument } from '@/core/pdm/document';
import { vtracerBridge } from '@/core/vectorizer/vtracerBridge';
import { getVTracerOptionsForPreset } from '@/core/vectorizer/presets';
import { materializeAgentExports } from '@/core/agent/clientExportMaterializer';
import { ProductionReviewModel } from '@/core/production/review/types';
import { buildProductionReview } from '@/core/production/review/reviewBuilder';
import { ProductionReviewPanel } from '@/components/review/ProductionReviewPanel';

export interface ChatMessageItem {
  id: string;
  role: 'user' | 'agent' | 'error';
  text: string;
  timestamp: number;
  review?: ProductionReviewModel;
}

export interface ChatPanelProps {
  doc?: PrexyonDocument;
  onApplyDoc?: (newDoc: PrexyonDocument, description?: string) => void;
  selectedNodeId?: string | null;
  addToast?: (type: 'success' | 'error' | 'info', text: string) => void;
  isProd?: boolean;
  isCutContourVisible?: boolean;
  onToggleCutContourVisibility?: () => void;
  onHighlightNode?: (nodeId: string) => void;
}

/**
 * Renderizador seguro e nativo de Markdown básico para o chat.
 * Suporta negrito (**texto**), itálico (*texto*), código inline (`code`), blocos de código e listas.
 */
export const FormattedChatMessage: React.FC<{ text: string }> = ({ text }) => {
  if (!text) return null;

  // Divide blocos de código delimitados por ```
  const codeBlockParts = text.split(/(```[\s\S]*?```)/g);

  const renderInline = (inlineText: string): React.ReactNode[] => {
    const tokens: React.ReactNode[] = [];
    const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(inlineText)) !== null) {
      if (match.index > lastIndex) {
        tokens.push(inlineText.substring(lastIndex, match.index));
      }
      const token = match[0];
      if (token.startsWith('`') && token.endsWith('`')) {
        tokens.push(
          <code
            key={`c-${match.index}`}
            className="px-1 py-0.5 rounded bg-surface-base border border-surface-border text-indigo-300 font-mono text-[11px]"
          >
            {token.slice(1, -1)}
          </code>
        );
      } else if (token.startsWith('**') && token.endsWith('**')) {
        tokens.push(
          <strong key={`b-${match.index}`} className="font-semibold text-slate-100">
            {token.slice(2, -2)}
          </strong>
        );
      } else if (token.startsWith('*') && token.endsWith('*')) {
        tokens.push(
          <em key={`i-${match.index}`} className="italic text-slate-300">
            {token.slice(1, -1)}
          </em>
        );
      }
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < inlineText.length) {
      tokens.push(inlineText.substring(lastIndex));
    }

    return tokens.length > 0 ? tokens : [inlineText];
  };

  return (
    <div className="space-y-1.5 text-xs leading-relaxed break-words">
      {codeBlockParts.map((part, idx) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const content = part.slice(3, -3).replace(/^[a-z0-9_-]+\n/i, '');
          return (
            <pre
              key={idx}
              className="p-2 rounded bg-surface-base border border-surface-border font-mono text-[11px] text-indigo-300 overflow-x-auto my-1.5"
            >
              <code>{content.trim()}</code>
            </pre>
          );
        }

        const lines = part.split('\n');
        return (
          <React.Fragment key={idx}>
            {lines.map((line, lIdx) => {
              const trimmed = line.trim();
              if (!trimmed) {
                return lIdx < lines.length - 1 ? <div key={lIdx} className="h-1" /> : null;
              }

              // Cabeçalhos (### / ## / #)
              if (trimmed.startsWith('### ')) {
                return (
                  <h4 key={lIdx} className="font-semibold text-slate-200 text-xs mt-1">
                    {renderInline(trimmed.slice(4))}
                  </h4>
                );
              }
              if (trimmed.startsWith('## ') || trimmed.startsWith('# ')) {
                return (
                  <h3 key={lIdx} className="font-bold text-slate-100 text-xs mt-1">
                    {renderInline(trimmed.replace(/^#+\s/, ''))}
                  </h3>
                );
              }

              // Listas com marcadores (- ou *)
              if (/^[-*]\s/.test(trimmed)) {
                return (
                  <div key={lIdx} className="flex items-start gap-1.5 pl-1.5 text-slate-200">
                    <span className="text-indigo-400 text-[10px] leading-relaxed">•</span>
                    <span>{renderInline(trimmed.slice(2))}</span>
                  </div>
                );
              }

              // Listas numeradas (1. / 2.)
              const numMatch = trimmed.match(/^(\d+)\.\s(.*)$/);
              if (numMatch) {
                return (
                  <div key={lIdx} className="flex items-start gap-1.5 pl-1.5 text-slate-200">
                    <span className="font-mono text-[10px] text-indigo-400 leading-relaxed">
                      {numMatch[1]}.
                    </span>
                    <span>{renderInline(numMatch[2])}</span>
                  </div>
                );
              }

              return (
                <p key={lIdx} className="text-slate-200">
                  {renderInline(line)}
                </p>
              );
            })}
          </React.Fragment>
        );
      })}
    </div>
  );
};

export const ChatPanel: React.FC<ChatPanelProps> = ({
  doc,
  onApplyDoc,
  selectedNodeId,
  addToast,
  isProd = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.PROD),
  isCutContourVisible = true,
  onToggleCutContourVisibility,
  onHighlightNode,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [messages, setMessages] = useState<ChatMessageItem[]>([
    {
      id: 'msg_welcome',
      role: 'agent',
      text: 'Olá! Sou o assistente de arte-final do Prexyon Agent. Como posso ajudar com seu arquivo hoje?',
      timestamp: Date.now(),
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll para a última mensagem
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isProcessing]);

  const handleSendMessage = async (textToSend: string) => {
    const cleanText = textToSend.trim();
    if (!cleanText || isProcessing) return;

    if (!doc) {
      if (addToast) addToast('error', 'Documento PDM não encontrado.');
      return;
    }

    // 1. Registra a mensagem do usuário no chat
    const userMsgId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const userMessage: ChatMessageItem = {
      id: userMsgId,
      role: 'user',
      text: cleanText,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsProcessing(true);

    try {
      let activeDoc = doc;
      const textLower = cleanText.toLowerCase();
      const wantsCutOrVectorize =
        textLower.includes('faca') ||
        textLower.includes('corte') ||
        textLower.includes('sangria') ||
        textLower.includes('contorno') ||
        textLower.includes('vetor') ||
        textLower.includes('vector') ||
        textLower.includes('adesivo') ||
        (textLower.includes('prepare') && textLower.includes('produção')) ||
        (textLower.includes('prepare') && textLower.includes('producao'));

      // Se a intenção demandar geometria vetorial (faca/vetorização) e houver imagem raster sem vetor:
      if (wantsCutOrVectorize && doc.nodes) {
        const nodes = Object.values(doc.nodes) as DocumentNode[];
        const targetRaster = (selectedNodeId && doc.nodes[selectedNodeId]?.type === 'raster_image'
          ? doc.nodes[selectedNodeId]
          : nodes.find((n) => n && (n.type === 'raster_image' || (n as any).type === 'raster'))) as RasterNode | undefined;

        if (targetRaster && targetRaster.src && targetRaster.src.startsWith('data:')) {
          const hasDerivedVector = nodes.some(
            (n) =>
              n &&
              (n.type === 'group' || (n as any).type === 'vector_group') &&
              ((n as any).sourceRasterNodeId === targetRaster.id || n.name === `Vetor: ${targetRaster.name}`)
          );

          if (!hasDerivedVector) {
            try {
              const options = getVTracerOptionsForPreset('logo');
              const vResult = await vtracerBridge.vectorizeRasterNode(targetRaster, options);
              const updatedNodes = { ...activeDoc.nodes };
              updatedNodes[vResult.groupNode.id] = vResult.groupNode;
              for (const pNode of vResult.pathNodes) {
                updatedNodes[pNode.id] = pNode;
              }
              activeDoc = {
                ...activeDoc,
                nodes: updatedNodes,
                rootNodeIds: [...activeDoc.rootNodeIds, vResult.groupNode.id],
              };
            } catch (vErr) {
              console.warn('Vetorização local no navegador não pôde ser executada:', vErr);
            }
          }
        }
      }

      // 2. Envia para o endpoint backend POST /api/agent/chat com documento sanitizado (sem base64)
      const transportDoc = sanitizeDocumentForAgentTransport(activeDoc);
      const response = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: cleanText,
          doc: transportDoc,
          options: {
            selectedNodeId: selectedNodeId || undefined,
          },
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // 3. Aplica o PDM retornado com merge seguro que preserva os buffers locais (com histórico Undo/Redo)
        const returnedDoc = mergeAgentResultDocument(doc, data.doc);
        if (onApplyDoc) {
          onApplyDoc(returnedDoc, cleanText);
        }

        // 4. Exportações validadas no servidor são materializadas pelo motor real do navegador.
        // A confirmação textual só aparece depois que o download for efetivamente acionado.
        try {
          const artifacts = await materializeAgentExports(
            Array.isArray(data.executedTools) ? data.executedTools : [],
            returnedDoc
          );
          if (artifacts.length > 0 && addToast) {
            addToast(
              'success',
              artifacts.length === 1
                ? `Download iniciado: ${artifacts[0].fileName}`
                : `${artifacts.length} downloads de produção iniciados.`
            );
          }
        } catch (exportError: unknown) {
          const exportMessage =
            exportError instanceof Error
              ? exportError.message
              : 'A exportação não pôde ser concluída no navegador.';
          const exportErrorId = `export_err_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
          setMessages((prev) => [
            ...prev,
            {
              id: exportErrorId,
              role: 'error',
              text: `A ferramenta preparou a exportação, mas o download falhou: ${exportMessage}`,
              timestamp: Date.now(),
            },
          ]);
          if (addToast) addToast('error', 'Falha ao iniciar o download solicitado pela IA.');
          return;
        }

        // 5. Constrói a revisão técnica de produção com base na execução real das tools
        let reviewModel: ProductionReviewModel | undefined;
        if (Array.isArray(data.executedTools) && data.executedTools.length > 0) {
          reviewModel = buildProductionReview({
            executedTools: data.executedTools,
            beforeDoc: doc || returnedDoc,
            afterDoc: returnedDoc,
          });
        }

        // 6. Resposta bem-sucedida do agente
        const agentMsgId = `agent_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const agentReply = data.reply || 'Ação executada com sucesso.';

        setMessages((prev) => [
          ...prev,
          {
            id: agentMsgId,
            role: 'agent',
            text: agentReply,
            timestamp: Date.now(),
            review: reviewModel,
          },
        ]);

      } else {
        // 6. Erro amigável retornado pelo backend
        const errorMsg =
          data?.error?.message ||
          'Não foi possível processar a solicitação no momento. Verifique o comando e tente novamente.';

        const errorMsgId = `err_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        setMessages((prev) => [
          ...prev,
          {
            id: errorMsgId,
            role: 'error',
            text: errorMsg,
            timestamp: Date.now(),
          },
        ]);
      }
    } catch (err: unknown) {
      // 7. Falha de rede / erro de comunicação
      const netErrorMsgId = `net_err_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      setMessages((prev) => [
        ...prev,
        {
          id: netErrorMsgId,
          role: 'error',
          text: 'Falha de comunicação com o servidor do assistente. Tente novamente em instantes.',
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsProcessing(false);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSendMessage(inputValue);
  };

  const handlePromptClick = (promptText: string) => {
    if (isProcessing) return;
    setInputValue(promptText);
    inputRef.current?.focus();
  };

  return (
    <aside
      data-testid="chat-panel"
      className="w-80 h-full bg-surface-panel border-r border-surface-border flex flex-col select-none"
    >
      {/* Panel Header */}
      <div className="h-11 border-b border-surface-border px-3.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-semibold text-slate-200 tracking-wide">
            AGENTE DE ARTE-FINAL
          </span>
        </div>
        {isProd ? (
          <span
            data-testid="agent-status-badge"
            className="text-[10px] px-2 py-0.5 rounded bg-emerald-950/40 text-emerald-400 border border-emerald-500/30 font-medium flex items-center gap-1.5 shadow-sm"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            IA Online
          </span>
        ) : (
          <span
            data-testid="agent-status-badge"
            className="text-[10px] px-2 py-0.5 rounded bg-surface-subtle text-slate-400 border border-surface-border font-mono flex items-center gap-1"
          >
            <Sparkles className="w-2.5 h-2.5 text-slate-400" />
            Mock
          </span>
        )}
      </div>

      {/* Message Stream Area */}
      <div
        data-testid="chat-messages"
        className="flex-1 p-3.5 overflow-y-auto space-y-3 min-h-0"
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-2.5 items-start ${
              msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
            }`}
          >
            {/* Avatar */}
            <div
              className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 mt-0.5 border ${
                msg.role === 'user'
                  ? 'bg-slate-700/60 border-slate-600 text-slate-300'
                  : msg.role === 'error'
                  ? 'bg-rose-950/40 border-rose-800/60 text-rose-400'
                  : 'bg-indigo-600/20 border-indigo-500/30 text-indigo-400'
              }`}
            >
              {msg.role === 'user' ? (
                <User className="w-3.5 h-3.5" />
              ) : msg.role === 'error' ? (
                <AlertCircle className="w-3.5 h-3.5" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
            </div>

            {/* Bubble */}
            <div
              className={`max-w-[85%] rounded-lg p-2.5 text-xs leading-relaxed shadow-sm ${
                msg.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-tr-none'
                  : msg.role === 'error'
                  ? 'bg-rose-950/30 border border-rose-900/50 text-rose-300 rounded-tl-none'
                  : 'bg-surface-subtle border border-surface-border text-slate-200 rounded-tl-none'
              }`}
            >
              {msg.role === 'agent' && (
                <div className="font-semibold text-indigo-300 mb-1 text-[11px] flex items-center gap-1">
                  <span>Prexyon Agent</span>
                </div>
              )}
              {msg.role === 'user' ? (
                <p className="whitespace-pre-wrap break-words">{msg.text}</p>
              ) : (
                <div className="space-y-2.5">
                  <FormattedChatMessage text={msg.text} />
                  {msg.review && (
                    <div className="mt-2.5 pt-1">
                      <ProductionReviewPanel
                        review={msg.review}
                        isCutContourVisible={isCutContourVisible}
                        onToggleCutContourVisibility={onToggleCutContourVisibility}
                        onHighlightNode={onHighlightNode}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Loading Indicator */}
        {isProcessing && (
          <div
            data-testid="chat-processing-indicator"
            className="flex gap-2.5 items-start"
          >
            <div className="w-6 h-6 rounded-md bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center shrink-0 mt-0.5">
              <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
            </div>
            <div className="bg-surface-subtle border border-surface-border rounded-lg rounded-tl-none p-2.5 text-xs text-indigo-300 flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />
              <span>Processando...</span>
            </div>
          </div>
        )}

        {/* Suggested Quick Prompts */}
        {messages.length <= 2 && !isProcessing && (
          <div className="pt-2 border-t border-surface-border/60">
            <span className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase px-1">
              Sugestões de Comandos
            </span>
            <div className="mt-2 space-y-1.5">
              {[
                'Prepare este adesivo para produção',
                'Crie uma faca de 2 mm para fora',
                'Corrija o que puder automaticamente',
                'Gere o pacote de produção',
              ].map((cmd, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handlePromptClick(cmd)}
                  className="w-full text-left text-[11px] font-sans px-2.5 py-1.5 rounded-lg bg-surface-subtle border border-surface-border/50 text-slate-300 hover:text-slate-100 hover:border-indigo-500/40 hover:bg-surface-elevated flex items-center gap-2 transition-all cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span className="truncate">{cmd}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-3 border-t border-surface-border bg-surface-subtle shrink-0">
        <form onSubmit={handleSubmit} className="relative">
          <input
            ref={inputRef}
            data-testid="chat-input"
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={
              isProcessing
                ? 'Processando com o assistente...'
                : 'Descreva a alteração desejada no arquivo...'
            }
            disabled={isProcessing}
            className="w-full bg-surface-base border border-surface-border rounded-lg pl-3 pr-9 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          />
          <button
            data-testid="chat-send-btn"
            type="submit"
            disabled={isProcessing || !inputValue.trim()}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-surface-panel disabled:text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Enviar mensagem (Enter)"
          >
            {isProcessing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
          </button>
        </form>
        <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
          <span className="flex items-center gap-1 text-slate-400">
            <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
            Assistente conectado
          </span>
          <span className="font-mono text-slate-500">Pressione Enter</span>
        </div>
      </div>
    </aside>
  );
};
