"""R13 private acquisition helper. Never runs in game or GitHub CI."""
import argparse
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import urllib.request

NAME = 'eastern-zone-261101.osm.pbf'
BASE = 'https://download.geofabrik.de/asia/india/eastern-zone/'
VERSION = '1.19.0'
LIMIT = 1024 ** 3

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Unexpected HTTP redirect')

def check(condition, message):
    if not condition:
        raise ValueError(message)

def checksum(path, algorithm):
    with path.open('rb') as f:
        return hashlib.file_digest(f, algorithm).hexdigest()

def parse_sidecar(raw):
    match = re.fullmatch(rb'([a-fA-F0-9]{32}) [ *]' + re.escape(NAME.encode()) + rb'\r?\n?', raw)
    check(match is not None, 'Malformed MD5 sidecar or wrong filename')
    return match[1].decode().lower()

def verify_bytes(path, md5):
    check(path.stat().st_size > 0, 'Empty PBF')
    check(checksum(path, 'md5') == md5, 'Published MD5 mismatch')
    return checksum(path, 'sha256')

def fetch(url, target, limit):
    opener = urllib.request.build_opener(NoRedirect())
    req = urllib.request.Request(url, headers={'Accept-Encoding': 'identity', 'User-Agent': 'Railway-CEO-R13/1'})
    with opener.open(req, timeout=60) as response, target.open('xb') as output:
        check(response.status == 200 and response.geturl() == url, 'Unexpected HTTP response')
        check(response.headers.get('Content-Encoding', 'identity') == 'identity', 'Unexpected content encoding')
        check('html' not in response.headers.get('Content-Type', '').lower(), 'HTML response')
        length = response.headers.get('Content-Length')
        expected = int(length) if length is not None else None
        check(expected is None or 0 < expected <= limit, 'Invalid content length')
        size = 0
        while chunk := response.read(1024 * 1024):
            size += len(chunk)
            check(size <= limit, 'Download size limit exceeded')
            output.write(chunk)
        check(size > 0 and (expected is None or size == expected), 'Incomplete download')
        return {'url': url, 'bytes': size, 'contentLength': expected, 'etag': response.headers.get('ETag'), 'lastModified': response.headers.get('Last-Modified')}

def timestamp(value):
    check(isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', value), 'Missing or invalid UTC timestamp')
    return dt.datetime.fromisoformat(value.replace('Z', '+00:00'))

def validate_info(info, size):
    f, h, d = info['file'], info['header'], info['data']
    check(f['format'] == 'PBF' and f['size'] == size and h['with_history'] is False, 'Not a complete current PBF snapshot')
    check(d['objects_ordered'] is True and d.get('multiple_versions') is False, 'Unordered or multiple object versions')
    counts = d['count']
    check(all(type(counts[k]) is int and counts[k] >= 0 for k in ('nodes', 'ways', 'relations', 'changesets')), 'Invalid object counts')
    check(counts['nodes'] > 0 and counts['ways'] > 0 and counts['changesets'] == 0, 'Empty or unexpected snapshot objects')
    bbox = d['bbox']
    check(isinstance(bbox, list) and len(bbox) == 4 and all(type(x) in (int, float) and math.isfinite(x) for x in bbox), 'Invalid bounding box')
    check(-180 <= bbox[0] <= bbox[2] <= 180 and -90 <= bbox[1] <= bbox[3] <= 90, 'Invalid bounding coordinates')
    snapshot = h['option']['osmosis_replication_timestamp']
    check(timestamp(d['timestamp']['first']) <= timestamp(d['timestamp']['last']) <= timestamp(snapshot), 'Inconsistent timestamps')
    return snapshot

def private_workspace(workspace):
    root = workspace.resolve(strict=True)
    check(root.is_dir() and not any((p / '.git').exists() for p in (root, *root.parents)), 'Workspace must be outside Git')
    check(shutil.disk_usage(root).free >= 2 * LIMIT, 'Require at least 2 GiB free for raw acquisition')
    return root

def run(args):
    root = private_workspace(args.workspace)
    check(bool(args.review_ref.strip()), 'Record workspace and data review reference')
    tool = args.osmium.resolve(strict=True)
    check(re.fullmatch('[a-f0-9]{64}', args.osmium_sha256) and checksum(tool, 'sha256') == args.osmium_sha256, 'Pinned binary SHA256 mismatch')
    version = subprocess.check_output([str(tool), '--version'], text=True, timeout=30)
    check(re.search(r'(?m)^osmium version 1\.19\.0(?:\s|$)', version), 'Wrong Osmium version')
    destination = root / 'eastern-zone-261101-verified'
    check(not destination.exists(), 'Verified destination already exists; do not overwrite')
    with tempfile.TemporaryDirectory(prefix='r13-stage-', dir=root) as temporary:
        stage = Path(temporary)
        sidecar, pbf = stage / (NAME + '.md5'), stage / NAME
        side_http = fetch(BASE + sidecar.name, sidecar, 4096)
        published = parse_sidecar(sidecar.read_bytes())
        pbf_http = fetch(BASE + NAME, pbf, LIMIT)
        sha = verify_bytes(pbf, published)
        info = json.loads(subprocess.check_output([str(tool), 'fileinfo', '-e', '-j', str(pbf)], text=True, timeout=900))
        snapshot = validate_info(info, pbf.stat().st_size)
        check(verify_bytes(pbf, published) == sha, 'Bytes changed after parser scan')
        manifest = {'schemaVersion': 1, 'status': 'BYTES_AND_PARSER_VALIDATED', 'region': 'Geofabrik Eastern Zone', 'retrievedAtUtc': dt.datetime.now(dt.timezone.utc).isoformat(), 'filename': NAME, 'source': pbf_http, 'sidecar': side_http, 'publishedMd5': published, 'sha256': sha, 'snapshotUtc': snapshot, 'license': 'ODbL-1.0', 'attribution': '© OpenStreetMap contributors', 'licenseUrl': 'https://www.openstreetmap.org/copyright', 'workspaceReviewReference': args.review_ref, 'osmium': {'pin': VERSION, 'binarySha256': args.osmium_sha256, 'versionOutput': version}, 'fileinfo': info}
        (stage / 'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
        stage.rename(destination)
    print('Validated private dataset:', destination)
    print('SHA256:', sha)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', required=True, type=Path, help='Existing approved private India workspace outside Git')
    parser.add_argument('--review-ref', required=True, help='Reference to recorded data/workspace review; not a legal certification')
    parser.add_argument('--osmium', required=True, type=Path)
    parser.add_argument('--osmium-sha256', required=True, help='Trusted digest of pinned executable from reviewed build/package')
    run(parser.parse_args())

if __name__ == '__main__':
    main()
