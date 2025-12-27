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
      const manufacturingOrders = [testData.manufacturingOrders[scenario.manufacturingOrder]];

      const input: ReflowInput = {
        workOrders,
        manufacturingOrders,
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
      const manufacturingOrders = [testData.manufacturingOrders[scenario.manufacturingOrder]];

      const input: ReflowInput = {
        workOrders,
        manufacturingOrders,
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
      const manufacturingOrders = [testData.manufacturingOrders[scenario.manufacturingOrder]];

      const input: ReflowInput = {
        workOrders,
        manufacturingOrders,
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
      const manufacturingOrders = [testData.manufacturingOrders[scenario.manufacturingOrder]];

      const input: ReflowInput = {
        workOrders,
        manufacturingOrders,
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
      const manufacturingOrders = [testData.manufacturingOrders[scenario.manufacturingOrder]];

      const input: ReflowInput = {
        workOrders,
        manufacturingOrders,
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

  describe('Multi-session scenarios', () => {
    it('should split work order into multiple sessions within the same shift when interrupted by maintenance', () => {
      // Work center with maintenance window in the middle of the shift
      const workCenter: WorkCenter = {
        docId: 'wc-split-same-shift',
        docType: 'workCenter',
        data: {
          name: 'Split Same Shift Center',
          shifts: [{ dayOfWeek: 1, startHour: 8, endHour: 17 }],
          maintenanceWindows: [{ startDate: '2024-01-01T10:00:00Z', endDate: '2024-01-01T11:00:00Z' }],
        },
      };
      // WO needs 180 min work, starts at 8:00. Will work 8:00-10:00 (2h), pause for maintenance, resume 11:00-12:00 (1h)
      const workOrder: WorkOrder = {
        docId: 'wo-split-same',
        docType: 'workOrder',
        data: {
          workOrderNumber: 'WO-SPLIT-SAME',
          manufacturingOrderId: 'mo-test',
          workCenterId: 'wc-split-same-shift',
          durationMinutes: 180, // 3 hours of work
          setupTimeMinutes: 0,
          startDate: '2024-01-01T08:00:00Z',
          endDate: '2024-01-01T11:00:00Z',
          sessions: [],
          isMaintenance: false,
          dependsOnWorkOrderIds: [],
        },
      };
      const manufacturingOrder: ManufacturingOrder = {
        docId: 'mo-test',
        docType: 'manufacturingOrder',
        data: { manufacturingOrderNumber: 'MO-TEST', itemId: 'ITEM', quantity: 1, dueDate: '2024-01-15T17:00:00Z' },
      };
      const service = new ReflowService([workCenter]);
      const result = service.reflow({ workOrders: [workOrder], manufacturingOrders: [manufacturingOrder] });
      const updated = result.updatedWorkOrders[0];
      expect(updated.data.sessions).toHaveLength(2);
      // Session 1: 8:00-10:00 (120 min work)
      expect(updated.data.sessions[0].startDate).toBe('2024-01-01T08:00:00Z');
      expect(updated.data.sessions[0].endDate).toBe('2024-01-01T10:00:00Z');
      expect(updated.data.sessions[0].durationTimeMinutes).toBe(120);
      // Session 2: 11:00-12:00 (60 min work)
      expect(updated.data.sessions[1].startDate).toBe('2024-01-01T11:00:00Z');
      expect(updated.data.sessions[1].endDate).toBe('2024-01-01T12:00:00Z');
      expect(updated.data.sessions[1].durationTimeMinutes).toBe(60);
      // Total work = 120 + 60 = 180 min
      expect(updated.data.startDate).toBe('2024-01-01T08:00:00Z');
      expect(updated.data.endDate).toBe('2024-01-01T12:00:00Z');
    });

    it('should split work order into multiple sessions across different shifts', () => {
      // Work center with Mon-Tue shifts 8:00-12:00 (4 hours each)
      const workCenter: WorkCenter = {
        docId: 'wc-split-multi-shift',
        docType: 'workCenter',
        data: {
          name: 'Split Multi Shift Center',
          shifts: [
            { dayOfWeek: 1, startHour: 8, endHour: 12 }, // Monday 8-12
            { dayOfWeek: 2, startHour: 8, endHour: 12 }, // Tuesday 8-12
          ],
          maintenanceWindows: [],
        },
      };
      // WO needs 360 min (6 hours) work with 30 min setup per session
      // Session 1: Mon 8:00-12:00 (30 setup + 210 work = 240 min)
      // Session 2: Tue 8:00-12:00 (30 setup + 150 work = 180 min)
      const workOrder: WorkOrder = {
        docId: 'wo-split-multi',
        docType: 'workOrder',
        data: {
          workOrderNumber: 'WO-SPLIT-MULTI',
          manufacturingOrderId: 'mo-test',
          workCenterId: 'wc-split-multi-shift',
          durationMinutes: 360, // 6 hours of work
          setupTimeMinutes: 30,
          startDate: '2024-01-01T08:00:00Z',
          endDate: '2024-01-01T14:30:00Z',
          sessions: [],
          isMaintenance: false,
          dependsOnWorkOrderIds: [],
        },
      };
      const manufacturingOrder: ManufacturingOrder = {
        docId: 'mo-test',
        docType: 'manufacturingOrder',
        data: { manufacturingOrderNumber: 'MO-TEST', itemId: 'ITEM', quantity: 1, dueDate: '2024-01-15T17:00:00Z' },
      };
      const service = new ReflowService([workCenter]);
      const result = service.reflow({ workOrders: [workOrder], manufacturingOrders: [manufacturingOrder] });
      const updated = result.updatedWorkOrders[0];
      expect(updated.data.sessions).toHaveLength(2);
      // Session 1: Monday 8:00-12:00 (30 setup + 210 work)
      expect(updated.data.sessions[0].startDate).toBe('2024-01-01T08:00:00Z');
      expect(updated.data.sessions[0].endDate).toBe('2024-01-01T12:00:00Z');
      expect(updated.data.sessions[0].setupTimeMinutes).toBe(30);
      expect(updated.data.sessions[0].durationTimeMinutes).toBe(210);
      // Session 2: Tuesday 8:00-11:00 (30 setup + 150 work)
      expect(updated.data.sessions[1].startDate).toBe('2024-01-02T08:00:00Z');
      expect(updated.data.sessions[1].endDate).toBe('2024-01-02T11:00:00Z');
      expect(updated.data.sessions[1].setupTimeMinutes).toBe(30);
      expect(updated.data.sessions[1].durationTimeMinutes).toBe(150);
      // Total work = 210 + 150 = 360 min ✓
      expect(updated.data.startDate).toBe('2024-01-01T08:00:00Z');
      expect(updated.data.endDate).toBe('2024-01-02T11:00:00Z');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty work orders array', () => {
      const manufacturingOrders = [testData.manufacturingOrders['standard-manufacturing-order']];

      const input: ReflowInput = {
        workOrders: [],
        manufacturingOrders,
      };

      const result = reflowService.reflow(input);

      expect(result.updatedWorkOrders).toHaveLength(0);
      expect(result.changes).toHaveLength(0);
      expect(result.explanation).toHaveLength(0);
    });

    it('should handle multiple work orders with different priorities', () => {
      const workOrders = [testData.workOrders['standard-work-order'], testData.workOrders['maintenance-work-order']];
      const manufacturingOrders = [testData.manufacturingOrders['standard-manufacturing-order']];

      const input: ReflowInput = {
        workOrders,
        manufacturingOrders,
      };

      const result = reflowService.reflow(input);

      expect(result.updatedWorkOrders).toHaveLength(workOrders.length);
      // Maintenance work orders should not be rescheduled
      const maintenanceWo = result.updatedWorkOrders.find((wo) => wo.data.isMaintenance);
      expect(maintenanceWo?.data.startDate).toBe(testData.workOrders['maintenance-work-order'].data.startDate);
    });
  });

  describe('Optimization Metrics', () => {
    it('should return metrics with result', () => {
      const workOrder: WorkOrder = {
        docId: 'wo-metrics-1',
        docType: 'workOrder',
        data: {
          workOrderNumber: 'WO-METRICS-1',
          manufacturingOrderId: 'mo-test',
          workCenterId: 'wc-metrics',
          durationMinutes: 60,
          setupTimeMinutes: 0,
          startDate: '2024-01-01T08:00:00Z',
          endDate: '2024-01-01T09:00:00Z',
          sessions: [],
          isMaintenance: false,
          dependsOnWorkOrderIds: [],
        },
      };
      const workCenter: WorkCenter = {
        docId: 'wc-metrics',
        docType: 'workCenter',
        data: {
          name: 'Metrics Test Center',
          shifts: [{ dayOfWeek: 1, startHour: 8, endHour: 17 }],
          maintenanceWindows: [],
        },
      };
      const mo: ManufacturingOrder = {
        docId: 'mo-test',
        docType: 'manufacturingOrder',
        data: { manufacturingOrderNumber: 'MO-TEST', itemId: 'ITEM', quantity: 1, dueDate: '2024-01-15T17:00:00Z' },
      };
      const service = new ReflowService([workCenter]);
      const result = service.reflow({ workOrders: [workOrder], manufacturingOrders: [mo] });
      expect(result.metrics).toBeDefined();
      expect(result.metrics.workOrdersAffectedCount).toBe(0);
      expect(result.metrics.workOrdersUnchangedCount).toBe(1);
      expect(result.metrics.totalDelayMinutes).toBe(0);
      expect(result.metrics.workCenterMetrics).toHaveLength(1);
    });

    it('should calculate total delay when work orders are rescheduled', () => {
      const workCenter: WorkCenter = {
        docId: 'wc-delay',
        docType: 'workCenter',
        data: {
          name: 'Delay Test Center',
          shifts: [{ dayOfWeek: 1, startHour: 8, endHour: 17 }],
          maintenanceWindows: [{ startDate: '2024-01-01T08:00:00Z', endDate: '2024-01-01T10:00:00Z' }],
        },
      };
      const workOrder: WorkOrder = {
        docId: 'wo-delay',
        docType: 'workOrder',
        data: {
          workOrderNumber: 'WO-DELAY',
          manufacturingOrderId: 'mo-test',
          workCenterId: 'wc-delay',
          durationMinutes: 60,
          setupTimeMinutes: 0,
          startDate: '2024-01-01T08:00:00Z',
          endDate: '2024-01-01T09:00:00Z',
          sessions: [],
          isMaintenance: false,
          dependsOnWorkOrderIds: [],
        },
      };
      const mo: ManufacturingOrder = {
        docId: 'mo-test',
        docType: 'manufacturingOrder',
        data: { manufacturingOrderNumber: 'MO-TEST', itemId: 'ITEM', quantity: 1, dueDate: '2024-01-15T17:00:00Z' },
      };
      const service = new ReflowService([workCenter]);
      const result = service.reflow({ workOrders: [workOrder], manufacturingOrders: [mo] });
      expect(result.metrics.workOrdersAffectedCount).toBe(1);
      expect(result.metrics.workOrdersUnchangedCount).toBe(0);
      expect(result.metrics.totalDelayMinutes).toBe(120); // moved from 9:00 end to 11:00 end
    });

    it('should calculate utilization correctly', () => {
      const workCenter: WorkCenter = {
        docId: 'wc-util',
        docType: 'workCenter',
        data: {
          name: 'Utilization Test Center',
          shifts: [{ dayOfWeek: 1, startHour: 8, endHour: 12 }], // 4 hours = 240 min
          maintenanceWindows: [],
        },
      };
      const workOrder: WorkOrder = {
        docId: 'wo-util',
        docType: 'workOrder',
        data: {
          workOrderNumber: 'WO-UTIL',
          manufacturingOrderId: 'mo-test',
          workCenterId: 'wc-util',
          durationMinutes: 120, // 2 hours
          setupTimeMinutes: 0,
          startDate: '2024-01-01T08:00:00Z',
          endDate: '2024-01-01T10:00:00Z',
          sessions: [],
          isMaintenance: false,
          dependsOnWorkOrderIds: [],
        },
      };
      const mo: ManufacturingOrder = {
        docId: 'mo-test',
        docType: 'manufacturingOrder',
        data: { manufacturingOrderNumber: 'MO-TEST', itemId: 'ITEM', quantity: 1, dueDate: '2024-01-15T17:00:00Z' },
      };
      const service = new ReflowService([workCenter]);
      const result = service.reflow({ workOrders: [workOrder], manufacturingOrders: [mo] });
      const wcMetrics = result.metrics.workCenterMetrics.find((m) => m.workCenterId === 'wc-util');
      expect(wcMetrics).toBeDefined();
      expect(wcMetrics!.totalWorkingMinutes).toBe(120);
      expect(wcMetrics!.totalShiftMinutes).toBe(120); // schedule bounds: 8:00-10:00
      expect(wcMetrics!.totalIdleMinutes).toBe(0);
      expect(wcMetrics!.utilization).toBeCloseTo(1, 2);
    });

    it('should calculate idle time when work center has gaps', () => {
      const workCenter: WorkCenter = {
        docId: 'wc-idle',
        docType: 'workCenter',
        data: {
          name: 'Idle Test Center',
          shifts: [{ dayOfWeek: 1, startHour: 8, endHour: 17 }], // 9 hours = 540 min
          maintenanceWindows: [],
        },
      };
      const wo1: WorkOrder = {
        docId: 'wo-idle-1',
        docType: 'workOrder',
        data: {
          workOrderNumber: 'WO-IDLE-1',
          manufacturingOrderId: 'mo-test',
          workCenterId: 'wc-idle',
          durationMinutes: 60,
          setupTimeMinutes: 0,
          startDate: '2024-01-01T08:00:00Z',
          endDate: '2024-01-01T09:00:00Z',
          sessions: [],
          isMaintenance: false,
          dependsOnWorkOrderIds: [],
        },
      };
      const wo2: WorkOrder = {
        docId: 'wo-idle-2',
        docType: 'workOrder',
        data: {
          workOrderNumber: 'WO-IDLE-2',
          manufacturingOrderId: 'mo-test',
          workCenterId: 'wc-idle',
          durationMinutes: 60,
          setupTimeMinutes: 0,
          startDate: '2024-01-01T14:00:00Z',
          endDate: '2024-01-01T15:00:00Z',
          sessions: [],
          isMaintenance: false,
          dependsOnWorkOrderIds: [],
        },
      };
      const mo: ManufacturingOrder = {
        docId: 'mo-test',
        docType: 'manufacturingOrder',
        data: { manufacturingOrderNumber: 'MO-TEST', itemId: 'ITEM', quantity: 1, dueDate: '2024-01-15T17:00:00Z' },
      };
      const service = new ReflowService([workCenter]);
      const result = service.reflow({ workOrders: [wo1, wo2], manufacturingOrders: [mo] });
      const wcMetrics = result.metrics.workCenterMetrics.find((m) => m.workCenterId === 'wc-idle');
      expect(wcMetrics).toBeDefined();
      expect(wcMetrics!.totalWorkingMinutes).toBe(120); // 2 work orders * 60 min
      expect(wcMetrics!.totalShiftMinutes).toBe(420); // 8:00-15:00 = 7 hours
      expect(wcMetrics!.totalIdleMinutes).toBe(300); // 5 hours idle between 9:00-14:00
      expect(wcMetrics!.utilization).toBeCloseTo(120 / 420, 2);
    });

    it('should handle multiple work centers', () => {
      const wc1: WorkCenter = {
        docId: 'wc-multi-1',
        docType: 'workCenter',
        data: {
          name: 'Multi WC 1',
          shifts: [{ dayOfWeek: 1, startHour: 8, endHour: 12 }],
          maintenanceWindows: [],
        },
      };
      const wc2: WorkCenter = {
        docId: 'wc-multi-2',
        docType: 'workCenter',
        data: {
          name: 'Multi WC 2',
          shifts: [{ dayOfWeek: 1, startHour: 8, endHour: 12 }],
          maintenanceWindows: [],
        },
      };
      const wo1: WorkOrder = {
        docId: 'wo-multi-1',
        docType: 'workOrder',
        data: {
          workOrderNumber: 'WO-MULTI-1',
          manufacturingOrderId: 'mo-test',
          workCenterId: 'wc-multi-1',
          durationMinutes: 120,
          setupTimeMinutes: 0,
          startDate: '2024-01-01T08:00:00Z',
          endDate: '2024-01-01T10:00:00Z',
          sessions: [],
          isMaintenance: false,
          dependsOnWorkOrderIds: [],
        },
      };
      const wo2: WorkOrder = {
        docId: 'wo-multi-2',
        docType: 'workOrder',
        data: {
          workOrderNumber: 'WO-MULTI-2',
          manufacturingOrderId: 'mo-test',
          workCenterId: 'wc-multi-2',
          durationMinutes: 60,
          setupTimeMinutes: 0,
          startDate: '2024-01-01T08:00:00Z',
          endDate: '2024-01-01T09:00:00Z',
          sessions: [],
          isMaintenance: false,
          dependsOnWorkOrderIds: [],
        },
      };
      const mo: ManufacturingOrder = {
        docId: 'mo-test',
        docType: 'manufacturingOrder',
        data: { manufacturingOrderNumber: 'MO-TEST', itemId: 'ITEM', quantity: 1, dueDate: '2024-01-15T17:00:00Z' },
      };
      const service = new ReflowService([wc1, wc2]);
      const result = service.reflow({ workOrders: [wo1, wo2], manufacturingOrders: [mo] });
      expect(result.metrics.workCenterMetrics).toHaveLength(2);
      const wc1Metrics = result.metrics.workCenterMetrics.find((m) => m.workCenterId === 'wc-multi-1');
      const wc2Metrics = result.metrics.workCenterMetrics.find((m) => m.workCenterId === 'wc-multi-2');
      expect(wc1Metrics!.totalWorkingMinutes).toBe(120);
      expect(wc2Metrics!.totalWorkingMinutes).toBe(60);
      // Schedule bounds: 8:00-10:00. WC1: 120min shift, 120 working. WC2: 120min shift, 60 working
      expect(result.metrics.overallUtilization).toBeCloseTo((120 + 60) / (120 + 120), 2);
    });
  });
});
