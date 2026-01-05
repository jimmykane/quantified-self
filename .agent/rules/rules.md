---
trigger: always_on
---

# Agent Rules for quantified-self

## Project Overview
- **Framework**: Angular v20+
- **Language**: TypeScript (Loose strictness)
- **Styling**: SCSS, Angular Material, Leaftlet for maps
- **State Management**: RxJS (Observables, Subjects), some Signals usage encouraged for new code
- **Backend/Services**: Firebase (Modular SDK), Google Maps

## Code Style & Conventions

### Angular
- **Architecture**:
  - Use **NgModules** (Current project structure heavily relies on them).
  - Use `standalone: false` for components unless creating a solitary utility.
  - **OnPush** Change Detection is preferred but not strictly enforced in legacy components.
- **Dependency Injection**:
  - Supported: Constructor Injection (Legacy/Current).
  - Preferred for New Code: `inject()` function.
- **Signals**:
  - Adopt Angular Signals for local component state where possible.

### Firebase
- Use **Modular SDK** (`@angular/fire` v20+, `firebase` v9+).
- Imports should be from `@angular/fire/*` or `firebase/*`.
- Avoid compat libraries unless strictly necessary.

### Styling
- Use **SCSS** for component styling.
- Follow **Angular Material** theming conventions.
- interactive maps use **Leaflet**.

### General
- **Strictness**: The project has `strict` mode potentially off or loose (based on `tsconfig` analysis). Ensure null checks are handled gracefully.
- **Bailout First**: Always use "bailout first" / "return early" patterns. Avoid deep nesting of `if/else` statements. Handle validation, error checks, and edge cases at the very beginning of functions and return immediately.
- **Directory Structure**:
  - `src/app/modules`: Feature modules.
  - `src/app/services`: Singleton services.
  - `src/app/components`: Shared components.
