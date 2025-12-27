# Reflow service scheduling validation
_Exported on 27/12/2025 at 17:31:48 EET from Cursor (2.2.44)_

---

**User**

@src/reflow/reflow.service.ts 

Let's implement valid checks as per @public/BE-technical-test.md 

Pre-Scheduling Checks:
Work center has defined shifts
Work order has valid duration (> 0)
Dependencies exist and form valid DAG (✅ already done)
Work order isn't maintenance (if rescheduling needed)
During-Scheduling Validation:
Dependency satisfaction: Parent work orders completed before child starts
Time slot feasibility: Work + setup time fits in available slots
Multi-day conflicts: Check conflicts across all days work order spans
Progressive validation: Validate each session as it's created
Post-Scheduling Validation:
Work order fully scheduled (remainingDuration = 0)
All sessions created successfully
End date within acceptable horizon

Others that I'm missing?
Write terse code. minimal.

---

**Cursor**

Let me first read the `globalSchedule.ts` and `types.ts` to understand the current structure before implementing the validation checks.

Now I understand the structure. Let me implement a minimal validator module with all the checks:

```typescript
import { DateTime } from 'luxon';
import type { WorkOrder, WorkCenter, Session } from './types';

export class ValidationError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export const Validator = {
  // Pre-scheduling checks
  preSchedule(wo: WorkOrder, workCenters: Map<string, WorkCenter>): void {
    const wc = workCenters.get(wo.data.workCenterId);
    if (!wc) throw new ValidationError('WC_NOT_FOUND', `Work center ${wo.data.workCenterId} not found`);
    if (!wc.data.shifts?.length) throw new ValidationError('NO_SHIFTS', `Work center ${wc.docId} has no shifts`);
    if (wo.data.durationMinutes <= 0) throw new ValidationError('INVALID_DURATION', `Work order ${wo.docId} has invalid duration`);
    if (wo.data.setupTimeMinutes < 0) throw new ValidationError('INVALID_SETUP', `Work order ${wo.docId} has negative setup time`);
    if (!DateTime.fromISO(wo.data.startDate).isValid) throw new ValidationError('INVALID_START', `Work order ${wo.docId} has invalid start date`);
    if (wo.data.dependsOnWorkOrderIds.includes(wo.docId)) throw new ValidationError('SELF_REF', `Work order ${wo.docId} depends on itself`);
  },
  maintenanceNotReschedulable(wo: WorkOrder, needsReschedule: boolean): void {
    if (wo.data.isMaintenance && needsReschedule) {
      throw new ValidationError('MAINT_RESCHEDULE', `Maintenance work order ${wo.docId} cannot be rescheduled`);
    }
  },
  // During-scheduling checks
  dependenciesSatisfied(wo: WorkOrder, startTime: DateTime, scheduledWOs: Map<string, WorkOrder>): void {
    for (const depId of wo.data.dependsOnWorkOrderIds) {
      const parent = scheduledWOs.get(depId);
      if (!parent) continue;
      const parentEnd = DateTime.fromISO(parent.data.endDate).toUTC();
      if (parentEnd > startTime) {
        throw new ValidationError('DEP_UNSATISFIED', `Work order ${wo.docId} starts before dependency ${depId} ends`);
      }
    }
  },
  // Post-scheduling checks
  postSchedule(wo: WorkOrder, sessions: Session[], remainingDuration: number, maxDays: number): void {
    if (remainingDuration > 0) {
      throw new ValidationError('INCOMPLETE', `Work order ${wo.docId} not fully scheduled: ${remainingDuration}min remaining`);
    }
    if (!sessions.length) {
      throw new ValidationError('NO_SESSIONS', `Work order ${wo.docId} has no scheduled sessions`);
    }
    const start = DateTime.fromISO(wo.data.startDate).toUTC();
    const end = DateTime.fromISO(sessions[sessions.length - 1].endDate).toUTC();
    if (end.diff(start, 'days').days > maxDays) {
      throw new ValidationError('HORIZON_EXCEEDED', `Work order ${wo.docId} exceeds ${maxDays}-day scheduling horizon`);
    }
  },
  sessionsNoOverlap(sessions: Session[]): void {
    const sorted = [...sessions].sort((a, b) => DateTime.fromISO(a.startDate).toMillis() - DateTime.fromISO(b.startDate).toMillis());
    for (let i = 1; i < sorted.length; i++) {
      const prev = DateTime.fromISO(sorted[i - 1].endDate);
      const curr = DateTime.fromISO(sorted[i].startDate);
      if (curr < prev) {
        throw new ValidationError('SESSION_OVERLAP', `Sessions overlap: ${sorted[i - 1].endDate} > ${sorted[i].startDate}`);
      }
    }
  }
};

```

