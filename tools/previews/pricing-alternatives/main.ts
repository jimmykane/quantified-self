import { CommonModule } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { PublicPricingComponent, buildPublicPricingCatalog, type PublicPricingCatalog } from '../../../src/app/components/public-pricing/public-pricing.component';
import { type StripeProduct, AppPaymentService } from '../../../src/app/services/app.payment.service';
import { AppHapticsService } from '../../../src/app/services/app.haptics.service';
import { AppIconService } from '../../../src/app/services/app.icon.service';
import { LoggerService } from '../../../src/app/services/logger.service';
import { SharedModule } from '../../../src/app/modules/shared.module';

// Prices/trial copy verified on the signed-out public pricing page on 25 Oct 2026.
// IDs are fixtures. This independent preview cannot create a checkout session.
const PRODUCTS: StripeProduct[] = (['basic', 'pro'] as const).map(role => ({
  id: `preview_${role}`, active: true, role, name: role, description: role, images: [], metadata: { role },
  prices: (['month', 'year'] as const).map(interval => ({
    id: `preview_${role}_${interval}`, active: true, currency: 'eur', description: null,
    unit_amount: role === 'basic' ? (interval === 'month' ? 99 : 999) : (interval === 'month' ? 299 : 2999),
    type: 'recurring', interval, interval_count: 1, trial_period_days: null,
    recurring: { interval, interval_count: 1 }, metadata: { trial_days: '30' },
  })),
}));
type Plan = PublicPricingCatalog['plans'][number];
type Role = Plan['role'];

@Component({
  selector: 'app-pricing-alternatives', standalone: true,
  imports: [CommonModule, SharedModule, PublicPricingComponent, MatButtonModule,
    MatButtonToggleModule, MatCardModule, MatIconModule, MatToolbarModule],
  templateUrl: './preview.html', styleUrl: './preview.scss',
})
class PricingAlternativesComponent {
  private readonly haptics = inject(AppHapticsService);
  readonly design = new URLSearchParams(location.search).get('design') || '1';
  readonly billing = signal<'month' | 'year'>('month');
  readonly selectedRole = signal<Role>('pro');
  readonly expanded = signal(false);
  readonly notice = signal('');
  readonly catalog = buildPublicPricingCatalog(PRODUCTS);
  readonly plans = computed(() => this.catalog.plans.map(plan => ({
    ...plan,
    price: plan.prices.find(price => price.intervalLabel === this.billing()) || plan.prices[0],
    highlights: plan.role === 'pro'
      ? ['Automatic activity imports', 'Cross-device sync', 'Compatible workout delivery', 'Unlimited activities and routes']
      : plan.role === 'basic'
        ? plan.features.filter(feature => /activities|saved routes|Assistant up to/.test(feature.label)).map(feature => feature.label)
        : ['100 activities · 10 saved routes', 'Manual uploads and core analysis', '20 Assistant requests / month'],
  })));
  readonly proFirst = computed(() => ['pro', 'basic', 'free'].map(role => this.plans().find(plan => plan.role === role)!));
  readonly selected = computed(() => this.plans().find(plan => plan.role === this.selectedRole())!);
  readonly saving = this.catalog.plans.find(plan => plan.role === 'pro')!.prices.find(price => price.intervalLabel === 'year')!.yearlySavingsLabel?.replace('vs monthly', 'with yearly');
  readonly matrix = [
    { label: 'Activities', values: ['100', '1,000', 'Unlimited'] },
    { label: 'Saved routes', values: ['10', '100', 'Unlimited'] },
    { label: 'Assistant requests', values: ['20 / month', '50 / period', '100 / period'] },
    { label: 'Automatic imports', values: [false, false, true] },
    { label: 'Provider sync', values: [false, false, true] },
    { label: 'Workout delivery', values: [false, false, true] },
  ];

  constructor() {
    inject(AppIconService).registerIcons();
    inject(MatIconRegistry).setDefaultFontSetClass('material-symbols-rounded', 'mat-ligature-font');
  }

  changeBilling(value: 'month' | 'year'): void {
    if (value === this.billing()) return;
    this.billing.set(value); this.haptics.selection();
  }
  changePlan(role: Role): void {
    if (role === this.selectedRole()) return;
    this.selectedRole.set(role); this.notice.set(''); this.haptics.selection();
  }
  choose(plan: Plan): void {
    this.notice.set(`Preview only: ${plan.title} would continue through sign-in. No checkout has started.`);
    this.haptics.selection();
  }
  toggleDetails(): void { this.expanded.update(value => !value); this.haptics.selection(); }
}

if (new URLSearchParams(location.search).get('theme') !== 'light') document.body.classList.add('dark-theme');
bootstrapApplication(PricingAlternativesComponent, { providers: [provideHttpClient(), provideNoopAnimations(), provideRouter([]),
  { provide: AppHapticsService, useValue: { selection() {}, success() {}, error() {} } },
  { provide: AppPaymentService, useValue: { getProducts: () => of(PRODUCTS) } },
  { provide: LoggerService, useValue: { error() {}, log() {} } },
] }).then(() => document.body.classList.add('app-hydrated'))
  .catch(error => { console.error(error); document.body.textContent = 'Preview failed to render.'; });
