"""Optional S3/R2 storage for PDFs when AWS_* or R2_* env vars are set."""
from __future__ import annotations

import os
from typing import Optional

_BUCKET = os.getenv("S3_BUCKET") or os.getenv("R2_BUCKET")
_REGION = os.getenv("AWS_REGION", "us-east-1")
_ENDPOINT = os.getenv("S3_ENDPOINT_URL") or os.getenv("R2_ENDPOINT")


def s3_enabled() -> bool:
    return bool(_BUCKET and os.getenv("AWS_ACCESS_KEY_ID"))


def upload_file_local_path(local_path: str, key: str) -> Optional[str]:
    if not s3_enabled():
        return None
    try:
        import boto3

        s3 = boto3.client(
            "s3",
            endpoint_url=_ENDPOINT or None,
            region_name=_REGION,
        )
        s3.upload_file(local_path, _BUCKET, key)
        base = os.getenv("PUBLIC_ASSET_BASE", "")
        return f"{base}/{key}" if base else f"s3://{_BUCKET}/{key}"
    except Exception:
        return None


def presign_get(key: str, expires: int = 3600) -> Optional[str]:
    if not s3_enabled():
        return None
    try:
        import boto3

        s3 = boto3.client("s3", endpoint_url=_ENDPOINT or None, region_name=_REGION)
        return s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": _BUCKET, "Key": key},
            ExpiresIn=expires,
        )
    except Exception:
        return None
