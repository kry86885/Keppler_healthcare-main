from flask import Blueprint, g, jsonify, request

from app import (
    require_permissions,
    current_hospital_id,
    log_audit_event,
    validate_required_fields,
)
from utils.database import (
    create_bed,
    create_beds_range,
    delete_bed,
    find_active_bed_for_patient,
    get_bed,
    list_beds,
    assign_patient_to_bed,
    release_bed,
    update_bed,
)

beds_bp = Blueprint("beds", __name__)

BED_TYPES = ("General", "ICU", "Private", "Semi-Private")
# Sane ceiling on a single bulk-add call -- a real room-sized batch (even a
# large 40-60 bed general ward) fits well under this; anything bigger is
# almost certainly a typo in the bed number range.
MAX_BULK_BEDS = 200


@beds_bp.get("/api/beds")
@require_permissions("beds.read")
def beds_list():
    hospital_id = current_hospital_id()
    beds = list_beds(hospital_id)
    total = len(beds)
    occupied = sum(1 for bed in beds if bed["status"] == "Occupied")
    maintenance = sum(1 for bed in beds if bed["status"] == "Maintenance")
    available = total - occupied - maintenance
    return jsonify(
        {
            "beds": beds,
            "summary": {
                "total": total,
                "available": available,
                "occupied": occupied,
                "maintenance": maintenance,
            },
        }
    )


@beds_bp.post("/api/beds")
@require_permissions("beds.write")
def beds_create():
    payload = request.get_json(silent=True) or {}
    error = validate_required_fields(payload, ["ward", "room_no", "bed_no"])
    if error:
        return error

    bed_type = (payload.get("bed_type") or "General").strip()
    if bed_type not in BED_TYPES:
        bed_type = "General"

    hospital_id = current_hospital_id()
    try:
        bed_id = create_bed(
            hospital_id,
            payload["ward"].strip(),
            payload["room_no"].strip(),
            payload["bed_no"].strip(),
            bed_type,
        )
    except Exception as exc:
        # Almost always the (hospital_id, ward, room_no, bed_no) unique index --
        # a friendlier message than a raw constraint-violation string.
        if "unique" in str(exc).lower() or "duplicate" in str(exc).lower():
            return (
                jsonify(
                    {
                        "error": (
                            f"Bed {payload['bed_no']} already exists in "
                            f"{payload['ward']} / Room {payload['room_no']}."
                        )
                    }
                ),
                409,
            )
        raise

    log_audit_event(
        "create", "bed_master", str(bed_id),
        {"ward": payload["ward"], "room_no": payload["room_no"], "bed_no": payload["bed_no"]},
    )
    return jsonify({"id": bed_id}), 201


@beds_bp.post("/api/beds/bulk")
@require_permissions("beds.write")
def beds_bulk_create():
    """Adds a whole numbered range of beds to one room in a single action --
    e.g. from_bed=1, to_bed=20 creates 20 beds -- instead of adding each bed
    one at a time. Numbers that already exist in that ward/room are skipped,
    not treated as an error, so this is also safe to re-run to top up a room."""
    payload = request.get_json(silent=True) or {}
    error = validate_required_fields(payload, ["ward", "room_no", "from_bed", "to_bed"])
    if error:
        return error

    try:
        from_bed = int(payload["from_bed"])
        to_bed = int(payload["to_bed"])
    except (TypeError, ValueError):
        return jsonify({"error": "from_bed and to_bed must be numbers"}), 400
    if from_bed < 1 or to_bed < from_bed:
        return jsonify({"error": "to_bed must be greater than or equal to from_bed"}), 400
    if to_bed - from_bed + 1 > MAX_BULK_BEDS:
        return jsonify({"error": f"Can't add more than {MAX_BULK_BEDS} beds at once."}), 400

    bed_type = (payload.get("bed_type") or "General").strip()
    if bed_type not in BED_TYPES:
        bed_type = "General"

    hospital_id = current_hospital_id()
    result = create_beds_range(
        hospital_id,
        payload["ward"].strip(),
        payload["room_no"].strip(),
        bed_type,
        from_bed,
        to_bed,
    )
    log_audit_event(
        "create",
        "bed_master",
        None,
        {
            "ward": payload["ward"],
            "room_no": payload["room_no"],
            "created_count": len(result["created"]),
            "skipped_count": len(result["skipped"]),
        },
    )
    return (
        jsonify(
            {
                "created_count": len(result["created"]),
                "skipped_count": len(result["skipped"]),
                "skipped": result["skipped"],
            }
        ),
        201,
    )


