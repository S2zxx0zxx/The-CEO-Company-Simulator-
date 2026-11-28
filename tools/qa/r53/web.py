import hashlib,json,pathlib,sys,zipfile
def sha(b):return hashlib.sha256(b).hexdigest()
def files(root):
 root=pathlib.Path(root);out={}
 for p in sorted(root.rglob('*')):
  if p.is_symlink():raise ValueError('Symlink in bundle')
  if p.is_file():out[p.relative_to(root).as_posix()]=p.read_bytes()
 return out
out=pathlib.Path('r53-evidence');out.mkdir(exist_ok=True)
report=[]
for name in ['railway-dist','r47-qa-dist']:
 a=files(pathlib.Path('r53-first')/name);b=files(name);assert a==b,'Rebuild changed output '+name
 manifest=json.loads(b['railway.webmanifest']);build=json.loads(b['build-id.json']);assert build['qa']==(name=='r47-qa-dist')
 assert manifest['scope']=='./' and manifest['start_url']=='./'
 sw=b['railway-sw.js'].decode();import re
 m=re.search(r'const FILES=(\[[^\n]*?\]);',sw);assert m
 assert sorted(json.loads(m.group(1)))==sorted('./'+x for x in b if x!='railway-sw.js')
 assert all('licenses/'+x in b for x in ['RUNTIME_LICENSES.txt','DEPENDENCY_INVENTORY.json','idle-game-template.txt','README.txt'])
 def pack(path):
  with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
   for k,v in sorted(b.items()):
    i=zipfile.ZipInfo(k,(1980,1,1,0,0,0));i.create_system=3;i.external_attr=0o100644<<16;i.compress_type=zipfile.ZIP_DEFLATED;z.writestr(i,v,compresslevel=9)
 target=out/('railway-guest-QA-pwa.zip' if build['qa'] else 'railway-DEVELOPMENT-shell.zip')
 pack(target);again=target.with_suffix('.repeat');pack(again);assert target.read_bytes()==again.read_bytes();again.unlink()
 with zipfile.ZipFile(target) as z:assert z.testzip() is None and {k:z.read(k) for k in z.namelist()}==b
 report.append(dict(bundle=name,qa=build['qa'],files=len(b),bytes=sum(map(len,b.values())),sha256=sha(target.read_bytes()),archiveBytes=target.stat().st_size,filesSha256={k:sha(v) for k,v in b.items()}))
(out/'web-build-evidence.json').write_text(json.dumps({'sameRunnerTwoBuilds':True,'reproducibleZip':True,'productionAccepted':False,'bundles':report},indent=2)+'\n')
print('R53_WEB_REPRODUCIBILITY PASS '+json.dumps([{k:v for k,v in r.items() if k!='filesSha256'} for r in report]))
