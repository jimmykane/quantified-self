import { describe, expect, it } from 'vitest';
import { ActivityTypes, WeightUnits } from '@sports-alliance/sports-lib';
import type { WorkoutStepV1 } from '../../../../shared/planned-workout';
import type { ScheduledWorkoutV1 } from '../../../../shared/training-plans';
import { projectStrengthWorkoutToV1 } from '../../../../shared/strength-workout';
import { defaultSuuntoSwimmingGuideSettings } from '../../../../shared/suunto-swimming-guide-settings';
import { assessSuuntoGuide, assessSuuntoGuideV13ForRecovery, assessSuuntoGuideV15ForRecovery,
  guideMapping, guidePayloadForRecovery } from '../delivery/suunto/mapping';
import { hashTrainingScheduleRequestPayload } from '../persistence';
import type { DeliveryOperation } from '../delivery/contracts';
import type { SuuntoGuideFieldsStepV1, SuuntoGuideStepV1 } from './suunto-guide.serializer';
import { packageGuide, readGuideArchive } from '../delivery/suunto/archive';

const work: WorkoutStepV1 = {kind:'step',id:'work',purpose:'work',ending:{kind:'distance',meters:100,allowEarlyLap:true},targets:[]};
const rest: WorkoutStepV1 = {kind:'step',id:'rest',purpose:'rest',ending:{kind:'time',seconds:15},targets:[]};
const settings = defaultSuuntoSwimmingGuideSettings();
const owner = 'Synthetic QA';
function workout(sport = ActivityTypes.Swimming, nodes: ScheduledWorkoutV1['structure']['nodes'] = [work,rest]): ScheduledWorkoutV1 {
  return {schemaVersion:1,id:'synthetic-rest-alert',planId:null,title:'Rest alerts',localDate:'2026-12-30',
    lifecycle:'planned',revision:1,createdAtMs:1,updatedAtMs:1,structure:{version:1,sport,nodes:structuredClone(nodes)}};
}
function screens(steps: SuuntoGuideStepV1[]): SuuntoGuideFieldsStepV1[] {
  return steps.flatMap(step=>step.type==='repeat'?step.steps:[step]);
}
function frozen(value: ScheduledWorkoutV1) {
  const assessment = (value.structure.sport===ActivityTypes.Swimming || value.structure.sport===ActivityTypes.OpenWaterSwimming)
    ? assessSuuntoGuideV15ForRecovery(value,'destination','Europe/Helsinki',owner,undefined,settings)
    : assessSuuntoGuideV13ForRecovery(value,'destination','Europe/Helsinki',owner);
  return guidePayloadForRecovery({kind:'upsert',workout:value,destinationKey:'destination',timeZone:'Europe/Helsinki',
    digest:assessment.digest,suuntoSwimmingSettings:settings} as DeliveryOperation,owner)!;
}

