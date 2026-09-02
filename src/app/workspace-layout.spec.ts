import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

const workspaceRoots = [
  ['Dashboard', 'src/app/components/dashboard/dashboard.component.html', 'component-container qs-workspace-page'],
  ['Event details', 'src/app/components/event/event.card.component.html', 'event-dashboard-container qs-workspace-page'],
  ['Calendar', 'src/app/components/calendar/calendar-page/calendar-page.component.html', 'calendar-page qs-workspace-page'],
  ['Plans', 'src/app/components/plans/plans-workspace.component.html', 'plans-workspace qs-workspace-page'],
  ['Training', 'src/app/components/training/training-workspace.component.html', 'training-workspace qs-workspace-page'],
  ['Routes', 'src/app/components/routes/routes-page.component.html', 'routes-page qs-workspace-page'],
  ['Route detail', 'src/app/components/routes/route-detail/route-detail.component.html', 'route-detail-page qs-workspace-page'],
  ['Compare files', 'src/app/components/tools/tools-compare-page.component.html', 'tools-compare-page qs-workspace-page'],
] as const;

describe('workspace layout', () => {
  it('defines a common 1440px, border-box route shell', () => {
    const styles = readFileSync(resolve(root, 'src/styles.scss'), 'utf8');

    expect(styles).toMatch(/\.qs-workspace-page\s*\{[\s\S]*?box-sizing: border-box;[\s\S]*?width: 100%;[\s\S]*?max-width: var\(--qs-workspace-max-width\);[\s\S]*?padding: 24px var\(--qs-workspace-inline-padding\) 48px;/);
    expect(styles).toContain('--qs-workspace-max-width: 1440px;');
    expect(styles).toContain('--qs-workspace-inline-padding: clamp(16px, 3vw, 40px);');
  });

  it.each(workspaceRoots)('uses the shared shell for %s', (_name, file, className) => {
    const template = readFileSync(resolve(root, file), 'utf8');

    expect(template).toContain(`class="${className}"`);
  });
});
