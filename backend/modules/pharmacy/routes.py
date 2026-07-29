from flask import Blueprint, request, jsonify, g
from app import (
    require_permissions, log_audit_event, rows_to_dicts, validate_required_fields, current_hospital_id
)
from utils.database import (
    list_pharmacy_sales, list_inventory_items, upsert_inventory_item, delete_inventory_item,
    create_pharmacy_sale, list_pharmacy_suppliers, create_pharmacy_supplier, update_pharmacy_supplier,
    delete_pharmacy_supplier, list_pharmacy_purchases, create_pharmacy_purchase, update_pharmacy_purchase,
    delete_pharmacy_purchase, get_pharmacy_summary
)

pharmacy_bp = Blueprint('pharmacy', __name__)

@pharmacy_bp.get("/api/pharmacy/inventory")
@require_permissions("pharmacy.read")
def pharmacy_inventory_list():
    return jsonify({"items": rows_to_dicts(list_inventory_items())})



@pharmacy_bp.post("/api/pharmacy/inventory")
@require_permissions("pharmacy.write")
def pharmacy_inventory_upsert():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(payload, ["medicine_name"])
    if validation_error:
        return validation_error
    item_id = upsert_inventory_item(payload)
    log_audit_event(
        "upsert",
        "pharmacy_inventory",
        str(item_id),
        {"medicine_name": payload.get("medicine_name")},
    )
    return jsonify({"item_id": item_id})



@pharmacy_bp.delete("/api/pharmacy/inventory/<int:item_id>")
@require_permissions("pharmacy.write")
def pharmacy_inventory_delete(item_id):
    deleted = delete_inventory_item(item_id, actor=g.current_user.get("username"))
    if not deleted:
        return jsonify({"error": "Inventory item not found"}), 404
    log_audit_event("delete", "pharmacy_inventory", str(item_id), {"item_id": item_id})
    return jsonify({"status": "ok"})



@pharmacy_bp.post("/api/pharmacy/sales")
@require_permissions("pharmacy.write")
def pharmacy_sale_create():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(
        payload, ["medicine_name", "quantity", "unit_price"]
    )
    if validation_error:
        return validation_error
    sale_id = create_pharmacy_sale(payload, hospital_id=current_hospital_id())
    log_audit_event(
        "create",
        "pharmacy_sales",
        str(sale_id),
        {"medicine_name": payload.get("medicine_name")},
    )
    return jsonify({"sale_id": sale_id})



@pharmacy_bp.get("/api/pharmacy/sales")
@require_permissions("pharmacy.read")
def pharmacy_sales_list():
    medicine_name = request.args.get("medicine_name")
    invoice_id = request.args.get("invoice_id")
    patient_id = request.args.get("patient_id")
    return jsonify(
        {
            "sales": rows_to_dicts(
                list_pharmacy_sales(
                    medicine_name=medicine_name,
                    invoice_id=invoice_id,
                    patient_id=patient_id,
                    hospital_id=current_hospital_id(),
                )
            )
        }
    )



@pharmacy_bp.get("/api/pharmacy/suppliers")
@require_permissions("pharmacy.read")
def pharmacy_suppliers_list():
    return jsonify({"suppliers": rows_to_dicts(list_pharmacy_suppliers())})



@pharmacy_bp.post("/api/pharmacy/suppliers")
@require_permissions("pharmacy.write")
def pharmacy_suppliers_create():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(payload, ["supplier_name"])
    if validation_error:
        return validation_error
    supplier_id = create_pharmacy_supplier(payload)
    log_audit_event("create", "pharmacy_suppliers", str(supplier_id), {"supplier_name": payload.get("supplier_name")})
    return jsonify({"supplier_id": supplier_id})



@pharmacy_bp.put("/api/pharmacy/suppliers/<int:supplier_id>")
@require_permissions("pharmacy.write")
def pharmacy_suppliers_update(supplier_id):
    payload = request.get_json(force=True)
    updated = update_pharmacy_supplier(supplier_id, payload)
    if not updated:
        return jsonify({"error": "Supplier not found"}), 404
    log_audit_event("update", "pharmacy_suppliers", str(supplier_id), {"supplier_id": supplier_id})
    return jsonify({"status": "ok"})



@pharmacy_bp.delete("/api/pharmacy/suppliers/<int:supplier_id>")
@require_permissions("pharmacy.write")
def pharmacy_suppliers_delete(supplier_id):
    deleted = delete_pharmacy_supplier(supplier_id, actor=g.current_user.get("username"))
    if not deleted:
        return jsonify({"error": "Supplier not found"}), 404
    log_audit_event("delete", "pharmacy_suppliers", str(supplier_id), {"supplier_id": supplier_id})
    return jsonify({"status": "ok"})



@pharmacy_bp.get("/api/pharmacy/purchases")
@require_permissions("pharmacy.read")
def pharmacy_purchases_list():
    status = request.args.get("status")
    return jsonify({"purchases": rows_to_dicts(list_pharmacy_purchases(status=status))})



@pharmacy_bp.post("/api/pharmacy/purchases")
@require_permissions("pharmacy.write")
def pharmacy_purchases_create():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(payload, ["medicine_name", "quantity", "unit_cost"])
    if validation_error:
        return validation_error
    purchase_id = create_pharmacy_purchase(payload)
    log_audit_event("create", "pharmacy_purchases", str(purchase_id), {"medicine_name": payload.get("medicine_name")})
    return jsonify({"purchase_id": purchase_id})



@pharmacy_bp.put("/api/pharmacy/purchases/<int:purchase_id>")
@require_permissions("pharmacy.write")
def pharmacy_purchases_update(purchase_id):
    payload = request.get_json(force=True)
    updated = update_pharmacy_purchase(purchase_id, payload)
    if not updated:
        return jsonify({"error": "Purchase not found"}), 404
    log_audit_event("update", "pharmacy_purchases", str(purchase_id), {"purchase_id": purchase_id})
    return jsonify({"status": "ok"})



@pharmacy_bp.delete("/api/pharmacy/purchases/<int:purchase_id>")
@require_permissions("pharmacy.write")
def pharmacy_purchases_delete(purchase_id):
    deleted = delete_pharmacy_purchase(purchase_id, actor=g.current_user.get("username"))
    if not deleted:
        return jsonify({"error": "Purchase not found"}), 404
    log_audit_event("delete", "pharmacy_purchases", str(purchase_id), {"purchase_id": purchase_id})
    return jsonify({"status": "ok"})



@pharmacy_bp.get("/api/pharmacy/summary")
@require_permissions("pharmacy.read")
def pharmacy_summary():
    return jsonify(get_pharmacy_summary(hospital_id=current_hospital_id()))


