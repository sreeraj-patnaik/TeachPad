from django.conf import settings
from django.urls import path, include
from django.views.static import serve

urlpatterns = [
    path('', include('tablet.urls')),
]

# Daphne doesn't serve static files like runserver; add explicit static serving in DEBUG
if settings.DEBUG:
    urlpatterns.append(
        path('static/<path:path>', serve, {'document_root': settings.STATICFILES_DIRS[0]}),
    )
