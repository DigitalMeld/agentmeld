#!/usr/bin/env python3
"""Explicit offline image inventory. No mounts, credentials, or provider calls."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time
import uuid

parser = argparse.ArgumentParser()
parser.add_argument('--context', required=True)
parser.add_argument('--image', default='agentmeld-m0:local')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]

def docker(*command, **kwargs):
    return subprocess.run(['docker', '--context', args.context, *command], check=True,
                          capture_output=True, text=True, timeout=60, **kwargs)

image = json.loads(docker('image', 'inspect', args.image).stdout)[0]
image_id = image['Id']
if not image_id.startswith('sha256:') or len(image_id) != 71:
    raise ValueError('immutable image ID required')
name = 'agentmeld-m0-inventory-' + str(uuid.uuid4())
try:
    result = docker('run', '--rm', '-i', '--name', name, '--network=none', '--read-only',
                    '--user=1000:1000', '--cap-drop=ALL', '--security-opt=no-new-privileges',
                    '--memory=256m', '--cpus=1', '--pids-limit=32', image_id,
                    'node', '--input-type=module', input=(root / 'scripts/inventory-image.mjs').read_text())
finally:
    # The unique container is ours; a timeout must not leave it running.
    remaining = docker('ps', '-a', '--format', '{{.Names}}').stdout.splitlines()
    if name in remaining:
        docker('rm', '-f', name)
report = json.loads(result.stdout)
report['image'] = {key: image[key] for key in ('Id', 'Os', 'Architecture', 'Created')}
report['localCheckoutInputs'] = {file: hashlib.sha256((root / file).read_bytes()).hexdigest()
                    for file in ('Cargo.lock', 'package-lock.json', 'infra/m0/Dockerfile')}
if report['packageLock']['sha256'] != report['localCheckoutInputs']['package-lock.json']:
    raise ValueError('image package lock does not match checkout')
metadata = subprocess.run(['cargo', 'metadata', '--locked', '--offline', '--format-version=1'],
                         cwd=root, check=True, capture_output=True, text=True, timeout=30)
report['rustLockResolution'] = [
    {key: package[key] for key in ('name', 'version', 'license', 'source')}
    for package in json.loads(metadata.stdout)['packages']]
report['rustScope'] = 'Local locked dependency resolution, including target-specific entries; not proof every crate is linked into the image.'
evidence = root / '.local/m0/inventory'
evidence.mkdir(parents=True, exist_ok=True)
output = evidence / (str(time.time_ns()) + '.json')
output.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'report': str(output), 'image': image_id, 'npmPackages': len(report['npm']),
                  'debianPackages': len(report['debian']), 'rustPackages': len(report['rustLockResolution']),
                  'missingDebianCopyright': [p['name'] for p in report['debian'] if p['copyright'].get('missing')],
                  'browserNoticeFiles': len(report['browserNotices'])}))
