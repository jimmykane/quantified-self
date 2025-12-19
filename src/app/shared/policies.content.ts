export interface PolicyItem {
    id: string;
    title: string;
    subtitle?: string;
    icon: string;
    content: string[]; // List items or paragraphs
    checkboxLabel?: string;
    formControlName?: string;
    isGdpr?: boolean;
}

export const POLICY_CONTENT: PolicyItem[] = [
    {
        id: 'privacy',
        title: 'Privacy Policy',
        subtitle: 'Data Security & Ownership',
        icon: 'lock_outline',
        content: [
            '<strong>Encryption:</strong> Your data are stored and held encrypted by Google (Google Cloud).',
            '<strong>Control:</strong> You choose what part of your data to make public or private (profile, individual data).',
            '<strong>Default Privacy:</strong> We provide all default privacy settings to private; only seen by you unless you choose otherwise.',
            '<strong>No Data Sales:</strong> We don\'t sell or send your data to any other 3rd party nor do we process your private data in any other way rather than allowing you to visualize them.'
        ],
        checkboxLabel: 'I accept the Privacy Policy and acknowledge my data ownership rights.',
        formControlName: 'acceptPrivacyPolicy'
    },
    {
        id: 'data',
        title: 'Data Availability',
        subtitle: 'Backups & Access',
        icon: 'data_usage',
        content: [
            '<strong>Best Effort:</strong> While we employ best endeavors, we don\'t promise to keep your files and data accessible at all times.',
            '<strong>Backups:</strong> It\'s best advised to keep your own private copies of critical data.',
            '<strong>Portability:</strong> You have the right to request an export of your personal data stored on our platform.',
            '<strong>Retention:</strong> We retain your data while your account is active and has a valid subscription. For expired subscriptions, data may be permanently removed after a grace period of 30 days of inactivity.'
        ],
        checkboxLabel: 'I acknowledge the Data Availability Policy.',
        formControlName: 'acceptDataPolicy'
    },
    {
        id: 'gdpr',
        title: 'GDPR & Your Rights',
        subtitle: 'For EU/EEA Users',
        icon: 'security',
        content: [
            'Under the General Data Protection Regulation (GDPR), you have the following rights:',
            '<ul><li><strong>Right of Access:</strong> You can request a copy of your personal data.</li><li><strong>Right to Rectification:</strong> You can correct inaccurate personal data in your profile settings.</li><li><strong>Right to Erasure:</strong> You can request deletion of your account and all associated data ("Right to be Forgotten").</li><li><strong>Right to Restrict Processing:</strong> You can ask us to limit how we use your data.</li><li><strong>Right to Object:</strong> You can object to data processing based on legitimate interests.</li></ul>',
            '<p style="margin-top: 1em; font-size: 0.9em; opacity: 0.8;"><strong>Data Controller:</strong> Quantified Self<br>For privacy inquiries or to exercise your rights, please contact us via support.</p>'
        ],
        isGdpr: true
    },
    {
        id: 'tracking',
        title: 'Cookies & Tracking',
        subtitle: 'Analytics',
        icon: 'track_changes',
        content: [
            '<strong>Google Analytics:</strong> We use Google Analytics cookies to collect anonymized usage data (e.g., visits by country, active users).',
            '<strong>Purpose:</strong> This data helps us improve the service and is strictly for internal use. We do not use it for advertising or profiling.',
            '<strong>No 3rd Party Access:</strong> We don\'t allow Google or other 3rd parties to access this data for their own purposes.',
            '<strong>Consent:</strong> By strictly technical necessity, session cookies are used to keep you logged in.'
        ],
        checkboxLabel: 'I consent to the collection of anonymized usage data for analytics.',
        formControlName: 'acceptTrackingPolicy'
    },
    {
        id: 'diagnostics',
        title: 'Diagnostics',
        subtitle: 'Error Reporting',
        icon: 'bug_report',
        content: [
            'To help improve service quality, your browser may automatically report anonymized error data (stack traces) when technical issues occur.'
        ],
        checkboxLabel: 'I consent to the automated reporting of anonymous diagnostic data.',
        formControlName: 'acceptDiagnosticsPolicy'
    },
    {
        id: 'tos',
        title: 'Terms of Service',
        subtitle: 'Subscription Policy',
        icon: 'gavel',
        content: [
            '<strong>Subscriptions & Auto-Renewal:</strong> Your subscription will automatically renew at the end of each billing cycle (monthly or yearly) until you cancel. You authorize us to charge your payment method for the renewal term.',
            '<strong>Cancellation:</strong> You may cancel your subscription at any time through your account settings. Cancellation will take effect at the end of the current billing period, and you will retain access to pro features until then.',
            '<strong>No Refunds:</strong> Payments are non-refundable, and there are no refunds or credits for partially used periods.',
            '<strong>Changes to Pricing:</strong> We reserve the right to change our pricing. Any price changes will be communicated to you in advance and will take effect at the start of the next billing cycle.',
            '<strong>Data Deletion:</strong> Upon expiration or cancellation of a subscription, we may delete your stored data (including activities and tracks) after a grace period of 30 days of inactivity. It is your responsibility to export your data if you wish to keep it.'
        ],
        checkboxLabel: 'I accept the Terms of Service and Subscription Policy.',
        formControlName: 'acceptTos'
    }
];
