export const PUBLIC_PRICING_SHARED_FEATURES = [
  { icon: 'query_stats', title: 'Activity analysis', copy: 'Charts, zones, laps, and device comparisons.', path: '/features/workout-data-comparison' },
  { icon: 'dashboard_customize', title: 'Your dashboard', copy: 'Build your view with charts, KPIs, and calendar tiles.', path: '/features/training-dashboard' },
  { icon: 'monitor_heart', title: 'Training insights', copy: 'Load, readiness, and recovery from available data.', path: '/features/training-analysis' },
  { icon: 'bedtime', title: 'Health and sleep', copy: 'Explore recorded readings and your manual measurements.', path: '/features/health' },
  { icon: 'edit_calendar', title: 'Workout planning', copy: 'Plans, phases, structured workouts, and your library.', path: '/features/training-plans' },
  { icon: 'devices', title: 'Connect your tools', copy: 'Permission-scoped MCP access for compatible clients.', path: '/features/mcp-server' },
] as const;

export const PUBLIC_PRICING_FAQS = [
  { question: 'What can I do without paying?', answer: 'Upload your own activity and route files, analyze activities, compare devices, build your dashboard, create workouts and plans, and connect a compatible MCP client with the permissions you choose. Starter includes an Assistant allowance too.' },
  { question: 'What does Pro connect?', answer: 'Garmin, Suunto, COROS, and Wahoo activity workflows, supported history imports, and activity or route delivery. Compatible planned workouts can go to Garmin, Suunto, and Wahoo; COROS planned-workout delivery is coming soon. Provider permissions and compatibility still apply.' },
  { question: 'How do trials and yearly billing work?', answer: 'Trial length and annual savings come from the available plan prices. Trials apply to eligible new members; eligibility is checked after sign-in. Paid plans renew automatically until cancelled. You can change billing in the subscription area.' },
  { question: 'What happens if I cancel or downgrade?', answer: 'Cancellation takes effect at the end of your billing period. After the 30-day grace period, current limits apply and Pro imports and delivery stop. Existing activities and routes are retained. You can export your original activity files.' },
] as const;
