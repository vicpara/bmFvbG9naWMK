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

