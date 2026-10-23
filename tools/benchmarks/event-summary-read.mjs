import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
// Usage: node tools/benchmarks/event-summary-read.mjs <baseline-git-ref>
// Synthetic CPU benchmark: excludes module startup, Firestore/network and browser rendering.
const root = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const require = createRequire(root + '/package.json');
const esbuild = require('esbuild'), ts = require('typescript');
const base = process.argv[2];
if (!base)
    throw new Error('Supply the baseline Git ref to compare with the current working tree.');
const outDir = fs.mkdtempSync(root + '/.qs-summary-bench-');
const tablePath = 'src/app/components/event-table/event.table.component.ts';
const directivePath = 'src/app/components/data-table/data-table-abstract.directive.ts';
const aggPath = 'shared/event-stat-aggregation.ts';
const methods = ['buildEventRowContentKey', 'readDeviceNameItemsForCacheKey', 'readStatsForCacheKey', 'safeCallForCacheKey', 'normalizeCacheValue', 'getDeviceNamesFromStat'];
const results = { runtime: process.version, events: 438, numericStats: 80, warmups: 3, samples: 11, baseline: base, variants: {} };
try {
    for (const variant of ['baseline', 'current']) {
        const read = rel => variant === 'baseline' ? cp.execFileSync('git', ['show', base + ':' + rel], { cwd: root, encoding: 'utf8' }) : fs.readFileSync(root + '/' + rel, 'utf8');
        const ast = ts.createSourceFile(tablePath, read(tablePath), ts.ScriptTarget.Latest, true);
        const klass = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'EventTableComponent');
        const bodies = klass.members.filter(n => methods.includes(n.name?.getText(ast))).map(n => n.getText(ast)).join('\n');
        const entry = `
import '@angular/compiler';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { DataStore, DynamicDataLoader, EventImporterJSON, ActivityTypesHelper, DataDeviceNames, ChartDataCategoryTypes, ChartDataValueTypes, TimeIntervals } from '@sports-alliance/sports-lib';
import { EventJSONSanitizer } from '${root}/src/app/utils/event-json-sanitizer';
import { normalizePersistedEventMetricSemantics } from '${root}/shared/sports-lib-metric-semantics';
import { AppEventSummary } from '${root}/shared/event-summary';
import { getEventTags } from '${root}/shared/event-tags';
import * as Table from '${root}/${directivePath}';
import * as Aggregation from '${root}/${aggPath}';
const EVENT_TABLE_STAT_TYPES=Table.EVENT_TABLE_STAT_TYPES||[];
class Rows extends Table.DataTableAbstractDirective { getColumnsToDisplay(){return []} isSticky(){return false} isStickyEnd(){return false} ${bodies} }
const rows=new Rows({detectChanges(){}});
const numeric=[];
for(const C of Object.values(DataStore)) { try { const s=new C(10); if(typeof s.getValue()==='number'&&Number.isFinite(s.getValue())&&!numeric.includes(C.type)) {s.getDisplayValue();s.getDisplayUnit();numeric.push(C.type);} } catch{} }
const types=[...new Set(['Distance','Duration','Ascent','Descent','Energy','Average Heart Rate','Average Speed','Average Power',...numeric])].slice(0,80);
assert.equal(types.length, 80);
const docs=Array.from({length:438},(_,i)=>({id:'synthetic-'+i,name:'Synthetic run',startDate:Date.UTC(2024,0,1)+i*86400000,endDate:Date.UTC(2024,0,1)+i*86400000+3600000,isMerge:false,srcFileType:'fit',privacy:'private',description:'',activities:[],stats:{...Object.fromEntries(types.map(type=>[type,10+i%50])),Distance:5000+i,Duration:3600,Ascent:80,Descent:60,'Average Heart Rate':140,'Average Speed':4,'Activity Types':['Running'],'Device Names':['Example'],'Start Position':{latitudeDegrees:60,longitudeDegrees:24}}}));
function hydrate(){return docs.map(doc=>{const {sanitizedJson}=EventJSONSanitizer.sanitize(doc);return '${variant}'==='baseline'?normalizePersistedEventMetricSemantics(EventImporterJSON.getEventFromJSON(sanitizedJson).setID(doc.id)):new AppEventSummary(sanitizedJson);})}
const columns=['Distance','Duration','Ascent','Descent','Average Heart Rate','Average Speed'];
function prepare(events){return events.map(event=>{rows.buildEventRowContentKey(event);const row='${variant}'==='baseline'?rows.getStatsRowElement(event.getStatsAsArray(),event.getActivityTypesAsArray()):rows.getStatsRowElementFromReader(event,event.getActivityTypesAsArray());return columns.map(type=>row[type]);});}
const events=hydrate(), values=prepare(events);
const selectors=['Distance','Duration','Ascent','Descent','Energy','Average Heart Rate','Average Speed','Average Power'];
function aggregate(){const context=Aggregation.EventStatAggregationContext?new Aggregation.EventStatAggregationContext():undefined;return selectors.map(dataType=>Aggregation.buildEventStatAggregation(events,{dataType,valueType:ChartDataValueTypes.Total,categoryType:ChartDataCategoryTypes.DateType,requestedTimeInterval:TimeIntervals.Daily,timeZone:'Europe/Helsinki'},undefined,context));}
function measure(fn){for(let i=0;i<3;i++)fn();const samples=[];for(let i=0;i<11;i++){const start=performance.now();fn();samples.push(performance.now()-start);}samples.sort((a,b)=>a-b);return +samples[5].toFixed(3);}
const real=DynamicDataLoader.getDataInstanceFromDataType;let constructions=0;DynamicDataLoader.getDataInstanceFromDataType=function(...args){constructions++;return real.apply(this,args)};prepare(hydrate());DynamicDataLoader.getDataInstanceFromDataType=real;
const report={freshMs:measure(()=>prepare(hydrate())),cacheKeyMs:measure(()=>events.forEach(e=>rows.buildEventRowContentKey(e))),eightSelectorsMs:measure(aggregate),metricFactoryCalls:constructions,values,aggregation:aggregate()};
console.log(JSON.stringify(report));`;
        const file = path.join(outDir, variant + '.mjs');
        await esbuild.build({ stdin: { contents: entry, sourcefile: 'summary-bench.ts', loader: 'ts', resolveDir: root }, outfile: file, bundle: true, packages: 'external', platform: 'node', format: 'esm', tsconfig: root + '/src/tsconfig.app.json', logLevel: 'silent', plugins: variant === 'baseline' ? [{ name: 'baseline', setup(b) { b.onLoad({ filter: /data-table-abstract\.directive\.ts$|shared\/event-stat-aggregation\.ts$/ }, args => ({ contents: read(path.relative(root, args.path)), loader: 'ts' })); } }] : [] });
        const report = JSON.parse(cp.execFileSync(process.execPath, [file], { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, env: { ...process.env, NODE_DISABLE_COMPILE_CACHE: '1' } }));
        results.variants[variant] = report;
    }
    const a = results.variants.baseline, b = results.variants.current;
    results.displayParity = JSON.stringify(a.values) === JSON.stringify(b.values);
    results.aggregationParity = JSON.stringify(a.aggregation) === JSON.stringify(b.aggregation);
    for (const r of Object.values(results.variants)) {
        delete r.values;
        delete r.aggregation;
    }
    console.log(JSON.stringify(results, null, 2));
    if (!results.displayParity || !results.aggregationParity)
        process.exitCode = 1;
}
finally {
    fs.rmSync(outDir, { recursive: true, force: true });
}
