import type { ScheduledEvent, WorkCenter, WorkOrder, Conflict, TimeSlot, Session } from './types';
import { getDayKey, getNextShiftInterval } from '../utils/date';
import { DateTime } from 'luxon';

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
