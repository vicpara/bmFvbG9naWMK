import { describe, it, expect } from 'vitest';
import { ReflowService } from '../src/reflow/reflow.service';
import type { WorkOrder } from '../src/reflow/types';
import topologicalSortTestDataRaw from './data/topological-sort-test-data.json';

interface TopologicalSortTestScenario {
  description: string;
  workOrders: WorkOrder[];
  expectedOrder: string[];
  shouldPass: boolean;
  expectedError?: string;
}

const testData = topologicalSortTestDataRaw as Record<string, TopologicalSortTestScenario>;

describe('topologicalSort for WorkOrders', () => {
  describe('valid dependency graphs', () => {
    it('should sort simple chain: A -> B -> C', () => {
      const scenario = testData['simple-chain'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      const resultIds = result.map((wo) => wo.docId);
      expect(resultIds).toEqual(scenario.expectedOrder);
      expect(result).toHaveLength(scenario.expectedOrder.length);
    });

    it('should sort multiple parents: A -> C, B -> C', () => {
      const scenario = testData['multiple-parents'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      const resultIds = result.map((wo) => wo.docId);
      expect(resultIds).toEqual(scenario.expectedOrder);
      expect(result).toHaveLength(scenario.expectedOrder.length);
    });

    it('should sort complex DAG: A -> B, A -> C, B -> D, C -> D, E -> F', () => {
      const scenario = testData['complex-dag'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      const resultIds = result.map((wo) => wo.docId);
      expect(resultIds).toEqual(scenario.expectedOrder);
      expect(result).toHaveLength(scenario.expectedOrder.length);

      // Verify topological ordering: dependencies come before dependents
      const resultIndex = new Map(result.map((wo, idx) => [wo.docId, idx]));
      scenario.workOrders.forEach((wo) => {
        const woIndex = resultIndex.get(wo.docId)!;
        wo.data.dependsOnWorkOrderIds.forEach((depId) => {
          const depIndex = resultIndex.get(depId);
          if (depIndex !== undefined) {
            expect(depIndex).toBeLessThan(woIndex);
          }
        });
      });
    });

    it('should sort longer chain: A -> B -> C -> D -> E', () => {
      const scenario = testData['longer-chain'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      const resultIds = result.map((wo) => wo.docId);
      expect(resultIds).toEqual(scenario.expectedOrder);
      expect(result).toHaveLength(scenario.expectedOrder.length);
    });

    it('should handle work orders with no dependencies', () => {
      const scenario = testData['no-dependencies'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      const resultIds = result.map((wo) => wo.docId);
      expect(resultIds).toEqual(scenario.expectedOrder);
      expect(result).toHaveLength(scenario.expectedOrder.length);
    });

    it('should handle single work order', () => {
      const scenario = testData['single-work-order'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      const resultIds = result.map((wo) => wo.docId);
      expect(resultIds).toEqual(scenario.expectedOrder);
      expect(result).toHaveLength(scenario.expectedOrder.length);
    });

    it('should handle empty array', () => {
      const scenario = testData['empty-array'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });

    it('should ignore maintenance work orders', () => {
      const scenario = testData['mixed-maintenance'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      const resultIds = result.map((wo) => wo.docId);
      expect(resultIds).toEqual(scenario.expectedOrder);
      expect(result).toHaveLength(scenario.expectedOrder.length);

      // Verify no maintenance work orders are included
      result.forEach((wo) => {
        expect(wo.data.isMaintenance).toBe(false);
      });
    });

    it('should handle single WO with multiple dependencies: A, B, C -> D', () => {
      const scenario = testData['multiple-dependencies-single-wo'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      const resultIds = result.map((wo) => wo.docId);
      expect(resultIds).toEqual(scenario.expectedOrder);
      expect(result).toHaveLength(scenario.expectedOrder.length);

      // Verify D comes after all its dependencies
      const dIndex = resultIds.indexOf('wo-d');
      expect(dIndex).toBeGreaterThan(resultIds.indexOf('wo-a'));
      expect(dIndex).toBeGreaterThan(resultIds.indexOf('wo-b'));
      expect(dIndex).toBeGreaterThan(resultIds.indexOf('wo-c'));
    });

    it('should handle complex multiple dependencies: A,B->D, C->E, D,E->F', () => {
      const scenario = testData['complex-multiple-dependencies'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      const resultIds = result.map((wo) => wo.docId);
      expect(resultIds).toEqual(scenario.expectedOrder);
      expect(result).toHaveLength(scenario.expectedOrder.length);

      // Verify F comes after all its dependencies (D and E)
      const fIndex = resultIds.indexOf('wo-f');
      expect(fIndex).toBeGreaterThan(resultIds.indexOf('wo-d'));
      expect(fIndex).toBeGreaterThan(resultIds.indexOf('wo-e'));

      // Verify D comes after all its dependencies (A and B)
      const dIndex = resultIds.indexOf('wo-d');
      expect(dIndex).toBeGreaterThan(resultIds.indexOf('wo-a'));
      expect(dIndex).toBeGreaterThan(resultIds.indexOf('wo-b'));

      // Verify E comes after its dependency (C)
      const eIndex = resultIds.indexOf('wo-e');
      expect(eIndex).toBeGreaterThan(resultIds.indexOf('wo-c'));
    });

    it('should handle work order with four dependencies: A, B, C, D -> E', () => {
      const scenario = testData['four-dependencies'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      const resultIds = result.map((wo) => wo.docId);
      expect(resultIds).toEqual(scenario.expectedOrder);
      expect(result).toHaveLength(scenario.expectedOrder.length);

      // Verify E comes after all four dependencies
      const eIndex = resultIds.indexOf('wo-e');
      expect(eIndex).toBeGreaterThan(resultIds.indexOf('wo-a'));
      expect(eIndex).toBeGreaterThan(resultIds.indexOf('wo-b'));
      expect(eIndex).toBeGreaterThan(resultIds.indexOf('wo-c'));
      expect(eIndex).toBeGreaterThan(resultIds.indexOf('wo-d'));
    });
  });

  describe('cycle detection', () => {
    it('should detect simple cycle: A -> B -> A', () => {
      const scenario = testData['simple-cycle'];

      expect(() => {
        ReflowService.topologicalSort(scenario.workOrders);
      }).toThrow(scenario.expectedError);
    });

    it('should detect complex cycle: A -> B -> C -> A', () => {
      const scenario = testData['complex-cycle'];

      expect(() => {
        ReflowService.topologicalSort(scenario.workOrders);
      }).toThrow('Circular dependency detected in work order chain');
    });

    it('should detect self-cycle: A -> A', () => {
      const scenario = testData['self-cycle'];

      expect(() => {
        ReflowService.topologicalSort(scenario.workOrders);
      }).toThrow(scenario.expectedError);
    });

    it('should detect cycle with branches: A -> B -> C -> B', () => {
      const scenario = testData['branched-cycle'];

      expect(() => {
        ReflowService.topologicalSort(scenario.workOrders);
      }).toThrow(scenario.expectedError);
    });

    it('should sort longer chain: A -> B -> C -> D -> E -> F; F -> B (cycle)', () => {
      const scenario = testData['longer-chain-with-cycle'];
      expect(() => {
        ReflowService.topologicalSort(scenario.workOrders);
      }).toThrow(scenario.expectedError);
    });

    it('should throw error for dependency on non-existent work order', () => {
      const scenario = testData['dependency-on-nonexistent-wo'];
      expect(() => {
        ReflowService.topologicalSort(scenario.workOrders);
      }).toThrow(scenario.expectedError);
    });

    it('should handle dependency on maintenance work order (dependency ignored)', () => {
      const scenario = testData['dependency-on-maintenance-wo'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      const resultIds = result.map((wo) => wo.docId);
      expect(resultIds).toEqual(scenario.expectedOrder);
      expect(result).toHaveLength(scenario.expectedOrder.length);
    });

    it('should handle maintenance work order depending on regular work order', () => {
      const scenario = testData['maintenance-depends-on-regular'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      const resultIds = result.map((wo) => wo.docId);
      expect(resultIds).toEqual(scenario.expectedOrder);
      expect(result).toHaveLength(scenario.expectedOrder.length);
    });

    it('should throw error for duplicate work order IDs', () => {
      const scenario = testData['duplicate-wo-ids'];
      expect(() => {
        ReflowService.topologicalSort(scenario.workOrders);
      }).toThrow(scenario.expectedError);
    });

    it('should handle empty strings in dependency arrays', () => {
      const scenario = testData['empty-dependency-strings'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      const resultIds = result.map((wo) => wo.docId);
      expect(resultIds).toEqual(scenario.expectedOrder);
      expect(result).toHaveLength(scenario.expectedOrder.length);
    });

    it('should handle complex cycle involving maintenance work orders', () => {
      const scenario = testData['complex-cycle-with-maintenance'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      const resultIds = result.map((wo) => wo.docId);
      expect(resultIds).toEqual(scenario.expectedOrder);
      expect(result).toHaveLength(scenario.expectedOrder.length);
    });
  });

  describe('topological ordering properties', () => {
    it('should ensure all dependencies are processed before dependents', () => {
      const scenario = testData['complex-dag'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      const positionMap = new Map(result.map((wo, index) => [wo.docId, index]));

      // For each work order, all its dependencies should appear before it
      result.forEach((wo, index) => {
        wo.data.dependsOnWorkOrderIds.forEach((depId) => {
          const depPosition = positionMap.get(depId);
          if (depPosition !== undefined) {
            expect(depPosition).toBeLessThan(index);
          }
        });
      });
    });

    it('should only include non-maintenance work orders', () => {
      // Use a specific scenario that includes both maintenance and non-maintenance work orders
      const scenario = testData['mixed-maintenance'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      result.forEach((wo) => {
        expect(wo.data.isMaintenance).toBe(false);
      });
    });

    it('should preserve work order objects (not create new ones)', () => {
      const scenario = testData['simple-chain'];
      const result = ReflowService.topologicalSort(scenario.workOrders);

      result.forEach((sortedWo, index) => {
        const originalWo = scenario.workOrders.find((wo) => wo.docId === sortedWo.docId);
        expect(sortedWo).toBe(originalWo); // Same reference
      });
    });
  });
});
