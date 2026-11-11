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
        hero: 'Plan what comes next.',
        title: 'Ask questions. Build workouts.',
        description: 'Explore your data with AI, create structured workouts, and organize your training.',
        points: [
            { icon: 'chat', title: 'Ask about your training', description: 'Ask Assistant about your data, or connect ChatGPT or Claude with access you choose.' },
            { icon: 'auto_awesome', title: 'Build or generate a workout', description: 'Set intervals and targets, or use AI with your selected training and recovery data. Review the workout before adding it.' },
            { icon: 'calendar_month', title: 'Organize your training', description: 'Save favorite workouts, schedule sessions and organize your plan into phases.' },
        ],
    },
    {
        hero: 'Add your first activity.',
        title: 'Connect a service or upload a file.',
        description: 'Start free with manual uploads, or use Pro to connect Garmin, Suunto, COROS or Wahoo.',
        points: [
            { icon: 'watch', title: 'Connect with Pro', description: 'After setup, open Connections for automatic imports and choose which supported services exchange activities.' },
            { icon: 'upload_file', title: 'Upload files for free', description: 'In Dashboard, select Upload and choose a FIT, GPX or TCX activity file.' },
            { icon: 'download', title: 'Keep your original files', description: 'Download your original activity files for a backup or analysis elsewhere.' },
        ],
    },
] as const;
