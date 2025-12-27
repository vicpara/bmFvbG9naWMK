import type { IReflowService, ReflowInput, ReflowResult } from './types';

export class ReflowService implements IReflowService {
  constructor() {}
  reflow(input: ReflowInput): ReflowResult {
    console.log('ReflowService.reflow', input);
    return {
      updatedWorkOrders: [],
      changes: [],
      explanation: [],
    };
  }
}
