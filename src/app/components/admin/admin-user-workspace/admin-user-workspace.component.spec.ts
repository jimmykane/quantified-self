import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminUserWorkspaceComponent } from './admin-user-workspace.component';

describe('AdminUserWorkspaceComponent', () => {
    let component: AdminUserWorkspaceComponent;
    let queryParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
    let router: { navigate: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        queryParams = new BehaviorSubject(convertToParamMap({}));
        router = { navigate: vi.fn(() => Promise.resolve(true)) };
        await TestBed.configureTestingModule({
            imports: [AdminUserWorkspaceComponent],
            providers: [
                { provide: ActivatedRoute, useValue: { queryParamMap: queryParams } },
                { provide: Router, useValue: router },
            ],
        }).overrideComponent(AdminUserWorkspaceComponent, { set: { template: '' } }).compileComponents();
        component = TestBed.createComponent(AdminUserWorkspaceComponent).componentInstance;
        component.ngOnInit();
    });

    it('defaults missing and invalid tab parameters to Overview', () => {
        expect(component.selectedTabIndex()).toBe(0);
        queryParams.next(convertToParamMap({ tab: 'invalid' }));
        expect(component.selectedTabIndex()).toBe(0);
    });

    it('opens the Users tab from its deep link', () => {
        queryParams.next(convertToParamMap({ tab: 'users' }));
        expect(component.selectedTabIndex()).toBe(1);
    });

    it('updates the tab query parameter without adding browser history', () => {
        component.selectTab(1);
        expect(router.navigate).toHaveBeenCalledWith([], expect.objectContaining({
            queryParams: { tab: 'users' },
            queryParamsHandling: 'merge',
            replaceUrl: true,
        }));

        component.selectTab(0);
        expect(router.navigate).toHaveBeenLastCalledWith([], expect.objectContaining({
            queryParams: { tab: 'overview' },
        }));
    });
});
