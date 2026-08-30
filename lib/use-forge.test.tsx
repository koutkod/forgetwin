import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { STORAGE_KEY, useForge } from './use-forge';

afterEach(() => window.localStorage.clear());

describe('atomic ForgeTwin edit batches', () => {
  it('commits every valid action together and rolls back the entire shadow batch on failure', async () => {
    const { result } = renderHook(() => useForge());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    let created;
    act(() => {
      created = result.current.commandBatch([
        { name: 'set_design_goal', input: { machine_name: 'Atomic test rig', domain: 'Test engineering', brief: 'Build an atomic test rig from one grounded plate.', capabilities: ['structure'], constraints: [{ metric: 'component_count', label: 'Physical bodies', operator: 'max', target: 4, unit: '', source: 'inferred' }], max_components: 4 } },
        { name: 'create_assembly', input: { assembly_id: 'test-rig', name: 'Test rig', purpose: 'Verify atomic model edits' } },
        { name: 'create_component', input: { component_id: 'base-plate', primitive: 'plate', assembly_id: 'test-rig', role: 'grounded base plate', position: [0, .1, 0], rotation: [0, 0, 0], dimensions: [2, .2, 1], material_id: 'steel', body_type: 'fixed' } },
      ], 'ModelAgent', { expectedRevision: 0, expectedDesignHash: 'world-empty-00000000' });
    });
    expect(created).toMatchObject({ ok: true });
    expect(result.current.getSnapshot()).toMatchObject({ revision: 3, components: [{ id: 'base-plate' }] });

    const before = result.current.getSnapshot();
    const persistedBefore = window.localStorage.getItem(STORAGE_KEY);
    let failed;
    act(() => {
      failed = result.current.commandBatch([
        { name: 'set_dimensions', input: { component_id: 'base-plate', dimensions: [3, .2, 1] } },
        { name: 'create_component', input: { component_id: 'base-plate', primitive: 'plate', assembly_id: 'test-rig', role: 'duplicate', position: [0, 1, 0], rotation: [0, 0, 0], dimensions: [1, 1, 1], material_id: 'steel', body_type: 'fixed' } },
      ], 'ModelAgent', { expectedRevision: before.revision, expectedDesignHash: before.designHash });
    });
    expect(failed).toMatchObject({ ok: false });
    expect(result.current.getSnapshot()).toBe(before);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(persistedBefore);
  });

  it('rejects stale plans and protects explicitly preserved bodies', async () => {
    const { result } = renderHook(() => useForge());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    act(() => {
      result.current.commandBatch([
        { name: 'set_design_goal', input: { machine_name: 'Guarded test rig', domain: 'Test engineering', brief: 'Build a guarded test rig from one grounded plate.', capabilities: ['structure'], constraints: [{ metric: 'component_count', label: 'Physical bodies', operator: 'max', target: 4, unit: '', source: 'inferred' }], max_components: 4 } },
        { name: 'create_assembly', input: { assembly_id: 'guarded-rig', name: 'Guarded rig', purpose: 'Verify preserved bodies' } },
        { name: 'create_component', input: { component_id: 'guarded-base', primitive: 'plate', assembly_id: 'guarded-rig', role: 'guarded base', position: [0, .1, 0], rotation: [0, 0, 0], dimensions: [2, .2, 1], material_id: 'steel', body_type: 'fixed' } },
      ], 'ModelAgent');
    });
    const before = result.current.getSnapshot();
    const stale = result.current.commandBatch([{ name: 'set_mass', input: { component_id: 'guarded-base', mass: 30 } }], 'ModelAgent', { expectedRevision: before.revision - 1, expectedDesignHash: before.designHash });
    expect(stale).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
    const preserved = result.current.commandBatch([{ name: 'move_component', input: { component_id: 'guarded-base', position: [1, .1, 0] } }], 'ModelAgent', { expectedRevision: before.revision, expectedDesignHash: before.designHash, preserveComponentIds: ['guarded-base'] });
    expect(preserved).toMatchObject({ ok: false, error: { code: 'HUMAN_LOCKED' } });
    expect(result.current.getSnapshot()).toBe(before);
  });

  it('preserves mounts and control relationships, not only component fields', async () => {
    const { result } = renderHook(() => useForge());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    act(() => {
      result.current.commandBatch([
        { name: 'set_design_goal', input: { machine_name: 'Functional graph rig', domain: 'Test engineering', brief: 'Build two mounted bodies to verify functional graph preservation.', capabilities: ['structure'], constraints: [{ metric: 'component_count', label: 'Physical bodies', operator: 'max', target: 4, unit: '', source: 'inferred' }], max_components: 4 } },
        { name: 'create_assembly', input: { assembly_id: 'graph-rig', name: 'Graph rig', purpose: 'Verify preserved mounting relationships' } },
        { name: 'create_component', input: { component_id: 'graph-base', primitive: 'support', assembly_id: 'graph-rig', role: 'preserved grounded base', position: [0, .1, 0], rotation: [0, 0, 0], dimensions: [2, .2, 1], material_id: 'steel', body_type: 'fixed' } },
        { name: 'create_component', input: { component_id: 'graph-child', primitive: 'plate', assembly_id: 'graph-rig', role: 'mounted child plate', position: [0, .6, 0], rotation: [0, 0, 0], dimensions: [1, .2, .8], material_id: 'aluminum', body_type: 'dynamic' } },
        { name: 'connect_components', input: { connection_id: 'graph-edge', source_id: 'graph-base', target_id: 'graph-child', connection_type: 'mechanical', channel: 'mount' } },
        { name: 'create_joint', input: { joint_id: 'graph-mount', joint_type: 'fixed', component_a: 'graph-base', component_b: 'graph-child', anchor_a: [0, .5, 0], anchor_b: [0, 0, 0], axis: [0, 1, 0] } },
      ], 'ModelAgent');
    });
    const before = result.current.getSnapshot();
    const removed = result.current.commandBatch([{ name: 'remove_component', input: { component_id: 'graph-child' } }], 'ModelAgent', {
      expectedRevision: before.revision, expectedDesignHash: before.designHash, preserveComponentIds: ['graph-base'],
    });
    expect(removed).toMatchObject({ ok: false, error: { code: 'HUMAN_LOCKED' } });
    expect(result.current.getSnapshot()).toBe(before);
  });
});
