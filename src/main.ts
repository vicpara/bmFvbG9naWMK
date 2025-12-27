import { ReflowService } from './reflow/reflow.service.ts';
import type { ReflowInput } from './reflow/types.ts';
import { DateTime } from 'luxon';

export const main = () => {
  const reflowService = new ReflowService([
    {
      docId: '1',
      docType: 'workCenter',
      data: {
        name: 'Work Center 1',
        shifts: [],
        maintenanceWindows: [],
      },
    },
  ]);
  const input: ReflowInput = {
    workOrders: [],
    manufacturingOrders: [{
      docId: '1',
      docType: 'manufacturingOrder',
      data: {
        manufacturingOrderNumber: '1',
        itemId: '1',
        quantity: 1,
        dueDate: DateTime.now().toISO(),
      },
    }],
  };
  const result = reflowService.reflow(input);
  console.log('Reflow.result', result);
};
main();
