---
trigger: always_on
---

# Agent Rules for quantified-self

## Project Overview
- **Framework**: Angular v20+
- **Language**: TypeScript (Loose strictness)
- **Styling**: SCSS, Angular Material, Leaftlet for maps
- **State Management**: 
  - **MANDATORY**: Use **Angular Signals** for local component state and service-level state where possible.
  - Use RxJS (Observables, Subjects) ONLY when necessary for asynchronous streams or complex event handling.
- **Dependency Injection**:
  - Supported: Constructor Injection (Legacy/Current).
  - Preferred for New Code: `inject()` function.
  - **Signals & Observables Naming**:
  - **STRICT RULE**: **ALWAYS** use the `$` suffix for Observables (e.g., `user$`, `isLoading$`).
  - **Signals**: Do **NOT** use the `$` suffix for Signals (e.g., `isLoading`, `user`).
  - Reason: Clear distinction between streams (Observables) and reactive state (Signals).

### Firebase
- Use **Modular SDK** (`@angular/fire` v20+, `firebase` v9+).
- Imports should be from `@angular/fire/*` or `firebase/*`.
- Avoid compat libraries unless strictly necessary.

### Styling
- Use **SCSS** for component styling.
- Follow **Angular Material** theming conventions.
- Use `app-service-source-icon` for displaying service logos (Garmin, Suunto, COROS) to ensure they are theme-aware (using `mat-icon` and `svgIcon`).
- interactive maps use **Leaflet**.

### General
- **Browser Compatibility**: Use `BrowserCompatibilityService` to check for modern API support (e.g., `CompressionStream`, `DecompressionStream`) before using them. If unsupported, the service handles showing an upgrade dialog.
- **Strictness**: The project has `strict` mode potentially off or loose (based on `tsconfig` analysis). Ensure null checks are handled gracefully.
- **Bailout First**: Always use "bailout first" / "return early" patterns. Avoid deep nesting of `if/else` statements. Handle validation, error checks, and edge cases at the very beginning of functions and return immediately.
- **Directory Structure**:
  - `src/app/modules`: Feature modules.
  - `src/app/services`: Singleton services.
  - `src/app/components`: Shared components.
