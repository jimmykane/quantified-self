import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppPaymentService, StripeProduct } from '../../services/app.payment.service';
import { LoggerService } from '../../services/logger.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { ShellNavigationEffectsService } from '../../services/shell-navigation-effects.service';
import { PublicPricingComponent, buildPublicPricingCatalog } from './public-pricing.component';
import { PUBLIC_PRICING_SHARED_FEATURES } from './public-pricing.content';

const PAID_PRODUCTS: StripeProduct[] = [
    {
        id: 'membership_basic',
        active: true,
        name: 'Basic',
        description: 'Basic',
        role: 'basic',
        images: [],
        metadata: { role: 'basic' },
        prices: [
            {
                id: 'price_basic_monthly',
                active: true,
                currency: 'usd',
                unit_amount: 500,
                description: null,
                type: 'recurring',
                interval: 'month',
                interval_count: 1,
                trial_period_days: null,
                metadata: { trial_days: '30' },
                recurring: { interval: 'month', interval_count: 1 },
            },
            {
                id: 'price_basic_yearly',
                active: true,
                currency: 'usd',
                unit_amount: 4800,
                description: null,
                type: 'recurring',
                interval: 'year',
                interval_count: 1,
                trial_period_days: null,
                recurring: { interval: 'year', interval_count: 1 },
            },
        ],
    },
    {
        id: 'membership_pro',
        active: true,
        name: 'Pro',
        description: 'Pro',
        role: 'pro',
        images: [],
        metadata: { role: 'pro' },
        prices: [{
            id: 'price_pro_monthly',
            active: true,
            currency: 'eur',
            unit_amount: 1000,
            description: null,
            type: 'recurring',
            interval: 'month',
            interval_count: 1,
            trial_period_days: null,
            recurring: { interval: 'month', interval_count: 1 },
        }],
    },
];

