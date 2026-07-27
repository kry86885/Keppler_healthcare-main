def test_csrf_protection_missing_token(app_client):
    import app as app_module

    app_module.app.config["TESTING"] = False  # Re-enable CSRF
    try:
        # /api/auth/login itself must stay CSRF-exempt (it establishes the session, so
        # requiring a token there would block login whenever a stale session cookie from
        # an earlier/different app instance happens to still be present in the browser).
        app_client.set_cookie("hospai_session", "dummy")
        login_resp = app_client.post("/api/auth/login", json={"username": "test", "password": "test"})
        assert login_resp.status_code == 401  # invalid credentials, not CSRF-blocked

        # A real authenticated, session-scoped action must still require a matching CSRF token.
        logout_resp = app_client.post("/api/auth/logout")
        assert logout_resp.status_code == 403
    finally:
        app_module.app.config["TESTING"] = True
