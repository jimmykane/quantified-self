import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppPaymentService, StripeProduct } from '../../services/app.payment.service';
import { LoggerService } from '../../services/logger.service';
import { PublicPricingComponent, buildPublicPricingCatalog } from './public-pricing.component';

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

    beforeEach(async () => {
        router = { navigate: vi.fn().mockResolvedValue(true) };
        paymentService = { getProducts: vi.fn().mockReturnValue(of(PAID_PRODUCTS)) };

        await TestBed.configureTestingModule({
            imports: [PublicPricingComponent],
            providers: [
                { provide: AppPaymentService, useValue: paymentService },
                { provide: Router, useValue: router },
                {
                    provide: LoggerService,
                    useValue: {
                        error: vi.fn(),
                    },
                },
            ],
        }).compileComponents();

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
        expect(planHeadings).toEqual(['Starter', 'Basic', 'Pro']);
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

    it('routes every plan choice through login to the membership area', () => {
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
            queryParams: { returnUrl: '/subscriptions' },
        });
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
