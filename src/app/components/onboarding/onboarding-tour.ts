/** The optional Field guide introduces existing workspaces, without granting consent or starting imports. */
export const FIELD_GUIDE_CHAPTERS = [
    {
        hero: 'Analyze your workouts.',
        title: 'Review routes, laps and performance.',
        description: 'Review activities from your devices and uploaded files in one place.',
        points: [
            { icon: 'dashboard', title: 'Browse your activity history', description: 'Find runs, rides, swims and other activities in Dashboard.' },
            { icon: 'route', title: 'Inspect an activity', description: 'Review its route, laps, pace, heart rate, power and other recorded metrics.' },
            { icon: 'compare_arrows', title: 'Compare device recordings', description: 'Use Compare to check GPS tracks and measurements from devices used in the same workout.' },
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
