#!/usr/bin/env python3
"""Verify C02 source and exact fixture before any native run."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

PIN = "6d6f1d84b6a132fd10c6556460eec2576eeeb916"
TREE = "51bfa2c351297da0bfa382ed38e52a4f91c84043"
FIXTURE = "tests/data/infras/tiny_infra/infra.json"
FILES = {
    "REUSE.toml": "4b669c6192b6b05ab81026b97b1ff34e641e0147",
    "LICENSES/LGPL-3.0-only.txt": "0a041280bd00a9d068f503b8ee7ce35214bd24a1",
    "editoast/schemas/src/infra/railjson.rs": "b319534b2afbff4f4e6c85e91815552906d353b2",
    "osrd_schemas/osrd_schemas/infra.py": "4f62d7b2651d4a1bf99ef1281521b6ba9da6b8ce",
    "core/osrd-railjson/src/main/java/fr/sncf/osrd/railjson/schema/infra/RJSInfra.kt": "4802bebf37f7c5457e7373141099ee273398096b",
    "core/gradle/wrapper/gradle-wrapper.properties": "a351597e62aad7a1ce484a9329906a75ff4a5601",
    "core/src/test/kotlin/fr/sncf/osrd/standalone_sim/StandaloneSimulationTest.kt": "db3e90f2cd84a8ca997536e832024cbfafdbb3fa",
    "core/src/test/java/fr/sncf/osrd/train/TestTrains.java": "d764e781bd2271ec6f78a4333923aa273fb4b67f",
    FIXTURE: "48673193942d4e24f9ff3abe0af0b161a1b6c2c6",
}
def require(ok, msg):
    if not ok:
        raise ValueError(msg)
def main():
    p=argparse.ArgumentParser()
    p.add_argument("--checkout", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    a=p.parse_args()
    def git(*args):
        return subprocess.check_output(["git","-C",str(a.checkout),*args],text=True).strip()
    require(git("rev-parse","HEAD")==PIN and git("rev-parse","HEAD^{tree}")==TREE,"pin mismatch")
    require(not git("status","--porcelain","--untracked-files=no"),"modified tracked source")
    hashes={}
    for name,blob in FILES.items():
        data=(a.checkout/name).read_bytes()
        require(hashlib.sha1(b"blob "+str(len(data)).encode()+b"\0"+data).hexdigest()==blob,"blob mismatch "+name)
        hashes[name]=hashlib.sha256(data).hexdigest()
    fixture=json.loads((a.checkout/FIXTURE).read_text())
    require(fixture["version"]=="3.5.3","fixture version")
    require(not fixture["electrifications"],"expected unelectrified fixture")
    require(len(fixture["speed_sections"])==1 and abs(fixture["speed_sections"][0]["speed_limit"]*3.6-60)<1e-8,"speed section changed")
    out={"commit":PIN,"tree":TREE,"railjsonVersion":"3.5.3","fixtureBlob":FILES[FIXTURE],"sourceSha256":hashes,"kind":"PINNED_SOURCE_VERIFIED_NOT_EXECUTION"}
    a.out.write_text(json.dumps(out,sort_keys=True,indent=2)+"\n")
    print(a.out.read_text())
if __name__=="__main__":
    main()