describe('PublicPricingComponent', () => {
    let fixture: ComponentFixture<PublicPricingComponent>;
    let router: { navigate: ReturnType<typeof vi.fn> };
    let paymentService: { getProducts: ReturnType<typeof vi.fn> };
    let haptics: { selection: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        paymentService = { getProducts: vi.fn().mockReturnValue(of(PAID_PRODUCTS)) };
        haptics = { selection: vi.fn() };

        await TestBed.configureTestingModule({
            imports: [PublicPricingComponent],
            providers: [
                { provide: AppPaymentService, useValue: paymentService },
                provideRouter([]),
                { provide: AppHapticsService, useValue: haptics },
                {
                    provide: LoggerService,
                    useValue: {
                        error: vi.fn(),
                    },
                },
            ],
        }).compileComponents();

        router = { navigate: vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true) };
        fixture = TestBed.createComponent(PublicPricingComponent);
    });

    it('renders the signed-out catalog without membership or authentication providers', () => {
        fixture.detectChanges();

        const text = fixture.nativeElement.textContent as string;
        expect(text).toContain('Starter');
        expect(text).toContain('Basic');
        expect(text).toContain('Pro');
        expect(text).toContain('30-day free trial for eligible new members');
        expect(text).not.toContain('Verifying subscription');

        const planHeadings = Array.from(
            fixture.nativeElement.querySelectorAll('h2.plan-title') as NodeListOf<HTMLHeadingElement>,
        ).map((heading) => heading.textContent?.trim());
        const planBadge = fixture.nativeElement.querySelector('.plan-badge') as HTMLElement;
        expect(planHeadings).toEqual(['Starter', 'Basic', 'Pro']);
        expect(planBadge.textContent?.trim()).toBe('Recommended');
        expect(planBadge.parentElement?.classList.contains('product-card-shell')).toBe(true);
        expect(planBadge.closest('mat-card')).toBeNull();
    });

    it('keeps the loading state independent from membership verification', () => {
        const products$ = new Subject<StripeProduct[]>();
        paymentService.getProducts.mockReturnValue(products$);

        fixture.detectChanges();

        const text = fixture.nativeElement.textContent as string;
        const loadingState = fixture.debugElement.query(By.css('.loading-state'));
        expect(text).toContain('Loading plans...');
        expect(text).not.toContain('Verifying subscription');
        expect(loadingState.attributes['role']).toBe('status');
        expect(loadingState.attributes['aria-live']).toBe('polite');
    });

    it('routes every plan choice through login without bypassing onboarding', () => {
        fixture.detectChanges();
        const buttons = fixture.debugElement.queryAll(By.css('button[data-plan-role]'));

        expect(buttons).toHaveLength(4);
        expect(buttons.map((button) => button.attributes['aria-label'])).toEqual([
            'Starter: Start Free',
            'Basic: Choose Monthly',
            'Basic: Choose Yearly',
            'Pro: Choose Monthly',
        ]);
        for (const button of buttons) {
            button.triggerEventHandler('click');
        }

        expect(router.navigate).toHaveBeenCalledTimes(4);
        expect(router.navigate).toHaveBeenCalledWith(['/login'], {
            queryParams: { returnUrl: '/dashboard' },
        });
        // The shell owns feedback after a successful route change.
        expect(haptics.selection).not.toHaveBeenCalled();
    });

    it('preserves all catalog features and original controls with billing above the features', () => {
        fixture.detectChanges();
        const cards = fixture.nativeElement.querySelectorAll('mat-card') as NodeListOf<HTMLElement>;
        const catalog = buildPublicPricingCatalog(PAID_PRODUCTS);

        for (const [index, card] of Array.from(cards).entries()) {
            const plan = catalog.plans[index];
            const billing = card.querySelector('.plan-billing')!;
            const features = card.querySelector('.features-list')!;
            expect(billing.compareDocumentPosition(features) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            expect(Array.from(features.querySelectorAll('li')).map(row => row.textContent?.replace(/\s+/g, ' ').trim()))
                .toEqual(plan.features.map(feature => `${feature.icon} ${feature.label}`));
            expect(Array.from(billing.querySelectorAll('button')).map(button => button.textContent?.trim()))
                .toEqual(plan.prices.map(price => price.ctaLabel));
            for (const button of billing.querySelectorAll('button')) {
                expect(button.querySelector('.price')).toBeNull();
                if (plan.role !== 'free') {
                    expect(button.classList.contains('subscribe-btn')).toBe(true);
                    expect(button.classList.contains('qs-mat-primary')).toBe(true);
                }
            }
        }
        expect(haptics.selection).not.toHaveBeenCalled();
    });

    it('shows shared and paid feature explanations below the existing cards with feature and help links', () => {
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        const cards = root.querySelector('.products-grid')!;
        const details = root.querySelector('.plan-details')!;
        expect(cards.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(root.querySelectorAll('.plan-capabilities article')).toHaveLength(8);
        expect(root.textContent).toContain('My Tracks (Beta)');
        expect(root.textContent).toContain('custom chart watermark text');
        expect(root.querySelector('a[href="/features/training-plans"]')).not.toBeNull();
        expect(root.querySelector('a[href="/help#plans-and-billing"]')).not.toBeNull();
        expect(Array.from(root.querySelectorAll('.plan-capabilities a')).map(link => link.getAttribute('aria-label')))
            .toEqual(PUBLIC_PRICING_SHARED_FEATURES.map(feature => `Learn more about ${feature.title}`));
    });

    it('discloses provider compatibility with accessible FAQ toggles and one haptic per action', () => {
        fixture.detectChanges();
        const button = fixture.nativeElement.querySelectorAll('.plan-faq button')[1] as HTMLButtonElement;
        const answer = fixture.nativeElement.querySelector('#plan-answer-1') as HTMLElement;
        expect(answer.hidden).toBe(true);
        expect(button.getAttribute('aria-expanded')).toBe('false');

        button.click();
        fixture.detectChanges();
        expect(answer.hidden).toBe(false);
        expect(button.getAttribute('aria-controls')).toBe(answer.id);
        expect(button.getAttribute('aria-expanded')).toBe('true');
        expect(answer.textContent).toContain('COROS planned-workout delivery is coming soon');
        expect(haptics.selection).toHaveBeenCalledTimes(1);

        button.click();
        fixture.detectChanges();
        expect(answer.hidden).toBe(true);
        expect(button.getAttribute('aria-expanded')).toBe('false');
        expect(haptics.selection).toHaveBeenCalledTimes(2);
    });

    it('renders the selected plan-card presentation without design preview controls', () => {
        fixture.detectChanges();
        const pricingContainer = fixture.debugElement.query(By.css('.pricing-container'));

        expect(pricingContainer.attributes['data-style-variant']).toBeUndefined();
        expect(fixture.nativeElement.querySelector('.style-preview-controls')).toBeNull();
        expect(fixture.nativeElement.textContent).not.toContain('Design preview');
        expect(fixture.nativeElement.querySelectorAll('.product-card')).toHaveLength(3);
    });

    it('shows Starter and a recoverable notice when paid plans fail to load', () => {
        paymentService.getProducts.mockReturnValue(throwError(() => new Error('offline')));

        fixture.detectChanges();

        const text = fixture.nativeElement.textContent as string;
        expect(text).toContain('Starter');
        expect(text).toContain('Paid plans are temporarily unavailable');
        expect(text).not.toContain('Loading plans...');
    });

    it('replaces an indefinitely pending catalog with the Starter fallback after the timeout', async () => {
        vi.useFakeTimers();
        try {
            paymentService.getProducts.mockReturnValue(new Subject<StripeProduct[]>());
            fixture.detectChanges();

            expect(fixture.nativeElement.textContent).toContain('Loading plans...');

            await vi.advanceTimersByTimeAsync(10_000);
            fixture.detectChanges();

            const text = fixture.nativeElement.textContent as string;
            expect(text).toContain('Starter');
            expect(text).toContain('Paid plans are temporarily unavailable');
            expect(text).not.toContain('Loading plans...');
        } finally {
            vi.useRealTimers();
        }
    });
});

