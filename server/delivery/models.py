import uuid
from django.db import models

class Publication(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    geojson = models.JSONField()
    checksum = models.CharField(max_length=64)
    manifest = models.JSONField(default=list)

class ActivePublication(models.Model):
    id = models.PositiveSmallIntegerField(primary_key=True, default=1)
    publication = models.ForeignKey(Publication, on_delete=models.PROTECT, null=True)
    class Meta:
        constraints = [models.CheckConstraint(condition=models.Q(id=1), name='one_active_publication')]

class PublishedMedia(models.Model):
    id = models.UUIDField(primary_key=True, editable=False)
    derivative_key = models.CharField(max_length=200, unique=True)
    checksum = models.CharField(max_length=64)
    mime = models.CharField(max_length=40)
    revoked = models.BooleanField(default=False)
    # Null means present in active manifest. Old manifests retain access for 30 days.
    retain_until = models.DateTimeField(null=True)

class MediaGrant(models.Model):
    publication = models.ForeignKey(Publication, on_delete=models.PROTECT)
    media = models.ForeignKey(PublishedMedia, on_delete=models.PROTECT)
    class Meta:
        constraints = [models.UniqueConstraint(fields=['publication', 'media'], name='unique_publication_media')]
