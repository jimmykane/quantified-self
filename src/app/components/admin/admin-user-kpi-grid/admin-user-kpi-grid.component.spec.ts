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
            { id: 'total-users', label: 'Total Users', icon: 'people', value: 1234, valueKind: 'number' },
            { id: 'marketing-consent', label: 'Marketing Opt-ins', icon: 'mail', value: null, valueKind: 'number', subtitle: 'Unavailable' },
        ];
        fixture.detectChanges();

        const text = fixture.nativeElement.textContent;
        expect(text).toContain('Total Users');
        expect(text).toContain('1,234');
        expect(text).toContain('Marketing Opt-ins');
        expect(text).toContain('Unavailable');
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
