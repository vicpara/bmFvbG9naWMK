# Impossible schedule error handling
_Exported on 27/12/2025 at 17:39:38 EET from Cursor (2.2.44)_

---

**User**

@src/reflow/reflow.service.ts 

and @src/reflow/validator.ts 

Let's handle
. Impossible Schedule Detection
The spec asks:
> "Q: What if there's no valid solution? A: Throw an error explaining which constraints can't be satisfied."
Current behavior:
INCOMPLETE error if work can't be scheduled within MAX_DAYS_LOOKAHEAD
No detailed explanation of which specific constraints can't be satisfied
Doesn't report "impossible due to circular deps + maintenance overlap" etc.

---

**Cursor**

I'll first read the `globalSchedule.ts` to understand the scheduling logic and where constraint violations occur, then enhance the error handling.

Now I understand the structure. Let me enhance the error handling to provide detailed constraint violation explanations. I'll:

1. Create a new `ImpossibleScheduleError` that aggregates constraint details
2. Track constraint violations during scheduling
3. Provide detailed explanations about why schedules are impossible

```typescript
import { DateTime } from 'luxon';
import type { WorkOrder, WorkCenter, Session } from './types';

export interface ConstraintViolation {
  code: string;
  workOrderId: string;
  message: string;
  details?: Record<string, unknown>;
}

export class ValidationError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class ImpossibleScheduleError extends Error {
  violations: ConstraintViolation[];
  constructor(violations: ConstraintViolation[]) {
    const summary = violations.map(v => `[${v.code}] ${v.message}`).join('; ');
    super(`Impossible schedule: ${summary}`);
    this.violations = violations;
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

```typescript
import { DateTime } from 'luxon';
import type { WorkOrder, WorkCenter, Session } from './types';

export interface ConstraintViolation {
  code: string;
  workOrderId: string;
  message: string;
  details?: Record<string, unknown>;
}