@beds_bp.put("/api/beds/<int:bed_id>")
@require_permissions("beds.write")
def beds_update(bed_id):
    hospital_id = current_hospital_id()
    payload = request.get_json(silent=True) or {}

    fields = {}
    for key in ("ward", "room_no", "bed_no"):
        if payload.get(key):
            fields[key] = payload[key].strip()
    if payload.get("bed_type") and payload["bed_type"] in BED_TYPES:
        fields["bed_type"] = payload["bed_type"]
    if payload.get("status") in ("Available", "Maintenance"):
        # "Occupied" is only ever set by /assign -- setting it directly here
        # would desync bed_master from the bed_allocations row that's
        # supposed to be the source of truth for who's actually in the bed.
        bed = get_bed(bed_id, hospital_id)
        if bed and bed["status"] == "Occupied":
            return (
                jsonify({"error": "Release this bed's current patient before changing its status."}),
                400,
            )
        fields["status"] = payload["status"]

    if not fields:
        return jsonify({"error": "Nothing to update"}), 400

    updated = update_bed(bed_id, hospital_id, **fields)
    if not updated:
        return jsonify({"error": "Bed not found"}), 404

    log_audit_event("update", "bed_master", str(bed_id), fields)
    return jsonify({"success": True})


@beds_bp.delete("/api/beds/<int:bed_id>")
@require_permissions("beds.write")
def beds_delete(bed_id):
    hospital_id = current_hospital_id()
    deleted = delete_bed(bed_id, hospital_id)
    if not deleted:
        return (
            jsonify({"error": "Bed not found, or it's currently occupied -- release it first."}),
            400,
        )
    log_audit_event("delete", "bed_master", str(bed_id))
    return jsonify({"success": True})


@beds_bp.post("/api/beds/<int:bed_id>/assign")
@require_permissions("beds.write")
def beds_assign(bed_id):
    hospital_id = current_hospital_id()
    payload = request.get_json(silent=True) or {}
    error = validate_required_fields(payload, ["patient_id"])
    if error:
        return error

    patient_id = payload["patient_id"]
    existing = find_active_bed_for_patient(patient_id, hospital_id)
    if existing:
        return (
            jsonify(
                {
                    "error": (
                        f"This patient is already assigned to {existing['ward']} / "
                        f"Room {existing['room_no']} / Bed {existing['bed_no']}. "
                        "Release that bed first to move them."
                    )
                }
            ),
            409,
        )

    try:
        result = assign_patient_to_bed(
            hospital_id, bed_id, patient_id, (payload.get("notes") or "").strip()
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 409
    if result is None:
        return jsonify({"error": "Bed not found"}), 404

    log_audit_event(
        "assign", "bed_allocations", str(result["allocation_id"]),
        {"bed_id": bed_id, "patient_id": patient_id, "admission_id": result["admission_id"]},
    )
    return jsonify(result), 201


@beds_bp.post("/api/beds/<int:bed_id>/release")
@require_permissions("beds.write")
def beds_release(bed_id):
    hospital_id = current_hospital_id()
    released = release_bed(hospital_id, bed_id)
    if not released:
        return jsonify({"error": "This bed doesn't have an active patient assigned."}), 400
    log_audit_event("release", "bed_allocations", str(bed_id))
    return jsonify({"success": True})
