import re

with open('utils/database.py', 'r', encoding='utf-8') as f:
    content = f.read()

new_tables = ""
    # Phase H Tables
    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS bed_master (
            id {id_column},
            hospital_id INTEGER NOT NULL,
            ward TEXT NOT NULL,
            room_no TEXT NOT NULL,
            bed_no TEXT NOT NULL,
            status TEXT DEFAULT 'Available', -- Available, Occupied, Cleaning, Maintenance
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS icu_monitoring (
            id {id_column},
            hospital_id INTEGER NOT NULL,
            patient_id TEXT NOT NULL,
            admission_id INTEGER,
            heart_rate INTEGER,
            blood_pressure TEXT,
            spo2 INTEGER,
            ventilator_active BOOLEAN DEFAULT 0,
            critical_alerts TEXT,
            recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS opd_queue (
            id {id_column},
            hospital_id INTEGER NOT NULL,
            patient_id TEXT NOT NULL,
            department TEXT NOT NULL,
            doctor_id TEXT,
            token_number INTEGER NOT NULL,
            status TEXT DEFAULT 'Waiting', -- Waiting, In Consultation, Completed, Cancelled
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS emergency_triage (
            id {id_column},
            hospital_id INTEGER NOT NULL,
            patient_name TEXT NOT NULL,
            age INTEGER,
            gender TEXT,
            priority TEXT NOT NULL, -- Red, Yellow, Green
            chief_complaint TEXT NOT NULL,
            arrival_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'Pending' -- Pending, Admitted, Discharged
        )
        """
    )
    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS ambulances (
            id {id_column},
            hospital_id INTEGER NOT NULL,
            vehicle_number TEXT NOT NULL,
            driver_name TEXT,
            driver_phone TEXT,
            status TEXT DEFAULT 'Available', -- Available, On Trip, Maintenance
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS ambulance_dispatch (
            id {id_column},
            hospital_id INTEGER NOT NULL,
            ambulance_id INTEGER NOT NULL,
            patient_id TEXT,
            pickup_location TEXT NOT NULL,
            drop_location TEXT NOT NULL,
            dispatch_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completion_time TIMESTAMP,
            status TEXT DEFAULT 'En Route' -- En Route, Completed, Cancelled
        )
        """
    )
    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS nurse_shifts (
            id {id_column},
            hospital_id INTEGER NOT NULL,
            nurse_id TEXT NOT NULL,
            ward TEXT NOT NULL,
            shift_start TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            shift_end TIMESTAMP,
            handover_notes TEXT
        )
        """
    )
    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS nursing_notes (
            id {id_column},
            hospital_id INTEGER NOT NULL,
            patient_id TEXT NOT NULL,
            nurse_id TEXT NOT NULL,
            note TEXT NOT NULL,
            vitals TEXT,
            recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )"

target = '''    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_clinical_embeddings_source "
        "ON clinical_document_embeddings(source_table, source_id)"
    )'''

new_content = content.replace(target, target + "\n" + new_tables)

with open('utils/database.py', 'w', encoding='utf-8') as f:
    f.write(new_content)
