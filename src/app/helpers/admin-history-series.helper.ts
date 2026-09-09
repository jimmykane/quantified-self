import type { AdminDashboardHistoryPoint, AuthActivityWindowKey } from '../services/admin.service';
import type { AdminHistoryPlanBasis } from './admin-history-percentage.helper';

export type HistoryChartKey = 'activity' | 'activePlans' | 'userMix' | 'onboarding' | 'cadence';
export interface AdminHistoryMetric {
    name: string;
    color: string;
    lineType: 'solid' | 'dashed' | 'dotted';
    symbol?: 'circle' | 'diamond' | 'rect' | 'triangle';
    id?: string;
    onlyWhenNonzero?: boolean;
    count: (point: AdminDashboardHistoryPoint) => number | undefined;
    denominator: (point: AdminDashboardHistoryPoint) => number | undefined;
    population: string;
}

const CHART_COLORS = {
    active24Hours: '#5470c6',
    active7Days: '#3ba272',
    active30Days: '#9a60b4',
    free: '#7f8c8d',
    basic: '#fac858',
    pro: '#ee6666',
    onboarding: '#73c0de',
    proMonthly: '#5470c6',
    proYearly: '#91cc75',
    basicMonthly: '#fac858',
    basicYearly: '#ee6666',
    proUnknown: '#9a60b4',
    basicUnknown: '#ea7ccc',
} as const;

export function adminHistoryMetrics(
    key: HistoryChartKey,
    window: AuthActivityWindowKey,
    basis: AdminHistoryPlanBasis,
): AdminHistoryMetric[] {
    if (key === 'activity') {
        return ([
            { name: 'Active 24h', window: 'last24Hours', color: CHART_COLORS.active24Hours, lineType: 'solid', symbol: 'circle' },
            { name: 'Active 7d', window: 'last7Days', color: CHART_COLORS.active7Days, lineType: 'dashed', symbol: 'diamond' },
            { name: 'Active 30d', window: 'last30Days', color: CHART_COLORS.active30Days, lineType: 'dotted', symbol: 'triangle' },
        ] as const).map(item => ({ ...item,
            count: point => point.authActivity[item.window],
            denominator: point => point.authActivity.eligibleAccounts,
            population: 'eligible accounts',
        }));
    }
    if (key === 'onboarding') {
        return [{ name: 'Onboarding complete', color: CHART_COLORS.onboarding, lineType: 'solid', symbol: 'rect',
            count: point => point.users.onboardingCompleted, denominator: point => point.users.total, population: 'total users' }];
    }
    const plans = [
        { plan: 'free', name: 'Free', lineType: 'dotted' },
        { plan: 'basic', name: 'Basic', lineType: 'dashed' },
        { plan: 'pro', name: 'Pro', lineType: 'solid' },
    ] as const;
    if (key === 'userMix' || key === 'activePlans') {
        return plans.map(({ plan, name, lineType }) => ({
            name, lineType, color: CHART_COLORS[plan], id: `${key === 'activePlans' ? 'active-plan' : 'user-plan'}-${plan}`,
            count: point => key === 'userMix' ? point.users[plan] : point.authActivity.byPlan?.[plan][window],
            denominator: point => key === 'userMix' ? point.users.total
                : basis === 'withinPlan' ? point.authActivity.eligibleByPlan?.[plan] : point.authActivity[window],
            population: key === 'userMix' ? 'total users'
                : basis === 'withinPlan' ? `eligible ${name} accounts` : 'active accounts',
        }));
    }
    return ([
        { plan: 'pro', cadence: 'monthly', name: 'Pro monthly', color: CHART_COLORS.proMonthly, lineType: 'solid' },
        { plan: 'pro', cadence: 'yearly', name: 'Pro yearly', color: CHART_COLORS.proYearly, lineType: 'dashed' },
        { plan: 'basic', cadence: 'monthly', name: 'Basic monthly', color: CHART_COLORS.basicMonthly, lineType: 'dotted' },
        { plan: 'basic', cadence: 'yearly', name: 'Basic yearly', color: CHART_COLORS.basicYearly, lineType: 'solid' },
        { plan: 'pro', cadence: 'unknown', name: 'Pro unknown', color: CHART_COLORS.proUnknown, lineType: 'dotted' },
        { plan: 'basic', cadence: 'unknown', name: 'Basic unknown', color: CHART_COLORS.basicUnknown, lineType: 'dashed' },
    ] as const).map(item => ({ ...item, onlyWhenNonzero: item.cadence === 'unknown',
        count: point => point.subscriptionCadence[item.plan][item.cadence],
        denominator: point => point.users[item.plan],
        population: `${item.plan === 'pro' ? 'Pro' : 'Basic'} users`,
    }));
}
