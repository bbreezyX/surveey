from django.urls import re_path
from .views import broker_media

urlpatterns = [re_path(r'^media/(?P<media_id>[0-9a-f]{32})$', broker_media)]
