import { describe, expect, it, vi } from 'vitest';
import { onSessionEnd, runSessionEndHooks } from './sessionEnd';

describe('session end hooks', () => {
  it('runs every registered hook, survives a throwing one, and honours unregister', () => {
    const a = vi.fn();
    const b = vi.fn(() => {
      throw new Error('boom');
    });
    const c = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const offA = onSessionEnd(a);
    const offB = onSessionEnd(b);
    const offC = onSessionEnd(c);
    runSessionEndHooks();
    expect(a).toHaveBeenCalledTimes(1);
    expect(c).toHaveBeenCalledTimes(1);
    offA();
    runSessionEndHooks();
    expect(a).toHaveBeenCalledTimes(1);
    expect(c).toHaveBeenCalledTimes(2);
    offB();
    offC();
    warn.mockRestore();
  });
});
