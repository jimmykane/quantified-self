import { QUANTIFIED_SELF_OPERATOR } from './company-contact';
import { POLICY_CONSENT_FORM_CONTROL_NAMES } from './policy-consent-fields';

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
    summary: 'Disclosures for connected fitness services, user-authorized MCP clients, the built-in Assistant, infrastructure, payments, and analytics.',
    content: [
        '<strong>What this section covers:</strong> This page explains what connected-service data Quantified Self collects, how it is used inside the product, what may be stored for exports, reprocessing, and sync tools, and which third parties process that data.',
        '<strong>Storage location:</strong> Imported provider data, saved route metadata, source-file references, and related processing metadata are stored in Quantified Self infrastructure on Google Cloud in the EU region.',
        '<strong>User-initiated sharing:</strong> When you use features such as history import, FIT/GPX uploads, sending routes, or activity sync to Suunto or Wahoo, Quantified Self must send the activity, route, or related data needed by the destination provider.',
        '<strong>AI scope:</strong> Connected-service data is not forwarded wholesale to AI providers. The built-in Assistant sends Gemini the message you submit, the browser\'s IANA timezone for local-day context, bounded recent conversation context, and bounded validated results selected through Quantified Self\'s read-only MCP tools. The Assistant is coordinate-free by default. If you explicitly start a fresh chat with Precise activity locations enabled, selected activity-tool results may also send Gemini exact activity start/end and MTB jump coordinates, bounded activity-chart breadcrumbs, plus nearby activity results during that chat. Changing this setting starts another fresh chat, and New chat returns it to off. Gemini may select only a server-advertised visual source and safe series keys; Quantified Self deterministically constructs any stored chart values, map coordinates, labels, and renderer settings from the validated result. Coordinate-free saved-route summaries may be selected for route questions; their route names can contain user- or provider-assigned place information. Direct in-app URLs are withheld from Gemini, and an answer that repeats an opaque reference or cursor is rejected. Saved-route bounds, route geometry, waypoints, write capabilities, dashboard settings, and original uploaded source files remain unavailable to the Assistant.',
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
                '<strong>Disconnect and retention:</strong> Disconnecting Wahoo revokes future provider access and stops new imports. Activities already imported into Quantified Self are retained until you delete those activities or delete your account. Account deletion removes Wahoo tokens, queue state, and imported account data under the normal deletion workflow.',
                '<strong>Shared with Wahoo:</strong> You can explicitly send a selected FIT activity file or GPX/FIT course/route file directly to Wahoo, turn on/send a date range for Garmin, COROS, or Suunto activities already stored in Quantified Self, or opt in to automatic/backfill delivery of Suunto routes already saved in Quantified Self. Quantified Self converts selected GPX routes to FIT in memory before sending them to Wahoo, and converts saved Suunto routes to FIT in memory for the same destination. Saved-route delivery uses an opaque stable key so an updated saved route updates the same Wahoo route. Direct Wahoo activity delivery does not create or retain a Quantified Self activity; direct course/route delivery does not create or retain a Quantified Self route.',
                '<strong>Shared with Suunto:</strong> You can turn on or backfill Wahoo-to-Suunto activity sync. Quantified Self sends the retained original FIT file from a Wahoo-imported event to Suunto only after you enable or start that route.',
                '<strong>Outbound boundaries:</strong> Wahoo-to-Suunto is the only Wahoo-origin provider-to-provider activity route. Suunto-to-Wahoo saved-route delivery is a separate opt-in route workflow in Suunto Services; direct GPX/FIT course/route delivery is a separate Wahoo-only upload. Plans, sleep, and other non-activity data are not sent between Wahoo and another provider. Existing Wahoo connections may need to be reconnected to grant workout and route access for delivery to Wahoo.',
            ],
        },
        {
            id: POLICIES_MCP_CLIENTS_FRAGMENT,
            title: 'MCP Client Access',
            icon: 'devices',
            summary: 'Read-only metric, body-measurement, activity-detail, sleep, saved-route, and separately approved location access granted to an MCP client by the account owner.',
            content: [
                '<strong>User-authorized access:</strong> An MCP client receives data only after you sign in to Quantified Self and approve one or more requested read-only permissions. Activity locations depend on activity details, and saved-route locations depend on saved-route summaries. Removing a parent permission also removes its location permission. The client cannot use MCP to write activities, routes, settings, Training state, body measurements, or sleep records.',
                '<strong>Metric permission:</strong> This access can return numeric metrics already stored for your activities and ready server-derived Training snapshots. When individual activity access is also granted, a client can request up to 25 explicitly selected canonical numeric Sports Lib metrics for one referenced activity or rank activities by one metric over an explicit bounded range or a processing-bounded all-history scan. Oversized rankings fail instead of returning a partial result. MTB jump superlatives reuse those stored maximum-jump metrics as the authoritative result; the separately authorized jump-detail projection remains optional, and jump count is not treated as jump quality. Quantified Self excludes precise latitude/longitude and first-class body-measurement metrics, and removes event/activity identifiers, names, labels, source fingerprints, and imported device/provider source keys from Training payloads.',
                '<strong>Body-measurement permission:</strong> This separate access can return bounded body-measurement history. Body-weight history is returned only as identity-free day, week, or month values for a range of at most 366 days; exact source measurement timestamps, event/activity identity, names, provider/device metadata, and source provenance are excluded.',
                '<strong>Activity-type catalog:</strong> Any authorized MCP client can discover canonical Sports Lib activity types for route and activity filters. This static catalog contains no account data. <strong>Activity-detail permission:</strong> Individual activity access can return non-location summaries, laps, swim lengths, MTB jump measurements, selected persisted numeric metrics, signed-in application links, and bounded chart-ready streams. It can filter bounded newest-first scans by those types and resolve today or yesterday only with an explicit IANA timezone. A chart request temporarily reads and selectively parses an existing original FIT, GPX, TCX, Suunto JSON/SML, or gzip file, downsamples the complete activity, discards parsed objects, and does not create a reparse, backfill, cache, or additional activity record. Historical charts depend on the original source remaining available and within processing limits.',
                '<strong>Activity-location permission:</strong> This dependent permission can add exact activity start/end and MTB jump coordinates, enable nearby-activity searches, and return a bounded breadcrumb trace with an activity chart. Without it, activity summaries and jump measurements remain available with coordinates omitted, and explicit location requests are rejected before location or source work begins. Exact activity locations can reveal a home, workplace, frequent trailhead, or other sensitive place.',
                '<strong>Sleep permission:</strong> Sleep access can return normalized session summaries, day/week/month aggregates, bounded discovery of recorded safe aggregate vital types, and a one-call sleep trend that combines coverage with duration, score, stages, HRV, heart-rate, blood-oxygen, and respiration values for a requested period. Raw samples remain excluded, and recorded values cannot diagnose illness. When Activity and Training metrics are also approved, the client can request the same live UTC-day Readiness used by Dashboard Today. That result combines current Form/ramp with the latest eligible sleep score and can return safe aggregate latest HRV and sleep-heart-rate values, same-provider baseline medians, ratios, evidence counts, and explicit missing or insufficient-baseline states. The requested IANA timezone supplies local-day context; it does not change the UTC scoring boundary. The preferred daily report returns the latest completed non-nap sleep with recorded average/overnight HRV and average/minimum sleep heart rate, a same-provider duration comparison, live Readiness, and current-versus-usual equivalent 28-day Training totals and Running/Cycling/Swimming mix. The older compact briefing remains physiology-free for compatibility. These projections exclude provider identity, provider user and session identifiers, provider-specific payloads, raw sleep-stage intervals, score components, raw HRV samples, SpO2 and respiration samples, locations, activities, body measurements, workout plans, and medical advice.',
                '<strong>Saved-route summary permission:</strong> Saved-route access can return route names, activity types, bounded metrics, route/waypoint/point counts, import/update times, and signed-in application links. It can filter a bounded newest-first scan by canonical Sports Lib activity type or a case-insensitive part of the route name. It omits exact bounds, preview geometry, and waypoint locations.',
                '<strong>Saved-route location permission:</strong> This dependent permission can add exact geographic bounds, simplified polyline preview geometry and segment endpoints, nearby-route search, and waypoint coordinates, altitude, and distance. Existing clients retain non-location route summaries but must reconnect and approve this permission to regain coordinate-bearing route tools. Activity and saved-route location permissions are independent.',
                '<strong>Projection exclusions:</strong> Original files, full-resolution recordings, absolute per-sample timestamps, unrequested streams, separate internal identifiers, source keys, Storage paths, parser extensions, provider/device provenance, waypoint names/comments, links, and delivery metadata are not returned.',
                '<strong>Place-name resolution:</strong> Nearby MCP searches can use direct latitude/longitude or a place name. Direct-coordinate searches are processed within Quantified Self. For a place-name search, Quantified Self sends only the location text to Mapbox for forward geocoding; activity data, route data, account identifiers, and unrelated client prompts are not sent to Mapbox for that lookup.',
                '<strong>Credentials and retention:</strong> MCP bearer and refresh credentials are opaque, stored server-side only as hashes, expire automatically, and are bound to your account and the MCP resource. Approving a request creates pending authorization metadata, but a new connection becomes active and appears in Connections only after the client successfully exchanges its authorization code. Reauthorizing the same exact verified client identity leaves its current grant usable until that exchange succeeds, then replaces the previous permissions and credentials rather than creating another logical connection. Failed or abandoned reauthorization does not replace the current grant, and authorization codes expire automatically. Authorization metadata and active connection metadata are retained so the connection can operate and be audited.',
                '<strong>Control and destination:</strong> Review or revoke MCP clients under Connections -> MCP. A client can use the standard server-to-server token-revocation endpoint, but it may not notify Quantified Self when removed or uninstalled. Disconnect in Connections remains the authoritative control and immediately invalidates the current grant and any older duplicate records for that exact verified client without affecting other MCP clients. Account deletion removes MCP connection and authorization state. A client may retain data it already received according to its own privacy and retention practices, so authorize only clients you trust.',
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
                '<strong>Mapbox:</strong> When an authorized MCP client searches by place name, Mapbox is used to resolve the supplied place text and geographic scope. Direct-coordinate MCP searches do not call Mapbox. The built-in Assistant can make the same bounded place-name lookup only after you explicitly enable Precise activity locations for that chat; Quantified Self sends Mapbox only the supplied location text, not the conversation, activity data, or account identity. Separately, when you open an Assistant map, it uses the map style saved specifically for Assistant maps and Mapbox receives the displayed geographic tile area needed to render that map, including when the underlying location came from a direct coordinate rather than place-name geocoding. Its saved-route access remains limited to coordinate-free summaries.',
                '<strong>Google GenAI / Gemini:</strong> The built-in Assistant uses Google\'s Gemini models through Google GenAI. Quantified Self sends the message you submit, the browser\'s IANA timezone for local-day context, at most the latest six completed conversation turns, and bounded validated results from the read-only tools chosen for the question. Results are coordinate-free by default. If you explicitly start a fresh chat with Precise activity locations enabled, selected activity-tool results may also send Gemini exact activity start/end and MTB jump coordinates, bounded activity-chart breadcrumbs, and nearby activity results during that chat. Changing the setting starts a fresh chat so coordinate-bearing history does not cross into a coordinate-free conversation; New chat returns the setting to off. Gemini may select only a server-advertised visual source and safe series keys; Quantified Self deterministically constructs any chart values, map coordinates, labels, and renderer settings from the validated result. Coordinate-free saved-route summaries may be selected for route questions, and their route names can contain user- or provider-assigned place information. Direct in-app URLs are withheld from Gemini, and an answer that repeats an opaque reference or cursor is rejected. Original FIT/GPX/TCX/JSON/SML files, saved-route bounds, route geometry, waypoints, write capabilities, and dashboard settings remain unavailable to the Assistant. Text, compact evidence, and any bounded chart or map payload share the same server-owned active conversation. It becomes unavailable about seven days after its latest completed turn or reset; a response already in progress can protect an imminent expiry for at most four extra minutes. Firestore TTL then deletes it asynchronously. New chat clears it immediately; account deletion removes it directly.',
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
            '<strong>No Data Sales:</strong> We do not sell your data. Data is sent outside Quantified Self only when needed for a feature you explicitly use or authorize, such as connected-provider delivery, an approved MCP client, or the bounded Assistant context described below.',
            '<strong>Legal Basis:</strong> We process your data based on: (a) your consent for optional features like analytics, (b) contractual necessity to provide the service you subscribed to, and (c) our legitimate interest in maintaining service security.',
            '<strong>Third-Party Processors and Recipients:</strong> Your data may be processed by Google Cloud (hosting and storage in the EU region), Stripe (payments), Google Analytics (only with consent), Mapbox (place resolution for authorized MCP place-name searches and explicitly enabled built-in Assistant activity-place searches), Google GenAI / Gemini (the built-in Assistant using the submitted message, browser timezone, bounded recent conversation context, validated read-only results, and—only in a chat where you enable it—precise activity locations), connected fitness services you explicitly use, and MCP clients you explicitly authorize. See <a href="#connected-services-data">Connected Services, AI &amp; Third-Party Processing</a> below for details.'
        ],
        checkboxLabel: 'I have read and agree to the Privacy Policy and acknowledge my data ownership rights.',
        formControlName: POLICY_CONSENT_FORM_CONTROL_NAMES.privacy
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
        formControlName: POLICY_CONSENT_FORM_CONTROL_NAMES.data
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
        formControlName: POLICY_CONSENT_FORM_CONTROL_NAMES.tracking,
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
        formControlName: POLICY_CONSENT_FORM_CONTROL_NAMES.terms
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
        formControlName: POLICY_CONSENT_FORM_CONTROL_NAMES.marketing,
        isOptional: true
    }
];
