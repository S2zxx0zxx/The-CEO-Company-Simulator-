#!/usr/bin/env bash
set -euo pipefail
pkg=app.theceo.companysimulator
apk=android/app/build/outputs/apk/debug/app-debug.apk
mkdir -p r40-evidence
adb shell getprop >r40-evidence/android-properties.txt
adb shell dumpsys webviewupdate >r40-evidence/webview.txt
adb install "$apk"
adb shell pm clear "$pkg"
adb shell cmd connectivity airplane-mode enable
adb shell svc wifi disable
adb shell svc data disable
adb shell settings get global airplane_mode_on | tr -d '\r' | grep -x 1
adb shell am start -n "$pkg/.MainActivity"
wait_file() {
 local f="$1"
 for i in $(seq 1 120); do
   if adb shell run-as "$pkg" cat files/r40-error.json >r40-evidence/error.json 2>/dev/null; then cat r40-evidence/error.json; exit 1; fi
   if adb shell run-as "$pkg" cat "files/$f.json" >"r40-evidence/$f.json" 2>/dev/null && python -m json.tool "r40-evidence/$f.json" >/dev/null 2>&1; then return; fi
   sleep 1
 done
 adb logcat -d >r40-evidence/logcat.txt
 echo "missing $f"; exit 1
}
wait_file r40-phase
adb shell am force-stop "$pkg"
# Check process death, not just reload. Keep app files and IndexedDB.
if adb shell pidof "$pkg" | grep -q '[0-9]'; then echo 'force-stop did not stop process'; exit 1; fi
adb shell am start -n "$pkg/.MainActivity"
wait_file r40-final
wait_file r40-lifecycle
adb shell input keyevent KEYCODE_HOME
sleep 3
adb shell am start -n "$pkg/.MainActivity"
for i in $(seq 1 60); do
 adb shell run-as "$pkg" cat files/r40-lifecycle.json >r40-evidence/r40-lifecycle.json 2>/dev/null || true
 if python -c 'import json; d=json.load(open("r40-evidence/r40-lifecycle.json")); assert False in d["events"] and True in d["events"] and d["progress"]>=2' 2>/dev/null; then break; fi
 sleep 1
done
adb logcat -d >r40-evidence/logcat.txt
if adb shell run-as "$pkg" cat files/r40-error.json >r40-evidence/error.json 2>/dev/null; then cat r40-evidence/error.json; exit 1; fi
python - <<'PY'
import json
from pathlib import Path
def get(n): return json.loads(Path('r40-evidence/'+n+'.json').read_text())
w=get('web'); p=get('r40-phase'); f=get('r40-final'); l=get('r40-lifecycle')
assert p['native'] and f['native'] and f['platform']=='android'
assert p['tag']==f['checkpointTag']
assert p['creditedWallMs']==f['creditedWallMs']==120000
assert f['simTimeS']==120 and f['closures']==1
assert f['configurationSha256']==w['final']['configurationSha256']
assert f['checksum']==f['directChecksum']==w['final']['checksum']==w['final']['directChecksum']
assert l['native'] and False in l['events'] and True in l['events'] and l['progress']>=2
print('R40_ANDROID_EMULATOR_PARITY PASS',f['checksum'])
PY
