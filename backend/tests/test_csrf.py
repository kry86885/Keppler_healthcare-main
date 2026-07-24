def test_csrf_protection_missing_token(app_client):
    import app as app_module
    app_module.app.config["TESTING"] = False # Re-enable CSRF
    
    # Set session cookie
    app_client.set_cookie("hospai_session", "dummy")
    
    resp = app_client.post("/api/auth/login", json={"username": "test", "password": "test"})
    assert resp.status_code == 403

    app_module.app.config["TESTING"] = True
