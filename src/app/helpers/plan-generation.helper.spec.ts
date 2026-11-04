import { buildPlanAssistantRequest, nextPlanMonday, type PlanGenerationOptions } from '@shared/training-plan-generation';
const options: PlanGenerationOptions = { startLocalDate: '2026-11-09', weeks: 4, sport: null, days: null, minutes: null,
  goalNames: ['Spring marathon'], timelineNotesEnabled: true, instructions: '' };
describe('plan generation request', () => {
  it('uses local date labels across month/year boundaries and the next Monday', () => {
    expect(nextPlanMonday('2026-11-04')).toBe('2026-11-09');
    expect(nextPlanMonday('2026-11-09')).toBe('2026-11-16');
    expect(nextPlanMonday('2026-12-31')).toBe('2027-01-04');
    expect(buildPlanAssistantRequest(options, '2026-11-04').prompt).toContain('2026-11-09 through 2026-12-06');
  });
  it('keeps routine inference evidence-based and preserves review, rest and existing workouts', () => {
    const request = buildPlanAssistantRequest(options, '2026-11-04');
    expect(request.prompt).toContain('last 28 days'); expect(request.prompt).toContain('ask if history is insufficient');
    expect(request.prompt).toContain('read their details and priorities');
    expect(request.prompt).toContain('Preserve existing workouts and rest days');
    expect(request.prompt).toContain('paused plan'); expect(request.prompt).toContain('ask before activation');
    expect(request.prompt.length).toBeLessThanOrEqual(1000);
  });
  it('keeps explicit days, minutes, no-goal choices and notes consent', () => {
    const request = buildPlanAssistantRequest({ ...options, days: [6, 1], minutes: 45, goalNames: [], timelineNotesEnabled: false }, '2026-11-04');
    expect(request).toMatchObject({ timelineNotesEnabled: false });
    expect(request.prompt).toContain('Mon, Sat'); expect(request.prompt).toContain('45 minutes');
    expect(request.prompt).toContain('Goal focus: none');
    expect(request.prompt).toContain('Sport: suggest from my recorded routine');
    expect(request.prompt).not.toContain('my selected goals'); expect(request.prompt).toContain('Do not use Timeline notes');
  });
  it('rejects invalid choices and overly long requests without silently dropping selected goals', () => {
    for (const patch of [{ startLocalDate: '2026-11-01' }, { startLocalDate: '2026-02-30' }, { weeks: 9 },
      { days: [] }, { days: [1, 1] }, { minutes: 0 }, { minutes: 30.5 }, { sport: 'invented' },
      { goalNames: Array.from({ length: 20 }, () => 'A'.repeat(120)) }]) {
      expect(() => buildPlanAssistantRequest({ ...options, ...patch }, '2026-11-04')).toThrow();
    }
  });
});
