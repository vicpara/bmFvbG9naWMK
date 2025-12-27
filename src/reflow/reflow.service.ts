import type { IReflowService, ReflowInput, ReflowResult, WorkCenter, WorkOrder } from './types';

export class ReflowService implements IReflowService {
  private workCenters: Map<string, WorkCenter>;
  constructor(workCenters: WorkCenter[]) {
    this.workCenters = new Map(workCenters.map((wc) => [wc.docId, wc]));
  }

  reflow(input: ReflowInput): ReflowResult {
    console.log('ReflowService.reflow', input);
    return {
      updatedWorkOrders: [],
      changes: [],
      explanation: [],
    };
  }

  static topologicalSort(workOrders: WorkOrder[]): WorkOrder[] {
    const result: WorkOrder[] = [];
    const visited: Set<string> = new Set();
    const visiting: Set<string> = new Set();
    const woMap = new Map<string, WorkOrder>();

    // Check for duplicate work order IDs
    for (const wo of workOrders) {
      if (woMap.has(wo.docId)) {
        throw new Error(`Duplicate work order ID found: ${wo.docId}`);
      }
      woMap.set(wo.docId, wo);
    }
    // Validate that all dependencies exist in the work orders
    for (const wo of workOrders) {
      for (const depId of wo.data.dependsOnWorkOrderIds) {
        if (depId && !woMap.has(depId)) {
          throw new Error(`Work order ${wo.docId} depends on non-existent work order: ${depId}`);
        }
      }
    }
    const dfs = (id: string) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) throw new Error(`Circular dependency detected in work order chain: WO id: ${id}`);
      visiting.add(id);
      const wo = woMap.get(id);
      if (!wo) throw new Error(`Work order not found: ${id}`); // Should not happen due to validation above
      // Skip maintenance work orders entirely;
      // it should not be part of the chain as per assumption; read @reflow/types.ts
      if (wo.data.isMaintenance) {
        visiting.delete(id);
        visited.add(id);
        return;
      }
      for (const depId of wo.data.dependsOnWorkOrderIds.filter(Boolean)) {
        dfs(depId);
      }
      visiting.delete(id);
      visited.add(id);
      result.push(wo);
    };

    // Only process non-maintenance work orders
    workOrders.filter((wo) => !wo.data.isMaintenance).forEach((wo) => dfs(wo.docId));
    return result;
  }
}
