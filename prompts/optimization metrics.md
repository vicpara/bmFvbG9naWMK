# Optimization metrics implementation status
_Exported on 27/12/2025 at 17:45:56 EET from Cursor (2.2.44)_

---

**User**

As per @public/BE-technical-test.md lets implement 
Optimization Metrics (Bonus)
Spec suggests tracking:
Total delay introduced: Σ (new_end_date - original_end_date) — NOT IMPLEMENTED
Number of work orders affected — partially (count of changes array)
Utilization metrics: (total working minutes) / (total available shift minutes) — NOT IMPLEMENTED
Work center idle time analysis — NOT IMPLEMENTED

---

**Cursor**

I'll examine the current implementation to understand the structure and then implement the optimization metrics.

Now I understand the structure. I'll implement the optimization metrics. Let me create a plan and implement it:

```typescript
import type { DateTime } from "luxon";

// Base document structure
export interface Document {
  docId: string;
  docType: string;
  data: Record<string, any>;
}

export interface Shift {
  dayOfWeek: number; // 0-6, Sunday = 0
  startHour: number; // 0-23
  endHour: number; // 0-23
}
// Work Center document
export interface WorkCenter extends Document {
  docType: 'workCenter';
  data: {
    name: string;

    // Shifts
    shifts: Array<Shift>;

    // Maintenance windows (blocked time periods)
    maintenanceWindows: Array<{
      startDate: string;
      endDate: string;
      reason?: string; // Optional description
    }>;
  };
}

export interface ShiftInterval {
  startDate: DateTime;
  endDate: DateTime;
}

// Manufacturing Order document - for "context"
// This object doesn't seem to impact the reflow algorithm, but it's used to provide context for the algorithm.
// Ignored throughout this implementation. Most likely used for the initial WO scheduling.
export interface ManufacturingOrder extends Document {
  docType: 'manufacturingOrder';
  data: {
    manufacturingOrderNumber: string;
    itemId: string;
    quantity: number;
    dueDate: string;
  };
}

// I'm introducing sessions to track work that happens across multiple shifts.
// start and end date are insufficient to track multi-shift work.
export interface Session {
  // @assumption, each time a session is started, it requires a mandatory setup time,
  // each time. This is true even when a shift ends with a WO and starts with the same WO.
  // Of course, ideally this would be configurable at WO/MO level
  setupTimeMinutes: number;
  durationTimeMinutes: number;
  startDate: string;
  endDate: string;
}

// Work Order document
// @assumption, a WorkOrder chain can only have all WO with isMaintenance set to true or false. It cannot be a mix of both.
// It actually doesn't make sense. A WO cannot both depend on a previous WOs and have a fixed start and end date and cannot be rescheduled based on dependants.
export interface WorkOrder extends Document {
  docType: 'workOrder';
  data: {
    workOrderNumber: string;
    manufacturingOrderId: string;
    workCenterId: string;

    // Timing
    durationMinutes: number; // Total working time required
    setupTimeMinutes: number;

    startDate: string;
    endDate: string;
    sessions: Array<Session>;
    // Constraints
    isMaintenance: boolean; // Cannot be rescheduled if true

    // Dependencies (can have multiple parents)
    dependsOnWorkOrderIds: string[]; // All must complete before this starts
  };
}

// Reflow algorithm input/output types
export interface ReflowInput {
  workOrders: WorkOrder[];
  manufacturingOrders: ManufacturingOrder[];
}

export interface ReflowResult {
  updatedWorkOrders: WorkOrder[];
  changes: ReflowChange[];
  explanation: string[];
}

export interface ScheduledWorkOrder {
  workOrder: WorkOrder;
  wasRescheduled: boolean;
  change?: ReflowChange;
  explanation?: string[];
}

export interface ReflowChange {
  workOrderId: string;
  originalStartDate: string;
  originalEndDate: string;
  newStartDate: string;
  newEndDate: string;
  reason: string[];
}

export interface IReflowService {
  reflow(input: ReflowInput): ReflowResult;
}

export interface ScheduledEvent extends Session {
  workOrderId: string;
  workCenterId: string;
  manufacturingOrderId: string;
  isMaintenance: boolean;
}

// Internal scheduling types for GlobalSchedule
export interface Conflict {
  startDate: DateTime;
  endDate: DateTime;
}

export interface TimeSlot {
  start: DateTime;
  end: DateTime;
}

export interface WorkCenterMetrics {
  workCenterId: string;
  workCenterName: string;
  totalShiftMinutes: number;
  totalWorkingMinutes: number;
  totalIdleMinutes: number;
  utilization: number; // 0-1 ratio
}

export interface OptimizationMetrics {
  totalDelayMinutes: number;
  workOrdersAffectedCount: number;
  workOrdersUnchangedCount: number;
  overallUtilization: number; // 0-1 ratio
  workCenterMetrics: WorkCenterMetrics[];
}

```

