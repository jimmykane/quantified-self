import { Directive, TemplateRef, ViewContainerRef, OnInit, inject, effect } from '@angular/core';
import { AppUserService } from '../services/app.user.service';
import { Subscription } from 'rxjs';
import { LoggerService } from '../services/logger.service';

@Directive({
    selector: '[appProOnly]',
    standalone: true
})
export class ProOnlyDirective implements OnInit {

    constructor(
        private templateRef: TemplateRef<any>,
        private viewContainer: ViewContainerRef,
        private userService: AppUserService,
        private logger: LoggerService
    ) {
        effect(() => {
            try {
                const isPro = this.userService.isProSignal();
                this.viewContainer.clear();
                if (isPro) {
                    this.viewContainer.createEmbeddedView(this.templateRef);
                }
            } catch (e) {
                this.logger.error('Error in ProOnlyDirective', e);
                this.viewContainer.clear();
            }
        });
    }

    ngOnInit() {
        // Handled by effect
    }
}