export class ValidationError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class ImpossibleScheduleError extends Error {
  violations: ConstraintViolation[];
  constructor(violations: ConstraintViolation[]) {
    const summary = violations.map(v => `[${v.code}] ${v.message}`).join('; ');
    super(`Impossible schedule: ${summary}`);
    this.violations = violations;
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
  // Post-scheduling checks with detailed constraint analysis
  postSchedule(
    wo: WorkOrder,
    sessions: Session[],
    remainingDuration: number,
    maxDays: number,
    constraintContext?: ScheduleConstraintContext
  ): void {
    if (remainingDuration > 0) {
      const details = constraintContext
        ? buildIncompleteDetails(wo, remainingDuration, constraintContext)
        : `${remainingDuration}min remaining`;
      throw new ValidationError('INCOMPLETE', `Work order ${wo.docId} not fully scheduled: ${details}`);
    }
    if (!sessions.length) {
      const reason = constraintContext?.noShiftsAvailable
        ? 'no shifts available in the scheduling window'
        : constraintContext?.allTimeBlocked
          ? 'all available time blocked by maintenance or other work orders'
          : 'no sessions could be created';
      throw new ValidationError('NO_SESSIONS', `Work order ${wo.docId} has no scheduled sessions: ${reason}`);
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

```typescript
import { DateTime } from 'luxon';
import type { WorkOrder, WorkCenter, Session } from './types';

export interface ConstraintViolation {
  code: string;
  workOrderId: string;
  message: string;
  details?: Record<string, unknown>;
}

export class ValidationError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class ImpossibleScheduleError extends Error {
  violations: ConstraintViolation[];
  constructor(violations: ConstraintViolation[]) {
    const summary = violations.map(v => `[${v.code}] ${v.message}`).join('; ');
    super(`Impossible schedule: ${summary}`);
    this.violations = violations;
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
  // Post-scheduling checks with detailed constraint analysis
  postSchedule(
    wo: WorkOrder,
    sessions: Session[],
    remainingDuration: number,
    maxDays: number,
    constraintContext?: ScheduleConstraintContext
  ): void {
    if (remainingDuration > 0) {
      const details = constraintContext
        ? buildIncompleteDetails(wo, remainingDuration, constraintContext)
        : `${remainingDuration}min remaining`;
      throw new ValidationError('INCOMPLETE', `Work order ${wo.docId} not fully scheduled: ${details}`);
    }
    if (!sessions.length) {
      const reason = constraintContext?.noShiftsAvailable
        ? 'no shifts available in the scheduling window'
        : constraintContext?.allTimeBlocked
          ? 'all available time blocked by maintenance or other work orders'
          : 'no sessions could be created';
      throw new ValidationError('NO_SESSIONS', `Work order ${wo.docId} has no scheduled sessions: ${reason}`);
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

export interface ScheduleConstraintContext {
  noShiftsAvailable: boolean;
  allTimeBlocked: boolean;
  maintenanceConflicts: Array<{ startDate: string; endDate: string; reason?: string }>;
  existingWorkOrderConflicts: string[];
  totalAvailableMinutes: number;
  requiredMinutes: number;
  dependencyDelays: Array<{ parentId: string; delayMinutes: number }>;
}

export function createConstraintContext(): ScheduleConstraintContext {
  return {
    noShiftsAvailable: false,
    allTimeBlocked: false,
    maintenanceConflicts: [],
    existingWorkOrderConflicts: [],
    totalAvailableMinutes: 0,
    requiredMinutes: 0,
    dependencyDelays: [],
  };
}

function buildIncompleteDetails(wo: WorkOrder, remaining: number, ctx: ScheduleConstraintContext): string {
  const parts: string[] = [`${remaining}min remaining`];
  if (ctx.noShiftsAvailable) {
    parts.push('no shifts configured for required days');
  }
  if (ctx.maintenanceConflicts.length > 0) {
    parts.push(`blocked by ${ctx.maintenanceConflicts.length} maintenance window(s)`);
  }
  if (ctx.existingWorkOrderConflicts.length > 0) {
    parts.push(`conflicts with work orders: ${ctx.existingWorkOrderConflicts.slice(0, 3).join(', ')}${ctx.existingWorkOrderConflicts.length > 3 ? '...' : ''}`);
  }
  if (ctx.dependencyDelays.length > 0) {
    const totalDelay = ctx.dependencyDelays.reduce((sum, d) => sum + d.delayMinutes, 0);
    parts.push(`delayed ${totalDelay}min by dependencies`);
  }
  if (ctx.totalAvailableMinutes < ctx.requiredMinutes) {
    parts.push(`only ${ctx.totalAvailableMinutes}min available of ${ctx.requiredMinutes}min required`);
  }
  return parts.join('; ');
}


```

Now let me update `globalSchedule.ts` to track constraint context:

```typescript
import type { ScheduledEvent, WorkCenter, WorkOrder, Conflict, TimeSlot, Session } from './types';
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

```typescript
import type { ScheduledEvent, WorkCenter, WorkOrder, Conflict, TimeSlot, Session } from './types';
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

Now let's enhance the `reflow.service.ts` to track constraint violations and provide better error reporting:

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
import { Validator, ValidationError, ImpossibleScheduleError, type ConstraintViolation } from './validator';

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

Now let me enhance the topological sort to provide more detailed cycle information:

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

Let me check for linter errors:

```typescript
import { DateTime } from 'luxon';
import type { WorkOrder, WorkCenter, Session } from './types';

export interface ConstraintViolation {
  code: string;
  workOrderId: string;
  message: string;
  details?: Record<string, unknown>;
}

export class ValidationError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class ImpossibleScheduleError extends Error {
  violations: ConstraintViolation[];
  constructor(violations: ConstraintViolation[]) {
    const summary = violations.map(v => `[${v.code}] ${v.message}`).join('; ');
    super(`Impossible schedule: ${summary}`);
    this.violations = violations;
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
  // Post-scheduling checks with detailed constraint analysis
  postSchedule(
    wo: WorkOrder,
    sessions: Session[],
    remainingDuration: number,
    maxDays: number,
    constraintContext?: ScheduleConstraintContext
  ): void {
    if (remainingDuration > 0) {
      const details = constraintContext
        ? buildIncompleteDetails(wo, remainingDuration, constraintContext)
        : `${remainingDuration}min remaining`;
      throw new ValidationError('INCOMPLETE', `Work order ${wo.docId} not fully scheduled: ${details}`);
    }
    if (!sessions.length) {
      const reason = constraintContext?.noShiftsAvailable
        ? 'no shifts available in the scheduling window'
        : constraintContext?.allTimeBlocked
          ? 'all available time blocked by maintenance or other work orders'
          : 'no sessions could be created';
      throw new ValidationError('NO_SESSIONS', `Work order ${wo.docId} has no scheduled sessions: ${reason}`);
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

export interface ScheduleConstraintContext {
  noShiftsAvailable: boolean;
  allTimeBlocked: boolean;
  maintenanceConflicts: Array<{ startDate: string; endDate: string; reason?: string }>;
  existingWorkOrderConflicts: string[];
  totalAvailableMinutes: number;
  requiredMinutes: number;
  dependencyDelays: Array<{ parentId: string; delayMinutes: number }>;
}

export function createConstraintContext(): ScheduleConstraintContext {
  return {
    noShiftsAvailable: false,
    allTimeBlocked: false,
    maintenanceConflicts: [],
    existingWorkOrderConflicts: [],
    totalAvailableMinutes: 0,
    requiredMinutes: 0,
    dependencyDelays: [],
  };
}

function buildIncompleteDetails(_wo: WorkOrder, remaining: number, ctx: ScheduleConstraintContext): string {
  const parts: string[] = [`${remaining}min remaining`];
  if (ctx.noShiftsAvailable) {
    parts.push('no shifts configured for required days');
  }
  if (ctx.maintenanceConflicts.length > 0) {
    parts.push(`blocked by ${ctx.maintenanceConflicts.length} maintenance window(s)`);
  }
  if (ctx.existingWorkOrderConflicts.length > 0) {
    parts.push(`conflicts with work orders: ${ctx.existingWorkOrderConflicts.slice(0, 3).join(', ')}${ctx.existingWorkOrderConflicts.length > 3 ? '...' : ''}`);
  }
  if (ctx.dependencyDelays.length > 0) {
    const totalDelay = ctx.dependencyDelays.reduce((sum, d) => sum + d.delayMinutes, 0);
    parts.push(`delayed ${totalDelay}min by dependencies`);
  }
  if (ctx.totalAvailableMinutes < ctx.requiredMinutes) {
    parts.push(`only ${ctx.totalAvailableMinutes}min available of ${ctx.requiredMinutes}min required`);
  }
  return parts.join('; ');
}


```

Let me run the tests to ensure the changes work correctly:

The tests are failing because the new error messages are more detailed (now showing the full cycle path). I need to update the test expectations:

I'll update the test data file to use the new, more detailed cycle path format:

```json
{
  "simple-chain": {
    "description": "Simple linear dependency chain: A -> B -> C",
    "workOrders": [
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-b"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b", "wo-c"],
    "shouldPass": true
  },
  "multiple-parents": {
    "description": "Multiple parents converging: A -> C, B -> C (diamond pattern)",
    "workOrders": [
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a", "wo-b"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b", "wo-c"],
    "shouldPass": true
  },
  "complex-dag": {
    "description": "Complex DAG: A -> B, A -> C, B -> D, C -> D, E -> F",
    "workOrders": [
      {
        "docId": "wo-d",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-D",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-b", "wo-c"]
        }
      },
      {
        "docId": "wo-f",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-F",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-e"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      },
      {
        "docId": "wo-e",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-E",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b", "wo-c", "wo-d", "wo-e", "wo-f"],
    "shouldPass": true
  },
  "longer-chain": {
    "description": "Longer linear chain: A -> B -> C -> D -> E",
    "workOrders": [
      {
        "docId": "wo-e",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-E",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-d"]
        }
      },
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-b"]
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      },
      {
        "docId": "wo-d",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-D",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-c"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b", "wo-c", "wo-d", "wo-e"],
    "shouldPass": true
  },
  "longer-chain-with-cycle": {
    "description": "Longer linear chain: A -> B -> C -> D -> E -> F; F->B (cycle)",
    "workOrders": [
      {
        "docId": "wo-f",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-F",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-e"]
        }
      },
      {
        "docId": "wo-e",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-E",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-d"]
        }
      },
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-b"]
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a","wo-f"]
        }
      },
      {
        "docId": "wo-d",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-D",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-c"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b", "wo-c", "wo-d", "wo-e"],
    "shouldPass": true
  },
  "mixed-maintenance": {
    "description": "Mix of regular and maintenance work orders - maintenance should be ignored in sorting",
    "workOrders": [
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      },
      {
        "docId": "wo-maint",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-MAINT",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": true,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-c"],
    "shouldPass": true
  },
  "simple-cycle": {
    "description": "Simple cycle: A -> B -> A (should detect cycle)",
    "workOrders": [
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-b"]
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      }
    ],
    "expectedOrder": [],
    "shouldPass": false,
    "expectedError": "Circular dependency detected:"
  },
  "complex-cycle": {
    "description": "Complex cycle: A -> B -> C -> A (should detect cycle)",
    "workOrders": [
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-c"]
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      },
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-b"]
        }
      }
    ],
    "expectedOrder": [],
    "shouldPass": false,
    "expectedError": "Circular dependency detected in work order chain"
  },
  "self-cycle": {
    "description": "Self-referencing cycle: A -> A (should detect cycle)",
    "workOrders": [
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      }
    ],
    "expectedOrder": [],
    "shouldPass": false,
    "expectedError": "Circular dependency detected in work order chain: WO id: wo-a"
  },
  "branched-cycle": {
    "description": "Cycle with branches: A -> B -> C -> B (cycle in middle)",
    "workOrders": [
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-c"]
        }
      },
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-b"]
        }
      },
      {
        "docId": "wo-d",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-D",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      }
    ],
    "expectedOrder": [],
    "shouldPass": false,
    "expectedError": "Circular dependency detected in work order chain: WO id: wo-b"
  },
  "no-dependencies": {
    "description": "All work orders have no dependencies - should return in original order",
    "workOrders": [
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-c", "wo-a", "wo-b"],
    "shouldPass": true
  },
  "single-work-order": {
    "description": "Single work order with no dependencies",
    "workOrders": [
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a"],
    "shouldPass": true
  },
  "multiple-dependencies-single-wo": {
    "description": "Single work order with multiple dependencies: A, B, C -> D",
    "workOrders": [
      {
        "docId": "wo-d",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-D",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a", "wo-b", "wo-c"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b", "wo-c", "wo-d"],
    "shouldPass": true
  },
  "complex-multiple-dependencies": {
    "description": "Complex scenario with multiple WOs having multiple dependencies: A,B->D, C->E, D,E->F",
    "workOrders": [
      {
        "docId": "wo-f",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-F",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-d", "wo-e"]
        }
      },
      {
        "docId": "wo-d",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-D",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a", "wo-b"]
        }
      },
      {
        "docId": "wo-e",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-E",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-c"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b", "wo-d", "wo-c", "wo-e", "wo-f"],
    "shouldPass": true
  },
  "four-dependencies": {
    "description": "Work order with four dependencies: A, B, C, D -> E",
    "workOrders": [
      {
        "docId": "wo-e",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-E",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a", "wo-b", "wo-c", "wo-d"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-d",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-D",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b", "wo-c", "wo-d", "wo-e"],
    "shouldPass": true
  },
  "dependency-on-nonexistent-wo": {
    "description": "Work order depends on a non-existent work order ID",
    "workOrders": [
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-nonexistent"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": [],
    "shouldPass": false,
    "expectedError": "Work order wo-b depends on non-existent work order: wo-nonexistent"
  },
  "dependency-on-maintenance-wo": {
    "description": "Regular work order depends on maintenance work order",
    "workOrders": [
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-maint"]
        }
      },
      {
        "docId": "wo-maint",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-MAINT",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": true,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-b"],
    "shouldPass": true
  },
  "maintenance-depends-on-regular": {
    "description": "Maintenance work order depends on regular work order",
    "workOrders": [
      {
        "docId": "wo-maint",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-MAINT",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": true,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a"],
    "shouldPass": true
  },
  "duplicate-wo-ids": {
    "description": "Duplicate work order IDs in input array",
    "workOrders": [
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A1",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A2",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": [],
    "shouldPass": false,
    "expectedError": "Duplicate work order ID found: wo-a"
  },
  "empty-dependency-strings": {
    "description": "Work order with empty strings in dependency array",
    "workOrders": [
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["", "wo-a", ""]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b"],
    "shouldPass": true
  },
  "complex-cycle-with-maintenance": {
    "description": "Cycle involving maintenance work orders: A -> Maint -> B -> A",
    "workOrders": [
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-b"]
        }
      },
      {
        "docId": "wo-maint",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-MAINT",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": true,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-b", "wo-a"],
    "shouldPass": true
  },
  "empty-array": {
    "description": "Empty array of work orders",
    "workOrders": [],
    "expectedOrder": [],
    "shouldPass": true
  }
}

```

```json
{
  "simple-chain": {
    "description": "Simple linear dependency chain: A -> B -> C",
    "workOrders": [
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-b"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b", "wo-c"],
    "shouldPass": true
  },
  "multiple-parents": {
    "description": "Multiple parents converging: A -> C, B -> C (diamond pattern)",
    "workOrders": [
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a", "wo-b"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b", "wo-c"],
    "shouldPass": true
  },
  "complex-dag": {
    "description": "Complex DAG: A -> B, A -> C, B -> D, C -> D, E -> F",
    "workOrders": [
      {
        "docId": "wo-d",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-D",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-b", "wo-c"]
        }
      },
      {
        "docId": "wo-f",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-F",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-e"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      },
      {
        "docId": "wo-e",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-E",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b", "wo-c", "wo-d", "wo-e", "wo-f"],
    "shouldPass": true
  },
  "longer-chain": {
    "description": "Longer linear chain: A -> B -> C -> D -> E",
    "workOrders": [
      {
        "docId": "wo-e",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-E",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-d"]
        }
      },
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-b"]
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      },
      {
        "docId": "wo-d",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-D",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-c"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b", "wo-c", "wo-d", "wo-e"],
    "shouldPass": true
  },
  "longer-chain-with-cycle": {
    "description": "Longer linear chain: A -> B -> C -> D -> E -> F; F->B (cycle)",
    "workOrders": [
      {
        "docId": "wo-f",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-F",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-e"]
        }
      },
      {
        "docId": "wo-e",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-E",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-d"]
        }
      },
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-b"]
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a","wo-f"]
        }
      },
      {
        "docId": "wo-d",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-D",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-c"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b", "wo-c", "wo-d", "wo-e"],
    "shouldPass": true
  },
  "mixed-maintenance": {
    "description": "Mix of regular and maintenance work orders - maintenance should be ignored in sorting",
    "workOrders": [
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      },
      {
        "docId": "wo-maint",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-MAINT",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": true,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-c"],
    "shouldPass": true
  },
  "simple-cycle": {
    "description": "Simple cycle: A -> B -> A (should detect cycle)",
    "workOrders": [
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-b"]
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      }
    ],
    "expectedOrder": [],
    "shouldPass": false,
    "expectedError": "Circular dependency detected:"
  },
  "complex-cycle": {
    "description": "Complex cycle: A -> B -> C -> A (should detect cycle)",
    "workOrders": [
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-c"]
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      },
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-b"]
        }
      }
    ],
    "expectedOrder": [],
    "shouldPass": false,
    "expectedError": "Circular dependency detected:"
  },
  "self-cycle": {
    "description": "Self-referencing cycle: A -> A (should detect cycle)",
    "workOrders": [
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      }
    ],
    "expectedOrder": [],
    "shouldPass": false,
    "expectedError": "Circular dependency detected in work order chain: WO id: wo-a"
  },
  "branched-cycle": {
    "description": "Cycle with branches: A -> B -> C -> B (cycle in middle)",
    "workOrders": [
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-c"]
        }
      },
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-b"]
        }
      },
      {
        "docId": "wo-d",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-D",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      }
    ],
    "expectedOrder": [],
    "shouldPass": false,
    "expectedError": "Circular dependency detected in work order chain: WO id: wo-b"
  },
  "no-dependencies": {
    "description": "All work orders have no dependencies - should return in original order",
    "workOrders": [
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-c", "wo-a", "wo-b"],
    "shouldPass": true
  },
  "single-work-order": {
    "description": "Single work order with no dependencies",
    "workOrders": [
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a"],
    "shouldPass": true
  },
  "multiple-dependencies-single-wo": {
    "description": "Single work order with multiple dependencies: A, B, C -> D",
    "workOrders": [
      {
        "docId": "wo-d",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-D",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a", "wo-b", "wo-c"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b", "wo-c", "wo-d"],
    "shouldPass": true
  },
  "complex-multiple-dependencies": {
    "description": "Complex scenario with multiple WOs having multiple dependencies: A,B->D, C->E, D,E->F",
    "workOrders": [
      {
        "docId": "wo-f",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-F",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-d", "wo-e"]
        }
      },
      {
        "docId": "wo-d",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-D",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a", "wo-b"]
        }
      },
      {
        "docId": "wo-e",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-E",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-c"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b", "wo-d", "wo-c", "wo-e", "wo-f"],
    "shouldPass": true
  },
  "four-dependencies": {
    "description": "Work order with four dependencies: A, B, C, D -> E",
    "workOrders": [
      {
        "docId": "wo-e",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-E",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a", "wo-b", "wo-c", "wo-d"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-d",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-D",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b", "wo-c", "wo-d", "wo-e"],
    "shouldPass": true
  },
  "dependency-on-nonexistent-wo": {
    "description": "Work order depends on a non-existent work order ID",
    "workOrders": [
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-nonexistent"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": [],
    "shouldPass": false,
    "expectedError": "Work order wo-b depends on non-existent work order: wo-nonexistent"
  },
  "dependency-on-maintenance-wo": {
    "description": "Regular work order depends on maintenance work order",
    "workOrders": [
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-maint"]
        }
      },
      {
        "docId": "wo-maint",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-MAINT",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": true,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-b"],
    "shouldPass": true
  },
  "maintenance-depends-on-regular": {
    "description": "Maintenance work order depends on regular work order",
    "workOrders": [
      {
        "docId": "wo-maint",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-MAINT",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": true,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a"],
    "shouldPass": true
  },
  "duplicate-wo-ids": {
    "description": "Duplicate work order IDs in input array",
    "workOrders": [
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A1",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A2",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": [],
    "shouldPass": false,
    "expectedError": "Duplicate work order ID found: wo-a"
  },
  "empty-dependency-strings": {
    "description": "Work order with empty strings in dependency array",
    "workOrders": [
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["", "wo-a", ""]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b"],
    "shouldPass": true
  },
  "complex-cycle-with-maintenance": {
    "description": "Cycle involving maintenance work orders: A -> Maint -> B -> A",
    "workOrders": [
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-b"]
        }
      },
      {
        "docId": "wo-maint",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-MAINT",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": true,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-b", "wo-a"],
    "shouldPass": true
  },
  "empty-array": {
    "description": "Empty array of work orders",
    "workOrders": [],
    "expectedOrder": [],
    "shouldPass": true
  }
}

```

```json
{
  "simple-chain": {
    "description": "Simple linear dependency chain: A -> B -> C",
    "workOrders": [
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-b"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b", "wo-c"],
    "shouldPass": true
  },
  "multiple-parents": {
    "description": "Multiple parents converging: A -> C, B -> C (diamond pattern)",
    "workOrders": [
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a", "wo-b"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b", "wo-c"],
    "shouldPass": true
  },
  "complex-dag": {
    "description": "Complex DAG: A -> B, A -> C, B -> D, C -> D, E -> F",
    "workOrders": [
      {
        "docId": "wo-d",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-D",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-b", "wo-c"]
        }
      },
      {
        "docId": "wo-f",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-F",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-e"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      },
      {
        "docId": "wo-e",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-E",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b", "wo-c", "wo-d", "wo-e", "wo-f"],
    "shouldPass": true
  },
  "longer-chain": {
    "description": "Longer linear chain: A -> B -> C -> D -> E",
    "workOrders": [
      {
        "docId": "wo-e",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-E",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-d"]
        }
      },
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-b"]
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      },
      {
        "docId": "wo-d",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-D",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-c"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b", "wo-c", "wo-d", "wo-e"],
    "shouldPass": true
  },
  "longer-chain-with-cycle": {
    "description": "Longer linear chain: A -> B -> C -> D -> E -> F; F->B (cycle)",
    "workOrders": [
      {
        "docId": "wo-f",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-F",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-e"]
        }
      },
      {
        "docId": "wo-e",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-E",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-d"]
        }
      },
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-b"]
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a","wo-f"]
        }
      },
      {
        "docId": "wo-d",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-D",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-c"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b", "wo-c", "wo-d", "wo-e"],
    "shouldPass": true
  },
  "mixed-maintenance": {
    "description": "Mix of regular and maintenance work orders - maintenance should be ignored in sorting",
    "workOrders": [
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      },
      {
        "docId": "wo-maint",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-MAINT",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": true,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-c"],
    "shouldPass": true
  },
  "simple-cycle": {
    "description": "Simple cycle: A -> B -> A (should detect cycle)",
    "workOrders": [
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-b"]
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      }
    ],
    "expectedOrder": [],
    "shouldPass": false,
    "expectedError": "Circular dependency detected:"
  },
  "complex-cycle": {
    "description": "Complex cycle: A -> B -> C -> A (should detect cycle)",
    "workOrders": [
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-c"]
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      },
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-b"]
        }
      }
    ],
    "expectedOrder": [],
    "shouldPass": false,
    "expectedError": "Circular dependency detected:"
  },
  "self-cycle": {
    "description": "Self-referencing cycle: A -> A (should detect cycle)",
    "workOrders": [
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      }
    ],
    "expectedOrder": [],
    "shouldPass": false,
    "expectedError": "Circular dependency detected:"
  },
  "branched-cycle": {
    "description": "Cycle with branches: A -> B -> C -> B (cycle in middle)",
    "workOrders": [
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-c"]
        }
      },
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-b"]
        }
      },
      {
        "docId": "wo-d",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-D",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      }
    ],
    "expectedOrder": [],
    "shouldPass": false,
    "expectedError": "Circular dependency detected in work order chain: WO id: wo-b"
  },
  "no-dependencies": {
    "description": "All work orders have no dependencies - should return in original order",
    "workOrders": [
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-c", "wo-a", "wo-b"],
    "shouldPass": true
  },
  "single-work-order": {
    "description": "Single work order with no dependencies",
    "workOrders": [
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a"],
    "shouldPass": true
  },
  "multiple-dependencies-single-wo": {
    "description": "Single work order with multiple dependencies: A, B, C -> D",
    "workOrders": [
      {
        "docId": "wo-d",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-D",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a", "wo-b", "wo-c"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b", "wo-c", "wo-d"],
    "shouldPass": true
  },
  "complex-multiple-dependencies": {
    "description": "Complex scenario with multiple WOs having multiple dependencies: A,B->D, C->E, D,E->F",
    "workOrders": [
      {
        "docId": "wo-f",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-F",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-d", "wo-e"]
        }
      },
      {
        "docId": "wo-d",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-D",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a", "wo-b"]
        }
      },
      {
        "docId": "wo-e",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-E",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-c"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b", "wo-d", "wo-c", "wo-e", "wo-f"],
    "shouldPass": true
  },
  "four-dependencies": {
    "description": "Work order with four dependencies: A, B, C, D -> E",
    "workOrders": [
      {
        "docId": "wo-e",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-E",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a", "wo-b", "wo-c", "wo-d"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-d",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-D",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b", "wo-c", "wo-d", "wo-e"],
    "shouldPass": true
  },
  "dependency-on-nonexistent-wo": {
    "description": "Work order depends on a non-existent work order ID",
    "workOrders": [
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-nonexistent"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": [],
    "shouldPass": false,
    "expectedError": "Work order wo-b depends on non-existent work order: wo-nonexistent"
  },
  "dependency-on-maintenance-wo": {
    "description": "Regular work order depends on maintenance work order",
    "workOrders": [
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-maint"]
        }
      },
      {
        "docId": "wo-maint",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-MAINT",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": true,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-b"],
    "shouldPass": true
  },
  "maintenance-depends-on-regular": {
    "description": "Maintenance work order depends on regular work order",
    "workOrders": [
      {
        "docId": "wo-maint",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-MAINT",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": true,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a"],
    "shouldPass": true
  },
  "duplicate-wo-ids": {
    "description": "Duplicate work order IDs in input array",
    "workOrders": [
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A1",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A2",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": [],
    "shouldPass": false,
    "expectedError": "Duplicate work order ID found: wo-a"
  },
  "empty-dependency-strings": {
    "description": "Work order with empty strings in dependency array",
    "workOrders": [
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["", "wo-a", ""]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b"],
    "shouldPass": true
  },
  "complex-cycle-with-maintenance": {
    "description": "Cycle involving maintenance work orders: A -> Maint -> B -> A",
    "workOrders": [
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-b"]
        }
      },
      {
        "docId": "wo-maint",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-MAINT",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": true,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-b", "wo-a"],
    "shouldPass": true
  },
  "empty-array": {
    "description": "Empty array of work orders",
    "workOrders": [],
    "expectedOrder": [],
    "shouldPass": true
  }
}

```

```json
{
  "simple-chain": {
    "description": "Simple linear dependency chain: A -> B -> C",
    "workOrders": [
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-b"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b", "wo-c"],
    "shouldPass": true
  },
  "multiple-parents": {
    "description": "Multiple parents converging: A -> C, B -> C (diamond pattern)",
    "workOrders": [
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a", "wo-b"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b", "wo-c"],
    "shouldPass": true
  },
  "complex-dag": {
    "description": "Complex DAG: A -> B, A -> C, B -> D, C -> D, E -> F",
    "workOrders": [
      {
        "docId": "wo-d",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-D",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-b", "wo-c"]
        }
      },
      {
        "docId": "wo-f",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-F",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-e"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      },
      {
        "docId": "wo-e",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-E",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b", "wo-c", "wo-d", "wo-e", "wo-f"],
    "shouldPass": true
  },
  "longer-chain": {
    "description": "Longer linear chain: A -> B -> C -> D -> E",
    "workOrders": [
      {
        "docId": "wo-e",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-E",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-d"]
        }
      },
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-b"]
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      },
      {
        "docId": "wo-d",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-D",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-c"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b", "wo-c", "wo-d", "wo-e"],
    "shouldPass": true
  },
  "longer-chain-with-cycle": {
    "description": "Longer linear chain: A -> B -> C -> D -> E -> F; F->B (cycle)",
    "workOrders": [
      {
        "docId": "wo-f",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-F",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-e"]
        }
      },
      {
        "docId": "wo-e",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-E",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-d"]
        }
      },
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-b"]
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a","wo-f"]
        }
      },
      {
        "docId": "wo-d",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-D",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-c"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b", "wo-c", "wo-d", "wo-e"],
    "shouldPass": true
  },
  "mixed-maintenance": {
    "description": "Mix of regular and maintenance work orders - maintenance should be ignored in sorting",
    "workOrders": [
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      },
      {
        "docId": "wo-maint",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-MAINT",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": true,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-c"],
    "shouldPass": true
  },
  "simple-cycle": {
    "description": "Simple cycle: A -> B -> A (should detect cycle)",
    "workOrders": [
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-b"]
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      }
    ],
    "expectedOrder": [],
    "shouldPass": false,
    "expectedError": "Circular dependency detected:"
  },
  "complex-cycle": {
    "description": "Complex cycle: A -> B -> C -> A (should detect cycle)",
    "workOrders": [
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-c"]
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      },
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-b"]
        }
      }
    ],
    "expectedOrder": [],
    "shouldPass": false,
    "expectedError": "Circular dependency detected:"
  },
  "self-cycle": {
    "description": "Self-referencing cycle: A -> A (should detect cycle)",
    "workOrders": [
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      }
    ],
    "expectedOrder": [],
    "shouldPass": false,
    "expectedError": "Circular dependency detected:"
  },
  "branched-cycle": {
    "description": "Cycle with branches: A -> B -> C -> B (cycle in middle)",
    "workOrders": [
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-c"]
        }
      },
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-b"]
        }
      },
      {
        "docId": "wo-d",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-D",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      }
    ],
    "expectedOrder": [],
    "shouldPass": false,
    "expectedError": "Circular dependency detected:"
  },
  "no-dependencies": {
    "description": "All work orders have no dependencies - should return in original order",
    "workOrders": [
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-c", "wo-a", "wo-b"],
    "shouldPass": true
  },
  "single-work-order": {
    "description": "Single work order with no dependencies",
    "workOrders": [
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a"],
    "shouldPass": true
  },
  "multiple-dependencies-single-wo": {
    "description": "Single work order with multiple dependencies: A, B, C -> D",
    "workOrders": [
      {
        "docId": "wo-d",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-D",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a", "wo-b", "wo-c"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b", "wo-c", "wo-d"],
    "shouldPass": true
  },
  "complex-multiple-dependencies": {
    "description": "Complex scenario with multiple WOs having multiple dependencies: A,B->D, C->E, D,E->F",
    "workOrders": [
      {
        "docId": "wo-f",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-F",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-d", "wo-e"]
        }
      },
      {
        "docId": "wo-d",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-D",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a", "wo-b"]
        }
      },
      {
        "docId": "wo-e",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-E",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-c"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b", "wo-d", "wo-c", "wo-e", "wo-f"],
    "shouldPass": true
  },
  "four-dependencies": {
    "description": "Work order with four dependencies: A, B, C, D -> E",
    "workOrders": [
      {
        "docId": "wo-e",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-E",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-a", "wo-b", "wo-c", "wo-d"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-c",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-C",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-d",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-D",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b", "wo-c", "wo-d", "wo-e"],
    "shouldPass": true
  },
  "dependency-on-nonexistent-wo": {
    "description": "Work order depends on a non-existent work order ID",
    "workOrders": [
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-nonexistent"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": [],
    "shouldPass": false,
    "expectedError": "Work order wo-b depends on non-existent work order: wo-nonexistent"
  },
  "dependency-on-maintenance-wo": {
    "description": "Regular work order depends on maintenance work order",
    "workOrders": [
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-maint"]
        }
      },
      {
        "docId": "wo-maint",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-MAINT",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": true,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-b"],
    "shouldPass": true
  },
  "maintenance-depends-on-regular": {
    "description": "Maintenance work order depends on regular work order",
    "workOrders": [
      {
        "docId": "wo-maint",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-MAINT",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": true,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a"],
    "shouldPass": true
  },
  "duplicate-wo-ids": {
    "description": "Duplicate work order IDs in input array",
    "workOrders": [
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A1",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A2",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": [],
    "shouldPass": false,
    "expectedError": "Duplicate work order ID found: wo-a"
  },
  "empty-dependency-strings": {
    "description": "Work order with empty strings in dependency array",
    "workOrders": [
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["", "wo-a", ""]
        }
      },
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-a", "wo-b"],
    "shouldPass": true
  },
  "complex-cycle-with-maintenance": {
    "description": "Cycle involving maintenance work orders: A -> Maint -> B -> A",
    "workOrders": [
      {
        "docId": "wo-a",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-A",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": ["wo-b"]
        }
      },
      {
        "docId": "wo-maint",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-MAINT",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": true,
          "dependsOnWorkOrderIds": ["wo-a"]
        }
      },
      {
        "docId": "wo-b",
        "docType": "workOrder",
        "data": {
          "workOrderNumber": "WO-B",
          "manufacturingOrderId": "mo-001",
          "workCenterId": "wc-001",
          "durationMinutes": 120,
          "setupTimeMinutes": 15,
          "startDate": "2024-01-01T08:00:00Z",
          "endDate": "2024-01-01T10:00:00Z",
          "sessions": [],
          "isMaintenance": false,
          "dependsOnWorkOrderIds": []
        }
      }
    ],
    "expectedOrder": ["wo-b", "wo-a"],
    "shouldPass": true
  },
  "empty-array": {
    "description": "Empty array of work orders",
    "workOrders": [],
    "expectedOrder": [],
    "shouldPass": true
  }
}

```

```typescript
import { describe, it, expect } from 'vitest';
import { ReflowService } from '../src/reflow/reflow.service';
import type { WorkOrder } from '../src/reflow/types';
import topologicalSortTestDataRaw from './data/topological-sort-test-data.json';

interface TopologicalSortTestScenario {
  description: string;
  workOrders: WorkOrder[];
  expectedOrder: string[];
  shouldPass: boolean;
  expectedError?: string;
}

const testData = topologicalSortTestDataRaw as Record<string, TopologicalSortTestScenario>;

describe('topologicalSort for WorkOrders', () => {
  describe('valid dependency graphs', () => {
    it('should sort simple chain: A -> B -> C', () => {
      const scenario = testData['simple-chain'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      const resultIds = result.map((wo) => wo.docId);
      expect(resultIds).toEqual(scenario.expectedOrder);
      expect(result).toHaveLength(scenario.expectedOrder.length);
    });

    it('should sort multiple parents: A -> C, B -> C', () => {
      const scenario = testData['multiple-parents'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      const resultIds = result.map((wo) => wo.docId);
      expect(resultIds).toEqual(scenario.expectedOrder);
      expect(result).toHaveLength(scenario.expectedOrder.length);
    });

    it('should sort complex DAG: A -> B, A -> C, B -> D, C -> D, E -> F', () => {
      const scenario = testData['complex-dag'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      const resultIds = result.map((wo) => wo.docId);
      expect(resultIds).toEqual(scenario.expectedOrder);
      expect(result).toHaveLength(scenario.expectedOrder.length);

      // Verify topological ordering: dependencies come before dependents
      const resultIndex = new Map(result.map((wo, idx) => [wo.docId, idx]));
      scenario.workOrders.forEach((wo) => {
        const woIndex = resultIndex.get(wo.docId)!;
        wo.data.dependsOnWorkOrderIds.forEach((depId) => {
          const depIndex = resultIndex.get(depId);
          if (depIndex !== undefined) {
            expect(depIndex).toBeLessThan(woIndex);
          }
        });
      });
    });

    it('should sort longer chain: A -> B -> C -> D -> E', () => {
      const scenario = testData['longer-chain'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      const resultIds = result.map((wo) => wo.docId);
      expect(resultIds).toEqual(scenario.expectedOrder);
      expect(result).toHaveLength(scenario.expectedOrder.length);
    });

    it('should handle work orders with no dependencies', () => {
      const scenario = testData['no-dependencies'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      const resultIds = result.map((wo) => wo.docId);
      expect(resultIds).toEqual(scenario.expectedOrder);
      expect(result).toHaveLength(scenario.expectedOrder.length);
    });

    it('should handle single work order', () => {
      const scenario = testData['single-work-order'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      const resultIds = result.map((wo) => wo.docId);
      expect(resultIds).toEqual(scenario.expectedOrder);
      expect(result).toHaveLength(scenario.expectedOrder.length);
    });

    it('should handle empty array', () => {
      const scenario = testData['empty-array'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });

    it('should ignore maintenance work orders', () => {
      const scenario = testData['mixed-maintenance'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      const resultIds = result.map((wo) => wo.docId);
      expect(resultIds).toEqual(scenario.expectedOrder);
      expect(result).toHaveLength(scenario.expectedOrder.length);

      // Verify no maintenance work orders are included
      result.forEach((wo) => {
        expect(wo.data.isMaintenance).toBe(false);
      });
    });

    it('should handle single WO with multiple dependencies: A, B, C -> D', () => {
      const scenario = testData['multiple-dependencies-single-wo'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      const resultIds = result.map((wo) => wo.docId);
      expect(resultIds).toEqual(scenario.expectedOrder);
      expect(result).toHaveLength(scenario.expectedOrder.length);

      // Verify D comes after all its dependencies
      const dIndex = resultIds.indexOf('wo-d');
      expect(dIndex).toBeGreaterThan(resultIds.indexOf('wo-a'));
      expect(dIndex).toBeGreaterThan(resultIds.indexOf('wo-b'));
      expect(dIndex).toBeGreaterThan(resultIds.indexOf('wo-c'));
    });

    it('should handle complex multiple dependencies: A,B->D, C->E, D,E->F', () => {
      const scenario = testData['complex-multiple-dependencies'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      const resultIds = result.map((wo) => wo.docId);
      expect(resultIds).toEqual(scenario.expectedOrder);
      expect(result).toHaveLength(scenario.expectedOrder.length);

      // Verify F comes after all its dependencies (D and E)
      const fIndex = resultIds.indexOf('wo-f');
      expect(fIndex).toBeGreaterThan(resultIds.indexOf('wo-d'));
      expect(fIndex).toBeGreaterThan(resultIds.indexOf('wo-e'));

      // Verify D comes after all its dependencies (A and B)
      const dIndex = resultIds.indexOf('wo-d');
      expect(dIndex).toBeGreaterThan(resultIds.indexOf('wo-a'));
      expect(dIndex).toBeGreaterThan(resultIds.indexOf('wo-b'));

      // Verify E comes after its dependency (C)
      const eIndex = resultIds.indexOf('wo-e');
      expect(eIndex).toBeGreaterThan(resultIds.indexOf('wo-c'));
    });

    it('should handle work order with four dependencies: A, B, C, D -> E', () => {
      const scenario = testData['four-dependencies'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      const resultIds = result.map((wo) => wo.docId);
      expect(resultIds).toEqual(scenario.expectedOrder);
      expect(result).toHaveLength(scenario.expectedOrder.length);

      // Verify E comes after all four dependencies
      const eIndex = resultIds.indexOf('wo-e');
      expect(eIndex).toBeGreaterThan(resultIds.indexOf('wo-a'));
      expect(eIndex).toBeGreaterThan(resultIds.indexOf('wo-b'));
      expect(eIndex).toBeGreaterThan(resultIds.indexOf('wo-c'));
      expect(eIndex).toBeGreaterThan(resultIds.indexOf('wo-d'));
    });
  });

  describe('cycle detection', () => {
    it('should detect simple cycle: A -> B -> A', () => {
      const scenario = testData['simple-cycle'];

      expect(() => {
        ReflowService.topologicalSort(scenario.workOrders);
      }).toThrow(scenario.expectedError);
    });

    it('should detect complex cycle: A -> B -> C -> A', () => {
      const scenario = testData['complex-cycle'];

      expect(() => {
        ReflowService.topologicalSort(scenario.workOrders);
      }).toThrow(scenario.expectedError);
    });

    it('should detect self-cycle: A -> A', () => {
      const scenario = testData['self-cycle'];

      expect(() => {
        ReflowService.topologicalSort(scenario.workOrders);
      }).toThrow(scenario.expectedError);
    });

    it('should detect cycle with branches: A -> B -> C -> B', () => {
      const scenario = testData['branched-cycle'];

      expect(() => {
        ReflowService.topologicalSort(scenario.workOrders);
      }).toThrow(scenario.expectedError);
    });

    it('should sort longer chain: A -> B -> C -> D -> E -> F; F -> B (cycle)', () => {
      const scenario = testData['longer-chain-with-cycle'];
      expect(() => {
        ReflowService.topologicalSort(scenario.workOrders);
      }).toThrow(scenario.expectedError);
    });

    it('should throw error for dependency on non-existent work order', () => {
      const scenario = testData['dependency-on-nonexistent-wo'];
      expect(() => {
        ReflowService.topologicalSort(scenario.workOrders);
      }).toThrow(scenario.expectedError);
    });

    it('should handle dependency on maintenance work order (dependency ignored)', () => {
      const scenario = testData['dependency-on-maintenance-wo'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      const resultIds = result.map((wo) => wo.docId);
      expect(resultIds).toEqual(scenario.expectedOrder);
      expect(result).toHaveLength(scenario.expectedOrder.length);
    });

    it('should handle maintenance work order depending on regular work order', () => {
      const scenario = testData['maintenance-depends-on-regular'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      const resultIds = result.map((wo) => wo.docId);
      expect(resultIds).toEqual(scenario.expectedOrder);
      expect(result).toHaveLength(scenario.expectedOrder.length);
    });

    it('should throw error for duplicate work order IDs', () => {
      const scenario = testData['duplicate-wo-ids'];
      expect(() => {
        ReflowService.topologicalSort(scenario.workOrders);
      }).toThrow(scenario.expectedError);
    });

    it('should handle empty strings in dependency arrays', () => {
      const scenario = testData['empty-dependency-strings'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      const resultIds = result.map((wo) => wo.docId);
      expect(resultIds).toEqual(scenario.expectedOrder);
      expect(result).toHaveLength(scenario.expectedOrder.length);
    });

    it('should handle complex cycle involving maintenance work orders', () => {
      const scenario = testData['complex-cycle-with-maintenance'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      const resultIds = result.map((wo) => wo.docId);
      expect(resultIds).toEqual(scenario.expectedOrder);
      expect(result).toHaveLength(scenario.expectedOrder.length);
    });
  });

  describe('topological ordering properties', () => {
    it('should ensure all dependencies are processed before dependents', () => {
      const scenario = testData['complex-dag'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      const positionMap = new Map(result.map((wo, index) => [wo.docId, index]));

      // For each work order, all its dependencies should appear before it
      result.forEach((wo, index) => {
        wo.data.dependsOnWorkOrderIds.forEach((depId) => {
          const depPosition = positionMap.get(depId);
          if (depPosition !== undefined) {
            expect(depPosition).toBeLessThan(index);
          }
        });
      });
    });

    it('should only include non-maintenance work orders', () => {
      // Use a specific scenario that includes both maintenance and non-maintenance work orders
      const scenario = testData['mixed-maintenance'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      result.forEach((wo) => {
        expect(wo.data.isMaintenance).toBe(false);
      });
    });

    it('should preserve work order objects (not create new ones)', () => {
      const scenario = testData['simple-chain'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      result.forEach((sortedWo) => {
        const originalWo = scenario.workOrders.find((wo) => wo.docId === sortedWo.docId);
        expect(sortedWo).toBe(originalWo); // Same reference
      });
    });
  });
});

```

All tests pass. Let me show you a summary of the changes made:

**Summary of improvements for Impossible Schedule Detection:**

1. **Enhanced `validator.ts`**:
   - Added `ConstraintViolation` interface for structured violation tracking
   - Added `ImpossibleScheduleError` class that aggregates all constraint violations
   - Added `ScheduleConstraintContext` interface to track scheduling context (maintenance conflicts, available time, dependency delays, etc.)
   - Enhanced `postSchedule` to provide detailed explanations when scheduling fails

2. **Enhanced `globalSchedule.ts`**:
   - Now tracks constraint context during scheduling
   - Records maintenance conflicts, available time slots, and whether shifts are available
   - Passes context to validator for detailed error messages

3. **Enhanced `reflow.service.ts`**:
   - Collects all constraint violations during reflow
   - Throws `ImpossibleScheduleError` with all violations when schedule is impossible
   - Improved cycle detection to show the full cycle path (e.g., `wo-a -> wo-b -> wo-c -> wo-a`)

**Example error messages now include:**
- `Circular dependency detected: wo-a -> wo-b -> wo-a. WO id: wo-a`
- `Work order wo-123 not fully scheduled: 60min remaining; blocked by 2 maintenance window(s); only 30min available of 120min required`
- `Work order wo-123 has no scheduled sessions: all available time blocked by maintenance or other work orders`

The `ImpossibleScheduleError` provides structured access to violations via the `.violations` array:

```typescript
interface ConstraintViolation {
  code: string;           // e.g., 'INCOMPLETE', 'CIRCULAR_DEPENDENCY'
  workOrderId: string;
  message: string;
  details?: Record<string, unknown>;
}
```

```typescript
interface ConstraintViolation {
  code: string;           // e.g., 'INCOMPLETE', 'CIRCULAR_DEPENDENCY'
  workOrderId: string;
  message: string;
  details?: Record<string, unknown>;
}
```

