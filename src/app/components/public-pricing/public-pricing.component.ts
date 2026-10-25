import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router, RouterLink } from '@angular/router';
import { getAssistantRequestLimitForRole, getRouteUsageLimitForRole, getUsageLimitForRole } from '@shared/limits';
import { Observable, catchError, defer, map, of, shareReplay, timeout } from 'rxjs';
import { AppPaymentService, StripePrice, StripeProduct } from '../../services/app.payment.service';
import { LoggerService } from '../../services/logger.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { PUBLIC_PRICING_FAQS, PUBLIC_PRICING_SHARED_FEATURES } from './public-pricing.content';
import { membershipReturnUrl } from '../../helpers/membership-selection.helper';

type BillingPeriod = 'month' | 'year';

type PublicPlanRole = 'free' | 'basic' | 'pro';
type RecurringInterval = 'day' | 'week' | 'month' | 'year';

interface PublicPlanFeatureViewModel {
    icon: string;
    iconClass: string;
    label: string;
    highlight?: boolean;
}

interface PublicPlanPriceViewModel {
    id: string;
    amount: number;
    currency: string;
    digitsInfo: string;
    intervalLabel: string | null;
    ctaLabel: string;
    trialDays: number | null;
    yearlySavingsLabel: string | null;
    showYearlySwitchHint: boolean;
}

interface PublicPlanViewModel {
    id: string;
    role: PublicPlanRole;
    title: string;
    subtitle: string;
    features: PublicPlanFeatureViewModel[];
    prices: PublicPlanPriceViewModel[];
    highlights: PublicPlanFeatureViewModel[];
    billingChoices: Record<BillingPeriod, { prices: PublicPlanPriceViewModel[]; notice: string | null }>;
}

export interface PublicPricingCatalog {
    plans: PublicPlanViewModel[];
    paidPlansUnavailable: boolean;
    showBillingSelector: boolean;
}

interface RecurringCadence {
    interval: RecurringInterval;
    intervalCount: number;
}

const PUBLIC_PRODUCTS_TIMEOUT_MS = 10_000;

const PUBLIC_PLAN_COPY: Record<PublicPlanRole, { title: string; subtitle: string }> = {
    free: {
        title: 'Starter',
        subtitle: 'Core tools, free forever.',
    },
    basic: {
        title: 'Basic',
        subtitle: 'Everything in Starter, with more history and Assistant requests.',
    },
    pro: {
        title: 'Pro',
        subtitle: 'Everything in Basic, plus automatic imports, sync, and workout delivery.',
    },
};

@Component({
    selector: 'app-public-pricing',
    standalone: true,
    imports: [
        CommonModule,
        MatCardModule,
        MatButtonToggleModule,
        MatButtonModule,
        MatIconModule,
        MatProgressSpinnerModule,
        RouterLink,
    ],
    templateUrl: './public-pricing.component.html',
    styleUrls: ['./public-pricing.component.scss'],
})
export class PublicPricingComponent {
    private readonly paymentService = inject(AppPaymentService);
    private readonly logger = inject(LoggerService);
    private readonly router = inject(Router);
    private readonly haptics = inject(AppHapticsService);

    readonly sharedFeatures = PUBLIC_PRICING_SHARED_FEATURES;
    readonly faqs = PUBLIC_PRICING_FAQS;
    readonly openFaq = signal<number | null>(null);
    readonly billing = signal<BillingPeriod>('month');
    readonly expanded = signal(false);

    readonly catalog$: Observable<PublicPricingCatalog> = defer(() => this.paymentService.getProducts()).pipe(
        timeout({ first: PUBLIC_PRODUCTS_TIMEOUT_MS }),
        map((products) => buildPublicPricingCatalog(products)),
        catchError((error: unknown) => {
            this.logger.error('[PublicPricingComponent] Paid plans are unavailable.', error);
            return of(buildPublicPricingCatalog([]));
        }),
        shareReplay({ bufferSize: 1, refCount: true }),
    );

    continueToMembership(priceId?: string): void {
        void this.router.navigate(['/login'], {
            queryParams: { returnUrl: priceId ? membershipReturnUrl(priceId) : '/dashboard' },
        });
    }

