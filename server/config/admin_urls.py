from django.urls import include, path
from django.views.generic import RedirectView
from survey import views
admin_patterns = [
    path('', views.home), path('login', views.login), path('logout', views.logout),
    path('assets/<str:filename>', views.asset), path('api/session', views.session),
    path('api/points', views.points), path('api/points/map', views.point_map), path('api/points/<uuid:point_id>', views.point_detail),
    path('api/points/<uuid:point_id>/restorations', views.restore),
    path('api/drafts', views.drafts), path('api/drafts/<uuid:draft_id>/discard', views.discard),
    path('api/publications', views.publications), path('api/publications/publish', views.publish),
    path('api/publications/baseline', views.baseline), path('api/photos', views.photos),
    path('api/photos/<uuid:photo_id>/revocations', views.revoke),
    path('api/photos/<uuid:photo_id>/<str:kind>', views.photo_content),
    path('api/accounts', views.accounts), path('api/accounts/<int:account_id>', views.account_update),
    path('api/password', views.password), path('api/audit', views.audit_history), path('api/export', views.export),
    path('api/export.csv', views.export_csv), path('api/evidence', views.legacy_evidence),
]

urlpatterns = [
    path('', RedirectView.as_view(url='/admin/', permanent=False)),
    path('admin', RedirectView.as_view(url='/admin/', permanent=False)),
    path('admin/', include(admin_patterns)),
]
