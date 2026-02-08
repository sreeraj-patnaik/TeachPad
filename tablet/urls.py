from django.urls import path
from . import views

urlpatterns = [
    path('phone/', views.phone, name='phone'),
    path('display/', views.display, name='display'),
]