    changeBilling(value: BillingPeriod): void {
        if ((value !== 'month' && value !== 'year') || value === this.billing()) {
            return;
        }
        this.billing.set(value);
        this.haptics.selection();
    }

    toggleDetails(): void {
        this.expanded.update(value => !value);
        this.haptics.selection();
    }

    toggleFaq(index: number): void {
        this.openFaq.update((current) => current === index ? null : index);
        this.haptics.selection();
    }
}

export function buildPublicPricingCatalog(products: StripeProduct[]): PublicPricingCatalog {
    const paidPlans = products
        .map((product) => buildPaidPlan(product))
        .filter((plan): plan is PublicPlanViewModel => plan !== null)
        .sort((left, right) => getRoleOrder(left.role) - getRoleOrder(right.role));

    return {
        plans: [...paidPlans, buildStarterPlan()],
        showBillingSelector: paidPlans.some(plan => plan.prices.some(price => price.intervalLabel === 'month'))
            && paidPlans.some(plan => plan.prices.some(price => price.intervalLabel === 'year')),
        paidPlansUnavailable: paidPlans.length === 0,
    };
}

function buildStarterPlan(): PublicPlanViewModel {
    return {
        id: 'free_tier',
        role: 'free',
        ...PUBLIC_PLAN_COPY.free,
        ...buildPlanDetails('free', [{
            id: 'free_price',
            amount: 0,
            currency: 'USD',
            digitsInfo: '1.0-0',
            intervalLabel: null,
            ctaLabel: 'Start Free',
            trialDays: null,
            yearlySavingsLabel: null,
            showYearlySwitchHint: false,
        }]),
    };
}

function buildPaidPlan(product: StripeProduct): PublicPlanViewModel | null {
    if (!product.active) {
        return null;
    }

    const role = normalizePaidRole(product.role)
        ?? normalizePaidRole(product.metadata?.['role']);
    if (!role) {
        return null;
    }

    const prices = (product.prices ?? [])
        .filter(isDisplayablePaidPrice)
        .map((price) => buildPaidPrice(product, price));
    if (prices.length === 0) {
        return null;
    }

    return {
        id: product.id,
        role,
        ...PUBLIC_PLAN_COPY[role],
        ...buildPlanDetails(role, prices),
    };
}

function buildPlanDetails(role: PublicPlanRole, prices: PublicPlanPriceViewModel[]): Pick<PublicPlanViewModel, 'features' | 'highlights' | 'prices' | 'billingChoices'> {
    const features = buildFeatures(role);
    const choice = (period: BillingPeriod) => {
        const otherPeriod = period === 'month' ? 'year' : 'month';
        const hasSelectedPeriod = prices.some(price => price.intervalLabel === period);
        // Keep nonstandard cadences and currency variants reachable. If a plan lacks
        // the preferred cadence, retain its actual prices with an explicit notice.
        return {
            prices: hasSelectedPeriod ? prices.filter(price => price.intervalLabel !== otherPeriod) : prices,
            notice: role !== 'free' && !hasSelectedPeriod
                ? `${period === 'month' ? 'Monthly' : 'Yearly'} billing is unavailable for this plan. Available billing shown below.`
                : null,
        };
    };
    return {
        prices,
        features,
        highlights: features.filter(feature => feature.highlight),
        billingChoices: { month: choice('month'), year: choice('year') },
    };
}

function buildPaidPrice(product: StripeProduct, price: StripePrice): PublicPlanPriceViewModel {
    const cadence = getRecurringCadence(price);
    const amountMinor = price.unit_amount ?? 0;
    const currency = normalizeCurrency(price.currency) ?? 'USD';

    return {
        id: price.id,
        amount: amountMinor / 100,
        currency,
        digitsInfo: amountMinor % 100 === 0 ? '1.0-0' : '1.2-2',
        intervalLabel: cadence ? getIntervalLabel(cadence) : null,
        ctaLabel: cadence ? getCtaLabel(cadence) : 'Choose Plan',
        trialDays: resolveMetadataTrialDays(price.metadata?.['trial_days']),
        yearlySavingsLabel: getYearlySavingsLabel(product, price),
        showYearlySwitchHint: cadence?.interval === 'month'
            && (product.prices ?? []).some((candidate) => isDisplayablePaidPrice(candidate)
                && getRecurringCadence(candidate)?.interval === 'year'
                && normalizeCurrency(candidate.currency) === currency),
    };
}