```typescript
import type { DateTime } from "luxon";

// Base document structure
export interface Document {
  docId: string;
  docType: string;
  data: Record<string, any>;
}

export interface Shift {
  dayOfWeek: number; // 0-6, Sunday = 0
  startHour: number; // 0-23
  endHour: number; // 0-23
}
// Work Center document
export interface WorkCenter extends Document {
  docType: 'workCenter';
  data: {
    name: string;

    // Shifts
    shifts: Array<Shift>;

    // Maintenance windows (blocked time periods)
    maintenanceWindows: Array<{
      startDate: string;
      endDate: string;
      reason?: string; // Optional description
    }>;
  };
}

export interface ShiftInterval {
  startDate: DateTime;
  endDate: DateTime;
}

// Manufacturing Order document - for "context"
// This object doesn't seem to impact the reflow algorithm, but it's used to provide context for the algorithm.
// Ignored throughout this implementation. Most likely used for the initial WO scheduling.
export interface ManufacturingOrder extends Document {
  docType: 'manufacturingOrder';
  data: {
    manufacturingOrderNumber: string;
    itemId: string;
    quantity: number;
    dueDate: string;
  };
}

// I'm introducing sessions to track work that happens across multiple shifts.
// start and end date are insufficient to track multi-shift work.
export interface Session {
  // @assumption, each time a session is started, it requires a mandatory setup time,
  // each time. This is true even when a shift ends with a WO and starts with the same WO.
  // Of course, ideally this would be configurable at WO/MO level
  setupTimeMinutes: number;
  durationTimeMinutes: number;
  startDate: string;
  endDate: string;
}

// Work Order document
// @assumption, a WorkOrder chain can only have all WO with isMaintenance set to true or false. It cannot be a mix of both.
// It actually doesn't make sense. A WO cannot both depend on a previous WOs and have a fixed start and end date and cannot be rescheduled based on dependants.
export interface WorkOrder extends Document {
  docType: 'workOrder';
  data: {
    workOrderNumber: string;
    manufacturingOrderId: string;
    workCenterId: string;

    // Timing
    durationMinutes: number; // Total working time required
    setupTimeMinutes: number;

    startDate: string;
    endDate: string;
    sessions: Array<Session>;
    // Constraints
    isMaintenance: boolean; // Cannot be rescheduled if true

    // Dependencies (can have multiple parents)
    dependsOnWorkOrderIds: string[]; // All must complete before this starts
  };
}

// Reflow algorithm input/output types
export interface ReflowInput {
  workOrders: WorkOrder[];
  manufacturingOrders: ManufacturingOrder[];
}

export interface ReflowResult {
  updatedWorkOrders: WorkOrder[];
  changes: ReflowChange[];
  explanation: string[];
  metrics: OptimizationMetrics;
}

export interface ScheduledWorkOrder {
  workOrder: WorkOrder;
  wasRescheduled: boolean;
  change?: ReflowChange;
  explanation?: string[];
}

export interface ReflowChange {
  workOrderId: string;
  originalStartDate: string;
  originalEndDate: string;
  newStartDate: string;
  newEndDate: string;
  reason: string[];
}

export interface IReflowService {
  reflow(input: ReflowInput): ReflowResult;
}

export interface ScheduledEvent extends Session {
  workOrderId: string;
  workCenterId: string;
  manufacturingOrderId: string;
  isMaintenance: boolean;
}

// Internal scheduling types for GlobalSchedule
export interface Conflict {
  startDate: DateTime;
  endDate: DateTime;
}

export interface TimeSlot {
  start: DateTime;
  end: DateTime;
}

export interface WorkCenterMetrics {
  workCenterId: string;
  workCenterName: string;
  totalShiftMinutes: number;
  totalWorkingMinutes: number;
  totalIdleMinutes: number;
  utilization: number; // 0-1 ratio
}

export interface OptimizationMetrics {
  totalDelayMinutes: number;
  workOrdersAffectedCount: number;
  workOrdersUnchangedCount: number;
  overallUtilization: number; // 0-1 ratio
  workCenterMetrics: WorkCenterMetrics[];
}

```

