def test_rate_limiting_login_endpoint(app_client):
    import app as app_module
    app_module.app.config["RATELIMIT_ENABLED"] = True
    from core.limiter import limiter
    limiter.enabled = True

    # Login is limited to 20/minute (see modules/auth/routes.py) -- raised from the
    # original 5/minute because that counted the browser's CORS preflight OPTIONS
    # request against the same budget as the real POST, so 2-3 real attempts from
    # one browser tab could exhaust it and even lock out the *next preflight*.
    for _ in range(20):
        app_client.post("/api/auth/login", json={"username": "wrong", "password": "wrong"})

    # 21st should fail
    resp = app_client.post("/api/auth/login", json={"username": "wrong", "password": "wrong"})
    assert resp.status_code == 429

    app_module.app.config["RATELIMIT_ENABLED"] = False
    limiter.enabled = False
