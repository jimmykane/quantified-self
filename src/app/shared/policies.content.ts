import { QUANTIFIED_SELF_OPERATOR } from './company-contact';

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

export const POLICIES_CONNECTED_SERVICES_FRAGMENT = 'connected-services-data';
export const POLICIES_GARMIN_DATA_FRAGMENT = 'garmin-data';
export const POLICIES_SUUNTO_DATA_FRAGMENT = 'suunto-data';
export const POLICIES_COROS_DATA_FRAGMENT = 'coros-data';
export const POLICIES_WAHOO_DATA_FRAGMENT = 'wahoo-data';
export const POLICIES_MCP_CLIENTS_FRAGMENT = 'mcp-clients';
export const POLICIES_AI_AND_PROCESSORS_FRAGMENT = 'ai-and-third-party-processing';

export type PolicyFragmentId =
    | typeof POLICIES_CONNECTED_SERVICES_FRAGMENT
    | typeof POLICIES_GARMIN_DATA_FRAGMENT
    | typeof POLICIES_SUUNTO_DATA_FRAGMENT
    | typeof POLICIES_COROS_DATA_FRAGMENT
    | typeof POLICIES_WAHOO_DATA_FRAGMENT
    | typeof POLICIES_MCP_CLIENTS_FRAGMENT
    | typeof POLICIES_AI_AND_PROCESSORS_FRAGMENT;

export interface ConnectedServicesPolicyAnchor {
    id: PolicyFragmentId;
    label: string;
    icon: string;
}

export interface ConnectedServicesPolicyTopic {
    id: Exclude<PolicyFragmentId, typeof POLICIES_CONNECTED_SERVICES_FRAGMENT>;
    title: string;
    icon: string;
    summary: string;
    content: string[];
}

export interface ConnectedServicesPolicySection {
    id: typeof POLICIES_CONNECTED_SERVICES_FRAGMENT;
    title: string;
    summary: string;
    content: string[];
    navLinks: ConnectedServicesPolicyAnchor[];
    topics: ConnectedServicesPolicyTopic[];
}

