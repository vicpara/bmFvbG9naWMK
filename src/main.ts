import { ReflowService } from './reflow/reflow.service';
import type { WorkOrder, WorkCenter, ManufacturingOrder, ReflowInput } from './reflow/types';

function createScenario1DelayCascade(): { input: ReflowInput; workCenter: WorkCenter } {
  // Scenario 1: Delay Cascade - One order delayed → affects downstream orders
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
      maintenanceWindows: [],
    },
  };

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
        startDate: '2024-01-15T08:00:00Z', // Monday 8AM
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
        dependsOnWorkOrderIds: ['WO-001'], // Depends on WO-001
      },
    },
    {
      docId: 'WO-003',
      docType: 'workOrder',
      data: {
        workOrderNumber: 'WO-003',
        manufacturingOrderId: 'MO-001',
        workCenterId: 'WC-001',
        durationMinutes: 90,
        setupTimeMinutes: 10,
        startDate: '2024-01-15T08:00:00Z',
        endDate: '2024-01-15T09:40:00Z',
        sessions: [],
        isMaintenance: false,
        dependsOnWorkOrderIds: ['WO-002'], // Depends on WO-002
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

  return {
    input: { workOrders, manufacturingOrders: [manufacturingOrder] },
    workCenter
  };
}

function createScenario2ShiftMaintenance(): { input: ReflowInput; workCenter: WorkCenter } {
  // Scenario 2: Shift or Maintenance - Order spans shifts OR conflicts with maintenance
  const workCenter: WorkCenter = {
    docId: 'WC-001',
    docType: 'workCenter',
    data: {
      name: 'Assembly Line A',
      shifts: [
        { dayOfWeek: 1, startHour: 8, endHour: 17 }, // Monday 8AM-5PM
        { dayOfWeek: 2, startHour: 8, endHour: 17 }, // Tuesday 8AM-5PM
      ],
      maintenanceWindows: [
        {
          startDate: '2024-01-16T10:00:00Z', // Tuesday 10AM
          endDate: '2024-01-16T12:00:00Z',   // Tuesday 12PM (2 hour maintenance)
        },
      ],
    },
  };

  const workOrders: WorkOrder[] = [
    {
      docId: 'WO-004',
      docType: 'workOrder',
      data: {
        workOrderNumber: 'WO-004',
        manufacturingOrderId: 'MO-002',
        workCenterId: 'WC-001',
        durationMinutes: 300, // 5 hours - will span shifts
        setupTimeMinutes: 20,
        startDate: '2024-01-15T15:00:00Z', // Monday 3PM (late start)
        endDate: '2024-01-15T20:15:00Z',
        sessions: [],
        isMaintenance: false,
        dependsOnWorkOrderIds: [],
      },
    },
    {
      docId: 'WO-005',
      docType: 'workOrder',
      data: {
        workOrderNumber: 'WO-005',
        manufacturingOrderId: 'MO-002',
        workCenterId: 'WC-001',
        durationMinutes: 180, // 3 hours - conflicts with maintenance
        setupTimeMinutes: 15,
        startDate: '2024-01-16T08:00:00Z', // Tuesday 8AM
        endDate: '2024-01-16T11:15:00Z',
        sessions: [],
        isMaintenance: false,
        dependsOnWorkOrderIds: [],
      },
    },
  ];

  const manufacturingOrder: ManufacturingOrder = {
    docId: 'MO-002',
    docType: 'manufacturingOrder',
    data: {
      manufacturingOrderNumber: 'MO-002',
      itemId: 'PRODUCT-B',
      quantity: 50,
      dueDate: '2024-01-18T17:00:00Z',
    },
  };

  return {
    input: { workOrders, manufacturingOrders: [manufacturingOrder] },
    workCenter
  };
}

function runScenario(name: string, scenario: { input: ReflowInput; workCenter: WorkCenter }) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`SCENARIO: ${name}`);
  console.log(`${'='.repeat(60)}\n`);

  const { input, workCenter } = scenario;

  console.log('Input Data:');
  console.log(`- Manufacturing Order: ${input.manufacturingOrders[0].data.manufacturingOrderNumber}`);
  console.log(`- Work Orders: ${input.workOrders.map((wo) => wo.data.workOrderNumber).join(', ')}`);
  console.log(`- Work Center: ${workCenter.data.name}`);
  console.log(`- Shifts: ${workCenter.data.shifts.length} shifts`);
  console.log(`- Maintenance Windows: ${workCenter.data.maintenanceWindows.length}\n`);

  const reflowService = new ReflowService([workCenter]);

  try {
    const result = reflowService.reflow(input);

    console.log('RESULTS:');
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
      console.log(`\n- Changes Made: ${result.changes.length}`);
      result.changes.forEach(change => console.log(`  • ${change}`));
      console.log(`- Explanations: ${result.explanation.length}`);
      result.explanation.forEach(exp => console.log(`  • ${exp}`));
    } else {
      console.log('\n- No changes were needed');
    }

    console.log('\n=== OPTIMIZATION METRICS ===');
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

export function main() {
  console.log('=== REFLOW ALGORITHM DEMO ===');
  console.log('Demonstrating both required scenarios:\n');

  runScenario('1. Delay Cascade (WO-001 delayed → affects WO-002 → affects WO-003)', createScenario1DelayCascade());
  runScenario('2. Shift + Maintenance (WO-004 spans shifts, WO-005 conflicts with maintenance)', createScenario2ShiftMaintenance());

  console.log(`\n${'='.repeat(60)}`);
  console.log('DEMO COMPLETE');
  console.log(`${'='.repeat(60)}\n`);
}

main();
