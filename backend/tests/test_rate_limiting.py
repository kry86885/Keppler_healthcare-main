def test_rate_limiting_login_endpoint(app_client):
    import app as app_module
    app_module.app.config["RATELIMIT_ENABLED"] = True
    from core.limiter import limiter
    limiter.enabled = True

    for _ in range(5):
        app_client.post("/api/auth/login", json={"username": "wrong", "password": "wrong"})
    
    # 6th should fail
    resp = app_client.post("/api/auth/login", json={"username": "wrong", "password": "wrong"})
    assert resp.status_code == 429

    app_module.app.config["RATELIMIT_ENABLED"] = False
    limiter.enabled = False