Now let me integrate the validator into both `ReflowService` and `GlobalSchedule`:

```typescript
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
import { Validator } from './validator';

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

```

```typescript
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
import { Validator } from './validator';

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

```

Now update `GlobalSchedule` to add post-scheduling validation:

```typescript
import type { ScheduledEvent, WorkCenter, WorkOrder, Conflict, TimeSlot, Session } from './types';
import { getDayKey, getNextShiftInterval } from '../utils/date';
import { DateTime } from 'luxon';
import { Validator } from './validator';

export class GlobalSchedule {
  // A Map of WC ids to a Map of day keys to a list of scheduled events.
  // day keys are derived from the UTC timestamp
  private scheduledEvents: Map<string, Map<number, Array<ScheduledEvent>>> = new Map();
  private workCenters: Map<string, WorkCenter>;
  // this should be configurable. using 365 days as a default.
  MAX_DAYS_LOOKAHEAD: number = 365;

  constructor(workCenters: WorkCenter[]) {
    this.workCenters = new Map(workCenters.map((wc) => [wc.docId, wc]));
    this.scheduledEvents = new Map(workCenters.map((wc) => [wc.docId, new Map<number, Array<ScheduledEvent>>()]));
  }

  public getScheduledEvents(wcId: string, dateKey: number): ScheduledEvent[] {
    let wcSchedule = this.scheduledEvents.get(wcId);
    let dateSchedule: ScheduledEvent[] | undefined = wcSchedule?.get(dateKey);
    if (!dateSchedule) {
      dateSchedule = [];
      wcSchedule?.set(dateKey, dateSchedule);
    }
    return dateSchedule;
  }

  // Check if desired start time is in a valid shift
  private validateInitialSchedule(startDate: string, workCenter: WorkCenter, explanation: string[]): void {
    const dayOfWeek = DateTime.fromISO(startDate).weekday % 7;
    const hasShiftOnStartDay = workCenter.data.shifts.some((s) => s.dayOfWeek === dayOfWeek);
    if (!hasShiftOnStartDay) {
      explanation.push('No shift available on initial date');
    }
  }

  // Find all conflicts (maintenance windows + existing events) for a shift period
  private findConflictsForShift(workCenter: WorkCenter, shiftStart: DateTime, shiftEnd: DateTime): Conflict[] {
    // Get maintenance windows that overlap with this shift
    const maintenanceWindows = workCenter.data.maintenanceWindows.filter((mw) => {
      const mwStart = DateTime.fromISO(mw.startDate).toUTC();
      const mwEnd = DateTime.fromISO(mw.endDate).toUTC();
      return mwEnd > shiftStart && mwStart < shiftEnd;
    });

    // Get existing events for this day (and potentially adjacent days if shift spans midnight)
    const dayKeys = new Set<number>();
    dayKeys.add(getDayKey(shiftStart));
    if (!shiftEnd.hasSame(shiftStart, 'day')) {
      dayKeys.add(getDayKey(shiftEnd));
    }

    const existingEvents: ScheduledEvent[] = [];
    for (const dayKey of dayKeys) {
      existingEvents.push(...this.getScheduledEvents(workCenter.docId, dayKey));
    }

    return [...maintenanceWindows, ...existingEvents]
      .map((el) => ({
        startDate: DateTime.fromISO(el.startDate).toUTC(),
        endDate: DateTime.fromISO(el.endDate).toUTC(),
      }))
      .sort((a, b) => a.startDate.toMillis() - b.startDate.toMillis());
  }

  // Calculate available time slots within a shift, accounting for conflicts
  private findAvailableSlots(
    shiftInterval: any,
    conflicts: Conflict[],
    currentTime: DateTime,
    explanation: string[]
  ): TimeSlot[] {
    const availableSlots: TimeSlot[] = [];
    let lastEnd = shiftInterval.startDate;

    // Check if current time conflicts with maintenance
    const currentTimeConflicts = conflicts.some(
      (conflict) => conflict.startDate <= currentTime && conflict.endDate > currentTime
    );

    if (currentTimeConflicts) {
      explanation.push('Maintenance window conflict');
    }

    for (const conflict of conflicts) {
      // Add slot from lastEnd to conflict start (if there's space)
      if (conflict.startDate > lastEnd) {
        const slotStart = DateTime.max(lastEnd, currentTime);
        if (slotStart < conflict.startDate) {
          availableSlots.push({
            start: slotStart,
            end: conflict.startDate,
          });
        }
      }
      lastEnd = DateTime.max(lastEnd, conflict.endDate);
    }

    // Add final slot until end of shift
    if (lastEnd < shiftInterval.endDate) {
      const slotStart = DateTime.max(lastEnd, currentTime);
      if (slotStart < shiftInterval.endDate) {
        availableSlots.push({
          start: slotStart,
          end: shiftInterval.endDate,
        });
      }
    }

    return availableSlots;
  }

  // Schedule work within available time slots, creating sessions and updating schedule
  private scheduleWorkInSlots(
    slots: TimeSlot[],
    workOrder: WorkOrder,
    workCenter: WorkCenter,
    sessions: Session[],
    remainingDuration: number,
    currentTime: DateTime
  ): { remainingDuration: number; currentTime: DateTime } {
    let duration = remainingDuration;
    let time = currentTime;

    for (const slot of slots) {
      if (duration <= 0) break;

      const slotDuration = slot.end.diff(slot.start, 'minutes').minutes;
      if (slotDuration <= 0) continue;

      // Calculate how much time we can actually work in this slot
      const isNewSession =
        sessions.length === 0 || DateTime.fromISO(sessions[sessions.length - 1].endDate) < slot.start;
      const setupTime = isNewSession ? workOrder.data.setupTimeMinutes : 0;
      const availableWorkTime = Math.max(0, slotDuration - setupTime);

      if (availableWorkTime <= 0) continue;

      const workTime = Math.min(duration, availableWorkTime);
      const sessionEnd = slot.start.plus({ minutes: setupTime + workTime });

      const sessionStartISO = slot.start.toISO({ suppressMilliseconds: true })!;
      const sessionEndISO = sessionEnd.toISO({ suppressMilliseconds: true })!;

      sessions.push({
        setupTimeMinutes: setupTime,
        durationTimeMinutes: workTime,
        startDate: sessionStartISO,
        endDate: sessionEndISO,
      });

      // Add to scheduled events
      const scheduledEvent: ScheduledEvent = {
        workOrderId: workOrder.docId,
        workCenterId: workOrder.data.workCenterId,
        manufacturingOrderId: workOrder.data.manufacturingOrderId,
        isMaintenance: workOrder.data.isMaintenance,
        setupTimeMinutes: setupTime,
        durationTimeMinutes: workTime,
        startDate: sessionStartISO,
        endDate: sessionEndISO,
      };

      const dayKey = getDayKey(slot.start);
      const dayEvents = this.getScheduledEvents(workCenter.docId, dayKey);
      dayEvents.push(scheduledEvent);

      duration -= workTime;
      time = sessionEnd;

      if (duration <= 0) break;
    }

    return { remainingDuration: duration, currentTime: time };
  }

  // Update work order with final session data and recalculated timing
  private updateWorkOrderTiming(workOrder: WorkOrder, sessions: Session[]): void {
    workOrder.data.sessions = sessions;
    workOrder.data.startDate = DateTime.fromISO(sessions[0].startDate).toUTC().toISO({ suppressMilliseconds: true })!;
    workOrder.data.endDate = DateTime.fromISO(sessions[sessions.length - 1].endDate)
      .toUTC()
      .toISO({ suppressMilliseconds: true })!;
  }

  addWorkOrder(workOrder: WorkOrder) {
    const workCenter = this.workCenters.get(workOrder.data.workCenterId);
    if (!workCenter) throw new Error(`Work center ${workOrder.data.workCenterId} not found`);

    const explanation: string[] = [];
    let currentTime = DateTime.fromISO(workOrder.data.startDate).toUTC();
    let remainingDuration = workOrder.data.durationMinutes;

    this.validateInitialSchedule(workOrder.data.startDate, workCenter, explanation);
    const sessions: Session[] = [];

    while (
      remainingDuration > 0 &&
      currentTime < DateTime.fromISO(workOrder.data.startDate).plus({ days: this.MAX_DAYS_LOOKAHEAD })
    ) {
      const shiftInterval = getNextShiftInterval(workCenter, currentTime);
      if (shiftInterval.startDate > currentTime) {
        // Move to next shift
        currentTime = shiftInterval.startDate;
      }

      // Get all conflicts for this shift
      const shiftConflicts = this.findConflictsForShift(workCenter, shiftInterval.startDate, shiftInterval.endDate);

      // If current time is inside a conflict, move past it
      const activeConflict = shiftConflicts.find((c) => currentTime >= c.startDate && currentTime < c.endDate);
      if (activeConflict) {
        currentTime = activeConflict.endDate;
      }

      // Find available time slots within this shift
      const availableSlots = this.findAvailableSlots(shiftInterval, shiftConflicts, currentTime, explanation);

      // Try to schedule work in available slots
      const schedulingResult = this.scheduleWorkInSlots(
        availableSlots,
        workOrder,
        workCenter,
        sessions,
        remainingDuration,
        currentTime
      );
      remainingDuration = schedulingResult.remainingDuration;
      currentTime = schedulingResult.currentTime;

      if (remainingDuration > 0) {
        // Move to next shift
        currentTime = shiftInterval.endDate;
      }
    }

    this.updateWorkOrderTiming(workOrder, sessions);

    return {
      workOrder,
      explanation,
    };
  }
}

```

