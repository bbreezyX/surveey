import uuid
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.conf import settings

class Account(AbstractUser):
    ROLE_CHOICES = [('editor', 'Editor'), ('publisher', 'Penerbit'), ('owner', 'Pemilik')]
    role = models.CharField(max_length=12, choices=ROLE_CHOICES, default='editor')
    session_version = models.PositiveIntegerField(default=1)
    class Meta:
        constraints = [models.CheckConstraint(condition=models.Q(role__in=['editor', 'publisher', 'owner']), name='valid_account_role')]

class Point(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    nomor = models.CharField(max_length=250, unique=True)
    revision = models.PositiveIntegerField(default=1)
    state = models.JSONField()
    archived = models.BooleanField(default=False, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

class Photo(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    point = models.ForeignKey(Point, on_delete=models.PROTECT, null=True)
    original_key = models.CharField(max_length=200, unique=True)
    derivative_key = models.CharField(max_length=200, unique=True, null=True)
    original_checksum = models.CharField(max_length=64)
    derivative_checksum = models.CharField(max_length=64, blank=True)
    mime = models.CharField(max_length=40, blank=True)
    width = models.PositiveIntegerField(default=0)
    height = models.PositiveIntegerField(default=0)
    ready = models.BooleanField(default=False)
    legacy_name = models.TextField(blank=True)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        constraints = [models.CheckConstraint(condition=models.Q(ready=False) | (
            models.Q(derivative_key__isnull=False, width__gt=0, height__gt=0, mime='image/jpeg') & ~models.Q(derivative_checksum='')),
            name='ready_photo_has_derivative')]

class Observation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    point = models.ForeignKey(Point, on_delete=models.PROTECT)
    date = models.CharField(max_length=10, blank=True)  # ISO date or explicit unknown baseline.
    longitude = models.DecimalField(max_digits=20, decimal_places=14)
    latitude = models.DecimalField(max_digits=20, decimal_places=14)
    notes = models.TextField(blank=True)
    source = models.TextField(blank=True)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        constraints = [models.CheckConstraint(condition=models.Q(latitude__gte=-90, latitude__lte=90,
            longitude__gte=-180, longitude__lte=180), name='observation_coordinate_bounds')]

class ObservationEvidence(models.Model):
    observation = models.ForeignKey(Observation, on_delete=models.PROTECT)
    photo = models.ForeignKey(Photo, on_delete=models.PROTECT)
    class Meta:
        constraints = [models.UniqueConstraint(fields=['observation', 'photo'], name='unique_observation_evidence')]

class Draft(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    point = models.ForeignKey(Point, on_delete=models.PROTECT)
    base_revision = models.PositiveIntegerField()
    proposed = models.JSONField()
    reason = models.TextField()
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    status = models.CharField(max_length=12, choices=[('pending', 'Menunggu'), ('published', 'Terbit'), ('discarded', 'Dibatalkan')], default='pending', db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

class Revision(models.Model):
    point = models.ForeignKey(Point, on_delete=models.PROTECT, related_name='revisions')
    number = models.PositiveIntegerField()
    state = models.JSONField()
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True)
    reason = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        constraints = [models.UniqueConstraint(fields=['point', 'number'], name='unique_point_revision')]

class AuditEvent(models.Model):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True)
    action = models.CharField(max_length=60)
    target = models.CharField(max_length=250)
    before = models.JSONField(null=True)
    after = models.JSONField(null=True)
    reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    def save(self, *args, **kwargs):
        if self.pk:
            raise ValueError('Audit events are append-only.')
        return super().save(*args, **kwargs)
    def delete(self, *args, **kwargs):
        raise ValueError('Audit events cannot be deleted by the application.')

class RateBucket(models.Model):
    key = models.CharField(max_length=64, primary_key=True)
    window_start = models.DateTimeField()
    count = models.PositiveIntegerField(default=0)
