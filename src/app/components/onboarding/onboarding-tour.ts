/** The optional Field guide introduces existing workspaces, without granting consent or starting imports. */
export const FIELD_GUIDE_CHAPTERS = [
    {
        hero: 'Analyze your training.',
        title: 'Track your progress.',
        description: 'Explore your workouts in detail, follow changes in performance, and review training load and recovery.',
        points: [
            { icon: 'route', title: 'Workout analysis', description: 'Explore pace, power, heart rate and laps. Compare recordings to check device differences.' },
            { icon: 'trending_up', title: 'Performance trends', description: 'Review your activity history and see how your performance changes over time.' },
            { icon: 'monitoring', title: 'Training and recovery', description: 'Track fitness, fatigue and volume alongside available sleep and health data.' },
        ],
    },
    {
        hero: 'Track your training.',
        title: 'Review training load and recovery.',
        description: 'Track training volume, review sleep and health trends, and schedule workouts.',
        points: [
            { icon: 'monitoring', title: 'Monitor training load', description: 'Open Training to track fitness, fatigue, form and weekly volume.' },
            { icon: 'bedtime', title: 'Review sleep and health', description: 'Review sleep duration and health trends available from your connected services.' },
            { icon: 'calendar_month', title: 'Schedule workouts', description: 'Create a training plan or add a structured workout to your calendar.' },
        ],
    },
    {
        hero: 'Add your first activity.',
        title: 'Connect a service or upload a file.',
        description: 'Upload files for free, or use Pro to import from Garmin, Suunto, COROS or Wahoo.',
        points: [
            { icon: 'watch', title: 'Connect with Pro', description: 'After setup, connect your watch service in Connections for automatic imports.' },
            { icon: 'upload_file', title: 'Upload files for free', description: 'In Dashboard, select Upload and choose a FIT, GPX or TCX activity file.' },
            { icon: 'explore', title: 'Add activities later', description: 'Choose Let me look around to open Dashboard and add activities later.' },
        ],
    },
] as const;
