import sys

with open('core/auth.py', 'r', encoding='utf-8') as f:
    text = f.read()

import re

# find get_session_user and delete_session
match = re.search(r'def get_session_user\(.*?def delete_session\(', text, re.DOTALL)
if match:
    new_func = '''def get_session_user(token: Optional[str]):
    if not token:
        return None

    token_hash = _hash_session_token(token)
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT s.id as session_id,
                   s.expires_at as expires_at,
                   s.created_at as session_created_at,
                   s.hospital_id as hospital_id,
                   u.id as user_id,
                   u.username,
                   u.role,
                   u.access_role,
                   u.user_type,
                   u.module_access,
                   u.full_name,
                   u.email,
                   u.phone,
                   u.employee_id,
                   u.status,
                   u.password_changed_at,
                   h.code as hospital_code,
                   h.status as hospital_status
            FROM sessions s
            JOIN users u ON s.user_id = u.id AND s.hospital_id = u.hospital_id
            JOIN hospitals h ON s.hospital_id = h.id
            WHERE s.token_hash = ?
        """,
            (token_hash,),
        )
        row = cursor.fetchone()
        if not row:
            return None

        expires_at = _parse_ts(row["expires_at"])
        if expires_at <= _now_utc():
            cursor.execute("DELETE FROM sessions WHERE id = ?", (row["session_id"],))
            conn.commit()
            return None

        if row["password_changed_at"]:
            session_created_at = _parse_ts(row["session_created_at"])
            password_changed_at = _parse_ts(row["password_changed_at"])
            if session_created_at < password_changed_at:
                cursor.execute("DELETE FROM sessions WHERE id = ?", (row["session_id"],))
                conn.commit()
                return None

        if row["status"] == "inactive":
            cursor.execute("DELETE FROM sessions WHERE id = ?", (row["session_id"],))
            conn.commit()
            return None

        if row["hospital_status"] != "active":
            cursor.execute("DELETE FROM sessions WHERE id = ?", (row["session_id"],))
            conn.commit()
            return None

        cursor.execute(
            "UPDATE sessions SET last_seen = CURRENT_TIMESTAMP WHERE id = ?",
            (row["session_id"],),
        )
        conn.commit()

    return resolve_user_profile(
        {
            "id": row["user_id"],
            "hospital_id": row["hospital_id"],
            "username": row["username"],
            "role": row["role"],
            "access_role": row["access_role"],
            "user_type": row["user_type"],
            "module_access": row["module_access"],
            "full_name": row["full_name"],
            "email": row["email"],
            "phone": row["phone"],
            "employee_id": row["employee_id"],
            "status": row["status"],
            "hospital_code": row["hospital_code"],
        }
    )


def delete_session('''
    text = text[:match.start()] + new_func + text[match.end() - 19:]
    with open('core/auth.py', 'w', encoding='utf-8') as f:
        f.write(text)
    print("Replaced!")
else:
    print("Not found!")
