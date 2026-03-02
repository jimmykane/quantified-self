---
trigger: always_on
description: Core project-wide engineering rules for quantified-self.
---

# Agent Rules for quantified-self

## Scope
These are baseline rules that apply across the repository unless a deeper `AGENTS.md` overrides scope.

## Stack
- Framework: Angular v20+
- Language: TypeScript (loose strictness)
- Styling: SCSS + Angular Material
- Maps: Leaflet

## Reactivity and Naming
- Prefer Angular Signals for local and service state.
- Use RxJS when stream semantics are required.
- Observables must use `$` suffix; Signals must not.

## Dependency Injection
- Prefer `inject()` for new code.
- Constructor injection is acceptable in existing code paths.

## Zone and External APIs
- Avoid Zone.js-driven behavior fixes (`NgZone.run`, manual change-detection nudges) as a first-line solution.
- Prefer official framework/library APIs for coordination (for example ECharts `connect`, `dispatchAction`, `takeGlobalCursor`, native event contracts).
- If Angular boundary handling is unavoidable, keep it isolated at integration edges and document why the official API path was insufficient.
- Do not introduce new Zone.js coupling in chart synchronization flows when an ECharts-native mechanism exists.

## Firebase
- Use modular SDK imports (`@angular/fire/*`, `firebase/*`).
- Avoid compat APIs unless required by existing integration.

## UI and Styling
- Use external style files; avoid inline template styles and inline component style arrays.
- Follow Material theming and CSS variable patterns.
- Use `app-service-source-icon` for Garmin/Suunto/COROS logos.
- Use Barlow Condensed for numeric/stat displays unless a component intentionally differs.

## General Coding Rules
- Prefer bailout-first control flow (early returns) over deep nesting.
- Handle nullable values defensively due to loose strictness.
- Avoid `any` casts, especially around Firestore/external payloads.
- Use `BrowserCompatibilityService` for modern API checks before use.

## Event/Activity Firestore Writes
- Always sanitize event/activity Firestore payloads with shared helpers from `functions/src/shared/firestore-write-sanitizer.ts`.
- Never persist `streams` inside event/activity Firestore documents.
- Never persist top-level `activities` inside event Firestore documents.
- For patch updates (`updateDoc`) on events, sanitize patch objects before write.