Now I need to implement the metrics calculation. I'll add a method to GlobalSchedule to compute work center metrics and update ReflowService to calculate all metrics:

```typescript
import type { ScheduledEvent, WorkCenter, WorkOrder, Conflict, TimeSlot, Session, WorkCenterMetrics } from './types';
import { getDayKey, getNextShiftInterval } from '../utils/date';
import { DateTime } from 'luxon';
import { Validator, createConstraintContext, type ScheduleConstraintContext } from './validator';

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
    const constraintCtx = createConstraintContext();
    constraintCtx.requiredMinutes = workOrder.data.durationMinutes + workOrder.data.setupTimeMinutes;
    let currentTime = DateTime.fromISO(workOrder.data.startDate).toUTC();
    let remainingDuration = workOrder.data.durationMinutes;
    let shiftsFound = false;

    this.validateInitialSchedule(workOrder.data.startDate, workCenter, explanation);
    const sessions: Session[] = [];

    while (
      remainingDuration > 0 &&
      currentTime < DateTime.fromISO(workOrder.data.startDate).plus({ days: this.MAX_DAYS_LOOKAHEAD })
    ) {
      const shiftInterval = getNextShiftInterval(workCenter, currentTime);
      shiftsFound = true;
      if (shiftInterval.startDate > currentTime) {
        currentTime = shiftInterval.startDate;
      }

      const shiftConflicts = this.findConflictsForShift(workCenter, shiftInterval.startDate, shiftInterval.endDate);
      this.trackConflicts(shiftConflicts, workCenter, constraintCtx);

      const activeConflict = shiftConflicts.find((c) => currentTime >= c.startDate && currentTime < c.endDate);
      if (activeConflict) {
        currentTime = activeConflict.endDate;
      }

      const availableSlots = this.findAvailableSlots(shiftInterval, shiftConflicts, currentTime, explanation);
      constraintCtx.totalAvailableMinutes += availableSlots.reduce(
        (sum, slot) => sum + slot.end.diff(slot.start, 'minutes').minutes,
        0
      );

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
        currentTime = shiftInterval.endDate;
      }
    }

    constraintCtx.noShiftsAvailable = !shiftsFound;
    constraintCtx.allTimeBlocked = shiftsFound && constraintCtx.totalAvailableMinutes === 0;
    Validator.postSchedule(workOrder, sessions, remainingDuration, this.MAX_DAYS_LOOKAHEAD, constraintCtx);
    Validator.sessionsNoOverlap(sessions);
    this.updateWorkOrderTiming(workOrder, sessions);
    return { workOrder, explanation };
  }

  private trackConflicts(
    conflicts: Conflict[],
    workCenter: WorkCenter,
    ctx: ScheduleConstraintContext
  ): void {
    for (const conflict of conflicts) {
      const maintenanceMatch = workCenter.data.maintenanceWindows.find(
        (mw) =>
          DateTime.fromISO(mw.startDate).toMillis() === conflict.startDate.toMillis() &&
          DateTime.fromISO(mw.endDate).toMillis() === conflict.endDate.toMillis()
      );
      if (maintenanceMatch) {
        if (!ctx.maintenanceConflicts.some((m) => m.startDate === maintenanceMatch.startDate)) {
          ctx.maintenanceConflicts.push(maintenanceMatch);
        }
      }
    }
  }
}

```

