import { Directive, TemplateRef, ViewContainerRef, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { AppUserService } from '../services/app.user.service';
import { Subscription } from 'rxjs';

@Directive({
    selector: '[appProOnly]',
    standalone: true
})
export class ProOnlyDirective implements OnInit {

    constructor(
        private templateRef: TemplateRef<any>,
        private viewContainer: ViewContainerRef,
        private userService: AppUserService,
        private cdr: ChangeDetectorRef
    ) { }

    async ngOnInit() {
        this.viewContainer.clear();
        try {
            const isPro = await this.userService.isPro();
            if (isPro) {
                this.viewContainer.createEmbeddedView(this.templateRef);
            } else {
                this.viewContainer.clear();
            }
            this.cdr.markForCheck();
        } catch (e) {
            console.error('Error in ProOnlyDirective', e);
            this.viewContainer.clear();
        }
    }
}
