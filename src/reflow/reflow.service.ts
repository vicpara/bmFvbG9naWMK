import { DateTime } from 'luxon';
import type {
  IReflowService,
  OptimizationMetrics,
  ReflowChange,
  ReflowInput,
  ReflowResult,
  ScheduledWorkOrder,
  WorkCenter,
  WorkOrder,
} from './types';
import { GlobalSchedule } from './globalSchedule';
import { Validator, ValidationError, ImpossibleScheduleError, type ConstraintViolation } from './validator';

export class ReflowService implements IReflowService {
  private workCenters: Map<string, WorkCenter>;
  private globalSchedule: GlobalSchedule;

  constructor(workCenters: WorkCenter[]) {
    this.workCenters = new Map(workCenters.map((wc) => [wc.docId, wc])); // for O(1) lookups
    this.globalSchedule = new GlobalSchedule(workCenters);
  }

  reflow(input: ReflowInput): ReflowResult {
    const violations: ConstraintViolation[] = [];
    let sortedNonMaintenanceWOs: WorkOrder[];
    try {
      sortedNonMaintenanceWOs = ReflowService.topologicalSort(input.workOrders);
    } catch (error) {
      if (error instanceof Error && error.message.includes('Circular dependency')) {
        violations.push({
          code: 'CIRCULAR_DEPENDENCY',
          workOrderId: error.message.match(/WO id: (\S+)/)?.[1] || 'unknown',
          message: error.message,
          details: { affectedWorkOrders: input.workOrders.map((wo) => wo.docId) },
        });
        throw new ImpossibleScheduleError(violations);
      }
      throw error;
    }

    const groupedWOs = input.workOrders.reduce(
      (acc, wo) => {
        acc[wo.data.isMaintenance ? 'maintenance' : 'nonMaintenance'].push(wo);
        return acc;
      },
      { maintenance: [], nonMaintenance: [] } as { maintenance: WorkOrder[]; nonMaintenance: WorkOrder[] }
    );

    const updatedWorkOrders = new Map<string, WorkOrder>();
    const changes: ReflowChange[] = [];
    const explanations: string[] = [];

    // Process maintenance work orders (fixed schedule)
    for (const workOrder of groupedWOs.maintenance) {
      try {
        const result = this.scheduleWorkOrder(workOrder, updatedWorkOrders);
        updatedWorkOrders.set(result.workOrder.docId, result.workOrder);
      } catch (error) {
        violations.push(this.errorToViolation(error, workOrder));
      }
    }

    // Process regular work orders in dependency order
    for (const workOrder of sortedNonMaintenanceWOs) {
      try {
        const result = this.scheduleWorkOrder(workOrder, updatedWorkOrders);
        updatedWorkOrders.set(result.workOrder.docId, result.workOrder);
        if (result.wasRescheduled) {
          changes.push(result.change!);
          explanations.push(...(result.explanation || []));
        } else {
          explanations.push('Work order scheduled successfully with no conflicts');
        }
      } catch (error) {
        violations.push(this.errorToViolation(error, workOrder));
      }
    }

    if (violations.length > 0) {
      throw new ImpossibleScheduleError(violations);
    }

    const sortedWOs = Array.from(updatedWorkOrders.values()).sort(
      (a, b) => DateTime.fromISO(a.data.startDate).toMillis() - DateTime.fromISO(b.data.startDate).toMillis()
    );
    const metrics = this.computeMetrics(input.workOrders, changes, sortedWOs);
    return { updatedWorkOrders: sortedWOs, changes, explanation: explanations, metrics };
  }

  private computeMetrics(
    originalWOs: WorkOrder[],
    changes: ReflowChange[],
    updatedWOs: WorkOrder[]
  ): OptimizationMetrics {
    const totalDelayMinutes = changes.reduce((sum, change) => {
      const originalEnd = DateTime.fromISO(change.originalEndDate).toMillis();
      const newEnd = DateTime.fromISO(change.newEndDate).toMillis();
      const delayMs = Math.max(0, newEnd - originalEnd);
      return sum + delayMs / 60000;
    }, 0);
    const workOrdersAffectedCount = changes.length;
    const workOrdersUnchangedCount = originalWOs.length - workOrdersAffectedCount;
    const { scheduleStart, scheduleEnd } = this.getScheduleBounds(updatedWOs);
    const workCenterMetrics = this.globalSchedule.computeWorkCenterMetrics(scheduleStart, scheduleEnd);
    const totalShift = workCenterMetrics.reduce((sum, m) => sum + m.totalShiftMinutes, 0);
    const totalWorking = workCenterMetrics.reduce((sum, m) => sum + m.totalWorkingMinutes, 0);
    const overallUtilization = totalShift > 0 ? totalWorking / totalShift : 0;
    return {
      totalDelayMinutes,
      workOrdersAffectedCount,
      workOrdersUnchangedCount,
      overallUtilization,
      workCenterMetrics,
    };
  }

