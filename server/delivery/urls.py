from django.urls import path, re_path
from . import views
urlpatterns = [path('health', views.readiness), path('data/points.geojson', views.points), re_path(r'^media/(?P<media_id>[0-9a-f]{32})$', views.media)]
