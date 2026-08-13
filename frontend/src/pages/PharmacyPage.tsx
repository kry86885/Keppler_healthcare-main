import { useEffect, useMemo, useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import PatientAutocomplete from "../components/PatientAutocomplete";
import {
  Alert,
  Button,
  ConfirmDialog,
  Input,
  Modal,
  Select,
  Table,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TabsTrigger,
} from "../components/ui";
import { apiFetch, reportError } from "../lib/api";
import { formatDate } from "../lib/format";
import type { Notice, Patient, PharmacySale } from "../types";
import { API_BASE } from "../lib/constants";

type Props = {
  setNotice: Dispatch<SetStateAction<Notice | null>>;
};

type PharmacyTab =
  "overview" | "inventory" | "prescriptions" | "sales" | "suppliers";

const PAGE_SIZE = 10;

// Items expiring within this many days surface in the overview alert banner
// alongside low/out-of-stock -- expiry_date was already tracked on every
// inventory row but never actually used for anything before this.
const EXPIRY_WARNING_DAYS = 30;

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

type PendingPrescription = {
  id: number;
  hospital_id: number;
  patient_id: string;
  patient_name: string;
  patient_last_name: string;
  doctor_username: string;
  medicines_json: string;
  status: string;
  created_at: string;
  doc_id?: number;
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
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

export default function PharmacyPage({ setNotice }: Props) {
  const [summary, setSummary] = useState<PharmacySummary>(EMPTY_SUMMARY);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [sales, setSales] = useState<PharmacySale[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [pendingPrescriptions, setPendingPrescriptions] = useState<
    PendingPrescription[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [inventoryForm, setInventoryForm] = useState<InventoryForm>(
    DEFAULT_INVENTORY_FORM,
  );
  const [saleForm, setSaleForm] = useState<SaleForm>(DEFAULT_SALE_FORM);
  const [supplierForm, setSupplierForm] = useState<SupplierForm>(
    DEFAULT_SUPPLIER_FORM,
  );
  const [purchaseForm, setPurchaseForm] = useState<PurchaseForm>(
    DEFAULT_PURCHASE_FORM,
  );
  const [filters, setFilters] = useState<PharmacyFilters>(
    DEFAULT_PHARMACY_FILTERS,
  );
  const [savingInventory, setSavingInventory] = useState(false);
  const [savingSale, setSavingSale] = useState(false);
  const [savingSupplier, setSavingSupplier] = useState(false);
  const [savingPurchase, setSavingPurchase] = useState(false);
  const [deletingItem, setDeletingItem] = useState<InventoryItem | null>(null);
  const [pendingPrescriptionsSearch, setPendingPrescriptionsSearch] =
    useState("");
  const [fulfillModal, setFulfillModal] = useState<PendingPrescription | null>(
    null,
  );
  const [fulfillMedicines, setFulfillMedicines] = useState<any[]>([]);

  // -- UI-only state added for the tabbed redesign; none of the data/handler
  // logic above this line changed. --
  const [activeTab, setActiveTab] = useState<PharmacyTab>("overview");
  const [showInventoryModal, setShowInventoryModal] = useState(false);
  const [showSaleModal, setShowSaleModal] = useState(false);
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [inventoryVisibleCount, setInventoryVisibleCount] = useState(PAGE_SIZE);
  const [salesVisibleCount, setSalesVisibleCount] = useState(PAGE_SIZE);

  const lowStockItems = useMemo(
    () =>
      items.filter(
        (item) =>
          Number(item.quantity || 0) > 0 &&
          Number(item.quantity || 0) <= Number(item.reorder_level || 0),
      ),
    [items],
  );
  const outOfStockItems = useMemo(
    () => items.filter((item) => Number(item.quantity || 0) <= 0),
    [items],
  );
  const expiringSoonItems = useMemo(() => {
    const cutoff = Date.now() + EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000;
    return items.filter((item) => {
      if (!item.expiry_date) return false;
      const expiryTime = new Date(item.expiry_date).getTime();
      return !Number.isNaN(expiryTime) && expiryTime <= cutoff;
    });
  }, [items]);
  const hasAlerts =
    lowStockItems.length > 0 ||
    outOfStockItems.length > 0 ||
    expiringSoonItems.length > 0;

  const visibleItems = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesSearch =
        !search ||
        item.medicine_name.toLowerCase().includes(search) ||
        (item.batch_no || "").toLowerCase().includes(search);
      const condition = (item.stock_condition || "proper").toLowerCase();
      const matchesCondition =
        !filters.condition || condition === filters.condition;
      const quantity = Number(item.quantity || 0);
      const reorderLevel = Number(item.reorder_level || 0);
      const matchesLowStock =
        !filters.low_stock_only || quantity <= reorderLevel;
      return matchesSearch && matchesCondition && matchesLowStock;
    });
  }, [items, filters]);

  const visibleSales = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    return sales.filter((sale) => {
      const matchesSearch =
        !search ||
        sale.medicine_name.toLowerCase().includes(search) ||
        String(sale.invoice_id || "")
          .toLowerCase()
          .includes(search);
      if (!matchesSearch) return false;
      if (!filters.low_stock_only) return true;
      const inventoryItem = items.find(
        (item) => item.medicine_name === sale.medicine_name,
      );
      const quantity = Number(inventoryItem?.quantity || 0);
      const reorderLevel = Number(inventoryItem?.reorder_level || 0);
      return quantity <= reorderLevel;
    });
  }, [sales, items, filters]);

  const visiblePendingPrescriptions = useMemo(() => {
    const search = pendingPrescriptionsSearch.trim().toLowerCase();
    if (!search) return pendingPrescriptions;
    return pendingPrescriptions.filter((p) => {
      return (
        p.patient_name.toLowerCase().includes(search) ||
        (p.patient_last_name || "").toLowerCase().includes(search) ||
        p.patient_id.toLowerCase().includes(search)
      );
    });
  }, [pendingPrescriptions, pendingPrescriptionsSearch]);

  const loadPharmacy = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const [
        summaryData,
        inventoryData,
        salesData,
        supplierData,
        purchaseData,
        prescData,
      ] = await Promise.all([
        apiFetch<PharmacySummary>("/api/pharmacy/summary"),
        apiFetch<{ items?: InventoryItem[] }>("/api/pharmacy/inventory"),
        apiFetch<{ sales?: PharmacySale[] }>("/api/pharmacy/sales"),
        apiFetch<{ suppliers?: Supplier[] }>("/api/pharmacy/suppliers"),
        apiFetch<{ purchases?: Purchase[] }>("/api/pharmacy/purchases"),
        apiFetch<{ prescriptions?: PendingPrescription[] }>(
          "/api/pharmacy/prescriptions",
        ).catch(() => ({ prescriptions: [] })),
      ]);
      const fetchedItems = inventoryData.items || [];
      const fetchedSales = salesData.sales || [];
      const fetchedSuppliers = supplierData.suppliers || [];
      const fetchedPurchases = purchaseData.purchases || [];
      const fetchedPresc = prescData.prescriptions || [];
      setSummary({ ...EMPTY_SUMMARY, ...summaryData });
      setItems(fetchedItems);
      setSales(fetchedSales);
      setSuppliers(fetchedSuppliers);
      setPurchases(fetchedPurchases);
      setPendingPrescriptions(fetchedPresc);
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
          supplier_id: fetchedSuppliers[0]
            ? String(fetchedSuppliers[0].id)
            : "",
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
      setShowInventoryModal(false);
      setNotice({
        type: "success",
        message: inventoryForm.id
          ? `${medicineName} updated in pharmacy inventory.`
          : `${medicineName} added to pharmacy inventory.`,
      });
      await loadPharmacy();
    } catch (error) {
      reportError(
        setNotice,
        error as { message?: string; status?: number },
        "Unable to save inventory item.",
      );
    } finally {
      setSavingInventory(false);
    }
  };

  const handleSaleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const medicineName = saleForm.medicine_name.trim();
    if (!medicineName) {
      setNotice({
        type: "error",
        message: "Select a medicine before recording a sale.",
      });
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
      setNotice({
        type: "error",
        message: "Quantity must be greater than zero.",
      });
      return;
    }

    setSavingSale(true);
    try {
      await apiFetch("/api/pharmacy/sales", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setSaleForm((current) => ({
        ...DEFAULT_SALE_FORM,
        medicine_name: current.medicine_name,
      }));
      setShowSaleModal(false);
      setNotice({
        type: "success",
        message: `Sale recorded for ${medicineName}.`,
      });
      await loadPharmacy();
    } catch (error) {
      reportError(
        setNotice,
        error as { message?: string; status?: number },
        "Unable to record pharmacy sale.",
      );
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

  const openAddSale = () => {
    setSaleForm((current) => ({
      ...DEFAULT_SALE_FORM,
      medicine_name: current.medicine_name,
      unit_price: current.unit_price,
    }));
    setShowSaleModal(true);
  };

  const handleFulfillPrescription = (presc: PendingPrescription) => {
    let meds = [];
    try {
      meds = JSON.parse(presc.medicines_json);
    } catch (e) {}

    // Auto-fill unit prices and current stock from inventory (case-insensitive,
    // matching how the backend now matches medicine names when it decrements
    // stock on dispense) so staff can see a shortage before billing, not after.
    const enrichedMeds = meds.map((m: any) => {
      const mName = m.name || m.medicine_name || m.medicine || "";
      const inv = items.find(
        (i) => i.medicine_name.toLowerCase() === mName.toLowerCase(),
      );
      return {
        ...m,
        name: mName,
        quantity: Number(m.quantity) || 1,
        unit_price: inv ? inv.unit_price : 0,
        available_stock: inv ? Number(inv.quantity || 0) : null,
      };
    });

    setFulfillMedicines(enrichedMeds);
    setFulfillModal(presc);
  };

  const submitFulfillPrescription = async () => {
    if (!fulfillModal) return;
    try {
      await apiFetch(`/api/pharmacy/prescriptions/${fulfillModal.id}/fulfill`, {
        method: "POST",
        body: JSON.stringify({ medicines: fulfillMedicines }),
      });
      setNotice({
        type: "success",
        message: "Prescription fulfilled and sales recorded.",
      });
      setFulfillModal(null);
      await loadPharmacy();
    } catch (error) {
      reportError(setNotice, error as any, "Failed to fulfill prescription");
    }
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
      const path = supplierId
        ? `/api/pharmacy/suppliers/${supplierId}`
        : "/api/pharmacy/suppliers";
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
      setShowSupplierModal(false);
      setNotice({
        type: "success",
        message: supplierId ? "Supplier updated." : "Supplier added.",
      });
      await loadPharmacy();
    } catch (error) {
      reportError(
        setNotice,
        error as { message?: string; status?: number },
        "Unable to save supplier.",
      );
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
      setNotice({
        type: "error",
        message: "Medicine, quantity, and unit cost are required.",
      });
      return;
    }
    setSavingPurchase(true);
    try {
      const purchaseId = Number(purchaseForm.id);
      const path = purchaseId
        ? `/api/pharmacy/purchases/${purchaseId}`
        : "/api/pharmacy/purchases";
      await apiFetch(path, {
        method: purchaseId ? "PUT" : "POST",
        body: JSON.stringify({
          supplier_id: purchaseForm.supplier_id
            ? Number(purchaseForm.supplier_id)
            : undefined,
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
      setShowPurchaseModal(false);
      setNotice({
        type: "success",
        message: purchaseId
          ? "Purchase order updated."
          : "Purchase order created.",
      });
      await loadPharmacy();
    } catch (error) {
      reportError(
        setNotice,
        error as { message?: string; status?: number },
        "Unable to save purchase order.",
      );
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
      stock_condition:
        item.stock_condition === "damaged" ? "damaged" : "proper",
    });
    setShowInventoryModal(true);
  };

  const openAddInventory = () => {
    setInventoryForm({ ...DEFAULT_INVENTORY_FORM });
    setShowInventoryModal(true);
  };

  const handleEditSupplier = (supplier: Supplier) => {
    setSupplierForm({
      id: String(supplier.id),
      supplier_name: supplier.supplier_name,
      contact_person: supplier.contact_person || "",
      phone: supplier.phone || "",
      status: supplier.status === "inactive" ? "inactive" : "active",
    });
    setShowSupplierModal(true);
  };

  const openAddSupplier = () => {
    setSupplierForm({ ...DEFAULT_SUPPLIER_FORM });
    setShowSupplierModal(true);
  };

  const handleDeleteSupplier = async (supplier: Supplier) => {
    if (!window.confirm(`Delete supplier ${supplier.supplier_name}?`)) return;
    try {
      await apiFetch(`/api/pharmacy/suppliers/${supplier.id}`, {
        method: "DELETE",
      });
      setNotice({ type: "success", message: "Supplier deleted." });
      await loadPharmacy();
    } catch (error) {
      reportError(
        setNotice,
        error as { message?: string; status?: number },
        "Unable to delete supplier.",
      );
    }
  };

  const handleEditPurchase = (purchase: Purchase) => {
    setPurchaseForm({
      id: String(purchase.id),
      supplier_id: purchase.supplier_id ? String(purchase.supplier_id) : "",
      medicine_name: purchase.medicine_name,
      quantity: String(purchase.quantity ?? 1),
      unit_cost: String(purchase.unit_cost ?? 0),
      status:
        purchase.status === "received"
          ? "received"
          : purchase.status === "cancelled"
            ? "cancelled"
            : "ordered",
      expected_date: purchase.expected_date || "",
      received_date: purchase.received_date || "",
    });
    setShowPurchaseModal(true);
  };

  const openAddPurchase = () => {
    setPurchaseForm((current) => ({
      ...DEFAULT_PURCHASE_FORM,
      supplier_id: current.supplier_id,
      medicine_name: current.medicine_name,
    }));
    setShowPurchaseModal(true);
  };

  const handleDeletePurchase = async (purchase: Purchase) => {
    if (!window.confirm(`Delete purchase order ${purchase.id}?`)) return;
    try {
      await apiFetch(`/api/pharmacy/purchases/${purchase.id}`, {
        method: "DELETE",
      });
      setNotice({ type: "success", message: "Purchase order deleted." });
      await loadPharmacy();
    } catch (error) {
      reportError(
        setNotice,
        error as { message?: string; status?: number },
        "Unable to delete purchase order.",
      );
    }
  };

  const confirmDeleteInventory = async () => {
    if (!deletingItem) return;
    try {
      await apiFetch(`/api/pharmacy/inventory/${deletingItem.id}`, {
        method: "DELETE",
      });
      setNotice({
        type: "success",
        message: `${deletingItem.medicine_name} removed from inventory.`,
      });
      setDeletingItem(null);
      if (inventoryForm.id && Number(inventoryForm.id) === deletingItem.id) {
        setInventoryForm({ ...DEFAULT_INVENTORY_FORM });
      }
      await loadPharmacy();
    } catch (error) {
      reportError(
        setNotice,
        error as { message?: string; status?: number },
        "Unable to delete inventory item.",
      );
      setDeletingItem(null);
    }
  };

  const alertItems = useMemo(() => {
    const combined = [
      ...outOfStockItems,
      ...lowStockItems,
      ...expiringSoonItems,
    ];
    return combined.filter(
      (item, index) =>
        combined.findIndex((other) => other.id === item.id) === index,
    );
  }, [outOfStockItems, lowStockItems, expiringSoonItems]);

  const visibleInventoryItems = visibleItems.slice(0, inventoryVisibleCount);
  const visibleSalesRows = visibleSales.slice(0, salesVisibleCount);

  const inventoryModal = (
    <Modal
      open={showInventoryModal}
      onClose={() => {
        setShowInventoryModal(false);
        setInventoryForm({ ...DEFAULT_INVENTORY_FORM });
      }}
      title={inventoryForm.id ? "Edit Medicine" : "Add Medicine to Inventory"}
    >
      <form className="module-form-grid" onSubmit={handleInventorySubmit}>
        <Input
          required
          value={inventoryForm.medicine_name}
          onChange={(event) =>
            setInventoryForm((current) => ({
              ...current,
              medicine_name: event.target.value,
            }))
          }
          placeholder="Medicine name"
          aria-label="Medicine name"
        />
        <Input
          value={inventoryForm.batch_no}
          onChange={(event) =>
            setInventoryForm((current) => ({
              ...current,
              batch_no: event.target.value,
            }))
          }
          placeholder="Batch number"
          aria-label="Batch number"
        />
        <Input
          type="number"
          min={0}
          value={inventoryForm.quantity}
          onChange={(event) =>
            setInventoryForm((current) => ({
              ...current,
              quantity: event.target.value,
            }))
          }
          placeholder="Quantity"
          aria-label="Quantity"
        />
        <Input
          type="number"
          min={0}
          value={inventoryForm.reorder_level}
          onChange={(event) =>
            setInventoryForm((current) => ({
              ...current,
              reorder_level: event.target.value,
            }))
          }
          placeholder="Reorder level"
          aria-label="Reorder level"
        />
        <Input
          type="number"
          min={0}
          value={inventoryForm.unit_price}
          onChange={(event) =>
            setInventoryForm((current) => ({
              ...current,
              unit_price: event.target.value,
            }))
          }
          placeholder="Unit price"
          aria-label="Unit price"
        />
        <Input
          type="date"
          value={inventoryForm.expiry_date}
          onChange={(event) =>
            setInventoryForm((current) => ({
              ...current,
              expiry_date: event.target.value,
            }))
          }
          aria-label="Expiry date"
        />
        <Select
          value={inventoryForm.stock_condition}
          onChange={(event) =>
            setInventoryForm((current) => ({
              ...current,
              stock_condition: event.target.value as "proper" | "damaged",
            }))
          }
          aria-label="Stock condition"
        >
          <option value="proper">Proper</option>
          <option value="damaged">Damaged</option>
        </Select>
        <div className="module-inline-actions">
          <Button type="submit" disabled={savingInventory}>
            {savingInventory
              ? "Saving..."
              : inventoryForm.id
                ? "Update Medicine"
                : "Add Medicine"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setShowInventoryModal(false);
              setInventoryForm({ ...DEFAULT_INVENTORY_FORM });
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );

  const saleModal = (
    <Modal
      open={showSaleModal}
      onClose={() => setShowSaleModal(false)}
      title="Record Pharmacy Sale"
    >
      <form
        className="module-form-grid module-sales-grid"
        onSubmit={handleSaleSubmit}
      >
        <Input
          value={saleForm.invoice_id}
          onChange={(event) =>
            setSaleForm((current) => ({
              ...current,
              invoice_id: event.target.value,
            }))
          }
          placeholder="Invoice ID (optional)"
          aria-label="Invoice ID"
        />
        <PatientAutocomplete
          value={saleForm.patient_id}
          onChange={(value) =>
            setSaleForm((current) => ({ ...current, patient_id: value }))
          }
          onSelect={handleSalePatientSelect}
          placeholder="Search patient by name, phone, or ID"
          ariaLabel="Sale patient id"
        />
        <Input
          value={saleForm.prescription_ref}
          onChange={(event) =>
            setSaleForm((current) => ({
              ...current,
              prescription_ref: event.target.value,
            }))
          }
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
          onChange={(event) =>
            setSaleForm((current) => ({
              ...current,
              quantity: event.target.value,
            }))
          }
          placeholder="Quantity"
          aria-label="Sale quantity"
        />
        <Input
          type="number"
          min={0}
          value={saleForm.unit_price}
          onChange={(event) =>
            setSaleForm((current) => ({
              ...current,
              unit_price: event.target.value,
            }))
          }
          placeholder="Unit price"
          aria-label="Sale unit price"
        />
        <div className="module-inline-actions">
          <Button type="submit" disabled={savingSale || items.length === 0}>
            {savingSale ? "Saving..." : "Record Sale"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setShowSaleModal(false)}
          >
            Cancel
          </Button>
        </div>
      </form>
      {items.length === 0 ? (
        <p className="muted">Add inventory first before recording a sale.</p>
      ) : null}
    </Modal>
  );

  const supplierModal = (
    <Modal
      open={showSupplierModal}
      onClose={() => {
        setShowSupplierModal(false);
        setSupplierForm({ ...DEFAULT_SUPPLIER_FORM });
      }}
      title={supplierForm.id ? "Edit Supplier" : "Add Supplier"}
    >
      <form className="module-form-grid" onSubmit={handleSupplierSubmit}>
        <Input
          required
          value={supplierForm.supplier_name}
          onChange={(event) =>
            setSupplierForm((current) => ({
              ...current,
              supplier_name: event.target.value,
            }))
          }
          placeholder="Supplier name"
          aria-label="Supplier name"
        />
        <Input
          value={supplierForm.contact_person}
          onChange={(event) =>
            setSupplierForm((current) => ({
              ...current,
              contact_person: event.target.value,
            }))
          }
          placeholder="Contact person"
          aria-label="Supplier contact person"
        />
        <Input
          value={supplierForm.phone}
          onChange={(event) =>
            setSupplierForm((current) => ({
              ...current,
              phone: event.target.value,
            }))
          }
          placeholder="Phone"
          aria-label="Supplier phone"
        />
        <Select
          value={supplierForm.status}
          onChange={(event) =>
            setSupplierForm((current) => ({
              ...current,
              status: event.target.value as "active" | "inactive",
            }))
          }
          aria-label="Supplier status"
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
        <div className="module-inline-actions">
          <Button type="submit" disabled={savingSupplier}>
            {savingSupplier
              ? "Saving..."
              : supplierForm.id
                ? "Update Supplier"
                : "Add Supplier"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setShowSupplierModal(false);
              setSupplierForm({ ...DEFAULT_SUPPLIER_FORM });
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );

  const purchaseModal = (
    <Modal
      open={showPurchaseModal}
      onClose={() => setShowPurchaseModal(false)}
      title={purchaseForm.id ? "Edit Purchase Order" : "Create Purchase Order"}
    >
      <form className="module-form-grid" onSubmit={handlePurchaseSubmit}>
        <Select
          value={purchaseForm.supplier_id}
          onChange={(event) =>
            setPurchaseForm((current) => ({
              ...current,
              supplier_id: event.target.value,
            }))
          }
          aria-label="Purchase supplier"
        >
          <option value="">Select supplier</option>
          {suppliers.map((supplier) => (
            <option
              key={`purchase-supplier-${supplier.id}`}
              value={supplier.id}
            >
              {supplier.supplier_name}
            </option>
          ))}
        </Select>
        <Input
          value={purchaseForm.medicine_name}
          onChange={(event) =>
            setPurchaseForm((current) => ({
              ...current,
              medicine_name: event.target.value,
            }))
          }
          placeholder="Medicine name"
          aria-label="Purchase medicine"
        />
        <Input
          type="number"
          min={1}
          value={purchaseForm.quantity}
          onChange={(event) =>
            setPurchaseForm((current) => ({
              ...current,
              quantity: event.target.value,
            }))
          }
          placeholder="Quantity"
          aria-label="Purchase quantity"
        />
        <Input
          type="number"
          min={0}
          value={purchaseForm.unit_cost}
          onChange={(event) =>
            setPurchaseForm((current) => ({
              ...current,
              unit_cost: event.target.value,
            }))
          }
          placeholder="Unit cost"
          aria-label="Purchase unit cost"
        />
        <Select
          value={purchaseForm.status}
          onChange={(event) =>
            setPurchaseForm((current) => ({
              ...current,
              status: event.target.value as
                "ordered" | "received" | "cancelled",
            }))
          }
          aria-label="Purchase status"
        >
          <option value="ordered">Ordered</option>
          <option value="received">Received</option>
          <option value="cancelled">Cancelled</option>
        </Select>
        <Input
          type="date"
          value={purchaseForm.expected_date}
          onChange={(event) =>
            setPurchaseForm((current) => ({
              ...current,
              expected_date: event.target.value,
            }))
          }
          aria-label="Expected delivery date"
        />
        <Input
          type="date"
          value={purchaseForm.received_date}
          onChange={(event) =>
            setPurchaseForm((current) => ({
              ...current,
              received_date: event.target.value,
            }))
          }
          aria-label="Received date"
        />
        <div className="module-inline-actions">
          <Button type="submit" disabled={savingPurchase}>
            {savingPurchase
              ? "Saving..."
              : purchaseForm.id
                ? "Update Order"
                : "Create Order"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setShowPurchaseModal(false)}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );

  const fulfillTotal = fulfillMedicines.reduce(
    (acc, m) => acc + m.quantity * (m.unit_price || 0),
    0,
  );
  const fulfillShortages = fulfillMedicines.filter(
    (m) => m.available_stock != null && m.quantity > m.available_stock,
  );
  const fulfillPrescriptionModal = (
    <Modal
      open={Boolean(fulfillModal)}
      onClose={() => setFulfillModal(null)}
      title="Fulfill Prescription & Bill"
      description={
        fulfillModal
          ? `${fulfillModal.patient_name} ${fulfillModal.patient_last_name || ""} · ID: ${fulfillModal.patient_id} · Dr. ${fulfillModal.doctor_username}`
          : undefined
      }
    >
      <div className="table-responsive">
        <Table>
          <TableHead>
            <TableCell>Medicine</TableCell>
            <TableCell>In Stock</TableCell>
            <TableCell>Qty to Dispense</TableCell>
            <TableCell>Unit Cost</TableCell>
            <TableCell>Total</TableCell>
          </TableHead>
          {fulfillMedicines.map((m, idx) => {
            const short = m.available_stock != null && m.quantity > m.available_stock;
            return (
              <TableRow key={idx}>
                <TableCell>
                  {m.name}
                  {m.dosage ? (
                    <div className="muted" style={{ fontSize: "0.75rem" }}>
                      {m.dosage}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell>
                  {m.available_stock == null ? (
                    <span className="pharmacy-badge pharmacy-badge-warning">
                      Not in inventory
                    </span>
                  ) : short ? (
                    <span className="pharmacy-badge pharmacy-badge-danger">
                      {m.available_stock} left
                    </span>
                  ) : (
                    <span className="pharmacy-badge pharmacy-badge-success">
                      {m.available_stock} left
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min={1}
                    style={{ width: "80px" }}
                    value={m.quantity}
                    aria-label={`Quantity to dispense for ${m.name}`}
                    onChange={(e) => {
                      const newMeds = [...fulfillMedicines];
                      newMeds[idx].quantity = Math.max(1, Number(e.target.value) || 1);
                      setFulfillMedicines(newMeds);
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    style={{ width: "90px" }}
                    value={m.unit_price === 0 ? "" : m.unit_price}
                    placeholder="0"
                    aria-label={`Unit cost for ${m.name}`}
                    onChange={(e) => {
                      const newMeds = [...fulfillMedicines];
                      newMeds[idx].unit_price = Number(e.target.value) || 0;
                      setFulfillMedicines(newMeds);
                    }}
                  />
                </TableCell>
                <TableCell style={{ fontWeight: 600 }}>
                  {formatCurrency(m.quantity * (m.unit_price || 0))}
                </TableCell>
              </TableRow>
            );
          })}
        </Table>
      </div>
      {fulfillShortages.length > 0 ? (
        <Alert variant="warning" style={{ marginTop: "0.75rem" }}>
          <strong>Insufficient stock:</strong>{" "}
          {fulfillShortages.map((m) => m.name).join(", ")} — dispensing anyway
          will take that item's stock below zero (clamped to 0). Adjust the
          quantity or restock before billing.
        </Alert>
      ) : null}
      <div className="module-panel-head" style={{ marginTop: "1rem" }}>
        <h3>Total Bill: {formatCurrency(fulfillTotal)}</h3>
        <div className="module-inline-actions">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setFulfillModal(null)}
          >
            Cancel
          </Button>
          <Button type="button" onClick={submitFulfillPrescription}>
            Generate Bill &amp; Fulfill
          </Button>
        </div>
      </div>
    </Modal>
  );

  return (
    <section className="pharmacy-premium-container">
      <div className="pharmacy-stats-grid">
        <div className="pharmacy-stat-card">
          <span className="pharmacy-stat-label">Low Stock</span>
          <span className="pharmacy-stat-value">{summary.low_stock_count}</span>
        </div>
        <div className="pharmacy-stat-card">
          <span className="pharmacy-stat-label">Out of Stock</span>
          <span className="pharmacy-stat-value">
            {summary.out_of_stock_count}
          </span>
        </div>
        <div className="pharmacy-stat-card">
          <span className="pharmacy-stat-label">Damaged Items</span>
          <span className="pharmacy-stat-value">
            {summary.damaged_stock_count}
          </span>
        </div>
        <div className="pharmacy-stat-card">
          <span className="pharmacy-stat-label">Sales Total</span>
          <span className="pharmacy-stat-value">
            {formatCurrency(summary.sales_total)}
          </span>
        </div>
      </div>

      {hasAlerts ? (
        <Alert variant="warning">
          <strong>Needs attention:</strong>{" "}
          {[
            outOfStockItems.length
              ? `${outOfStockItems.length} out of stock`
              : null,
            lowStockItems.length
              ? `${lowStockItems.length} low on stock`
              : null,
            expiringSoonItems.length
              ? `${expiringSoonItems.length} expiring within ${EXPIRY_WARNING_DAYS} days`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          {" — "}
          {alertItems
            .slice(0, 6)
            .map((item) => item.medicine_name)
            .join(", ")}
          {alertItems.length > 6 ? `, +${alertItems.length - 6} more` : ""}
          {pendingPrescriptions.length > 0
            ? ` · ${pendingPrescriptions.length} prescription${pendingPrescriptions.length === 1 ? "" : "s"} awaiting fulfillment`
            : ""}
        </Alert>
      ) : null}

      {loading ? <p className="muted">Loading pharmacy data...</p> : null}
      {errorMessage ? <Alert variant="error">{errorMessage}</Alert> : null}

      <Tabs role="tablist" aria-label="Pharmacy sections">
        <TabsTrigger
          type="button"
          active={activeTab === "overview"}
          onClick={() => setActiveTab("overview")}
        >
          Overview
        </TabsTrigger>
        <TabsTrigger
          type="button"
          active={activeTab === "inventory"}
          onClick={() => setActiveTab("inventory")}
        >
          Inventory
        </TabsTrigger>
        <TabsTrigger
          type="button"
          active={activeTab === "prescriptions"}
          onClick={() => setActiveTab("prescriptions")}
        >
          Prescriptions
          {pendingPrescriptions.length > 0
            ? ` (${pendingPrescriptions.length})`
            : ""}
        </TabsTrigger>
        <TabsTrigger
          type="button"
          active={activeTab === "sales"}
          onClick={() => setActiveTab("sales")}
        >
          Sales
        </TabsTrigger>
        <TabsTrigger
          type="button"
          active={activeTab === "suppliers"}
          onClick={() => setActiveTab("suppliers")}
        >
          Suppliers
        </TabsTrigger>
      </Tabs>

      {activeTab === "overview" && (
        <div className="pharmacy-section-glass">
          <div className="pharmacy-section-header">
            <h3>At a Glance</h3>
          </div>
          {!hasAlerts && pendingPrescriptions.length === 0 ? (
            <p className="muted">
              Everything looks good — no low stock, expiring items, or pending
              prescriptions right now.
            </p>
          ) : (
            <div
              className="module-mobile-list"
              aria-label="Pharmacy attention items"
            >
              {outOfStockItems.slice(0, 5).map((item) => (
                <article
                  className="module-mobile-card"
                  key={`alert-out-${item.id}`}
                >
                  <h4>{item.medicine_name}</h4>
                  <p>
                    <span className="pharmacy-badge pharmacy-badge-danger">
                      Out of stock
                    </span>
                  </p>
                </article>
              ))}
              {lowStockItems.slice(0, 5).map((item) => (
                <article
                  className="module-mobile-card"
                  key={`alert-low-${item.id}`}
                >
                  <h4>{item.medicine_name}</h4>
                  <p>
                    <span className="pharmacy-badge pharmacy-badge-warning">
                      Low stock: {item.quantity ?? 0} left
                    </span>
                  </p>
                </article>
              ))}
              {expiringSoonItems.slice(0, 5).map((item) => (
                <article
                  className="module-mobile-card"
                  key={`alert-expiring-${item.id}`}
                >
                  <h4>{item.medicine_name}</h4>
                  <p>
                    <span className="pharmacy-badge pharmacy-badge-warning">
                      Expires {formatDate(item.expiry_date)}
                    </span>
                  </p>
                </article>
              ))}
            </div>
          )}
          {pendingPrescriptions.length > 0 ? (
            <p style={{ marginTop: "1rem" }}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setActiveTab("prescriptions")}
              >
                Review {pendingPrescriptions.length} pending prescription
                {pendingPrescriptions.length === 1 ? "" : "s"}
              </Button>
            </p>
          ) : null}
        </div>
      )}

      {activeTab === "inventory" && (
        <div className="panel">
          <div className="module-panel-head">
            <h3>Inventory</h3>
            <Button type="button" onClick={openAddInventory}>
              + Add Medicine
            </Button>
          </div>

          <form
            className="module-form-grid module-filter-grid"
            onSubmit={(event) => event.preventDefault()}
          >
            <Input
              value={filters.search}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  search: event.target.value,
                }))
              }
              placeholder="Search medicine or batch"
              aria-label="Pharmacy filter search"
            />
            <Select
              value={filters.condition}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  condition: event.target.value,
                }))
              }
              aria-label="Pharmacy filter condition"
            >
              <option value="">All Conditions</option>
              <option value="proper">Proper</option>
              <option value="damaged">Damaged</option>
            </Select>
            <Select
              value={filters.low_stock_only ? "yes" : "no"}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  low_stock_only: event.target.value === "yes",
                }))
              }
              aria-label="Pharmacy filter low stock"
            >
              <option value="no">All Stock Levels</option>
              <option value="yes">Low Stock Only</option>
            </Select>
            <div className="module-inline-actions">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setFilters({ ...DEFAULT_PHARMACY_FILTERS })}
              >
                Reset
              </Button>
            </div>
          </form>

          {!loading && !errorMessage && visibleItems.length === 0 ? (
            <p className="muted">
              No inventory records available for this filter.
            </p>
          ) : null}

          {!loading && !errorMessage && visibleItems.length > 0 ? (
            <>
              <Table
                className="module-table module-table-pharmacy"
                role="table"
                aria-label="Pharmacy inventory table"
              >
                <TableHead>
                  <TableCell>Medicine</TableCell>
                  <TableCell>Batch</TableCell>
                  <TableCell>Quantity</TableCell>
                  <TableCell>Reorder</TableCell>
                  <TableCell>Price</TableCell>
                  <TableCell>Condition</TableCell>
                  <TableCell>Actions</TableCell>
                </TableHead>
                {visibleInventoryItems.map((item) => {
                  const quantity = Number(item.quantity || 0);
                  const reorderLevel = Number(item.reorder_level || 0);
                  const stockBadge =
                    quantity <= 0 ? (
                      <span className="pharmacy-badge pharmacy-badge-danger">
                        Out of stock
                      </span>
                    ) : quantity <= reorderLevel ? (
                      <span className="pharmacy-badge pharmacy-badge-warning">
                        Low
                      </span>
                    ) : (
                      <span className="pharmacy-badge pharmacy-badge-success">
                        In stock
                      </span>
                    );
                  return (
                    <TableRow key={item.id}>
                      <TableCell>{item.medicine_name}</TableCell>
                      <TableCell>{item.batch_no || "-"}</TableCell>
                      <TableCell>
                        {quantity} {stockBadge}
                      </TableCell>
                      <TableCell>{reorderLevel}</TableCell>
                      <TableCell>{formatCurrency(item.unit_price)}</TableCell>
                      <TableCell>{item.stock_condition || "proper"}</TableCell>
                      <TableCell>
                        <div className="module-inline-actions">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => handleEditInventory(item)}
                          >
                            Edit
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            onClick={() => setDeletingItem(item)}
                          >
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </Table>

              <div
                className="module-mobile-list"
                aria-label="Pharmacy inventory cards"
              >
                {visibleInventoryItems.map((item) => (
                  <article
                    className="module-mobile-card"
                    key={`mobile-${item.id}`}
                  >
                    <h4>{item.medicine_name}</h4>
                    <p>
                      <strong>Batch:</strong> {item.batch_no || "-"}
                    </p>
                    <p>
                      <strong>Quantity:</strong> {item.quantity ?? 0}
                    </p>
                    <p>
                      <strong>Reorder Level:</strong> {item.reorder_level ?? 0}
                    </p>
                    <p>
                      <strong>Unit Price:</strong>{" "}
                      {formatCurrency(item.unit_price)}
                    </p>
                    <p>
                      <strong>Condition:</strong>{" "}
                      {item.stock_condition || "proper"}
                    </p>
                    <div className="module-card-actions">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleEditInventory(item)}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => setDeletingItem(item)}
                      >
                        Delete
                      </Button>
                    </div>
                    <p className="muted">
                      <strong>Expiry:</strong> {formatDate(item.expiry_date)}
                    </p>
                  </article>
                ))}
              </div>

              {visibleItems.length > inventoryVisibleCount ? (
                <div
                  className="module-inline-actions"
                  style={{ marginTop: "1rem" }}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setInventoryVisibleCount((count) => count + PAGE_SIZE)
                    }
                  >
                    Show more ({visibleItems.length - inventoryVisibleCount}{" "}
                    remaining)
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      )}

      {activeTab === "prescriptions" && (
        <div className="pharmacy-section-glass">
          <div
            className="pharmacy-section-header"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "1rem",
            }}
          >
            <h3>Pending Prescriptions (OCR)</h3>
            <Input
              placeholder="Search by Patient Name or ID..."
              value={pendingPrescriptionsSearch}
              onChange={(e) => setPendingPrescriptionsSearch(e.target.value)}
              style={{ maxWidth: "300px" }}
            />
          </div>
          <div className="table-responsive">
            <Table className="pharmacy-table-modern">
              <TableHead>
                <TableCell>Date</TableCell>
                <TableCell>Patient</TableCell>
                <TableCell>Doctor</TableCell>
                <TableCell>Medicines</TableCell>
                <TableCell>Actions</TableCell>
              </TableHead>
              {visiblePendingPrescriptions.length === 0 ? (
                <TableRow>
                  <TableCell style={{ textAlign: "center", padding: "2rem" }}>
                    {pendingPrescriptions.length === 0
                      ? "No pending prescriptions"
                      : "No prescriptions match your search."}
                  </TableCell>
                </TableRow>
              ) : (
                visiblePendingPrescriptions.map((p) => {
                  let meds = [];
                  try {
                    meds = JSON.parse(p.medicines_json);
                  } catch (e) {}
                  return (
                    <TableRow key={p.id}>
                      <TableCell>{formatDate(p.created_at)}</TableCell>
                      <TableCell>
                        <div style={{ fontWeight: 600 }}>
                          {p.patient_name} {p.patient_last_name}
                        </div>
                        <div className="muted" style={{ fontSize: "0.85rem" }}>
                          ID: {p.patient_id}
                        </div>
                      </TableCell>
                      <TableCell>{p.doctor_username}</TableCell>
                      <TableCell>
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "4px",
                          }}
                        >
                          {meds.map((m: any, i: number) => (
                            <span key={i} className="pharmacy-medicine-pill">
                              {m.name}{" "}
                              <span style={{ opacity: 0.7 }}>
                                x{m.quantity}
                              </span>
                            </span>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "8px",
                          }}
                        >
                          <Button
                            onClick={() => handleFulfillPrescription(p)}
                            style={{ background: "var(--accent)" }}
                          >
                            Fulfill & Bill
                          </Button>
                          {p.doc_id && (
                            <Button
                              variant="secondary"
                              onClick={() =>
                                window.open(
                                  `${API_BASE}/api/documents/${p.doc_id}/file`,
                                  "_blank",
                                  "noopener,noreferrer",
                                )
                              }
                            >
                              View Original
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </Table>
          </div>
        </div>
      )}

      {activeTab === "sales" && (
        <div className="panel">
          <div className="module-panel-head">
            <h3>Sales Report</h3>
            <Button type="button" onClick={openAddSale}>
              + Record Sale
            </Button>
          </div>
          {!loading && !errorMessage && visibleSales.length === 0 ? (
            <p className="muted">No pharmacy sales recorded yet.</p>
          ) : null}
          {!loading && !errorMessage && visibleSales.length > 0 ? (
            <>
              <Table
                className="module-table"
                role="table"
                aria-label="Pharmacy sales report table"
              >
                <TableHead>
                  <TableCell>Sold At</TableCell>
                  <TableCell>Medicine</TableCell>
                  <TableCell>Patient</TableCell>
                  <TableCell>Rx Ref</TableCell>
                  <TableCell>Quantity</TableCell>
                  <TableCell>Amount</TableCell>
                </TableHead>
                {visibleSalesRows.map((sale) => (
                  <TableRow key={sale.id}>
                    <TableCell>{formatDate(sale.sold_at)}</TableCell>
                    <TableCell>{sale.medicine_name}</TableCell>
                    <TableCell>
                      {sale.patient_name
                        ? `${sale.patient_name} (${sale.patient_id})`
                        : sale.patient_id || "-"}
                    </TableCell>
                    <TableCell>{sale.prescription_ref || "-"}</TableCell>
                    <TableCell>{sale.quantity ?? 0}</TableCell>
                    <TableCell>{formatCurrency(sale.amount)}</TableCell>
                  </TableRow>
                ))}
              </Table>

              <div
                className="module-mobile-list"
                aria-label="Pharmacy sales report cards"
              >
                {visibleSalesRows.map((sale) => (
                  <article
                    className="module-mobile-card"
                    key={`sale-mobile-${sale.id}`}
                  >
                    <h4>{sale.medicine_name}</h4>
                    <p>
                      <strong>Patient:</strong>{" "}
                      {sale.patient_name
                        ? `${sale.patient_name} (${sale.patient_id})`
                        : sale.patient_id || "-"}
                    </p>
                    <p>
                      <strong>Prescription:</strong>{" "}
                      {sale.prescription_ref || "-"}
                    </p>
                    <p>
                      <strong>Quantity:</strong> {sale.quantity ?? 0}
                    </p>
                    <p>
                      <strong>Amount:</strong> {formatCurrency(sale.amount)}
                    </p>
                    <p className="muted">
                      <strong>Sold:</strong> {formatDate(sale.sold_at)}
                    </p>
                  </article>
                ))}
              </div>

              {visibleSales.length > salesVisibleCount ? (
                <div
                  className="module-inline-actions"
                  style={{ marginTop: "1rem" }}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setSalesVisibleCount((count) => count + PAGE_SIZE)
                    }
                  >
                    Show more ({visibleSales.length - salesVisibleCount}{" "}
                    remaining)
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      )}

      {activeTab === "suppliers" && (
        <div className="split">
          <div className="panel">
            <div className="module-panel-head">
              <h3>Suppliers</h3>
              <Button type="button" onClick={openAddSupplier}>
                + Add Supplier
              </Button>
            </div>
            {suppliers.length === 0 ? (
              <p className="muted">No suppliers added yet.</p>
            ) : null}
            {suppliers.slice(0, 6).map((supplier) => (
              <article
                className="module-mobile-card"
                key={`supplier-${supplier.id}`}
              >
                <h4>{supplier.supplier_name}</h4>
                <p>
                  <strong>Contact:</strong> {supplier.contact_person || "-"}
                </p>
                <p>
                  <strong>Phone:</strong> {supplier.phone || "-"}
                </p>
                <p>
                  <strong>Status:</strong> {supplier.status || "active"}
                </p>
                <div className="module-card-actions">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => handleEditSupplier(supplier)}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => void handleDeleteSupplier(supplier)}
                  >
                    Delete
                  </Button>
                </div>
              </article>
            ))}
          </div>

          <div className="panel">
            <div className="module-panel-head">
              <h3>Procurement</h3>
              <Button type="button" onClick={openAddPurchase}>
                + Create Order
              </Button>
            </div>
            {purchases.length === 0 ? (
              <p className="muted">No purchase orders yet.</p>
            ) : null}
            <div
              className="module-mobile-list"
              style={{ display: "grid" }}
              aria-label="Pharmacy purchase cards"
            >
              {purchases.slice(0, 6).map((purchase) => (
                <article
                  className="module-mobile-card"
                  key={`purchase-${purchase.id}`}
                >
                  <h4>{purchase.medicine_name}</h4>
                  <p>
                    <strong>Supplier:</strong>{" "}
                    {purchase.supplier_id
                      ? suppliers.find(
                          (item) => item.id === purchase.supplier_id,
                        )?.supplier_name || `#${purchase.supplier_id}`
                      : "-"}
                  </p>
                  <p>
                    <strong>Qty:</strong> {purchase.quantity ?? 0}
                  </p>
                  <p>
                    <strong>Status:</strong> {purchase.status || "ordered"}
                  </p>
                  <p>
                    <strong>Total:</strong>{" "}
                    {formatCurrency(purchase.total_cost)}
                  </p>
                  <div className="module-card-actions">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleEditPurchase(purchase)}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => void handleDeletePurchase(purchase)}
                    >
                      Delete
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deletingItem)}
        title="Delete inventory item"
        description={
          deletingItem
            ? `This will permanently remove ${deletingItem.medicine_name} from inventory.`
            : ""
        }
        confirmLabel="Delete"
        loading={false}
        onClose={() => setDeletingItem(null)}
        onConfirm={() => void confirmDeleteInventory()}
      />

      {inventoryModal}
      {saleModal}
      {supplierModal}
      {purchaseModal}
      {fulfillPrescriptionModal}
    </section>
  );
}
