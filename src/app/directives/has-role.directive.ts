import { Directive, Input, TemplateRef, ViewContainerRef, OnInit, inject, effect } from '@angular/core';
import { AppUserService } from '../services/app.user.service';
import { LoggerService } from '../services/logger.service';

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
        private logger: LoggerService
    ) {
        effect(() => {
            try {
                const hasAccess = this.checkAccessSync();
                this.viewContainer.clear();
                if (hasAccess) {
                    this.viewContainer.createEmbeddedView(this.templateRef);
                }
            } catch (e) {
                this.logger.error('Error in HasRoleDirective', e);
                this.viewContainer.clear();
            }
        });
    }

    ngOnInit() {
        // Handled by effect
    }

    private checkAccessSync(): boolean {
        if (!this.requiredRole) {
            return false;
        }

        if (this.requiredRole === 'basic') {
            return this.userService.hasPaidAccessSignal();
        }

        if (this.requiredRole === 'pro') {
            return this.userService.isProSignal();
        }

        return false;
    }
}
