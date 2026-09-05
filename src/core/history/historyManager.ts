/**
 * Prexyon History Manager (Command Stack)
 *
 * Gerencia a pilha de comandos de Undo/Redo para o Prexyon Document Model.
 */

import { DocumentCommand, CommandResult } from '../commands/types';
import { PrexyonDocument } from '../pdm/types';

export class HistoryManager {
  private undoStack: DocumentCommand[] = [];
  private redoStack: DocumentCommand[] = [];
  private maxHistory: number = 50;

  constructor(maxHistory: number = 50) {
    this.maxHistory = maxHistory;
  }

  public get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public get lastUndoCommandName(): string | null {
    return this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1].name : null;
  }

  public get lastRedoCommandName(): string | null {
    return this.redoStack.length > 0 ? this.redoStack[this.redoStack.length - 1].name : null;
  }

  /**
   * Executa um comando e o adiciona ao topo da pilha de Undo, limpando a pilha de Redo.
   */
  public executeCommand(command: DocumentCommand, currentDoc: PrexyonDocument): CommandResult {
    const result = command.execute(currentDoc);
    this.undoStack.push(command);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = []; // Nova ação invalida o futuro anterior
    return result;
  }

  /**
   * Desfaz o último comando executado.
   */
  public undo(currentDoc: PrexyonDocument): CommandResult | null {
    const command = this.undoStack.pop();
    if (!command) return null;

    const result = command.undo(currentDoc);
    this.redoStack.push(command);
    return result;
  }

  /**
   * Refaz o último comando desfeito.
   */
  public redo(currentDoc: PrexyonDocument): CommandResult | null {
    const command = this.redoStack.pop();
    if (!command) return null;

    const result = command.execute(currentDoc);
    this.undoStack.push(command);
    return result;
  }

  /**
   * Limpa o histórico.
   */
  public clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
