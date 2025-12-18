import { Directive, Input, TemplateRef, ViewContainerRef, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { AppUserService } from '../services/app.user.service';
import { Subscription } from 'rxjs';

@Directive({
    selector: '[appHasRole]',
    standalone: true
})
export class HasRoleDirective implements OnInit {
    @Input('appHasRole') requiredRole: 'basic' | 'pro';

    constructor(
        private templateRef: TemplateRef<any>,
        private viewContainer: ViewContainerRef,
        private userService: AppUserService,
        private cdr: ChangeDetectorRef
    ) { }

    async ngOnInit() {
        this.viewContainer.clear();
        try {
            const hasAccess = await this.checkAccess();
            if (hasAccess) {
                this.viewContainer.createEmbeddedView(this.templateRef);
            } else {
                this.viewContainer.clear();
            }
            this.cdr.markForCheck();
        } catch (e) {
            console.error('Error in HasRoleDirective', e);
            this.viewContainer.clear();
        }
    }

    private async checkAccess(): Promise<boolean> {
        if (!this.requiredRole) {
            return false;
        }

        if (this.requiredRole === 'basic') {
            // Basic role requirement is satisfied by 'basic' OR 'pro'
            return this.userService.hasPaidAccess();
        }

        if (this.requiredRole === 'pro') {
            // Pro requirement is strict
            return this.userService.isPro();
        }

        return false;
    }

        return false;
    }
}
