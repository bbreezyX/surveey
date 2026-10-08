import hashlib
import io
import uuid
import warnings
from PIL import Image, ImageOps, UnidentifiedImageError
from delivery import storage
from .models import Photo
from .domain import Problem

MAX_BYTES = 20 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 40_000_000
FORMATS = {'JPEG': ('image/jpeg', {'.jpg', '.jpeg'}), 'PNG': ('image/png', {'.png'}), 'WEBP': ('image/webp', {'.webp'})}

def decode(raw, name='', mime=None):
    from pathlib import Path
    if not raw or len(raw) > MAX_BYTES:
        raise Problem('Foto wajib diisi dan maksimum 20 MiB.', 413)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as source:
                fmt, width, height = source.format, source.width, source.height
                if fmt not in FORMATS or width * height > 40_000_000 or getattr(source, 'n_frames', 1) != 1:
                    raise Problem('Foto harus JPEG, PNG, atau WebP tunggal, maksimum 40 megapiksel.')
                detected, extensions = FORMATS[fmt]
                if (name and Path(name).suffix.lower() not in extensions) or (mime and mime != detected):
                    raise Problem('Nama atau tipe berkas tidak sesuai isi foto.')
                source.verify()
            with Image.open(io.BytesIO(raw)) as source:
                source.load()
                image = ImageOps.exif_transpose(source).convert('RGBA')
                image.thumbnail((2400, 2400))
                background = Image.new('RGB', image.size, 'white')
                background.paste(image, mask=image.getchannel('A'))
                output = io.BytesIO()
                background.save(output, format='JPEG', quality=90, optimize=True)
                return output.getvalue(), width, height
    except Problem:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombWarning, Image.DecompressionBombError):
        raise Problem('Foto rusak atau tidak dapat dibaca dengan aman.')

def store_photo(raw, name, actor=None, point=None, mime=None):
    derivative, width, height = decode(raw, name, mime)
    photo_id = uuid.uuid4()
    original_key, derivative_key = f'originals/{photo_id.hex}', f'display/{photo_id.hex}'
    try:
        storage.put(original_key, raw)
        storage.put(derivative_key, derivative, 'image/jpeg')
        return Photo.objects.create(id=photo_id, point=point, original_key=original_key, derivative_key=derivative_key,
            original_checksum=hashlib.sha256(raw).hexdigest(), derivative_checksum=hashlib.sha256(derivative).hexdigest(),
            width=width, height=height, mime='image/jpeg', ready=True, uploaded_by=actor, legacy_name=name)
    except Exception:
        # DB errors or partial object writes must not leave a current photo reference.
        storage.remove(derivative_key)
        storage.remove(original_key)
        raise
