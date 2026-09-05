import React, { useState } from 'react';
import { 
  Bot, 
  Send, 
  Sparkles, 
  Terminal, 
  Info,
  Clock
} from 'lucide-react';

export const ChatPanel: React.FC = () => {
  const [inputValue, setInputValue] = useState('');

  return (
    <aside className="w-80 h-full bg-surface-panel border-r border-surface-border flex flex-col select-none">
      {/* Panel Header */}
      <div className="h-11 border-b border-surface-border px-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-semibold text-slate-200 tracking-wide">
            AGENTE DE ARTE-FINAL
          </span>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded bg-surface-subtle text-slate-400 border border-surface-border font-mono">
          Gemini 2.0
        </span>
      </div>

      {/* Message Stream Area */}
      <div className="flex-1 p-3.5 overflow-y-auto space-y-3">
        {/* Initial Welcome & Status Message */}
        <div className="flex gap-2.5 items-start">
          <div className="w-7 h-7 rounded-md bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center shrink-0 mt-0.5">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
          </div>
          <div className="flex-1 bg-surface-subtle border border-surface-border rounded-lg p-3 text-xs leading-relaxed text-slate-300 shadow-sm">
            <div className="font-semibold text-white mb-1 flex items-center gap-1.5">
              <span>Prexyon Assistant</span>
              <span className="text-[10px] text-slate-500 font-mono">v0.1</span>
            </div>
            <p className="text-slate-300 mb-2">
              Estrutura visual inicial carregada com sucesso.
            </p>
            <div className="p-2 rounded bg-surface-base border border-surface-border/70 text-[11px] text-slate-400 space-y-1">
              <div className="flex items-center gap-1.5 text-indigo-400 font-medium">
                <Info className="w-3 h-3" />
                <span>Status da Implementação</span>
              </div>
              <p className="text-slate-400">
                A orquestração por linguagem natural com Gemini Tool Calling será conectada na <strong className="text-slate-200">Etapa 6</strong>.
              </p>
            </div>
          </div>
        </div>

        {/* Future Prompts Preview */}
        <div className="pt-2">
          <span className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase px-1">
            Comandos do Experimento (Etapas Futuras)
          </span>
          <div className="mt-2 space-y-1.5">
            {[
              'Vetorize essa logo.',
              'Deixe a logo com 50 mm de largura.',
              'Crie uma faca 2 mm para fora.',
              'Mude a faca para 3 mm.'
            ].map((cmd, i) => (
              <div
                key={i}
                className="text-[11px] font-mono px-2.5 py-1.5 rounded bg-surface-subtle border border-surface-border/50 text-slate-400 flex items-center gap-2 cursor-default"
              >
                <Terminal className="w-3 h-3 text-slate-500 shrink-0" />
                <span className="truncate">{cmd}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Input Area */}
      <div className="p-3 border-t border-surface-border bg-surface-subtle">
        <form onSubmit={(e) => e.preventDefault()} className="relative">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Aguardando ativação na Etapa 6..."
            disabled
            className="w-full bg-surface-base border border-surface-border rounded-lg pl-3 pr-9 py-2 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded bg-surface-panel text-slate-600 disabled:opacity-40"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
        <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
          <span className="flex items-center gap-1">
            <Clock className="w-2.5 h-2.5 text-amber-400" />
            Entrada de chat ativa na Etapa 6
          </span>
        </div>
      </div>
    </aside>
  );
};
