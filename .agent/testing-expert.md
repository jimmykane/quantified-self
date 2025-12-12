---
trigger: model_decision
description: Use this rule for Angular testing best practices, guidelines, and troubleshooting Jasmine/Karma tests.
---

# Testing Guidelines

You are an expert in testing Angular applications using Jasmine and Karma. Follow these rules when writing or modifying tests.

## General Principles
- **Test Behavior, Not Implementation**: Focus on what the component/service does, not how it does it.
- **Isolation**: Unit tests should test one thing in isolation. Mock dependencies.
- **Readability**: Tests should be easy to read and understand. Use descriptive `describe` and `it` blocks.
- **Maintainability**: Avoid brittle tests that break with every minor code change.

## Angular Testing Best Practices
- **Use `TestBed`**: Always configure the testing module using `TestBed.configureTestingModule`.
- **Mock Dependencies**: Use `jasmine.createSpyObj` to mock services and dependencies. Avoid using real services in unit tests unless necessary (e.g., for integration tests).
- **NO_ERRORS_SCHEMA**: Use `NO_ERRORS_SCHEMA` cautiously. It hides template errors. Prefer mocking child components or using `CUSTOM_ELEMENTS_SCHEMA` if strictly necessary, but better to import necessary modules or mock components.
- **Async Testing**: Use `fakeAsync` and `tick` for controlling time and asynchronous operations. Avoid `async/await` in tests if `fakeAsync` can be used for better control.
- **Change Detection**: Manually trigger change detection with `fixture.detectChanges()` when testing template updates.

## Naming Conventions
- **Files**: `*.spec.ts`
- **Suites**: `describe('ComponentName', ...)`
- **Specs**: `it('should do something', ...)`

## Example Structure
```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MyComponent } from './my.component';
import { MyService } from '../my.service';

describe('MyComponent', () => {
  let component: MyComponent;
  let fixture: ComponentFixture<MyComponent>;
  let myServiceSpy: jasmine.SpyObj<MyService>;

  beforeEach(async () => {
    const spy = jasmine.createSpyObj('MyService', ['getValue']);

    await TestBed.configureTestingModule({
      declarations: [ MyComponent ],
      providers: [
        { provide: MyService, useValue: spy }
      ]
    })
    .compileComponents();

    myServiceSpy = TestBed.inject(MyService) as jasmine.SpyObj<MyService>;
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(MyComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should call service on init', () => {
    myServiceSpy.getValue.and.returnValue('test value');
    component.ngOnInit();
    expect(myServiceSpy.getValue).toHaveBeenCalled();
  });
});
```

## CI/CD Integration
- Tests are run in GitHub Actions using `npm run test` (or `ng test --watch=false --browsers=ChromeHeadless`).
- Ensure tests pass locally before pushing.

## Context7 Usage

- **Vitest**: Use `context7` to find documentation for Vitest configuration, assertions, and mocking utilities.
- **Angular Testing Library**: Use `context7` for Angular Testing Library best practices if applicable.