function isDisplayablePaidPrice(price: StripePrice): boolean {
    return price.active
        && price.type === 'recurring'
        && typeof price.unit_amount === 'number'
        && Number.isFinite(price.unit_amount)
        && Number.isInteger(price.unit_amount)
        && price.unit_amount > 0
        && normalizeCurrency(price.currency) !== null
        && getRecurringCadence(price) !== null;
}

function normalizeCurrency(currency: unknown): string | null {
    if (typeof currency !== 'string') {
        return null;
    }

    const normalizedCurrency = currency.trim().toUpperCase();
    return /^[A-Z]{3}$/.test(normalizedCurrency) ? normalizedCurrency : null;
}

function normalizePaidRole(role: string | null | undefined): 'basic' | 'pro' | null {
    const normalizedRole = role?.toLowerCase();
    return normalizedRole === 'basic' || normalizedRole === 'pro' ? normalizedRole : null;
}

function getRoleOrder(role: PublicPlanRole): number {
    return role === 'pro' ? 0 : role === 'basic' ? 1 : 2;
}

function buildFeatures(role: PublicPlanRole): PublicPlanFeatureViewModel[] {
    const standardIcon = role === 'pro' ? 'check_circle' : 'check';
    const standardIconClass = role === 'free' ? 'free-feature-icon' : role === 'basic' ? 'qs-color-accent' : 'qs-color-primary';
    const baseFeatures: PublicPlanFeatureViewModel[] = [
        {
            icon: standardIcon,
            iconClass: standardIconClass,
            label: getActivityLimitLabel(role),
            highlight: true,
        },
        {
            icon: standardIcon,
            iconClass: standardIconClass,
            label: getRouteLimitLabel(role),
            highlight: role === 'basic',
        },
        {
            icon: standardIcon,
            iconClass: standardIconClass,
            label: 'MCP data access',
        },
        {
            icon: standardIcon,
            iconClass: standardIconClass,
            label: 'Manual training plans and standalone workouts',
        },
    ];

    if (role === 'free') {
        return [
            ...baseFeatures,
            { icon: standardIcon, iconClass: standardIconClass, label: 'Manual uploads', highlight: true },
            { icon: standardIcon, iconClass: standardIconClass, label: 'Core analysis tools', highlight: true },
            { icon: standardIcon, iconClass: standardIconClass, label: getAssistantLimitLabel(role), highlight: false },
        ];
    }

    if (role === 'basic') {
        return [
            ...baseFeatures,
            { icon: standardIcon, iconClass: standardIconClass, label: 'Manual uploads', highlight: false },
            { icon: standardIcon, iconClass: standardIconClass, label: getAssistantLimitLabel(role), highlight: true },
            { icon: 'favorite', iconClass: 'qs-color-primary', label: 'Supports independent, privacy-first development' },
        ];
    }

    return [
        ...baseFeatures,
        { icon: standardIcon, iconClass: standardIconClass, label: 'Automatic activity imports from your watch', highlight: true },
        { icon: standardIcon, iconClass: standardIconClass, label: 'Provider planned-workout delivery', highlight: true },
        { icon: standardIcon, iconClass: standardIconClass, label: 'Cross-device sync', highlight: true },
        { icon: standardIcon, iconClass: standardIconClass, label: getAssistantLimitLabel(role), highlight: false },
        { icon: 'favorite', iconClass: 'qs-color-warn', label: 'Helps fund faster feature releases' },
    ];
}

function getActivityLimitLabel(role: PublicPlanRole): string {
    const limit = getUsageLimitForRole(role);
    return limit === null ? 'Unlimited activities' : `Up to ${limit} activities`;
}

function getRouteLimitLabel(role: PublicPlanRole): string {
    const limit = getRouteUsageLimitForRole(role);
    return limit === null ? 'Unlimited saved routes' : `Up to ${limit} saved routes`;
}

