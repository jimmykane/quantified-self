---
trigger: model_decision
description: Use this rule when doing angular or typescript tasks
---

Use this rule for day-to-day Angular and TypeScript implementation work.

## Apply This Rule
- Angular component, service, directive, pipe, or template changes
- TypeScript refactors and new API design

## Do Not Apply This Rule
- Security-only review tasks (use `security-reviewer`)
- UX-only audits (use `ux-ui`)

## TypeScript
- Prefer explicit types at API boundaries; use inference inside function bodies.
- Avoid `any`; use `unknown` and narrow with guards.
- Handle `null` and `undefined` explicitly.

## Angular
- Prefer standalone APIs and modern control flow (`@if`, `@for`, `@switch`).
- Use `input()` and `output()` for component contracts.
- Prefer `inject()` for new dependency injection code.
- Keep `ChangeDetectionStrategy.OnPush` unless there is a clear reason not to.
- Use `host` metadata instead of `@HostBinding`/`@HostListener`.

## Reactivity
- Prefer Signals for local and service state.
- Use Observables for async streams and external event sources.
- Keep naming consistent: Observables end with `$`; Signals do not.
- Do not call methods that create Observables directly from template bindings.

## Templates and Styling
- Keep template logic simple; move heavy logic to component code.
- Prefer class/style bindings over `ngClass` and `ngStyle` when feasible.
- Use `NgOptimizedImage` for static image assets.
- Follow existing Material and theme variable conventions from project rules.

## Validation
- Run relevant tests after modifications.