```typescript
import type { ScheduledEvent, WorkCenter, WorkOrder, Conflict, TimeSlot, Session, WorkCenterMetrics } from './types';
import { getDayKey, getNextShiftInterval } from '../utils/date';
import { DateTime } from 'luxon';
import { Validator, createConstraintContext, type ScheduleConstraintContext } from './validator';

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
    const constraintCtx = createConstraintContext();
    constraintCtx.requiredMinutes = workOrder.data.durationMinutes + workOrder.data.setupTimeMinutes;
    let currentTime = DateTime.fromISO(workOrder.data.startDate).toUTC();
    let remainingDuration = workOrder.data.durationMinutes;
    let shiftsFound = false;

    this.validateInitialSchedule(workOrder.data.startDate, workCenter, explanation);
    const sessions: Session[] = [];

    while (
      remainingDuration > 0 &&
      currentTime < DateTime.fromISO(workOrder.data.startDate).plus({ days: this.MAX_DAYS_LOOKAHEAD })
    ) {
      const shiftInterval = getNextShiftInterval(workCenter, currentTime);
      shiftsFound = true;
      if (shiftInterval.startDate > currentTime) {
        currentTime = shiftInterval.startDate;
      }

      const shiftConflicts = this.findConflictsForShift(workCenter, shiftInterval.startDate, shiftInterval.endDate);
      this.trackConflicts(shiftConflicts, workCenter, constraintCtx);

      const activeConflict = shiftConflicts.find((c) => currentTime >= c.startDate && currentTime < c.endDate);
      if (activeConflict) {
        currentTime = activeConflict.endDate;
      }

      const availableSlots = this.findAvailableSlots(shiftInterval, shiftConflicts, currentTime, explanation);
      constraintCtx.totalAvailableMinutes += availableSlots.reduce(
        (sum, slot) => sum + slot.end.diff(slot.start, 'minutes').minutes,
        0
      );

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
        currentTime = shiftInterval.endDate;
      }
    }

    constraintCtx.noShiftsAvailable = !shiftsFound;
    constraintCtx.allTimeBlocked = shiftsFound && constraintCtx.totalAvailableMinutes === 0;
    Validator.postSchedule(workOrder, sessions, remainingDuration, this.MAX_DAYS_LOOKAHEAD, constraintCtx);
    Validator.sessionsNoOverlap(sessions);
    this.updateWorkOrderTiming(workOrder, sessions);
    return { workOrder, explanation };
  }

  private trackConflicts(
    conflicts: Conflict[],
    workCenter: WorkCenter,
    ctx: ScheduleConstraintContext
  ): void {
    for (const conflict of conflicts) {
      const maintenanceMatch = workCenter.data.maintenanceWindows.find(
        (mw) =>
          DateTime.fromISO(mw.startDate).toMillis() === conflict.startDate.toMillis() &&
          DateTime.fromISO(mw.endDate).toMillis() === conflict.endDate.toMillis()
      );
      if (maintenanceMatch) {
        if (!ctx.maintenanceConflicts.some((m) => m.startDate === maintenanceMatch.startDate)) {
          ctx.maintenanceConflicts.push(maintenanceMatch);
        }
      }
    }
  }

  computeWorkCenterMetrics(startDate: DateTime, endDate: DateTime): WorkCenterMetrics[] {
    const metrics: WorkCenterMetrics[] = [];
    for (const [wcId, wc] of this.workCenters) {
      const totalShiftMinutes = this.computeTotalShiftMinutes(wc, startDate, endDate);
      const totalWorkingMinutes = this.computeTotalWorkingMinutes(wcId, startDate, endDate);
      const totalIdleMinutes = Math.max(0, totalShiftMinutes - totalWorkingMinutes);
      metrics.push({
        workCenterId: wcId,
        workCenterName: wc.data.name,
        totalShiftMinutes,
        totalWorkingMinutes,
        totalIdleMinutes,
        utilization: totalShiftMinutes > 0 ? totalWorkingMinutes / totalShiftMinutes : 0,
      });
    }
    return metrics;
  }

  private computeTotalShiftMinutes(wc: WorkCenter, startDate: DateTime, endDate: DateTime): number {
    let totalMinutes = 0;
    let current = startDate.toUTC().startOf('day');
    const end = endDate.toUTC();
    while (current < end) {
      const dayOfWeek = current.weekday % 7;
      const shift = wc.data.shifts.find((s) => s.dayOfWeek === dayOfWeek);
      if (shift) {
        const shiftStart = current.plus({ hours: shift.startHour });
        const shiftEnd = current.plus({ hours: shift.endHour });
        const effectiveStart = DateTime.max(shiftStart, startDate);
        const effectiveEnd = DateTime.min(shiftEnd, end);
        if (effectiveStart < effectiveEnd) {
          let shiftMinutes = effectiveEnd.diff(effectiveStart, 'minutes').minutes;
          for (const mw of wc.data.maintenanceWindows) {
            const mwStart = DateTime.fromISO(mw.startDate).toUTC();
            const mwEnd = DateTime.fromISO(mw.endDate).toUTC();
            if (mwEnd > effectiveStart && mwStart < effectiveEnd) {
              const overlapStart = DateTime.max(mwStart, effectiveStart);
              const overlapEnd = DateTime.min(mwEnd, effectiveEnd);
              shiftMinutes -= overlapEnd.diff(overlapStart, 'minutes').minutes;
            }
          }
          totalMinutes += Math.max(0, shiftMinutes);
        }
      }
      current = current.plus({ days: 1 });
    }
    return totalMinutes;
  }

  private computeTotalWorkingMinutes(wcId: string, startDate: DateTime, endDate: DateTime): number {
    let totalMinutes = 0;
    const wcSchedule = this.scheduledEvents.get(wcId);
    if (!wcSchedule) return 0;
    for (const [, events] of wcSchedule) {
      for (const event of events) {
        const eventStart = DateTime.fromISO(event.startDate).toUTC();
        const eventEnd = DateTime.fromISO(event.endDate).toUTC();
        if (eventEnd > startDate && eventStart < endDate) {
          const effectiveStart = DateTime.max(eventStart, startDate);
          const effectiveEnd = DateTime.min(eventEnd, endDate);
          totalMinutes += effectiveEnd.diff(effectiveStart, 'minutes').minutes;
        }
      }
    }
    return totalMinutes;
  }
}

```

