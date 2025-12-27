# Reflow Algorithm

A work order scheduling algorithm that handles shift constraints, maintenance windows, and work order dependencies.

## Running the Example

```bash
npm run example
```

This runs `src/main.ts` which demonstrates:
- Creating work centers with shifts and maintenance windows
- Creating work orders with dependencies
- Running the reflow algorithm to schedule work orders

## Running Tests

```bash
npm test          # Run tests in watch mode
npm run test:run  # Run tests once
```

## Tests

### `reflow.service.test.ts`
Core reflow algorithm tests:
- **No conflict scenarios** - Work orders that don't need rescheduling
- **Shift conflict scenarios** - Rescheduling when work center has no shift
- **Maintenance conflict scenarios** - Rescheduling around maintenance windows
- **Multi-session scenarios** - Splitting work orders across sessions/shifts
- **Edge cases** - Empty arrays, multiple work orders, maintenance priorities

### `wo-sort.test.ts`
Topological sort tests for work order dependencies:
- Valid dependency graphs (chains, DAGs, multiple parents)
- Cycle detection (simple, complex, self-referential)
- Ordering property verification

### `test-0.test.ts`
Simple integration test for basic rescheduling with setup time.