export const CONNECTED_SERVICES_POLICY_SECTION: ConnectedServicesPolicySection = {
    id: POLICIES_CONNECTED_SERVICES_FRAGMENT,
    title: 'Connected Services, AI & Third-Party Processing',
    summary: 'Disclosures for connected fitness services, user-authorized MCP clients, AI Insights, infrastructure, payments, and analytics.',
    content: [
        '<strong>What this section covers:</strong> This page explains what connected-service data Quantified Self collects, how it is used inside the product, what may be stored for exports, reprocessing, and sync tools, and which third parties process that data.',
        '<strong>Storage location:</strong> Imported provider data, saved route metadata, source-file references, and related processing metadata are stored in Quantified Self infrastructure on Google Cloud in the EU region.',
        '<strong>User-initiated sharing:</strong> When you use features such as history import, FIT/GPX uploads, sending routes, or activity sync to Suunto or Wahoo, Quantified Self must send the activity, route, or related data needed by the destination provider.',
        '<strong>AI scope:</strong> Connected-service data is not forwarded wholesale to AI providers. AI Insights uses only the minimum derived stats needed to answer the prompt you submit, and does not send your raw activities, raw routes, or uploaded source files to the AI provider.',
    ],
    navLinks: [
        { id: POLICIES_CONNECTED_SERVICES_FRAGMENT, label: 'Overview', icon: 'hub' },
        { id: POLICIES_GARMIN_DATA_FRAGMENT, label: 'Garmin', icon: 'sync_alt' },
        { id: POLICIES_SUUNTO_DATA_FRAGMENT, label: 'Suunto', icon: 'published_with_changes' },
        { id: POLICIES_COROS_DATA_FRAGMENT, label: 'COROS', icon: 'sync' },
        { id: POLICIES_WAHOO_DATA_FRAGMENT, label: 'Wahoo', icon: 'directions_bike' },
        { id: POLICIES_MCP_CLIENTS_FRAGMENT, label: 'MCP Clients', icon: 'devices' },
        { id: POLICIES_AI_AND_PROCESSORS_FRAGMENT, label: 'AI & Processors', icon: 'shield' },
    ],
    topics: [
        {
            id: POLICIES_GARMIN_DATA_FRAGMENT,
            title: 'Garmin Data',
            icon: 'sync_alt',
            summary: 'Garmin activity, sleep, route delivery, and Garmin to Suunto sync workflows.',
            content: [
                '<strong>Collected from Garmin:</strong> When you connect Garmin, Quantified Self can import Garmin activities, request Garmin history imports, request Garmin sleep history, and receive Garmin health/sleep updates when Garmin permissions allow it.',
                '<strong>Stored and used in Quantified Self:</strong> Imported Garmin data is used to build your dashboard, event analysis, sleep views, and related summaries. When needed, Quantified Self may retain original activity files or equivalent source-file metadata for downloads, exports, reprocessing, and syncing past activities.',
                '<strong>Shared with Garmin:</strong> You can send a saved route or explicitly select a GPX/FIT route file in Garmin Services. Quantified Self parses the selected route and creates a Garmin Connect course. Direct selected-file delivery does not create or retain a Quantified Self route or Garmin delivery metadata.',
                '<strong>Shared with Suunto from Garmin:</strong> If you turn on automatic Garmin to Suunto activity sync or choose to sync past activities, Quantified Self uses the original activity file already saved with the Quantified Self event to send that activity to Suunto. That workflow therefore involves both Garmin-originated data and Suunto as a destination processor.',
            ],
        },
        {
            id: POLICIES_SUUNTO_DATA_FRAGMENT,
            title: 'Suunto Data',
            icon: 'published_with_changes',
            summary: 'Suunto activity, sleep, route import, FIT upload, and GPX/FIT route sending workflows.',
            content: [
                '<strong>Collected from Suunto:</strong> When you connect Suunto, Quantified Self can import Suunto activities and history, sync recent sleep data, import sleep history, and automatically import new or updated Suunto routes into your saved Routes list.',
                '<strong>Stored and used in Quantified Self:</strong> Imported Suunto data is used for event analysis, route detail views, dashboard summaries, sleep views, and saved route management. Connection metadata and processing metadata are also stored so reconnect, dedupe, and refresh workflows can work reliably.',
                '<strong>Shared back to Suunto:</strong> When you upload FIT activities or send a saved or selected GPX/FIT route to Suunto, Quantified Self sends the file or generated GPX route needed for that upload. Suunto receives GPX routes, so selected FIT routes and saved routes are converted to a compatible GPX route in memory; saved routes use the Quantified Self route name. Direct selected-file route delivery does not create or retain a Quantified Self route.',
                '<strong>Account-scope note:</strong> Routes imported from one Suunto account are blocked from being sent back to that same account, but can still be sent to a different connected Suunto account when that workflow is available to you.',
            ],
        },
        {
            id: POLICIES_COROS_DATA_FRAGMENT,
            title: 'COROS Data',
            icon: 'sync',
            summary: 'COROS activity, sleep-summary, FIT upload, and COROS to Suunto sync workflows.',
            content: [
                '<strong>Collected from COROS:</strong> When you connect COROS, Quantified Self can import recent COROS history, sync recent COROS sleep summaries, and import activities for event analysis and dashboard use.',
                '<strong>Stored and used in Quantified Self:</strong> Imported COROS activities and summaries are used for dashboard metrics, event analysis, and provider-specific history tooling. Quantified Self may retain original activity files or equivalent source-file metadata when later downloads, exports, reprocessing, or sync tools depend on them.',
                '<strong>Shared back to COROS:</strong> When you upload a FIT activity to COROS, Quantified Self sends the selected FIT file to COROS.',
                '<strong>Shared with Suunto from COROS:</strong> If you turn on automatic COROS to Suunto activity sync or choose to sync past activities, Quantified Self uses the original activity file already saved with the imported Quantified Self event to send that activity to Suunto. That workflow therefore involves both COROS-originated data and Suunto as a destination processor.',
            ],
        },
        {
            id: POLICIES_WAHOO_DATA_FRAGMENT,
            title: 'Wahoo Data',
            icon: 'directions_bike',
            summary: 'Wahoo OAuth, webhook, FIT activity and GPX/FIT course/route delivery, and history-import workflows.',
            content: [
                '<strong>Collected from Wahoo:</strong> When you connect Wahoo, Quantified Self can receive completed workout-summary webhooks and request Wahoo workout history. Only workouts with an available FIT file are imported, and records identified by Wahoo as originating from third-party fitness applications are skipped.',
                '<strong>Stored and used in Quantified Self:</strong> Imported Wahoo FIT activities, source identifiers, summary revision metadata, and original activity files are used for event analysis, dashboard metrics, exports, deduplication, and reprocessing. OAuth credentials are stored server-side and are not readable by the browser.',
                '<strong>Disconnect and retention:</strong> Disconnecting Wahoo revokes future provider access and stops new imports. Activities already imported into Quantified Self are retained until you delete those activities or delete your account. Account deletion removes Wahoo tokens, provider mappings, queue state, and imported account data under the normal deletion workflow.',
                '<strong>Shared with Wahoo:</strong> You can explicitly send a selected FIT activity file or GPX/FIT course/route file directly to Wahoo, turn on/send a date range for Garmin, COROS, or Suunto activities already stored in Quantified Self, or opt in to automatic/backfill delivery of Suunto routes already saved in Quantified Self. Quantified Self converts selected GPX routes to FIT in memory before sending them to Wahoo, and converts saved Suunto routes to FIT in memory for the same destination. Saved-route delivery uses an opaque stable key so an updated saved route updates the same Wahoo route. Direct Wahoo activity delivery does not create or retain a Quantified Self activity; direct course/route delivery does not create or retain a Quantified Self route.',
                '<strong>Shared with Suunto:</strong> You can turn on or backfill Wahoo-to-Suunto activity sync. Quantified Self sends the retained original FIT file from a Wahoo-imported event to Suunto only after you enable or start that route.',
                '<strong>Outbound boundaries:</strong> Wahoo-to-Suunto is the only Wahoo-origin provider-to-provider activity route. Suunto-to-Wahoo saved-route delivery is a separate opt-in route workflow in Suunto Services; direct GPX/FIT course/route delivery is a separate Wahoo-only upload. Plans, sleep, and other non-activity data are not sent between Wahoo and another provider. Existing Wahoo connections may need to be reconnected to grant workout and route access for delivery to Wahoo.',
            ],
        },
        {
            id: POLICIES_MCP_CLIENTS_FRAGMENT,
            title: 'MCP Client Access',
            icon: 'devices',
            summary: 'Read-only metric, body-measurement, activity-detail, sleep, and saved-route access granted to an MCP client by the account owner.',
            content: [
                '<strong>User-authorized access:</strong> An MCP client receives data only after you sign in to Quantified Self and approve one or more requested read-only permissions. Existing metric or sleep grants do not automatically gain body-measurement, activity-detail, or saved-route access. The client cannot use MCP to write activities, routes, settings, Training state, body measurements, or sleep records.',
                '<strong>Metric permission:</strong> This access can return numeric metrics already stored for your activities and ready server-derived Training snapshots. When individual activity access is also granted, a client can request up to 25 explicitly selected canonical numeric Sports Lib metrics for one referenced activity. Quantified Self excludes precise latitude/longitude and first-class body-measurement metrics, and removes event/activity identifiers, names, labels, source fingerprints, and imported device/provider source keys from Training payloads.',
                '<strong>Body-measurement permission:</strong> This separate access can return bounded body-measurement history. Body-weight history is returned only as identity-free day, week, or month values for a range of at most 366 days; exact source measurement timestamps, event/activity identity, names, provider/device metadata, and source provenance are excluded.',
                '<strong>Activity-detail permission:</strong> Individual activity access can return bounded activity summaries with exact start and end latitude/longitude coordinates when available, search for activities whose start or end is near a location, return laps, swim lengths, MTB jump measurements, and provide direct links containing stable account/event paths that still require your normal Quantified Self sign-in. Together with metric access, it also permits explicitly selected canonical numeric metrics for one activity. Jump records can also include their exact latitude and longitude. Exact activity and jump coordinates can reveal your home, workplace, frequent trailhead, or other sensitive locations. Raw streams, activity names and notes, separate internal identifier fields, original files, device/provider provenance, precise-position metrics, nonnumeric stats, and unrequested stored stats are excluded.',
                '<strong>Sleep permission:</strong> Sleep access can return normalized session summaries and day/week/month aggregates. It excludes provider user and session identifiers, provider-specific payloads, raw sleep-stage intervals, score components, and raw HRV, SpO2, and respiration samples.',
                '<strong>Saved-route permission:</strong> Saved-route access can return route names, bounded metrics and counts, exact geographic bounds, simplified polyline preview geometry with segment start/end coordinates, search for routes whose persisted preview passes near a location, return parsed waypoint coordinates, and provide direct links containing stable account/route paths that still require your normal Quantified Self sign-in. Original route files, raw route points and streams, waypoint names and comments, Storage paths, provider provenance, links, extensions, and delivery metadata are excluded.',
                '<strong>Place-name resolution:</strong> Nearby MCP searches can use direct latitude/longitude or a place name. Direct-coordinate searches are processed within Quantified Self. For a place-name search, Quantified Self sends only the location text to Mapbox for forward geocoding; activity data, route data, account identifiers, and unrelated client prompts are not sent to Mapbox for that lookup.',
                '<strong>Credentials and retention:</strong> MCP bearer and refresh credentials are opaque, stored server-side only as hashes, expire automatically, and are bound to your account and the MCP resource. Approving a request creates pending connection metadata, but the connection becomes active and appears in Connections only after the client successfully exchanges its authorization code. Abandoned pending approvals expire automatically. Authorization metadata and active connection metadata are retained so the connection can operate and be audited.',
                '<strong>Control and destination:</strong> Review or revoke MCP clients under Connections -> MCP. Revocation blocks future access and removes active credentials; account deletion removes MCP connection and authorization state. A client may retain data it already received according to its own privacy and retention practices, so authorize only clients you trust.',
            ],
        },
        {
            id: POLICIES_AI_AND_PROCESSORS_FRAGMENT,
            title: 'AI & Third-Party Processing',
            icon: 'shield',
            summary: 'Infrastructure, billing, analytics, maps, and the current AI provider.',
            content: [
                '<strong>Google Cloud:</strong> Quantified Self stores application data, connected-service metadata, and processing state on Google Cloud in the EU region.',
                '<strong>Stripe:</strong> Stripe processes subscription and billing data needed to charge, renew, and manage your plan.',
                '<strong>Google Analytics:</strong> If you consent to analytics cookies, Google Analytics receives anonymized usage analytics used to improve the service. Analytics is optional and can be withdrawn in Settings.',
                '<strong>Mapbox:</strong> When you use location-based AI Insights queries or authorize an MCP client that searches by place name, Mapbox is used to resolve the supplied place text and geographic scope. Direct-coordinate MCP searches do not call Mapbox.',
                '<strong>Google GenAI / Gemini:</strong> AI Insights currently uses Google\'s Gemini models through Google GenAI. Quantified Self sends only the minimum derived statistics needed to answer the prompt you explicitly submit. Raw activities, raw routes, uploaded FIT/GPX/TCX/JSON/SML files, and saved route source files are not sent to the AI provider.',
                '<strong>No hidden provider forwarding:</strong> Connected Garmin, Suunto, COROS, and Wahoo data is only sent to destination providers when you explicitly use the related import, upload, delivery, or sync feature. Wahoo delivery is limited to the explicit FIT activity, GPX/FIT course/route, opt-in Suunto saved-route, and Garmin/COROS/Suunto-to-Wahoo activity workflows described above.',
            ],
        },
    ],
};

