import { DateTime } from 'luxon';
import type { ShiftInterval, WorkCenter } from '../reflow/types';

export const getDayKey = (date: string | DateTime) => {
  const dt = typeof date === 'string' ? DateTime.fromISO(date) : date;
  return Math.floor(dt.toUTC().startOf('day').toMillis() / (24 * 60 * 60 * 1000));
};

export const isDateInShift = (shift: ShiftInterval, date: DateTime): boolean => {
  return date.hour >= shift.startDate.hour && date.hour < shift.endDate.hour;
};

export const isDuringShift = (wc: WorkCenter, date: DateTime): boolean => {
  const dayOfWeek = date.weekday % 7;
  const shift = wc.data.shifts.find((s) => s.dayOfWeek === dayOfWeek);
  return shift ? date.hour >= shift.startHour && date.hour < shift.endHour : false;
};

// we're looking for the next shift interval that contains the date or starts after the date within MAX_DAYS_LOOKAHEAD horizon.
export const getNextShiftInterval = (wc: WorkCenter, date: DateTime, maxDaysLookahead: number = 365): ShiftInterval => {
  let current = date.toUTC().startOf('day');
  for (let i = 0; i < maxDaysLookahead; i++) {
    const dayOfWeek = current.weekday % 7;
    const shift = wc.data.shifts.find((s) => s.dayOfWeek === dayOfWeek);
    if (shift) {
      const shiftStart = current.plus({ hours: shift.startHour });
      const shiftEnd = current.plus({ hours: shift.endHour });
      // If the date is during this shift, return it
      if (date >= shiftStart && date < shiftEnd) {
        return { startDate: shiftStart, endDate: shiftEnd };
      }
      // If the shift starts after the date, return it
      if (shiftStart >= date) {
        return { startDate: shiftStart, endDate: shiftEnd };
      }
    }
    current = current.plus({ days: 1 });
  }
  throw new Error('No shift found');
};
