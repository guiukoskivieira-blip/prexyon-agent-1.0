import React, { useState, useRef, useEffect } from 'react';
import {
  Bot,
  Send,
  Sparkles,
  Terminal,
  AlertCircle,
  Loader2,
  CheckCircle2,
  User,
} from 'lucide-react';
import { PrexyonDocument } from '@/core/pdm/types';

export interface ChatMessageItem {
  id: string;
  role: 'user' | 'agent' | 'error';
  text: string;
  timestamp: number;
}

export interface ChatPanelProps {
  doc?: PrexyonDocument;
  onApplyDoc?: (newDoc: PrexyonDocument, description?: string) => void;
  selectedNodeId?: string | null;
  addToast?: (type: 'success' | 'error' | 'info', text: string) => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  doc,
  onApplyDoc,
  selectedNodeId,
  addToast,
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
      // 2. Envia para o endpoint backend POST /api/agent/chat
      const response = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: cleanText,
          doc,
          options: {
            selectedNodeId: selectedNodeId || undefined,
          },
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // 3. Resposta bem-sucedida do agente
        const agentMsgId = `agent_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const agentReply = data.reply || 'Ação executada com sucesso.';

        setMessages((prev) => [
          ...prev,
          {
            id: agentMsgId,
            role: 'agent',
            text: agentReply,
            timestamp: Date.now(),
          },
        ]);

        // 4. Aplica o PDM retornado na store (com histórico Undo/Redo)
        if (data.doc && onApplyDoc) {
          onApplyDoc(data.doc, cleanText);
        }
      } else {
        // 5. Erro amigável retornado pelo backend
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
      // 6. Falha de rede / erro de comunicação
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
        <span className="text-[10px] px-2 py-0.5 rounded bg-surface-subtle text-slate-400 border border-surface-border font-mono flex items-center gap-1">
          <Sparkles className="w-2.5 h-2.5 text-indigo-400" />
          Mock V1
        </span>
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
              <p className="whitespace-pre-wrap break-words">{msg.text}</p>
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
                'Mova este objeto 10 mm para a direita.',
                'Deixe a logo com 50 mm de largura.',
                'Crie uma faca 2 mm para fora.',
                'Valide o documento.',
              ].map((cmd, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handlePromptClick(cmd)}
                  className="w-full text-left text-[11px] font-mono px-2.5 py-1.5 rounded bg-surface-subtle border border-surface-border/50 text-slate-400 hover:text-slate-200 hover:border-indigo-500/40 hover:bg-surface-subtle/80 flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <Terminal className="w-3 h-3 text-indigo-400/70 shrink-0" />
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

