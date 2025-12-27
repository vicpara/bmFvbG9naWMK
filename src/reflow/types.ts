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
