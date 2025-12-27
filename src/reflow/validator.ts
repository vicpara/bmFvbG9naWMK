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

