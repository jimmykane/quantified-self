import { APPROVED_REMAINING_SPORT_CASES, APPROVED_OTHER_TRAINING_NAMES } from '@shared/testing/training-remaining-sport-cases';
import { APPROVED_WATER_TEAM_SPORT_CASES } from '@shared/testing/training-water-team-cases';
import { describe, expect, it } from 'vitest';
import { HELP_ACTIONS, HELP_SECTIONS, HelpSectionId } from './help.content';
import { searchHelpSections } from '../helpers/help-search.helper';
import {
  CONNECTED_SERVICES_POLICY_SECTION,
  POLICIES_AI_AND_PROCESSORS_FRAGMENT,
  POLICIES_CONNECTED_SERVICES_FRAGMENT,
  POLICIES_COROS_DATA_FRAGMENT,
  POLICIES_GARMIN_DATA_FRAGMENT,
  POLICIES_MCP_CLIENTS_FRAGMENT,
  POLICIES_SUUNTO_DATA_FRAGMENT,
  POLICIES_WAHOO_DATA_FRAGMENT,
} from './policies.content';
import { ROUTE_USAGE_LIMITS, USAGE_LIMITS } from '../../../shared/limits';


describe('help.content', () => {
  it('explains default-on workout generation context and independent draft opt-outs', () => {
    const help = HELP_SECTIONS.map(section => section.content).join('\n');
    expect(help).toContain('**Training plans and workouts** and **Timeline notes** start enabled for every new draft');
    expect(help).toContain('turn off either context independently');
    expect(help).toContain('Turning off Training context also disables matching previous planned weights');
    expect(help).toContain('matching **previously planned** loads (enabled by default)');
    expect(help).not.toContain('separate default-off Training-plan/Timeline context');
    expect(help).toContain('**Personalization** starts expanded with every data option selected');
    expect(help).toContain('Uncheck any source to exclude its evidence');
    expect(help).toContain('turning off any of those also turns off the combined score');
    expect(help).toContain('**Training routine** starts selected and requires **Recent activities**');
    expect(help).toContain('previous 28 complete local days, excluding today');
    expect(help).toContain('missing recordings do not mean missed training');
    expect(help).toContain('The modal footer shows your shared **Assistant allowance**');
    expect(help).toContain('after each generation attempt');
  });

  it('distinguishes scheduled history and cooldowns from completion estimates', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'service-connections')!.content;
    expect(copy).toContain('Scheduled activity counts confirm queued work, not completed imports');
    expect(copy).toContain('QS does not promise a completion time from those counts');
    expect(copy).toContain('not an expected finish date');
  });

  it('explains shared provider import progress and distinguishes requests from delivery', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'service-connections')!.content;
    for (const phrase of ['**Importing history**', 'update together with the header', '**View details**',
      'does not start, retry or cancel an import', '**24 hours**', '**History requested**',
      '**Status unavailable**', '**Refresh status**', 'not a percentage',
      'Disconnecting a provider removes its retained import status', '**Reconnect required**',
      'Reconnecting and importing remain your explicit choices', '**Checking status**',
      'refresh is disabled until that check finishes', '**Hide from dashboard**', '**Show on dashboard**',
      'remembered for your account on this browser', 'Hiding the cards does not stop an import',
      '**Finished with issues**', '**Dismiss this result**', 'not failure totals',
      '**Requesting Garmin history**', '**requests scheduled**', 'not records received',
      'delivery completion is not tracked here',
      'a new import or a retried result appears again', 'recovery controls remain in Connections']) expect(copy).toContain(phrase);
  });
  it('explains durable manual Garmin activity requests without claiming delivery completion', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'service-connections')!.content;
    for (const phrase of ['Manual **Garmin**, **Suunto**, **COROS** and **Wahoo**',
      '**Requesting Garmin history**', 'temporary failures retry from the unfinished batch',
      '**History requested** means submission finished', 'Garmin delivers activities separately',
      'does not confirm that every activity has arrived', '**30-day cooldown**',
      'Existing connections are verified automatically', 'reconnect before importing history; no import starts from that request',
      'Sleep, Health and saved routes keep their separate controls']) expect(copy).toContain(phrase);
    expect(copy).not.toContain('Older connections may retain the previous import flow');
  });
  it('explains Pro trial payment, cancellation and the unchanged free and existing-trial choices', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'plans-and-billing')!.content;
    for (const phrase of ['New Pro trials require a payment method', 'no subscription charge during the free trial',
      'first payment date', 'before the trial ends to avoid the first payment', 'Existing trials keep the terms',
      'Starter stays free', 'safely replaces an earlier unfinished checkout']) expect(copy).toContain(phrase);
  });
  it('explains the checkout handoff and recovery before another payment', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'plans-and-billing')!.content;
    expect(copy).toContain('checks your access for up to 20 seconds');
    expect(copy).toContain('**Updating your checkout…**');
    expect(copy).toContain('Choosing the same offer resumes its existing checkout');
    expect(copy).toContain('If a checkout expires, choose the offer again');
    expect(copy).toContain('If checkout completed in another tab, refresh Membership');
    expect(copy).toContain('**Connect your devices** opens [Connections](/services)');
    expect(copy).toContain('Opening Connections does not connect an account automatically');
    expect(copy).toContain('**Membership still syncing**');
    expect(copy).toContain('do not start another checkout while the result is unconfirmed');
  });
  it('makes billing access discoverable without a Quantified Self sign-in', () => {
    const billing = HELP_SECTIONS.find(section => section.id === 'plans-and-billing')!;
    const troubleshooting = HELP_SECTIONS.find(section => section.id === 'troubleshooting')!;
    expect(billing.content).toContain('[open the Stripe billing portal](https://billing.stripe.com/p/login/3cI7sLf5ObXy84o8OqcIE00)');
    expect(billing.content).toContain('email address used for your subscription');
    expect(billing.content).toContain('Stripe emails you a login link');
    expect(billing.content).toContain('usual billing button in [Membership](/subscriptions)');
    expect(troubleshooting.content).toContain('[billing access without signing in](/help#plans-and-billing)');
    expect(searchHelpSections(HELP_SECTIONS, "billing can't sign in").map(section => section.id)).toContain('plans-and-billing');
  });
  it('links membership and shareable getting-started and billing guides to their supported public URLs', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'getting-started')!.content;
    expect(copy).toContain('[Membership](/pricing)');
    expect(copy).toContain('[Garmin to Wahoo guide](/guides/sync-garmin-to-wahoo)');
    expect(copy).toContain('[Plans & Billing](/help#plans-and-billing)');
    expect(copy).toContain('[Getting Started](/help#getting-started)');
    expect(copy).toContain('Help topic cards are shareable links');
    expect(copy).toContain('Continue to Connections');
    expect(copy).toContain('Opening setup does not connect a provider or enable automatic sync');
  });

  it('explains the QS artifact definition and limits of comparisons with other apps', () => {
    const copy = HELP_SECTIONS.find(section => section.content.includes('### Activity beat-interval statistics'))!.content;
    expect(copy).toContain('percentage of analyzed R–R intervals flagged as potential artifacts');
    expect(copy).toContain('useful for comparing devices within QS');
    expect(copy).toContain('different algorithms or thresholds');
    expect(copy).toContain('artifact values are not directly comparable');
    expect(copy).toContain('Flags are not confirmed strap errors');
    expect(copy).toContain('a lower percentage alone does not prove that a device is more accurate');
    expect(copy).toContain('Suspected ectopic pairs, invalid intervals and recording gaps are tracked separately');
  });
  it('distinguishes filtered Suunto HR from raw beat statistics and historical stored values', () => {
    const copy = HELP_SECTIONS.find(section => section.content.includes('### Activity beat-interval statistics'))!.content;
    expect(copy).toContain('Suunto JSON/SML recordings can derive a filtered heart-rate trace');
    expect(copy).toContain('retaining source HR when there are too few usable estimates');
    expect(copy).toContain('Original intervals and HRV/artifact calculations stay separate');
    expect(copy).toContain('FIT imports keep recorded heart rate');
    expect(copy).toContain('older saved HR summaries and calculated Training load need an original-file reparse');
  });
  it('explains source updates, saved leg preferences and the retained-original boundary', () => {
    const copy = HELP_SECTIONS.find(section => section.content.includes('### Updated recordings and saved preferences'))!.content.replace(/\s+/g, ' ');
    expect(copy).toContain('Training load override, exclusion and saved policy stay with');
    expect(copy).toContain('The updated file supplies the sport');
    expect(copy).toContain('custom device name and ascent/descent corrections');
    expect(copy).toContain('does not fetch a sport change');
    expect(copy).toContain('does not guess how to move preferences between multisport legs');
    expect(copy).toContain('repeat manual upload');
    expect(copy).toContain('repeating the upload cannot resolve an ambiguous leg association');
  });

  it('explains independent ascent/descent correction, reviewed reset and source preservation', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'uploads-and-imports')!.content;
    for (const phrase of ['**Edit ascent / descent**', '**Ascent** or **Descent**', 'corrections are independent', '**Reset to imported value**', '**Edited**',
      'without replacing your correction', 'not the altitude chart, laps, original file']) expect(copy).toContain(phrase);
  });
  it('explains stalled startup recovery without recommending clearing browser storage', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'troubleshooting')!.content;
    for (const phrase of ['after 15 seconds', '**Loading is taking longer than expected**', '**Reload page**',
      'does not clear storage', 'the app continues automatically', 'use **Retry** there']) {
      expect(copy).toContain(phrase);
    }
  });

  it('explains browser verification cooldowns and recovery without resetting account data', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'troubleshooting')!.content;
    expect(copy).toContain('Temporary verification service errors retry automatically after short pauses');
    for (const text of ["We couldn't verify this browser", '**Reload page**', '**24 hours**',
      'Repeated retries in that page do not clear the pause', 'Reloading does not guarantee acceptance',
      'another trusted network', 'your saved data stays unchanged', 'Never send passwords or verification tokens']) {
      expect(copy).toContain(text);
    }
  });
  it('explains display-only Power averaging without changing statistics or benchmarks', () => {
    const copy = HELP_SECTIONS.map(section => section.content).join('\n');
    for (const phrase of ['**Power** starts in **Raw**', 'including coasting zeros', 'whiskers for recorded peaks and dips',
      'even on a distance axis', 'gaps stay empty', 'Stats and benchmarks use the original data']) {
      expect(copy).toContain(phrase);
    }
  });
  it('explains reconstructed swim intervals, original lap triggers and header meanings', () => {
    const copy = HELP_SECTIONS.map(section => section.content).join('\n');
    for (const phrase of ['**Intervals**', '**Original laps**', '**Fitness equipment** is a recorded lap trigger',
      'without reimporting them', '**Total strokes** is the count for an interval',
      '**Average Stroke Count** is a recorded per-length average', 'focus it with the keyboard',
      'including when no separate original laps are available', '**Lap** column retains the original lap numbers']) {
      expect(copy).toContain(phrase);
    }
  });

  it('explains pool-swimming axis choices and preserves distance preferences for other sports', () => {
    const copy = HELP_SECTIONS.map(section => section.content).join('\n');
    for (const phrase of ['**Pool swimming** defaults to **Duration**, with **Time** also available',
      '**Distance** is disabled even when distance is recorded', 'without changing your preference for other sports',
      'Open-water swimming can still use Distance when recorded']) {
      expect(copy).toContain(phrase);
    }
  });
  it('explains bounded bulk Training refreshes without promising instant edit results', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'training-analysis')!.content;
    expect(copy).toContain('background rebuild may wait up to two minutes');
    expect(copy).toContain('plus normal sync, queue and calculation time');
    expect(copy).toContain('All changes are retained');
    expect(copy).toContain('updates automatically use a five-minute background interval');
    expect(copy).toContain('late-arriving records still trigger an update');
    expect(copy).toContain('Training load edits and benchmark changes receive priority');
    expect(copy).toContain('wait for any calculation already running');
    expect(copy).toContain('Opening Training again does not speed up');
  });
  it('explains the flat Timeline notes shortcut and reuse of the current workspace and comparison destination', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'health')!.content;
    expect(copy).toContain("app navigation's **Training & health** section");
    expect(copy).not.toContain('**Health → Timeline notes**');
    expect(copy).toContain('to open **Note comparisons**');
    expect(copy).toContain('navigation does not open an add-note form');
    expect(copy).toContain('**Manage notes** is a separate action');
    expect(copy).toContain('comparisons opened from the manager return to that manager');
    expect(copy).toContain('stays highlighted in navigation while comparing');
    const planning = HELP_SECTIONS.find(section => section.id === 'training-plans')!.content;
    expect(planning).toContain('full-level row in **Training & health**, after **Training**');
  });
  it('explains read-only note comparisons and honest coverage/source boundaries without implying an effect', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'health')!.content;
    for (const phrase of ['**Compare** beside a saved note', '**14 days on each side**', '**5/7**', '**10/14**', '**20/28**',
      "note's **start date**", 'choices stay local', 'observed differences, not cause and effect',
      'Missing days are gaps', 'multiple reported devices', 'previous difference is not shown as a current result']) {
      expect(copy).toContain(phrase);
    }
  });
  it('explains compact note differences and the shared disclosure without conflating them with recovery', () => {
    const content = HELP_SECTIONS.map(section => section.content).join('\n');
    expect(content).toContain('**Before & after this note**');
    expect(content).toContain('full before/after median table');
    expect(content).toContain('the history chart stays visible either way');
    expect(content).toContain('neutral rail does not classify a numerical change as good/bad');
  });
  it('explains ongoing notes, fixed after-windows and missing historical evidence without asking users to end or move notes', () => {
    const content = HELP_SECTIONS.find(section => section.id === 'health')!.content;
    for (const phrase of ['**Ongoing notes can be compared without ending them.**', 'Ending a note does not move those dates',
      '**first** 7, 14 or 28 days', '**No eligible readings for these dates**', 'failed checks are shown as unavailable',
      "Keep the note's real start date", 'cannot create history the provider no longer supplies']) expect(content).toContain(phrase);
  });
  it('separates requested import dates, stored first dates and previously reported Sleep-only provider cutoffs', () => {
    const content = HELP_SECTIONS.find(section => section.id === 'service-connections')!.content;
    for (const phrase of ['**Requested range** from **Stored history**', 'not complete or gap-free coverage',
      '**Refresh stored dates**', 'without starting an import', '**Last reported Garmin Sleep history cutoff**',
      'never applied to Health']) expect(content).toContain(phrase);
  });
  it('explains saved Suunto route import scope without enabling outbound directions', () => {
    const content = HELP_SECTIONS.map(section => section.content).join('\n');
    expect(content).toContain('Suunto also includes existing saved routes');
    expect(content).toContain('entire route library, regardless of the selected history range');
    expect(content).toContain('**Import existing routes** remains available separately');
    expect(content).not.toContain('Saved-route libraries remain separate manual actions');
  });
  it('explains the full-label Dashboard Health range menu', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'getting-started')!.content;
    expect(copy).toContain('Tap the range button to open a menu with full labels and a checked selection.');
  });

  it('explains the activity explorer, full shared table, partial history and saved filters', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'getting-started')!.content;
    for (const phrase of ['[Activities](/activities)', '**Overview** section of the sidenav', 'same full events table as Calendar', '**Search activities**',
      'compact notice below their existing column headings', '**Change dates**',
      'Activity tables default to **Start Date**, newest first', 'your choice is saved',
      'placeholder rows on their first load', '**Updating activities…**', '**Showing previous results**', 'Row actions and paging pause',
      'no filter matches suggest changing dates or clearing a filter', '**All dates** without filters uses a neutral message',
      'offers connection setup only when no service is connected',
      'column picker beside the filters', 'scroll inside the table', 'no separate history-loading step',
      '**Search tags**', '**Search sports**', 'select checkboxes', 'any selected tag', 'any selected sport',
      'Searching keeps checked choices selected', '**Clear selection**',
      '**Untagged**', '**Last 7 days**', 'previous six local calendar days', 'selected-row bulk actions',
      '**Next** and **Previous**', 'matching total within that date range', 'do not start new event queries', 'shared table preferences',
      'saved tag remains available', '**Refresh activities**', 'Generated timestamp names are hidden',
      '**All dates** is the last option and shows a warning', '**Keep current range** to cancel without reloading',
      'Saved All dates links also require confirmation', '**Custom dates**', 'Both dates are included',
      'compact date button opens the presets', 'The button shows your selected dates', '**×** clear button',
      '**Cancel** keeps the previous range',
      'only applying a valid changed range starts a new date-range query', 'Custom dates stay fixed as days pass',
      'custom names remain visible', 'older /tags links open Activities']) expect(copy).toContain(phrase);
  });
  it('explains unavailable pool timing without losing rests or inventing replacements', () => {
    const copy = HELP_SECTIONS.map(section => section.content).join('\n');
    expect(copy).toContain('Valid elapsed time is not substituted for rejected active time');
    expect(copy).toContain('Valid long rests and multisport laps are preserved');
    expect(copy).toContain('Its distance, strokes and rest label remain');
  });
  it('explains source parser corrections without promising calibration or historical deletion', () => {
    const copy = HELP_SECTIONS.find(section => section.content.includes('### Form tile (CTL / ATL / TSB)'))!.content;
    expect(copy).toContain('pace-based load needs a threshold belonging to that sport');
    expect(copy).toContain('An unassigned whole-workout speed threshold is not copied across different sports');
    expect(copy).toContain('COROS GPX files can supply recorded heart-rate readings');
    expect(copy).toContain('Readings alone do not supply the explicit threshold or other calibration');
    expect(copy).toContain('Daily monitoring FIT files are not workouts');
    expect(copy).toContain('Completed workout summaries, including Wahoo files without sensor readings, remain supported');
    expect(copy).toContain('when the file contains a recorded workout session');
    expect(copy).toContain('reports a failure and keeps the existing saved activity');
    expect(copy).toContain('does not automatically remove it or import Health data');
    expect(copy).toContain('complete pool lengths and a complete recorded distance counter or an independent session total agree');
    expect(copy).toContain('that distance is counted once');
    expect(copy).toContain('Missing or conflicting evidence is not used to guess a correction');
  });
  it('explains bounded dashboard freshness-check recovery without promising unavailable values', () => {
    const copy = HELP_SECTIONS.find(section => section.content.includes('### Form tile (CTL / ATL / TSB)'))!.content;
    expect(copy).toContain('retried automatically up to twice, while your available values stay visible');
    expect(copy).toContain('Retries stop if you sign out or change accounts');
    expect(copy).toContain('If the connection stays unavailable, use **Retry** once it returns');
  });
  it('distinguishes rejected calculations from missing inputs and explains importer metadata corrections', () => {
    const copy = HELP_SECTIONS.find(section => section.content.includes('### Form tile (CTL / ATL / TSB)'))!.content;
    expect(copy).toContain('have the required file inputs but still fail to produce a valid TSS');
    expect(copy).toContain('distinguishes this from missing inputs');
    expect(copy).toContain('does not change the scoring formulas or accepted score range');
    expect(copy).toContain('Saved individual activity names are retained');
    expect(copy).toContain('without treating the GPX format version as a device manufacturer');
    expect(copy).toContain('An unrecognized TCX sport is shown as **Unknown Sport**');
    expect(copy).toContain('requires reimporting the original file');
  });
  it('explains single-lap pool imports and retained boundary rests', () => {
    const copy = HELP_SECTIONS.find(section => section.content.includes('### Form tile (CTL / ATL / TSB)'))!.content;
    expect(copy).toContain('Pool imports support swims recorded as one lap');
    expect(copy).toContain('Rest lengths add no generated distance');
    expect(copy).toContain('ambiguous length ownership is not guessed');
    expect(copy).toContain("Readings calculated from pool lengths stay within that swim's recorded times");
  });
  it('explains source distance preservation during reimport', () => {
    const copy = HELP_SECTIONS.find(section => section.content.includes('### Form tile (CTL / ATL / TSB)'))!.content;
    expect(copy).toContain('keeps the positive distance selected when the original file is parsed');
    expect(copy).toContain('Distance readings can stop early, begin late or reset');
    expect(copy).toContain('Those readings do not replace the parsed total');
    expect(copy).toContain('Missing or zero totals can still be calculated from available measurements');
    expect(copy).toContain('This also applies to pool swims');
    expect(copy).toContain('does not copy an older saved distance or guess totals by adding counter segments');
  });
  it('distinguishes measured zero power from missing sensor evidence', () => {
    const copy = HELP_SECTIONS.find(section => section.content.includes('### Form tile (CTL / ATL / TSB)'))!.content;
    expect(copy).toContain('Valid recorded zero-power windows can produce zero power-based TSS');
    expect(copy).toContain('A zero summary or missing sensor readings alone cannot establish zero load');
    expect(copy).toContain('Missing power readings do not count as recorded zero power');
    expect(copy).toContain('calculated power load falls back to another eligible method or stays unavailable');
    expect(copy).toContain('calculated average power uses observed active readings, including real coasting zeros');
    expect(copy).toContain('calculated total work can be unavailable');
    expect(copy).toContain('efforts crossing recording gaps or pauses are excluded');
    expect(copy).toContain('A valid summary supplied by the file keeps priority');
    expect(copy).toContain('Partial calculated power load is labelled as an estimate');
    expect(copy).toContain('Opening a power chart reads the retained original file without changing saved statistics');
    expect(copy).toContain('refreshing Training alone does not reparse the file');
  });
  it('keeps activity beat statistics separate from overnight HRV and source-free recalculation', () => {
    const copy = HELP_SECTIONS.find(section => section.content.includes('### Activity beat-interval statistics'))!.content;
    expect(copy).toContain('**R–R RMSSD**');
    expect(copy).toContain('Ordinary heart-rate readings cannot supply these statistics');
    expect(copy).toContain('separate from overnight HRV and Readiness');
    expect(copy).toContain('Older saved summaries need an original-file reparse');
    expect(copy).toContain('Multisport legs keep their own values');
    expect(copy).toContain('**R–R & HRV** summary tab appears on any Event Details page');
    expect(copy).toContain('immediately before **Device**');
    expect(copy).toContain('without a separate action row');
    expect(copy).toContain('**Show details**, alongside the metric tiles');
    expect(copy).toContain('statistics present and valid in both recordings');
    expect(copy).toContain('Ordinary events and multisport legs do not show benchmark deltas');
    expect(copy).toContain('**Saved comparisons** table includes a compact **R–R & HRV** column');
    expect(copy).toContain('without additional reads or analysis');
    expect(copy).toContain('show **Not loaded** rather than claiming HRV is missing');
    expect(copy).toContain('Choose **Poincaré** in the R–R chart view selector');
    expect(copy).toContain('without joining the remaining neighbours');
    expect(copy).toContain('Gaps and invalid observations always break adjacency');
    expect(copy).toContain('Point-pair counts are separate from suspected ectopic-pair statistics');
    expect(copy).toContain('larger centred square on desktop');
    expect(copy).toContain('**Open Poincaré plot fullscreen**');
    expect(copy).toContain('without repeating beat analysis');
    expect(copy).toContain('Generated **benchmark reports**, including shared and saved images');
    expect(copy).toContain('seven key R–R & HRV statistics side by side');
    expect(copy).toContain('differences appear only when both recordings have a valid value');
    expect(copy).toContain('cover each entire recording, not only the aligned overlap');
    expect(copy).toContain('do not affect the hardware agreement grade');
    expect(copy).toContain('On **Event Details**, **R–R & HRV** appears after the performance charts');
    expect(copy).toContain('ordinary workouts, multisport legs and benchmarks');
    expect(copy).toContain('Events without beat intervals or valid saved HRV statistics do not show this section');
    expect(copy).toContain('all 20 recorded R–R metrics');
    expect(copy).toContain('starts collapsed');
    expect(copy).toContain('one, two or more overlaid recordings');
    expect(copy).toContain('statistics in a top legend');
    expect(copy).toContain('a fixed, anonymized 90-second excerpt from one real R–R recording');
    expect(copy).toContain('not a live view of your account');
    expect(copy).toContain('the metric legend wraps so every available value stays visible');
    expect(copy).toContain('The full statistics table scrolls horizontally');
    expect(copy).toContain('Original recording start offsets');
    expect(copy).toContain('Devices without R–R intervals or saved HRV statistics are omitted');
    expect(copy).toContain('The chart legend includes only recordings with usable beat intervals');
    expect(copy).toContain('can still show valid saved values under **Show statistics**');
    expect(copy).toContain('Missing values show a dash; a recorded zero stays zero');
    expect(copy).toContain('**Reset zoom** restores both');
    expect(copy).toContain('without repairing data or changing the full-recording summaries');
    expect(copy).toContain('available raw intervals do not fill missing saved summaries');
    expect(copy).toContain('without saving new statistics, reparsing the event or adding an accuracy grade');
  });
  it('explains recorded timer recovery and the original-file boundary for historical corrections', () => {
    const copy = HELP_SECTIONS.find(section => section.content.includes('### Form tile (CTL / ATL / TSB)'))!.content;
    expect(copy).toContain('Recorded Suunto pauses and resumes are used in load calculations');
    expect(copy).toContain('consistent, unambiguous timer timeline');
    expect(copy).toContain('a recorded positive timer summary remains authoritative');
    expect(copy).toContain('refreshing Training alone cannot recover readings or pauses discarded during an earlier import');
    expect(copy).toContain('Your saved load preferences and overrides are retained');
  });
  it('explains running pace coverage, recorded pool HR and confirmed multisport pauses', () => {
    const copy = HELP_SECTIONS.find(section => section.content.includes('### Form tile (CTL / ATL / TSB)'))!.content;
    expect(copy).toContain('Running pace TSS uses the energy cost of hills, recorded zero speed and complete 30-second windows');
    expect(copy).toContain('insufficient usable pace data falls back to another eligible method');
    expect(copy).toContain('Pool swims keep recorded heart-rate readings instead of replacing them with lap averages');
    expect(copy).toContain('missing or conflicting timing is not used to guess a pause');
  });
  it('explains HR pauses and independent power calibration without promising historical rewrites', () => {
    const copy = HELP_SECTIONS.find(section => section.content.includes('### Form tile (CTL / ATL / TSB)'))!.content;
    expect(copy).toContain('Calculated HR TSS excludes explicit timer pauses');
    expect(copy).toContain('Without recorded start/stop events, pauses cannot be located from total duration alone');
    expect(copy).toContain('Power-based TSS needs independent FTP recorded in the file');
    expect(copy).toContain('another eligible method is used or load stays unavailable');
    expect(copy).toContain('File-imported scores remain unchanged');
    expect(copy).toContain('Older activities retain recorded values until **Reimport activity from file**');
  });
  it('explains sport-wide threshold HR estimates without changing calculation exclusions or calibration safeguards', () => {
    const copy = HELP_SECTIONS.find(section => section.content.includes('### Form tile (CTL / ATL / TSB)'))!.content;
    for (const phrase of ['**HR · Banister**', '**HR · Threshold (estimate)**',
      'When resting or maximum HR is missing but a valid threshold is recorded',
      'This includes walking, hiking, swimming and strength training',
      'Sports excluded from calculated TSS remain excluded',
      'Conflicting or invalid calibration is not replaced with guessed settings',
      'Older evaluations can show only **HR**', 'Reimport retains your overrides, exclusions and saved preferences']) {
      expect(copy).toContain(phrase);
    }
  });
  it('explains swimming threshold requirements, file-only fallbacks and imported-score preservation', () => {
    const copy = HELP_SECTIONS.find(section => section.content.includes('### Form tile (CTL / ATL / TSB)'))!.content;
    expect(copy).toContain('Pool and open-water swimming need a usable swim threshold for pace-based TSS');
    expect(copy).toContain("The workout's average pace is never used as its own threshold");
    expect(copy).toContain('other eligible methods, including calibrated HR or a calorie/MET estimate');
    expect(copy).toContain('If none has the required file inputs, load stays unavailable');
    expect(copy).toContain('File-imported TSS, including zero, still takes precedence');
    expect(copy).toContain('Complete, valid HR settings recorded for the session');
    expect(copy).toContain('Missing or invalid session settings are not guessed');
    expect(copy).toContain('Older activities retain recorded values until **Reimport activity from file**');
  });
  it('explains a busy activity-history request for all four providers without claiming success or failure', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'service-connections')!.content;
    expect(copy).toContain('For Garmin, Suunto, COROS, and Wahoo, **Import already running**');
    expect(copy).toContain('The duplicate request does not start another import');
    expect(copy).toContain('does not mean the original import failed');
    expect(copy).toContain('Wait for the active import to finish');
    expect(copy).toContain('COROS activity history prevents overlapping requests from separate tabs or devices');
    expect(copy).toContain('activities already queued keep processing and the cooldown reflects the queued count');
    expect(copy).toContain('An empty scan allows another request');
    expect(copy).toContain('does not mean all queued activities have finished importing');
  });

  it('explains pending history requests, delayed records, and the Sleep status retry', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'service-connections')!.content;
    for (const phrase of ['History import buttons lock as soon as a request starts', 'reopening the tool in the same app',
      'separate requests and cooldowns', 'records may arrive later', '**Checking import status**', '**Retry status check**',
      'keeps the action disabled until that time', 'keeps your selection and shows a date error']) {
      expect(copy).toContain(phrase);
    }
  });
  it('explains copied merge load controls and the retained original workouts', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'getting-started')!.content;
    expect(copy).toContain('The combined modeled load sums included activities once');
    expect(copy).toContain('Your original workouts remain unchanged');
    expect(copy).toContain('A whole-workout exclusion applies to its copied legs');
    expect(copy).toContain('Exclusion keeps its history and volume');
  });
  it('explains Training history columns separately from unavailable history and forecasts', () => {
    const training = HELP_SECTIONS.find(section => section.id === 'training-analysis')!.content;
    expect(training).toContain('**Load metric history**');
    expect(training).toContain('Monotony history uses modeled daily TSS, including your Training load preferences and overrides');
    expect(training).toContain('not Strain values');
    expect(training).toContain('**Plans** in the app navigation');
    expect(training).not.toContain('**Plans** in the Training header');
    expect(training).toContain('dashed no-additional-load scenario');
    const dashboard = HELP_SECTIONS.find(section => section.id === 'getting-started')!.content;
    expect(dashboard).toContain('**history columns**');
    expect(dashboard).toContain('past zero-load scenarios');
    expect(dashboard).toContain('**Awaiting today’s sleep**');
    expect(dashboard).toContain('withholds the readiness score and confidence');
    expect(dashboard).toContain('**Last available** with their date');
    expect(dashboard).toContain('updates at local midnight');
  });
  it('distinguishes account deletion acceptance from background data cleanup', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'data-and-privacy')!.content;
    expect(copy).toContain('after sign-in access is removed');
    expect(copy).toContain('Data cleanup continues in the background');
    expect(copy).toContain('does not confirm that every file or record has already been removed');
    expect(copy).toContain('protected recovery storage for up to 30 days');
    expect(copy).toContain('Some older email delivery records may remain after account deletion');
    expect(copy).toContain('Those with a 90-day expiry are removed automatically after that date');
    expect(copy).toContain('This action cannot be undone');
  });
  it('explains campaign sender names, fixed addresses and retesting after sender edits', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'data-and-privacy')!.content;
    expect(copy).toContain('Set **Sender name**');
    expect(copy).toContain('**updates@quantified-self.io**');
    expect(copy).toContain('**Dimitrios <dimitrios@quantified-self.io>**');
    expect(copy).toContain('including only its sender name, clears its earlier test result');
    expect(copy).toContain('Changing only the **internal name** or **sending schedule** keeps the current test approval');
    expect(copy).toContain('sender name, subject, body, formatting, links or button');
    expect(copy).toContain('resume with the existing successful test');
  });
  it('explains the homepage sample and routes visitors to real onboarding rather than a demo account', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'getting-started')!.content;
    expect(copy).toContain('[homepage](/)');
    expect(copy).toContain('fictional sample data');
    expect(copy).toContain('nothing is saved');
    expect(copy).toContain('Provider connections and history imports require Pro');
    expect(copy).toContain("homepage's **Get Started** actions");
    expect(copy).toContain('pricing and eligible trial offers in the membership section');
    expect(copy).toContain('Opening pricing does not start checkout or connect a provider');
    expect(copy).toContain('jump links below its introduction');
    expect(copy).toContain('every feature section visible');
    expect(copy).not.toContain('dropdown');
    expect(copy).toContain('[Comparisons](/#home-comparisons)');
    expect(copy).toContain('Back and Forward');
    expect(copy).toContain('restore the exact place you were reading');
    expect(copy).toContain('homepage view before your first jump');
    expect(copy).toContain("Focus moves to the chosen section's heading, so Tab continues through that section's controls");
    expect(copy).toContain('same category cards and charts as the signed-in workspace');
    expect(copy).toContain('never loads your account data or saves changes');
    expect(copy).not.toContain('/demo');
  });
  it('explains separate destination profiles while retaining recorded and route sport names', () => {
    const uploads = HELP_SECTIONS.find(section => section.id === 'uploads-and-imports')!.content;
    const services = HELP_SECTIONS.find(section => section.id === 'service-connections')!.content;
    expect(uploads).toContain('BMX and LES MILLS RPM / SPRINT / THE TRIP use Garmin Road Cycling, COROS Bike, and Wahoo Cycling');
    expect(uploads).toContain('Vertical Running uses Garmin Trail Running');
    expect(uploads).toContain('Your saved route keeps its original sport name');
    expect(uploads).toContain('Garmin uses Hiking for Mountaineering');
    expect(uploads).toContain('Wahoo uses Other for Offroad Triathlon and Offroad Duathlon');
    expect(services).toContain('Road Cycling and BMX use Cycling');
    expect(services).toContain('AMRAP, EMOM and Tabata use Cardio Class');
    expect(services).toContain('Brick Training, Pool Triathlon, Offroad Triathlon and Offroad Duathlon use Multisport');
    expect(services).toContain('Your QS activity keeps its original sport name');
    expect(services).toContain('separate from route profiles and planned workouts');
  });

  it('explains refined endurance contexts and unsplit combined-sport load', () => {
    const training = HELP_SECTIONS.find(section => section.id === 'training-analysis')!.content;
    expect(training).toContain('Classic Roller Skiing and Skate Roller Skiing use **Nordic Skiing → Roller skiing**');
    expect(training).toContain('Virtual Rowing uses **Rowing → Indoor rowing**');
    expect(training).toContain('Whitewater Kayaking uses **Paddling → Kayaking**');
    expect(training).toContain('An unsplit combined recording keeps its saved event TSS in global load');
    expect(training).toContain('contributes no standalone sport workout');
    expect(training).toContain('QS does not invent legs from the sport name');
  });

  it('explains recorded endurance, aquatic and wheelchair Training classifications', () => {
    const training = HELP_SECTIONS.find(section => section.id === 'training-analysis')!.content;
    expect(training).toContain('Rucking uses **Walking & Hiking → Rucking**');
    expect(training).toContain('Orienteering uses **Running → Orienteering**');
    expect(training).toContain('Ski Orienteering and Biathlon have their own rows within **Nordic Skiing**');
    expect(training).toContain('Fitness Racing and Aqua Fitness use **Fitness & Gym → Conditioning**');
    expect(training).toContain('**Fitness & Gym → Water Running** row with duration and recorded intensity zones');
    expect(training).toContain('**Wheelchair Training** supports Training Mix, Best build and Power systems');
    expect(training).toContain('Walk/Run describes pushing speed');
    expect(training).toContain('every exact sport retains its separate power history');
    expect(training).toContain('twenty-three benchmark families');
    expect(training).toContain('**Wheelchair Training** appears when wheelchair workouts exist');
  });

  it('explains the final 46 approved classifications and their saved-load analysis', () => {
    const training = HELP_SECTIONS.find(section => section.id === 'training-analysis')!.content;
    [...APPROVED_REMAINING_SPORT_CASES.map(item => item.name), ...APPROVED_OTHER_TRAINING_NAMES]
      .forEach(name => expect(training).toContain(name));
    ['**Performance Sports**', '**Outdoor Adventures**', '**Aerial Sports**', '**Motorized Activities**',
      'All 37 newly classified sports', 'saved TSS, including zero', 'zones, distance and durability are omitted',
      'twenty-three benchmark families', 'Training Mix-only capability', 'Planned-workout and provider-delivery mappings stay as previously tested']
      .forEach(phrase => expect(training).toContain(phrase));
    expect(training).not.toContain('such as surfing or sailing, remain visible');
  });

  it('explains all 50 approved sport names and the recorded-only analysis policies', () => {
    const training = HELP_SECTIONS.find(section => section.id === 'training-analysis')!.content;
    for (const name of [
      'Snowshoeing',
      'Bouldering', 'Climbing', 'Rock Climbing', 'Indoor Climbing', 'Via Ferrata',
      'Mountaineering',
      'Ski Touring', 'Ski Mountaineering', 'Backcountry Skiing', 'Backcountry Snowboarding', 'Splitboarding',
      'Alpine Skiing', 'Snowboarding', 'Telemark Skiing',
      'Inline Skating',
      'Skating', 'Ice Skating', 'Skateboarding',
      'Boxing', 'Combat', 'Judo', 'Kickboxing', 'Mixed Martial Arts', 'Taekwondo',
      'Ballet Dancing', 'Ballroom Dancing', 'Dancing', 'Jazz Dancing', 'Latin Dancing', 'Modern Dancing', 'Show Dancing', 'Street Dancing',
      'Basketball', 'Wheelchair Basketball', 'Football', 'Soccer', 'Volleyball', 'Beach Volleyball',
      'Badminton', 'Beach Tennis', 'Padel', 'Pickleball', 'Platform Tennis', 'Racket Sport', 'Racquet Ball', 'Squash', 'Table Tennis', 'Tennis', 'Wheelchair Tennis',

    ]) expect(training).toContain(name);
    expect(training).toContain('**Walking & Hiking → Snowshoeing**');
    expect(training).toContain('The eight zone-enabled additions use power first, then heart rate');
    expect(training).toContain('All 50 newly classified sports omit durability analysis');
    expect(training).toContain('including zero');
    expect(training).toContain('Zones cover the whole recording');
    expect(training).toContain('existing planned-workout and provider-delivery mappings');
    expect(training).toContain('twenty-three benchmark families');
  });

  it('explains all 50 water, team, precision and diving classifications and their approved analysis', () => {
    const training = HELP_SECTIONS.find(section => section.id === 'training-analysis')!.content;
    APPROVED_WATER_TEAM_SPORT_CASES.forEach(item => expect(training).toContain(item.name));
    ['**Precision Sports**', '**Water Sports**', '**Diving**', 'recording elapsed time and saved TSS',
      'Their recorded zones use power first, then heart rate', 'stroke metrics when present',
      'All 50 additional classifications keep their original names', 'including zero, and omit durability analysis',
      'Planned-workout and provider-delivery mappings stay as previously tested', 'twenty-three benchmark families']
      .forEach(phrase => expect(training).toContain(phrase));
  });

  it('explains stair climbing classification and its recorded evidence', () => {
    const training = HELP_SECTIONS.find(section => section.id === 'training-analysis')!.content;
    expect(training).toContain('Floor Climbing uses **Fitness & Gym → Stair Climbing**');
    expect(training).toContain('recorded duration and ascent when available');
    expect(training).toContain('Its intensity uses recorded power zones first, then heart-rate zones');
    expect(training).toContain('Saved TSS stays preserved, including zero, and durability analysis is omitted');
  });

  it('explains the approved strength, conditioning, mobility and equipment memberships', () => {
    const training = HELP_SECTIONS.find(section => section.id === 'training-analysis')!.content;
    expect(training).toContain('Calisthenics, Core Training, LES MILLS CORE and LES MILLS GRIT Strength use **Strength**');
    expect(training).toContain('**Fitness & Gym → Conditioning** includes Bootcamp, Functional Training');
    expect(training).toContain('**Fitness & Gym → Mobility & movement** includes Barre, Mobility, Dynamic Mobility, Static Mobility');
    expect(training).toContain('**Fitness & Gym → General fitness** includes Indoor Skiing, Indoor Grinding and Trucker Workout');
    expect(training).toContain('These groups summarize recorded duration, session counts and saved TSS');
    expect(training).toContain('Your activities keep their original sport names');
  });

  it('points users to the Privacy section and explains saving analytics and email opt-outs', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'data-and-privacy')!.content;
    expect(copy).toContain('[Settings → Privacy & emails](/settings?section=privacy)');
    expect(copy).toContain('turn **Usage analytics** or **Marketing emails** off');
    expect(copy).toContain('**Save changes**');
    expect(copy).toContain('does not stop transactional account or billing messages');
  });
  it('describes the public calendar and profile examples as synthetic and read-only', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'training-plans')!.content;
    expect(copy).toContain('[Training Plans overview](/features/training-plans)');
    expect(copy).toContain('interactive sample calendar, and read-only workout profiles');
    expect(copy).toContain('never load account data or save changes');
  });
  it('explains remembered Plans navigation without changing the active training plan', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'training-plans')!.content;
    expect(copy).toContain('Your last **Plans** or **Standalone** selection is remembered in your account settings');
    expect(copy).toContain('creation screen still open that destination');
    expect(copy).toContain('This does not activate or switch your training plan');
  });
  it('explains exact prescription subtotals, bounded estimates and unknown duration without changing delivery or recorded totals', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'training-plans')!.content;
    for (const phrase of ['## Understand workout totals', '**Workout totals** updates', 'before you save',
      'prompt instead of stale totals', 'profile is collapsed', 'repetition duration stays unknown',
      '**estimated duration range**', 'threshold-speed reference saved',
      'four steps with unknown duration', 'Missing information never counts as zero', 'HR, power, and cadence targets do not establish speed',
      'exact timed-duration requirement', 'separate **workout prescription analysis**', 'client tool-catalog refresh'])
      expect(copy).toContain(phrase);
  });

  it('explains dated follow-ups, fresh evidence and confirmed Training outcomes without promising cross-chat memory', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'ai-insights')!.content;
    for (const phrase of ['message dates and confirmed Training changes', 'Freshly checked records take precedence',
      'not memory across separate chats', 'requested date clear', "not a prediction of tomorrow's sleep",
      'without changing your actual schedule', '**Training review result**', 'accepted sync request is not proof of delivery']) {
      expect(copy).toContain(phrase);
    }
  });
  it('explains accessible interval moves, independent copies, parent boundaries and saving', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'training-plans')!.content;
    for (const phrase of ['**drag handle**', '**Move up**', '**Move down**', '**Duplicate step**',
      '**Duplicate repeat block**', 'move only within that repeat', 'immediately after the original',
      'Plans, Standalone and the Workout library', 'saved only when you save the editor',
      'counting repeat blocks and their steps', 'Strength exercises use their separate editor']) expect(copy).toContain(phrase);
  });
  it('explains explicit duration parts and colon pace without changing canonical units or provider capabilities', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'training-plans')!.content;
    for (const phrase of ['**Hours**, **Minutes**, and **Seconds**', '0 / 1 / 15', '0 / 1 / 30',
      'including inside repeats and in the Workout library', '**m:ss**', '**4:30**',
      'decimal minutes such as 4.5 still work', 'provider-specific delivery limits still apply']) expect(copy).toContain(phrase);
  });
  it('explains Rest duration summaries and limits defaults to untouched new steps', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'training-plans')!.content;
    for (const phrase of ['**Rest for 15 seconds**', '**Rest for 15 minutes**', 'untouched new step',
      'preceding timed Rest duration', 'QS does not invent one', 'Existing, duplicated and manually edited durations stay unchanged',
      'you can still save it', 'first pass through repeat blocks', 'Strength uses its separate editor']) expect(copy).toContain(phrase);
  });
  it('explains Wahoo re-sending after confirmed withdrawal without promising blind recreation or recording deletion', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'training-plans')!.content;
    expect(copy).toContain('After Wahoo confirms withdrawal of an upcoming copy');
    expect(copy).toContain('without reusing its deleted provider Plan');
    expect(copy).toContain('QS shows **Needs attention**');
    expect(copy).toContain('never deletes completed recordings or resets their activity links');
  });
  it('explains the Assistant deletion review and distinguishes authored deletion from service cleanup', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'ai-insights')!.content;
    for (const phrase of ['with both Training change choices on', '**Delete plan**', '**Delete workout**',
      'Workout deletion is recoverable', 'choose whether its workouts stay standalone or are deleted',
      'Older-copy cleanup is optional', 'does not require Pro',
      'not removal from a connected app or watch', 'Completed activities stay untouched']) {
      expect(copy).toContain(phrase);
    }
  });
  it('explains the explicit MCP older-copy cleanup choice without promising provider or watch removal', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'training-plans')!.content;
    expect(copy).toContain('also remove older, uncompleted service copies');
    expect(copy).toContain('Both Training change permissions are required');
    expect(copy).toContain('deletion preview before approval');
    expect(copy).toContain('released and discovered');
    expect(copy).toContain('never deletes recorded activities');
    expect(copy).not.toContain('MCP plan and workout deletion do not select this option');
  });
  it('makes selected-day library discovery and safe placement retry findable in Training Help', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'training-plans')!.content;
    for (const phrase of ['**Add from library**', '**Active**', '**Archived**', '**Show prescription**',
      'exact sport', '**Retry exact placement**', 'keep the review open', 'outside the active plan']) {
      expect(copy).toContain(phrase);
    }
    expect(searchHelpSections(HELP_SECTIONS, 'Add from library').map(section => section.id)).toContain('training-plans');
  });
  it('explains uncertain MCP apply replies without authorizing replacement workouts or approval bypass', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'training-plans')!.content;
    expect(copy).toContain('it may already have applied');
    expect(copy).toContain("check the original proposal's status before retrying");
    expect(copy).toContain('released and discovered by your client');
    expect(copy).toContain('Do not create replacement workouts');
    expect(copy).toContain('replay a declined/cancelled approval elsewhere');
    expect(copy).toContain("Any same-proposal retry must still use the client's approval controls");
    expect(copy).toContain('even within the 25-change limit');
  });
  it('explains bounded Suunto live screens, native sensors/units and watch-controlled boundary alerts', () => {
    const content = HELP_SECTIONS.find(section => section.id === 'training-plans')!.content;
    for (const phrase of ['## Suunto Guide screens and interval alerts', '**block-average pace and current HR**', '**block-average power, current HR, cadence and speed**', '**block-average pace, swimming stroke rate and SWOLF**', '**block-average pace, swimming stroke rate and current HR**',
      '**Avg pwr**', '**Avg strk**', 'Both targets', 'Untargeted steps stay untargeted', 'rowing strokes are not inferred', 'HR stays current',
      'at most five fields', 'Long manual instructions stay text-only', 'Suunto renders native watch units',
      'not guaranteed to match the 500 m split', 'missing readings are unavailable, not zero',
      "Suunto's current manual-lap average", 'not instant readings or the whole-workout average',
      'create recorded laps at automatic step boundaries', 'does not create a duplicate',
      'creates no opening lap', 'resets the displayed average early', 'including HR-only strength Guides',
      'do not prove target adherence', 'including rest/recovery and every repeat', '**Guide complete**',
      'without adding workout time or stopping activity recording', '**your watch settings**',
      'No out-of-target alerts are added', 'approximately 20 seconds',
      'prioritize your notes or exercise/set instructions', '**For 01m 30s**', '**Recover for 30s**', '**Rest for 02m 00s**',
      '**Follow distance countdown**', '**Press lap when ready**', "does not follow your watch's unit settings automatically",
      '**Follow time countdown** rather than rounding or omitting seconds',
      'past and completed copies stay unchanged', 'not proof of watch receipt, sensor readings, alerts or workout completion']) {
      expect(content).toContain(phrase);
    }
  });
  it('explains default native timed-Rest countdown alerts without promising a custom sound pattern', () => {
    const content = HELP_SECTIONS.find(section => section.id === 'training-plans')!.content;
    for (const phrase of ['**Timed Rest countdown alerts**', 'included by default', 'including swimming and strength set rests',
      'no extra QS toggle', "Suunto's native standard countdown", 'watch controls the beep/vibration pattern',
      'long beep at zero is not guaranteed', 'Quiet/tones-off behavior still needs a watch check',
      'Manual or distance-ended Rest, active Recovery, Work, warm-up and cool-down do not gain countdown alerts',
      'QS does not insert extra steps', 'independently of the countdown alert']) expect(content).toContain(phrase);
    expect(content).not.toContain('or extra alarm sequence');
  });
  it('distinguishes authored Suunto targets, measured swimming readings and unsupported ZoneSense', () => {
    const content = HELP_SECTIONS.find(section => section.id === 'training-plans')!.content;
    for (const phrase of ['**Guide targets and readings are different.**',
      'heart-rate, power, speed/pace and cadence targets', 'not an authored stroke-rate target',
      'SWOLF targets are not supported yet', '**ZoneSense targets are not supported in SuuntoPlus Guides**',
      'even if your watch offers ZoneSense in a sport mode', 'reference snapshot saved with your workout'])
      expect(content).toContain(phrase);
    expect(searchHelpSections(HELP_SECTIONS, 'ZoneSense').map(section => section.id)).toContain('training-plans');
  });
  it('explains manual pool progress and rest screens without promising measurement or fixed-position fixes', () => {
    const content = HELP_SECTIONS.find(section => section.id === 'training-plans')!.content;
    for (const phrase of ['**Manual pool-swim work**', '**Swum**', '**Elapsed**', '**Dist rem**', '**Time rem**',
      'previous closed manual lap', 'Active **Recovery** keeps swim readings',
      '**Show swimming Guide screens**', 'cannot guarantee fixed positions', 'do not fix delayed pool-length detection',
      'only in an individual pool or open-water swimming workout', 'not shown for other sports, plan settings or sync history',
      'retain the existing lap-boundary behavior even when a rest screen no longer shows averages']) expect(content).toContain(phrase);
  });
  it('explains swim manual-step timing and native cumulative Rest distance without promising finished-interval statistics', () => {
    const content = HELP_SECTIONS.find(section => section.id === 'training-plans')!.content;
    for (const phrase of ['**pool and open-water swimming**', '**Total**', 'native cumulative distance for the whole recording',
      'not the distance or pace of the last interval', 'Active **Recovery** keeps swim readings',
      '**Swim now. Press Lap to finish this interval.**', '**Rest now. Press Lap to finish this rest.**',
      'Lap finishes the current step, not starts it', 'Older Guides may still say **Press lap when ready**']) expect(content).toContain(phrase);
  });
  it('clarifies manual Suunto transitions across sports without replacing authored or strength instructions', () => {
    const content = HELP_SECTIONS.find(section => section.id === 'training-plans')!.content;
    for (const phrase of ['Manual steps in other supported sports say **Press Lap to finish this interval.**',
      'including warm-up, Work, active Recovery and cool-down', 'manual Rest says **Rest now. Press Lap to finish this rest.**',
      'The step starts immediately', 'persistent **Lap to finish** reminder',
      'prioritize your notes or exercise/set instructions', 'past and completed copies stay unchanged']) expect(content).toContain(phrase);
    expect(content).not.toContain('Other sports and older Guides keep **Press lap when ready**');
  });
  it('explains Rest-first countdown, bounded actual repeats and current versus previous-effort readings', () => {
    const content = HELP_SECTIONS.find(section => section.id === 'training-plans')!.content;
    for (const phrase of ['During Work and active Recovery', 'puts its native countdown first', '**Rest rem**',
      'Your exact duration, targets and notes are kept', 'Work and active Recovery keep their existing readings',
      '**Rest 3/10**', '**Next: Work 4/10**', 'not an inferred distance for a manual interval',
      'Each repeat set has its own count', 'very large Guides keep their existing step structure without counters or Next hints',
      'retain the previous layout when the new labels cannot fit safely', 'Your targets and instructions are never removed',
      'not freshly reset averages or previous-effort statistics', 'not a previous-interval summary',
      'Rowing and strength screen layouts are unchanged', 'Sync your Suunto app and watch']) expect(content).toContain(phrase);
    expect(searchHelpSections(HELP_SECTIONS, 'Rest rem').map(section => section.id)).toContain('training-plans');
  });
  it('explains the app-only Suunto Guide preview without promising new watch behavior', () => {
    const content = HELP_SECTIONS.find(section => section.id === 'training-plans')!.content;
    for (const phrase of ["a Guide's Description includes a readable workout preview", 'steps in order, grouped repeats',
      'your complete step notes', 'exercises, sets, loads and rests', 'app-only text, not a new watch screen',
      'Extremely large previews keep the short description', 'past and completed copies remain unchanged']) expect(content).toContain(phrase);
  });
  it('explains configurable swim screens, planned context and the limited short-rest popup mitigation', () => {
    const content = HELP_SECTIONS.find(section => section.id === 'training-plans')!.content;
    for (const phrase of ['**Save Guide screens**', '**Interval 1/10**', '**Prev plan**/**Next plan**',
      'prescribed, not measured', 'not pool lengths or recorded laps', 'no fake target field',
      'past and completed copies stay unchanged', 'previous closed manual lap', '**m:ss/100m**',
      'removing an average from Work or Rest does not remove automatic laps',
      '**20 seconds or less**', 'does not guarantee an audible or vibrating alert', 'your own Rest instructions still show']) expect(content).toContain(phrase);
  });
  it('explains opt-in previous Work lap readings with truthful lap and phase limits', () => {
    const content = HELP_SECTIONS.find(section => section.id === 'training-plans')!.content;
    for (const phrase of ['**Last Work lap: average pace**', '**Last Work lap: elapsed time**', '**Last Work lap: stroke count**',
      'Rest immediately after Work', 'both a Lap-button ending and an automatic Work ending', 'only its final segment',
      'Existing default choices stay unchanged', 'Consecutive Rest or Rest after another phase',
      'Another Lap recorded without ending Rest changes which lap is shown', 'even below the expanded-screen limit',
      'adds missing lap boundaries at automatic step endings, even without Work averages',
      'Lap-button endings are not duplicated', '1,000-screen limit stays blocked',
      'Rest countdown, targets and your instructions keep priority']) expect(content).toContain(phrase);
    expect(content).not.toContain('completed-interval pace, time, measured distance and stroke count cannot currently be selected');
  });
  it('explains truthful swim field availability, compact headings and safe completed/hidden Guide reuse', () => {
    const content = HELP_SECTIONS.find(section => section.id === 'training-plans')!.content;
    for (const phrase of ['**Rest 1/10**', 'without using a metric slot', 'one compact planned-distance text field', 'at most two numeric readings', 'visibility warning stays beside the choice',
      'saving starts an automatic update check', 'using the existing Guide identity',
      '**Show field availability for this workout**', '**Included**, **Text**, **Heading** or **Omitted**',
      'not guaranteed visible or measured', 'new scheduled copy from your workout library',
      'does not unlock its protected completed Guide', 'never automatically recreates hidden Guides', 'without opening the detailed report',
      'leaving two for extras before instructions', 'Move your most important fields earlier',
      'Warnings for unsupported recipes, compact screens and file-size fallback also stay visible']) expect(content).toContain(phrase);
    for (const phrase of ['**Duplicate to…** in its sync details or workout actions', '**Create another Guide**', '**same QS workout**',
      'earlier Guide untouched', 'duplicates are possible', 'At most eight fresh copies', 'Stop sync affects the current Guide']) expect(content).toContain(phrase);
    expect(content).not.toContain('Repeat on another date');
  });
  it('distinguishes planned Work distances from measured swimming and the repetition counter', () => {
    const content = HELP_SECTIONS.find(section => section.id === 'training-plans')!.content;
    for (const phrase of ['**Last work block: planned distance**', '**Next work block: planned distance**',
      'immediately before this Rest', 'immediately after it', 'Equal-distance repeats show the same value for both',
      'Distances are prescribed, not measured',
      'Lap-only Work has no prescribed distance', 'regardless of titles/notes',
      '**Rest 1/10** follows it', 'not the next repetition or proof',
      "Suunto controls the heading's font size"]) expect(content).toContain(phrase);
    expect(searchHelpSections(HELP_SECTIONS, 'Next work block').map(section => section.id)).toContain('training-plans');
  });
  it('explains pool-only measured SWOLF without target, pool-length or sensor promises', () => {
    const content = HELP_SECTIONS.find(section => section.id === 'training-plans')!.content;
    for (const phrase of ['pool-only **AvgSWOLF**', '**Avg SWOLF** on older Guides', '**SWOLF is a measured reading, not a target.**',
      "your watch's pool-length setting", 'Compare it only within the same pool length and stroke',
      'does not send the selected pool length to Suunto', 'calculate a substitute SWOLF',
      'with current HR for an HR target', 'without SWOLF',
      'requires the updated Functions release']) expect(content).toContain(phrase);
    expect(searchHelpSections(HELP_SECTIONS, 'Avg SWOLF').map(section => section.id)).toContain('training-plans');
    expect(searchHelpSections(HELP_SECTIONS, 'AvgSWOLF').map(section => section.id)).toContain('training-plans');
  });
  it('explains shared horizontal pinch zoom on Event details charts', () => {
    const content = HELP_SECTIONS.find(section => section.id === 'getting-started')!.content;
    expect(content).toContain('In **Zoom** chart mode, pinch with two fingers');
    expect(content).toContain('swipe left or right with one finger to move through the zoomed range');
    expect(content).toContain('same time or distance range appears across the other event charts');
    expect(content).toContain('In **Select** mode, one-finger drags select a range and pinching does not change the chart range');
  });

  it('explains the daily browser cache and targeted daily suggestion status checks', () => {
    const content = HELP_SECTIONS.map(section => section.content).join('\n');
    expect(content).toContain('blocks automatic generation');
    expect(content).toContain('reuses the daily status across navigation and reloads');
    expect(content).toContain('without regenerating an existing suggestion');
    expect(content).toContain('Signing out clears the browser copy');
    expect(content).toContain('**Review** rechecks whether today is already covered');
    expect(content).toContain('This check generates nothing');
    expect(content).toContain('Deleting today’s last planned workout lets QS check again');
    expect(content).toContain('Adding and deleting workouts never resets the daily allowance');
    expect(content).toContain('at any time that day');
    expect(content).toContain('each local day, at any time');
    expect(content).toContain('Your saved time zone defines each day');
    expect(content).not.toContain('5 am and noon');
  });

  it('explains separately consented Timeline-note context for workout suggestions', () => {
    const assistant = HELP_SECTIONS.find(section => section.id === 'ai-insights')?.content;
    expect(assistant).toContain('notes about sickness, injury, travel, or vacation');
    expect(assistant).toContain('Without it the Assistant cannot check notes');
    expect(assistant).toContain('never change calculations, automatically send a workout');
  });

  it('keeps Planning guidance public and searchable', () => {
    const copy = JSON.stringify(HELP_SECTIONS);
    expect(copy).toContain('/training/plans');
    expect(HELP_SECTIONS.some(section => section.id === 'training-plans')).toBe(true);
    expect(HELP_SECTIONS.some(section => section.id === 'training-analysis')).toBe(true);
    expect(HELP_SECTIONS.some(section => section.id === 'plans-and-billing')).toBe(true);
    expect(HELP_SECTIONS.some(section => section.id === 'activity-calendar')).toBe(true);
  });

  it('makes prescription conflict recovery searchable without promising source verification', () => {
    const content = HELP_SECTIONS.find(section => section.id === 'training-plans')!.content;
    expect(searchHelpSections(HELP_SECTIONS, 'Prescription conflict').map(section => section.id)).toContain('training-plans');
    expect(content).toContain('not just rename it or retry');
    expect(content).toContain('saved count, exactly which recipes it verified and any unresolved items separately');
    expect(content).toContain('can remain target-free');
  });

  it('explains the approved Suunto strength/rowing profiles and the scope of unsupported delivery badges', () => {
    const content = HELP_SECTIONS.find(section => section.id === 'training-plans')!.content;
    for (const sport of ['Weight Training', 'Core Training', 'LES MILLS CORE', 'LES MILLS GRIT Strength', 'LES MILLS BODYPUMP',
      'Virtual Rowing', 'Kettlebell', 'Calisthenics']) expect(content).toContain(`**${sport}**`);
    expect(content).toContain('Garmin and Wahoo use their existing Strength/Gym workflows after profile review');
    expect(content).toContain('full-strength delivery to Garmin/Wahoo requires the complete exercise prescription');
    expect(content).toContain('**Interval summary only**; choose **Edit** for the full workout and any saved lifting loads');
    expect(content).toContain('Older interval-only workouts keep their existing previews');
    expect(content).toContain('all normal scheduled-workout reads return a compatibility summary');
    expect(content).toContain('complete-strength preview preserves the sport name on updates');
    expect(content).toContain('The complete-strength preview creates new scheduled workouts as **Strength Training**');
    expect(content).toContain('use the QS editor to create another strength sport');
    expect(content).toContain('Suunto uses native Kettlebell/Calisthenics recommendations');
    expect(content).toContain('The manual interval editor keeps its current sport choices');
    for (const sport of ['Yoga', 'Pilates', 'Stretching', 'Flexibility Training', 'Crossfit', 'Circuit Training', 'Aerobics',
      'Crosstrainer', 'Elliptical Trainer', 'Meditation', 'Breathwork']) expect(content).toContain(`**${sport}**`);
    expect(content).toContain('**Garmin fitness profiles:** **Yoga**, **Pilates** and **Cardio Training**');
    expect(content).toContain('**Wahoo fitness profiles:** **Yoga** and **Elliptical Trainer**');
    expect(content).toContain('app/watch playback has not');
    expect(content).toContain('**Wahoo total duration:**');
    expect(content).toContain('QS keeps exact seconds and does not round or add time');
    expect(content).toContain('**Virtual Rowing** uses **Indoor Rowing** on Suunto and Wahoo, and **Generic** on Garmin');
    expect(content).toContain('Prescribed distances use metric units and pace targets use **500 m splits**, including with imperial distance settings');
    expect(content).toContain('Wahoo accepts only timed steps with no intensity targets');
    expect(content).toContain('describes planned-workout delivery, not whether the service can record that sport or heart rate');
  });

  it('distinguishes standard Suunto strength guidance from additional mapping-loss approval', () => {
    const content = HELP_SECTIONS.find(section => section.id === 'training-plans')!.content;
    expect(content).toContain('rep-based sets require manual transitions');
    expect(content).toContain('not native rep/load tracking');
    expect(content).toContain('no separate approval for each workout or edit');
    expect(content).toContain('Additional mapping losses, such as shortened exercise instructions, still need review');
    expect(content).toContain('Sent Guide status does not prove app/watch receipt or workout completion');
    expect(content).toContain('Suunto load instructions follow your kg or lb choice in **Settings → Units & formatting**');
    expect(content).toContain('QS queues unit changes automatically, usually within a couple of minutes, and updates eligible synced Guides');
    expect(content).toContain('changing units keeps an existing approval only when those losses are unchanged');
  });

  it('explains lap-button endings and their provider and completion boundaries', () => {
    const content = HELP_SECTIONS.find(section => section.id === 'training-plans')!.content;
    expect(content).toContain('**End by -> Lap button press**');
    expect(content).toContain('warmup, work, recovery, cooldown, rest, or other steps');
    expect(content).toContain('including steps inside fixed repeats');
    expect(content).toContain('no time or distance limit');
    expect(content).toContain('not a timer plus a button condition');
    expect(content).toContain('Garmin and Suunto support these manual transitions');
    expect(content).toContain('COROS has the mapping but delivery remains **Coming soon**');
    expect(content).toContain('Wahoo cannot receive lap-ended steps');
    expect(content).toContain('does not stop the recording or mark the QS workout completed');
  });
  it('keeps COROS strength implementation distinct from public Send or delivery proof', () => {
    const content = HELP_SECTIONS.find(section => section.id === 'training-plans')!.content;
    expect(content).toContain('COROS backend maps the complete strength prescription');
    expect(content).toContain('New COROS Send and plan sync remain **Coming soon** pending account-side proof');
    expect(content).toContain('Local compatibility does not mean COROS received the workout or that it reached your watch');
  });
  it('discloses the COROS broad-family folds without advertising additional native or enabled delivery types', () => {
    const content = HELP_SECTIONS.find(section => section.id === 'training-plans')!.content;
    expect(content).toContain('Treadmill, Indoor Running and Virtual Running use the broad Run mapping');
    expect(content).toContain('Mountain Biking, Indoor Cycling, Virtual Cycling, E-Biking, Hand Cycle, Velomobile, Enduro MTB and Downhill Cycling use Bike');
    expect(content).toContain('subtype substitutions need mapping review and keep your authored QS sport');
    expect(content).toContain('Walking, Hiking, Rowing, Indoor Rowing and Open-water swimming have no supported COROS workout-delivery mapping');
    expect(content).toContain('does not make them available through its partner API');
    expect(content).toContain('Local compatibility is not delivery or watch-receipt evidence');
    expect(content).toContain('COROS workout delivery is coming soon');
  });

  it('explains the independent weight preference and canonical weigh-in storage', () => {
    const copy = JSON.stringify(HELP_SECTIONS);
    expect(copy).toContain('Weight input and display use your **Settings → Units & formatting → Customize units → Weight** choice (kg or lb)');
    expect(copy).toContain('saved measurements remain in canonical kg');
    expect(copy).toContain('changing a distance preset does not reset that choice');
  });

  it('records verified Garmin strength delivery without promising every device or exercise', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'training-plans')!.content;
    expect(copy).toContain('Garmin strength mapping preserves individual reps or timed sets, load and rest');
    expect(copy).toContain('verified through cloud create/edit/reschedule/withdrawal and owner-confirmed Garmin Connect/watch checks');
    expect(copy).toContain('does not guarantee every device or exercise');
    expect(copy).not.toContain('live cloud/device verification is pending');
    expect(copy).toContain('Barbell back squat');
    expect(copy).toContain('QS never guesses equipment or substitutes another exercise');
    expect(copy).toContain('Garmin receives loads in kilograms');
    expect(copy).toContain('Wahoo supports timed strength sets and rests as Gym workouts');
    expect(copy).toContain('Repetition sets are unsupported; QS never estimates their duration');
    expect(copy).toContain('not native rep/load tracking');
    expect(copy).toContain('rounded load instructions need mapping approval');
  });

  it('documents regional formatting scope, precedence, and stable export dates', () => {
    const content = HELP_SECTIONS.find(section => section.id === 'data-and-privacy')!.content.replace(/\s+/g, ' ');

    expect(content).toContain('**Settings -> Units & formatting -> Regional formatting**');
    expect(content).toContain('**Automatic (browser)** is the recommended default');
    expect(content).toContain('saved to your account and follows you between devices');
    expect(content).toContain('the app reloads once');
    expect(content).toContain('does not change the app language, timezone, measurement units, start of week');
    expect(content).toContain('**YYYY-MM-DD**');
  });

  it('distinguishes Training consent, expiry, disconnect and provider rollout boundaries', () => {
    const section = HELP_SECTIONS.find(section => section.id === 'training-plans')!;
    const content = section.content;
    expect(section.summary).toContain('approval-gated MCP planning');
    expect(section.summary).toContain('opt-in provider delivery');
    expect(content).toContain('## Use Training Plans through MCP');
    expect(content).toContain('Training Plans uses independent MCP permissions');
    expect(content).toContain('The MCP update must be released, discovered by your client, and explicitly authorized');
    expect(content).toContain('Previewing a change never contacts a provider');
    expect(content).toContain('Retry the same approved proposal to retrieve its result');
    expect(content).toContain('revoke the connection or its Training permission before commit');
    expect(content).toContain('Restoring permission requires a new preview and approval');
    expect(content).toContain('## Send workouts to connected providers');
    expect(section.links.some(link => link.label === 'MCP Connections')).toBe(true);
    expect(section.links.some(link => link.label === 'Connected services')).toBe(true);
    expect(content).toContain('Workout delivery to Garmin, Suunto, and Wahoo is available to connected Pro members');
    expect(content).toContain('COROS plan sync and standalone Send are coming soon');
    expect(content).toContain('Distance-based steps are not sent because Wahoo needs a total duration');
    expect(content).toContain('Running/cycling distance follows your km or mile preference');
    expect(content).toContain('Older Wahoo connections may need **Reconnect Wahoo**');
    expect(content).toContain('Checks confirm the app-owned Plan, Workout and association; automatic missing-copy restoration is unavailable');
    expect(content).toContain('COROS workout delivery is coming soon');
    expect(content).toContain('Plan sync, plan-workout resume, and standalone Send are not available yet');
    expect(content).toContain('COROS training calendar');
    expect(content).toContain('two-week watch window');
    expect(content).toContain('remote checking and automatic missing-copy restoration are unavailable');
    expect(content).toContain('These cosmetic adjustments happen automatically');
    expect(content).toContain('requests removal of its prior Guide');
    expect(content).not.toContain('removes its old Guide');
    expect(content).toContain('**Not sent · Needs review**');
    expect(content).toContain('**Exclude from plan sync**');
    expect(content).toContain('Opening Review never sends or approves anything by itself');
    expect(content).toContain('Older connections may need this even when activity imports work');
    expect(content).toContain('Stopping workout sync keeps your connected account');
    expect(content).toContain('If you separately disconnect the service or delete your Quantified Self account');
    expect(content).toContain('workouts already sent may remain');
    expect(content).toContain('Disconnecting turns off workout sync for that connection; reconnecting does not turn it back on');
    expect(content).not.toContain('Stop sync before disconnecting');
    expect(content).toContain('content, not old sync consent');
    expect(content).toContain('Pro expiry pauses creates and updates');
    expect(content).toContain('IANA time zone');
    expect(content).toContain('**Sync plan with Garmin**');
    expect(content).toContain('**Enable plan sync**');
    expect(content).toContain('**Workout sync status**');
    expect(content).toContain('**Loading sync settings** is not **Sync off**');
    expect(content).toContain('do not enable sync again just to refresh the display');
    expect(content).toContain('reads the latest saved revisions without changing consent');
    expect(content).toContain('confirmation is disabled; cancel and review the latest version');
    expect(content).toContain('retry that same confirmation to check the original request');
    expect(content).toContain("each service's logo and a compact sent/total count for Suunto");
    expect(content).toContain('**No workouts due for sync** instead of showing dashes');
    expect(content).toContain('small **View** action');
    expect(content).toContain('whether sync is enabled for each service');
    expect(content).toContain('one **Manage** action');
    expect(content).toContain('**All services** returns to the service overview');
    expect(content).toContain('These navigation actions do not enable sync or send anything');
    expect(content).toContain('individual workouts, not plans or edits');
    expect(content).toContain('**All 3 upcoming workouts synced · 2 earlier workouts**');
    expect(content).toContain("Suunto's **All 3 upcoming workouts sent · 2 earlier workouts**");
    expect(content).toContain('prioritizes today and future workouts');
    expect(content).toContain('Older-account copies do not count as current delivery');
    expect(content).toContain('not delivery to a device');
    expect(content).toContain('**Stop plan sync**');
    expect(content).toContain('**Stop workout sync**');
    expect(content).toContain('there is no separate Preview step');
    expect(content).toContain('Existing settings open with **Save changes** disabled');
    expect(content).toContain('The overview has only **Close**');
    expect(content).not.toContain('**Use time zone**');
    expect(content).toContain('**Show attempt details**');
    expect(content).toContain('compact, scrollable **Revision history**');
    expect(content).toContain('**Training** permission');
    expect(content).not.toMatch(/Workout Import|WORKOUT_IMPORT/);
    expect(content).toContain('Retry may still require support');
  });
  it('explains manual activity range presets, local dates and confirmation', () => {
    const copy = HELP_SECTIONS.find(section => section.id === 'service-connections')!.content;
    for (const phrase of ['**Activity history range**', '**All available history**', '**Custom dates**',
      'your local calendar days', 'confirm again after changing them', 'one day per 500 activities scheduled',
      'not a processing-time estimate']) expect(copy).toContain(phrase);
  });

  it('explains the category overview, recorded source choices and manual history actions', () => {
    const health = HELP_SECTIONS.find(section => section.id === 'health')!.content;
    for (const phrase of ['**Category overview**', 'last 30 days', '**Body**', '**Vitals**', '**Movement & energy**',
      '**Recovery & sleep**', '**Fitness**', '**View history**', '**Back to overview**', 'manual and synced readings separate',
      'only manual rows can be edited or deleted', 'not training targets']) expect(health).toContain(phrase);
    expect(health).toContain('**All** starts with **Your recent Health** in this order');
    expect(health).toContain('**Your recovery** appears above the existing metrics');
    expect(health).toContain('Dashboard **Today** uses a compact **At a glance** instead: one sentence');
    expect(health).toContain('It continues your greeting as one sentence, with each assessment phrase in its own status color and no separate line, status dot or card');
    expect(health).not.toContain('At a glance is currently hidden');
    expect(health).toContain('does not consume your AI quota');
    expect(health).toContain('A green phrase stays green when another phrase needs attention');
    expect(health).toContain('On Health, comparison counts and outside-range readings stay visible');
    expect(health).toContain('Dashboard **At a glance** continues the greeting in one sentence');
    expect(health).toContain('Missing or unavailable evidence takes priority over a reassuring HRV result');
    expect(health).toContain('Select the sentence to show or hide Today’s Training state, Readiness, scores and supporting context');
    expect(health).toContain('those details start open alongside the sentence');
    expect(health).toContain('including **Mixed** and **Recover** days');
    expect(health).toContain('sentence opens the existing **Today** details');
    expect(health).toContain('existing Readiness, training load, Sleep, HRV and overnight HR assessments');
    expect(health).toContain('not daily resting HR');
    expect(health).toContain('no new sleep-score threshold is added');
    expect(health).toContain('**Show details** to see the source');
    expect(health).toContain('not an assessment of every chart');
    expect(health).toContain('Loading, failed or incomplete reads are never treated as normal');
    expect(health).toContain('Your saved Dashboard charts stay visible and unchanged');
    expect(health).toContain('**seven-day average** separately from the **latest nightly reading**');
    expect(health).toContain('**Multiple recorded sources** rather than borrowing a source selected in another chart');
    expect(health).toContain('Sleep and HRV count toward these six and are not repeated');
    expect(health).toContain('Moderate and vigorous intensity durations belong to **Movement & energy**, not the default All view');
    expect(health).toContain('**Sleep → HRV → Resting heart rate → VO₂ max → Weight → Steps**');
    expect(health).toContain('missing metrics leave fewer cards');
    expect(health).toContain('Default cards without readings in the last 30 days disappear after loading');
    expect(health).toContain('Unavailable saved sources and incomplete or failed loads stay visible');
    expect(health).toContain('new readings can restore an omitted card');
    expect(health).toContain('Default cards cover 30 days, HRV covers 14');
    expect(health).toContain('Your explicit overview choice is saved per metric');
    expect(health).toContain('Missing or filtered saved choices stay unavailable');
    expect(health).toContain('heart and recovery use shorter gaps');
    expect(health).toContain('monthly fitness estimates');
    expect(health).toContain('**Two readings, not a trend.**');
    expect(health).toContain('Exactly two comparable numeric readings from one source');
    expect(health).toContain('recorded-local times distinguish readings on the same day');
    expect(health).not.toContain('Overview source choices stay local');
    expect(health).toContain('Default cards cover 30 days, HRV covers 14');
    expect(health).toContain('**Automatic source selection** considers usable readings, freshness, and distinct days of coverage');
    expect(health).toContain('All zeros remain available');
    expect(health).toContain('explicit choices remain selected');
    expect(health).toContain('Automatic choices may update after sync');
    expect(health).toContain('**Vitals** replaces its general Heart rate card with today’s highlight');
    expect(health).toContain('with today’s highlight when readings exist');
    expect(health).toContain('Other categories show cards without highlights');
    expect(health).toContain('Highlights remain on the overview');
    expect(health).toContain('restores cards, category and scroll position');
    expect(health).toContain('Switching metrics starts at the top');
    expect(health).toContain('filtering or refreshing does not reset scroll');
    expect(health).not.toContain("detailed charts, Highlights, and **Source observations**");
  });
  it('explains the Health metric title picker on both layouts and remembered selection', () => {
    const health = HELP_SECTIONS.find(section => section.id === 'health')?.content;
    expect(health).toContain('Tap the metric title and arrow');
    expect(health).toContain('closing the picker or choosing the current metric adds none');
    expect(health).toContain('History uses the full workspace width');
    expect(health).toContain('Metric and range are saved to your account');
    expect(health).toContain('**Back** and **Forward** revisit metrics or the overview');
    expect(health).toContain('retaining your inspected dates and source filters');
    expect(health).toContain('closing the picker or choosing the current metric adds none');
  });
  it('makes optional full-text notes access discoverable without implying chart visibility is consent', () => {
    const content = HELP_SECTIONS.map(section => section.content).join(' ');
    expect(content).toContain('**Timeline notes** is an independent read permission');
    expect(content).toContain('Both permissions are selected by default when requested; uncheck either before approving.');
    expect(content).toContain('**Change Timeline notes** is a separate child permission');
    expect(content).toContain('Every requested permission starts checked, including permissions added later');
    expect(content).toContain('It is off by default. Changing optional access starts a fresh chat');
    expect(content).toContain('full private');
    expect(content).toContain('hidden from charts');
    expect(searchHelpSections(HELP_SECTIONS, 'Timeline notes').map(section => section.id))
      .toEqual(expect.arrayContaining(['ai-insights', 'data-and-privacy']));
  });
  it('explains independent Training read and approval-gated change access without expanding Assistant access', () => {
    const content = HELP_SECTIONS.map(section => section.content).join(' ');
    expect(content).toContain('**Training planning (optional):**');
    expect(content).toContain('Gemini can prepare one bounded proposal but cannot apply it');
    expect(content).toContain('disable Training write tools while using Research');
    expect(content).toContain('resets Training permissions off');
    expect(content).toContain('the workout exists in the connected app, not that it reached a watch');
  });
  it('explains private notes in both workspaces and makes their context searchable', () => {
    for (const id of ['health', 'training-analysis']) {
      const content = HELP_SECTIONS.find(section => section.id === id)?.content;
      expect(content).toContain('## Timeline notes');
      expect(content).toContain('small **Sickness noted** link');
      expect(content).toContain('**Low training load** instead of **Ready to train**');
      expect(content).toContain('ongoing notes must already have started');
      expect(content).toContain('Notes never change your measurements, readiness, or forecasts');
      expect(content).toContain('notes appear on the Highlights trend charts');
      expect(content).toContain('Choose a **Color**');
      expect(content).toContain('**Default** uses the same neutral gray in lists, charts, and Calendar');
      expect(content).toContain('calendar buttons to pick dates');
      expect(content).toContain('Date ranges have start and end arrows');
      expect(content).toContain('ongoing shading stops at today');
      expect(content).toContain('inside the shaded band to inspect your measurements');
    }
    expect(searchHelpSections(HELP_SECTIONS, 'Timeline notes').map(section => section.id)).toEqual(expect.arrayContaining(['health', 'training-analysis']));
    const calendar = HELP_SECTIONS.find(section => section.id === 'activity-calendar')?.content;
    expect(calendar).toContain('Activity tags appear beneath each activity name');
    expect(calendar).toContain('All tags stay visible and wrap on narrow screens');
    expect(calendar).toContain('a slim colored tick on the right marks days');
    expect(calendar).toContain('notes and their individual colors');
    expect(calendar).toContain('the Today mini-calendar, a slim colored tick on the right marks days');
    expect(calendar).toContain('Week and Year keep their note icons');
    expect(calendar).toContain('Activity circles keep their own colors');
    expect(calendar).toContain('Show on charts and calendar');
    expect(calendar).toContain('The **Today** card opens a compact month calendar');
    expect(calendar).toContain('use sport icons for planned workouts and completed activities');
    expect(calendar).toContain('the sheet hides completed-activity totals and sections');
    expect(calendar).toContain('Activity loading and errors are still labeled');
    expect(calendar).toContain('workout rows navigation-only, without copy buttons');
    expect(calendar).toContain('Duplication remains available in **Plans**, the full day page, and selected-day previews');
    expect(calendar).toContain('one plan/status metadata line; tap a workout to read its steps');
    expect(calendar).toContain('same compact **Training impact** summary as Calendar and Dashboard previews');
    expect(calendar).toContain('Separate UTC-day outcomes and missing-data warnings stay explicit');
    expect(calendar).toContain('Impact text wraps on narrow screens so outcome values and unavailable reasons remain readable');
    expect(calendar).toContain("offers **Dashboard** to return when opened from the dashboard tile or Today's mini-calendar");
    const dashboard = HELP_SECTIONS.find(section => section.id === 'getting-started')?.content;
    expect(dashboard).toContain('HRV, Sleep, Form, and Freshness Forecast show the same note markers');
    expect(dashboard).toContain('shared profiles and chart-library previews do not include them');
    expect(CONNECTED_SERVICES_POLICY_SECTION.content.join(' ')).toContain('content-free deletion receipt');
  });
  it('documents the supported activity catalog without overpromising source data', () => {
    const supportedActivitiesSection = HELP_SECTIONS.find(section => section.id === 'supported-activities');

    expect(supportedActivitiesSection?.content).toContain('[Supported activity types page](/features/supported-activities)');
    expect(supportedActivitiesSection?.content).toContain('## What you see when you open an activity');
    expect(supportedActivitiesSection?.content).toContain('We do not add missing information.');
    expect(supportedActivitiesSection?.content).toContain('Swim Lengths** when the data includes individual pool lengths');
    expect(supportedActivitiesSection?.content).toContain('Jumps** when the activity includes jump events');
    expect(supportedActivitiesSection?.content).toContain('running flight time');
    expect(supportedActivitiesSection?.content).toContain('contact-time-to-flight-time ratio');
    expect(supportedActivitiesSection?.content).toContain('summaries under **Performance** when available');
    expect(supportedActivitiesSection?.content).toContain('Boating is listed in Motorized but can use sailing-oriented charts');
    expect(supportedActivitiesSection?.content).toContain('Wheel Chair is listed in Adaptive Mobility but can use cycling-oriented charts');
    expect(supportedActivitiesSection?.content).toContain('We do not estimate or fill in missing dive data.');
    expect(supportedActivitiesSection?.links).toContainEqual({
      label: 'Supported activity types',
      icon: 'category',
      kind: 'route',
      target: '/features/supported-activities',
    });
  });

  it('should expose the expected ordered section ids', () => {
    expect(HELP_SECTIONS.map(section => section.id)).toEqual<HelpSectionId[]>([
      'getting-started',
      'supported-activities',
      'activity-calendar',
      'training-plans',
      'health',
      'training-analysis',
      'post-workout-reflections',
      'ai-insights',
      'plans-and-billing',
      'uploads-and-imports',
      'service-connections',
      'data-and-privacy',
      'troubleshooting',
    ]);
  });

  it('should define thirteen unique sections with complete content', () => {
    expect(HELP_SECTIONS).toHaveLength(13);

    const uniqueIds = new Set(HELP_SECTIONS.map(section => section.id));
    expect(uniqueIds.size).toBe(HELP_SECTIONS.length);

    HELP_SECTIONS.forEach(section => {
      expect(section.title.trim().length).toBeGreaterThan(0);
      expect(section.summary.trim().length).toBeGreaterThan(0);
      expect(section.icon.trim().length).toBeGreaterThan(0);
      expect(section.content.trim().length).toBeGreaterThan(0);
      expect(section.links.length).toBeGreaterThan(0);

      section.links.forEach(link => {
        expect(link.label.trim().length).toBeGreaterThan(0);
        expect(link.icon.trim().length).toBeGreaterThan(0);
        expect(link.target.trim().length).toBeGreaterThan(0);
      });
    });
  });

  it('makes reflection help discoverable and explains its independent privacy and deletion boundaries', () => {
    const section = HELP_SECTIONS.find(value => value.id === 'post-workout-reflections')!;
    expect(searchHelpSections(HELP_SECTIONS, 'post-workout reflection').map(value => value.id)).toContain(section.id);
    for (const phrase of ['**Cancel** writes nothing', 'private even when the recording is public',
      '**Edit details** in the summary actions', '**Save changes** once', '**Keep reflection** cancels that deletion',
      'one **RPE** input for the **whole recording**', 'There is no separate reflection rating',
      'event details and the note cannot be partially saved',
      'on for fresh and New chats', 'cannot erase text a client already received or quoted']) {
      expect(section.content).toContain(phrase);
    }
    expect(HELP_SECTIONS.find(value => value.id === 'ai-insights')!.content)
      .toContain('Manual Health measurements and Private workout reflections on; other optional access off');
    expect(section.content).not.toContain('Private reflection effort');
    expect(HELP_SECTIONS.map(value => value.content).join('\n')).not.toContain('reflection effort/text');
  });

  it('documents the source-separated Health workspace and its bounded metric explorer', () => {
    const healthSection = HELP_SECTIONS.find(section => section.id === 'health');

    expect(healthSection?.title).toBe('Health');
    expect(HELP_SECTIONS.some(section => section.content.includes('at least 90% coverage with no gap over five minutes'))).toBe(true);
    expect(HELP_SECTIONS.some(section => section.content.includes('QS-calculated Garmin sleep-window heart rate'))).toBe(true);
    expect(healthSection?.content).toContain('**Retrying** means a temporary sync error is being retried automatically');
    expect(healthSection?.content).toContain('automatic retries are exhausted or the job cannot be retried');
    expect(healthSection?.content).toContain('not the failed attempt time');
    expect(healthSection?.content).toContain('**Sources** beside the Health title');
    expect(healthSection?.content).toContain('filter Highlights and every metric');
    expect(healthSection?.content).toContain('compact range dropdown between the older/newer arrows');
    expect(healthSection?.content).toContain('a source with no readings does not silently switch');
    expect(healthSection?.content).not.toContain('**View options**');
    expect(healthSection?.content).toContain('**Resting heart rate · 30d**');
    expect(healthSection?.content).toContain('**Read Heart rate charts by their time period.**');
    expect(healthSection?.content).toContain('**Choose the measurement, then the source.**');
    expect(healthSection?.content).toContain("Opening **View history** keeps the card's selected reading and source");
    expect(healthSection?.content).toContain('does not import a separate Suunto resting-HR value');
    expect(healthSection?.content).toContain('**Coverage belongs to each chart.**');
    expect(healthSection?.content).toContain('**Heart-rate chart details.**');
    expect(healthSection?.content).toContain('Suunto supplies the average HR for each short recording period');
    expect(healthSection?.content).toContain('**Recording details** explains how the source recorded it');
    expect(healthSection?.content).toContain('**Compare sources**');
    expect(healthSection?.content).toContain('**More measurements**');
    expect(healthSection?.content).toContain('**Latest daily average**');
    expect(healthSection?.content).toContain('not another Suunto feed');
    expect(healthSection?.content).toContain('An existing secondary selection stays visible');
    expect(healthSection?.content).toContain('**Hide comparison**');
    expect(healthSection?.content).toContain('Missing readings and unknown completeness stay visible');
    expect(healthSection?.content).toContain('giving each reading equal weight');
    expect(healthSection?.content).toContain('**not the day\'s true heart-rate extremes**');
    expect(healthSection?.content).toContain('names the omitted source, returns an older saved 1-year selection to 90 days');
    expect(healthSection?.content).toContain('**Calculated by QS**');
    expect(healthSection?.content).toContain('metrics found anywhere in your imported history');
    expect(healthSection?.content).toContain('Weight and VO₂ max also remain available');
    expect(healthSection?.content).toContain('**Add measurement** at the top of Health');
    expect(healthSection?.content).toContain('Weight, VO₂ max, Blood pressure, Body fat, Muscle mass, Body water, Bone mass, or Blood oxygen (SpO₂)');
    expect(healthSection?.content).toContain('body fat and body water are percentages');
    expect(healthSection?.content).toContain('not muscle percentages or bone-density scores');
    expect(healthSection?.content).toContain('both readings and any pulse saved with them');
    expect(healthSection?.content).toContain('zero and negative readings cannot be saved');
    expect(healthSection?.content).toContain('Leave optional pulse empty if it was not measured');
    expect(healthSection?.content).toContain('edit or delete your own manual rows');
    expect(healthSection?.content).toContain('**Weight from workouts is fallback profile context, not a weigh-in.**');
    expect(healthSection?.content).toContain('no real provider or manual Health Weight measurement');
    expect(healthSection?.content).toContain('never plotted as a weigh-in');
    expect(healthSection?.content).toContain('**Workout VO₂ max is separate evidence.**');
    expect(healthSection?.content).toContain('never merges them with provider Health or manual VO₂ max');
    expect(healthSection?.content).toContain('**Garmin Health summary** and **Garmin workout VO₂**');
    expect(healthSection?.content).toContain('instead of implying that another Garmin account is connected');
    expect(healthSection?.content).toContain('not copied into Health storage');
    expect(healthSection?.content).toContain('omits workout IDs, names, locations, account IDs, and raw creator details');
    expect(healthSection?.content).toContain('Sleep appears when a recorded Sleep session exists');
    expect(healthSection?.content).toContain('14-day trend for each source');
    expect(healthSection?.content).toContain('at least three readings');
    expect(healthSection?.content).toContain('60-day personal range');
    expect(healthSection?.content).toContain('Range on this date');
    expect(healthSection?.content).toContain('dates without enough baseline history stay unshaded');
    expect(healthSection?.content).toContain('band continues across missing-reading days');
    expect(healthSection?.content).toContain('Until 14 nights exist');
    expect(healthSection?.content).toContain('seven-day average with at least three recent nights');
    expect(healthSection?.content).toContain('within, outside, or far outside');
    expect(healthSection?.content).toContain('color is never the only signal');
    expect(healthSection?.content).toContain('average or overnight HRV');
    expect(healthSection?.content).toContain('even if no standalone Health HRV record exists');
    expect(healthSection?.content).toContain('show average and overnight HRV available only in your sleep history');
    expect(healthSection?.content).toContain('never averaged with other HRV measurements');
    expect(healthSection?.content).toContain('same Sleep reading is already shown');
    expect(healthSection?.content).toContain('show the matching reading once under the same connected account');
    expect(healthSection?.content).toContain('Independently recorded Sleep HRV remains separate');
    expect(healthSection?.content).toContain('Health and Sleep availability are checked independently');
    expect(healthSection?.content).toContain('a failed check leaves that domain unfiltered');
    expect(healthSection?.content).toContain('Use **1d**, **14d**, **30d**, or **90d** for detailed readings');
    expect(healthSection?.content).toContain('**1y** remains available for readings with daily summaries');
    expect(healthSection?.content).toContain('identifies **Today**, **Yesterday**, or the inspected date');
    expect(healthSection?.content).toContain('Metric and range are saved to your account');
    expect(healthSection?.content).toContain('inspected dates and provider filters remain local');
    expect(healthSection?.content).toContain('never creates a cross-provider headline average');
    expect(healthSection?.content).toContain('**Choose a Highlight source.**');
    expect(healthSection?.content).toContain('**Today’s heart rate**');
    expect(healthSection?.content).toContain('**Today’s heart rate** appears in **Vitals**');
    expect(healthSection?.content).toContain('the general Heart rate card remains available in Vitals');
    expect(healthSection?.content).toContain('whole highlight is hidden when none do');
    expect(healthSection?.content).toContain('not a live sensor feed');
    expect(healthSection?.content).toContain('remembered separately for each highlight in your account settings');
    expect(healthSection?.content).toContain('without overwriting your saved choice');
    expect(healthSection?.content).toContain('or substituting another source’s chart');
    expect(healthSection?.content).toContain('**Retry** from both overview and history');
    expect(healthSection?.content).not.toContain('or saves a preferred source');
    expect(healthSection?.content).toContain('local labels such as **Garmin account 1**');
    expect(healthSection?.content).toContain('**1y** remains available for readings with daily summaries, including QS-calculated Heart rate summaries');
    expect(healthSection?.content).toContain('A one-day view does not imply continuous recording');
    expect(healthSection?.content).toContain('your recorded Sleep sessions');
    expect(healthSection?.content).toContain('Expand **Recorded readings**');
    expect(healthSection?.content).toContain('**Sources** sheet shows each provider\'s recency');
    expect(healthSection?.content).toContain('Connectivity** for connection and import management');
    expect(healthSection?.content).not.toContain('**Import history**');
    expect(healthSection?.content).toContain('Connectivity');
    expect(healthSection?.content).toContain('**Health (Beta)**');
    expect(healthSection?.content).toContain('available to all signed-in users');
    expect(healthSection?.content).not.toContain('URL retains the metric');
    expect(HELP_SECTIONS.flatMap(section => section.links).some(link => link.target === '/health')).toBe(false);
  });

  it('should explain automatic retry for incomplete Suunto activity files', () => {
    const troubleshootingSection = HELP_SECTIONS.find(section => section.id === 'troubleshooting');

    expect(troubleshootingSection?.content).toContain(
      'If Suunto temporarily returns an incomplete activity file, Quantified Self validates it and retries automatically',
    );
  });

  it('should document the bounded MCP-backed Assistant and external MCP alternative', () => {
    const assistantSection = HELP_SECTIONS.find(section => section.id === 'ai-insights');

    expect(assistantSection?.title).toBe('Assistant');
    expect(assistantSection?.content).toContain('Every current answer must use at least one verified Quantified Self tool result');
    expect(assistantSection?.content).toContain('Expand **Data used**');
    expect(assistantSection?.content).toContain("browser's IANA timezone");
    expect(assistantSection?.content).toContain('Direct in-app URLs are withheld');
    expect(assistantSection?.content).toContain('opaque reference or cursor is rejected');
    expect(assistantSection?.content).toContain('latest six completed turns');
    expect(assistantSection?.content).toContain('refresh while an answer is in progress');
    expect(assistantSection?.content).toContain('account-bound, bounded question and request metadata');
    expect(assistantSection?.content).toContain('different signed-in account cannot restore');
    expect(assistantSection?.content).toContain('safely resends the same request ID');
    expect(assistantSection?.content).toContain('becomes unavailable about **seven days**');
    expect(assistantSection?.content).toContain('at most four extra minutes');
    expect(assistantSection?.content).toContain('deletes the expired record asynchronously');
    expect(assistantSection?.content).toContain('coordinate-free by default');
    expect(assistantSection?.content).toContain('**Precise activity locations**');
    expect(assistantSection?.content).toContain('exact activity start/end and MTB jump coordinates');
    expect(assistantSection?.content).toContain('Assistant maps have their own saved style');
    expect(assistantSection?.content).toContain('switch between Default, Satellite, and Outdoors in place');
    expect(assistantSection?.content).toContain('displayed geographic area to Mapbox');
    expect(assistantSection?.content).toContain('constructs all plotted values, coordinates, labels, and renderer settings deterministically');
    expect(assistantSection?.content).toContain('Changing this setting starts a new chat');
    expect(assistantSection?.content).toContain('route geometry');
    expect(assistantSection?.content).toContain('ranks the matching Mountain Biking activities');
    expect(assistantSection?.content).toContain('instead of comparing jump counts');
    expect(assistantSection?.content).toContain('identity-free **Training impact**');
    expect(assistantSection?.content).toContain("latest completed workout and yesterday's training");
    expect(assistantSection?.content).toContain('A local date can have two UTC outcomes');
    expect(assistantSection?.content).toContain('not measured physiological adaptation');
    expect(assistantSection?.content).toContain('Use [Connections -> MCP](/services?serviceName=mcp)');
    expect(assistantSection?.links).toContainEqual({
      label: 'MCP Connections',
      icon: 'devices',
      kind: 'route',
      target: '/services',
      queryParams: { serviceName: 'mcp' },
    });
  });

  it('should document the ChatGPT MCP setup path and production endpoint', () => {
    const dataAndPrivacySection = HELP_SECTIONS.find(section => section.id === 'data-and-privacy');

    expect(dataAndPrivacySection?.content).toContain('**Complete account setup**');
    expect(dataAndPrivacySection?.content).toContain('same request for review and explicit approval; it does not grant access');
    expect(dataAndPrivacySection?.content).toContain('**Deny** without completing setup');
    expect(dataAndPrivacySection?.content).toContain('If the request expires during setup, start authorization again');
    expect(dataAndPrivacySection?.content).toContain('Use with ChatGPT');
    expect(dataAndPrivacySection?.content).toContain('Developer mode');
    expect(dataAndPrivacySection?.content).toContain('https://quantified-self.io/mcp');
    expect(dataAndPrivacySection?.content).toContain('recommended [256 x 256 PNG (9.4 KB)]');
    expect(dataAndPrivacySection?.content)
      .toContain('/assets/favicons/quantified-self-chatgpt-icon-256x256.png');
    expect(dataAndPrivacySection?.content).toContain('preferred minimum dimensions');
    expect(dataAndPrivacySection?.content).toContain('10 KB upload limit');
    expect(dataAndPrivacySection?.content).toContain('one-call sleep trend');
    expect(dataAndPrivacySection?.content).toContain('preferred daily report');
    expect(dataAndPrivacySection?.content).toContain('latest completed non-nap sleep');
    expect(dataAndPrivacySection?.content).toContain('average/overnight HRV');
    expect(dataAndPrivacySection?.content).toContain('average/minimum sleep heart rate');
    expect(dataAndPrivacySection?.content).toContain('current-versus-usual equivalent 28-day Training totals');
    expect(dataAndPrivacySection?.content).toContain('same live UTC-day Readiness used by Dashboard Today');
    expect(dataAndPrivacySection?.content).toContain('seven-day HRV average and same-source 60-day personal range');
    expect(dataAndPrivacySection?.content).toContain('processing-bounded all-history scan');
    expect(dataAndPrivacySection?.content).toContain('parent event tags');
    expect(dataAndPrivacySection?.content).toContain('exact case-insensitive tag matches');
    expect(dataAndPrivacySection?.content).toContain('personal, health, or location context');
    expect(dataAndPrivacySection?.content).toContain('untrusted labels');
    expect(dataAndPrivacySection?.content).toContain('Existing clients missing a required grant must reauthorize');
    expect(dataAndPrivacySection?.content).toContain('Editing the shared description additionally requires');
    expect(dataAndPrivacySection?.content).toContain('separate default-off Activity tag changes choice');
    expect(dataAndPrivacySection?.content).toContain('Oversized rankings fail');
    expect(dataAndPrivacySection?.content).toContain('jump count is not treated as jump quality');
    expect(dataAndPrivacySection?.content).toContain('request identity-safe **Training impact**');
    expect(dataAndPrivacySection?.content).toContain('up to 32 exact activity references');
    expect(dataAndPrivacySection?.content).toContain('never per-session day rows');
    expect(dataAndPrivacySection?.content).toContain('adds no write access or provider action');
    expect(dataAndPrivacySection?.content).toContain('missing or insufficient-history states');
    expect(dataAndPrivacySection?.content).toContain('today’s Readiness drivers');
    expect(dataAndPrivacySection?.content).toContain('daily report with sleep HRV and sleep heart rate');
    expect(dataAndPrivacySection?.content).toContain('[**Connections -> MCP**](/services?serviceName=mcp)');
    expect(dataAndPrivacySection?.content).toContain('### If an MCP permission is missing');
    expect(dataAndPrivacySection?.content).toContain('Missing tools do not mean you have no plans, workouts, or recorded data.');
    expect(dataAndPrivacySection?.content).toContain('**Training plans and planned workouts**');
    expect(dataAndPrivacySection?.content).toContain('For completed-session or local-day Training impact');
    expect(dataAndPrivacySection?.content).toContain('Do not disconnect an app just to add a permission.');
    expect(dataAndPrivacySection?.content).toContain('**Quantified Self** -> **Reconnect**');
    expect(dataAndPrivacySection?.content).toContain('Uninstall and reinstall is a last resort');
    expect(dataAndPrivacySection?.content).toContain('The built-in Assistant is separate');
    expect(dataAndPrivacySection?.content).toContain('### Android authorization handoff');
    expect(dataAndPrivacySection?.content).toContain('**Open supported links**');
    expect(dataAndPrivacySection?.content).toContain('cannot force Android or the ChatGPT app');
    expect(dataAndPrivacySection?.content).toContain('[MCP Server feature page](/features/mcp-server)');
    expect(dataAndPrivacySection?.content).toContain('[Privacy Policy](/privacy)');
    expect(dataAndPrivacySection?.content).toContain('[Terms of Service](/terms)');
    expect(dataAndPrivacySection?.links).toContainEqual({
      label: 'MCP Server',
      icon: 'devices',
      kind: 'route',
      target: '/features/mcp-server',
    });
    expect(dataAndPrivacySection?.links).toContainEqual({
      label: 'MCP Connections',
      icon: 'devices',
      kind: 'route',
      target: '/services',
      queryParams: { serviceName: 'mcp' },
    });
    expect(dataAndPrivacySection?.links).toContainEqual({
      label: 'Privacy Policy',
      icon: 'lock_outline',
      kind: 'route',
      target: '/privacy',
    });
    expect(dataAndPrivacySection?.links).toContainEqual({
      label: 'Terms of Service',
      icon: 'gavel',
      kind: 'route',
      target: '/terms',
    });
  });

  it('should expose four unique global support actions', () => {
    expect(HELP_ACTIONS).toHaveLength(4);

    const uniqueIds = new Set(HELP_ACTIONS.map(action => action.id));
    expect(uniqueIds.size).toBe(HELP_ACTIONS.length);

    HELP_ACTIONS.forEach(action => {
      expect(action.label.trim().length).toBeGreaterThan(0);
      expect(action.icon.trim().length).toBeGreaterThan(0);
      expect(action.target.trim().length).toBeGreaterThan(0);
    });
  });

  it('classifies every email destination separately from new-tab web links', () => {
    const links = [
      ...HELP_ACTIONS,
      ...HELP_SECTIONS.flatMap(section => section.links),
    ];

    links.forEach(link => {
      if (link.target.startsWith('mailto:')) {
        expect(link.kind).toBe('email');
      }
      if (link.kind === 'email') {
        expect(link.target).toMatch(/^mailto:/);
      }
    });
  });

  it('should document the dashboard recovery tile now/active/latest summary behavior', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('Recovery left');
    expect(gettingStartedSection?.content).toContain('Active total');
    expect(gettingStartedSection?.content).toContain('Latest workout');
    expect(gettingStartedSection?.content).toContain('updating');
  });

  it('should document the Dashboard Today recovery countdown behavior', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('estimated local recovery day and time as Training');
    expect(gettingStartedSection?.content).toContain('remaining share of the active imported recovery estimates');
    expect(gettingStartedSection?.content).toContain('disappears when elapsed');
  });

  it('should document My Tracks trip sorting and the inferred Home entry', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('inferred **Home** area first when available');
    expect(gettingStartedSection?.content).toContain('lists only trackable types in the selected date range');
    expect(gettingStartedSection?.content).toContain('newest-first or oldest-first');
    expect(gettingStartedSection?.content).toContain('choice is saved');
  });

  it('should document inline chart discovery, editing, examples, and categories', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('Add and edit dashboard tiles');
    expect(gettingStartedSection?.content).toContain('Select a row');
    expect(gettingStartedSection?.content).toContain('Example data');
    expect(gettingStartedSection?.content).toContain('Curated');
    expect(gettingStartedSection?.content).toContain('KPI');
    expect(gettingStartedSection?.content).toContain('Custom');
    expect(gettingStartedSection?.content).toContain('Map');
    expect(gettingStartedSection?.content).toContain('one activity map and one saved-routes map');
    expect(gettingStartedSection?.content).toContain('Event search filters only the dashboard event table');
    expect(gettingStartedSection?.content).toContain('Activity tags can be added from an activity row or activity details');
    expect(gettingStartedSection?.content).toContain('**Add tags** sits beside the device name');
    expect(gettingStartedSection?.content).toContain('when no device is recorded');
    expect(gettingStartedSection?.content).toContain('exact tag filter');
    expect(gettingStartedSection?.content).toContain('tag filter and tag editors list your saved tags regardless of the selected date range');
    expect(gettingStartedSection?.content).toContain('A tag remains available for reuse after you remove it from every event');
    expect(gettingStartedSection?.content).toContain('up to 250 selected events');
    expect(gettingStartedSection?.content).toContain('atomic add/remove tag changes in bulk');
    expect(gettingStartedSection?.content).toContain('tags are visible on public event and comparison links');
    expect(gettingStartedSection?.content).toContain('Custom** charts use their own tile date-range and activity filters');
    expect(gettingStartedSection?.content).toContain('**Last 7 days** (7d), **30d**, and **Last month**');
    expect(gettingStartedSection?.content).toContain('complete previous calendar month in your local time');
    expect(gettingStartedSection?.content).toContain('Each tile saves its own selection independently from the activity table');
    expect(gettingStartedSection?.content).toContain('Map** tiles can use activity events or saved route previews');
    expect(gettingStartedSection?.content).toContain('Routes** map tiles show recent saved routes from lightweight route previews');
    expect(gettingStartedSection?.content).toContain('derived tiles stay independent from event table filters and custom/map tile filters');
    expect(gettingStartedSection?.content).toContain('New dashboards start with **Today**');
    expect(gettingStartedSection?.content).toContain('full-width dashboard section');
    expect(gettingStartedSection?.content).toContain('intentionally empty dashboards stay as you left them');
    expect(gettingStartedSection?.content).toContain('Open **Training** or **Health** from the main navigation');
    expect(gettingStartedSection?.content).toContain('Select its calendar icon to open a mini calendar for the current month');
    expect(gettingStartedSection?.content).toContain('baseline comparisons');
    expect(gettingStartedSection?.content).not.toContain('Simplify dashboard');
    expect(gettingStartedSection?.content).toContain('Charts and maps are never added automatically');
    expect(gettingStartedSection?.content).toContain('[Activity Calendar guide](/help#activity-calendar)');
    expect(gettingStartedSection?.content).toContain('**Suggested for you** shows up to two charts');
    expect(gettingStartedSection?.content).toContain('**Reset to starter dashboard**');
    expect(gettingStartedSection?.content).toContain('asks for confirmation');
    expect(gettingStartedSection?.content).toContain('newly released chart type');
    expect(gettingStartedSection?.content).toContain('**Needs more history**');
    expect(gettingStartedSection?.content).toContain('**No data in this period**');
    expect(gettingStartedSection?.content).toContain('replaces the current dashboard tiles');
    expect(gettingStartedSection?.content).toContain('**Add all presets**');
    expect(gettingStartedSection?.content).toContain('**Uploaded activities**');
    expect(gettingStartedSection?.content).toContain('**Training** remains the fixed analytical workspace');
    expect(gettingStartedSection?.content).toContain('**Aerobic Capacity**');
    expect(gettingStartedSection?.content).toContain('**Aerobic Durability**');
    expect(gettingStartedSection?.content).toContain('current **Readiness**');
    expect(gettingStartedSection?.content).toContain('KPIs and charts grouped by intent');
    expect(gettingStartedSection?.content).toContain('**Calendar** after Today, then KPIs');
    expect(gettingStartedSection?.content).toContain('**Training State**, **Health**, **Performance & Power**, **Activity Overview**, and **Routes & Maps**');
    expect(gettingStartedSection?.content).toContain('All custom charts belong in **Activity Overview**');
    expect(gettingStartedSection?.content).toContain('chart-aware default sizes');
    expect(gettingStartedSection?.content).toContain('Empty sections stay hidden');
    expect(gettingStartedSection?.content).toContain('**Cycling Power Curve** and **Running Power Curve** are curated derived snapshots');
    expect(gettingStartedSection?.content).toContain('defaults to **1y**');
    expect(gettingStartedSection?.content).toContain('latest activity or a saved recent-best comparison window');
  });

  it('should provide a dedicated Activity Calendar guide', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');
    const calendarSection = HELP_SECTIONS.find(section => section.id === 'activity-calendar');

    expect(calendarSection?.content).toContain('**Week**, **Month**, **30 days**, and **Year** views');
    expect(calendarSection?.content).toContain('same sleep-stage breakdown used in Health');
    expect(calendarSection?.content).toContain('full-width **Calendar** section');
    expect(calendarSection?.content).toContain('**Today** card opens a compact month calendar in a bottom sheet');
    expect(calendarSection?.content).toContain('Open the full [Calendar](/calendar) from the app navigation or the dashboard Calendar section');
    expect(calendarSection?.content).toContain('without changing their saved settings');
    expect(calendarSection?.content).toContain('out of suggestions until you add it manually');
    expect(calendarSection?.content).toContain('show overlapping activity-group circles');
    expect(calendarSection?.content).toContain('size reflects recorded duration');
    expect(calendarSection?.content).toContain('Period totals and activity-group bars remain available below the month');
    expect(calendarSection?.content).toContain('Select an activity row to open its details');
    expect(calendarSection?.content).toContain('Browser **Back** returns to the selected calendar day');
    expect(calendarSection?.content).toContain('The selected view, displayed period, and selected date are kept in the URL');
    expect(calendarSection?.content).toContain('intentionally have no hover or touch tooltip');
    expect(calendarSection?.content).toContain('recorded **Distance**, **Duration**, and **Ascent**');
    expect(calendarSection?.content).toContain('Month totals exclude adjacent dates');
    expect(calendarSection?.content).toContain('**Week** view, your activity count');
    expect(calendarSection?.content).toContain('**Month** keeps a compact strip of recorded **Distance**, **Duration**, and **Ascent**');
    expect(calendarSection?.content).toContain('an extra row below the activity totals');
    expect(calendarSection?.content).toContain('Months without workouts keep the activity totals alone');
    expect(calendarSection?.content).toContain('**Try again**');
    expect(calendarSection?.content).toContain('Empty planning sections and zero counts stay hidden');
    expect(calendarSection?.content).toContain('it starts closed when you open another period');
    expect(calendarSection?.content).toContain('If a Week or Month read is incomplete');
    expect(calendarSection?.content).toContain('scaled against the longest-duration group');
    expect(calendarSection?.content).toContain('alpine skiing, snowboarding, and downhill cycling');
    expect(calendarSection?.content).toContain('do not add ascent but do contribute descent');
    expect(calendarSection?.content).toContain('Diving, Scuba Diving, Free Diving, Snorkeling, and Mermaiding');
    expect(calendarSection?.content).toContain('do not contribute either elevation metric; their vertical movement is recorded as depth');
    expect(calendarSection?.content).toContain('summary exclusions configured in **Settings** also apply');
    expect(calendarSection?.content).toContain('Settings -> Units & formatting -> Start of the Week');
    expect(calendarSection?.content).toContain('visible-period activity query');
    expect(calendarSection?.content).toContain('tag filter lists your saved activity tags across all dates');
    expect(calendarSection?.content).toContain('independent from the dashboard event table');
    expect(calendarSection?.content).toContain('Select any date, including an empty one');
    expect(calendarSection?.content).toContain('Private selected-day views also show **Training impact**');
    expect(calendarSection?.content).toContain('one local calendar date can show two dated UTC outcomes');
    expect(calendarSection?.content).toContain('planned workouts never contribute');
    expect(calendarSection?.content).toContain('standalone workouts plus workouts from the active plan');
    expect(calendarSection?.content).toContain('Planned workouts never change recorded period totals');
    expect(calendarSection?.content).toContain('Merge and benchmark records are excluded');
    expect(calendarSection?.content).toContain('action menu to share, reprocess, download, or delete it');
    expect(calendarSection?.links).toContainEqual({
      label: 'Activity Calendar Overview',
      icon: 'travel_explore',
      kind: 'route',
      target: '/features/activity-calendar',
    });
    expect(gettingStartedSection?.links).toContainEqual({
      label: 'Activity Calendar guide',
      icon: 'school',
      kind: 'route',
      target: '/help',
      fragment: 'activity-calendar',
    });
  });

  it('documents standalone planning, revision recovery, and truthful provider status', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');
    const planningSection = HELP_SECTIONS.find(section => section.id === 'training-plans');

    expect(planningSection?.content).toContain('You do not need to create a plan first');
    expect(planningSection?.content).toContain('**Calendar → select day → Add workout → Mark as rest day**');
    const calendar = HELP_SECTIONS.find(section => section.id === 'activity-calendar');
    expect(calendar?.content).toContain('**Add workout → Mark as rest day**');
    expect(planningSection?.content).toContain('confirmation stays open with the saved workout');
    expect(planningSection?.content).toContain('**Reload schedule** checks it again without saving or generating another workout');
    expect(planningSection?.content).toContain('confirmation offers **Send / sync**');
    expect(planningSection?.content).toContain('**Plan sync settings** opens that plan');
    expect(planningSection?.content).toContain('Opening sync does not generate another workout');
    expect(planningSection?.content).toContain('five three-minute efforts, not a five-mile run');
    expect(planningSection?.content).toContain('titles and notes alone do not create repeats or HR/pace targets');
    expect(planningSection?.content).toContain('a sample does not verify every workout');
    expect(planningSection?.content).toContain('Plan actions -> Activate plan');
    expect(planningSection?.content).toContain('does not enable a new service');
    expect(planningSection?.content).toContain('later workouts wait');
    expect(planningSection?.content).toContain('Activation and service sync are separate choices');
    expect(planningSection?.content).toContain('[Training Plans overview](/features/training-plans)');
    expect(planningSection?.content).toContain('Plans and standalone workouts work without a service connection');
    expect(planningSection?.content).toContain('Settings -> Units & formatting -> Start of the Week');
    expect(planningSection?.content).toContain('Its first weekday is marked and named below the grid');
    expect(planningSection?.content).toContain('Saturday and Sunday are subtly tinted wherever they fall in the week');
    expect(planningSection?.content).toContain('calendar cues, not rest-day recommendations');
    expect(planningSection?.content).toContain('Each saved workout editor has its own link');
    expect(planningSection?.content).toContain('browser Back and Forward');
    expect(planningSection?.content).toContain('**Plan actions -> Plan color**');
    expect(planningSection?.content).toContain('restoring plan history also restores its saved color');
    expect(planningSection?.content).toContain('Your existing plan and workout dates remain visible until the shift commits together');
    expect(planningSection?.content).toContain('A very large history restore may briefly make planned workouts unavailable');
    expect(planningSection?.content).toContain('Completed activities remain visible');
    expect(HELP_SECTIONS.find(section => section.id === 'activity-calendar')?.content)
      .toContain('Standalone workouts stay neutral');
    expect(planningSection?.content).toContain('Workout delivery to Garmin, Suunto, and Wahoo is available to connected Pro members');
    expect(planningSection?.content).toContain('COROS plan sync and standalone Send are coming soon');
    expect(planningSection?.content).toContain('Wahoo supports time-based running/cycling, outdoor Walking/Hiking without intensity targets, and timed-strength Gym workouts');
    expect(planningSection?.content).toContain('Wahoo supports timed, untargeted pool/open-water swimming and outdoor/indoor rowing');
    expect(planningSection?.content).toContain('distance endings and intensity targets remain unsupported');
    expect(planningSection?.content).not.toMatch(/validation candidate|Hiking device playback remains unverified/);
    expect(planningSection?.content).toContain('Selected pool length is not sent to Wahoo');
    expect(planningSection?.content).toContain('its Cloud API has no documented physical pool-length field');
    expect(planningSection?.content).toContain('QS does not support sending that setting');
    expect(planningSection?.content).toContain('the saved QS sport is unchanged');
    expect(planningSection?.content).toContain('select **Strength Training**, not Yoga or Indoor Fitness Equipment');
    expect(planningSection?.content).toContain('Scheduled for later');
    expect(planningSection?.content).toContain('**Sent to Suunto** means Suunto accepted the Guide for your account');
    expect(planningSection?.content).toContain('does not prove that the Guide is visible in the Suunto app');
    expect(planningSection?.content).toContain('leave its cloud record visible to partners');
    expect(planningSection?.content).toContain('does not offer a Suunto visibility check');
    expect(planningSection?.content).toContain('never recreates a Guide automatically');
    expect(planningSection?.content).toContain('reconnecting is not required or recommended as a normal QS workflow');
    expect(planningSection?.content).toContain('Stop requests withdrawal of an eligible cloud Guide');
    expect(planningSection?.content).toContain('does not guarantee that a Guide already visible in the Suunto app or on your watch disappears');
    expect(planningSection?.content).toContain('Remove or hide it in Suunto if you no longer want to see it there');
    expect(planningSection?.content).toContain('**Completed · activity linked**');
    expect(planningSection?.content).toContain('A completed Garmin FIT activity can link to a planned workout');
    expect(planningSection?.content).toContain('a second recording of an already-linked workout does not replace the first');
    expect(planningSection?.content).toContain('**Sent · workout completed**');
    expect(planningSection?.content).toContain('**Past workout · previously sent**');
    expect(planningSection?.content).toContain('Authorized MCP clients can also author');
    expect(planningSection?.content).toContain('Enduro MTB and Downhill Cycling');
    expect(planningSection?.content).toContain('Pool swimming');
    expect(planningSection?.content).toContain('Open-water swimming');
    expect(planningSection?.content).toContain('pool length');
    expect(planningSection?.content).toContain('Garmin receives broad Running/Cycling families');
    expect(planningSection?.content).toContain('Garmin can deliver open-water workouts as **Generic**, not a native swim profile');
    expect(planningSection?.content).toContain('Garmin delivers these four profiles as **Generic**, after mapping review');
    expect(planningSection?.content).toContain('Generic works only on some devices');
    expect(planningSection?.content).toContain('QS keeps your authored sport');
    expect(planningSection?.content).toContain('repetition/kJ endings and secondary targets are unsupported');
    expect(planningSection?.content).not.toContain('Garmin open-water delivery remains unsupported');
    expect(planningSection?.content).not.toContain('Garmin and COROS delivery for these four profiles remain unsupported');
    expect(planningSection?.content).toContain('with a review warning');
    expect(planningSection?.content).toContain('only one can be active');
    expect(planningSection?.content).toContain('Move a workout between plans or between a plan and **Standalone**');
    expect(planningSection?.content).toContain('Ordinary deletion is recoverable for');
    expect(planningSection?.content).toContain('choose **Delete workout** in the footer');
    expect(planningSection?.content).toContain('Cancelling keeps your unsaved edits');
    expect(planningSection?.content).toContain('Show more deleted workouts');
    expect(planningSection?.content).toContain('90 days from the time you delete the workout');
    expect(planningSection?.content).toContain('Deleted workouts (90 days)');
    expect(planningSection?.content).toContain('Every visible date');
    expect(planningSection?.content).toContain('Planned workouts and completed activities are separate');
    expect(planningSection?.content).toContain('Separate MCP read/preview tools support an authored pool length');
    expect(planningSection?.content).toContain('A pool length only appears');
    expect(planningSection?.links).toContainEqual({
      label: 'Open Plans',
      icon: 'event_note',
      kind: 'route',
      target: '/training/plans',
    });
    expect(planningSection?.links).toContainEqual({
      label: 'Training Plans overview',
      icon: 'travel_explore',
      kind: 'route',
      target: '/features/training-plans',
    });
    expect(gettingStartedSection?.content).toContain('[Training plans guide](/help#training-plans)');
  });

  it('should document safe event merge retry and recovery behavior', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');
    const troubleshootingSection = HELP_SECTIONS.find(section => section.id === 'troubleshooting');

    expect(gettingStartedSection?.content)
      .toContain('reuses the same merged result instead of creating a duplicate');
    expect(troubleshootingSection?.content).toContain('merge may still be finishing');
    expect(troubleshootingSection?.content).toContain('selected rows remain selected');
    expect(troubleshootingSection?.content).toContain('safely reuses any existing result');
  });

  it('should provide a dedicated Training analysis guide with evidence and missing-data rules', () => {
    const trainingSection = HELP_SECTIONS.find(section => section.id === 'training-analysis');

    expect(trainingSection?.content).toContain('including weekly tooltip distances and the pool-length label beside SWOLF');
    expect(trainingSection?.content).toContain('general kilometres/miles setting does not override swimming units');
    expect(trainingSection?.content).toContain('does not change the physical pool or SWOLF comparison');
    expect(trainingSection?.content).toContain('What drove this');
    expect(trainingSection?.content).toContain('**Training impact** appears for completed activities');
    expect(trainingSection?.content).toContain('TSS divided by 42');
    expect(trainingSection?.content).toContain('**This workout’s contribution**');
    expect(trainingSection?.content).toContain('**Day result**');
    expect(trainingSection?.content).toContain('includes all training counted for that day, not only this workout');
    expect(trainingSection?.content).toContain('**TSS**, **Workout CTL**, and **Day CTL**');
    expect(trainingSection?.content).toContain('**info icon** beside the heading');
    expect(trainingSection?.content).toContain('including Fatigue (ATL) and Form');
    expect(trainingSection?.content).toContain('**How Training impact is calculated**');
    expect(trainingSection?.content).toContain('You can scroll normally over the icon on a phone');
    expect(trainingSection?.content).toContain('fixed daily cutoff, which may differ from local midnight');
    expect(trainingSection?.content).not.toContain('**About Training impact**');
    expect(trainingSection?.content).toContain('their event detail pages do not show Training impact');
    expect(trainingSection?.content).toContain('Public activity shares and planned workouts do not show Training impact');
    expect(trainingSection?.content).toContain('**Training impact recap** appears first under **Load trajectory**');
    expect(trainingSection?.content).toContain('last 7 completed UTC Training days');
    expect(trainingSection?.content).toContain('exact number of completed parent activities');
    expect(trainingSection?.content).toContain('four consecutive 7-day blocks');
    expect(trainingSection?.content).toContain('**sync icon** beside the **Training** title');
    expect(trainingSection?.content).toContain('Tap it to expand the update details');
    expect(trainingSection?.content).toContain('warning icon and **Retry**');
    expect(trainingSection?.content).toContain('**Largest sport load change**');
    expect(trainingSection?.content).toContain('do not mean that the workspace is filtered');
    expect(trainingSection?.content).toContain('neutral higher/lower language');
    expect(trainingSection?.content).toContain('plots a readable 12-week durability trend');
    expect(trainingSection?.content).not.toContain('**Body-weight trend**');
    expect(trainingSection?.content).toContain('Body measurements are available in [Health](/health), not Training');
    expect(trainingSection?.content).toContain('does not delete recorded measurements');
    expect(trainingSection?.content).toContain('change the Training state, Form, or Readiness');
    expect(trainingSection?.content).toContain('A Cycling Power Curve proves that power was recorded');
    expect(trainingSection?.content).toContain('**Power systems** is available to every signed-in Training user');
    expect(trainingSection?.content).toContain('It estimates current CP, W′, and Pmax');
    expect(trainingSection?.content).toContain('preceding 42 completed UTC days');
    expect(trainingSection?.content).toContain('smaller set of workouts that actually supplied');
    expect(trainingSection?.content).toContain('A type selector appears only when more than one exact activity type is available');
    expect(trainingSection?.content).toContain('fitting-method disagreement');
    expect(trainingSection?.content).toContain('stable CP can remain visible when W′ is unstable');
    expect(trainingSection?.content).toContain('**What this means**');
    expect(trainingSection?.content).toContain('competing W′ estimate range');
    expect(trainingSection?.content).toContain('whole-workout removal');
    expect(trainingSection?.content).toContain('New power curves remove isolated one-sample recording artifacts');
    expect(trainingSection?.content).toContain('short-curve signature in older stored curves');
    expect(trainingSection?.content).toContain('Parsing a workout no longer generates CP, W′, Pmax, or power-system strain');
    expect(trainingSection?.content).toContain('original continuous power stream');
    expect(trainingSection?.content).not.toContain('asks for reprocessing');
    expect(trainingSection?.content).toContain('Weeks without a comparable session explain their primary exclusions');
    expect(trainingSection?.content).toContain('intentional easing, terrain changes, coasting, or a pace change');
    expect(trainingSection?.content).toContain('no suitable comparison rather than zero');
    expect(trainingSection?.content).toContain('**All sports**');
    expect(trainingSection?.content).toContain('text button beside **Shortcuts**');
    expect(trainingSection?.content).toContain('keeps its name and coloured sport icon');
    expect(trainingSection?.content).toContain('compact swipeable sport buttons');
    expect(trainingSection?.content).toContain('compact **All sports** arrow button opens every currently available sport');
    expect(trainingSection?.content).toContain('**Fitness & Gym** appears when recorded');
    expect(trainingSection?.content).toContain('**Other training** appears when a recorded sport');
    expect(trainingSection?.content).toContain('not from TSS, zones, power, or durability evidence');
    expect(trainingSection?.content).toContain('available TSS summary');
    expect(trainingSection?.content).toContain('median of the three preceding 28-day blocks');
    expect(trainingSection?.content).toContain('**Manage sport shortcuts**');
    expect(trainingSection?.content).toContain('training duration and workouts in the latest 28 days');
    expect(trainingSection?.content).toContain('selected shortcut does not jump');
    expect(trainingSection?.content).toContain('Running, Cycling, Swimming, Rowing, Walking & Hiking, Nordic Skiing, Strength, or Paddling');
    expect(trainingSection?.content).toContain('Shortcuts change navigation only');
    expect(trainingSection?.content).toContain('**Use automatic selection**');
    expect(trainingSection?.content).toContain('unmatched types appear under **Other power activities**');
    expect(trainingSection?.content).toContain('standard mountain biking, Enduro MTB, and Downhill MTB');
    expect(trainingSection?.content).toContain('hand cycle, velomobile');
    expect(trainingSection?.content).toContain('Durations for downhill runs and uplift/lift segments need recorded evidence');
    expect(trainingSection?.content).toContain('Every Training group counts an activity\'s saved TSS when present, including zero');
    expect(trainingSection?.content).toContain('Cycling and Road Cycling share a rolling capacity history');
    expect(trainingSection?.content).toContain('Running and Road Running share another');
    expect(trainingSection?.content).toContain('Every other sport keeps its own history');
    expect(trainingSection?.content).toContain('Longest jump is the maximum persisted jump distance');
    expect(trainingSection?.content).toContain('gravity MTB jump count and longest jump');
    expect(trainingSection?.content).toContain('Rowing does not have a durability adapter');
    expect(trainingSection?.content).toContain('fixed Cycling power context remains visible');
    expect(trainingSection?.content).toContain('power unknown rather than confirmed no power');
    expect(trainingSection?.content).toContain('Unsupported Enduro and Downhill evidence is not counted as confirmed power');
    expect(trainingSection?.content).toContain('one activity leg at a time');
    expect(trainingSection?.content).toContain('shown first as quick picks');
    expect(trainingSection?.content).toContain('selecting an event never changes its tags');
    expect(trainingSection?.content).toContain('**Recovery context**');
    expect(trainingSection?.content).toContain('**Recovery left**');
    expect(trainingSection?.content).toContain('**Sleep history**');
    expect(trainingSection?.content).toContain('remains visible while sleep details are collapsed');
    expect(trainingSection?.content).toContain('estimated local recovery day and time');
    expect(trainingSection?.content).toContain('**Show sleep details**');
    expect(trainingSection?.content).toContain('omitted quietly when missing or elapsed');
    expect(trainingSection?.content).toContain('without changing the Training state');
    expect(trainingSection?.content).toContain('Dashboard **Today** shows the same compact state label and caption');
    expect(trainingSection?.content).toContain('same current formula as Dashboard Today');
    expect(trainingSection?.content).toContain('Average HR leads the single Overnight HR driver at 70%, minimum HR contributes 30%');
    expect(trainingSection?.content).toContain('Lower Overnight HR versus personal baseline supports readiness');
    expect(trainingSection?.content).toContain('can provide both HR measures');
    expect(trainingSection?.content).toContain('QS can calculate missing sleep-window HR');
    expect(trainingSection?.content).toContain('at least 90% coverage with no gap over five minutes');
    expect(trainingSection?.content).toContain('keep a separate baseline from provider-reported readings');
    expect(trainingSection?.content).toContain('rolling **60-day personal range**');
    expect(trainingSection?.content).toContain('Changing a chart to one year does not change these windows');
    expect(trainingSection?.content).toContain(
      'Failed or stale load, recovery, or sleep sources contribute no current value',
    );
    expect(trainingSection?.content).toContain('sleep refresh failure clears previously loaded readiness sleep evidence immediately');
    expect(trainingSection?.content).toContain('weights their HRV by the recorded sample counts');
    expect(trainingSection?.content).toContain('does not simply use the last record');
    expect(trainingSection?.content).toContain('**No current HRV**');
    expect(trainingSection?.content).toContain('context, not a workout instruction');
    expect(trainingSection?.content).toContain('**14-day trend**');
    expect(trainingSection?.content).toContain('without scanning activity history');
    expect(trainingSection?.content).toContain('each daily point applies its own 60-day HRV range and seven-day average');
    expect(trainingSection?.content).toContain('missing scores stay as gaps');
    expect(trainingSection?.content).toContain('longest valid main overnight record');
    expect(trainingSection?.content).toContain('at least three recorded nights');
    expect(trainingSection?.content).toContain('at least five qualifying nights');
    expect(trainingSection?.content).toContain('Missing nights and missing HRV are never counted as zero');
    expect(trainingSection?.content).toContain('at least seven recorded nights and at least half of the window');
    expect(trainingSection?.content).toContain('keeps pool and open-water evidence separate');
    expect(trainingSection?.content).toContain('does not infer Critical Swim Speed');
    expect(trainingSection?.content).toContain('zero-session result');
    expect(trainingSection?.content).toContain('Imported VO₂ max');
    expect(trainingSection?.content).toContain('manual Running or Cycling lab/field VO₂ max');
    expect(trainingSection?.content).toContain('nearest imported estimate is within 14 days');
    expect(trainingSection?.content).toContain("95% of that activity's 20-minute best");
    expect(trainingSection?.content).toContain('There is no pooled all-sports value');
    expect(trainingSection?.content).toContain('partial, insufficient, poor-fit, unstable, and invalid evidence');
    expect(trainingSection?.content).not.toContain('aggregate best 3–20 minute power curve');
    expect(trainingSection?.content).toContain('never a readiness score');
    expect(trainingSection?.links).toContainEqual({
      label: 'Open Training',
      icon: 'monitoring',
      kind: 'route',
      target: '/training',
    });
  });

  it('should link Getting Started to Training guidance and feedback', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');
    const trainingSection = HELP_SECTIONS.find(section => section.id === 'training-analysis');

    expect(gettingStartedSection?.content).toContain('**Training** is your fixed workspace');
    expect(gettingStartedSection?.content).toContain('[Training analysis guide](/help#training-analysis)');
    expect(gettingStartedSection?.content).toContain('[Training Analysis overview](/features/training-analysis)');
    expect(gettingStartedSection?.content).toContain('**Email Training Feedback** action');
    expect(gettingStartedSection?.content).not.toContain('**Training (Beta)**');
    expect(gettingStartedSection?.links).toContainEqual({
      label: 'Training analysis guide',
      icon: 'school',
      kind: 'route',
      target: '/help',
      fragment: 'training-analysis',
    });
    expect(gettingStartedSection?.links).toContainEqual({
      label: 'Training Analysis Overview',
      icon: 'monitoring',
      kind: 'route',
      target: '/features/training-analysis',
    });
    expect(trainingSection?.links).toContainEqual({
      label: 'Email Training Feedback',
      icon: 'email',
      kind: 'email',
      target: expect.stringMatching(/^mailto:.*subject=Training%20feedback$/),
    });
  });

  it('should document that distance values follow unit preferences across the app', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('Distance values in dashboards, event charts, activity chips, and CSV exports');
    expect(gettingStartedSection?.content).toContain('Dashboard **Action prompts**');
    expect(gettingStartedSection?.content).toContain('dashboard **Default units** action prompt');
    expect(gettingStartedSection?.content).not.toContain('Keep current units');
    expect(gettingStartedSection?.content).toContain('preserves your weight and week-start choices');
    expect(gettingStartedSection?.content).toContain('before your first activity');
    expect(gettingStartedSection?.content).toContain('**No activities yet**');
    expect(gettingStartedSection?.content).toContain('**Upload activity**');
    expect(gettingStartedSection?.content).toContain('**Connect service**');
    expect(gettingStartedSection?.content).toContain('only after checking that no activity service is connected');
    expect(gettingStartedSection?.content).toContain('even if history returns no activities');
    expect(gettingStartedSection?.content).toContain('including while it is queued');
    expect(gettingStartedSection?.content).toContain('retry failed connection imports in **Services**');
    expect(gettingStartedSection?.content).toContain('FIT, GPX, TCX, JSON, and SML files');
    expect(gettingStartedSection?.content).toContain('Garmin, Suunto, COROS, and Wahoo');
    expect(gettingStartedSection?.content).toContain('after activity data exists');
    expect(gettingStartedSection?.content).toContain('Pro users with activity data but without a connected activity service');
    expect(gettingStartedSection?.content).toContain('**Connect a service** action prompt');
    expect(gettingStartedSection?.content).toContain('dismissing it hides the prompt permanently');
    expect(gettingStartedSection?.content).toContain('**Send new activities to Suunto** action prompt');
    expect(gettingStartedSection?.content).toContain('Turning it on affects new Garmin or COROS activities only');
    expect(gettingStartedSection?.content).toContain('use **Send past activities** in **Services** for activities already in Quantified Self');
    expect(gettingStartedSection?.content).toContain('Advanced settings');
    expect(gettingStartedSection?.content).toContain('kilometers or miles');
    expect(gettingStartedSection?.content).toContain('Settings -> Units & formatting');
    expect(gettingStartedSection?.content).toContain('jump distances display in feet when miles are selected');
  });

  it('should document event swim length tables', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');
    expect(gettingStartedSection?.content).toContain('**Selected columns** stay at the top in table order');
    expect(gettingStartedSection?.content).toContain('**Move up** or **Move down**');
    expect(gettingStartedSection?.content).toContain('with touch or keyboard');
    expect(gettingStartedSection?.content).toContain('Search filters **Add columns** only');
    expect(gettingStartedSection?.content).toContain('If a save fails, the previous selection and order return');

    expect(gettingStartedSection?.content).toContain('individual recorded FIT pool lengths');
    expect(gettingStartedSection?.content).toContain('**Total strokes**');
    expect(gettingStartedSection?.content).toContain('**SWOLF (25 yd)**');
    expect(gettingStartedSection?.content).toContain('Stroke, total strokes and normalized SWOLF columns are available only for swimming');
    expect(gettingStartedSection?.content).toContain('Swimming performance averages exclude rest');
    expect(gettingStartedSection?.content).toContain('touching, non-overlapping recorded times');
    expect(gettingStartedSection?.content).toContain('positive recorded active-length count');
    expect(gettingStartedSection?.content).toContain('sums its original lap durations once');
    expect(gettingStartedSection?.content).toContain('estimate weighted by recorded lap duration');
    expect(gettingStartedSection?.content).toContain('**Selected summary** uses the original selected laps, including rest for **Max HR**');
    expect(gettingStartedSection?.content).toContain('not divided into invented splits');
    expect(gettingStartedSection?.content).toContain('Incomplete length details can use valid native interval metrics');
    expect(gettingStartedSection?.content).toContain('recorded active-length count differs');
    expect(gettingStartedSection?.content).toContain('Mixed swim/rest intervals require complete active length details');
    expect(gettingStartedSection?.content).toContain('Missing active-length distance can use its recorded pool length');
    expect(gettingStartedSection?.content).toContain('Rest lengths never gain distance from pool size');
    expect(gettingStartedSection?.content).toContain('Set pace and calculated SWOLF require complete active time and distance');
    expect(gettingStartedSection?.content).toContain('the set header shows **Distance unavailable**');
    expect(gettingStartedSection?.content).toContain('An invalid recorded distance is never replaced with pool length');
    expect(gettingStartedSection?.content).toContain('later cumulative splits show **Unavailable** until the next set');
    expect(gettingStartedSection?.content).toContain('Known individual length distances stay visible');
    expect(gettingStartedSection?.content).toContain('Event swim length tables');
    expect(gettingStartedSection?.content).toContain('**Swim Lengths** table');
    expect(gettingStartedSection?.content).toContain('per-length pool data');
    expect(gettingStartedSection?.content).toContain('grouped into collapsed sets through the next idle/rest length');
    expect(gettingStartedSection?.content).toContain('lap index, split progress, duration, distance, length type, stroke, strokes, swim pace, stroke rate, heart rate, SWOLF, and energy');
    expect(gettingStartedSection?.content).toContain('use **Stroke Rate** rather than Cadence');
    expect(gettingStartedSection?.content).toContain('25 m, 50 m, 75 m, and 100 m splits before the rest row');
    expect(gettingStartedSection?.content).toContain('**Settings -> Units & formatting -> Customize units -> Swim pace**');
    expect(gettingStartedSection?.content).toContain('25 yd, 50 yd, 75 yd, and 100 yd splits before the rest row');
    expect(gettingStartedSection?.content).toContain('Stored distances remain in meters');
    expect(gettingStartedSection?.content).toContain('complete length data can confirm a nominal 25- or 50-yard pool');
    expect(gettingStartedSection?.content).toContain('Custom pools and recordings with missing or conflicting evidence keep recorded precision');
    expect(gettingStartedSection?.content).toContain('recorded distances, pace, SWOLF and Training load stay unchanged');
    expect(gettingStartedSection?.content).toContain('**Swim** time (excluding idle/rest lengths)');
    expect(gettingStartedSection?.content).toContain('**Total** keeps the combined time');
    expect(gettingStartedSection?.content).toContain('Set swim pace, stroke totals, average stroke rate, and efficiency exclude rest too');
    expect(gettingStartedSection?.content).toContain('Each length keeps its recorded duration and all available details');
    expect(gettingStartedSection?.content).toContain('falling back to elapsed time when timer time is missing');
    expect(gettingStartedSection?.content).toContain('unrecorded rest is not inferred');
    expect(gettingStartedSection?.content).toContain('Open sets stay open when unit preferences change');
    expect(gettingStartedSection?.content).toContain('Each swim set header shows its recorded **Stroke** automatically');
    expect(gettingStartedSection?.content).toContain('**Laps -> Columns -> Swimming -> Stroke**');
    expect(gettingStartedSection?.content).toContain('Existing saved column choices stay as you selected them');
    expect(gettingStartedSection?.content).toContain('Missing stroke data and rest-only laps stay blank');
  });

  it('explains the compact single-activity jump table and multi-activity tabs', () => {
    const content = HELP_SECTIONS.find(section => section.id === 'getting-started')!.content;
    expect(content).toContain("A single activity's jump table appears directly below **Jumps**, without an extra activity tab");
    expect(content).toContain('When multiple selected activities contain jumps, use the activity tabs');
    expect(content).toContain('Only columns with available data are shown');
  });

  it('should document sport-specific event lap table columns', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('Event lap tables');
    expect(gettingStartedSection?.content).toContain('A sole lap that repeats the whole activity is hidden');
    expect(gettingStartedSection?.content).toContain('If the lap and activity totals cannot be compared reliably, the lap stays visible');
    expect(gettingStartedSection?.content).toContain('including Garmin **Session end** laps and Suunto final partial laps');
    expect(gettingStartedSection?.content).toContain('the last numbered row with a **Final lap** label, without a separate tab');
    expect(gettingStartedSection?.content).toContain('Its recorded values stay separate from the preceding lap');
    expect(gettingStartedSection?.content).toContain('Mixed lap types, overlapping or uncertain timing, multiple session endings');
    expect(gettingStartedSection?.content).toContain('**Laps -> Columns**');
    expect(gettingStartedSection?.content).toContain('typed metric search');
    expect(gettingStartedSection?.content).toContain('**Tab** and **Shift+Tab**');
    expect(gettingStartedSection?.content).toContain('returns focus to its trigger');
    expect(gettingStartedSection?.content).toContain('Running, Cycling, Swimming, or Other activities');
    expect(gettingStartedSection?.content).toContain('separate column list for each of those sport families');
    expect(gettingStartedSection?.content).toContain('Swimming choices focus on duration, distance, swim pace');
    expect(gettingStartedSection?.content).toContain('**Show other metrics**');
    expect(gettingStartedSection?.content).toContain('**Lap sport family** selector when more than one sport is present');
    expect(gettingStartedSection?.content).toContain('stay visible while its contents scroll');
    expect(gettingStartedSection?.content).toContain('the picker shows their match count');
    expect(gettingStartedSection?.content).toContain('metrics recorded in the current laps, even before you select them');
    expect(gettingStartedSection?.content).toContain('search or restore older choices');
    expect(gettingStartedSection?.content).toContain('Existing saved selections and their order stay unchanged');
    expect(gettingStartedSection?.content).toContain('Running and trail-running laps use pace');
    expect(gettingStartedSection?.content).toContain('A lap table with multiple laps includes a persistent **Summary** row directly below its headers');
    expect(gettingStartedSection?.content).toContain("Single-lap tables omit this row and keep the lap's recorded values");
    expect(gettingStartedSection?.content).toContain('checked separately for each activity and displayed lap group, including any appended final segment');
    expect(gettingStartedSection?.content).toContain('a grouped rest block still counts its original laps');
    expect(gettingStartedSection?.content).toContain('Accumulated totals, such as duration, distance, elevation, energy, and work, are not averaged');
    expect(gettingStartedSection?.content).toContain('checkboxes beside lap rows');
    expect(gettingStartedSection?.content).toContain('**Selected summary · N** footer');
    expect(gettingStartedSection?.content).toContain('**Max HR** in the Summary row is the whole-session peak, including rest');
    expect(gettingStartedSection?.content).toContain('unweighted mean of available active-lap average heart rates');
    expect(gettingStartedSection?.content).toContain('unselected laps and the session peak do not contribute');
    expect(gettingStartedSection?.content).toContain('never borrows a cross-sport context lap');
    expect(gettingStartedSection?.content).toContain('distance-weighted pace and duration-weighted speed');
    expect(gettingStartedSection?.content).toContain('A saved lap column stays selected even when the current laps do not contain that metric');
    expect(gettingStartedSection?.content).toContain('available in only some of the current lap tables');
    expect(gettingStartedSection?.content).toContain('Satellite diagnostics and EHPE/EVPE position-error metrics');
    expect(gettingStartedSection?.content).toContain('Missing values stay unavailable rather than becoming zero');
  });

  it('explains the active-duration requirement for event-detail durability after reload', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('valid, positive active **Duration**');
    expect(gettingStartedSection?.content).toContain('reopening the workout does not calculate or reuse a durability result');
    expect(gettingStartedSection?.content).toContain('Zero active time cannot support this long-session comparison');
    expect(gettingStartedSection?.content).toContain('does not change your saved Training load or Training history');
  });

  it('should document event stamina metrics', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('Event stamina metrics');
    expect(gettingStartedSection?.content).toContain('**EnergySense Endurance**');
    expect(gettingStartedSection?.content).toContain('**EnergySense Sustainable Distance**');
    expect(gettingStartedSection?.content).toContain('source ending summary can differ');
    expect(gettingStartedSection?.content).toContain('**Stamina** and **Potential Stamina**');
    expect(gettingStartedSection?.content).toContain('Detailed Statistics');
    expect(gettingStartedSection?.content).toContain('event summary metric tabs');
    expect(gettingStartedSection?.content).toContain('selectable chart metrics');
    expect(gettingStartedSection?.content).toContain('**Beginning Potential Stamina**');
    expect(gettingStartedSection?.content).toContain('**Ending Potential Stamina**');
  });

  it('should document source-recorded FIT metabolic calories', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('FIT calorie metrics');
    expect(gettingStartedSection?.content).toContain('**Metabolic Calories**');
    expect(gettingStartedSection?.content).toContain('**Physiological** Event Details summary tab');
    expect(gettingStartedSection?.content).toContain('separate from total **Energy**');
  });

  it('should document event dive profiles, depth availability, and units', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('Event dive profiles');
    expect(gettingStartedSection?.content).toContain('Diving, Scuba Diving, Free Diving, Snorkeling, and Mermaiding');
    expect(gettingStartedSection?.content).toContain('**Dive Profile**');
    expect(gettingStartedSection?.content).toContain('single-gas, multi-gas, or gauge diving');
    expect(gettingStartedSection?.content).toContain('apnea diving and apnea hunting');
    expect(gettingStartedSection?.content).toContain('**Altitude Minimum**, **Altitude Maximum**, **Average Altitude**, ascent/descent timing, grade and grade-adjusted values, VAM, and vertical speed');
    expect(gettingStartedSection?.content).toContain('mixed Event is regenerated, its ascent, descent, altitude, and grade summaries use only non-Diving activities');
    expect(gettingStartedSection?.content).toContain('below Performance Charts and above the normal Event Details charts');
    expect(gettingStartedSection?.content).toContain('standard Event Details chart controls and height');
    expect(gettingStartedSection?.content).toContain('standard chart overlay picker');
    expect(gettingStartedSection?.content).toContain('no-decompression limit');
    expect(gettingStartedSection?.content).toContain('air time remaining');
    expect(gettingStartedSection?.content).toContain('pressure/volume SAC');
    expect(gettingStartedSection?.content).toContain('**Diving** summary tab');
    expect(gettingStartedSection?.content).toContain('**Maximum Depth**');
    expect(gettingStartedSection?.content).toContain('**Gas & Tanks**');
    expect(gettingStartedSection?.content).toContain('tank pressure updates');
    expect(gettingStartedSection?.content).toContain('New imports and reprocessed activities keep those details with the activity');
    expect(gettingStartedSection?.content).toContain('older activities can still show them while the original file is available');
    expect(gettingStartedSection?.content).toContain('does not make up a gas mixture name or nitrogen value');
    expect(gettingStartedSection?.content).toContain('match a gas to a tank');
    expect(gettingStartedSection?.content).toContain('Missing values stay unavailable');
    expect(gettingStartedSection?.content).toContain('does not infer summaries from samples');
    expect(gettingStartedSection?.content).toContain('advanced chart metric');
    expect(gettingStartedSection?.content).toContain('first Swim pace preference');
    expect(gettingStartedSection?.content).toContain('meters and meters per second');
    expect(gettingStartedSection?.content).toContain('feet and feet per second');
    expect(gettingStartedSection?.content).toContain("FIT source's three decimal places");
    expect(gettingStartedSection?.content).toContain('SAC/RMV and PO₂ retain two');
  });

  it('should document duration fallback for any activity without distance data', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('if **Distance** is selected but any selected activity does not include distance data');
  });

  it('should document non-merged event heart-rate and power zone line and fill coloring', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('provider heart-rate or power zone boundaries');
    expect(gettingStartedSection?.content).toContain('non-merged events');
    expect(gettingStartedSection?.content).toContain('**Color by zones** in **Chart options**');
    expect(gettingStartedSection?.content).toContain('your choice is saved across events');
    expect(gettingStartedSection?.content).toContain('merged events and benchmark comparisons keep their device colors');
    expect(gettingStartedSection?.content).toContain('**Reset zoom or selection** button');
    expect(gettingStartedSection?.content).toContain('clears the shared chart state for the event');
    expect(gettingStartedSection?.content).toContain('Each event chart panel can use the **Overlay** button');
    expect(gettingStartedSection?.content).toContain('**Continuous** is the default');
    expect(gettingStartedSection?.content).toContain('including across missing data');
    expect(gettingStartedSection?.content).toContain('**Detect gaps** estimates breaks');
    expect(gettingStartedSection?.content).toContain('**Custom gap limit**');
    expect(gettingStartedSection?.content).toContain('**X axis** choices; open either submenu to change it.');
    expect(gettingStartedSection?.content).toContain('**Settings → Charts → Event chart line continuity**');
    expect(gettingStartedSection?.content).toContain('missing measurements stay missing in tooltips and statistics');
    expect(gettingStartedSection?.content).toContain('Power **3s** still requires complete sample windows');
    expect(gettingStartedSection?.content).toContain('Right-clicking an event chart copies a themed image of the full chart panel');
    expect(gettingStartedSection?.content).toContain('**Show Swim Lengths** chart option');
    expect(gettingStartedSection?.content).toContain('**Swim / rest timeline**');
    expect(gettingStartedSection?.content).toContain('**Show in charts**');
    expect(gettingStartedSection?.content).toContain('**All intervals**');
    expect(gettingStartedSection?.content).toContain('**data coverage**');
    expect(gettingStartedSection?.content).toContain('**Show affected lengths**');
    expect(gettingStartedSection?.content).toContain('Independent watch totals may still be available');
    expect(gettingStartedSection?.content).toContain('Gaps are not assumed to be rest');
    expect(gettingStartedSection?.content).toContain('Swim length chart tooltips use the same distance and pace rules as the length table');
    expect(gettingStartedSection?.content).toContain('Swim lap tooltips show **Avg Swim Pace**');
    expect(gettingStartedSection?.content).toContain('swim length end boundaries');
    expect(gettingStartedSection?.content).toContain('active and idle/rest lengths are both included');
    expect(gettingStartedSection?.content).toContain('shared y-axis');
    expect(gettingStartedSection?.content).toContain('right-side y-axis');
    expect(gettingStartedSection?.content).toContain('saved globally by primary metric');
    expect(gettingStartedSection?.content).toContain('primary metric keeps its normal line and fill');
    expect(gettingStartedSection?.content).toContain('plain solid no-fill line using the overlay metric');
    expect(gettingStartedSection?.content).toContain('merged and benchmark events');
    expect(gettingStartedSection?.content).toContain('both metric and activity labels');
    expect(gettingStartedSection?.content).toContain('[Features hub](/features)');
    expect(gettingStartedSection?.content).toContain('[Workout Data Comparison](/features/workout-data-comparison)');
    expect(gettingStartedSection?.content).toContain('[Workout File Analyzer](/features/fit-gpx-tcx-file-analyzer)');
    expect(gettingStartedSection?.content).toContain('[FIT and GPX Route Files](/features/fit-gpx-route-files)');
    expect(gettingStartedSection?.content).toContain('[File Comparison Tool](/tools/compare)');
    expect(gettingStartedSection?.content).toContain('**Complete account setup**');
    expect(gettingStartedSection?.content).toContain('accept the required policies before selecting files');
    expect(gettingStartedSection?.content).toContain('**Continue to Compare** finishes free account setup');
    expect(gettingStartedSection?.content).toContain('[Tools -> Compare](/tools/compare/saved)');
    expect(gettingStartedSection?.content).toContain('**Distinct line patterns** is in **Settings -> Charts**, below **Line Width**');
    expect(gettingStartedSection?.content).toContain('It is off by default');
    expect(gettingStartedSection?.content).toContain('Primary and overlay lines keep their normal stroke widths');
    expect(gettingStartedSection?.content).toContain('Use **Save Changes** to apply this account preference');
    expect(gettingStartedSection?.content).toContain('in **Chart options** on merged and benchmark event details');
    expect(gettingStartedSection?.content).toContain('changes in event details save immediately and use the same preference');
    expect(gettingStartedSection?.content).toContain('sortable, filterable, paginated table with device, activity type, and review tag filters, selected-row bulk delete, distance, ascent, descent, visible benchmark pairs, GNSS/heart-rate/altitude benchmark error metrics colored by low/moderate/high error, clickable draft metric cells that open the benchmark flow, quick description notes, and custom reviewer tags');
    expect(gettingStartedSection?.content).toContain('Benchmark reports show an **At a Glance** reviewer summary');
    expect(gettingStartedSection?.content).toContain('report share menu can copy that summary');
    expect(gettingStartedSection?.content).toContain('account-level device color preferences from saved file comparisons');
    expect(gettingStartedSection?.content).toContain('**Use Okabe–Ito preset**');
    expect(gettingStartedSection?.content).toContain('**Standard** is selected by default and also offers dark gray and tan');
    expect(gettingStartedSection?.content).toContain('solid, dashed, dotted, and dash-dot patterns');
    expect(gettingStartedSection?.content).toContain('black becomes neutral gray in dark mode');
    expect(gettingStartedSection?.content).toContain('keyed by the base device name rather than firmware/software version');
    expect(gettingStartedSection?.content).toContain('activity toggles, event tables, benchmark dialogs, charts, and maps');
    expect(gettingStartedSection?.content).toContain('uploaded FIT/TCX/GPX/JSON/SML activity files');
    expect(gettingStartedSection?.content).toContain('maps, charts');
    expect(gettingStartedSection?.content).toContain('reviewer workflows for device tests, YouTube videos, and blog posts');
    expect(gettingStartedSection?.content).toContain(`Manual uploads, core analysis, and benchmark comparisons are available on the free plan for up to ${USAGE_LIMITS.free} activities and ${ROUTE_USAGE_LIMITS.free} saved routes`);
    expect(gettingStartedSection?.content).toContain('automatic provider sync and higher limits require a paid plan');
    expect(gettingStartedSection?.content).not.toContain('overlays, AI insights, and reviewer workflows');
    expect(gettingStartedSection?.content).toContain('**Altitude** charts can color the altitude line by grade');
    expect(gettingStartedSection?.content).toContain('**Color Altitude by Grade**');
    expect(gettingStartedSection?.content).toContain('**Heart Rate** and **Power** charts color their lines and visible fill');
    expect(gettingStartedSection?.content).toContain('**Include all recorded metrics**');
    expect(gettingStartedSection?.content).toContain('available in **Visible charts**');
    expect(gettingStartedSection?.content).toContain('global allow-list for automatic chart visibility');
    expect(gettingStartedSection?.content).toContain('first up to three relevant recorded metrics');
    expect(gettingStartedSection?.content).toContain('adds choices but does not show them automatically');
    expect(gettingStartedSection?.content).toContain('Merged events and benchmark comparisons always make all recorded chartable metrics available');
    expect(gettingStartedSection?.content).toContain('recommendations combine the selected sport, recorded metrics, and your Default chart metrics');
    expect(gettingStartedSection?.content).toContain('custom override for that event and selected-sport combination');
    expect(gettingStartedSection?.content).toContain('**Show all charts** is an explicit custom choice');
    expect(gettingStartedSection?.content).toContain('**Reset to <sport> defaults**');
    expect(gettingStartedSection?.content).toContain('pinned **Dive Profile** owns Depth and every available dive overlay');
    expect(gettingStartedSection?.content).not.toContain('lightly tints the chart grid by zone');
  });

  it('should document the dashboard form tile CTL/ATL/TSB behavior', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('Form tile (CTL / ATL / TSB)');
    expect(gettingStartedSection?.content).toContain('Training Stress Score');
    expect(gettingStartedSection?.content).toContain('Power Training Stress Score');
    expect(gettingStartedSection?.content).toContain('Current TSB');
    expect(gettingStartedSection?.content).toContain('same-day readiness');
    expect(gettingStartedSection?.content).toContain('Both Form/TSS vertical axes fit the displayed period');
    expect(gettingStartedSection?.content).toContain('The Form pane keeps its zero baseline');
    expect(gettingStartedSection?.content).toContain('full history');
    expect(gettingStartedSection?.content).toContain('W / M / Y');
    expect(gettingStartedSection?.content).toContain('saved on that dashboard tile');
    expect(gettingStartedSection?.content).toContain('continue to **today** with zero-load decay');
    expect(gettingStartedSection?.content).toContain('does not use slider or reload/reset toolbar controls');
    expect(gettingStartedSection?.content).toContain('Latest workout TSS');
    expect(gettingStartedSection?.content).toContain('weekly');
    expect(gettingStartedSection?.content).toContain('asynchronously');
    expect(gettingStartedSection?.content).toContain('**Preparing your dashboard…**');
    expect(gettingStartedSection?.content).toContain('**Today** title, date, and calendar stay in place');
  });

  it('should document new derived KPI rows and curated charts', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('Freshness Forecast');
    expect(gettingStartedSection?.content).toContain('Intensity Distribution');
    expect(gettingStartedSection?.content).toContain('Efficiency Trend');
    expect(gettingStartedSection?.content).toContain('Cycling Power Curve');
    expect(gettingStartedSection?.content).toContain('Running Power Curve');
    expect(gettingStartedSection?.content).toContain('prepared PowerCurve snapshot');
    expect(gettingStartedSection?.content).toContain('latest activity, best last 30d, or best last 90d');
    expect(gettingStartedSection?.content).toContain('Cycling and running power data stay in separate tiles');
    expect(gettingStartedSection?.content).toContain('saved per dashboard tile');
    expect(gettingStartedSection?.content).not.toContain('**Sleep** shows connected-source sleep duration');
    expect(gettingStartedSection?.content).toContain('ACWR');
    expect(gettingStartedSection?.content).toContain('Ramp Rate');
    expect(gettingStartedSection?.content).toContain('Monotony / Strain');
    expect(gettingStartedSection?.content).toContain('Load Status');
    expect(gettingStartedSection?.content).toContain('Form Now');
    expect(gettingStartedSection?.content).toContain('Fitness (CTL)');
    expect(gettingStartedSection?.content).toContain('Fatigue (ATL)');
    expect(gettingStartedSection?.content).toContain('Fitness Trend');
    expect(gettingStartedSection?.content).toContain('Fatigue Trend');
    expect(gettingStartedSection?.content).toContain('Recovery Debt');
    expect(gettingStartedSection?.content).toContain('Form +7d');
    expect(gettingStartedSection?.content).toContain('Training Balance');
    expect(gettingStartedSection?.content).toContain('Easy %');
    expect(gettingStartedSection?.content).toContain('Hard %');
    expect(gettingStartedSection?.content).toContain('Efficiency Δ (4w)');
    expect(gettingStartedSection?.content).toContain('Load');
    expect(gettingStartedSection?.content).toContain('Readiness');
    expect(gettingStartedSection?.content).toContain('same compact **Training state** label and caption as Training');
    expect(gettingStartedSection?.content).toContain('Execution');
    expect(gettingStartedSection?.content).toContain('Current week');
    expect(gettingStartedSection?.content).toContain('Latest week');
    expect(gettingStartedSection?.content).toContain('8w / 12w / 6m / 1y / All');
    expect(gettingStartedSection?.content).toContain('Training-derived tiles do not fall back');
    expect(gettingStartedSection?.content).toContain('**info** icon');
    expect(gettingStartedSection?.content).toContain('Dashboard **Today** header');
    expect(gettingStartedSection?.content).toContain('browser-local morning, afternoon, or evening time');
    expect(gettingStartedSection?.content).toContain('generic copy otherwise');
    expect(gettingStartedSection?.content).toContain('hidden on shared dashboards');
    expect(gettingStartedSection?.content).toContain('**Show Today summary**');
    expect(gettingStartedSection?.content).toContain('hides the Today summary');
    expect(gettingStartedSection?.content).toContain('Today rows stay compact');
    expect(gettingStartedSection?.content).toContain('KPI detail rows');
    expect(gettingStartedSection?.content).toContain('freshness date');
    expect(gettingStartedSection?.content).toContain('metric-specific');
  });

  it('should document mobile dashboard haptic feedback behavior and fallback', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('haptic feedback');
    expect(gettingStartedSection?.content).toContain('Dialog choices, **Cancel**, rename saves');
    expect(gettingStartedSection?.content).toContain('Typing, unchanged choices, invalid submissions and disabled actions stay silent');
    expect(gettingStartedSection?.content).toContain('supported mobile devices');
    expect(gettingStartedSection?.content).toContain('vibration support is unavailable');
    expect(gettingStartedSection?.content).toContain('reduced-motion is enabled');
  });

  it('should document selected-row GPX export options', () => {
    const uploadsSection = HELP_SECTIONS.find(section => section.id === 'uploads-and-imports');

    expect(uploadsSection?.content).toContain('CSV export, GPX export, and original-file download actions support your current multi-selection');
    expect(uploadsSection?.content).toContain('multi-selected GPX exports download as a ZIP');
  });

  it('should document how to send saved routes to Garmin', () => {
    const serviceConnectionsSection = HELP_SECTIONS.find(section => section.id === 'service-connections');

    expect(serviceConnectionsSection?.content).toContain('saved-route row and bulk sends');
    expect(serviceConnectionsSection?.content).toContain('available to every signed-in account');
    expect(serviceConnectionsSection?.content).toContain('marked **PRO**');
    expect(serviceConnectionsSection?.content).toContain('MCP is marked **FREE**');
    expect(serviceConnectionsSection?.content).toContain('can always be disconnected');
    expect(serviceConnectionsSection?.content).toContain("each account's last-reported access for supported permissions");
    expect(serviceConnectionsSection?.content).toContain('including **Training** and **Course Import**');
    expect(serviceConnectionsSection?.content).not.toMatch(/Workout Import|WORKOUT_IMPORT/);
    expect(serviceConnectionsSection?.content).not.toMatch(/MCT_EXPORT|Menstrual|Women's Health/i);
    expect(serviceConnectionsSection?.content).toContain('**Not reported**');
    expect(serviceConnectionsSection?.content).toContain('**Permission details unavailable**');
    expect(serviceConnectionsSection?.content).toContain('close that tool and select **Manage in Garmin**');
    expect(serviceConnectionsSection?.content).toContain('**Manage in Garmin**');
    expect(serviceConnectionsSection?.content).toContain('You do not need to disconnect in QS first');
    expect(serviceConnectionsSection?.content).toContain('**Reconnect** is reserved for connection recovery');
    expect(serviceConnectionsSection?.content).toContain('default to the latest **2 calendar years**');
    expect(serviceConnectionsSection?.content).toContain('COROS defaults to its full **3-month** provider limit');
    expect(serviceConnectionsSection?.content).toContain('Wahoo defaults to the latest **2 years**');
    expect(serviceConnectionsSection?.content).toContain('including the full available five-year window');
    expect(serviceConnectionsSection?.content).toContain('When a disconnect begins, automatic activity and saved-route delivery');
    expect(serviceConnectionsSection?.content).toContain('you do not need to keep the page open');
    expect(serviceConnectionsSection?.content).toContain('Health history, and Sleep sessions stay in your account');
    expect(serviceConnectionsSection?.content).toContain('shows a successful connection only after the server confirms');
    expect(serviceConnectionsSection?.content).toContain('shows an error and you can start the connection again');
    expect(serviceConnectionsSection?.content).toContain('instead of showing it as connected');
    expect(serviceConnectionsSection?.content).toContain('partial cleanup remains visible as pending');
    expect(serviceConnectionsSection?.content).toContain('an automated subscription check disconnects');
    expect(serviceConnectionsSection?.content).toContain('Services opens each provider on a compact connection overview');
    expect(serviceConnectionsSection?.content).toContain('provider tabs keep their full labels');
    expect(serviceConnectionsSection?.content).toContain('Both open Membership to review the selected price and current terms');
    expect(serviceConnectionsSection?.content).toContain('without starting checkout or connecting a provider automatically');
    expect(serviceConnectionsSection?.content).toContain('Existing disconnect, reconnect and recovery controls remain available');
    expect(serviceConnectionsSection?.content).toContain('Choose an action');
    expect(serviceConnectionsSection?.content).toContain('provider tool in a dialog');
    expect(serviceConnectionsSection?.content).toContain('unchanged overview');
    expect(serviceConnectionsSection?.content).toContain('**Your data flow**');
    expect(serviceConnectionsSection?.content).toContain('With no services connected');
    expect(serviceConnectionsSection?.content).toContain('provider-to-provider matrix');
    expect(serviceConnectionsSection?.content).toContain('On phones, the same routes are grouped by source and destination');
    expect(serviceConnectionsSection?.content).toContain('**Needs connection**');
    expect(serviceConnectionsSection?.content).toContain('Saved FIT and GPX routes can also be sent to Garmin Connect from **Routes**');
    expect(serviceConnectionsSection?.content).toContain('**Course Import** permission');
    expect(serviceConnectionsSection?.content).toContain('Routes can show a Garmin permission prompt');
    expect(serviceConnectionsSection?.content).toContain('updates the same Garmin course when you send that route again to the same Garmin account');
    expect(serviceConnectionsSection?.content).toContain('**Uploads** in Garmin Services accepts selected GPX and FIT route files');
    expect(serviceConnectionsSection?.content).toContain('uploading the same file again creates another Garmin course');
  });

  it('should document automatic and one-time Suunto route sending to Garmin', () => {
    const serviceConnectionsSection = HELP_SECTIONS.find(section => section.id === 'service-connections');

    expect(serviceConnectionsSection?.content).toContain('**Automatically send new and updated routes**');
    expect(serviceConnectionsSection?.content).toContain('direct GPX/FIT and saved-route delivery to Garmin, Suunto, Wahoo, and COROS');
    expect(serviceConnectionsSection?.content).toContain('one-time **Routes** page prompt');
    expect(serviceConnectionsSection?.content).toContain('newly imported or updated Suunto routes already saved in Quantified Self');
    expect(serviceConnectionsSection?.content).toContain('requires **Course Import** permission');
    expect(serviceConnectionsSection?.content).toContain('**Send routes** uses Suunto routes already saved in Quantified Self');
    expect(serviceConnectionsSection?.content).toContain('does not fetch routes from Suunto or any destination');
    expect(serviceConnectionsSection?.content).toContain('[Suunto routes to Garmin courses guide](/guides/sync-suunto-routes-to-garmin-courses)');
    expect(serviceConnectionsSection?.links?.some(link => link.target === '/guides/sync-suunto-routes-to-garmin-courses')).toBe(true);
  });

  it('should document opt-in Suunto saved-route delivery to Wahoo', () => {
    const serviceConnectionsSection = HELP_SECTIONS.find(section => section.id === 'service-connections');

    expect(serviceConnectionsSection?.content).toContain('Suunto Services for Garmin, Wahoo, or COROS');
    expect(serviceConnectionsSection?.content).toContain('Wahoo receives a FIT course');
    expect(serviceConnectionsSection?.content).toContain('updated Suunto route replaces its earlier Wahoo route instead of creating a duplicate');
    expect(serviceConnectionsSection?.content).toContain('automatically send new and updated Suunto routes already saved in Quantified Self to Wahoo');
    expect(serviceConnectionsSection?.content).toContain('Suunto-to-Wahoo saved-route delivery is a separate, opt-in route workflow in Suunto Services');
  });

  it('should document activity and route limits in plans and uploads help', () => {
    const plansSection = HELP_SECTIONS.find(section => section.id === 'plans-and-billing');
    const uploadsSection = HELP_SECTIONS.find(section => section.id === 'uploads-and-imports');

    expect(plansSection?.content).toContain(`Up to **${USAGE_LIMITS.free} activities**`);
    expect(plansSection?.content).toContain(`Up to **${ROUTE_USAGE_LIMITS.free} saved routes**`);
    expect(plansSection?.content).toContain(`Up to **${USAGE_LIMITS.basic.toLocaleString('en-US')} activities**`);
    expect(plansSection?.content).toContain(`Up to **${ROUTE_USAGE_LIMITS.basic} saved routes**`);
    expect(plansSection?.content).toContain('**Unlimited saved routes**');
    expect(plansSection?.content).toContain('public pricing page shows the exact trial length as an offer for eligible new members');
    expect(plansSection?.content).toContain('Trial eligibility is confirmed after sign-in');
    expect(plansSection?.content).toContain('**Monthly** or **Yearly**');
    expect(plansSection?.content).toContain('**Compare all features**');
    expect(plansSection?.content).toContain('Yearly prices show the full yearly total');
    expect(plansSection?.content).toContain('keeps that plan and billing option through sign-in and account setup');
    expect(plansSection?.content).toContain('**Your selection**');
    expect(plansSection?.content).toContain('Opening the page never starts checkout automatically');
    expect(plansSection?.content).toContain('If the selected option is no longer available, choose a current option instead');
    expect(plansSection?.content).toContain('## Complimentary extensions');
    expect(plansSection?.content).toContain('without changing the plan, creating a charge or proration, or turning automatic renewal back on');
    expect(plansSection?.content).toContain('internal admin notes are never included');
    expect(plansSection?.content).toContain('Existing activities and routes are retained. New uploads follow your current plan limits.');
    expect(uploadsSection?.content).toContain(`**Starter** includes up to **${ROUTE_USAGE_LIMITS.free} saved routes**`);
    expect(uploadsSection?.content).toContain(`**Basic** includes up to **${ROUTE_USAGE_LIMITS.basic} saved routes**`);
    expect(uploadsSection?.content).toContain("You may have reached your current plan's activity or route limit.");
    expect(uploadsSection?.content).toContain('**Upload as route** appears after active upload batches finish');
    expect(uploadsSection?.content).toContain('[FIT and GPX Route Files](/features/fit-gpx-route-files)');
    expect(uploadsSection?.content).toContain('Saved routes open from **Routes** with the details action.');
    expect(uploadsSection?.content).toContain('waypoints and turn instructions');
    expect(uploadsSection?.content).toContain('**Route actions → Send to** on Route Details');
    expect(uploadsSection?.content).toContain('**Suunto**, **COROS**, **Garmin**, and **Wahoo**');
    expect(uploadsSection?.content).toContain('Only eligible destinations appear.');
    expect(uploadsSection?.content).toContain('repeat sends are blocked until it finishes');
    expect(uploadsSection?.content).toContain('**Reconnect Wahoo** dialog');
    expect(uploadsSection?.content).toContain('successful delivery updates the destination badge');
    expect(uploadsSection?.content).toContain('parsed points and streams are not saved back to Firestore');
    expect(uploadsSection?.content).toContain('lightweight encoded route preview for route-table thumbnails, the Routes page map, and dashboard route maps');
    expect(uploadsSection?.content).toContain('Routes page map follows the current table filters using saved-route documents only');
    expect(uploadsSection?.content).toContain('does not load activity events or parse original route files');
    expect(uploadsSection?.content).toContain('Older saved routes need to be reprocessed before they appear with previews');
    expect(uploadsSection?.links).toContainEqual({
      label: 'FIT and GPX Route Files',
      icon: 'route',
      kind: 'route',
      target: '/features/fit-gpx-route-files',
    });
  });

  it('should document shared activity and route delivery with COROS in plain language', () => {
    const serviceConnectionsSection = HELP_SECTIONS.find(section => section.id === 'service-connections');

    expect(serviceConnectionsSection?.content).toContain('Integrations hub');
    expect(serviceConnectionsSection?.content).toContain('/integrations');
    expect(serviceConnectionsSection?.content).toContain('[Training Data Sync Guides](/guides)');
    expect(serviceConnectionsSection?.content).toContain('[Tools hub](/tools)');
    expect(serviceConnectionsSection?.content).toContain('[File Comparison Tool](/tools/compare)');
    expect(serviceConnectionsSection?.content).toContain('[Features hub](/features)');
    expect(serviceConnectionsSection?.content).toContain('[Workout Data Comparison](/features/workout-data-comparison)');
    expect(serviceConnectionsSection?.content).toContain('[Workout File Analyzer](/features/fit-gpx-tcx-file-analyzer)');
    expect(serviceConnectionsSection?.content).toContain('[FIT and GPX Route Files](/features/fit-gpx-route-files)');
    expect(serviceConnectionsSection?.content).toContain('[Garmin to Suunto sync guide](/guides/sync-garmin-to-suunto)');
    expect(serviceConnectionsSection?.content).toContain('[COROS to Suunto sync guide](/guides/sync-coros-to-suunto)');
    expect(serviceConnectionsSection?.content).toContain('[Wahoo to Suunto sync guide](/guides/sync-wahoo-to-suunto)');
    expect(serviceConnectionsSection?.content).toContain('**Send past activities** under **Suunto**');
    expect(serviceConnectionsSection?.content).toContain('keeps Wahoo selected through sign-in and required onboarding');
    expect(serviceConnectionsSection?.content).toContain('Preview sends nothing; review delivery in **Recent sends**');
    expect(serviceConnectionsSection?.content).toContain('[import activities to Suunto guide](/guides/import-activities-to-suunto)');
    expect(serviceConnectionsSection?.content).toContain('[import activities to Wahoo guide](/guides/import-activities-to-wahoo)');
    expect(serviceConnectionsSection?.content).toContain('[centralized workout data guide](/guides/centralize-garmin-suunto-coros-workout-data)');
    expect(serviceConnectionsSection?.content).toContain('uploaded FIT/TCX/GPX/JSON/SML activity files');
    expect(serviceConnectionsSection?.content).toContain('reviewer workflows for device tests, YouTube videos, and blog posts');
    expect(serviceConnectionsSection?.content).toContain(`Manual uploads, core analysis, and benchmark comparisons are available on the free plan for up to ${USAGE_LIMITS.free} activities and ${ROUTE_USAGE_LIMITS.free} saved routes`);
    expect(serviceConnectionsSection?.content).toContain('automatic provider sync and higher limits require a paid plan');
    expect(serviceConnectionsSection?.content).not.toContain('source-file workflows, AI insights, and reviewer workflows');
    expect(serviceConnectionsSection?.content).toContain('[Garmin Integration](/integrations/garmin)');
    expect(serviceConnectionsSection?.content).toContain('[COROS Integration](/integrations/coros)');
    expect(serviceConnectionsSection?.content).toContain('/integrations/suunto');
    expect(serviceConnectionsSection?.content).toContain('[Policies -> Connected Services](/policies#connected-services-data)');
    expect(serviceConnectionsSection?.content).toContain('[Policies -> Garmin Data](/policies#garmin-data)');
    expect(serviceConnectionsSection?.content).toContain('[Policies -> Suunto Data](/policies#suunto-data)');
    expect(serviceConnectionsSection?.content).toContain('[Policies -> COROS Data](/policies#coros-data)');
    expect(serviceConnectionsSection?.content).toContain('[AI & Third-Party Processing](/policies#ai-and-third-party-processing)');
    expect(serviceConnectionsSection?.content).toContain('Saved FIT and GPX routes can be sent to Suunto from **Routes**');
    expect(serviceConnectionsSection?.content).toContain('**Uploads** in Suunto Services also accepts a selected GPX or FIT route');
    expect(serviceConnectionsSection?.content).toContain('converts a selected FIT route to GPX in memory before delivery');
    expect(serviceConnectionsSection?.content).toContain('row action or the selected-row bulk toolbar');
    expect(serviceConnectionsSection?.content).toContain('uses the saved Quantified Self route name as the route name sent to Suunto');
    expect(serviceConnectionsSection?.content).toContain('Bulk sends upload routes one at a time');
    expect(serviceConnectionsSection?.content).toContain('Garmin to Suunto activity sync requires');
    expect(serviceConnectionsSection?.content).toContain('allow Activity Export in Garmin');
    expect(serviceConnectionsSection?.content).toContain('open **Send past activities** under the destination service in Services');
    expect(serviceConnectionsSection?.content).toContain('Only retained FIT files are eligible');
    expect(serviceConnectionsSection?.content).toContain('Preview checks saved activities in batches');
    expect(serviceConnectionsSection?.content).toContain('**Send** becomes available after the full preview finishes');
    expect(serviceConnectionsSection?.content).toContain('stopping a preview sends nothing');
    expect(serviceConnectionsSection?.content).toContain('Checks against unrelated sources are not counted as exclusions');
    expect(serviceConnectionsSection?.content).toContain('Reason counts are by source');
    expect(serviceConnectionsSection?.content).toContain('explains why it is disabled');
    expect(serviceConnectionsSection?.content).toContain('failed checks can be retried with **Preview**');
    expect(serviceConnectionsSection?.content).toContain('send past activities while automatic activity sync is off');
    expect(serviceConnectionsSection?.content).toContain('dashboard may offer a one-time action prompt to turn on automatic Garmin to Suunto activity sync');
    expect(serviceConnectionsSection?.content).toContain('Disconnecting Garmin, COROS, Suunto, or Wahoo turns off related automatic activity or route delivery');
    expect(serviceConnectionsSection?.content).toContain('Sleep is synced automatically from your connected services');
    expect(serviceConnectionsSection?.content).toContain('automatically importing daily Health and sleep data from a rolling recent window');
    expect(serviceConnectionsSection?.content).toContain('importing available COROS Sleep and Health history from the last three months');
    expect(serviceConnectionsSection?.content).toContain('COROS does not send sleep stages through this connection');
    expect(serviceConnectionsSection?.content).toContain('14d, 30d, 90d, and 1y range control');
    expect(serviceConnectionsSection?.content).toContain('independent from dashboard event filters');
    expect(serviceConnectionsSection?.content).toContain('overlays available vitals');
    expect(serviceConnectionsSection?.content).toContain('average sleep heart rate');
    expect(serviceConnectionsSection?.content).toContain('minimum sleep heart rate');
    expect(serviceConnectionsSection?.content).toContain('range-average reference lines');
    expect(serviceConnectionsSection?.content).toContain('max SpO2');
    expect(serviceConnectionsSection?.content).toContain('see **Sleep & daily Health history**');
    expect(serviceConnectionsSection?.content).toContain('Import Sleep history');
    expect(serviceConnectionsSection?.content).toContain('Sleep & 24/7 Health history');
    expect(serviceConnectionsSection?.content).toContain('Sleep & available Health history');
    expect(serviceConnectionsSection?.content).toContain('available HRV readings in Health');
    expect(serviceConnectionsSection?.content).toContain('Connected Suunto users see **Sleep & 24/7 Health history**');
    expect(serviceConnectionsSection?.content).toContain('Body Energy Balance');
    expect(serviceConnectionsSection?.content).toContain('separate from workout FIT metrics and Sleep sessions');
    expect(serviceConnectionsSection?.content).toContain('without keeping the full content of incoming notifications');
    expect(serviceConnectionsSection?.content).toContain('import the available last three months');
    expect(serviceConnectionsSection?.content).toContain('Jan 1, 2000');
    expect(serviceConnectionsSection?.content).toContain('up to the latest rolling five years');
    expect(serviceConnectionsSection?.content).toContain('Garmin may allow a shorter range');
    expect(serviceConnectionsSection?.content).not.toContain('2016');
    expect(serviceConnectionsSection?.content).toContain('7-day cooldown');
    expect(serviceConnectionsSection?.content).toContain('30-day cooldown');
    expect(serviceConnectionsSection?.content).toContain('**Import history from this service** is selected by default');
    expect(serviceConnectionsSection?.content).toContain('Garmin supports up to its latest rolling five years');
    expect(serviceConnectionsSection?.content).toContain('COROS up to its latest rolling three months');
    expect(serviceConnectionsSection?.content).toContain('Suunto and Wahoo offer all history the provider makes available');
    expect(serviceConnectionsSection?.content).toContain('Individual record failures normally do not stop the remaining history pages');
    expect(serviceConnectionsSection?.content).toContain('retries those records without restarting completed pages');
    expect(serviceConnectionsSection?.content).toContain('Authorization or connection changes still stop the affected work');
    expect(serviceConnectionsSection?.content).toContain('never expands automatically');
    expect(serviceConnectionsSection?.content).toContain('one-time dashboard prompt');
    expect(serviceConnectionsSection?.content).toContain('only the latest rolling **5 years** of activity data');
    expect(serviceConnectionsSection?.content).toContain('does not support an arbitrary older five-year period');
    expect(serviceConnectionsSection?.content).toContain('While Garmin activity history is being requested, another request is blocked');
    expect(serviceConnectionsSection?.content).toContain('Closing the dialog does not cancel the request');
    expect(serviceConnectionsSection?.content).toContain('usual **30-day cooldown** applies while activities continue arriving from Garmin');
    expect(serviceConnectionsSection?.content).toContain('Garmin Sleep and Health history import is separate from activity history import');
    expect(serviceConnectionsSection?.content).toContain('If Garmin Health is temporarily disabled, the control falls back to **Import Sleep history**');
    expect(serviceConnectionsSection?.content).toContain('COROS to Suunto activity sync requires');
    expect(serviceConnectionsSection?.content).toContain('keeps COROS selected through sign-in and required onboarding');
    expect(serviceConnectionsSection?.content).toContain('select **COROS API** in **Activity sources**');
    expect(serviceConnectionsSection?.content).toContain('older saved activities can still be sent');
    expect(serviceConnectionsSection?.content).toContain('COROS FIT activity uploads in Services are asynchronous and use per-file status');
    expect(serviceConnectionsSection?.content).toContain('Background activity delivery retries a confirmed COROS processing failure');
    expect(serviceConnectionsSection?.content).toContain('Pending uploads are checked without sending the file again');
    expect(serviceConnectionsSection?.content).toContain('An explicit unsupported-file rejection is not retried');
    expect(serviceConnectionsSection?.content).toContain('short provider upload pacing');
    expect(serviceConnectionsSection?.content).toContain('checks that same upload first instead of posting the FIT again');
    expect(serviceConnectionsSection?.content).toContain('### Activity types COROS accepts');
    expect(serviceConnectionsSection?.content).toContain('Run, Indoor Run, Trail Run, Track Run, and Hike');
    expect(serviceConnectionsSection?.content).toContain('Pool Swim and Open Water Swim');
    expect(serviceConnectionsSection?.content).toContain('Stand Up Paddling may appear as **Other**');
    expect(serviceConnectionsSection?.content).toContain('**Snorkeling as Open Water Swim**');
    expect(serviceConnectionsSection?.content).toContain('**Sailing as GPS Cardio**');
    expect(serviceConnectionsSection?.content).toContain('for both direct uploads and activity sync');
    expect(serviceConnectionsSection?.content).toContain('your retained original FIT and activity type in Quantified Self stay unchanged');
    expect(serviceConnectionsSection?.content).toContain('**Snorkeling as Open Water Swim** with or without recorded GPS');
    expect(serviceConnectionsSection?.content).toContain('**Sailing as GPS Cardio** only with recorded GPS');
    expect(serviceConnectionsSection?.content).toContain('**Fishing as GPS Cardio** only with recorded GPS');
    expect(serviceConnectionsSection?.content).toContain('**Diving as Generic** with or without recorded GPS');
    expect(serviceConnectionsSection?.content).toContain('COROS may not display every field or a dive profile');
    expect(serviceConnectionsSection?.content).toContain('missing GPS is not added');
    expect(serviceConnectionsSection?.content).toContain('GPS-less Sailing or Fishing, mixed/multi-session, malformed and other activity types');
    expect(serviceConnectionsSection?.content).toContain('COROS currently reports these processing failures only as a generic failed status');
    expect(serviceConnectionsSection?.content).toContain('https://support.coros.com/hc/en-us/articles/360040256971-How-to-Import-Activities-to-Your-COROS-Account');
    expect(serviceConnectionsSection?.content).toContain('uploading selected GPX or FIT routes to COROS');
    expect(serviceConnectionsSection?.content).toContain('sending saved routes to COROS individually or in selected-row bulk batches');
    expect(serviceConnectionsSection?.content).toContain('The COROS Services card offers **Send past activities**');
    expect(serviceConnectionsSection?.content).toContain('Automatic delivery remains off unless you enable it separately');
    expect(serviceConnectionsSection?.content).toContain('one active connected account');
    expect(serviceConnectionsSection?.content).toContain('asks COROS whether that account is still bound');
    expect(serviceConnectionsSection?.content).toContain('related automatic activity and saved-route settings turn off');
    expect(serviceConnectionsSection?.content).toContain('temporary check failure shows **Retry**');
    expect(serviceConnectionsSection?.content).toContain('Connection checks pause while you connect or disconnect');
    expect(serviceConnectionsSection?.content).toContain('Results from an earlier connection do not replace the current connection status');
    expect(serviceConnectionsSection?.content).toContain('recover a missing or expired COROS FIT download link');
    expect(serviceConnectionsSection?.content).toContain('mode, submode, device, source timezones, training-plan workout ID, and multisport component');
    expect(serviceConnectionsSection?.content).toContain('cycling-family routes use bike');
    expect(serviceConnectionsSection?.content).toContain('exact-file and semantic FIT fingerprints');
    expect(serviceConnectionsSection?.content).toContain('expire after about 120 days');
    expect(serviceConnectionsSection?.content).toContain('**Activity sync settings → To Suunto** under COROS in **Connections**');
    expect(serviceConnectionsSection?.content).toContain('Automatic sync runs only for newly imported COROS activities');
    expect(serviceConnectionsSection?.content).toContain('**Send past activities** is available under the Suunto or Wahoo destination card');
    expect(serviceConnectionsSection?.content).toContain('send past activities while automatic activity sync is off');
    expect(serviceConnectionsSection?.content).toContain('dashboard may offer a one-time action prompt to turn on automatic COROS to Suunto activity sync');
    expect(serviceConnectionsSection?.content).toContain('Wahoo to Suunto or COROS activity sync requires');
    expect(serviceConnectionsSection?.content).toContain('turn on automatic activity sync in Wahoo Services');
    expect(serviceConnectionsSection?.content).toContain('use Wahoo activities with a retained original FIT file');
    expect(serviceConnectionsSection?.content).toContain('Automatic sync runs only for newly imported eligible Wahoo activities');
    expect(serviceConnectionsSection?.content).toContain('**Send past activities** under the Suunto or COROS destination card');
    expect(serviceConnectionsSection?.content).toContain('authorize the same Wahoo account');
    expect(serviceConnectionsSection?.content).toContain('disconnect the retained account first');
    expect(serviceConnectionsSection?.content).toContain('Suunto users can turn on **Automatically send new and updated routes** in Suunto Services for Garmin, Wahoo, or COROS');
    expect(serviceConnectionsSection?.content).toContain('COROS activity upload, activity delivery, and route delivery are available to all eligible connected Pro users');
    expect(serviceConnectionsSection?.content).not.toMatch(/COROS[^.]*\bpilot\b|\bpilot\b[^.]*COROS/i);
    expect(serviceConnectionsSection?.content).toContain('Every destination is opt-in and off by default');
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Integrations',
      icon: 'hub',
      kind: 'route',
      target: '/integrations',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Features',
      icon: 'dashboard_customize',
      kind: 'route',
      target: '/features',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Training Guides',
      icon: 'menu_book',
      kind: 'route',
      target: '/guides',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Workout Data Comparison',
      icon: 'compare_arrows',
      kind: 'route',
      target: '/features/workout-data-comparison',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Compare Files Tool',
      icon: 'compare_arrows',
      kind: 'route',
      target: '/tools/compare',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Workout File Analyzer',
      icon: 'analytics',
      kind: 'route',
      target: '/features/fit-gpx-tcx-file-analyzer',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'FIT and GPX Route Files',
      icon: 'route',
      kind: 'route',
      target: '/features/fit-gpx-route-files',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Import Activities to Suunto',
      icon: 'upload_file',
      kind: 'route',
      target: '/guides/import-activities-to-suunto',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Import Activities to Wahoo',
      icon: 'upload_file',
      kind: 'route',
      target: '/guides/import-activities-to-wahoo',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Garmin to Suunto Guide',
      icon: 'sync_alt',
      kind: 'route',
      target: '/guides/sync-garmin-to-suunto',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'COROS to Suunto Guide',
      icon: 'published_with_changes',
      kind: 'route',
      target: '/guides/sync-coros-to-suunto',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Wahoo to Suunto Guide',
      icon: 'directions_bike',
      kind: 'route',
      target: '/guides/sync-wahoo-to-suunto',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Centralize Workout Data',
      icon: 'hub',
      kind: 'route',
      target: '/guides/centralize-garmin-suunto-coros-workout-data',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Garmin Integration',
      icon: 'sync_alt',
      kind: 'route',
      target: '/integrations/garmin',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Suunto Integration',
      icon: 'published_with_changes',
      kind: 'route',
      target: '/integrations/suunto',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'COROS Integration',
      icon: 'sync',
      kind: 'route',
      target: '/integrations/coros',
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Connected Service Privacy',
      icon: 'policy',
      kind: 'route',
      target: '/policies',
      fragment: POLICIES_CONNECTED_SERVICES_FRAGMENT,
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Garmin Data Privacy',
      icon: 'policy',
      kind: 'route',
      target: '/policies',
      fragment: POLICIES_GARMIN_DATA_FRAGMENT,
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'Suunto Data Privacy',
      icon: 'policy',
      kind: 'route',
      target: '/policies',
      fragment: POLICIES_SUUNTO_DATA_FRAGMENT,
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'COROS Data Privacy',
      icon: 'policy',
      kind: 'route',
      target: '/policies',
      fragment: POLICIES_COROS_DATA_FRAGMENT,
    });
    expect(serviceConnectionsSection?.links).toContainEqual({
      label: 'AI & Processors',
      icon: 'shield',
      kind: 'route',
      target: '/policies',
      fragment: POLICIES_AI_AND_PROCESSORS_FRAGMENT,
    });
  });

  it('should explain that connection screens use the safe account summary', () => {
    const gettingStartedSection = HELP_SECTIONS.find(section => section.id === 'getting-started');

    expect(gettingStartedSection?.content).toContain('Connection screens use a limited account summary once it is available');
    expect(gettingStartedSection?.content).toContain('existing connections continue to work');
  });

  it('documents Wahoo FIT imports, activity and route delivery, skip rules, and retained imported activities', () => {
    const serviceConnectionsSection = HELP_SECTIONS.find(section => section.id === 'service-connections');
    expect(serviceConnectionsSection?.content).toContain('## Wahoo');
    expect(serviceConnectionsSection?.content).toContain('Manual **Garmin**, **Suunto**, **COROS** and **Wahoo** activity imports use the same background processing');
    expect(serviceConnectionsSection?.content).toContain('one page at a time');
    expect(serviceConnectionsSection?.content).toContain('Acceptance means the request is saved, not that every activity has arrived');
    expect(serviceConnectionsSection?.content).toContain('wait for queued activities before reporting completion');
    expect(serviceConnectionsSection?.content).toContain('Workouts without a FIT file are skipped');
    expect(serviceConnectionsSection?.content).toContain('Services shows **Import already running** and prevents another request');
    expect(serviceConnectionsSection?.content).toContain('Closing the dialog does not cancel the import');
    expect(serviceConnectionsSection?.content).toContain('queued activities continue processing in the background');
    expect(serviceConnectionsSection?.content).toContain('does **not** delete activities already imported');
    expect(serviceConnectionsSection?.content).toContain('send a FIT activity file directly to Wahoo');
    expect(serviceConnectionsSection?.content).toContain('accepted upload IDs are checked without sending another copy');
    expect(serviceConnectionsSection?.content).toContain('Wahoo rejects repeated token refreshes');
    expect(serviceConnectionsSection?.content).toContain('keeps unaccepted automatic activity and saved-route deliveries parked');
    expect(serviceConnectionsSection?.content).toContain('does not turn your saved route settings off');
    expect(serviceConnectionsSection?.content).toContain('automatically synced from Garmin, COROS, or Suunto');
    expect(serviceConnectionsSection?.content).toContain("keeps Wahoo's inferred type instead of guessing");
    expect(serviceConnectionsSection?.content).toContain('parses the FIT on the server');
    expect(serviceConnectionsSection?.content).toContain('Review the recording and mapped Wahoo category before confirmation');
    expect(serviceConnectionsSection?.content).toContain('preserves the existing Wahoo workout title');
    expect(serviceConnectionsSection?.content).toContain('send a GPX or FIT course or route file directly to Wahoo');
    expect(serviceConnectionsSection?.content).toContain('select **Reconnect Wahoo** in the displayed dialog');
    expect(serviceConnectionsSection?.content).toContain('Direct course/route delivery accepts GPX and FIT files');
    expect(serviceConnectionsSection?.content).toContain('not the ELEMNT App');
    expect(serviceConnectionsSection?.content).toContain('Garmin, COROS, or Suunto activities');
    expect(serviceConnectionsSection?.content).toContain('automatically send new Wahoo activities to Suunto');
    expect(serviceConnectionsSection?.content).toContain('Wahoo-origin FIT activities can be delivered to Suunto or COROS after explicit opt-in');
    expect(serviceConnectionsSection?.content).toContain('Wahoo **Training** delivery is available to connected Pro members');
    expect(serviceConnectionsSection?.content).toContain('Wahoo-owned plans are not imported');
    expect(serviceConnectionsSection?.links).toContainEqual(expect.objectContaining({
      target: '/guides/sync-wahoo-to-suunto',
    }));
    expect(serviceConnectionsSection?.content).toContain('[Wahoo Integration](/integrations/wahoo)');
    expect(serviceConnectionsSection?.links).toContainEqual(expect.objectContaining({
      target: '/policies',
      fragment: POLICIES_WAHOO_DATA_FRAGMENT,
    }));
  });

  it('should expose provider-specific privacy links from the data-and-privacy section', () => {
    const dataAndPrivacySection = HELP_SECTIONS.find(section => section.id === 'data-and-privacy');

    expect(dataAndPrivacySection?.content).toContain('[Garmin Data](/policies#garmin-data)');
    expect(dataAndPrivacySection?.content).toContain('[Suunto Data](/policies#suunto-data)');
    expect(dataAndPrivacySection?.content).toContain('[COROS Data](/policies#coros-data)');
    expect(dataAndPrivacySection?.content).toContain('[Policies -> MCP Client Access](/policies#mcp-clients)');
    expect(dataAndPrivacySection?.content).toContain('[AI & Third-Party Processing](/policies#ai-and-third-party-processing)');
    expect(dataAndPrivacySection?.links).toContainEqual({
      label: 'Garmin Data Privacy',
      icon: 'policy',
      kind: 'route',
      target: '/policies',
      fragment: POLICIES_GARMIN_DATA_FRAGMENT,
    });
    expect(dataAndPrivacySection?.links).toContainEqual({
      label: 'Suunto Data Privacy',
      icon: 'policy',
      kind: 'route',
      target: '/policies',
      fragment: POLICIES_SUUNTO_DATA_FRAGMENT,
    });
    expect(dataAndPrivacySection?.links).toContainEqual({
      label: 'COROS Data Privacy',
      icon: 'policy',
      kind: 'route',
      target: '/policies',
      fragment: POLICIES_COROS_DATA_FRAGMENT,
    });
    expect(dataAndPrivacySection?.links).toContainEqual({
      label: 'MCP Client Access',
      icon: 'devices',
      kind: 'route',
      target: '/policies',
      fragment: POLICIES_MCP_CLIENTS_FRAGMENT,
    });
    expect(dataAndPrivacySection?.links).toContainEqual({
      label: 'AI & Processors',
      icon: 'shield',
      kind: 'route',
      target: '/policies',
      fragment: POLICIES_AI_AND_PROCESSORS_FRAGMENT,
    });
  });

  it('documents MCP scopes, redaction, and revocation', () => {
    const dataAndPrivacySection = HELP_SECTIONS.find(section => section.id === 'data-and-privacy');

    expect(dataAndPrivacySection?.content).toContain('**Activity and Training metrics**');
    expect(dataAndPrivacySection?.content).toContain('**Body measurements**');
    expect(dataAndPrivacySection?.content).toContain('**Individual activity details**');
    expect(dataAndPrivacySection?.content).toContain('**Activity locations**');
    expect(dataAndPrivacySection?.content).toContain('**Sleep summaries**');
    expect(dataAndPrivacySection?.content).toContain('**Saved-route summaries**');
    expect(dataAndPrivacySection?.content).toContain('**Saved-route locations and geometry**');
    expect(dataAndPrivacySection?.content).toContain(
      'Precise latitude/longitude and first-class body-measurement metrics are excluded',
    );
    expect(dataAndPrivacySection?.content).toContain('up to 25 explicitly selected canonical numeric Sports Lib metrics');
    expect(dataAndPrivacySection?.content).toContain('first-class body-measurement history');
    expect(dataAndPrivacySection?.content).toContain('Removing any parent removes its dependent children');
    expect(dataAndPrivacySection?.content).toContain('**Change events** is a separate child permission');
    expect(dataAndPrivacySection?.content).toContain('benchmark events are read-only');
    expect(dataAndPrivacySection?.content).toContain('bounded ranges up to 366 days');
    expect(dataAndPrivacySection?.content).toContain('identity-free day, week, or month values');
    expect(dataAndPrivacySection?.content).toContain('provider or manual canonical Health Weight point measurements');
    expect(dataAndPrivacySection?.content).toContain('not workout profile fallback');
    expect(dataAndPrivacySection?.content).toContain('not a medical or health assessment');
    expect(dataAndPrivacySection?.content).toContain('exact source measurement timestamps');
    expect(dataAndPrivacySection?.content).toContain('provider/device metadata');
    expect(dataAndPrivacySection?.content).toContain('bounded chart-ready heart-rate');
    expect(dataAndPrivacySection?.content).toContain('canonical Sports Lib activity types');
    expect(dataAndPrivacySection?.content).toContain('filter newest-first activity scans');
    expect(dataAndPrivacySection?.content).toContain('explicit IANA timezone');
    expect(dataAndPrivacySection?.content).toContain('complete no-match result');
    expect(dataAndPrivacySection?.content).toContain('your latest run');
    expect(dataAndPrivacySection?.content).toContain('today’s or yesterday’s workouts');
    expect(dataAndPrivacySection?.content).toContain('standard activity list with the same date and sport filters');
    expect(dataAndPrivacySection?.content).toContain('Do not repeatedly retry the rejected query');
    expect(dataAndPrivacySection?.content).toContain('case-insensitive part of the route name');
    expect(dataAndPrivacySection?.content).toContain('older history');
    expect(dataAndPrivacySection?.content).toContain('without a reparse, backfill, cache');
    expect(dataAndPrivacySection?.content).toContain('imported device/provider source keys are removed');
    expect(dataAndPrivacySection?.content).toContain('exact activity start/end coordinates');
    expect(dataAndPrivacySection?.content).toContain('nearby activity searches');
    expect(dataAndPrivacySection?.content).toContain('MTB jump coordinates');
    expect(dataAndPrivacySection?.content).toContain('home, workplace, frequent trailhead');
    expect(dataAndPrivacySection?.content).toContain('Saved-route summary access');
    expect(dataAndPrivacySection?.content).toContain('Saved-route location access');
    expect(dataAndPrivacySection?.content).toContain('simplified preview geometry');
    expect(dataAndPrivacySection?.content).toContain('segment endpoints');
    expect(dataAndPrivacySection?.content).toContain('waypoint coordinates');
    expect(dataAndPrivacySection?.content).toContain('location text to Mapbox for forward geocoding');
    expect(dataAndPrivacySection?.content).toContain('does not send activity, route, account, or prompt data');
    expect(dataAndPrivacySection?.content).toContain('Original files');
    expect(dataAndPrivacySection?.content).toContain('full-resolution recordings');
    expect(dataAndPrivacySection?.content).toContain('**Health metrics**');
    expect(dataAndPrivacySection?.content).toContain('Existing clients must reconnect to grant Health access');
    expect(dataAndPrivacySection?.content).toContain('Body composition also needs **Body measurements**');
    expect(dataAndPrivacySection?.content).toContain('exact UTC times');
    expect(dataAndPrivacySection?.content).toContain('raw sleep-stage intervals');
    expect(dataAndPrivacySection?.content).toContain('[**Connections -> MCP**](/services?serviceName=mcp)');
    expect(dataAndPrivacySection?.content).toContain('Only clients that finish authorization appear');
    expect(dataAndPrivacySection?.content).toContain('keeps its current grant usable');
    expect(dataAndPrivacySection?.content).toContain('instead of creating another logical connection');
    expect(dataAndPrivacySection?.content).toContain('Failed or abandoned authorization attempts');
    expect(dataAndPrivacySection?.content).toContain('do not replace an existing grant');
    expect(dataAndPrivacySection?.content).toContain('standard server-to-server token revocation');
    expect(dataAndPrivacySection?.content).toContain('Disconnect** in Connections remains the authoritative control');
    expect(dataAndPrivacySection?.content).toContain('any older duplicate records');
    expect(dataAndPrivacySection?.content).toContain('without affecting your other MCP clients');
  });

  it('directs account deletion to Data management and its confirmation dialog', () => {
    const dataAndPrivacySection = HELP_SECTIONS.find(section => section.id === 'data-and-privacy');

    expect(dataAndPrivacySection?.content).toContain('[Settings → Data management](/settings?section=data-management)');
    expect(dataAndPrivacySection?.content).toContain('choose **Delete account…**');
    expect(dataAndPrivacySection?.content).toContain('Review the consequences and confirm in the dialog');
    expect(dataAndPrivacySection?.content).not.toContain('Danger Zone');
  });

  it('should explain public event and comparison sharing exposure', () => {
    const dataAndPrivacySection = HELP_SECTIONS.find(section => section.id === 'data-and-privacy');

    expect(dataAndPrivacySection?.content).toContain('Event and saved comparison sharing is manual');
    expect(dataAndPrivacySection?.content).toContain('activity actions button shows a spinner while sharing is being updated');
    expect(dataAndPrivacySection?.content).toContain('every object stored under that event\'s source-file folder');
    expect(dataAndPrivacySection?.content).toContain('users/{uid}/events/{eventId}/...');
    expect(dataAndPrivacySection?.content).toContain('Use **Stop sharing**');
    expect(dataAndPrivacySection?.content).toContain('cannot generate or save new reports');
  });
});

