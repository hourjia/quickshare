from django.urls import path

from . import views


urlpatterns = [
    path("auth/status", views.auth_status, name="auth-status"),
    path("auth/login", views.login, name="auth-login"),
    path("auth/logout", views.logout, name="auth-logout"),
    path("health", views.health, name="health"),
]

