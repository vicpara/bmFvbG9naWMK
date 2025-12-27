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
