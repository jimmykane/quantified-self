import { Component, AfterViewInit, OnDestroy, OnInit, ElementRef, DestroyRef, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import {
  MAT_TOOLTIP_DEFAULT_OPTIONS,
  MatTooltipModule,
  type MatTooltipDefaultOptions,
} from '@angular/material/tooltip';
import { AppAuthService } from '../../authentication/app.auth.service';
import { CompactFeatureRowComponent } from '../shared/compact-feature-row/compact-feature-row.component';
import { PublicFeaturePreviewComponent } from '../public-seo/public-feature-preview.component';
import { ProviderDataFlowMatrixComponent } from '../shared/provider-data-flow-matrix/provider-data-flow-matrix.component';
import { buildPublicProviderDataFlowRows } from '../shared/provider-data-flow-matrix/provider-data-flow-matrix.helper';

const HOME_TOOLTIP_DEFAULT_OPTIONS: MatTooltipDefaultOptions = {
  showDelay: 0,
  hideDelay: 0,
  touchendHideDelay: 1500,
  touchGestures: 'off',
};

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
  standalone: true,
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    PublicFeaturePreviewComponent,
    CompactFeatureRowComponent,
    ProviderDataFlowMatrixComponent,
  ],
  providers: [
    { provide: MAT_TOOLTIP_DEFAULT_OPTIONS, useValue: HOME_TOOLTIP_DEFAULT_OPTIONS },
  ],
})
export class HomeComponent implements OnInit, AfterViewInit, OnDestroy {

  public readonly providerDataFlowRows = buildPublicProviderDataFlowRows();

  private observer: IntersectionObserver | undefined;
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  constructor(
    public authService: AppAuthService,
    public router: Router,
    private elementRef: ElementRef
  ) { }

  ngOnInit() {
    if (!this.isBrowser) {
      return;
    }

    this.authService.user$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(user => {
        if (user) {
          void this.router.navigate(['/dashboard']);
        }
      });
  }

  ngAfterViewInit() {
    if (!this.isBrowser) {
      return;
    }

    const elements = this.elementRef.nativeElement.querySelectorAll('.animate-on-scroll');
    if (typeof IntersectionObserver === 'undefined') {
      elements.forEach((el: Element) => el.classList.add('is-visible'));
      return;
    }

    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) {
          return;
        }

        entry.target.classList.add('is-visible');
        this.observer?.unobserve(entry.target);
      });
    }, {
      threshold: 0.1,
      rootMargin: '0px 0px -50px 0px'
    });

    elements.forEach((el: Element) => this.observer?.observe(el));
  }

  ngOnDestroy() {
    this.observer?.disconnect();
  }

}
