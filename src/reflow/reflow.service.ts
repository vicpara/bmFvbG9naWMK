import { DateTime } from 'luxon';
import type {
  IReflowService,
  ReflowChange,
  ReflowInput,
  ReflowResult,
  ScheduledWorkOrder,
  WorkCenter,
  WorkOrder,
} from './types';
import { GlobalSchedule } from './globalSchedule';

export class ReflowService implements IReflowService {
  private workCenters: Map<string, WorkCenter>;
  private globalSchedule: GlobalSchedule;

  constructor(workCenters: WorkCenter[]) {
    this.workCenters = new Map(workCenters.map((wc) => [wc.docId, wc])); // for O(1) lookups
    this.globalSchedule = new GlobalSchedule(workCenters);
  }

  private getWorkCenter(workCenterId: string): WorkCenter {
    const workCenter = this.workCenters.get(workCenterId);
    if (!workCenter) throw new Error(`Work center ${workCenterId} not found`);
    return workCenter;
  }


  reflow(input: ReflowInput): ReflowResult {
    const sortedNonMaintenanceWOs = ReflowService.topologicalSort(input.workOrders);
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
      const result = this.scheduleWorkOrder(workOrder, updatedWorkOrders);
      updatedWorkOrders.set(result.workOrder.docId, result.workOrder);
    }

    // Process regular work orders in dependency order
    for (const workOrder of sortedNonMaintenanceWOs) {
      const result = this.scheduleWorkOrder(workOrder, updatedWorkOrders);
      updatedWorkOrders.set(result.workOrder.docId, result.workOrder);
      if (result.wasRescheduled) {
        changes.push(result.change!);
        explanations.push(...(result.explanation || []));
      } else {
        explanations.push('Work order scheduled successfully with no conflicts');
      }
    }

    return {
      updatedWorkOrders: Array.from(updatedWorkOrders.values()).sort(
        (a, b) => DateTime.fromISO(a.data.startDate).toMillis() - DateTime.fromISO(b.data.startDate).toMillis()
      ),
      changes,
      explanation: explanations
    };
  }

  private scheduleWorkOrder(workOrder: WorkOrder, scheduledWorkOrders: Map<string, WorkOrder>): ScheduledWorkOrder {
    const workCenter = this.getWorkCenter(workOrder.data.workCenterId);
    const originalDates = { startDate: workOrder.data.startDate, endDate: workOrder.data.endDate };

    // Max end time of dependencies - ensures temporal constraints
    const earliestStart = workOrder.data.dependsOnWorkOrderIds.reduce(
      (maxDate, parentId) => {
        const parent = scheduledWorkOrders.get(parentId);
        return parent
          ? DateTime.max(maxDate, DateTime.fromISO(parent.data.endDate).toUTC())
          : maxDate;
      },
      DateTime.fromISO(workOrder.data.startDate).toUTC()
    );
    const needsReschedulingDueToDeps = earliestStart > DateTime.fromISO(workOrder.data.startDate).toUTC();

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

  private isScheduleValid(workOrder: WorkOrder, workCenter: WorkCenter): boolean {
    const startDate = DateTime.fromISO(workOrder.data.startDate).toUTC();
    const endDate = DateTime.fromISO(workOrder.data.endDate).toUTC();

    // Check if start time is within a shift
    const dayOfWeek = startDate.weekday % 7;
    const shift = workCenter.data.shifts.find(s => s.dayOfWeek === dayOfWeek);
    if (!shift) return false;

    const shiftStart = startDate.startOf('day').plus({ hours: shift.startHour });
    const shiftEnd = startDate.startOf('day').plus({ hours: shift.endHour });

    if (startDate < shiftStart || endDate > shiftEnd) return false;

    // Check for maintenance window conflicts
    const hasMaintenanceConflict = workCenter.data.maintenanceWindows.some(mw => {
      const mwStart = DateTime.fromISO(mw.startDate).toUTC();
      const mwEnd = DateTime.fromISO(mw.endDate).toUTC();
      return (startDate < mwEnd && endDate > mwStart);
    });

    if (hasMaintenanceConflict) return false;

    // Check for conflicts with existing scheduled events
    const dayKey = Math.floor(startDate.toUTC().startOf('day').toMillis() / (24 * 60 * 60 * 1000));
    const existingEvents = this.globalSchedule.getScheduledEvents(workCenter.docId, dayKey);

    const hasEventConflict = existingEvents.some(event => {
      const eventStart = DateTime.fromISO(event.startDate).toUTC();
      const eventEnd = DateTime.fromISO(event.endDate).toUTC();
      return (startDate < eventEnd && endDate > eventStart);
    });

    return !hasEventConflict;
  }

  // DFS for topological sort with cycle detection - non-maintenance WOs only as per assumption
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