describe('Suunto native timed Rest countdown alerts',()=>{
  it.each([ActivityTypes.Swimming,ActivityTypes.OpenWaterSwimming,ActivityTypes.Running,ActivityTypes.TrailRunning,
    ActivityTypes.Treadmill,ActivityTypes.Walking,ActivityTypes.Hiking,ActivityTypes.Cycling,ActivityTypes.MountainBiking,
    ActivityTypes.IndoorCycling,ActivityTypes.EBiking,ActivityTypes.Handcycle,ActivityTypes.Rowing,ActivityTypes.IndoorRowing])(
    'adds native alerts to timed Rest for %s, not to Work',sport=>{
      const value=workout(sport);
      const before=structuredClone(value);
      const mapped=guideMapping(value,'destination',owner,undefined,undefined,undefined,settings).artifact;
      const fields=screens(mapped.steps);
      const rests=fields.filter(step=>step.title.startsWith('Rest'));
      expect(rests.length).toBeGreaterThan(0);
      for (const step of rests) expect(step.alerts).toEqual([{type:'default',condition:{type:'stepDuration',value:15},countdown:{type:'standard'}}]);
      for (const step of fields.filter(step=>!step.title.startsWith('Rest'))) expect(step.alerts).toBeUndefined();
      const withoutAlerts=structuredClone(mapped);
      screens(withoutAlerts.steps).forEach(step=>delete step.alerts);
      expect(withoutAlerts).toEqual(frozen(value));
      expect(assessSuuntoGuide(value,'destination','Europe/Helsinki',owner).mappingVersion).toBe('suunto-guides-v16');
      expect(value).toEqual(before);
    });

  it.each([0.5,4,5,15,86400])('preserves the exact %s-second Rest without synthetic countdown steps',seconds=>{
    const value=workout(ActivityTypes.Running,[work,{...rest,ending:{kind:'time',seconds}}]);
    const old=frozen(value);
    const mapped=guideMapping(value,'destination',owner).artifact;
    expect(screens(mapped.steps).filter(step=>step.alerts).length).toBeGreaterThan(0);
    for (const step of screens(mapped.steps)) if (step.alerts) {
      expect(step.alerts).toEqual([{type:'default',condition:{type:'stepDuration',value:seconds},countdown:{type:'standard'}}]);
    }
    const withoutAlerts=structuredClone(mapped);
    screens(withoutAlerts.steps).forEach(step=>delete step.alerts);
    expect(withoutAlerts).toEqual(old);
  });

  it.each([
    {...rest,ending:{kind:'manual'}},
    {...rest,ending:{kind:'distance',meters:50}},
    {...rest,purpose:'recovery'},
    {...rest,purpose:'work',note:'Rest now'},
    {...rest,purpose:'warmup'},
    {...rest,purpose:'cooldown'},
    {...rest,purpose:'other'},
  ] satisfies WorkoutStepV1[])('does not add alerts to non-timed-Rest prescriptions: $purpose/$ending.kind',step=>{
    const mapped=guideMapping(workout(ActivityTypes.Running,[step]),'destination',owner).artifact;
    expect(screens(mapped.steps).every(screen=>screen.alerts===undefined)).toBe(true);
    expect(assessSuuntoGuide(workout(ActivityTypes.Running,[step]),'destination','Europe/Helsinki',owner).mappingVersion).toBe('suunto-guides-v13');
  });

  it('retains alert metadata on both incoming early-Lap branches, authored targets and notes',()=>{
    const value=workout(ActivityTypes.Swimming,[work,{...rest,ending:{kind:'time',seconds:15,allowEarlyLap:true},
      targets:[{kind:'heart-rate',mode:'absolute',minimumBpm:80,maximumBpm:120}],note:'Breathe slowly'}]);
    const mapped=guideMapping(value,'destination',owner,undefined,undefined,undefined,settings).artifact;
    const rests=screens(mapped.steps).filter(step=>step.title.startsWith('Rest'));
    expect(rests).toHaveLength(2);
    expect(rests.every(step=>step.alerts?.[0].condition.value===15)).toBe(true);
    expect(rests.every(step=>step.fields.some(field=>field.type==='targetHeartRate' && field.min===80 && field.max===120))).toBe(true);
    expect(rests.every(step=>step.fields.some(field=>field.type==='text' && field.value==='Breathe slowly'))).toBe(true);
    const old=frozen(value);
    expect(screens(mapped.steps).map(({id,transitions,createManualLap})=>({id,transitions,createManualLap})))
      .toEqual(screens(old.steps).map(({id,transitions,createManualLap})=>({id,transitions,createManualLap})));
  });

  it('keeps compact-repeat size fallback and every timed Rest alert within the readback budget',async()=>{
    const nodes=Array.from({length:10},(_,i)=>({kind:'repeat' as const,id:`repeat-${i}`,count:100,steps:[
      {...work,id:`work-${i}`,ending:{kind:'manual' as const}}, {...rest,id:`rest-${i}`},
    ]}));
    const mapped=guideMapping(workout(ActivityTypes.Swimming,nodes),'destination',owner,undefined,undefined,undefined,settings).artifact;
    expect(mapped.steps.some(step=>step.type==='repeat')).toBe(true);
    expect(screens(mapped.steps).filter(step=>step.title.startsWith('Rest')).every(step=>step.alerts?.length===1)).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(mapped))).toBeLessThanOrEqual(256*1024);
    expect(await readGuideArchive(await packageGuide(mapped))).toEqual(mapped);
  });

  it('includes timed Gym set rests without changing work/load instructions or companion data',()=>{
    const strength={version:1 as const,workoutId:'synthetic-rest-alert',revision:1,exercises:[{id:'plank',name:'Plank',sets:[
      {id:'hold',ending:{kind:'time' as const,seconds:20},externalLoadKg:5,restAfterSeconds:15},
    ]}]};
    const value=workout(ActivityTypes.StrengthTraining);
    value.structure=projectStrengthWorkoutToV1(strength);
    const before=structuredClone(strength);
    const mapped=guideMapping(value,'destination',owner,strength,WeightUnits.Pounds).artifact;
    expect(screens(mapped.steps).find(step=>step.title==='Rest')?.alerts).toEqual([
      {type:'default',condition:{type:'stepDuration',value:15},countdown:{type:'standard'}},
    ]);
    expect(screens(mapped.steps).filter(step=>step.title!=='Rest').every(step=>step.alerts===undefined)).toBe(true);
    expect(strength).toEqual(before);
  });

  it('retains exact v13 approval in non-default strength units, never approval for changed instructions',()=>{
    const strength={version:1 as const,workoutId:'synthetic-rest-alert',revision:1,exercises:[{id:'squat',
      name:'A long exercise name requiring abbreviated watch instructions',sets:[
        {id:'set',ending:{kind:'repetitions' as const,repetitions:5},externalLoadKg:45.359237,restAfterSeconds:15},
      ]}]};
    const value=workout(ActivityTypes.StrengthTraining);
    value.structure=projectStrengthWorkoutToV1(strength);
    const old=structuredClone(guideMapping(value,'destination',owner,strength,WeightUnits.Pounds).artifact);
    screens(old.steps).forEach(step=>delete step.alerts);
    const digest=hashTrainingScheduleRequestPayload({mappingVersion:'suunto-guides-v13',destination:'destination',
      zone:'Europe/Helsinki',owner,strength:strength.exercises,payload:old});
    const assessed=assessSuuntoGuide(value,'destination','Europe/Helsinki',owner,strength,WeightUnits.Pounds);
    expect(assessed).toMatchObject({level:'degraded',requiresApproval:true,mappingVersion:'suunto-guides-v16'});
    expect(assessed.compatibleApprovalDigests).toContain(digest);
    const changed=structuredClone(strength);
    changed.exercises[0].sets[0].ending.repetitions=6;
    expect(assessSuuntoGuide({...value,structure:projectStrengthWorkoutToV1(changed)},'destination','Europe/Helsinki',
      owner,changed,WeightUnits.Pounds).compatibleApprovalDigests).not.toContain(digest);
  });

  it('fails before delivery when required alerts cannot fit the existing readback budget',()=>{
    const value=workout(ActivityTypes.Running,[{...work,ending:{kind:'manual'}},{kind:'repeat',id:'sets',count:18,
      steps:Array.from({length:11},(_,index)=>({...rest,id:`rest-${index}`,ending:{kind:'time',seconds:15,allowEarlyLap:true},
        targets:[{kind:'heart-rate',mode:'absolute',minimumBpm:80,maximumBpm:120},
          {kind:'speed',mode:'absolute',presentation:'pace',minimumMetersPerSecond:1,maximumMetersPerSecond:2}],note:'A'.repeat(40)}))}]);
    expect(Buffer.byteLength(JSON.stringify(frozen(value)))).toBeLessThanOrEqual(256*1024);
    expect(assessSuuntoGuide(value,'destination','Europe/Helsinki',owner)).toMatchObject({level:'unsupported',mappingVersion:'suunto-guides-v16'});
    expect(()=>guideMapping(value,'destination',owner)).toThrow('supported file size');
  });
});