it('explains separately approved activity description access and event semantics', () => {
  const content = JSON.stringify(HELP_SECTIONS);
  expect(content).toContain('**Activity descriptions**');
  expect(content).toContain('Activities in the same event share that description');
  expect(content).toContain('refresh cannot add it');
  expect(content).toContain('without truncation');




});

  it('explains early Lap separately from indefinite Lap and gates unsupported delivery', () => {
    const content = JSON.stringify(HELP_SECTIONS);
    expect(content).toContain('**Also finish this step with Lap**');
    expect(content).not.toContain('**Allow early Lap**');
    expect(content).toContain('when off, the Suunto Guide waits for the numeric limit and Lap does not start the next step');
    expect(content).toContain('Work ends at 100 m **or** when you press Lap');
    expect(content).toContain('Leave each Rest at **Time -> 15 seconds**, with the option unchecked');
    expect(content).toContain('Lap finishes the current Work step and starts Rest; it is not needed to start swimming');
    expect(content).toContain('no numeric limit');
    expect(content).toContain('Suunto delivery supports the early-Lap option');
    expect(content).toContain('Garmin, COROS and Wahoo');
    expect(content).toContain('explicitly review enabling or removing');
    expect(content).toContain('With **Also finish this step with Lap** off, pressing Lap');
    expect(content).toContain('With it enabled, Lap ends that step early');
    expect(content).toContain('generated time/distance alerts also mention Lap');
  });

