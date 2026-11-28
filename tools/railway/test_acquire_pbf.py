"""Synthetic tests only; no live transfer or actual Osmium invocation."""
import copy
import hashlib
import tempfile
import unittest
from pathlib import Path
from acquire_pbf import NAME, parse_sidecar, validate_info, verify_bytes, private_workspace, NoRedirect

class AcquisitionTests(unittest.TestCase):
    def test_sidecar(self):
        for sep in ['  ', ' *']:
            self.assertEqual(parse_sidecar(('A'*32 + sep + NAME + '\r\n').encode()), 'a'*32)
    def test_bad_sidecar(self):
        for raw in [b'<html>', b'a'*32+b'  latest.osm.pbf', b'z'*32+b'  '+NAME.encode(), b'a'*32+b'  '+NAME.encode()+b'\nextra']:
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                parse_sidecar(raw)
    def test_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)/NAME; p.write_bytes(b'fictional bytes, not PBF')
            raw=p.read_bytes(); md5=hashlib.md5(raw).hexdigest()
            self.assertEqual(verify_bytes(p,md5),hashlib.sha256(raw).hexdigest())
            p.write_bytes(raw+b'changed')
            with self.assertRaises(ValueError): verify_bytes(p,md5)
            p.write_bytes(b'')
            with self.assertRaises(ValueError): verify_bytes(p,hashlib.md5(b'').hexdigest())
    def test_metadata(self):
        i={'file':{'format':'PBF','size':100},'header':{'with_history':False,'option':{'osmosis_replication_timestamp':'2026-11-01T00:00:00Z'}},'data':{'objects_ordered':True,'multiple_versions':False,'count':{'nodes':2,'ways':1,'relations':0,'changesets':0},'bbox':[1,2,3,4],'timestamp':{'first':'2020-01-01T00:00:00Z','last':'2026-10-31T00:00:00Z'}}}
        self.assertEqual(validate_info(i,100),'2026-11-01T00:00:00Z')
        for section,key,value in [('file','format','XML'),('file','size',99),('header','with_history',True),('data','objects_ordered',False),('data','multiple_versions',True),('data','bbox',[3,2,1,4]),('data','count',{'nodes':0,'ways':0,'relations':0,'changesets':0}),('data','timestamp',{'first':'2020-01-01T00:00:00Z','last':'2026-11-02T00:00:00Z'})]:
            bad=copy.deepcopy(i); bad[section][key]=value
            with self.subTest(section=section,key=key),self.assertRaises(ValueError): validate_info(bad,100)
    def test_workspace(self):
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp); (p/'.git').mkdir(); (p/'data').mkdir()
            with self.assertRaises(ValueError): private_workspace(p/'data')
    def test_redirect(self):
        with self.assertRaises(ValueError): NoRedirect().redirect_request(None,None,302,'',{},'https://other.invalid')

if __name__=='__main__': unittest.main()
