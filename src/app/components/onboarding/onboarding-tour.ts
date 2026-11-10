/** The optional Field guide introduces existing workspaces, without granting consent or starting imports. */
export const FIELD_GUIDE_CHAPTERS = [
    {
        hero: 'Your activities, together.',
        title: 'See more in every workout.',
        description: 'Bring your activities together to explore each session and compare recordings from your devices.',
        points: [
            { icon: 'dashboard', title: 'Find your activities', description: 'Browse workouts from different sports and devices in your Dashboard.' },
            { icon: 'route', title: 'Explore each workout', description: 'Open an activity to inspect its route, laps and performance charts.' },
            { icon: 'compare_arrows', title: 'Compare recordings', description: 'Compare GPS tracks and measurements from devices used in the same workout.' },
        ],
    },
    {
        hero: 'Your training, in context.',
        title: 'See how your training adds up.',
        description: 'Follow your training load, review recovery trends and plan your next week.',
        points: [
            { icon: 'monitoring', title: 'Follow your training load', description: 'Use Training to track fitness, fatigue, form and weekly volume.' },
            { icon: 'bedtime', title: 'Explore your recovery', description: 'See sleep and health trends when your connected services provide them.' },
            { icon: 'calendar_month', title: 'Plan your workouts', description: 'Create training plans and structured workouts in your calendar.' },
        ],
    },
    {
        hero: 'Start your way.',
        title: 'Bring your training into QS.',
        description: 'Connect your watch or upload an activity file. You can also explore first and add your data later.',
        points: [
            { icon: 'watch', title: 'Connect your watch', description: 'With Pro, connect Garmin, Suunto, COROS or Wahoo to import your activities.' },
            { icon: 'upload_file', title: 'Upload an activity file', description: 'Upload activity files such as FIT, GPX or TCX with free Starter.' },
            { icon: 'explore', title: 'Take a look around', description: 'Open your Dashboard with free Starter and add activities when you’re ready.' },
        ],
    },
] as const;
