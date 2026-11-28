#!/usr/bin/env bash
set -euo pipefail
pkg=app.railway.qa.r47
apk=r47-native-qa/android/app/build/outputs/apk/debug/app-debug.apk
mkdir -p r47-native-evidence
adb wait-for-device
adb shell input keyevent KEYCODE_WAKEUP
adb shell wm dismiss-keyguard
adb install "$apk"
adb shell pm clear "$pkg" | grep -x Success
adb shell cmd connectivity airplane-mode enable
adb shell svc wifi disable
adb shell svc data disable
adb shell settings get global airplane_mode_on | tr -d '\r' | grep -x 1
adb shell am start -W -n "$pkg/.MainActivity"
trap 'adb logcat -d >r47-native-evidence/logcat.txt || true; adb shell dumpsys activity activities >r47-native-evidence/activities.txt || true; adb exec-out screencap -p >r47-native-evidence/final-screen.png || true' EXIT
tap_text(){
 for i in $(seq 1 60); do
  rm -f r47-native-evidence/window.xml
  adb shell rm -f /sdcard/r47-window.xml
  if ! adb shell uiautomator dump /sdcard/r47-window.xml >/dev/null 2>&1; then sleep 1; continue; fi
  if ! adb pull /sdcard/r47-window.xml r47-native-evidence/window.xml >/dev/null 2>&1; then sleep 1; continue; fi
  if coords=$(python - "$1" <<'PY'
import sys,re,xml.etree.ElementTree as E
try:
 for e in E.parse('r47-native-evidence/window.xml').iter('node'):
  if e.get('package')=='app.railway.qa.r47' and (e.get('text')==sys.argv[1] or e.get('content-desc')==sys.argv[1]):
   a,b,c,d=map(int,re.findall(r'\d+',e.get('bounds','')))
   if c>a and d>b: print((a+c)//2,(b+d)//2);sys.exit(0)
except Exception: pass
sys.exit(1)
PY
); then adb shell input tap $coords; return; fi
 sleep 1
 done
 echo "Missing UI control $1"; exit 1
}
wait_file(){ for i in $(seq 1 120); do
 if adb shell run-as "$pkg" cat files/r47-error.json >r47-native-evidence/error.json 2>/dev/null; then cat r47-native-evidence/error.json; exit 1; fi
 if adb shell run-as "$pkg" cat "files/$1.json" >"r47-native-evidence/$1.json" 2>/dev/null && python -m json.tool "r47-native-evidence/$1.json" >/dev/null 2>&1; then return; fi
 sleep 1
 done; adb logcat -d >r47-native-evidence/logcat.txt; exit 1; }
tap_text 'Start guest company'
wait_file r47-phase
adb shell am force-stop "$pkg"
if adb shell pidof "$pkg" | grep -q '[0-9]'; then exit 1; fi
adb shell am start -n "$pkg/.MainActivity"
tap_text 'Resume guest company'
wait_file r47-final
adb shell input keyevent KEYCODE_HOME
sleep 3
adb shell am start -n "$pkg/.MainActivity"
for i in $(seq 1 60); do
 adb shell run-as "$pkg" cat files/r47-lifecycle.json >r47-native-evidence/r47-lifecycle.json 2>/dev/null || true
 if python -c 'import json; d=json.load(open("r47-native-evidence/r47-lifecycle.json")); assert False in d["events"] and True in d["events"]' 2>/dev/null; then break; fi
 sleep 1
done
python - <<'PY'
import json
from pathlib import Path
def get(n):return json.loads(Path('r47-native-evidence/'+n+'.json').read_text())
a,b,l=get('r47-phase'),get('r47-final'),get('r47-lifecycle')
assert a['native'] and b['native'] and a['platform']==b['platform']=='android'
assert a['configuration']==b['configuration'] and a['quote']==b['quote'] and b['revision']>=a['revision']
assert False in l['events'] and True in l['events']
print('R47_ANDROID PASS separate QA app, airplane-mode guest start, force-stop resume, persisted quote and native lifecycle')
PY
# Navigate actual screens through Android accessibility and native back.
for screen in Operations Finance Progression; do
 tap_text "$screen"
 case "$screen" in Operations) heading='Operations control';; Finance) heading='Company & finance';; Progression) heading='Company progression';; esac
 for i in $(seq 1 30); do
  adb shell uiautomator dump /sdcard/r49-window.xml >/dev/null 2>&1 || true
  adb pull /sdcard/r49-window.xml "r47-native-evidence/r49-${screen}.xml" >/dev/null 2>&1 || true
  if python - "$heading" "r47-native-evidence/r49-${screen}.xml" <<'PY'
import sys,xml.etree.ElementTree as E
try:
 assert any(sys.argv[1] in (e.get('text',''),e.get('content-desc','')) for e in E.parse(sys.argv[2]).iter('node'))
except Exception: sys.exit(1)
PY
  then break; fi
  sleep 1
 done
 python - "$heading" "r47-native-evidence/r49-${screen}.xml" <<'PY'
import sys,xml.etree.ElementTree as E
assert any(sys.argv[1] in (e.get('text',''),e.get('content-desc','')) for e in E.parse(sys.argv[2]).iter('node'))
PY
 adb shell input keyevent KEYCODE_BACK
 sleep 1
done
adb shell getprop ro.build.version.sdk >r47-native-evidence/r49-api.txt
adb shell cat /proc/meminfo >r47-native-evidence/r49-memory.txt
adb shell dumpsys webviewupdate >r47-native-evidence/r49-webview.txt
echo 'R49_NATIVE_NAVIGATION PASS actual three screens and native Back in airplane mode'
adb shell screencap -p /sdcard/r47.png
adb pull /sdcard/r47.png r47-native-evidence/guest.png
