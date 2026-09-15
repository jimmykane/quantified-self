import { describe, expect, it } from 'vitest';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { TRAINING_RECIPE_SCHEMA } from './training-plans.schemas';

const recipe = (ending: unknown, targets: unknown[] = []) => ({ version: 1, sport: ActivityTypes.Running,
  nodes: [{ kind: 'step', id: 'step-1', purpose: 'work', ending, targets, note: '夜の練習 🏃\nPrivate context' }] });
describe('Strict public Training recipe v1', () => {
  it.each([{ kind:'time', seconds:60 }, { kind:'distance', meters:1000 }, { kind:'kilojoules', kilojoules:50 },
    { kind:'repetitions', repetitions:10 }, { kind:'manual' }])('preserves ending %j and full Unicode text through JSON', ending => {
    const input = recipe(ending);
    expect(TRAINING_RECIPE_SCHEMA.parse(JSON.parse(JSON.stringify(input)))).toEqual(input);
  });
  it.each([
    { kind:'heart-rate', mode:'absolute', minimumBpm:120, maximumBpm:140 },
    { kind:'heart-rate', mode:'relative', minimumPercent:60, maximumPercent:80, reference:{kind:'max-heart-rate',bpm:180} },
    { kind:'power', mode:'absolute', minimumWatts:0, maximumWatts:150 },
    { kind:'power', mode:'relative', minimumPercent:0, maximumPercent:80, reference:{kind:'critical-power',watts:250} },
    { kind:'speed', mode:'absolute', minimumMetersPerSecond:3, maximumMetersPerSecond:4, presentation:'pace' },
    { kind:'speed', mode:'relative', minimumPercent:80, maximumPercent:90, reference:{kind:'threshold-speed',metersPerSecond:4},presentation:'speed' },
    { kind:'cadence', mode:'absolute', minimumRpm:70, maximumRpm:90 },
    { kind:'cadence', mode:'relative', minimumPercent:80, maximumPercent:90, reference:{kind:'preferred-cadence',rpm:90} },
  ])('preserves canonical target %j without provider or display fields in the recipe', target => {
    const input = recipe({ kind:'manual' }, [target]);
    expect(TRAINING_RECIPE_SCHEMA.parse(input)).toEqual(input);
    expect(TRAINING_RECIPE_SCHEMA.safeParse(recipe({kind:'manual'},[{...target,remoteId:'PRIVATE'}])).success).toBe(false);
  });
  it('rejects malformed versions, discriminants, repeats, IDs, ranges and leaked neighbors', () => {
    const input = recipe({kind:'time',seconds:60}), step = input.nodes[0];
    for (const bad of [ {...input,version:2}, {...input,sport:'unknown'}, {...input,provider:'PRIVATE'},
      {...input,nodes:[step,step]}, {...input,nodes:[{...step,id:'a/b'}]},
      recipe({kind:'time',seconds:Infinity}), recipe({kind:'time',seconds:-1}), recipe({kind:'other'}),
      recipe({kind:'manual'},[{kind:'power',mode:'absolute',minimumWatts:200,maximumWatts:100}]),
      {...input,nodes:[{...step,note:'x'.repeat(501)}]},
      {...input,nodes:[{kind:'repeat',id:'repeat',count:101,steps:[step]}]},
      {...input,nodes:[{kind:'repeat',id:'repeat',count:2,steps:[{kind:'repeat',id:'nested',count:2,steps:[step]}]}]},
      {...input,nodes:Array.from({length:101},(_,i)=>({...step,id:`s${i}`}))},
    ]) expect(TRAINING_RECIPE_SCHEMA.safeParse(bad).success).toBe(false);
  });
});