```typescript
import type { ScheduledEvent, WorkCenter, WorkOrder, Conflict, TimeSlot, Session } from './types';
import { getDayKey, getNextShiftInterval } from '../utils/date';
import { DateTime } from 'luxon';
import { Validator } from './validator';

export class GlobalSchedule {
  // A Map of WC ids to a Map of day keys to a list of scheduled events.
  // day keys are derived from the UTC timestamp
  private scheduledEvents: Map<string, Map<number, Array<ScheduledEvent>>> = new Map();
  private workCenters: Map<string, WorkCenter>;
  // this should be configurable. using 365 days as a default.
  MAX_DAYS_LOOKAHEAD: number = 365;

  constructor(workCenters: WorkCenter[]) {
    this.workCenters = new Map(workCenters.map((wc) => [wc.docId, wc]));
    this.scheduledEvents = new Map(workCenters.map((wc) => [wc.docId, new Map<number, Array<ScheduledEvent>>()]));
  }

  public getScheduledEvents(wcId: string, dateKey: number): ScheduledEvent[] {
    let wcSchedule = this.scheduledEvents.get(wcId);
    let dateSchedule: ScheduledEvent[] | undefined = wcSchedule?.get(dateKey);
    if (!dateSchedule) {
      dateSchedule = [];
      wcSchedule?.set(dateKey, dateSchedule);
    }
    return dateSchedule;
  }

  // Check if desired start time is in a valid shift
  private validateInitialSchedule(startDate: string, workCenter: WorkCenter, explanation: string[]): void {
    const dayOfWeek = DateTime.fromISO(startDate).weekday % 7;
    const hasShiftOnStartDay = workCenter.data.shifts.some((s) => s.dayOfWeek === dayOfWeek);
    if (!hasShiftOnStartDay) {
      explanation.push('No shift available on initial date');
    }
  }

  // Find all conflicts (maintenance windows + existing events) for a shift period
  private findConflictsForShift(workCenter: WorkCenter, shiftStart: DateTime, shiftEnd: DateTime): Conflict[] {
    // Get maintenance windows that overlap with this shift
    const maintenanceWindows = workCenter.data.maintenanceWindows.filter((mw) => {
      const mwStart = DateTime.fromISO(mw.startDate).toUTC();
      const mwEnd = DateTime.fromISO(mw.endDate).toUTC();
      return mwEnd > shiftStart && mwStart < shiftEnd;
    });

    // Get existing events for this day (and potentially adjacent days if shift spans midnight)
    const dayKeys = new Set<number>();
    dayKeys.add(getDayKey(shiftStart));
    if (!shiftEnd.hasSame(shiftStart, 'day')) {
      dayKeys.add(getDayKey(shiftEnd));
    }

    const existingEvents: ScheduledEvent[] = [];
    for (const dayKey of dayKeys) {
      existingEvents.push(...this.getScheduledEvents(workCenter.docId, dayKey));
    }

    return [...maintenanceWindows, ...existingEvents]
      .map((el) => ({
        startDate: DateTime.fromISO(el.startDate).toUTC(),
        endDate: DateTime.fromISO(el.endDate).toUTC(),
      }))
      .sort((a, b) => a.startDate.toMillis() - b.startDate.toMillis());
  }

  // Calculate available time slots within a shift, accounting for conflicts
  private findAvailableSlots(
    shiftInterval: any,
    conflicts: Conflict[],
    currentTime: DateTime,
    explanation: string[]
  ): TimeSlot[] {
    const availableSlots: TimeSlot[] = [];
    let lastEnd = shiftInterval.startDate;

    // Check if current time conflicts with maintenance
    const currentTimeConflicts = conflicts.some(
      (conflict) => conflict.startDate <= currentTime && conflict.endDate > currentTime
    );

    if (currentTimeConflicts) {
      explanation.push('Maintenance window conflict');
    }

    for (const conflict of conflicts) {
      // Add slot from lastEnd to conflict start (if there's space)
      if (conflict.startDate > lastEnd) {
        const slotStart = DateTime.max(lastEnd, currentTime);
        if (slotStart < conflict.startDate) {
          availableSlots.push({
            start: slotStart,
            end: conflict.startDate,
          });
        }
      }
      lastEnd = DateTime.max(lastEnd, conflict.endDate);
    }

    // Add final slot until end of shift
    if (lastEnd < shiftInterval.endDate) {
      const slotStart = DateTime.max(lastEnd, currentTime);
      if (slotStart < shiftInterval.endDate) {
        availableSlots.push({
          start: slotStart,
          end: shiftInterval.endDate,
        });
      }
    }

    return availableSlots;
  }

  // Schedule work within available time slots, creating sessions and updating schedule
  private scheduleWorkInSlots(
    slots: TimeSlot[],
    workOrder: WorkOrder,
    workCenter: WorkCenter,
    sessions: Session[],
    remainingDuration: number,
    currentTime: DateTime
  ): { remainingDuration: number; currentTime: DateTime } {
    let duration = remainingDuration;
    let time = currentTime;

    for (const slot of slots) {
      if (duration <= 0) break;

      const slotDuration = slot.end.diff(slot.start, 'minutes').minutes;
      if (slotDuration <= 0) continue;

      // Calculate how much time we can actually work in this slot
      const isNewSession =
        sessions.length === 0 || DateTime.fromISO(sessions[sessions.length - 1].endDate) < slot.start;
      const setupTime = isNewSession ? workOrder.data.setupTimeMinutes : 0;
      const availableWorkTime = Math.max(0, slotDuration - setupTime);

      if (availableWorkTime <= 0) continue;

      const workTime = Math.min(duration, availableWorkTime);
      const sessionEnd = slot.start.plus({ minutes: setupTime + workTime });

      const sessionStartISO = slot.start.toISO({ suppressMilliseconds: true })!;
      const sessionEndISO = sessionEnd.toISO({ suppressMilliseconds: true })!;

      sessions.push({
        setupTimeMinutes: setupTime,
        durationTimeMinutes: workTime,
        startDate: sessionStartISO,
        endDate: sessionEndISO,
      });

      // Add to scheduled events
      const scheduledEvent: ScheduledEvent = {
        workOrderId: workOrder.docId,
        workCenterId: workOrder.data.workCenterId,
        manufacturingOrderId: workOrder.data.manufacturingOrderId,
        isMaintenance: workOrder.data.isMaintenance,
        setupTimeMinutes: setupTime,
        durationTimeMinutes: workTime,
        startDate: sessionStartISO,
        endDate: sessionEndISO,
      };

      const dayKey = getDayKey(slot.start);
      const dayEvents = this.getScheduledEvents(workCenter.docId, dayKey);
      dayEvents.push(scheduledEvent);

      duration -= workTime;
      time = sessionEnd;

      if (duration <= 0) break;
    }

    return { remainingDuration: duration, currentTime: time };
  }

  // Update work order with final session data and recalculated timing
  private updateWorkOrderTiming(workOrder: WorkOrder, sessions: Session[]): void {
    workOrder.data.sessions = sessions;
    workOrder.data.startDate = DateTime.fromISO(sessions[0].startDate).toUTC().toISO({ suppressMilliseconds: true })!;
    workOrder.data.endDate = DateTime.fromISO(sessions[sessions.length - 1].endDate)
      .toUTC()
      .toISO({ suppressMilliseconds: true })!;
  }

  addWorkOrder(workOrder: WorkOrder) {
    const workCenter = this.workCenters.get(workOrder.data.workCenterId);
    if (!workCenter) throw new Error(`Work center ${workOrder.data.workCenterId} not found`);

    const explanation: string[] = [];
    let currentTime = DateTime.fromISO(workOrder.data.startDate).toUTC();
    let remainingDuration = workOrder.data.durationMinutes;

    this.validateInitialSchedule(workOrder.data.startDate, workCenter, explanation);
    const sessions: Session[] = [];

    while (
      remainingDuration > 0 &&
      currentTime < DateTime.fromISO(workOrder.data.startDate).plus({ days: this.MAX_DAYS_LOOKAHEAD })
    ) {
      const shiftInterval = getNextShiftInterval(workCenter, currentTime);
      if (shiftInterval.startDate > currentTime) {
        // Move to next shift
        currentTime = shiftInterval.startDate;
      }

      // Get all conflicts for this shift
      const shiftConflicts = this.findConflictsForShift(workCenter, shiftInterval.startDate, shiftInterval.endDate);

      // If current time is inside a conflict, move past it
      const activeConflict = shiftConflicts.find((c) => currentTime >= c.startDate && currentTime < c.endDate);
      if (activeConflict) {
        currentTime = activeConflict.endDate;
      }

      // Find available time slots within this shift
      const availableSlots = this.findAvailableSlots(shiftInterval, shiftConflicts, currentTime, explanation);

      // Try to schedule work in available slots
      const schedulingResult = this.scheduleWorkInSlots(
        availableSlots,
        workOrder,
        workCenter,
        sessions,
        remainingDuration,
        currentTime
      );
      remainingDuration = schedulingResult.remainingDuration;
      currentTime = schedulingResult.currentTime;

      if (remainingDuration > 0) {
        // Move to next shift
        currentTime = shiftInterval.endDate;
      }
    }

    Validator.postSchedule(workOrder, sessions, remainingDuration, this.MAX_DAYS_LOOKAHEAD);
    Validator.sessionsNoOverlap(sessions);
    this.updateWorkOrderTiming(workOrder, sessions);
    return { workOrder, explanation };
  }
}

```