export const POLICY_CONTENT: PolicyItem[] = [
    {
        id: 'privacy',
        title: 'Privacy Policy',
        subtitle: 'Data Security & Ownership',
        icon: 'lock_outline',
        content: [
            '<strong>Encryption:</strong> Your data are stored and held encrypted by Google (Google Cloud).',
            '<strong>Control:</strong> Profile and activity visibility is managed by platform policy and is not configurable in the app UI.',
            '<strong>Default Privacy:</strong> Visibility defaults to private and is only seen by your account unless platform policy changes.',
            '<strong>No Data Sales:</strong> We do not sell your data. Data is sent outside Quantified Self only when needed for a feature you explicitly use or authorize, such as connected-provider delivery, an approved MCP client, or the minimum derived AI Insights context described below.',
            '<strong>Legal Basis:</strong> We process your data based on: (a) your consent for optional features like analytics, (b) contractual necessity to provide the service you subscribed to, and (c) our legitimate interest in maintaining service security.',
            '<strong>Third-Party Processors and Recipients:</strong> Your data may be processed by Google Cloud (hosting and storage in the EU region), Stripe (payments), Google Analytics (only with consent), Mapbox (place resolution for location-based AI queries and MCP place-name searches), Google GenAI / Gemini (AI Insights using minimum derived stats only), connected fitness services you explicitly use, and MCP clients you explicitly authorize. See <a href="#connected-services-data">Connected Services, AI &amp; Third-Party Processing</a> below for details.'
        ],
        checkboxLabel: 'I have read and agree to the Privacy Policy and acknowledge my data ownership rights.',
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
            '<strong>Retention:</strong> We retain your data while your account is active and has a valid subscription. After a 30-day grace period, plan limits and feature restrictions apply. Existing activities are not automatically deleted due to downgrade alone.'
        ],
        checkboxLabel: 'I have read and agree to the Data Availability Policy.',
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
            `<p><strong>Data Controller:</strong> ${QUANTIFIED_SELF_OPERATOR.name}, operating ${QUANTIFIED_SELF_OPERATOR.brandName}<br><strong>Address:</strong> ${QUANTIFIED_SELF_OPERATOR.addressLines.join('<br>')}<br><strong>Contact:</strong> ${QUANTIFIED_SELF_OPERATOR.privacyEmail}<br><strong>Data Location:</strong> European Union (Google Cloud EU region)<br>For privacy inquiries or to exercise your rights, contact us at the email above.</p>`,
            '<p><strong>Supervisory Authority:</strong> If you believe your data protection rights have been violated, you have the right to lodge a complaint with your local Data Protection Authority. For users in Greece, this is the Hellenic Data Protection Authority (HDPA) at <a href="https://www.dpa.gr" target="_blank" rel="noopener">www.dpa.gr</a>.</p>'
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
        checkboxLabel: 'I have read and consent to the collection of anonymized usage data for analytics.',
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
            '<strong>Plan Changes After Cancellation:</strong> Upon expiration or cancellation of a subscription, your account moves to the applicable plan limits after any grace period. Stored activities are not automatically deleted due to plan expiration or cancellation. It is still your responsibility to keep your own backups of critical data.'
        ],
        checkboxLabel: 'I have read and agree to the Terms of Service and Subscription Policy.',
        formControlName: 'acceptTos'
    },
    {
        id: 'marketing',
        title: 'Marketing & Updates',
        subtitle: 'Optional',
        icon: 'mail_outline',
        content: [
            '<strong>Promotional Emails:</strong> Receive occasional emails about new features, promotions, and special offers.',
            '<strong>Unsubscribe Anytime:</strong> You can unsubscribe at any time from your account settings.',
            '<strong>No Spam:</strong> We respect your inbox and only send relevant updates about the service.'
        ],
        checkboxLabel: 'I have read and agree to receive marketing emails and updates.',
        formControlName: 'acceptMarketingPolicy',
        isOptional: true
    }
];
