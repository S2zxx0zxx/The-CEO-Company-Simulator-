import {execFileSync} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {join} from 'node:path';
const root='r47-native-qa/android/app',apk=root+'/build/outputs/apk/debug/app-debug.apk';
const sdk=process.env.ANDROID_SDK_ROOT||process.env.ANDROID_HOME;if(!sdk)throw Error('Missing Android SDK');
const aapt=join(sdk,'build-tools','36.0.0','aapt');
const permissions=execFileSync(aapt,['dump','permissions',apk],{encoding:'utf8'}),badging=execFileSync(aapt,['dump','badging',apk],{encoding:'utf8'}),native=JSON.parse(await readFile(root+'/src/main/assets/capacitor.config.json','utf8'));
assert.match(badging,/package: name='app\.railway\.qa\.r47'/);
assert.doesNotMatch(permissions,/com\.android\.vending\.BILLING|com\.google\.android\.gms\.permission\.AD_ID|ACCESS_ADSERVICES|GET_ACCOUNTS|USE_CREDENTIALS|READ_CONTACTS|ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION/i);
assert.equal(native.server?.hostname,'railway-qa.localhost');assert.equal(native.server?.cleartext,false);assert.equal(native.server?.url,undefined);assert.deepEqual(native.server?.allowNavigation,[]);
assert.equal(native.android?.allowMixedContent,false);
await mkdir('r47-native-evidence',{recursive:true});
await writeFile('r47-native-evidence/r48-apk-permissions.txt',permissions);await writeFile('r47-native-evidence/r48-apk-badging.txt',badging);
console.log('R48_NATIVE_PACKAGE PASS actual QA APK permission denylist and local Capacitor config; not final release');

// Verify actual APK public payload preserves exact local software notices.
for(const name of ['RUNTIME_LICENSES.txt','DEPENDENCY_INVENTORY.json','idle-game-template.txt','README.txt']){
 const shipped=execFileSync('unzip',['-p',apk,'assets/public/licenses/'+name]);assert.deepEqual(shipped,await readFile('r47-qa-dist/licenses/'+name),'Missing or modified native notice '+name);
}
console.log('R51_NATIVE_NOTICES PASS four exact notice files in QA APK; native Maven inventory still pending');

// Capture actual resolved native dependencies after the existing QA build. No network fallback.
const {resolve}=await import('node:path');
const inventoryPath=resolve('r47-native-evidence/r51-native-classpath.json');
execFileSync('bash',['gradlew','--offline','--no-daemon','-I',resolve('tools/qa/r47/r51-native-inventory.gradle'),':app:r51QaRuntimeInventory'],{cwd:'r47-native-qa/android',env:{...process.env,R51_NATIVE_INVENTORY_PATH:inventoryPath},stdio:'inherit',timeout:180000});
execFileSync('python',['tools/qa/r47/r51-native-pom-audit.py',inventoryPath],{stdio:'inherit'});

// R52: check real merged binary manifest, not just Capacitor source settings.
const manifest=execFileSync(aapt,['dump','xmltree',apk,'AndroidManifest.xml'],{encoding:'utf8'});
assert.match(manifest,/android:allowBackup[^\n]*=\(type 0x12\)0x0\b/,'QA APK must disable platform backup');
assert.match(manifest,/android:usesCleartextTraffic[^\n]*=\(type 0x12\)0x0\b/,'QA APK must disable cleartext traffic');
assert.equal(native.android?.webContentsDebuggingEnabled,false);
assert.doesNotMatch(permissions,/android\.permission\.(?:CAMERA|RECORD_AUDIO|READ_PHONE_STATE|READ_SMS|SEND_SMS|READ_CALL_LOG|WRITE_CALL_LOG|READ_CONTACTS|WRITE_CONTACTS|ACCESS_BACKGROUND_LOCATION|MANAGE_EXTERNAL_STORAGE|REQUEST_INSTALL_PACKAGES)\b/i);
await writeFile('r47-native-evidence/r52-merged-manifest.txt',manifest);
console.log('R52_NATIVE_BOUNDARY PASS QA merged manifest backup and cleartext disabled; restricted permission denylist; debug QA only');
