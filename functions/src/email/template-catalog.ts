import { buildEmailPlanDetails } from './config';

export const DEVELOPMENT_UPDATE_TEMPLATE_ID = 'development_update';

export interface EmailTemplatePreviewCase {
    name: string;
    data: Record<string, unknown>;
}

export interface EmailTemplateCatalogEntry {
    id: string;
    subject: string;
    htmlFile: string;
    textFile: string;
    partials: readonly string[];
    previewCases: readonly EmailTemplatePreviewCase[];
}

export interface EmailPartialCatalogEntry {
    id: string;
    htmlFile: string;
    textFile: string;
}

const FREE_PLAN = buildEmailPlanDetails('free');
const BASIC_PLAN = buildEmailPlanDetails('basic');
const PRO_PLAN = buildEmailPlanDetails('pro');

const FREE_AFTER_GRACE = {
    free_activity_description: FREE_PLAN.activity_description,
    free_route_description: FREE_PLAN.route_description,
    free_ai_insights_description: FREE_PLAN.ai_insights_description,
};

const TRANSACTIONAL_PARTIALS = ['email_transactional_header', 'email_transactional_footer'] as const;
const FOUNDER_PARTIALS = ['email_founder_header', 'email_founder_footer'] as const;

export const EMAIL_PARTIAL_CATALOG: readonly EmailPartialCatalogEntry[] = [
    {
        id: 'email_transactional_header',
        htmlFile: 'partials/email_transactional_header.hbs',
        textFile: 'partials/email_transactional_header.txt.hbs',
    },
    {
        id: 'email_transactional_footer',
        htmlFile: 'partials/email_transactional_footer.hbs',
        textFile: 'partials/email_transactional_footer.txt.hbs',
    },
    {
        id: 'email_founder_header',
        htmlFile: 'partials/email_founder_header.hbs',
        textFile: 'partials/email_founder_header.txt.hbs',
    },
    {
        id: 'email_founder_footer',
        htmlFile: 'partials/email_founder_footer.hbs',
        textFile: 'partials/email_founder_footer.txt.hbs',
    },
] as const;