  private getScheduleBounds(workOrders: WorkOrder[]): { scheduleStart: DateTime; scheduleEnd: DateTime } {
    if (workOrders.length === 0) {
      const now = DateTime.utc();
      return { scheduleStart: now, scheduleEnd: now };
    }
    let minStart = DateTime.fromISO(workOrders[0].data.startDate).toUTC();
    let maxEnd = DateTime.fromISO(workOrders[0].data.endDate).toUTC();
    for (const wo of workOrders) {
      const start = DateTime.fromISO(wo.data.startDate).toUTC();
      const end = DateTime.fromISO(wo.data.endDate).toUTC();
      if (start < minStart) minStart = start;
      if (end > maxEnd) maxEnd = end;
    }
    return { scheduleStart: minStart, scheduleEnd: maxEnd };
  }

  private errorToViolation(error: unknown, wo: WorkOrder): ConstraintViolation {
    if (error instanceof ValidationError) {
      return { code: error.code, workOrderId: wo.docId, message: error.message };
    }
    const msg = error instanceof Error ? error.message : String(error);
    return { code: 'SCHEDULE_FAILED', workOrderId: wo.docId, message: msg };
  }

  private scheduleWorkOrder(workOrder: WorkOrder, scheduledWorkOrders: Map<string, WorkOrder>): ScheduledWorkOrder {
    Validator.preSchedule(workOrder, this.workCenters);
    const originalDates = { startDate: workOrder.data.startDate, endDate: workOrder.data.endDate };
    const earliestStart = workOrder.data.dependsOnWorkOrderIds.reduce(
      (maxDate, parentId) => {
        const parent = scheduledWorkOrders.get(parentId);
        return parent ? DateTime.max(maxDate, DateTime.fromISO(parent.data.endDate).toUTC()) : maxDate;
      },
      DateTime.fromISO(workOrder.data.startDate).toUTC()
    );
    const needsReschedulingDueToDeps = earliestStart > DateTime.fromISO(workOrder.data.startDate).toUTC();
    Validator.maintenanceNotReschedulable(workOrder, needsReschedulingDueToDeps);
    if (workOrder.data.isMaintenance && !needsReschedulingDueToDeps) {
      return { workOrder: { ...workOrder }, wasRescheduled: false };
    }
    if (needsReschedulingDueToDeps) {
      workOrder.data.startDate = earliestStart.toISO({ suppressMilliseconds: true })!;
    }

    try {
      const result = this.globalSchedule.addWorkOrder(workOrder);
      const wasRescheduled = result.workOrder.data.startDate !== originalDates.startDate ||
                            result.workOrder.data.endDate !== originalDates.endDate;
      if (wasRescheduled) {
        const reason = needsReschedulingDueToDeps ? ['Rescheduled due to conflicts'] : result.explanation;
        const change: ReflowChange = {
          workOrderId: workOrder.docId,
          originalStartDate: originalDates.startDate,
          originalEndDate: originalDates.endDate,
          newStartDate: result.workOrder.data.startDate,
          newEndDate: result.workOrder.data.endDate,
          reason,
        };
        return {
          workOrder: result.workOrder,
          wasRescheduled: true,
          change,
          explanation: ['Work order rescheduled to next available shift'],
        };
      }
      return {
        workOrder: result.workOrder,
        wasRescheduled: false,
      };
    } catch (error) {
      if (workOrder.data.isMaintenance) {
        throw new Error(`Cannot schedule maintenance work order ${workOrder.docId}: ${error instanceof Error ? error.message : String(error)}`);
      }
      throw error;
    }
  }
  // DFS for topological sort with cycle detection - non-maintenance WOs only as per assumption
  static topologicalSort(workOrders: WorkOrder[]): WorkOrder[] {
    const result: WorkOrder[] = [];
    const visited: Set<string> = new Set();
    const visiting: Set<string> = new Set();
    const visitPath: string[] = [];
    const woMap = new Map<string, WorkOrder>();

    for (const wo of workOrders) {
      if (woMap.has(wo.docId)) {
        throw new Error(`Duplicate work order ID found: ${wo.docId}`);
      }
      woMap.set(wo.docId, wo);
    }
    for (const wo of workOrders) {
      for (const depId of wo.data.dependsOnWorkOrderIds) {
        if (depId && !woMap.has(depId)) {
          throw new Error(`Work order ${wo.docId} depends on non-existent work order: ${depId}`);
        }
      }
    }
    const dfs = (id: string) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        const cycleStart = visitPath.indexOf(id);
        const cycle = [...visitPath.slice(cycleStart), id];
        throw new Error(`Circular dependency detected: ${cycle.join(' -> ')}. WO id: ${id}`);
      }
      visiting.add(id);
      visitPath.push(id);
      const wo = woMap.get(id);
      if (!wo) throw new Error(`Work order not found: ${id}`);
      if (wo.data.isMaintenance) {
        visitPath.pop();
        visiting.delete(id);
        visited.add(id);
        return;
      }
      for (const depId of wo.data.dependsOnWorkOrderIds.filter(Boolean)) {
        dfs(depId);
      }
      visitPath.pop();
      visiting.delete(id);
      visited.add(id);
      result.push(wo);
    };

    workOrders.filter((wo) => !wo.data.isMaintenance).forEach((wo) => dfs(wo.docId));
    return result;
  }
}
