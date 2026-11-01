/** Offline release regression pack. Each suite runs in a fresh process with fetch denied. */
import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const preload='data:text/javascript,'+encodeURIComponent("globalThis.fetch=async()=>{throw Error('Incident release tests: external network disabled')}");
const suites=readdirSync(new URL('.',import.meta.url)).filter(name=>/^test-incidents.*\.ts$/.test(name)).sort();
let failed=0;
for(const [name,args] of [...suites.map(name=>[name,[]]),['test-incidents-document-pipeline.ts',['--operational-fixtures']]]){
 const result=spawnSync(process.execPath,['--experimental-transform-types','--import',preload,new URL(name,import.meta.url).pathname,...args],{encoding:'utf8',timeout:80000});
 const pass=result.status===0;console.log(`${pass?'PASS':'FAIL'} ${name}${args.length?' · simulated operational connection':''}`);
 if(!pass){failed++;process.stderr.write((result.stdout||'')+(result.stderr||'')+(result.error?.message||''));}
}
console.log(`${suites.length+1-failed}/${suites.length+1} release suites passed; external fetch denied.`);process.exitCode=failed?1:0;
