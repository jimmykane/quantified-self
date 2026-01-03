export interface PolicyItem {
    id: string;
    title: string;
    subtitle?: string;
    icon: string;
    content: string[]; // List items or paragraphs
    checkboxLabel?: string;
    formControlName?: string;
    isGdpr?: boolean;
    isOptional?: boolean;
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
            '<strong>No Data Sales:</strong> We don\'t sell or send your data to any other 3rd party nor do we process your private data in any other way rather than allowing you to visualize them.',
            '<strong>Legal Basis:</strong> We process your data based on: (a) your consent for optional features like analytics, (b) contractual necessity to provide the service you subscribed to, and (c) our legitimate interest in maintaining service security.',
            '<strong>Third-Party Processors:</strong> Your data is processed by: Google Cloud (hosting, EU region), Stripe (payments), and the fitness service providers you connect (Garmin, Suunto, COROS, Polar) solely to sync your activity data.'
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
            '<ul><li><strong>Right of Access:</strong> You can request a copy of your personal data.</li><li><strong>Right to Rectification:</strong> You can correct inaccurate personal data in your profile settings.</li><li><strong>Right to Erasure:</strong> You can request deletion of your account and all associated data ("Right to be Forgotten").</li><li><strong>Right to Restrict Processing:</strong> You can ask us to limit how we use your data.</li><li><strong>Right to Data Portability:</strong> You can request your data in a structured, machine-readable format.</li><li><strong>Right to Object:</strong> You can object to data processing based on legitimate interests.</li><li><strong>Right to Withdraw Consent:</strong> You can withdraw consent at any time for optional processing (e.g., analytics).</li></ul>',
            '<p style="margin-top: 1em; font-size: 0.9em; opacity: 0.8;"><strong>Data Controller:</strong> Quantified Self<br><strong>Contact:</strong> privacy@quantified-self.io<br><strong>Data Location:</strong> European Union (Google Cloud EU region)<br>For privacy inquiries or to exercise your rights, contact us at the email above.</p>',
            '<p style="margin-top: 0.5em; font-size: 0.85em; opacity: 0.7;"><strong>Supervisory Authority:</strong> If you believe your data protection rights have been violated, you have the right to lodge a complaint with your local Data Protection Authority. For users in Greece, this is the Hellenic Data Protection Authority (HDPA) at <a href="https://www.dpa.gr" target="_blank" rel="noopener">www.dpa.gr</a>.</p>'
        ],
        isGdpr: true
    },
    {
        id: 'tracking',
        title: 'Cookies & Tracking',
        subtitle: 'Analytics',
        icon: 'track_changes',
        content: [
            '<strong>Google Analytics:</strong> With your consent, we use Google Analytics cookies to collect anonymized usage data (e.g., visits by country, active users). Analytics cookies are only activated after you provide consent.',
            '<strong>Purpose:</strong> This data helps us improve the service and is strictly for internal use. We do not use it for advertising or profiling.',
            '<strong>No 3rd Party Access:</strong> We don\'t allow Google or other 3rd parties to access this data for their own purposes.',
            '<strong>Essential Cookies:</strong> Session cookies used to keep you logged in are strictly necessary for the service to function and do not require consent.',
            '<strong>Withdraw Consent:</strong> You can withdraw your analytics consent at any time in your account settings.'
        ],
        checkboxLabel: 'I consent to the collection of anonymized usage data for analytics.',
        formControlName: 'acceptTrackingPolicy',
        isOptional: true
    },
    {
        id: 'tos',
        title: 'Terms of Service',
        subtitle: 'Subscription Policy',
        icon: 'gavel',
        content: [
            '<strong>Subscriptions & Auto-Renewal:</strong> Your subscription will automatically renew at the end of each billing cycle (monthly or yearly) until you cancel. You authorize us to charge your payment method for the renewal term.',
            '<strong>Cancellation:</strong> You may cancel your subscription at any time through your account settings. Cancellation will take effect at the end of the current billing period, and you will retain access to pro features until then.',
            '<strong>Refunds & EU Withdrawal Right:</strong> Under EU law, you have a 14-day right of withdrawal for digital services. However, by accepting these terms and gaining immediate access to premium features, you acknowledge that you waive this right of withdrawal. Partial refunds for unused periods are not provided.',
            '<strong>Changes to Pricing:</strong> We reserve the right to change our pricing. Any price changes will be communicated to you in advance and will take effect at the start of the next billing cycle.',
            '<strong>Data Deletion:</strong> Upon expiration or cancellation of a subscription, we may delete your stored data (including activities and tracks) after a grace period of 30 days of inactivity. It is your responsibility to export your data if you wish to keep it.'
        ],
        checkboxLabel: 'I accept the Terms of Service and Subscription Policy.',
        formControlName: 'acceptTos'
    }
];
