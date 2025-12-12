---
trigger: model_decision
description: Use this rule when doing angular or typescript tasks
---

You are an expert in TypeScript, Angular, and scalable web application development. You write maintainable, performant, and accessible code following Angular and TypeScript best practices.

## TypeScript Best Practices

- Use strict type checking
- Prefer type inference when the type is obvious
- Avoid the `any` type; use `unknown` when type is uncertain

## Angular Best Practices

- Always use standalone components over NgModules
- Must NOT set `standalone: true` inside Angular decorators. It's the default.
- Use signals for state management
# EventRoute

This project is an Angular application for visualizing event routes.

## Development Server

Run `ng serve` for a dev server. Navigate to `http://localhost:4200/`. The application will automatically reload if you change any of the source files.
- Do NOT use the `@HostBinding` and `@HostListener` decorators. Put host bindings inside the `host` object of the `@Component` or `@Directive` decorator instead
- Use `NgOptimizedImage` for all static images.
  - `NgOptimizedImage` does not work for inline base64 images.

## Firebase & Firestore

This application uses Firebase for backend services:

- **Firebase Hosting**: Deployed at `https://raceevents.web.app`
- **Firestore Database**: NoSQL database for storing races and user data
- **Firebase Authentication**: Google Sign-In for admin users
- **Project ID**: `raceevents-71704`

### Firestore Collections

- `races`: Race event data (public read, admin-only write)
- `users`: User profiles with role-based access (admin/superadmin)

### Security Rules

- Only users with `role: 'admin'` can create/update/delete races
- Superadmin users (Firestore admins) have full access
- See `firestore.rules` for complete security configuration

### Firebase Configuration

Firebase is initialized in `src/app/app.config.ts` using Angular Fire:
- `provideFirebaseApp()` - Firebase app initialization
- `provideFirestore()` - Firestore database
- `provideAuth()` - Firebase Authentication (when implemented)

Configuration is stored in `src/environments/environment.ts`

## Components

- Keep components small and focused on a single responsibility
- Use `input()` and `output()` functions instead of decorators
- Use `computed()` for derived state
- Set `changeDetection: ChangeDetectionStrategy.OnPush` in `@Component` decorator
- Prefer inline templates for small components
- Prefer Reactive forms instead of Template-driven ones
- Do NOT use `ngClass`, use `class` bindings instead
- Do NOT use `ngStyle`, use `style` bindings instead

## State Management

- Use signals for local component state
- Use `computed()` for derived state
- Keep state transformations pure and predictable
- Do NOT use `mutate` on signals, use `update` or `set` instead

## Templates

- Keep templates simple and avoid complex logic
- Use native control flow (`@if`, `@for`, `@switch`) instead of `*ngIf`, `*ngFor`, `*ngSwitch`
- Use the async pipe to handle observables
- **ANTI-PATTERN**: Do NOT use `| async` on method calls in templates (e.g., `[href]="getUrl() | async"`).
  - This causes infinite loops and performance issues because the method returns a new Observable on every change detection.
  - **Solution**: Use signals or pre-calculated Observables instead.

## Services

- Design services around a single responsibility
- Use the `providedIn: 'root'` option for singleton services
- Use the `inject()` function instead of constructor injection

## UI / Styling

- **ALWAYS use Angular Material components** for UI elements - this is mandatory
- **NEVER use raw HTML elements** if a Material component exists (e.g., use `mat-button` instead of `<button>`, `mat-list-item` instead of `<li>`)
- Common Material components to use:
  - Buttons: `mat-button`, `mat-raised-button`, `mat-icon-button`, `mat-fab`
  - Lists: `mat-list`, `mat-list-item`, `mat-nav-list`
  - Forms: `mat-form-field`, `mat-input`, `mat-select`, `mat-checkbox`
  - Layout: `mat-toolbar`, `mat-sidenav`, `mat-card`
  - Feedback: `mat-progress-spinner`, `mat-snack-bar`, `mat-dialog`
- **Theme Support**: Always write CSS that supports both light and dark themes
  - Use CSS variables (custom properties) for colors instead of hardcoded values
  - Define theme-specific variables in the theme file (e.g., `--bg-primary`, `--text-primary`, `--accent-color`)
  - Provide fallback values for CSS variables: `var(--bg-primary, #0a0a0a)`
  - Avoid theme-specific logic in component styles; keep styles theme-agnostic
  - Test components in both light and dark modes
- **Responsive Layouts**:
  - Use `BreakpointObserver` for logic.
  - **Mobile Breakpoint**: `max-width: 768px`
  - **Container Width**: `max-width: 1200px`

## AI Agents

This project includes specialized AI agents for code review and quality assurance. These agents can be invoked via prompts to provide expert analysis check them one by one at `.ai/agents`

### Code Quality & Architecture
- **code-quality-analyzer**: Comprehensive code quality analysis including bug detection, performance optimization, and best practices compliance
- **tech-lead-architect**: Senior technical leadership perspective on architecture, system design, scalability, and technical debt assessment
- **code-refactoring-specialist**: Expert guidance on refactoring code for better maintainability and performance. Use this agent when I ask you to refactor something.
- **security-reviewer**: Security vulnerability assessment and secure coding practices. Use this agent when I ask you to check for security vulnerabilities.

### UI/UX & Design
- **ui-reviewer**: Visual design consistency, cohesion, and professional polish evaluation. Use this agent when I ask you about user interface tasks. 
- **ux-reviewer**: User experience analysis, usability assessment, and interaction design review. Use this agent when I ask you about user interface tasks. 
- **mobile-first-expert**: Mobile-first design and responsive implementation guidance. Use this agent when I ask you about user interface tasks. 
- **angular-material-expert**: Expert guidance on using Angular Material components, theming, and best practices. Use this agent when I ask you about user interface tasks. 

### Testing & Review
- **test-automation-engineer**: Test strategy, coverage analysis, and automated testing implementation
- **code-review-expert**: Thorough code review with focus on maintainability and team standards
- **technical-researcher**: Research and evaluation of technologies, libraries, and implementation approaches

**Usage**: Mention the agent name in your prompt when you need specialized analysis (e.g., "Use the ui-reviewer to check the new dashboard design" or "Have the security-reviewer analyze the authentication flow")

## Context7 Usage

- **Angular Core**: Use `context7` to look up documentation for Angular v20 features, especially Signals, Control Flow, and Standalone Components.
- **Firebase**: Use `context7` for Firebase v11 SDK documentation (Firestore, Auth, Storage).
- **Mapbox**: Use `context7` to find documentation for Mapbox GL JS v3 and `@types/mapbox-gl`.
- **PrimeNG**: Use `context7` for PrimeNG v17+ component documentation if used.
- **Library Resolution**: Always use `mcp_resolve-library-id` first to find the correct library ID (e.g., "mapbox-gl", "firebase", "angular").

## General Coding Rules

- **Official First**:
    - **ALWAYS** check official documentation (Angular, Material, TypeScript) for built-in solutions before designing custom ones.
    - If a documented pattern exists, prefer it over custom implementations.