function getAssistantLimitLabel(role: PublicPlanRole): string {
    const limit = getAssistantRequestLimitForRole(role);
    if (limit <= 0) {
        return 'Assistant not included';
    }

    const period = role === 'free' ? 'calendar month' : 'billing period';
    return `Assistant up to ${limit} requests per ${period}`;
}

function getRecurringCadence(price: StripePrice): RecurringCadence | null {
    if (price.type !== 'recurring') {
        return null;
    }

    const interval = normalizeRecurringInterval(price.recurring?.interval ?? price.interval);
    const intervalCount = price.recurring?.interval_count ?? price.interval_count ?? 1;
    if (!interval || !Number.isInteger(intervalCount) || intervalCount <= 0) {
        return null;
    }

    return { interval, intervalCount };
}

function normalizeRecurringInterval(interval: string | null | undefined): RecurringInterval | null {
    return interval === 'day' || interval === 'week' || interval === 'month' || interval === 'year'
        ? interval
        : null;
}

function getIntervalLabel(cadence: RecurringCadence): string {
    if (cadence.intervalCount === 1) {
        return cadence.interval;
    }

    return `${cadence.intervalCount} ${getIntervalUnit(cadence.interval, cadence.intervalCount)}`;
}

function getCtaLabel(cadence: RecurringCadence): string {
    if (cadence.intervalCount === 1) {
        const intervalLabels: Record<RecurringInterval, string> = {
            day: 'Daily',
            week: 'Weekly',
            month: 'Monthly',
            year: 'Yearly',
        };
        return `Choose ${intervalLabels[cadence.interval]}`;
    }

    return `Choose Every ${cadence.intervalCount} ${capitalize(getIntervalUnit(cadence.interval, cadence.intervalCount))}`;
}

function getIntervalUnit(interval: RecurringInterval, intervalCount: number): string {
    return `${interval}${intervalCount === 1 ? '' : 's'}`;
}

function capitalize(value: string): string {
    return value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value;
}

function resolveMetadataTrialDays(metadataTrialDays: string | undefined): number | null {
    if (typeof metadataTrialDays !== 'string') {
        return null;
    }

    const normalizedTrialDays = metadataTrialDays.trim();
    return /^[1-9]\d*$/.test(normalizedTrialDays)
        ? Number.parseInt(normalizedTrialDays, 10)
        : null;
}

function getYearlySavingsLabel(product: StripeProduct, price: StripePrice): string | null {
    const yearlyCadence = getRecurringCadence(price);
    if (yearlyCadence?.interval !== 'year') {
        return null;
    }

    const yearlyAnnualizedAmount = getAnnualizedAmount(price);
    if (yearlyAnnualizedAmount === null) {
        return null;
    }

    const monthlyPrices = (product.prices ?? [])
        .filter((candidate) => candidate.id !== price.id
            && isDisplayablePaidPrice(candidate)
            && getRecurringCadence(candidate)?.interval === 'month')
        .filter((candidate) => normalizeCurrency(candidate.currency) === normalizeCurrency(price.currency));
    const monthlyPrice = monthlyPrices.find((candidate) => getRecurringCadence(candidate)?.intervalCount === 1)
        ?? monthlyPrices[0];
    const monthlyAnnualizedAmount = monthlyPrice ? getAnnualizedAmount(monthlyPrice) : null;
    if (monthlyAnnualizedAmount === null) {
        return null;
    }

    const savingsMinor = monthlyAnnualizedAmount - yearlyAnnualizedAmount;
    if (savingsMinor <= 0) {
        return null;
    }

    const savingsPercent = Math.round((savingsMinor / monthlyAnnualizedAmount) * 100);
    return savingsPercent > 0 ? `Save ${savingsPercent}% vs monthly` : null;
}

function getAnnualizedAmount(price: StripePrice): number | null {
    if (typeof price.unit_amount !== 'number'
        || !Number.isFinite(price.unit_amount)
        || !Number.isInteger(price.unit_amount)
        || price.unit_amount <= 0) {
        return null;
    }

    const cadence = getRecurringCadence(price);
    if (!cadence) {
        return null;
    }

    if (cadence.interval === 'month') {
        return price.unit_amount * (12 / cadence.intervalCount);
    }

    return cadence.interval === 'year'
        ? price.unit_amount / cadence.intervalCount
        : null;
}