@Component({ standalone: true, template: '<p>Destination</p>' })
class PricingDestinationStub {}

describe('Public pricing navigation feedback', () => {
    let harness: RouterTestingHarness;
    let haptics: { selection: ReturnType<typeof vi.fn> };
    let navigationAllowed: boolean;

    const navigationActions = [
        ...['free_price', 'price_basic_monthly', 'price_basic_yearly', 'price_pro_monthly'].map(id => ({
            name: id,
            selector: `button[data-price-id="${id}"]`,
            destination: '/login?returnUrl=%2Fdashboard',
        })),
        ...PUBLIC_PRICING_SHARED_FEATURES.map(feature => ({
            name: feature.title,
            selector: `a[href="${feature.path}"]`,
            destination: feature.path,
        })),
        { name: 'membership guide', selector: 'a[href="/help#plans-and-billing"]', destination: '/help#plans-and-billing' },
    ];

    beforeEach(async () => {
        navigationAllowed = true;
        haptics = { selection: vi.fn() };
        vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
        await TestBed.configureTestingModule({ providers: [
            provideRouter([
                { path: 'pricing', component: PublicPricingComponent },
                ...['login', 'help', ...PUBLIC_PRICING_SHARED_FEATURES.map(feature => feature.path.slice(1))]
                    .map(path => ({ path, component: PricingDestinationStub, canActivate: [() => navigationAllowed] })),
            ]),
            { provide: AppPaymentService, useValue: { getProducts: vi.fn().mockReturnValue(of(PAID_PRODUCTS)) } },
            { provide: AppHapticsService, useValue: haptics },
            { provide: LoggerService, useValue: { error: vi.fn() } },
        ] }).compileComponents();

        TestBed.inject(ShellNavigationEffectsService);
        harness = await RouterTestingHarness.create('/pricing');
    });

    it.each(navigationActions)('emits one shell-owned haptic when $name navigation succeeds', async action => {
        expect(haptics.selection).not.toHaveBeenCalled();
        harness.routeNativeElement!.querySelector<HTMLElement>(action.selector)!.click();
        await harness.fixture.whenStable();

        expect(TestBed.inject(Router).url).toBe(action.destination);
        expect(haptics.selection).toHaveBeenCalledTimes(1);
    });

    it('does not emit feedback for a cancelled membership navigation', async () => {
        navigationAllowed = false;
        harness.routeNativeElement!.querySelector<HTMLButtonElement>('button[data-price-id="free_price"]')!.click();
        await harness.fixture.whenStable();

        expect(TestBed.inject(Router).url).toBe('/pricing');
        expect(haptics.selection).not.toHaveBeenCalled();
    });
});

