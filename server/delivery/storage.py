import re
from functools import lru_cache
from pathlib import Path
from django.conf import settings
import boto3
from botocore.config import Config

KEY = re.compile(r'^(originals|display)/[0-9a-f]{32}$')

def check_key(key):
    if not KEY.fullmatch(key):
        raise ValueError('Invalid storage key.')

def client():
    return configured_client(settings.S3_ENDPOINT, settings.S3_ACCESS_KEY, settings.S3_SECRET_KEY,
        settings.S3_REGION, settings.S3_ADDRESSING_STYLE)

@lru_cache(maxsize=4)
def configured_client(endpoint, access_key, secret_key, region, addressing_style):
    # Per-process pool reuse avoids a new TLS connection for every manifest object.
    # All connection settings participate in the cache key, including rotated keys.
    return boto3.client('s3', endpoint_url=endpoint, aws_access_key_id=access_key,
        aws_secret_access_key=secret_key, region_name=region,
        config=Config(connect_timeout=5, read_timeout=20, retries={'max_attempts': 2}, signature_version='s3v4',
            s3={'addressing_style': addressing_style}))

def put(key, content, mime='application/octet-stream'):
    check_key(key)
    if settings.STORAGE_BACKEND == 'filesystem':
        path = Path(settings.STORAGE_ROOT) / key
        path.parent.mkdir(parents=True, exist_ok=True)
        # Unique keys only; overwrites of published URLs are forbidden.
        with path.open('xb') as stream:
            stream.write(content)
    else:
        client().put_object(Bucket=settings.S3_BUCKET, Key=key, Body=content, ContentType=mime, IfNoneMatch='*')

def get(key):
    check_key(key)
    if settings.STORAGE_BACKEND == 'filesystem':
        return (Path(settings.STORAGE_ROOT) / key).open('rb')
    return client().get_object(Bucket=settings.S3_BUCKET, Key=key)['Body']

def exists(key):
    check_key(key)
    if settings.STORAGE_BACKEND == 'filesystem':
        return (Path(settings.STORAGE_ROOT) / key).is_file()
    from botocore.exceptions import ClientError
    try:
        client().head_object(Bucket=settings.S3_BUCKET, Key=key)
        return True
    except ClientError as error:
        if error.response['Error']['Code'] in ('404', 'NoSuchKey', 'NotFound'):
            return False
        raise

def remove(key):
    check_key(key)
    if settings.STORAGE_BACKEND == 'filesystem':
        (Path(settings.STORAGE_ROOT) / key).unlink(missing_ok=True)
    else:
        client().delete_object(Bucket=settings.S3_BUCKET, Key=key)
