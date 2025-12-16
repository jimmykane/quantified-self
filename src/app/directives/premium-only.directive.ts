import { Directive, TemplateRef, ViewContainerRef, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { AppUserService } from '../services/app.user.service';
import { Subscription } from 'rxjs';

@Directive({
    selector: '[appPremiumOnly]',
    standalone: true
})
export class PremiumOnlyDirective implements OnInit {

    constructor(
        private templateRef: TemplateRef<any>,
        private viewContainer: ViewContainerRef,
        private userService: AppUserService,
        private cdr: ChangeDetectorRef
    ) { }

    async ngOnInit() {
        this.viewContainer.clear();
        try {
            const isPremium = await this.userService.isPremium();
            if (isPremium) {
                this.viewContainer.createEmbeddedView(this.templateRef);
            } else {
                this.viewContainer.clear();
            }
            this.cdr.markForCheck();
        } catch (e) {
            console.error('Error in PremiumOnlyDirective', e);
            this.viewContainer.clear();
        }
    }
}