it('documents durable activity sending, explicit review, Pro and retention', () => {
  const content = HELP_SECTIONS.map(section => section.content).join('\n');
  for (const text of ['/send-activities', '20 MiB compressed and expanded', '200 MiB', '24 hours', 'seven days', '30 days', 'Unknown acceptance', 'Stop unsent activities', 'rather than Basic', 'temporary storage cleanup continues in the background', 'Start a new send to add a file you removed']) expect(content).toContain(text);
  expect(content).not.toContain('upload rows are not retained across reloads');
  expect(content).toContain('A temporary file-read failure pauses the preview without excluding the recording');
  expect(content).toContain('If opening a new draft fails, reopen it from **Recent sends**');
  expect(content).toContain('If you switch destinations, sources or sends during preparation, reopen the original draft to continue');
  expect(content).toContain('Stopping closes retries and removes that temporary copy, freeing its storage allowance');
  expect(content).toContain('If an accepted upload fails after you stop the batch, its temporary copy is removed when that failure is confirmed');
  expect(content).toContain('**Delivery details** retain recorded send attempts and processing retries across explicit retries');
  expect(content).toContain('cleanup resumes automatically after partial failures');
  expect(content).toContain('Temporary Suunto initialization errors are retried automatically, within a limited retry budget, before any recording bytes are sent');
  expect(content).toContain('unknown acceptance never triggers an automatic replacement upload');
  expect(content).toContain('Previewing does not send activities');
  expect(content).toContain('**checked**, **ready**, and **excluded** recordings, not successful deliveries');
  expect(content).toContain('completed checks are retained');
  expect(content).toContain('Choose **Uploaded to QS** for FIT files you imported yourself');
  expect(content).toContain('**Garmin API** selects recordings imported through the Garmin connection');
});