Let me check for lints and also remove unused code:

Let me remove the unused methods:

```typescript
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
import { Validator } from './validator';

export class ReflowService implements IReflowService {
  private workCenters: Map<string, WorkCenter>;
  private globalSchedule: GlobalSchedule;

  constructor(workCenters: WorkCenter[]) {
    this.workCenters = new Map(workCenters.map((wc) => [wc.docId, wc])); // for O(1) lookups
    this.globalSchedule = new GlobalSchedule(workCenters);
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

```

```typescript
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
import { Validator } from './validator';

export class ReflowService implements IReflowService {
  private workCenters: Map<string, WorkCenter>;
  private globalSchedule: GlobalSchedule;

  constructor(workCenters: WorkCenter[]) {
    this.workCenters = new Map(workCenters.map((wc) => [wc.docId, wc])); // for O(1) lookups
    this.globalSchedule = new GlobalSchedule(workCenters);
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

```

```typescript
import { DateTime } from 'luxon';
import type {
  IReflowService,
  ReflowChange,
  ReflowInput,
  ReflowResult,
  ScheduledWorkOrder,
  WorkOrder,
} from './types';
import { GlobalSchedule } from './globalSchedule';
import { Validator } from './validator';

export class ReflowService implements IReflowService {
  private workCenters: Map<string, WorkCenter>;
  private globalSchedule: GlobalSchedule;

  constructor(workCenters: WorkCenter[]) {
    this.workCenters = new Map(workCenters.map((wc) => [wc.docId, wc])); // for O(1) lookups
    this.globalSchedule = new GlobalSchedule(workCenters);
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

```