Now update the ReflowService to import the new types and calculate metrics:

```typescript
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

    return {
      updatedWorkOrders: Array.from(updatedWorkOrders.values()).sort(
        (a, b) => DateTime.fromISO(a.data.startDate).toMillis() - DateTime.fromISO(b.data.startDate).toMillis()
      ),
      changes,
      explanation: explanations,
    };
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

```

```typescript
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

```

```typescript
// Main entry point for the reflow library
export { ReflowService } from "./reflow/reflow.service";
export type { WorkOrder, WorkCenter, ManufacturingOrder, ReflowInput, ReflowResult, OptimizationMetrics, WorkCenterMetrics } from "./reflow/types";

```

Now let me read the existing tests to understand the testing patterns and add tests for metrics:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { ReflowService } from '../src/reflow/reflow.service';
import type { WorkCenter, WorkOrder, ManufacturingOrder, ReflowInput, OptimizationMetrics } from '../src/reflow/types';
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

});

```

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { ReflowService } from '../src/reflow/reflow.service';
import type { WorkCenter, WorkOrder, ManufacturingOrder, ReflowInput, OptimizationMetrics } from '../src/reflow/types';
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
      expect(result.metrics.overallUtilization).toBeCloseTo((120 + 60) / (120 + 60), 2); // both are 100% utilized within their bounds
    });
  });
});

```

The test expectation was incorrect. The schedule bounds span 8:00-10:00 for both work centers, so WC2 has idle time. Let me fix the test:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { ReflowService } from '../src/reflow/reflow.service';
import type { WorkCenter, WorkOrder, ManufacturingOrder, ReflowInput, OptimizationMetrics } from '../src/reflow/types';
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

```

```typescript
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

```

Done! I've implemented the **Optimization Metrics** feature. Here's a summary:

## Changes Made

### 1. Added Types (`src/reflow/types.ts`)

```137:152:src/reflow/types.ts
export interface WorkCenterMetrics {
  workCenterId: string;
  workCenterName: string;
  totalShiftMinutes: number;
  totalWorkingMinutes: number;
  totalIdleMinutes: number;
  utilization: number; // 0-1 ratio
}