it('explains explicit family shortcuts and the climbing default display rule', () => {
  const section = HELP_SECTIONS.find(section => section.id === 'supported-activities');
  for (const phrase of ['**All Running / Trail**', '**All Cycling / MTB**', '**All Walking / Hiking**', 'Existing saved individual selections stay exact', 'partial check', 'full stats, exports, and explicitly selected metrics', 'unconfigured lap columns', 'saved lap columns', 'Floor Climbing']) {
    expect(section?.content).toContain(phrase);
  }
});

describe('nightly HRV history help', () => {
  it('explains the primary view, secondary measurements and QS attribution', () => {
    const health = HELP_SECTIONS.find(section => section.id === 'health')!.content;
    for (const phrase of ['**HRV history** opens one **Overnight HRV** source', '**Latest night**',
      '**60-day personal range**', '**Learning your range**', 'Spot check: overall variation',
      'These are different measurements with separate histories', 'accounts and baselines separate']) expect(health).toContain(phrase);
  });
});


describe('dashboard performance history guidance', () => {
  it('documents reused history, context isolation and recorded VO2 semantics', () => {
    const content = JSON.stringify(HELP_SECTIONS);
    expect(content).toContain('preceding 42 completed UTC days');
    expect(content).toContain('A saved context is retained when its evidence disappears');
    expect(content).toContain('provider estimates and manually recorded tests retain their separate meanings');
  });
});
