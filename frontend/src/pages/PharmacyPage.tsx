import { useEffect, useMemo, useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import PatientAutocomplete from "../components/PatientAutocomplete";
import StatCard from "../components/StatCard";
import { Button, ConfirmDialog, Input, Select, Table, TableCell, TableHead, TableRow } from "../components/ui";
import { apiFetch, reportError } from "../lib/api";
import { formatDate } from "../lib/format";
import type { Notice, Patient, PharmacySale } from "../types";

type Props = {
  setNotice: Dispatch<SetStateAction<Notice | null>>;
};

type PharmacySummary = {
  low_stock_count: number;
  out_of_stock_count: number;
  damaged_stock_count: number;
  sales_total: number;
};

type InventoryItem = {
  id: number;
  medicine_name: string;
  batch_no?: string;
  quantity?: number;
  reorder_level?: number;
  unit_price?: number;
  expiry_date?: string;
  stock_condition?: string;
};

type InventoryForm = {
  id: string;
  medicine_name: string;
  batch_no: string;
  quantity: string;
  reorder_level: string;
  unit_price: string;
  expiry_date: string;
  stock_condition: "proper" | "damaged";
};

type SaleForm = {
  invoice_id: string;
  patient_id: string;
  prescription_ref: string;
  medicine_name: string;
  quantity: string;
  unit_price: string;
};

type Supplier = {
  id: number;
  supplier_name: string;
  contact_person?: string;
  phone?: string;
  status?: string;
};

type Purchase = {
  id: number;
  supplier_id?: number | null;
  medicine_name: string;
  quantity?: number;
  unit_cost?: number;
  total_cost?: number;
  status?: string;
  expected_date?: string | null;
  received_date?: string | null;
};

type SupplierForm = {
  id: string;
  supplier_name: string;
  contact_person: string;
  phone: string;
  status: "active" | "inactive";
};

type PurchaseForm = {
  id: string;
  supplier_id: string;
  medicine_name: string;
  quantity: string;
  unit_cost: string;
  status: "ordered" | "received" | "cancelled";
  expected_date: string;
  received_date: string;
};

type PharmacyFilters = {
  search: string;
  condition: string;
  low_stock_only: boolean;
};

const EMPTY_SUMMARY: PharmacySummary = {
  low_stock_count: 0,
  out_of_stock_count: 0,
  damaged_stock_count: 0,
  sales_total: 0,
};

const DEFAULT_INVENTORY_FORM: InventoryForm = {
  id: "",
  medicine_name: "",
  batch_no: "",
  quantity: "0",
  reorder_level: "10",
  unit_price: "0",
  expiry_date: "",
  stock_condition: "proper",
};

const DEFAULT_SALE_FORM: SaleForm = {
  invoice_id: "",
  patient_id: "",
  prescription_ref: "",
  medicine_name: "",
  quantity: "1",
  unit_price: "0",
};

const DEFAULT_SUPPLIER_FORM: SupplierForm = {
  id: "",
  supplier_name: "",
  contact_person: "",
  phone: "",
  status: "active",
};

const DEFAULT_PURCHASE_FORM: PurchaseForm = {
  id: "",
  supplier_id: "",
  medicine_name: "",
  quantity: "1",
  unit_cost: "0",
  status: "ordered",
  expected_date: "",
  received_date: "",
};

const DEFAULT_PHARMACY_FILTERS: PharmacyFilters = {
  search: "",
  condition: "",
  low_stock_only: false,
};

function formatCurrency(amount?: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount || 0);
}

