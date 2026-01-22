---
trigger: model_decision
description: Use this rule for Angular testing best practices, guidelines, and troubleshooting Vitest tests.
---

# Testing Guidelines

You are an expert in testing Angular applications using **Vitest** with `@analogjs/vite-plugin-angular`. Follow these rules when writing or modifying tests.

## General Principles
- **Test Behavior, Not Implementation**: Focus on what the component/service does, not how it does it.
- **Isolation**: Unit tests should test one thing in isolation. Mock dependencies.
- **Readability**: Tests should be easy to read and understand. Use descriptive `describe` and `it` blocks.
- **Maintainability**: Avoid brittle tests that break with every minor code change.

## Angular Testing Best Practices
- **Use `TestBed`**: Always configure the testing module using `TestBed.configureTestingModule`.
- **Mock Dependencies**: Use `vi.fn()` and `vi.mock()` to mock services and dependencies. Use `vi.hoisted()` for mock values needed in `vi.mock()` calls.
- **NO_ERRORS_SCHEMA**: Use `NO_ERRORS_SCHEMA` cautiously. It hides template errors. Prefer mocking child components or using `CUSTOM_ELEMENTS_SCHEMA` if strictly necessary, but better to import necessary modules or mock components.
- **Async Testing**: Use `fakeAsync` and `tick` for controlling time, or native async/await with Vitest.
- **Change Detection**: Manually trigger change detection with `fixture.detectChanges()` when testing template updates.

## Naming Conventions
- **Files**: `*.spec.ts`
- **Suites**: `describe('ComponentName', ...)`
- **Specs**: `it('should do something', ...)`

## Example Structure
```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi, describe, it, expect, beforeEach, afterEach, Mock } from 'vitest';
import { MyComponent } from './my.component';
import { MyService } from '../my.service';

// Hoist mocks for use in vi.mock()
const mocks = vi.hoisted(() => ({
  getValue: vi.fn(),
}));

describe('MyComponent', () => {
  let component: MyComponent;
  let fixture: ComponentFixture<MyComponent>;
  const mockService = { getValue: mocks.getValue };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [MyComponent],
      providers: [
        { provide: MyService, useValue: mockService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(MyComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should call service on init', () => {
    mocks.getValue.mockReturnValue('test value');
    component.ngOnInit();
    expect(mocks.getValue).toHaveBeenCalled();
  });
});
```

## CI/CD Integration
- Tests are run using `npm test` (Vitest).
- Coverage: `npm run test-coverage` generates a coverage report.
- Firestore rules tests: `npm run test:rules` (requires Firebase emulator).

## Context7 Usage

- **Vitest**: Use `context7` to find documentation for Vitest configuration, assertions, and mocking utilities.
- **Angular Testing Library**: Use `context7` for Angular Testing Library best practices if applicable.
