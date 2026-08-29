import type { SubscriptionHistoryTrendResponse, UserGrowthTrendResponse } from '../services/admin.service';
import { buildOfficialEChartsThemeTokens, ECHARTS_GLOBAL_FONT_FAMILY } from './echarts-theme.helper';

export interface AdminUserGrowthTotals {
    registeredUsers: number;
    onboardedUsers: number;
    basicSubscriptions: number;
    proSubscriptions: number;
}

export interface AdminUserGrowthPalette {
    primary: string;
    tertiary: string;
    secondary: string;
    warning: string;
    neutral: string;
    onboarded: string;
    combined: string;
}

export function buildAdminAuthProviderChartOption(
    providers: Record<string, number>,
    isDark: boolean,
    containerWidth: number,
): Record<string, unknown> {
    const providerLabels: Record<string, string> = {
        'google.com': 'Google',
        password: 'Email/Password',
        'apple.com': 'Apple',
        'facebook.com': 'Facebook',
    };
    const providerColors: Record<string, string> = {
        'google.com': '#4285F4',
        password: '#34A853',
        'apple.com': '#555555',
        'facebook.com': '#1877F2',
    };
    const entries = Object.entries(providers);
    const total = entries.reduce((sum, [, value]) => sum + normalizeNumber(value), 0);
    const topProvider = [...entries].sort((a, b) => b[1] - a[1])[0]?.[0];
    const themeTokens = buildOfficialEChartsThemeTokens(isDark);
    const isMobileLayout = containerWidth > 0 && containerWidth < 680;

    return {
        backgroundColor: 'transparent',
        tooltip: { show: true, trigger: 'item', formatter: '{b}: {c} ({d}%)' },
        legend: {
            show: true,
            orient: isMobileLayout ? 'horizontal' : 'vertical',
            left: isMobileLayout ? 'center' : undefined,
            right: isMobileLayout ? undefined : 10,
            top: isMobileLayout ? 'bottom' : 'center',
            textStyle: {
                color: themeTokens.textSecondary,
                fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
                fontSize: isMobileLayout ? 11 : 12,
            },
            itemGap: isMobileLayout ? 10 : 8,
        },
        series: [{
            name: 'Auth Provider Breakdown',
            type: 'pie',
            radius: isMobileLayout ? ['42%', '64%'] : ['55%', '72%'],
            center: isMobileLayout ? ['50%', '40%'] : ['38%', '50%'],
            avoidLabelOverlap: true,
            label: { show: false },
            labelLine: { show: false },
            itemStyle: { borderColor: themeTokens.subtleBorderColor, borderWidth: 2 },
            data: entries.map(([key, value]) => ({
                name: providerLabels[key] || key,
                value: normalizeNumber(value),
                itemStyle: { color: providerColors[key] || '#9E9E9E' },
            })),
        }],
        graphic: [{
            type: 'group',
            left: isMobileLayout ? '50%' : '38%',
            top: isMobileLayout ? '40%' : 'center',
            bounding: 'raw',
            children: [
                centeredText(`${total}`, isMobileLayout ? -10 : -12, isMobileLayout ? 20 : 24, 700, themeTokens.textSecondary),
                centeredText('accounts', 10, isMobileLayout ? 11 : 12, 400, themeTokens.textSecondary, 0.75),
                centeredText(topProvider ? providerLabels[topProvider] || topProvider : 'No data', 28, isMobileLayout ? 11 : 12, 500, themeTokens.textSecondary, 0.9),
            ],
        }],
    };
}

