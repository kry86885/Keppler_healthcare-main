import os
import time
from datetime import date


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_float(name: str):
    raw = os.getenv(name)
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def test_patient_table_write_read_performance():
    from utils.database import get_connection, resolve_hospital_id

    rows = max(100, _env_int("PERF_PATIENT_ROWS", 3000))
    batch_size = max(50, _env_int("PERF_BATCH_SIZE", 500))
    max_insert_seconds = _env_float("PERF_MAX_INSERT_SECONDS")
    max_full_read_seconds = _env_float("PERF_MAX_FULL_READ_SECONDS")
    max_search_seconds = _env_float("PERF_MAX_SEARCH_SECONDS")
    max_lookup_seconds = _env_float("PERF_MAX_LOOKUP_SECONDS")

    hospital_id = resolve_hospital_id()
    run_id = int(time.time())
    phone_seed = run_id % 1000000
    seed_dob = date(1990, 1, 1).isoformat()

    with get_connection() as conn:
        cursor = conn.cursor()

        payload = []
        for i in range(rows):
            payload.append(
                (
                    hospital_id,
                    f"PERF-{run_id}-{i:06d}",
                    f"PerfName{i}",
                    "",
                    f"PerfLast{i}",
                    seed_dob,
                    35,
                    72.5,
                    175.0,
                    "Male" if i % 2 == 0 else "Female",
                    0,
                    "",
                    "performance test symptom",
                    f"555{(phone_seed + i) % 10000000:07d}",
                )
            )

        insert_started = time.perf_counter()
        for offset in range(0, rows, batch_size):
            chunk = payload[offset : offset + batch_size]
            cursor.executemany(
                """
                INSERT INTO patients (
                    hospital_id, patient_id, name, middle_name, last_name, dob, age, weight, height,
                    gender, pregnant, allergies, symptoms, phone
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                chunk,
            )
        conn.commit()
        insert_seconds = time.perf_counter() - insert_started

        full_read_started = time.perf_counter()
        cursor.execute("SELECT * FROM patients WHERE hospital_id = ? ORDER BY created_at DESC", (hospital_id,))
        full_read_rows = cursor.fetchall()
        full_read_seconds = time.perf_counter() - full_read_started

        target_patient_id = f"PERF-{run_id}-{rows // 2:06d}"
        lookup_started = time.perf_counter()
        cursor.execute("SELECT * FROM patients WHERE hospital_id = ? AND patient_id = ?", (hospital_id, target_patient_id))
        lookup_row = cursor.fetchone()
        lookup_seconds = time.perf_counter() - lookup_started

        search_started = time.perf_counter()
        cursor.execute(
            """
            SELECT * FROM patients
            WHERE hospital_id = ?
              AND (
                LOWER(name) LIKE ?
                OR LOWER(last_name) LIKE ?
                OR LOWER(patient_id) LIKE ?
              )
            ORDER BY created_at DESC
            """,
            (hospital_id, "%perfname1%", "%perfname1%", "%perfname1%"),
        )
        search_rows = cursor.fetchall()
        search_seconds = time.perf_counter() - search_started

    insert_rps = rows / insert_seconds if insert_seconds > 0 else float("inf")
    full_read_rps = len(full_read_rows) / full_read_seconds if full_read_seconds > 0 else float("inf")

    print(
        (
            "PATIENT_TABLE_PERF "
            f"rows={rows} "
            f"insert_seconds={insert_seconds:.4f} "
            f"insert_rows_per_sec={insert_rps:.2f} "
            f"full_read_seconds={full_read_seconds:.4f} "
            f"full_read_rows={len(full_read_rows)} "
            f"full_read_rows_per_sec={full_read_rps:.2f} "
            f"point_lookup_seconds={lookup_seconds:.6f} "
            f"search_seconds={search_seconds:.6f} "
            f"search_rows={len(search_rows)}"
        )
    )

    assert len(full_read_rows) >= rows
    assert lookup_row is not None
    assert len(search_rows) > 0

    if max_insert_seconds is not None:
        assert insert_seconds <= max_insert_seconds, (
            f"Insert performance too slow: {insert_seconds:.4f}s > {max_insert_seconds:.4f}s"
        )
    if max_full_read_seconds is not None:
        assert full_read_seconds <= max_full_read_seconds, (
            f"Full read performance too slow: {full_read_seconds:.4f}s > {max_full_read_seconds:.4f}s"
        )
    if max_lookup_seconds is not None:
        assert lookup_seconds <= max_lookup_seconds, (
            f"Lookup performance too slow: {lookup_seconds:.6f}s > {max_lookup_seconds:.6f}s"
        )
    if max_search_seconds is not None:
        assert search_seconds <= max_search_seconds, (
            f"Search performance too slow: {search_seconds:.6f}s > {max_search_seconds:.6f}s"
        )
