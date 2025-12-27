import type { IReflowService, ReflowInput, ReflowResult, WorkCenter } from './types';

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
}
