import { Component, AfterViewInit, OnDestroy, OnInit, ElementRef, DestroyRef, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AppAuthService } from '../../authentication/app.auth.service';
import { Router } from '@angular/router';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { getAiInsightsHeroPrompts } from '@shared/ai-insights-prompts';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
  standalone: false
})
export class HomeComponent implements OnInit, AfterViewInit, OnDestroy {

  public serviceNames = ServiceNames;
  private observer: IntersectionObserver | undefined;
  public readonly aiPromptExamples: readonly string[] = getAiInsightsHeroPrompts();
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
    if (typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
          } else {
            // Remove class when out of view to reset animation
            entry.target.classList.remove('is-visible');
          }
        });
      }, {
        threshold: 0.1,
        // rootMargin: '0px 0px -50px 0px' 
        // Adjusting rootMargin might be needed if they "pop" out too quickly, 
        // but default intersection logic is safer for replay.
        rootMargin: '0px 0px -50px 0px'
      });

      const elements = this.elementRef.nativeElement.querySelectorAll('.animate-on-scroll');
      elements.forEach((el: Element) => this.observer?.observe(el));
    }

  }

  ngOnDestroy() {
    this.observer?.disconnect();
  }

  async navigateToDashboardOrLogin() {
    const user = await this.authService.getUser();
    if (user) {
      await this.router.navigate(['/dashboard']);
    } else {
      await this.router.navigate(['/login']);
    }
  }

}