export function buildAdminUserGrowthChartOption(
    userGrowthTrend: UserGrowthTrendResponse | null,
    subscriptionHistoryTrend: SubscriptionHistoryTrendResponse | null,
    totals: AdminUserGrowthTotals,
    isDark: boolean,
    containerWidth: number,
    palette: AdminUserGrowthPalette,
): Record<string, unknown> {
    const userBuckets = userGrowthTrend?.buckets || [];
    const subscriptionBuckets = subscriptionHistoryTrend?.buckets || [];
    const monthKeys = [...new Set([
        ...userBuckets.map(bucket => bucket.key),
        ...subscriptionBuckets.map(bucket => bucket.key),
    ])].sort();
    const userBucketsByKey = new Map(userBuckets.map(bucket => [bucket.key, bucket]));
    const subscriptionBucketsByKey = new Map(subscriptionBuckets.map(bucket => [bucket.key, bucket]));
    const labels = monthKeys.map(key => userBucketsByKey.get(key)?.label || subscriptionBucketsByKey.get(key)?.label || key);
    const registeredPerMonth = monthKeys.map(key => normalizeNumber(userBucketsByKey.get(key)?.registeredUsers));
    const onboardedPerMonth = monthKeys.map(key => normalizeNumber(userBucketsByKey.get(key)?.onboardedUsers));
    const basicNetPerMonth = monthKeys.map(key => normalizeNumber(subscriptionBucketsByKey.get(key)?.basicNet));
    const proNetPerMonth = monthKeys.map(key => normalizeNumber(subscriptionBucketsByKey.get(key)?.proNet));
    const registeredTotals = buildCumulativeSeriesFromEndingTotal(registeredPerMonth, totals.registeredUsers);
    const onboardedTotals = buildCumulativeSeriesFromEndingTotal(onboardedPerMonth, totals.onboardedUsers);
    const basicTotals = buildCumulativeSeriesFromEndingTotal(basicNetPerMonth, totals.basicSubscriptions);
    const proTotals = buildCumulativeSeriesFromEndingTotal(proNetPerMonth, totals.proSubscriptions);
    const combinedTotals = basicTotals.map((value, index) => value + (proTotals[index] || 0));
    const hasUserGrowth = userBuckets.length > 0;
    const hasSubscriptions = subscriptionBuckets.length > 0;
    const isMobileLayout = containerWidth > 0 && containerWidth < 680;
    const themeTokens = buildOfficialEChartsThemeTokens(isDark);
    const series: Record<string, unknown>[] = [];

    if (hasUserGrowth) {
        series.push(
            barSeries('Registered Users / month', registeredPerMonth, palette.primary),
            barSeries('Onboarded Users / month', onboardedPerMonth, palette.tertiary),
            lineSeries('Total Registered', registeredTotals, palette.secondary),
            lineSeries('Total Onboarded', onboardedTotals, palette.onboarded),
        );
    }
    if (hasSubscriptions) {
        series.push(
            lineSeries('Basic Totals', basicTotals, palette.neutral),
            lineSeries('Pro Totals', proTotals, palette.warning),
            lineSeries('Totals (Pro+Basic)', combinedTotals, palette.combined),
        );
    }

    const summaryParts = [
        hasUserGrowth ? `Users ${normalizeNumber(totals.registeredUsers)} | Onboarded ${normalizeNumber(totals.onboardedUsers)}` : null,
        hasSubscriptions
            ? `Totals (Pro+Basic) ${normalizeNumber(totals.basicSubscriptions) + normalizeNumber(totals.proSubscriptions)} (Basic ${normalizeNumber(totals.basicSubscriptions)} | Pro ${normalizeNumber(totals.proSubscriptions)})`
            : null,
    ].filter((value): value is string => Boolean(value));

    return {
        backgroundColor: 'transparent',
        tooltip: {
            show: true,
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            textStyle: { fontFamily: ECHARTS_GLOBAL_FONT_FAMILY },
        },
        legend: {
            show: true,
            top: isMobileLayout ? 8 : 34,
            textStyle: {
                color: themeTokens.textSecondary,
                fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
                fontSize: isMobileLayout ? 11 : 12,
            },
        },
        grid: {
            left: 18,
            right: 18,
            top: isMobileLayout ? 56 : 86,
            bottom: isMobileLayout ? 56 : 32,
            outerBoundsMode: 'same',
            outerBoundsContain: 'axisLabel',
        },
        xAxis: {
            type: 'category',
            data: labels,
            axisLabel: {
                color: themeTokens.textSecondary,
                rotate: isMobileLayout ? 40 : 0,
                fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
                fontSize: isMobileLayout ? 10 : 11,
            },
            axisLine: { lineStyle: { color: themeTokens.axisLineColor } },
            axisTick: { alignWithLabel: true },
        },
        yAxis: {
            type: 'value',
            minInterval: 1,
            axisLabel: { color: themeTokens.textSecondary, fontFamily: ECHARTS_GLOBAL_FONT_FAMILY },
            splitLine: { lineStyle: { color: themeTokens.splitLineColor } },
        },
        series,
        graphic: isMobileLayout || summaryParts.length === 0 ? undefined : [{
            type: 'text',
            left: 'center',
            top: 2,
            z: 10,
            style: {
                text: `Current  ${summaryParts.join('  ||  ')}`,
                fill: themeTokens.textSecondary,
                opacity: 0.9,
                fontSize: 11,
                fontWeight: 500,
                fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
                textAlign: 'center',
            },
        }],
    };
}

export function buildCumulativeSeriesFromEndingTotal(netValues: number[], endingTotal: number): number[] {
    const safeEndingTotal = normalizeNumber(endingTotal);
    let runningTotal = safeEndingTotal - netValues.reduce((sum, value) => sum + normalizeSignedNumber(value), 0);
    return netValues.map(value => {
        runningTotal += normalizeSignedNumber(value);
        return Math.max(0, Math.round(runningTotal));
    });
}

function barSeries(name: string, data: number[], color: string): Record<string, unknown> {
    return {
        name,
        type: 'bar',
        data,
        barMaxWidth: 22,
        itemStyle: { color, borderRadius: [4, 4, 0, 0] },
        emphasis: { focus: 'series' },
    };
}

function lineSeries(name: string, data: number[], color: string): Record<string, unknown> {
    return {
        name,
        type: 'line',
        data,
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { color, width: 2.2 },
        itemStyle: { color },
        emphasis: { focus: 'series' },
    };
}

function centeredText(
    text: string,
    top: number,
    fontSize: number,
    fontWeight: number,
    fill: string,
    opacity = 1,
): Record<string, unknown> {
    return {
        type: 'text',
        style: {
            text,
            fontSize,
            fontWeight,
            fill,
            opacity,
            fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
            textAlign: 'center',
        },
        left: 'center',
        top,
    };
}

function normalizeNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function normalizeSignedNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
