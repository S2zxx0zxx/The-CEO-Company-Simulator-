import hashlib,json,pathlib,re,shutil,subprocess,zipfile,os
root=pathlib.Path('r47-native-qa/android/app/build/outputs')
apk=root/'apk/debug/app-debug.apk';aab=root/'bundle/release/app-release.aab'
out=pathlib.Path('r53-evidence');out.mkdir(exist_ok=True)
sdk=pathlib.Path(os.environ.get('ANDROID_SDK_ROOT') or os.environ['ANDROID_HOME'])/'build-tools/36.0.0'
def run(*args):return subprocess.check_output([str(a) for a in args],text=True,stderr=subprocess.STDOUT)
def sha(b):return hashlib.sha256(b).hexdigest()
def digest(path):return sha(path.read_bytes())
badging=run(sdk/'aapt','dump','badging',apk)
assert "package: name='app.railway.qa.r47'" in badging
manifest=run(sdk/'aapt','dump','xmltree',apk,'AndroidManifest.xml')
assert re.search(r'android:allowBackup[^\n]*=\(type 0x12\)0x0\b',manifest)
assert re.search(r'android:usesCleartextTraffic[^\n]*=\(type 0x12\)0x0\b',manifest)
permissions=run(sdk/'aapt','dump','permissions',apk)
assert not re.search(r'BILLING|AD_ID|ACCESS_ADSERVICES|GET_ACCOUNTS|READ_CONTACTS|ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION|CAMERA|RECORD_AUDIO|READ_PHONE_STATE|READ_SMS|SEND_SMS|MANAGE_EXTERNAL_STORAGE|REQUEST_INSTALL_PACKAGES',permissions,re.I)
cert=run(sdk/'apksigner','verify','--verbose','--print-certs',apk)
assert 'Android Debug' in cert
assert re.search(r'Signer #1 certificate SHA-256 digest: [a-f0-9]{64}',cert)
# AAB uses protobuf manifest; validate identity from aapt2 convert is not reliable.
# Inspect the actual merged release manifest plus bundle payload; final bundletool validation separate.
release_manifests=list(pathlib.Path('r47-native-qa/android/app/build/intermediates').glob('merged_manifests/release/**/AndroidManifest.xml'))
assert release_manifests,'Missing merged release manifest'
import xml.etree.ElementTree as E
ns='{http://schemas.android.com/apk/res/android}'
for p in release_manifests:
 m=E.parse(p).getroot();assert m.get('package')=='app.railway.qa.r47';app=m.find('application');assert app.get(ns+'allowBackup')=='false' and app.get(ns+'usesCleartextTraffic')=='false';assert app.get(ns+'debuggable','false')=='false'
expected={p.relative_to('r47-qa-dist').as_posix():p.read_bytes() for p in pathlib.Path('r47-qa-dist').rglob('*') if p.is_file() and p.name!='railway-sw.js'}
rows=[]
for path,prefix,filename in [(apk,'assets/public/','railway-guest-QA-debug.apk'),(aab,'base/assets/public/','railway-guest-QA-UNSIGNED.aab')]:
 with zipfile.ZipFile(path) as z:
  assert z.testzip() is None and len(z.namelist())==len(set(z.namelist()))
  for n in z.namelist():assert not n.startswith('/') and '..' not in pathlib.PurePosixPath(n).parts
  payload={n[len(prefix):]:z.read(n) for n in z.namelist() if n.startswith(prefix) and not n.endswith('/')}
  # Capacitor generates two known bridge files, which are separately inventoried.
  missing=set(expected)-set(payload);assert not missing,missing
  for n,b in expected.items():assert payload[n]==b,'Web payload mismatch '+n
  extra=set(payload)-set(expected);assert extra<= {'cordova.js','cordova_plugins.js'},extra
  assert not any(n.endswith(('.pbf','.pmtiles','.mbtiles')) or 'R46_DRAFT_ART_ONLY' in n for n in z.namelist())
  if path==aab:
   assert 'BundleConfig.pb' in z.namelist() and 'base/manifest/AndroidManifest.xml' in z.namelist()
   assert not any(re.match(r'META-INF/[^/]+\.(SF|RSA|DSA|EC)$',n,re.I) for n in z.namelist()),'Unexpected AAB signature'
   # Verify package literal present in actual protobuf binary manifest as well.
   assert b'app.railway.qa.r47' in z.read('base/manifest/AndroidManifest.xml')
  rows.append({'file':filename,'sha256':digest(path),'bytes':path.stat().st_size,'publicFiles':len(payload),'payloadHashes':{n:sha(b) for n,b in payload.items()},'signature':'debug verified' if path==apk else 'unsigned QA variant'})
 shutil.copyfile(path,out/filename)
(out/'apk-signature.txt').write_text(cert);(out/'apk-badging.txt').write_text(badging);(out/'apk-manifest.txt').write_text(manifest)
(out/'native-package-evidence.json').write_text(json.dumps({'package':'app.railway.qa.r47','productionAccepted':False,'artifacts':rows,'limitations':'QA debug APK signature only; unsigned QA AAB; no final bundletool validation or physical install; exact payload parity, not native bit reproducibility'},indent=2)+'\n')
print('R53_NATIVE_PACKAGES PASS '+json.dumps([{k:v for k,v in r.items() if k!='payloadHashes'} for r in rows]))
