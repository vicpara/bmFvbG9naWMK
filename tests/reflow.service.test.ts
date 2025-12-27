import { describe, it, expect, beforeAll } from 'vitest';
import { ReflowService } from '../src/reflow/reflow.service';
import type { WorkCenter, WorkOrder, ManufacturingOrder, ReflowInput } from '../src/reflow/types';
import workCentersRaw from './data/work-centers.json';
import workOrdersRaw from './data/work-orders.json';
import manufacturingOrdersRaw from './data/manufacturing-orders.json';
import scenariosRaw from './data/test-scenarios.json';

interface TestData {
  workCenters: Record<string, WorkCenter>;
  workOrders: Record<string, WorkOrder>;
  manufacturingOrders: Record<string, ManufacturingOrder>;
  scenarios: Record<string, any>;
}

let testData: TestData;
let reflowService: ReflowService;

beforeAll(() => {
  testData = {
    workCenters: workCentersRaw as any,
    workOrders: workOrdersRaw as any,
    manufacturingOrders: manufacturingOrdersRaw as any,
    scenarios: scenariosRaw as any,
  };
  reflowService = new ReflowService(Object.values(testData.workCenters));
});

describe('ReflowService', () => {
  describe('No conflict scenarios', () => {
    it('should not change work order when there is no conflict with maintenance windows', () => {
      const scenario = testData.scenarios['no-conflict-scenario'];
      const workOrders = scenario.workOrders.map((id: string) => testData.workOrders[id]);
      const manufacturingOrder = testData.manufacturingOrders[scenario.manufacturingOrder];

      const input: ReflowInput = {
        workOrders,
        manufacturingOrder,
      };

      const result = reflowService.reflow(input);

      expect(result.updatedWorkOrders).toHaveLength(workOrders.length);
      expect(result.changes).toHaveLength(scenario.expectedChanges.length);
      expect(result.explanation).toEqual(scenario.expectedExplanation);

      // Verify no changes were made
      result.updatedWorkOrders.forEach((updatedWo, index) => {
        expect(updatedWo.data.startDate).toBe(workOrders[index].data.startDate);
        expect(updatedWo.data.endDate).toBe(workOrders[index].data.endDate);
      });
    });
  });

  describe('Shift conflict scenarios', () => {
    it('should reschedule work order when work center has no shift for initial date', () => {
      const scenario = testData.scenarios['shift-conflict-scenario'];
      const workOrders = scenario.workOrders.map((id: string) => testData.workOrders[id]);
      const manufacturingOrder = testData.manufacturingOrders[scenario.manufacturingOrder];

      const input: ReflowInput = {
        workOrders,
        manufacturingOrder,
      };

      const result = reflowService.reflow(input);

      expect(result.updatedWorkOrders).toHaveLength(workOrders.length);
      expect(result.changes).toHaveLength(scenario.expectedChanges.length);

      if (scenario.expectedChanges.length > 0) {
        const expectedChange = scenario.expectedChanges[0];
        const change = result.changes.find((c) => c.workOrderId === expectedChange.workOrderId);

        expect(change).toBeDefined();
        expect(change?.newStartDate).toBe(expectedChange.newStartDate);
        expect(change?.newEndDate).toBe(expectedChange.newEndDate);
        expect(change?.reason).toEqual(expectedChange.reason);
      }

      expect(result.explanation).toEqual(scenario.expectedExplanation);
    });
  });

  describe('Maintenance conflict scenarios', () => {
    it('should reschedule work order when it conflicts with maintenance window', () => {
      const scenario = testData.scenarios['maintenance-conflict-scenario'];
      const workOrders = scenario.workOrders.map((id: string) => testData.workOrders[id]);
      const manufacturingOrder = testData.manufacturingOrders[scenario.manufacturingOrder];

      const input: ReflowInput = {
        workOrders,
        manufacturingOrder,
      };

      const result = reflowService.reflow(input);

      expect(result.updatedWorkOrders).toHaveLength(workOrders.length);
      expect(result.changes).toHaveLength(scenario.expectedChanges.length);

      if (scenario.expectedChanges.length > 0) {
        const expectedChange = scenario.expectedChanges[0];
        const change = result.changes.find((c) => c.workOrderId === expectedChange.workOrderId);

        expect(change).toBeDefined();
        expect(change?.newStartDate).toBe(expectedChange.newStartDate);
        expect(change?.newEndDate).toBe(expectedChange.newEndDate);
        expect(change?.reason).toEqual(expectedChange.reason);
      }

      expect(result.explanation).toEqual(scenario.expectedExplanation);
    });

    it('should handle partial fit after maintenance window', () => {
      const scenario = testData.scenarios['partial-fit-scenario'];
      const workOrders = scenario.workOrders.map((id: string) => testData.workOrders[id]);
      const manufacturingOrder = testData.manufacturingOrders[scenario.manufacturingOrder];

      const input: ReflowInput = {
        workOrders,
        manufacturingOrder,
      };

      const result = reflowService.reflow(input);

      expect(result.updatedWorkOrders).toHaveLength(workOrders.length);
      expect(result.changes).toHaveLength(scenario.expectedChanges.length);

      if (scenario.expectedChanges.length > 0) {
        const expectedChange = scenario.expectedChanges[0];
        const change = result.changes.find((c) => c.workOrderId === expectedChange.workOrderId);

        expect(change).toBeDefined();
        expect(change?.newStartDate).toBe(expectedChange.newStartDate);
        expect(change?.newEndDate).toBe(expectedChange.newEndDate);
        expect(change?.reason).toEqual(expectedChange.reason);
      }

      expect(result.explanation).toEqual(scenario.expectedExplanation);
    });

    it('should reschedule to next shift when full shift is blocked by maintenance', () => {
      const scenario = testData.scenarios['full-shift-blocked-scenario'];
      const workOrders = scenario.workOrders.map((id: string) => testData.workOrders[id]);
      const manufacturingOrder = testData.manufacturingOrders[scenario.manufacturingOrder];

      const input: ReflowInput = {
        workOrders,
        manufacturingOrder,
      };

      const result = reflowService.reflow(input);

      expect(result.updatedWorkOrders).toHaveLength(workOrders.length);
      expect(result.changes).toHaveLength(scenario.expectedChanges.length);

      if (scenario.expectedChanges.length > 0) {
        const expectedChange = scenario.expectedChanges[0];
        const change = result.changes.find((c) => c.workOrderId === expectedChange.workOrderId);

        expect(change).toBeDefined();
        expect(change?.newStartDate).toBe(expectedChange.newStartDate);
        expect(change?.newEndDate).toBe(expectedChange.newEndDate);
        expect(change?.reason).toEqual(expectedChange.reason);
      }

      expect(result.explanation).toEqual(scenario.expectedExplanation);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty work orders array', () => {
      const manufacturingOrder = testData.manufacturingOrders['standard-manufacturing-order'];

      const input: ReflowInput = {
        workOrders: [],
        manufacturingOrder,
      };

      const result = reflowService.reflow(input);

      expect(result.updatedWorkOrders).toHaveLength(0);
      expect(result.changes).toHaveLength(0);
      expect(result.explanation).toHaveLength(0);
    });

    it('should handle multiple work orders with different priorities', () => {
      const workOrders = [testData.workOrders['standard-work-order'], testData.workOrders['maintenance-work-order']];
      const manufacturingOrder = testData.manufacturingOrders['standard-manufacturing-order'];

      const input: ReflowInput = {
        workOrders,
        manufacturingOrder,
      };

      const result = reflowService.reflow(input);

      expect(result.updatedWorkOrders).toHaveLength(workOrders.length);
      // Maintenance work orders should not be rescheduled
      const maintenanceWo = result.updatedWorkOrders.find((wo) => wo.data.isMaintenance);
      expect(maintenanceWo?.data.startDate).toBe(testData.workOrders['maintenance-work-order'].data.startDate);
    });
  });
});