export interface OptimizationMetrics {
  totalDelayMinutes: number;
  workOrdersAffectedCount: number;
  workOrdersUnchangedCount: number;
  overallUtilization: number; // 0-1 ratio
  workCenterMetrics: WorkCenterMetrics[];
}
```

### 2. Updated `ReflowResult` to include metrics

### 3. Added metrics calculation in `GlobalSchedule` (`src/reflow/globalSchedule.ts`)
- `computeWorkCenterMetrics()` - computes per-work-center metrics within schedule bounds
- `computeTotalShiftMinutes()` - calculates available shift time minus maintenance
- `computeTotalWorkingMinutes()` - sums scheduled work time

### 4. Added metrics calculation in `ReflowService` (`src/reflow/reflow.service.ts`)
- `computeMetrics()` - calculates total delay, affected counts, and utilization
- `getScheduleBounds()` - determines the time range to analyze

### 5. Added tests for all metrics (`tests/reflow.service.test.ts`)
- Basic metrics return
- Total delay calculation
- Utilization calculation  
- Idle time analysis
- Multiple work centers

## Metrics Implemented

| Metric | Description |
|--------|-------------|
| `totalDelayMinutes` | Σ (new_end_date - original_end_date) for all rescheduled WOs |
| `workOrdersAffectedCount` | Count of rescheduled work orders |
| `workOrdersUnchangedCount` | Count of unchanged work orders |
| `overallUtilization` | Total working minutes / total available shift minutes |
| `workCenterMetrics[]` | Per-WC breakdown of shift time, working time, idle time, and utilization |

```typescript
export interface WorkCenterMetrics {
  workCenterId: string;
  workCenterName: string;
  totalShiftMinutes: number;
  totalWorkingMinutes: number;
  totalIdleMinutes: number;
  utilization: number; // 0-1 ratio
}

export interface OptimizationMetrics {
  totalDelayMinutes: number;
  workOrdersAffectedCount: number;
  workOrdersUnchangedCount: number;
  overallUtilization: number; // 0-1 ratio
  workCenterMetrics: WorkCenterMetrics[];
}
```

---

**User**

Lets display these metrics in @src/main.ts 

---

**Cursor**

```typescript
import { ReflowService } from './reflow/reflow.service';
import type { WorkOrder, WorkCenter, ManufacturingOrder, ReflowInput } from './reflow/types';