Let me fix both issues:

```typescript
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
import { Validator } from './validator';

export class ReflowService implements IReflowService {
  private workCenters: Map<string, WorkCenter>;
  private globalSchedule: GlobalSchedule;

  constructor(workCenters: WorkCenter[]) {
    this.workCenters = new Map(workCenters.map((wc) => [wc.docId, wc])); // for O(1) lookups
    this.globalSchedule = new GlobalSchedule(workCenters);
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

```

```typescript
import { DateTime } from 'luxon';
import type { WorkOrder, WorkCenter, Session } from './types';

export class ValidationError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export const Validator = {
  // Pre-scheduling checks
  preSchedule(wo: WorkOrder, workCenters: Map<string, WorkCenter>): void {
    const wc = workCenters.get(wo.data.workCenterId);
    if (!wc) throw new ValidationError('WC_NOT_FOUND', `Work center ${wo.data.workCenterId} not found`);
    if (!wc.data.shifts?.length) throw new ValidationError('NO_SHIFTS', `Work center ${wc.docId} has no shifts`);
    if (wo.data.durationMinutes <= 0) throw new ValidationError('INVALID_DURATION', `Work order ${wo.docId} has invalid duration`);
    if (wo.data.setupTimeMinutes < 0) throw new ValidationError('INVALID_SETUP', `Work order ${wo.docId} has negative setup time`);
    if (!DateTime.fromISO(wo.data.startDate).isValid) throw new ValidationError('INVALID_START', `Work order ${wo.docId} has invalid start date`);
    if (wo.data.dependsOnWorkOrderIds.includes(wo.docId)) throw new ValidationError('SELF_REF', `Work order ${wo.docId} depends on itself`);
  },
  maintenanceNotReschedulable(wo: WorkOrder, needsReschedule: boolean): void {
    if (wo.data.isMaintenance && needsReschedule) {
      throw new ValidationError('MAINT_RESCHEDULE', `Maintenance work order ${wo.docId} cannot be rescheduled`);
    }
  },
  // During-scheduling checks
  dependenciesSatisfied(wo: WorkOrder, startTime: DateTime, scheduledWOs: Map<string, WorkOrder>): void {
    for (const depId of wo.data.dependsOnWorkOrderIds) {
      const parent = scheduledWOs.get(depId);
      if (!parent) continue;
      const parentEnd = DateTime.fromISO(parent.data.endDate).toUTC();
      if (parentEnd > startTime) {
        throw new ValidationError('DEP_UNSATISFIED', `Work order ${wo.docId} starts before dependency ${depId} ends`);
      }
    }
  },
  // Post-scheduling checks
  postSchedule(wo: WorkOrder, sessions: Session[], remainingDuration: number, maxDays: number): void {
    if (remainingDuration > 0) {
      throw new ValidationError('INCOMPLETE', `Work order ${wo.docId} not fully scheduled: ${remainingDuration}min remaining`);
    }
    if (!sessions.length) {
      throw new ValidationError('NO_SESSIONS', `Work order ${wo.docId} has no scheduled sessions`);
    }
    const start = DateTime.fromISO(wo.data.startDate).toUTC();
    const end = DateTime.fromISO(sessions[sessions.length - 1].endDate).toUTC();
    if (end.diff(start, 'days').days > maxDays) {
      throw new ValidationError('HORIZON_EXCEEDED', `Work order ${wo.docId} exceeds ${maxDays}-day scheduling horizon`);
    }
  },
  sessionsNoOverlap(sessions: Session[]): void {
    const sorted = [...sessions].sort((a, b) => DateTime.fromISO(a.startDate).toMillis() - DateTime.fromISO(b.startDate).toMillis());
    for (let i = 1; i < sorted.length; i++) {
      const prev = DateTime.fromISO(sorted[i - 1].endDate);
      const curr = DateTime.fromISO(sorted[i].startDate);
      if (curr < prev) {
        throw new ValidationError('SESSION_OVERLAP', `Sessions overlap: ${sorted[i - 1].endDate} > ${sorted[i].startDate}`);
      }
    }
  }
};


```