describe('buildPublicPricingCatalog', () => {
    it('derives yearly savings and excludes inactive or malformed paid products and prices', () => {
        const catalog = buildPublicPricingCatalog([
            ...PAID_PRODUCTS,
            {
                id: 'invalid',
                active: true,
                name: 'Invalid',
                description: null,
                role: 'basic',
                images: [],
                metadata: { role: 'basic' },
                prices: [{
                    id: 'invalid_price',
                    active: true,
                    currency: 'usd',
                    unit_amount: null,
                    description: null,
                    type: 'recurring',
                    interval: 'month',
                    interval_count: 1,
                    trial_period_days: null,
                }],
            },
            {
                ...PAID_PRODUCTS[0],
                id: 'inactive',
                active: false,
            },
        ]);
        const basicPlan = catalog.plans.find((plan) => plan.id === 'membership_basic');
        const yearlyPrice = basicPlan?.prices.find((price) => price.id === 'price_basic_yearly');

        expect(catalog.plans.map((plan) => plan.role)).toEqual(['free', 'basic', 'pro']);
        expect(yearlyPrice?.yearlySavingsLabel).toBe('Save 20% vs monthly');
        expect(catalog.plans.find((plan) => plan.id === 'invalid')).toBeUndefined();
        expect(catalog.plans.find((plan) => plan.id === 'inactive')).toBeUndefined();
    });

    it('includes permission-scoped MCP access in every plan', () => {
        const catalog = buildPublicPricingCatalog(PAID_PRODUCTS);

        expect(catalog.plans).toHaveLength(3);
        for (const plan of catalog.plans) {
            expect(plan.features.map((feature) => feature.label)).toContain('MCP data access');
        }
    });

    it('includes manual training plans and standalone workouts in every plan', () => {
        const catalog = buildPublicPricingCatalog(PAID_PRODUCTS);

        for (const plan of catalog.plans) {
            expect(plan.features.map(feature => feature.label))
                .toContain('Manual training plans and standalone workouts');
        }
    });

    it('advertises provider planned-workout delivery only on Pro', () => {
        const catalog = buildPublicPricingCatalog(PAID_PRODUCTS);

        expect(catalog.plans.find(plan => plan.role === 'pro')?.features.map(feature => feature.label))
            .toContain('Provider planned-workout delivery');
        for (const role of ['free', 'basic'] as const) {
            expect(catalog.plans.find(plan => plan.role === role)?.features.map(feature => feature.label))
                .not.toContain('Provider planned-workout delivery');
        }
    });

    it('does not advertise a yearly switch across different currencies', () => {
        const basicProduct = PAID_PRODUCTS[0];
        const monthlyPrice = basicProduct.prices?.[0];
        const yearlyPrice = basicProduct.prices?.[1];
        expect(monthlyPrice).toBeTruthy();
        expect(yearlyPrice).toBeTruthy();

        const catalog = buildPublicPricingCatalog([{
            ...basicProduct,
            prices: [
                monthlyPrice!,
                {
                    ...yearlyPrice!,
                    currency: 'gbp',
                },
            ],
        }]);
        const basicPlan = catalog.plans.find((plan) => plan.role === 'basic');
        const monthlyView = basicPlan?.prices.find((price) => price.id === monthlyPrice?.id);
        const yearlyView = basicPlan?.prices.find((price) => price.id === yearlyPrice?.id);

        expect(monthlyView?.showYearlySwitchHint).toBe(false);
        expect(yearlyView?.yearlySavingsLabel).toBeNull();
    });

    it('falls back to metadata when the product-level role is stale', () => {
        const catalog = buildPublicPricingCatalog([{
            ...PAID_PRODUCTS[0],
            role: 'membership',
            metadata: { role: 'basic' },
        }]);

        expect(catalog.plans.map((plan) => plan.role)).toEqual(['free', 'basic']);
        expect(catalog.paidPlansUnavailable).toBe(false);
    });

    it('ignores malformed prices without hiding valid prices from the same plan', () => {
        const basicProduct = PAID_PRODUCTS[0];
        const validPrice = basicProduct.prices?.[0];
        expect(validPrice).toBeTruthy();

        const catalog = buildPublicPricingCatalog([{
            ...basicProduct,
            prices: [
                {
                    ...validPrice!,
                    id: 'price_invalid_currency',
                    currency: 'not-a-currency',
                },
                {
                    ...validPrice!,
                    id: 'price_non_finite',
                    unit_amount: Number.NaN,
                },
                {
                    ...validPrice!,
                    id: 'price_fractional_minor_units',
                    unit_amount: 499.5,
                },
                validPrice!,
            ],
        }]);
        const basicPlan = catalog.plans.find((plan) => plan.role === 'basic');

        expect(basicPlan?.prices.map((price) => price.id)).toEqual(['price_basic_monthly']);
        expect(catalog.paidPlansUnavailable).toBe(false);
    });
});
