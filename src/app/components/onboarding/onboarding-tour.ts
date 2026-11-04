/** The optional Field guide introduces existing workspaces, without granting consent or starting imports. */
export const FIELD_GUIDE_CHAPTERS = [
    {
        hero: 'Go further. See more.',
        title: 'Every part of your training, together.',
        description: 'Your watch sees the session. Quantified Self helps you see how it all fits together.',
        points: [
            { icon: 'watch', title: 'Bring your activities together', description: 'Different sports and services, one home.' },
            { icon: 'insights', title: 'See the wider picture', description: 'Explore health and sleep alongside training.' },
            { icon: 'tune', title: 'Make the view yours', description: 'Start simple and explore at your own pace.' },
        ],
    },
    {
        hero: 'Small moments. Bigger picture.',
        title: 'Look beyond a single workout.',
        description: 'A great session is one chapter. Explore the patterns across your activities, health and sleep.',
        points: [
            { icon: 'monitoring', title: 'Follow your training over time', description: 'Look at your workload, consistency and progress.' },
            { icon: 'bedtime', title: 'Put recovery in context', description: 'Explore the sleep and health data your sources support.' },
            { icon: 'edit_note', title: 'Remember the things numbers miss', description: 'Add private Timeline notes about life around your training.' },
        ],
    },
    {
        hero: 'Your next chapter.',
        title: 'Make room for what comes next.',
        description: 'Get to know your patterns. Then use your workspace to plan, review and keep moving.',
        points: [
            { icon: 'calendar_month', title: 'Give your week a little structure', description: 'Create plans and workouts in your training calendar.' },
            { icon: 'route', title: 'Get closer to every activity', description: 'Explore recorded routes, laps and the details that matter.' },
            { icon: 'shield', title: 'Choose your connections', description: 'Review provider permissions and optional sharing before you start.' },
        ],
    },
] as const;