export default function PharmacyPage({ setNotice }: Props) {
  const [summary, setSummary] = useState<PharmacySummary>(EMPTY_SUMMARY);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [sales, setSales] = useState<PharmacySale[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [inventoryForm, setInventoryForm] = useState<InventoryForm>(DEFAULT_INVENTORY_FORM);
  const [saleForm, setSaleForm] = useState<SaleForm>(DEFAULT_SALE_FORM);
  const [supplierForm, setSupplierForm] = useState<SupplierForm>(DEFAULT_SUPPLIER_FORM);
  const [purchaseForm, setPurchaseForm] = useState<PurchaseForm>(DEFAULT_PURCHASE_FORM);
  const [filters, setFilters] = useState<PharmacyFilters>(DEFAULT_PHARMACY_FILTERS);
  const [savingInventory, setSavingInventory] = useState(false);
  const [savingSale, setSavingSale] = useState(false);
  const [savingSupplier, setSavingSupplier] = useState(false);
  const [savingPurchase, setSavingPurchase] = useState(false);
  const [deletingItem, setDeletingItem] = useState<InventoryItem | null>(null);

  const visibleItems = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesSearch = !search || item.medicine_name.toLowerCase().includes(search) || (item.batch_no || "").toLowerCase().includes(search);
      const condition = (item.stock_condition || "proper").toLowerCase();
      const matchesCondition = !filters.condition || condition === filters.condition;
      const quantity = Number(item.quantity || 0);
      const reorderLevel = Number(item.reorder_level || 0);
      const matchesLowStock = !filters.low_stock_only || quantity <= reorderLevel;
      return matchesSearch && matchesCondition && matchesLowStock;
    });
  }, [items, filters]);

  const visibleSales = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    return sales.filter((sale) => {
      const matchesSearch =
        !search ||
        sale.medicine_name.toLowerCase().includes(search) ||
        String(sale.invoice_id || "").toLowerCase().includes(search);
      if (!matchesSearch) return false;
      if (!filters.low_stock_only) return true;
      const inventoryItem = items.find((item) => item.medicine_name === sale.medicine_name);
      const quantity = Number(inventoryItem?.quantity || 0);
      const reorderLevel = Number(inventoryItem?.reorder_level || 0);
      return quantity <= reorderLevel;
    });
  }, [sales, items, filters]);

  const loadPharmacy = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const [summaryData, inventoryData, salesData, supplierData, purchaseData] = await Promise.all([
        apiFetch<PharmacySummary>("/api/pharmacy/summary"),
        apiFetch<{ items?: InventoryItem[] }>("/api/pharmacy/inventory"),
        apiFetch<{ sales?: PharmacySale[] }>("/api/pharmacy/sales"),
        apiFetch<{ suppliers?: Supplier[] }>("/api/pharmacy/suppliers"),
        apiFetch<{ purchases?: Purchase[] }>("/api/pharmacy/purchases"),
      ]);
      const fetchedItems = inventoryData.items || [];
      const fetchedSales = salesData.sales || [];
      const fetchedSuppliers = supplierData.suppliers || [];
      const fetchedPurchases = purchaseData.purchases || [];
      setSummary({ ...EMPTY_SUMMARY, ...summaryData });
      setItems(fetchedItems);
      setSales(fetchedSales);
      setSuppliers(fetchedSuppliers);
      setPurchases(fetchedPurchases);
      setSaleForm((current) => {
        if (current.medicine_name) return current;
        return {
          ...current,
          medicine_name: fetchedItems[0]?.medicine_name || "",
          unit_price: String(fetchedItems[0]?.unit_price ?? 0),
        };
      });
      setPurchaseForm((current) => {
        if (current.supplier_id || current.medicine_name) return current;
        return {
          ...current,
          supplier_id: fetchedSuppliers[0] ? String(fetchedSuppliers[0].id) : "",
          medicine_name: fetchedItems[0]?.medicine_name || "",
          unit_cost: String(fetchedItems[0]?.unit_price ?? 0),
        };
      });
    } catch (error) {
      const typedError = error as { message?: string; status?: number };
      setErrorMessage(typedError.message || "Unable to load pharmacy data.");
      reportError(setNotice, typedError, "Unable to load pharmacy data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPharmacy();
  }, []);

  const handleInventorySubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const medicineName = inventoryForm.medicine_name.trim();
    if (!medicineName) {
      setNotice({ type: "error", message: "Medicine name is required." });
      return;
    }

    const payload = {
      id: inventoryForm.id ? Number(inventoryForm.id) : undefined,
      medicine_name: medicineName,
      batch_no: inventoryForm.batch_no.trim() || undefined,
      quantity: Number(inventoryForm.quantity) || 0,
      reorder_level: Number(inventoryForm.reorder_level) || 0,
      unit_price: Number(inventoryForm.unit_price) || 0,
      expiry_date: inventoryForm.expiry_date || undefined,
      stock_condition: inventoryForm.stock_condition,
    };

    setSavingInventory(true);
    try {
      await apiFetch("/api/pharmacy/inventory", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setInventoryForm({ ...DEFAULT_INVENTORY_FORM });
      setNotice({
        type: "success",
        message: inventoryForm.id ? `${medicineName} updated in pharmacy inventory.` : `${medicineName} added to pharmacy inventory.`,
      });
      await loadPharmacy();
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to save inventory item.");
    } finally {
      setSavingInventory(false);
    }
  };

  const handleSaleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const medicineName = saleForm.medicine_name.trim();
    if (!medicineName) {
      setNotice({ type: "error", message: "Select a medicine before recording a sale." });
      return;
    }

    const payload = {
      invoice_id: saleForm.invoice_id.trim() || undefined,
      patient_id: saleForm.patient_id.trim() || undefined,
      prescription_ref: saleForm.prescription_ref.trim() || undefined,
      medicine_name: medicineName,
      quantity: Number(saleForm.quantity) || 0,
      unit_price: Number(saleForm.unit_price) || 0,
    };

    if (payload.quantity <= 0) {
      setNotice({ type: "error", message: "Quantity must be greater than zero." });
      return;
    }

    setSavingSale(true);
    try {
      await apiFetch("/api/pharmacy/sales", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setSaleForm((current) => ({ ...DEFAULT_SALE_FORM, medicine_name: current.medicine_name }));
      setNotice({ type: "success", message: `Sale recorded for ${medicineName}.` });
      await loadPharmacy();
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to record pharmacy sale.");
    } finally {
      setSavingSale(false);
    }
  };

  const handleSaleMedicineChange = (medicineName: string) => {
    const selected = items.find((item) => item.medicine_name === medicineName);
    setSaleForm((current) => ({
      ...current,
      medicine_name: medicineName,
      unit_price: String(selected?.unit_price ?? current.unit_price),
    }));
  };

  const handleSalePatientSelect = (patient: Patient) => {
    setSaleForm((current) => ({ ...current, patient_id: patient.patient_id }));
  };

  const handleSupplierSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const supplierName = supplierForm.supplier_name.trim();
    if (!supplierName) {
      setNotice({ type: "error", message: "Supplier name is required." });
      return;
    }
    setSavingSupplier(true);
    try {
      const supplierId = Number(supplierForm.id);
      const path = supplierId ? `/api/pharmacy/suppliers/${supplierId}` : "/api/pharmacy/suppliers";
      await apiFetch(path, {
        method: supplierId ? "PUT" : "POST",
        body: JSON.stringify({
          supplier_name: supplierName,
          contact_person: supplierForm.contact_person.trim() || undefined,
          phone: supplierForm.phone.trim() || undefined,
          status: supplierForm.status,
        }),
      });
      setSupplierForm({ ...DEFAULT_SUPPLIER_FORM });
      setNotice({ type: "success", message: supplierId ? "Supplier updated." : "Supplier added." });
      await loadPharmacy();
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to save supplier.");
    } finally {
      setSavingSupplier(false);
    }
  };

  const handlePurchaseSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const medicineName = purchaseForm.medicine_name.trim();
    const quantity = Number(purchaseForm.quantity) || 0;
    const unitCost = Number(purchaseForm.unit_cost) || 0;
    if (!medicineName || quantity <= 0 || unitCost < 0) {
      setNotice({ type: "error", message: "Medicine, quantity, and unit cost are required." });
      return;
    }
    setSavingPurchase(true);
    try {
      const purchaseId = Number(purchaseForm.id);
      const path = purchaseId ? `/api/pharmacy/purchases/${purchaseId}` : "/api/pharmacy/purchases";
      await apiFetch(path, {
        method: purchaseId ? "PUT" : "POST",
        body: JSON.stringify({
          supplier_id: purchaseForm.supplier_id ? Number(purchaseForm.supplier_id) : undefined,
          medicine_name: medicineName,
          quantity,
          unit_cost: unitCost,
          status: purchaseForm.status,
          expected_date: purchaseForm.expected_date || undefined,
          received_date: purchaseForm.received_date || undefined,
        }),
      });
      setPurchaseForm((current) => ({
        ...DEFAULT_PURCHASE_FORM,
        supplier_id: current.supplier_id,
        medicine_name: current.medicine_name,
      }));
      setNotice({ type: "success", message: purchaseId ? "Purchase order updated." : "Purchase order created." });
      await loadPharmacy();
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to save purchase order.");
    } finally {
      setSavingPurchase(false);
    }
  };

  const handleEditInventory = (item: InventoryItem) => {
    setInventoryForm({
      id: String(item.id),
      medicine_name: item.medicine_name,
      batch_no: item.batch_no || "",
      quantity: String(item.quantity ?? 0),
      reorder_level: String(item.reorder_level ?? 10),
      unit_price: String(item.unit_price ?? 0),
      expiry_date: item.expiry_date || "",
      stock_condition: item.stock_condition === "damaged" ? "damaged" : "proper",
    });
  };

  const handleEditSupplier = (supplier: Supplier) => {
    setSupplierForm({
      id: String(supplier.id),
      supplier_name: supplier.supplier_name,
      contact_person: supplier.contact_person || "",
      phone: supplier.phone || "",
      status: supplier.status === "inactive" ? "inactive" : "active",
    });
  };

  const handleDeleteSupplier = async (supplier: Supplier) => {
    if (!window.confirm(`Delete supplier ${supplier.supplier_name}?`)) return;
    try {
      await apiFetch(`/api/pharmacy/suppliers/${supplier.id}`, { method: "DELETE" });
      setNotice({ type: "success", message: "Supplier deleted." });
      await loadPharmacy();
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to delete supplier.");
    }
  };

  const handleEditPurchase = (purchase: Purchase) => {
    setPurchaseForm({
      id: String(purchase.id),
      supplier_id: purchase.supplier_id ? String(purchase.supplier_id) : "",
      medicine_name: purchase.medicine_name,
      quantity: String(purchase.quantity ?? 1),
      unit_cost: String(purchase.unit_cost ?? 0),
      status: purchase.status === "received" ? "received" : purchase.status === "cancelled" ? "cancelled" : "ordered",
      expected_date: purchase.expected_date || "",
      received_date: purchase.received_date || "",
    });
  };

  const handleDeletePurchase = async (purchase: Purchase) => {
    if (!window.confirm(`Delete purchase order ${purchase.id}?`)) return;
    try {
      await apiFetch(`/api/pharmacy/purchases/${purchase.id}`, { method: "DELETE" });
      setNotice({ type: "success", message: "Purchase order deleted." });
      await loadPharmacy();
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to delete purchase order.");
    }
  };

  const confirmDeleteInventory = async () => {
    if (!deletingItem) return;
    try {
      await apiFetch(`/api/pharmacy/inventory/${deletingItem.id}`, { method: "DELETE" });
      setNotice({ type: "success", message: `${deletingItem.medicine_name} removed from inventory.` });
      setDeletingItem(null);
      if (inventoryForm.id && Number(inventoryForm.id) === deletingItem.id) {
        setInventoryForm({ ...DEFAULT_INVENTORY_FORM });
      }
      await loadPharmacy();
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to delete inventory item.");
      setDeletingItem(null);
    }
  };

  return (
    <section className="module-page">
      <div className="stat-grid module-stat-grid">
        <StatCard label="Low Stock" value={summary.low_stock_count} />
        <StatCard label="Out of Stock" value={summary.out_of_stock_count} />
        <StatCard label="Damaged Items" value={summary.damaged_stock_count} />
        <StatCard label="Sales Total" value={formatCurrency(summary.sales_total)} />
      </div>

      <div className="panel">
        <div className="module-panel-head">
          <h3>Add Medicine to Inventory</h3>
        </div>
        <form className="module-form-grid" onSubmit={handleInventorySubmit}>
          <Input
            required
            value={inventoryForm.medicine_name}
            onChange={(event) => setInventoryForm((current) => ({ ...current, medicine_name: event.target.value }))}
            placeholder="Medicine name"
            aria-label="Medicine name"
          />
          <Input
            value={inventoryForm.batch_no}
            onChange={(event) => setInventoryForm((current) => ({ ...current, batch_no: event.target.value }))}
            placeholder="Batch number"
            aria-label="Batch number"
          />
          <Input
            type="number"
            min={0}
            value={inventoryForm.quantity}
            onChange={(event) => setInventoryForm((current) => ({ ...current, quantity: event.target.value }))}
            placeholder="Quantity"
            aria-label="Quantity"
          />
          <Input
            type="number"
            min={0}
            value={inventoryForm.reorder_level}
            onChange={(event) => setInventoryForm((current) => ({ ...current, reorder_level: event.target.value }))}
            placeholder="Reorder level"
            aria-label="Reorder level"
          />
          <Input
            type="number"
            min={0}
            value={inventoryForm.unit_price}
            onChange={(event) => setInventoryForm((current) => ({ ...current, unit_price: event.target.value }))}
            placeholder="Unit price"
            aria-label="Unit price"
          />
          <Input
            type="date"
            value={inventoryForm.expiry_date}
            onChange={(event) => setInventoryForm((current) => ({ ...current, expiry_date: event.target.value }))}
            aria-label="Expiry date"
          />
          <Select
            value={inventoryForm.stock_condition}
            onChange={(event) =>
              setInventoryForm((current) => ({ ...current, stock_condition: event.target.value as "proper" | "damaged" }))
            }
            aria-label="Stock condition"
          >
            <option value="proper">Proper</option>
            <option value="damaged">Damaged</option>
          </Select>
          <Button type="submit" disabled={savingInventory}>
            {savingInventory ? "Saving..." : inventoryForm.id ? "Update Medicine" : "Add Medicine"}
          </Button>
          {inventoryForm.id ? (
            <Button type="button" variant="ghost" onClick={() => setInventoryForm({ ...DEFAULT_INVENTORY_FORM })}>
              Cancel Edit
            </Button>
          ) : null}
        </form>
      </div>

      <div className="panel">
        <div className="module-panel-head">
          <h3>Record Pharmacy Sale</h3>
        </div>
        <form className="module-form-grid module-sales-grid" onSubmit={handleSaleSubmit}>
          <Input
            value={saleForm.invoice_id}
            onChange={(event) => setSaleForm((current) => ({ ...current, invoice_id: event.target.value }))}
            placeholder="Invoice ID (optional)"
            aria-label="Invoice ID"
          />
          <PatientAutocomplete
            value={saleForm.patient_id}
            onChange={(value) => setSaleForm((current) => ({ ...current, patient_id: value }))}
            onSelect={handleSalePatientSelect}
            placeholder="Search patient by name, phone, or ID"
            ariaLabel="Sale patient id"
          />
          <Input
            value={saleForm.prescription_ref}
            onChange={(event) => setSaleForm((current) => ({ ...current, prescription_ref: event.target.value }))}
            placeholder="Prescription ref"
            aria-label="Prescription reference"
          />
          <Select
            value={saleForm.medicine_name}
            onChange={(event) => handleSaleMedicineChange(event.target.value)}
            aria-label="Medicine for sale"
          >
            <option value="">Select medicine</option>
            {items.map((item) => (
              <option key={`sale-${item.id}`} value={item.medicine_name}>
                {item.medicine_name}
              </option>
            ))}
          </Select>
          <Input
            type="number"
            min={1}
            value={saleForm.quantity}
            onChange={(event) => setSaleForm((current) => ({ ...current, quantity: event.target.value }))}
            placeholder="Quantity"
            aria-label="Sale quantity"
          />
          <Input
            type="number"
            min={0}
            value={saleForm.unit_price}
            onChange={(event) => setSaleForm((current) => ({ ...current, unit_price: event.target.value }))}
            placeholder="Unit price"
            aria-label="Sale unit price"
          />
          <Button type="submit" disabled={savingSale || items.length === 0}>
            {savingSale ? "Saving..." : "Record Sale"}
          </Button>
        </form>
        {items.length === 0 ? <p className="muted">Add inventory first before recording a sale.</p> : null}
      </div>

      <div className="split">
        <div className="panel">
          <div className="module-panel-head">
            <h3>Suppliers</h3>
          </div>
          <form className="module-form-grid" onSubmit={handleSupplierSubmit}>
            <Input
              required
              value={supplierForm.supplier_name}
              onChange={(event) => setSupplierForm((current) => ({ ...current, supplier_name: event.target.value }))}
              placeholder="Supplier name"
              aria-label="Supplier name"
            />
            <Input
              value={supplierForm.contact_person}
              onChange={(event) => setSupplierForm((current) => ({ ...current, contact_person: event.target.value }))}
              placeholder="Contact person"
              aria-label="Supplier contact person"
            />
            <Input
              value={supplierForm.phone}
              onChange={(event) => setSupplierForm((current) => ({ ...current, phone: event.target.value }))}
              placeholder="Phone"
              aria-label="Supplier phone"
            />
            <Select
              value={supplierForm.status}
              onChange={(event) => setSupplierForm((current) => ({ ...current, status: event.target.value as "active" | "inactive" }))}
              aria-label="Supplier status"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
            <Button type="submit" disabled={savingSupplier}>
              {savingSupplier ? "Saving..." : supplierForm.id ? "Update Supplier" : "Add Supplier"}
            </Button>
          </form>
          {suppliers.slice(0, 6).map((supplier) => (
            <article className="module-mobile-card" key={`supplier-${supplier.id}`}>
              <h4>{supplier.supplier_name}</h4>
              <p><strong>Contact:</strong> {supplier.contact_person || "-"}</p>
              <p><strong>Phone:</strong> {supplier.phone || "-"}</p>
              <p><strong>Status:</strong> {supplier.status || "active"}</p>
              <div className="module-card-actions">
                <Button type="button" size="sm" onClick={() => handleEditSupplier(supplier)}>Edit</Button>
                <Button type="button" size="sm" variant="destructive" onClick={() => void handleDeleteSupplier(supplier)}>Delete</Button>
              </div>
            </article>
          ))}
        </div>

        <div className="panel">
          <div className="module-panel-head">
            <h3>Procurement</h3>
          </div>
          <form className="module-form-grid" onSubmit={handlePurchaseSubmit}>
            <Select
              value={purchaseForm.supplier_id}
              onChange={(event) => setPurchaseForm((current) => ({ ...current, supplier_id: event.target.value }))}
              aria-label="Purchase supplier"
            >
              <option value="">Select supplier</option>
              {suppliers.map((supplier) => (
                <option key={`purchase-supplier-${supplier.id}`} value={supplier.id}>
                  {supplier.supplier_name}
                </option>
              ))}
            </Select>
            <Input
              value={purchaseForm.medicine_name}
              onChange={(event) => setPurchaseForm((current) => ({ ...current, medicine_name: event.target.value }))}
              placeholder="Medicine name"
              aria-label="Purchase medicine"
            />
            <Input
              type="number"
              min={1}
              value={purchaseForm.quantity}
              onChange={(event) => setPurchaseForm((current) => ({ ...current, quantity: event.target.value }))}
              placeholder="Quantity"
              aria-label="Purchase quantity"
            />
            <Input
              type="number"
              min={0}
              value={purchaseForm.unit_cost}
              onChange={(event) => setPurchaseForm((current) => ({ ...current, unit_cost: event.target.value }))}
              placeholder="Unit cost"
              aria-label="Purchase unit cost"
            />
            <Select
              value={purchaseForm.status}
              onChange={(event) => setPurchaseForm((current) => ({ ...current, status: event.target.value as "ordered" | "received" | "cancelled" }))}
              aria-label="Purchase status"
            >
              <option value="ordered">Ordered</option>
              <option value="received">Received</option>
              <option value="cancelled">Cancelled</option>
            </Select>
            <Input
              type="date"
              value={purchaseForm.expected_date}
              onChange={(event) => setPurchaseForm((current) => ({ ...current, expected_date: event.target.value }))}
              aria-label="Expected delivery date"
            />
            <Input
              type="date"
              value={purchaseForm.received_date}
              onChange={(event) => setPurchaseForm((current) => ({ ...current, received_date: event.target.value }))}
              aria-label="Received date"
            />
            <Button type="submit" disabled={savingPurchase}>
              {savingPurchase ? "Saving..." : purchaseForm.id ? "Update Order" : "Create Order"}
            </Button>
          </form>
        </div>
      </div>

      <div className="panel">
        <div className="module-panel-head">
          <h3>Inventory Snapshot</h3>
        </div>

        <form className="module-form-grid module-filter-grid" onSubmit={(event) => event.preventDefault()}>
          <Input
            value={filters.search}
            onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
            placeholder="Search medicine or batch"
            aria-label="Pharmacy filter search"
          />
          <Select
            value={filters.condition}
            onChange={(event) => setFilters((current) => ({ ...current, condition: event.target.value }))}
            aria-label="Pharmacy filter condition"
          >
            <option value="">All Conditions</option>
            <option value="proper">Proper</option>
            <option value="damaged">Damaged</option>
          </Select>
          <Select
            value={filters.low_stock_only ? "yes" : "no"}
            onChange={(event) => setFilters((current) => ({ ...current, low_stock_only: event.target.value === "yes" }))}
            aria-label="Pharmacy filter low stock"
          >
            <option value="no">All Stock Levels</option>
            <option value="yes">Low Stock Only</option>
          </Select>
          <div className="module-inline-actions">
            <Button type="button" variant="ghost" onClick={() => setFilters({ ...DEFAULT_PHARMACY_FILTERS })}>Reset</Button>
          </div>
        </form>

        {loading ? <p className="muted">Loading pharmacy inventory...</p> : null}
        {errorMessage ? <p className="notice error">{errorMessage}</p> : null}
        {!loading && !errorMessage && visibleItems.length === 0 ? <p className="muted">No inventory records available for this filter.</p> : null}

        {!loading && !errorMessage && visibleItems.length > 0 ? (
          <>
            <Table className="module-table module-table-pharmacy" role="table" aria-label="Pharmacy inventory table">
              <TableHead>
                <TableCell>Medicine</TableCell>
                <TableCell>Batch</TableCell>
                <TableCell>Quantity</TableCell>
                <TableCell>Reorder</TableCell>
                <TableCell>Price</TableCell>
                <TableCell>Condition</TableCell>
                <TableCell>Actions</TableCell>
              </TableHead>
              {visibleItems.slice(0, 14).map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.medicine_name}</TableCell>
                  <TableCell>{item.batch_no || "-"}</TableCell>
                  <TableCell>{item.quantity ?? 0}</TableCell>
                  <TableCell>{item.reorder_level ?? 0}</TableCell>
                  <TableCell>{formatCurrency(item.unit_price)}</TableCell>
                  <TableCell>{item.stock_condition || "proper"}</TableCell>
                  <TableCell>
                    <div className="module-inline-actions">
                      <Button type="button" size="sm" onClick={() => handleEditInventory(item)}>Edit</Button>
                      <Button type="button" size="sm" variant="destructive" onClick={() => setDeletingItem(item)}>Delete</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </Table>

            <div className="module-mobile-list" aria-label="Pharmacy inventory cards">
              {visibleItems.slice(0, 14).map((item) => (
                <article className="module-mobile-card" key={`mobile-${item.id}`}>
                  <h4>{item.medicine_name}</h4>
                  <p><strong>Batch:</strong> {item.batch_no || "-"}</p>
                  <p><strong>Quantity:</strong> {item.quantity ?? 0}</p>
                  <p><strong>Reorder Level:</strong> {item.reorder_level ?? 0}</p>
                  <p><strong>Unit Price:</strong> {formatCurrency(item.unit_price)}</p>
                  <p><strong>Condition:</strong> {item.stock_condition || "proper"}</p>
                  <div className="module-card-actions">
                    <Button type="button" size="sm" onClick={() => handleEditInventory(item)}>Edit</Button>
                    <Button type="button" size="sm" variant="destructive" onClick={() => setDeletingItem(item)}>Delete</Button>
                  </div>
                  <p className="muted"><strong>Expiry:</strong> {formatDate(item.expiry_date)}</p>
                </article>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <div className="panel">
        <div className="module-panel-head">
          <h3>Sales Report</h3>
        </div>
        {purchases.length > 0 ? (
          <div className="module-mobile-list" style={{ display: "grid" }} aria-label="Pharmacy purchase cards">
            {purchases.slice(0, 6).map((purchase) => (
              <article className="module-mobile-card" key={`purchase-${purchase.id}`}>
                <h4>{purchase.medicine_name}</h4>
                <p><strong>Supplier:</strong> {purchase.supplier_id ? suppliers.find((item) => item.id === purchase.supplier_id)?.supplier_name || `#${purchase.supplier_id}` : "-"}</p>
                <p><strong>Qty:</strong> {purchase.quantity ?? 0}</p>
                <p><strong>Status:</strong> {purchase.status || "ordered"}</p>
                <p><strong>Total:</strong> {formatCurrency(purchase.total_cost)}</p>
                <div className="module-card-actions">
                  <Button type="button" size="sm" onClick={() => handleEditPurchase(purchase)}>Edit</Button>
                  <Button type="button" size="sm" variant="destructive" onClick={() => void handleDeletePurchase(purchase)}>Delete</Button>
                </div>
              </article>
            ))}
          </div>
        ) : null}
        {!loading && !errorMessage && visibleSales.length === 0 ? <p className="muted">No pharmacy sales recorded yet.</p> : null}
        {!loading && !errorMessage && visibleSales.length > 0 ? (
          <>
            <Table className="module-table" role="table" aria-label="Pharmacy sales report table">
              <TableHead>
                <TableCell>Sold At</TableCell>
                <TableCell>Medicine</TableCell>
                <TableCell>Patient</TableCell>
                <TableCell>Rx Ref</TableCell>
                <TableCell>Quantity</TableCell>
                <TableCell>Amount</TableCell>
              </TableHead>
              {visibleSales.slice(0, 14).map((sale) => (
                <TableRow key={sale.id}>
                  <TableCell>{formatDate(sale.sold_at)}</TableCell>
                  <TableCell>{sale.medicine_name}</TableCell>
                  <TableCell>{sale.patient_id || "-"}</TableCell>
                  <TableCell>{sale.prescription_ref || "-"}</TableCell>
                  <TableCell>{sale.quantity ?? 0}</TableCell>
                  <TableCell>{formatCurrency(sale.amount)}</TableCell>
                </TableRow>
              ))}
            </Table>

            <div className="module-mobile-list" aria-label="Pharmacy sales report cards">
              {visibleSales.slice(0, 14).map((sale) => (
                <article className="module-mobile-card" key={`sale-mobile-${sale.id}`}>
                  <h4>{sale.medicine_name}</h4>
                  <p><strong>Patient:</strong> {sale.patient_id || "-"}</p>
                  <p><strong>Prescription:</strong> {sale.prescription_ref || "-"}</p>
                  <p><strong>Quantity:</strong> {sale.quantity ?? 0}</p>
                  <p><strong>Amount:</strong> {formatCurrency(sale.amount)}</p>
                  <p className="muted"><strong>Sold:</strong> {formatDate(sale.sold_at)}</p>
                </article>
              ))}
            </div>
          </>
        ) : null}
      </div>
      <ConfirmDialog
        open={Boolean(deletingItem)}
        title="Delete inventory item"
        description={deletingItem ? `This will permanently remove ${deletingItem.medicine_name} from inventory.` : ""}
        confirmLabel="Delete"
        loading={false}
        onClose={() => setDeletingItem(null)}
        onConfirm={() => void confirmDeleteInventory()}
      />
    </section>
  );
}
