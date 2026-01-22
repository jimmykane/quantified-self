---
name: test-automation
description: Generate and manage Vitest tests for Angular components, services, and Firebase integrations
---

# Test Automation Skill

Generate comprehensive Vitest tests for the quantified-self Angular application.

## Testing Framework

| Aspect | Configuration |
|--------|---------------|
| Framework | **Vitest** v3.x |
| Angular Plugin | `@analogjs/vite-plugin-angular` |
| Environment | `jsdom` |
| Coverage | `@vitest/coverage-v8` |

## Commands

```bash
# Run all tests
npm test

# Run with coverage
npm run test-coverage

# Run Firestore rules tests (requires emulator)
npm run test:rules
```

## Test File Patterns

### 1. Service Test Template

```typescript
import { TestBed } from '@angular/core/testing';
import { vi, describe, it, expect, beforeEach, afterEach, Mock } from 'vitest';
import { MyService } from './my.service';

// Hoist mocks BEFORE vi.mock() calls
const mocks = vi.hoisted(() => ({
  myMockedFn: vi.fn(),
}));

// Mock external modules
vi.mock('@angular/fire/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/fire/firestore')>();
  return { ...actual, doc: vi.fn(), docData: vi.fn() };
});

describe('MyService', () => {
  let service: MyService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        MyService,
        { provide: SomeDep, useValue: mockDep },
      ]
    });
    service = TestBed.inject(MyService);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
```

### 2. Component Test Template

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MyComponent } from './my.component';

describe('MyComponent', () => {
  let component: MyComponent;
  let fixture: ComponentFixture<MyComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [/* required modules */],
      declarations: [MyComponent],
      providers: [/* mocked services */]
    }).compileComponents();

    fixture = TestBed.createComponent(MyComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
```

## Mocking Patterns

### Firebase/Firestore Mocking

```typescript
vi.mock('@angular/fire/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/fire/firestore')>();
  return {
    ...actual,
    doc: vi.fn(),
    docData: vi.fn(() => of(mockData)),
    collection: vi.fn(),
    collectionData: vi.fn(() => of([mockItem])),
    deleteDoc: vi.fn().mockResolvedValue(undefined),
    setDoc: vi.fn().mockResolvedValue(undefined),
  };
});
```

### RxJS Observables

```typescript
import { of, throwError } from 'rxjs';

// Success
(someMethod as Mock).mockReturnValue(of(mockData));

// Error
(someMethod as Mock).mockReturnValue(throwError(() => new Error('Test error')));
```

### Browser APIs

```typescript
// Store original before modifying
const originalAPI = globalThis.SomeAPI;

beforeEach(() => {
  globalThis.SomeAPI = vi.fn().mockImplementation(() => ({ /* mock */ }));
});

afterEach(() => {
  globalThis.SomeAPI = originalAPI;
});
```

## Key Differences from Jasmine/Karma

| Jasmine/Karma | Vitest |
|---------------|--------|
| `jasmine.createSpy()` | `vi.fn()` |
| `spyOn(obj, 'method')` | `vi.spyOn(obj, 'method')` |
| `and.returnValue()` | `.mockReturnValue()` |
| `and.callFake()` | `.mockImplementation()` |
| `toHaveBeenCalledWith()` | `toHaveBeenCalledWith()` ✓ |
| `jasmine.any(Type)` | `expect.any(Type)` |

## Coverage Analysis

```bash
# Generate coverage report
npm run test-coverage

# Output: coverage/index.html
```

## Checklist for New Tests

- [ ] Import from `vitest`: `vi, describe, it, expect, beforeEach, afterEach`
- [ ] Use `vi.hoisted()` for mock values needed in `vi.mock()`
- [ ] Mock Firebase modules with `async (importOriginal)` pattern
- [ ] Use `vi.clearAllMocks()` in `beforeEach`
- [ ] Use `vi.restoreAllMocks()` in `afterEach`
- [ ] Cast mocks with `as Mock` for `.mockReturnValue()` calls