export const REFRESHED_EMAIL_TEMPLATE_CATALOG: readonly EmailTemplateCatalogEntry[] = [
    {
        id: 'registration_welcome',
        subject: 'Welcome to Quantified Self — a note from Dimitrios',
        htmlFile: 'registration_welcome.hbs',
        textFile: 'registration_welcome.txt.hbs',
        partials: FOUNDER_PARTIALS,
        previewCases: [
            {
                name: 'named-user',
                data: { first_name: 'Ada', product_url: 'https://quantified-self.io' },
            },
            {
                name: 'no-display-name',
                data: { first_name: '', product_url: 'https://quantified-self.io' },
            },
        ],
    },
    {
        id: 'welcome_email',
        subject: 'Your {{role}} membership is active',
        htmlFile: 'welcome_email.hbs',
        textFile: 'welcome_email.txt.hbs',
        partials: TRANSACTIONAL_PARTIALS,
        previewCases: [
            {
                name: 'free',
                data: { role: 'Free', is_trial: false, ...FREE_PLAN, dashboard_url: 'https://quantified-self.io/dashboard' },
            },
            {
                name: 'basic-trial',
                data: { role: 'Basic', is_trial: true, ...BASIC_PLAN, dashboard_url: 'https://quantified-self.io/dashboard' },
            },
            {
                name: 'pro-paid',
                data: { role: 'Pro', is_trial: false, ...PRO_PLAN, dashboard_url: 'https://quantified-self.io/dashboard' },
            },
        ],
    },
    {
        id: 'subscription_upgrade',
        subject: 'You’re now on {{new_role}}',
        htmlFile: 'subscription_upgrade.hbs',
        textFile: 'subscription_upgrade.txt.hbs',
        partials: TRANSACTIONAL_PARTIALS,
        previewCases: [
            {
                name: 'basic-to-pro',
                data: { old_role: 'Basic', new_role: 'Pro', ...PRO_PLAN, dashboard_url: 'https://quantified-self.io/dashboard' },
            },
        ],
    },
    {
        id: 'subscription_downgrade',
        subject: 'Your membership is now {{new_role}}',
        htmlFile: 'subscription_downgrade.hbs',
        textFile: 'subscription_downgrade.txt.hbs',
        partials: TRANSACTIONAL_PARTIALS,
        previewCases: [
            {
                name: 'pro-to-basic',
                data: {
                    old_role: 'Pro',
                    new_role: 'Basic',
                    ...BASIC_PLAN,
                    device_sync_will_end: true,
                    membership_url: 'https://quantified-self.io/pricing',
                },
            },
            {
                name: 'basic-to-free',
                data: {
                    old_role: 'Basic',
                    new_role: 'Free',
                    ...FREE_PLAN,
                    device_sync_will_end: false,
                    membership_url: 'https://quantified-self.io/pricing',
                },
            },
            {
                name: 'unknown-role',
                data: {
                    old_role: 'Basic',
                    new_role: 'Legacy',
                    plan_details_available: false,
                    activity_description: '',
                    route_description: '',
                    ai_insights_description: '',
                    device_sync_description: '',
                    device_sync_will_end: false,
                    membership_url: 'https://quantified-self.io/pricing',
                },
            },
        ],
    },
    {
        id: 'subscription_cancellation',
        subject: 'Your {{role}} membership will end on {{expiration_date}}',
        htmlFile: 'subscription_cancellation.hbs',
        textFile: 'subscription_cancellation.txt.hbs',
        partials: TRANSACTIONAL_PARTIALS,
        previewCases: [
            {
                name: 'pro',
                data: {
                    role: 'Pro',
                    expiration_date: '15 January 2026',
                    grace_period_end: '14 February 2026',
                    ...FREE_AFTER_GRACE,
                    device_sync_will_end: true,
                    membership_url: 'https://quantified-self.io/pricing',
                },
            },
            {
                name: 'basic',
                data: {
                    role: 'Basic',
                    expiration_date: '15 January 2026',
                    grace_period_end: '14 February 2026',
                    ...FREE_AFTER_GRACE,
                    device_sync_will_end: false,
                    membership_url: 'https://quantified-self.io/pricing',
                },
            },
        ],
    },
    {
        id: 'subscription_expiring_soon',
        subject: 'Reminder: your {{role}} membership ends on {{expiration_date}}',
        htmlFile: 'subscription_expiring_soon.hbs',
        textFile: 'subscription_expiring_soon.txt.hbs',
        partials: TRANSACTIONAL_PARTIALS,
        previewCases: [
            {
                name: 'pro',
                data: {
                    role: 'Pro',
                    expiration_date: '15 January 2026',
                    grace_period_end: '14 February 2026',
                    ...FREE_AFTER_GRACE,
                    device_sync_will_end: true,
                    membership_url: 'https://quantified-self.io/pricing',
                },
            },
        ],
    },
    {
        id: 'account_deleted_confirmation',
        subject: 'Your Quantified Self account has been deleted',
        htmlFile: 'account_deleted_confirmation.hbs',
        textFile: 'account_deleted_confirmation.txt.hbs',
        partials: TRANSACTIONAL_PARTIALS,
        previewCases: [
            {
                name: 'deleted',
                data: { support_email: 'support@quantified-self.io' },
            },
        ],
    },
] as const;

export function selectRefreshedTemplates(requestedIds?: readonly string[]): readonly EmailTemplateCatalogEntry[] {
    if (!requestedIds || requestedIds.length === 0) {
        return REFRESHED_EMAIL_TEMPLATE_CATALOG;
    }

    const catalogById = new Map(REFRESHED_EMAIL_TEMPLATE_CATALOG.map(entry => [entry.id, entry]));
    const selected = requestedIds.map(id => {
        if (id === DEVELOPMENT_UPDATE_TEMPLATE_ID) {
            throw new Error(`${DEVELOPMENT_UPDATE_TEMPLATE_ID} is intentionally excluded from email lifecycle seeding.`);
        }
        const entry = catalogById.get(id);
        if (!entry) {
            throw new Error(`Unknown refreshed email template '${id}'.`);
        }
        return entry;
    });

    return selected;
}
