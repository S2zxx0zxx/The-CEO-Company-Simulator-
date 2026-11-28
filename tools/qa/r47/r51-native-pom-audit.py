"""Read cached POM license declarations for exact resolved QA runtime artifacts.
Metadata is evidence only: inherited, missing or conflicting terms are not approved.
"""
import hashlib,json,os,pathlib,sys,xml.etree.ElementTree as ET
p=pathlib.Path(sys.argv[1]);data=json.loads(p.read_text());cache=pathlib.Path(os.environ.get("GRADLE_USER_HOME",str(pathlib.Path.home()/".gradle")))/"caches/modules-2/files-2.1"
def safe(s):return isinstance(s,str) and bool(s) and "/" not in s and "\\" not in s and s not in (".","..")
rows=[]
for coord in sorted({(a["group"],a["name"],a["version"]) for a in data["artifacts"]}):
 g,n,v=coord
 poms=[]
 if all(safe(s) for s in coord):
  for pom in sorted((cache/g/n/v).glob("*/*.pom")):
   b=pom.read_bytes()
   try:
    root=ET.fromstring(b)
    for e in root.iter():e.tag=e.tag.rsplit("}",1)[-1]
    declared=[{"name":l.findtext("name"),"url":l.findtext("url")} for l in root.findall("licenses/license")]
    parent=root.find("parent"); parent_coord=None if parent is None else {k:parent.findtext(k) for k in ("groupId","artifactId","version")}
    poms.append({"file":pom.name,"sha256":hashlib.sha256(b).hexdigest(),"declared":declared,"parent":parent_coord})
   except ET.ParseError:poms.append({"file":pom.name,"sha256":hashlib.sha256(b).hexdigest(),"parseError":True})
 rows.append({"coordinate":":".join(coord),"poms":poms,"status":"DECLARED_REVIEW_REQUIRED" if any(x.get("declared") for x in poms) else "UNRESOLVED_OR_INHERITED_REVIEW_REQUIRED"})
out={"scope":"actual QA resolved runtime only; no final license clearance or Maven notice redistribution claim","coordinates":rows,"resolvedArtifacts":len(data["artifacts"]),"productionAccepted":False}
p.with_name("r51-native-pom-licenses.json").write_text(json.dumps(out,indent=2)+"\n")
print("R51_NATIVE_POM_INVENTORY "+json.dumps({"coordinates":len(rows),"declared":sum(r["status"]=="DECLARED_REVIEW_REQUIRED" for r in rows),"unresolved":sum(r["status"]!="DECLARED_REVIEW_REQUIRED" for r in rows),"releaseAccepted":False}))
