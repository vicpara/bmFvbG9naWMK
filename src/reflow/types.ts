// Base document structure
export interface Document {
  docId: string;
  docType: string;
  data: Record<string, any>;
}

// Work Center document
export interface WorkCenter extends Document {
  docType: 'workCenter';
  data: {
    name: string;

    // Shifts
    shifts: Array<{
      dayOfWeek: number; // 0-6, Sunday = 0
      startHour: number; // 0-23
      endHour: number; // 0-23
    }>;

    // Maintenance windows (blocked time periods)
    maintenanceWindows: Array<{
      startDate: string;
      endDate: string;
      reason?: string; // Optional description
    }>;
  };
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
  manufacturingOrder: ManufacturingOrder;
}

export interface ReflowResult {
  updatedWorkOrders: WorkOrder[];
  changes: ReflowChange[];
  explanation: string[];
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