Let me run the tests to ensure the validation doesn't break existing functionality:

All tests pass. Here's a summary of the validation checks implemented:

**Created `/src/reflow/validator.ts`** with:

| Check | Validation | When |
|-------|------------|------|
| `WC_NOT_FOUND` | Work center exists | Pre-schedule |
| `NO_SHIFTS` | Work center has shifts | Pre-schedule |
| `INVALID_DURATION` | Duration > 0 | Pre-schedule |
| `INVALID_SETUP` | Setup time >= 0 | Pre-schedule |
| `INVALID_START` | Valid ISO start date | Pre-schedule |
| `SELF_REF` | WO doesn't depend on itself | Pre-schedule |
| `MAINT_RESCHEDULE` | Maintenance WO not rescheduled | Pre-schedule |
| `DEP_UNSATISFIED` | Parents complete before child starts | During-schedule |
| `INCOMPLETE` | Remaining duration = 0 | Post-schedule |
| `NO_SESSIONS` | At least one session created | Post-schedule |
| `HORIZON_EXCEEDED` | End date within max days | Post-schedule |
| `SESSION_OVERLAP` | Sessions don't overlap | Post-schedule |

**Other checks already in place:**
- Cycle detection (topological sort)
- Dependency existence validation
- Duplicate work order detection
- Multi-day conflict handling (in `GlobalSchedule`)
- Maintenance window conflicts (in `GlobalSchedule`)
- Shift boundary handling (in `GlobalSchedule`)