// Simple example demonstrating basic usage
export function main() {
  console.log('=== Reflow Algorithm Example ===\n');

  // Create sample work center
  const workCenter: WorkCenter = {
    docId: 'WC-001',
    docType: 'workCenter',
    data: {
      name: 'Assembly Line A',
      shifts: [
        { dayOfWeek: 1, startHour: 8, endHour: 17 },
        { dayOfWeek: 2, startHour: 8, endHour: 17 },
        { dayOfWeek: 3, startHour: 8, endHour: 17 },
        { dayOfWeek: 4, startHour: 8, endHour: 17 },
        { dayOfWeek: 5, startHour: 8, endHour: 17 },
      ],
      maintenanceWindows: [
        {
          startDate: '2024-01-15T12:40:00Z',
          endDate: '2024-01-15T16:00:00Z',
        },
      ],
    },
  };

  // Create sample work orders with dependencies
  const workOrders: WorkOrder[] = [
    {
      docId: 'WO-001',
      docType: 'workOrder',
      data: {
        workOrderNumber: 'WO-001',
        manufacturingOrderId: 'MO-001',
        workCenterId: 'WC-001',
        durationMinutes: 240,
        setupTimeMinutes: 30,
        startDate: '2024-01-15T08:00:00Z',
        endDate: '2024-01-15T12:30:00Z',
        sessions: [],
        isMaintenance: false,
        dependsOnWorkOrderIds: [],
      },
    },
    {
      docId: 'WO-002',
      docType: 'workOrder',
      data: {
        workOrderNumber: 'WO-002',
        manufacturingOrderId: 'MO-001',
        workCenterId: 'WC-001',
        durationMinutes: 120,
        setupTimeMinutes: 15,
        startDate: '2024-01-15T08:00:00Z',
        endDate: '2024-01-15T10:15:00Z',
        sessions: [],
        isMaintenance: false,
        dependsOnWorkOrderIds: ['WO-001'],
      },
    },
  ];

  const manufacturingOrder: ManufacturingOrder = {
    docId: 'MO-001',
    docType: 'manufacturingOrder',
    data: {
      manufacturingOrderNumber: 'MO-001',
      itemId: 'PRODUCT-A',
      quantity: 100,
      dueDate: '2024-01-19T17:00:00Z',
    },
  };

  // Create reflow service
  const reflowService = new ReflowService([workCenter]);

  // Prepare input
  const input: ReflowInput = {
    workOrders,
    manufacturingOrders: [manufacturingOrder],
  };

  console.log('Input Data:');
  console.log('- Manufacturing Order:', manufacturingOrder.data.manufacturingOrderNumber);
  console.log('- Work Orders:', workOrders.map((wo) => wo.data.workOrderNumber).join(', '));
  console.log('- Work Center:', workCenter.data.name);
  console.log('- Shifts: Monday-Friday 8AM-5PM\n');

  try {
    // Run reflow algorithm
    const result = reflowService.reflow(input);

    console.log('Results:');
    console.log('- Updated Work Orders:');
    result.updatedWorkOrders.forEach((wo) => {
      console.log(`  ${wo.data.workOrderNumber}:`);
      console.log(`    Start: ${wo.data.startDate}`);
      console.log(`    End: ${wo.data.endDate}`);
      console.log(`    Sessions: ${wo.data.sessions.length}`);
      wo.data.sessions.forEach((s, i) => {
        console.log(`      [${i}] ${s.startDate} -> ${s.endDate} (setup: ${s.setupTimeMinutes}m, work: ${s.durationTimeMinutes}m)`);
      });
      if (wo.data.dependsOnWorkOrderIds.length > 0) {
        console.log(`    Dependencies: ${wo.data.dependsOnWorkOrderIds.join(', ')}`);
      }
    });

    if (result.changes.length > 0) {
      console.log(`- Changes Made: ${result.changes.length}`);
      console.log(result.changes);
      console.log(`- Explanations: ${result.explanation.length}`);
      console.log(result.explanation);
    } else {
      console.log('- No changes were needed');
    }

    console.log('\n=== Optimization Metrics ===');
    const { metrics } = result;
    console.log(`Total Delay: ${metrics.totalDelayMinutes} minutes`);
    console.log(`Work Orders Affected: ${metrics.workOrdersAffectedCount}`);
    console.log(`Work Orders Unchanged: ${metrics.workOrdersUnchangedCount}`);
    console.log(`Overall Utilization: ${(metrics.overallUtilization * 100).toFixed(1)}%`);
    console.log('\nWork Center Metrics:');
    metrics.workCenterMetrics.forEach((wc) => {
      console.log(`  ${wc.workCenterName} (${wc.workCenterId}):`);
      console.log(`    Shift Time: ${wc.totalShiftMinutes} min`);
      console.log(`    Working Time: ${wc.totalWorkingMinutes} min`);
      console.log(`    Idle Time: ${wc.totalIdleMinutes} min`);
      console.log(`    Utilization: ${(wc.utilization * 100).toFixed(1)}%`);
    });
  } catch (error) {
    console.log('ERROR:', error instanceof Error ? error.message : String(error));
  }
}

main();

```

Done! The metrics are now displayed in the example output:

```
=== Optimization Metrics ===
Total Delay: 1395 minutes
Work Orders Affected: 1
Work Orders Unchanged: 1
Overall Utilization: 97.7%

Work Center Metrics:
  Assembly Line A (WC-001):
    Shift Time: 430 min
    Working Time: 420 min
    Idle Time: 10 min
    Utilization: 97.7%
```

The example shows:
- **WO-002** was delayed by ~23 hours (1395 min) due to dependency on WO-001 completing at 12:30 plus the maintenance window from 12:40-16:00
- **97.7% utilization** - only 10 minutes of idle time in the schedule bounds
- Per work center breakdown of shift time, working time, and idle time

```plaintext
=== Optimization Metrics ===
Total Delay: 1395 minutes
Work Orders Affected: 1
Work Orders Unchanged: 1
Overall Utilization: 97.7%

Work Center Metrics:
  Assembly Line A (WC-001):
    Shift Time: 430 min
    Working Time: 420 min
    Idle Time: 10 min
    Utilization: 97.7%
```

