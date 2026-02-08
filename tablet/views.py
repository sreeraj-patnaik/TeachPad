from django.shortcuts import render


def phone(request):
    """Drawing tablet view: zoomable input surface for phone browser."""
    return render(request, 'tablet/phone.html')


def display(request):
    """Master display view: fullscreen canvas for laptop browser."""
    return render(request, 'tablet/display.html')
