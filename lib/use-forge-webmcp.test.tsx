import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialForgeState } from './forge-data';
import { FORGE_TOOL_COUNT, useForgeWebMCP, WEBMCP_CHECKING } from './use-forge';

function installModelContext(value: WebMCP.ModelContext | undefined) {
  Object.defineProperty(document, 'modelContext', { configurable: true, value });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(document, 'modelContext');
});

describe('late WebMCP host discovery', () => {
  it('keeps checking and registers every tool when ChatGPT injects modelContext after hydration', async () => {
    vi.useFakeTimers();
    installModelContext(undefined);
    const registerTool = vi.fn(async () => undefined);
    const context = {
      registerTool,
      getTools: vi.fn(async () => []),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
      ontoolchange: null,
    } as unknown as WebMCP.ModelContext;
    const state = createInitialForgeState();
    const { result } = renderHook(() => useForgeWebMCP(
      vi.fn() as never,
      vi.fn() as never,
      (() => state) as never,
      true,
    ));

    expect(result.current).toBe(WEBMCP_CHECKING);
    await act(async () => { await vi.advanceTimersByTimeAsync(3600); });
    expect(result.current).toBe(0);

    installModelContext(context);
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(registerTool).toHaveBeenCalledTimes(FORGE_TOOL_COUNT);
    expect(result.current).toBe(FORGE_TOOL_COUNT);
  });

  it('retries only tool registrations rejected while the host is still becoming ready', async () => {
    vi.useFakeTimers();
    let rejectedExportOnce = false;
    const registerTool = vi.fn(async (definition: { name: string }) => {
      if (definition.name === 'export_design' && !rejectedExportOnce) {
        rejectedExportOnce = true;
        throw new Error('host is still initializing downloads');
      }
    });
    installModelContext({
      registerTool,
      getTools: vi.fn(async () => []),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(() => true), ontoolchange: null,
    } as unknown as WebMCP.ModelContext);
    const state = createInitialForgeState();
    const { result } = renderHook(() => useForgeWebMCP(
      vi.fn() as never, vi.fn() as never, (() => state) as never, true,
    ));

    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result.current).toBe(FORGE_TOOL_COUNT - 1);
    await act(async () => { await vi.advanceTimersByTimeAsync(550); });
    expect(result.current).toBe(FORGE_TOOL_COUNT);
    expect(registerTool).toHaveBeenCalledTimes(FORGE_TOOL_COUNT + 1);
    expect(registerTool.mock.calls.filter(([definition]) => definition.name === 'export_design')).toHaveLength(2);
  });
});
