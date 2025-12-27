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
    const woMap = new Map(workOrders.map((wo) => [wo.docId, wo]));

    const dfs = (id: string) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) throw new Error(`Circular dependency detected in work order chain: WO id: ${id}`);
      visiting.add(id);
      for (const depId of (woMap.get(id!)?.data.dependsOnWorkOrderIds || []).filter(Boolean)) {
        dfs(depId);
      }
      visiting.delete(id);
      visited.add(id);
      result.push(woMap.get(id)!);
    };
    workOrders.filter((wo) => !wo.data.isMaintenance).forEach((wo) => dfs(wo.docId));
    return result;
  }
}
