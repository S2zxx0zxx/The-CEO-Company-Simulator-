import {spawnSync} from 'node:child_process';
import {mkdir,writeFile,readFile,cp,symlink,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
const dir=resolve('r47-native-qa'),bundle=resolve('r47-qa-dist'),cap=resolve('node_modules/@capacitor/cli/bin/capacitor');
if(existsSync(dir))throw Error('QA workspace exists; inspect rather than overwrite');
if(JSON.parse(await readFile(bundle+'/build-id.json','utf8')).qa!==true)throw Error('QA bundle required');
await mkdir(dir);await symlink(resolve('node_modules'),dir+'/node_modules','junction');await cp('package.json',dir+'/package.json');await cp(bundle,dir+'/www',{recursive:true});await rm(dir+'/www/railway-sw.js');
const config={appId:'app.railway.qa.r47',appName:'Railway QA R47',webDir:'www',server:{hostname:'railway-qa.localhost',androidScheme:'https',cleartext:false,allowNavigation:[]},android:{allowMixedContent:false,webContentsDebuggingEnabled:false}};
await writeFile(dir+'/capacitor.config.json',JSON.stringify(config));
function run(cmd,args,cwd){const r=spawnSync(cmd,args,{cwd,stdio:'inherit'});if(r.status!==0)throw Error(cmd+' failed '+r.status);}
run(process.execPath,[cap,'add','android'],dir);run(process.execPath,[cap,'sync','android'],dir);
const root=dir+'/android/app/src/main',mp=root+'/AndroidManifest.xml';let manifest=await readFile(mp,'utf8');
manifest=manifest.replace(/\sandroid:(?:allowBackup|usesCleartextTraffic|screenOrientation)="[^"]*"/g,'').replace('<application','<application android:allowBackup="false" android:usesCleartextTraffic="false"').replace(/(<activity\b(?:(?!>).)*android:name="\.MainActivity")/s,'$1 android:screenOrientation="portrait"');
if(!manifest.includes('android:screenOrientation="portrait"'))throw Error('MainActivity anchor missing');await writeFile(mp,manifest);
const native=JSON.parse(await readFile(root+'/assets/capacitor.config.json','utf8'));if(native.appId!==config.appId||native.server?.url||native.server?.hostname!==config.server.hostname||native.server?.cleartext!==false)throw Error('Native configuration mismatch');
const gradle=await readFile(dir+'/android/app/build.gradle','utf8');if(!gradle.includes(config.appId))throw Error('QA application ID mismatch');
// R53 explicitly builds an unsigned QA-identity release variant, never a store release.
const tasks=process.env.R53_PACKAGE_QA==='1'?['assembleDebug','bundleRelease']:['assembleDebug'];
run('bash',['gradlew',...tasks,'--no-daemon'],dir+'/android');
