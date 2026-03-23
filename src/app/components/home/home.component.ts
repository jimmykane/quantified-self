import { Component, AfterViewInit, OnDestroy, ElementRef } from '@angular/core';
import { AppAuthService } from '../../authentication/app.auth.service';
import { Router } from '@angular/router';
import { ServiceNames } from '@sports-alliance/sports-lib';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
  standalone: false
})
export class HomeComponent implements AfterViewInit, OnDestroy {

  public serviceNames = ServiceNames;
  public currentYear = new Date().getFullYear();
  private observer: IntersectionObserver | undefined;
  public readonly aiPromptExamples: readonly string[] = [
    '"Show my total distance by activity type this year."',
    '"Compare average pace and heart rate for running in the last 90 days."',
    '"Find my longest cycling activity this month and summarize the key metrics."',
    '"Summarize my latest running activity with pace and heart rate context."',
    '"Show my average heart rate over time for running in the last 90 days."',
    '"Compare weekly training load and moving time over the last 12 weeks."',
    '"Show the activity where I had my highest average heart rate in the last 30 days."',
    '"What changed in my most recent workout compared to my recent baseline?"'
  ];

  constructor(
    public authService: AppAuthService,
    public router: Router,
    private elementRef: ElementRef
  ) { }

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
