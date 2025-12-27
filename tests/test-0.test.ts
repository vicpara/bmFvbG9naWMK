import { describe, it, expect } from 'vitest'
import { ReflowService } from '../src/reflow/reflow.service'
import type { ReflowInput } from '../src/reflow/types'
import * as fs from 'fs'
import * as path from 'path'

describe('Simple Reflow Test', () => {
  const service = new ReflowService()

  it('should reschedule work order with 30m setup time after maintenance window conflict', () => {
    const simpleTestData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/test-data-0.json'), 'utf8'))

    const workOrder = simpleTestData.workOrders['wo-simple']
    const manufacturingOrder = simpleTestData.manufacturingOrders['mo-simple']
    const expectedResult = simpleTestData.expectedResult

    const input: ReflowInput = {
      workOrders: [workOrder],
      manufacturingOrder
    }

    const result = service.reflow(input)

    // Should have one updated work order
    expect(result.updatedWorkOrders).toHaveLength(1)

    // Should have one change record
    expect(result.changes).toHaveLength(1)

    // Check the rescheduled work order
    const updatedWo = result.updatedWorkOrders[0]
    expect(updatedWo.docId).toBe('wo-simple')
    expect(updatedWo.data.startDate).toBe(expectedResult.updatedWorkOrders[0].data.startDate)
    expect(updatedWo.data.endDate).toBe(expectedResult.updatedWorkOrders[0].data.endDate)
    expect(updatedWo.data.setupTimeMinutes).toBe(30)

    // Check the change record
    const change = result.changes[0]
    expect(change.workOrderId).toBe('wo-simple')
    expect(change.originalStartDate).toBe('2024-01-01T08:00:00Z')
    expect(change.newStartDate).toBe('2024-01-01T09:00:00Z')
    expect(change.reason).toContain('Maintenance window conflict')

    // Should have explanation
    expect(result.explanation).toHaveLength(expectedResult.explanation.length)
    expect(result.explanation[0]).toContain('maintenance window conflict')
  })
})
