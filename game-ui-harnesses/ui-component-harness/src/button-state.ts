export type ButtonState = 'normal' | 'hover' | 'pressed' | 'disabled';
export type InputSource = 'mouse' | 'touch' | 'pen' | 'control';
export interface StateSnapshot { state: ButtonState; enabled: boolean; pressedPointer: number | null; destroyed: boolean }
export type ButtonEvent =
  | { type: 'state'; state: ButtonState; source: InputSource; reason: string }
  | { type: 'activate'; source: InputSource; pointerId: number }
  | { type: 'destroy' };

/** One primary pointer owns an operation. Cancel never activates. */
export class ButtonStateMachine {
  private enabled: boolean;
  private hovered = false;
  private pointer: number | null = null;
  private destroyed = false;
  private state: ButtonState;
  private listeners = new Set<(event: ButtonEvent) => void>();
  constructor(enabled: boolean) { this.enabled = enabled; this.state = enabled ? 'normal' : 'disabled'; }
  snapshot(): StateSnapshot { return { state: this.state, enabled: this.enabled, pressedPointer: this.pointer, destroyed: this.destroyed }; }
  subscribe(listener: (event: ButtonEvent) => void): () => void {
    this.assertAlive(); this.listeners.add(listener); return () => this.listeners.delete(listener);
  }
  private emit(event: ButtonEvent) { for (const listener of [...this.listeners]) listener(event); }
  private assertAlive() { if (this.destroyed) throw new Error('INSTANCE_DESTROYED: 实例已销毁'); }
  private update(source: InputSource, reason: string) {
    const state = !this.enabled ? 'disabled' : this.pointer !== null ? 'pressed' : this.hovered ? 'hover' : 'normal';
    if (state !== this.state) { this.state = state; this.emit({ type: 'state', state, source, reason }); }
  }
  over(source: InputSource) { if (this.destroyed) return; this.hovered = source !== 'touch'; this.update(source, 'pointerover'); }
  out(source: InputSource) { if (this.destroyed) return; this.hovered = false; this.update(source, 'pointerout'); }
  down(id: number, source: InputSource, button: number, primary: boolean) {
    if (this.destroyed || !this.enabled || button !== 0 || !primary || this.pointer !== null) return;
    this.pointer = id; this.update(source, 'pointerdown');
  }
  up(id: number, source: InputSource, inside: boolean) {
    if (this.destroyed || this.pointer !== id) return;
    this.pointer = null; this.hovered = inside && source !== 'touch';
    const activate = this.enabled && inside;
    this.update(source, inside ? 'pointerup' : 'pointerupoutside');
    // A subscriber can disable/destroy synchronously while observing the release.
    if (activate && this.enabled && !this.destroyed) this.emit({ type: 'activate', source, pointerId: id });
  }
  cancel(reason: string, source: InputSource = 'control', id?: number) {
    if (this.destroyed || (id !== undefined && id !== this.pointer)) return;
    this.pointer = null; this.hovered = false; this.update(source, reason);
  }
  setEnabled(enabled: boolean) {
    this.assertAlive();
    if (typeof enabled !== 'boolean') throw new TypeError('enabled 必须为 boolean');
    this.enabled = enabled; this.pointer = null; this.hovered = false; this.update('control', 'setEnabled');
  }
  destroy() {
    if (this.destroyed) return;
    this.pointer = null; this.hovered = false; this.enabled = false; this.state = 'disabled'; this.destroyed = true;
    const listeners = [...this.listeners];
    this.listeners.clear();
    let firstError: unknown;
    for (const listener of listeners) {
      try { listener({ type: 'destroy' }); }
      catch (error) { if (firstError === undefined) firstError = error; }
    }
    if (firstError !== undefined) throw firstError;
  }
}
