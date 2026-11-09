/** The optional Field guide introduces existing workspaces, without granting consent or starting imports. */
export const FIELD_GUIDE_CHAPTERS = [
    {
        hero: 'Your activities, together.',
        title: 'Review all your activities in one place.',
        description: 'Bring your workouts into Quantified Self (QS) to explore each session and compare your progress over time.',
        points: [
            { icon: 'dashboard', title: 'Find your activities', description: 'Browse workouts across sports and sources in your Dashboard.' },
            { icon: 'route', title: 'Explore each workout', description: 'Open an activity to inspect its route, laps and performance charts.' },
            { icon: 'compare_arrows', title: 'Compare your efforts', description: 'Compare activities side by side using recorded pace, heart rate and power.' },
        ],
    },
    {
        hero: 'Understand your training. Plan ahead.',
        title: 'Track your training and plan your next week.',
        description: 'See how your training changes over time, explore recovery data and organize upcoming workouts.',
        points: [
            { icon: 'monitoring', title: 'Follow your training load', description: 'Use Training to track fitness, fatigue, form and weekly volume.' },
            { icon: 'bedtime', title: 'Explore your recovery', description: 'Review sleep and health trends when available from your sources.' },
            { icon: 'calendar_month', title: 'Plan your workouts', description: 'Create training plans and structured workouts in your calendar.' },
        ],
    },
    {
        hero: 'Start your way.',
        title: 'Get started with your first activity.',
        description: 'Connect a watch, upload an activity file or explore first. Finish account setup to open your workspace.',
        points: [
            { icon: 'watch', title: 'Connect your watch', description: 'With Pro, import activities from Garmin, Suunto, COROS or Wahoo.' },
            { icon: 'upload_file', title: 'Upload an activity file', description: 'Start free with FIT, GPX or TCX uploads from your Dashboard.' },
            { icon: 'explore', title: 'Take a look around', description: 'Explore QS with Starter and add your activities when you’re ready.' },
        ],
    },
] as const;
