import type { StripePrice, StripeProduct } from './app.payment.service';

/**
 * Turns the Stripe extension's product documents into the Basic/Pro catalog
 * used everywhere in the application. A single Stripe product can contain
 * prices for both memberships, distinguished by `metadata.firebaseRole`.
 */
export function transformProductsForPricing(products: StripeProduct[]): StripeProduct[] {
    const virtualProducts: StripeProduct[] = [];

    for (const product of products) {
        const paidRecurringPrices = (product.prices ?? []).filter(isPaidRecurringPrice);
        const getRole = (price: StripePrice) => price.metadata?.['firebaseRole']?.toLowerCase();
        const basicPrices = paidRecurringPrices.filter(price => getRole(price) === 'basic');
        const proPrices = paidRecurringPrices.filter(price => getRole(price) === 'pro');

        if (basicPrices.length > 0 || proPrices.length > 0) {
            if (basicPrices.length > 0) {
                virtualProducts.push({
                    ...product,
                    id: `${product.id}_basic`,
                    name: 'Basic',
                    description: 'Essential features for everyday users.',
                    role: 'basic',
                    metadata: { ...product.metadata, role: 'basic' },
                    prices: basicPrices,
                });
            }

            if (proPrices.length > 0) {
                virtualProducts.push({
                    ...product,
                    id: `${product.id}_pro`,
                    name: 'Pro',
                    description: 'Advanced tools for power users.',
                    role: 'pro',
                    metadata: { ...product.metadata, role: 'pro' },
                    prices: proPrices,
                });
            }
            continue;
        }

        const metadata = { ...product.metadata };
        if (!metadata['role'] && metadata['firebaseRole']) {
            metadata['role'] = metadata['firebaseRole'];
        }

        if (metadata['role'] !== 'free' && paidRecurringPrices.length > 0) {
            virtualProducts.push({ ...product, metadata, prices: paidRecurringPrices });
        }
    }

    const mergedRoleProducts = mergeRecurringProductsByRole(virtualProducts);
    const roleOrder: Record<string, number> = { basic: 1, pro: 2 };

    return mergedRoleProducts.sort((left, right) => {
        const leftRole = left.role || left.metadata?.['role'] || '';
        const rightRole = right.role || right.metadata?.['role'] || '';
        return (roleOrder[leftRole] || 99) - (roleOrder[rightRole] || 99);
    });
}

function mergeRecurringProductsByRole(products: StripeProduct[]): StripeProduct[] {
    const mergedByRole = new Map<'basic' | 'pro', StripeProduct>();
    const passthroughProducts: StripeProduct[] = [];

    for (const product of products) {
        const role = normalizePlanRole(product.role ?? product.metadata?.['role'] ?? null);
        if (!role) {
            passthroughProducts.push(product);
            continue;
        }

        const existing = mergedByRole.get(role);
        if (!existing) {
            mergedByRole.set(role, {
                ...product,
                role,
                metadata: { ...product.metadata, role },
                prices: sortRecurringPrices(product.prices ?? []),
            });
            continue;
        }

        existing.prices = sortRecurringPrices([
            ...(existing.prices ?? []),
            ...(product.prices ?? []),
        ]);
    }

    return [...mergedByRole.values(), ...passthroughProducts];
}

function normalizePlanRole(role: string | null | undefined): 'basic' | 'pro' | null {
    const normalized = role?.toLowerCase();
    return normalized === 'basic' || normalized === 'pro' ? normalized : null;
}

function sortRecurringPrices(prices: StripePrice[]): StripePrice[] {
    const seenPriceIds = new Set<string>();
    const intervalOrder: Record<string, number> = { month: 1, year: 2 };

    return prices
        .filter(price => {
            if (!price?.id || seenPriceIds.has(price.id)) {
                return false;
            }
            seenPriceIds.add(price.id);
            return true;
        })
        .sort((left, right) => {
            const leftInterval = left.recurring?.interval ?? left.interval ?? '';
            const rightInterval = right.recurring?.interval ?? right.interval ?? '';
            const intervalDelta = (intervalOrder[leftInterval] ?? 99) - (intervalOrder[rightInterval] ?? 99);
            if (intervalDelta !== 0) {
                return intervalDelta;
            }

            const leftCount = left.recurring?.interval_count ?? left.interval_count ?? 1;
            const rightCount = right.recurring?.interval_count ?? right.interval_count ?? 1;
            if (leftCount !== rightCount) {
                return leftCount - rightCount;
            }

            const leftAmount = typeof left.unit_amount === 'number' ? left.unit_amount : Number.MAX_SAFE_INTEGER;
            const rightAmount = typeof right.unit_amount === 'number' ? right.unit_amount : Number.MAX_SAFE_INTEGER;
            if (leftAmount !== rightAmount) {
                return leftAmount - rightAmount;
            }

            return left.id.localeCompare(right.id);
        });
}

function isPaidRecurringPrice(price: StripePrice): boolean {
    if (price.type !== 'recurring') {
        return false;
    }

    const interval = price.recurring?.interval ?? price.interval;
    return interval === 'month' || interval === 'year';
}
