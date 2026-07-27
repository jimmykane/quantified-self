import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router } from '@angular/router';
import { getAiInsightsRequestLimitForRole, getRouteUsageLimitForRole, getUsageLimitForRole } from '@shared/limits';
import { Observable, catchError, defer, map, of, shareReplay, timeout } from 'rxjs';
import { AppPaymentService, StripePrice, StripeProduct } from '../../services/app.payment.service';
import { LoggerService } from '../../services/logger.service';

type PublicPlanRole = 'free' | 'basic' | 'pro';
type RecurringInterval = 'day' | 'week' | 'month' | 'year';

interface PublicPlanFeatureViewModel {
    icon: string;
    iconClass: string;
    label: string;
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
}

export interface PublicPricingCatalog {
    plans: PublicPlanViewModel[];
    paidPlansUnavailable: boolean;
}

interface RecurringCadence {
    interval: RecurringInterval;
    intervalCount: number;
}

const PUBLIC_PRODUCTS_TIMEOUT_MS = 10_000;

const PUBLIC_PLAN_COPY: Record<PublicPlanRole, { title: string; subtitle: string }> = {
    free: {
        title: 'Starter',
        subtitle: 'Everything you need to get started. Free forever.',
    },
    basic: {
        title: 'Basic',
        subtitle: 'For consistent training and deeper tracking.',
    },
    pro: {
        title: 'Pro',
        subtitle: 'Full automation and unlimited tracking.',
    },
};

@Component({
    selector: 'app-public-pricing',
    standalone: true,
    imports: [
        CommonModule,
        MatCardModule,
        MatButtonModule,
        MatIconModule,
        MatProgressSpinnerModule,
    ],
    templateUrl: './public-pricing.component.html',
    styleUrls: ['../pricing/pricing.component.scss', './public-pricing.component.scss'],
})
export class PublicPricingComponent {
    private readonly paymentService = inject(AppPaymentService);
    private readonly logger = inject(LoggerService);
    private readonly router = inject(Router);

    readonly catalog$: Observable<PublicPricingCatalog> = defer(() => this.paymentService.getProducts()).pipe(
        timeout({ first: PUBLIC_PRODUCTS_TIMEOUT_MS }),
        map((products) => buildPublicPricingCatalog(products)),
        catchError((error: unknown) => {
            this.logger.error('[PublicPricingComponent] Paid plans are unavailable.', error);
            return of(buildPublicPricingCatalog([]));
        }),
        shareReplay({ bufferSize: 1, refCount: true }),
    );

    continueToMembership(): void {
        void this.router.navigate(['/login'], {
            queryParams: { returnUrl: '/subscriptions' },
        });
    }
}

export function buildPublicPricingCatalog(products: StripeProduct[]): PublicPricingCatalog {
    const paidPlans = products
        .map((product) => buildPaidPlan(product))
        .filter((plan): plan is PublicPlanViewModel => plan !== null)
        .sort((left, right) => getRoleOrder(left.role) - getRoleOrder(right.role));

    return {
        plans: [buildStarterPlan(), ...paidPlans],
        paidPlansUnavailable: paidPlans.length === 0,
    };
}

function buildStarterPlan(): PublicPlanViewModel {
    return {
        id: 'free_tier',
        role: 'free',
        ...PUBLIC_PLAN_COPY.free,
        features: buildFeatures('free'),
        prices: [{
            id: 'free_price',
            amount: 0,
            currency: 'USD',
            digitsInfo: '1.0-0',
            intervalLabel: null,
            ctaLabel: 'Start Free',
            trialDays: null,
            yearlySavingsLabel: null,
            showYearlySwitchHint: false,
        }],
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
        features: buildFeatures(role),
        prices,
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
    return role === 'basic' ? 1 : role === 'pro' ? 2 : 0;
}

function buildFeatures(role: PublicPlanRole): PublicPlanFeatureViewModel[] {
    const standardIcon = role === 'pro' ? 'check_circle' : 'check';
    const standardIconClass = role === 'free' ? 'free-feature-icon' : role === 'basic' ? 'qs-color-accent' : 'qs-color-primary';
    const baseFeatures: PublicPlanFeatureViewModel[] = [
        {
            icon: standardIcon,
            iconClass: standardIconClass,
            label: getActivityLimitLabel(role),
        },
        {
            icon: standardIcon,
            iconClass: standardIconClass,
            label: getRouteLimitLabel(role),
        },
        {
            icon: standardIcon,
            iconClass: standardIconClass,
            label: 'Read-only MCP access',
        },
    ];

    if (role === 'free') {
        return [
            ...baseFeatures,
            { icon: standardIcon, iconClass: standardIconClass, label: 'Manual uploads' },
            { icon: standardIcon, iconClass: standardIconClass, label: 'Core analysis tools' },
            { icon: standardIcon, iconClass: standardIconClass, label: getAiInsightsLimitLabel(role) },
        ];
    }

    if (role === 'basic') {
        return [
            ...baseFeatures,
            { icon: standardIcon, iconClass: standardIconClass, label: 'Manual uploads' },
            { icon: standardIcon, iconClass: standardIconClass, label: getAiInsightsLimitLabel(role) },
            { icon: 'favorite', iconClass: 'qs-color-primary', label: 'Supports independent, privacy-first development' },
        ];
    }

    return [
        ...baseFeatures,
        { icon: standardIcon, iconClass: standardIconClass, label: 'Automatic activity imports from your watch' },
        { icon: standardIcon, iconClass: standardIconClass, label: 'Cross-device sync' },
        { icon: standardIcon, iconClass: standardIconClass, label: getAiInsightsLimitLabel(role) },
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

function getAiInsightsLimitLabel(role: PublicPlanRole): string {
    const limit = getAiInsightsRequestLimitForRole(role);
    if (limit <= 0) {
        return 'AI Insights not included';
    }

    const period = role === 'free' ? 'calendar month' : 'billing period';
    return `AI Insights up to ${limit} requests per ${period}`;
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
