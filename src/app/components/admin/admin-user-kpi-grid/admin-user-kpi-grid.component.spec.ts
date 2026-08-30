import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminUserKpiGridComponent } from './admin-user-kpi-grid.component';

describe('AdminUserKpiGridComponent', () => {
    let fixture: ComponentFixture<AdminUserKpiGridComponent>;
    let component: AdminUserKpiGridComponent;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [AdminUserKpiGridComponent, NoopAnimationsModule],
        }).compileComponents();
        fixture = TestBed.createComponent(AdminUserKpiGridComponent);
        component = fixture.componentInstance;
    });

    it('renders KPI values, unavailable values, and subtitles', () => {
        component.cards = [
            {
                id: 'active-24h',
                label: 'Active 24h',
                icon: 'schedule',
                value: 1234,
                valueKind: 'number',
                breakdown: [
                    { label: 'Free', value: 1000 },
                    { label: 'Basic', value: 200 },
                    { label: 'Pro', value: 34 },
                ],
            },
            { id: 'marketing-consent', label: 'Marketing Opt-ins', icon: 'mail', value: null, valueKind: 'number', subtitle: 'Unavailable' },
        ];
        fixture.detectChanges();

        const text = fixture.nativeElement.textContent;
        expect(text).toContain('Active 24h');
        expect(text).toContain('1,234');
        expect(text).toContain('Marketing Opt-ins');
        expect(text).toContain('Unavailable');
        const breakdown = (fixture.nativeElement as HTMLElement).querySelector('.kpi-breakdown');
        expect(breakdown?.getAttribute('aria-label')).toBe('Active users by plan');
        expect(breakdown?.textContent).toContain('Free');
        expect(breakdown?.textContent).toContain('1,000');
        expect(breakdown?.textContent).toContain('Basic');
        expect(breakdown?.textContent).toContain('Pro');
    });

    it('emits refresh actions only for the corresponding cards', () => {
        const eventSpy = vi.spyOn(component.refreshEventCount, 'emit');
        const routeSpy = vi.spyOn(component.refreshRouteCount, 'emit');
        component.showCountRefreshActions = true;
        component.cards = [
            { id: 'events', label: 'Events', icon: 'fitness_center', value: 10, valueKind: 'compact' },
            { id: 'routes', label: 'Routes', icon: 'route', value: 5, valueKind: 'compact' },
        ];
        fixture.detectChanges();

        const buttons = fixture.nativeElement.querySelectorAll('button');
        buttons[0].click();
        buttons[1].click();
        expect(eventSpy).toHaveBeenCalledOnce();
        expect(routeSpy).toHaveBeenCalledOnce();
    });

    it('shows initial loading and error states', () => {
        component.loading = true;
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Loading user KPIs');

        component.loading = false;
        component.error = 'User KPIs are unavailable.';
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('unavailable');
    });
});
