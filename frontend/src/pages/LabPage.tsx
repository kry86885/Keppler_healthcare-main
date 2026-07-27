import { useEffect, useMemo, useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import PatientAutocomplete from "../components/PatientAutocomplete";
import StatCard from "../components/StatCard";
import { Button, Input, Select, Table, TableCell, TableHead, TableRow } from "../components/ui";
import { apiFetch, reportError } from "../lib/api";
import { formatDateTime } from "../lib/format";
import type { Appointment, Notice, Patient } from "../types";

type Props = {
  setNotice: Dispatch<SetStateAction<Notice | null>>;
};

type LabSummary = {
  total_amount: number;
  total_paid: number;
  total_due: number;
};

type Diagnostic = {
  id: number;
  invoice_no?: string;
  patient_id?: string;
  vendor_id?: number;
  doctor_name?: string;
  test_name?: string;
  amount?: number;
  paid_amount?: number;
  due_amount?: number;
  status?: string;
  sample_barcode?: string;
  order_status?: string;
  collected_at?: string;
  reported_at?: string;
  created_at?: string;
};

type Vendor = {
  id: number;
  vendor_name: string;
  contact_person?: string;
  phone?: string;
  status?: string;
};

const EMPTY_SUMMARY: LabSummary = { total_amount: 0, total_paid: 0, total_due: 0 };

type VendorForm = {
  id: string;
  vendor_name: string;
  contact_person: string;
  phone: string;
  status: "active" | "inactive";
};

type DiagnosticForm = {
  id: string;
  patient_id: string;
  doctor_name: string;
  vendor_id: string;
  test_name: string;
  amount: string;
  paid_amount: string;
  invoice_no: string;
  sample_barcode: string;
  order_status: string;
  collected_at: string;
  reported_at: string;
};

type LabFilters = {
  patient_id: string;
  doctor_name: string;
  vendor_status: string;
};

const DEFAULT_VENDOR_FORM: VendorForm = {
  id: "",
  vendor_name: "",
  contact_person: "",
  phone: "",
  status: "active",
};

const DEFAULT_DIAGNOSTIC_FORM: DiagnosticForm = {
  id: "",
  patient_id: "",
  doctor_name: "",
  vendor_id: "",
  test_name: "",
  amount: "0",
  paid_amount: "0",
  invoice_no: "",
  sample_barcode: "",
  order_status: "ordered",
  collected_at: "",
  reported_at: "",
};

const DEFAULT_LAB_FILTERS: LabFilters = {
  patient_id: "",
  doctor_name: "",
  vendor_status: "",
};

function formatCurrency(amount?: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount || 0);
}

export default function LabPage({ setNotice }: Props) {
  const [summary, setSummary] = useState<LabSummary>(EMPTY_SUMMARY);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [vendorForm, setVendorForm] = useState<VendorForm>(DEFAULT_VENDOR_FORM);
  const [diagnosticForm, setDiagnosticForm] = useState<DiagnosticForm>(DEFAULT_DIAGNOSTIC_FORM);
  const [filters, setFilters] = useState<LabFilters>(DEFAULT_LAB_FILTERS);
  const [savingVendor, setSavingVendor] = useState(false);
  const [savingDiagnostic, setSavingDiagnostic] = useState(false);
  const [selectedLabPatient, setSelectedLabPatient] = useState<Patient | null>(null);

  const buildDiagnosticPath = (nextFilters: LabFilters) => {
    const params = new URLSearchParams();
    if (nextFilters.patient_id.trim()) params.set("patient_id", nextFilters.patient_id.trim());
    if (nextFilters.doctor_name.trim()) params.set("doctor_name", nextFilters.doctor_name.trim());
    const query = params.toString();
    return query ? `/api/lab/diagnostics?${query}` : "/api/lab/diagnostics";
  };

  const loadLab = async (nextFilters: LabFilters = filters) => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const [summaryData, diagnosticsData, vendorsData] = await Promise.all([
        apiFetch<LabSummary>("/api/lab/summary"),
        apiFetch<{ diagnostics?: Diagnostic[] }>(buildDiagnosticPath(nextFilters)),
        apiFetch<{ vendors?: Vendor[] }>("/api/lab/vendors"),
      ]);
      const fetchedVendors = vendorsData.vendors || [];
      setSummary({ ...EMPTY_SUMMARY, ...summaryData });
      setDiagnostics(diagnosticsData.diagnostics || []);
      setVendors(fetchedVendors);
      setDiagnosticForm((current) => {
        if (current.vendor_id) return current;
        return { ...current, vendor_id: fetchedVendors[0] ? String(fetchedVendors[0].id) : "" };
      });
    } catch (error) {
      const typedError = error as { message?: string; status?: number };
      setErrorMessage(typedError.message || "Unable to load lab diagnostics data.");
      reportError(setNotice, typedError, "Unable to load lab diagnostics data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadLab();
  }, []);

  const visibleVendors = useMemo(() => {
    if (!filters.vendor_status) return vendors;
    return vendors.filter((vendor) => (vendor.status || "active") === filters.vendor_status);
  }, [vendors, filters.vendor_status]);

  const visibleDiagnostics = useMemo(() => diagnostics, [diagnostics]);
  const vendorNameById = useMemo(
    () => Object.fromEntries(vendors.map((vendor) => [String(vendor.id), vendor.vendor_name])),
    [vendors]
  );
  const doctorIncome = useMemo(() => {
    const totals = new Map<string, number>();
    diagnostics.forEach((record) => {
      const key = (record.doctor_name || "Unassigned").trim() || "Unassigned";
      totals.set(key, (totals.get(key) || 0) + Number(record.amount || 0));
    });
    return Array.from(totals.entries())
      .map(([label, total]) => ({ label, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
  }, [diagnostics]);
  const invoiceBreakdown = useMemo(() => {
    const totals = new Map<string, number>();
    diagnostics.forEach((record) => {
      const key = (record.invoice_no || "Unlinked").trim() || "Unlinked";
      totals.set(key, (totals.get(key) || 0) + Number(record.amount || 0));
    });
    return Array.from(totals.entries())
      .map(([label, total]) => ({ label, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
  }, [diagnostics]);

  const handleFilterSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await loadLab(filters);
  };

  const clearFilters = async () => {
    setFilters({ ...DEFAULT_LAB_FILTERS });
    await loadLab({ ...DEFAULT_LAB_FILTERS });
  };

  const handlePatientAutocompleteSelect = async (patient: Patient) => {
    setDiagnosticForm((current) => ({ ...current, patient_id: patient.patient_id }));
    setSelectedLabPatient(patient);
    try {
      const data = await apiFetch<{ appointments?: Appointment[] }>(
        `/api/appointments?patient_id=${encodeURIComponent(patient.patient_id)}`
      );
      const mostRecent = (data.appointments || []).slice(-1)[0];
      if (mostRecent?.doctor_name) {
        setDiagnosticForm((current) => ({ ...current, doctor_name: mostRecent.doctor_name || current.doctor_name }));
      }
    } catch {
      // doctor field stays editable if the lookup fails
    }
  };

  const handleVendorSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const vendorName = vendorForm.vendor_name.trim();
    if (!vendorName) {
      setNotice({ type: "error", message: "Vendor name is required." });
      return;
    }

    setSavingVendor(true);
    try {
      const vendorId = Number(vendorForm.id);
      const path = vendorId ? `/api/lab/vendors/${vendorId}` : "/api/lab/vendors";
      await apiFetch(path, {
        method: vendorId ? "PUT" : "POST",
        body: JSON.stringify({
          vendor_name: vendorName,
          contact_person: vendorForm.contact_person.trim() || undefined,
          phone: vendorForm.phone.trim() || undefined,
          status: vendorForm.status,
        }),
      });
      setVendorForm({ ...DEFAULT_VENDOR_FORM });
      setNotice({ type: "success", message: vendorId ? `Vendor ${vendorName} updated.` : `Vendor ${vendorName} added.` });
      await loadLab(filters);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to create lab vendor.");
    } finally {
      setSavingVendor(false);
    }
  };

  const handleDiagnosticSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = Number(diagnosticForm.amount) || 0;
    if (!diagnosticForm.test_name.trim()) {
      setNotice({ type: "error", message: "Test name is required." });
      return;
    }
    if (amount <= 0) {
      setNotice({ type: "error", message: "Diagnostic amount must be greater than zero." });
      return;
    }

    setSavingDiagnostic(true);
    try {
      const diagnosticId = Number(diagnosticForm.id);
      const path = diagnosticId ? `/api/lab/diagnostics/${diagnosticId}` : "/api/lab/diagnostics";
      await apiFetch(path, {
        method: diagnosticId ? "PUT" : "POST",
        body: JSON.stringify({
          invoice_no: diagnosticForm.invoice_no.trim() || undefined,
          patient_id: diagnosticForm.patient_id.trim() || undefined,
          vendor_id: diagnosticForm.vendor_id ? Number(diagnosticForm.vendor_id) : undefined,
          doctor_name: diagnosticForm.doctor_name.trim() || undefined,
          test_name: diagnosticForm.test_name.trim(),
          amount,
          paid_amount: Number(diagnosticForm.paid_amount) || 0,
          sample_barcode: diagnosticForm.sample_barcode.trim() || undefined,
          order_status: diagnosticForm.order_status,
          collected_at: diagnosticForm.collected_at || undefined,
          reported_at: diagnosticForm.reported_at || undefined,
        }),
      });
      setDiagnosticForm((current) => ({ ...DEFAULT_DIAGNOSTIC_FORM, vendor_id: current.vendor_id }));
      setNotice({ type: "success", message: diagnosticId ? "Diagnostic record updated." : "Diagnostic record created." });
      await loadLab(filters);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to create diagnostic entry.");
    } finally {
      setSavingDiagnostic(false);
    }
  };

  const handleEditVendor = (vendor: Vendor) => {
    setVendorForm({
      id: String(vendor.id),
      vendor_name: vendor.vendor_name,
      contact_person: vendor.contact_person || "",
      phone: vendor.phone || "",
      status: (vendor.status === "inactive" ? "inactive" : "active"),
    });
  };

  const handleDeleteVendor = async (vendor: Vendor) => {
    if (!window.confirm(`Delete vendor ${vendor.vendor_name}?`)) return;
    try {
      await apiFetch(`/api/lab/vendors/${vendor.id}`, { method: "DELETE" });
      setNotice({ type: "success", message: "Vendor deleted." });
      await loadLab(filters);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to delete vendor.");
    }
  };

  const handleEditDiagnostic = (record: Diagnostic) => {
    setDiagnosticForm({
      id: String(record.id),
      patient_id: record.patient_id || "",
      doctor_name: record.doctor_name || "",
      vendor_id: record.vendor_id ? String(record.vendor_id) : "",
      test_name: record.test_name || "",
      amount: String(record.amount || 0),
      paid_amount: String(record.paid_amount || 0),
      invoice_no: record.invoice_no || "",
      sample_barcode: record.sample_barcode || "",
      order_status: record.order_status || "ordered",
      collected_at: record.collected_at ? String(record.collected_at).slice(0, 16) : "",
      reported_at: record.reported_at ? String(record.reported_at).slice(0, 16) : "",
    });
  };

  const handleDeleteDiagnostic = async (record: Diagnostic) => {
    if (!window.confirm(`Delete diagnostic ${record.test_name || record.id}?`)) return;
    try {
      await apiFetch(`/api/lab/diagnostics/${record.id}`, { method: "DELETE" });
      setNotice({ type: "success", message: "Diagnostic record deleted." });
      await loadLab(filters);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to delete diagnostic record.");
    }
  };

  return (
    <section className="module-page">
      <div className="stat-grid module-stat-grid">
        <StatCard label="Lab Revenue" value={formatCurrency(summary.total_amount)} />
        <StatCard label="Paid" value={formatCurrency(summary.total_paid)} />
        <StatCard label="Due" value={formatCurrency(summary.total_due)} />
        <StatCard label="Active Vendors" value={vendors.filter((vendor) => (vendor.status || "active") === "active").length} />
      </div>

      <div className="panel">
        <div className="module-panel-head">
          <h3>Add Lab Vendor</h3>
        </div>
        <form className="module-form-grid" onSubmit={handleVendorSubmit}>
          <Input
            required
            value={vendorForm.vendor_name}
            onChange={(event) => setVendorForm((current) => ({ ...current, vendor_name: event.target.value }))}
            placeholder="Vendor name"
            aria-label="Lab vendor name"
          />
          <Input
            value={vendorForm.contact_person}
            onChange={(event) => setVendorForm((current) => ({ ...current, contact_person: event.target.value }))}
            placeholder="Contact person"
            aria-label="Lab vendor contact"
          />
          <Input
            value={vendorForm.phone}
            onChange={(event) => setVendorForm((current) => ({ ...current, phone: event.target.value }))}
            placeholder="Phone"
            aria-label="Lab vendor phone"
          />
          <Select
            value={vendorForm.status}
            onChange={(event) => setVendorForm((current) => ({ ...current, status: event.target.value as "active" | "inactive" }))}
            aria-label="Lab vendor status"
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
          <Button type="submit" disabled={savingVendor}>{savingVendor ? "Saving..." : "Add Vendor"}</Button>
          {vendorForm.id ? (
            <Button type="button" variant="ghost" onClick={() => setVendorForm({ ...DEFAULT_VENDOR_FORM })}>Cancel Edit</Button>
          ) : null}
        </form>
        {vendors.length > 0 ? (
          <div className="module-mobile-list" style={{ display: "grid" }} aria-label="Lab vendor cards">
            {vendors.slice(0, 8).map((vendor) => (
              <article className="module-mobile-card" key={`vendor-card-${vendor.id}`}>
                <h4>{vendor.vendor_name}</h4>
                <p><strong>Contact:</strong> {vendor.contact_person || "-"}</p>
                <p><strong>Phone:</strong> {vendor.phone || "-"}</p>
                <p><strong>Status:</strong> {vendor.status || "active"}</p>
                <div className="module-card-actions">
                  <Button type="button" size="sm" onClick={() => handleEditVendor(vendor)}>Edit</Button>
                  <Button type="button" size="sm" variant="destructive" onClick={() => void handleDeleteVendor(vendor)}>Delete</Button>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </div>

      <div className="panel">
        <div className="module-panel-head">
          <h3>Create Diagnostic Entry</h3>
        </div>
        <form className="module-form-grid module-sales-grid" onSubmit={handleDiagnosticSubmit}>
          <div>
            <PatientAutocomplete
              value={diagnosticForm.patient_id}
              onChange={(patientId) => {
                setDiagnosticForm((current) => ({ ...current, patient_id: patientId }));
                if (selectedLabPatient && patientId !== selectedLabPatient.patient_id) {
                  setSelectedLabPatient(null);
                }
              }}
              onSelect={(patient) => void handlePatientAutocompleteSelect(patient)}
              placeholder="Patient ID or name"
              ariaLabel="Lab diagnostic patient id"
            />
            {selectedLabPatient ? (
              <p className="muted">
                Confirmed: {selectedLabPatient.name} {selectedLabPatient.last_name || ""} · Age {selectedLabPatient.age ?? "-"} ·{" "}
                {selectedLabPatient.gender || "-"}
              </p>
            ) : null}
          </div>
          <Input
            value={diagnosticForm.doctor_name}
            onChange={(event) => setDiagnosticForm((current) => ({ ...current, doctor_name: event.target.value }))}
            placeholder="Doctor name"
            aria-label="Lab diagnostic doctor"
          />
          <Select
            value={diagnosticForm.vendor_id}
            onChange={(event) => setDiagnosticForm((current) => ({ ...current, vendor_id: event.target.value }))}
            aria-label="Lab diagnostic vendor"
          >
            <option value="">Select vendor</option>
            {vendors.map((vendor) => (
              <option key={`diag-vendor-${vendor.id}`} value={vendor.id}>
                {vendor.vendor_name}
              </option>
            ))}
          </Select>
          <Input
            required
            value={diagnosticForm.test_name}
            onChange={(event) => setDiagnosticForm((current) => ({ ...current, test_name: event.target.value }))}
            placeholder="Test name"
            aria-label="Lab diagnostic test"
          />
          <Input
            type="number"
            min={0}
            value={diagnosticForm.amount}
            onChange={(event) => setDiagnosticForm((current) => ({ ...current, amount: event.target.value }))}
            placeholder="Amount"
            aria-label="Lab diagnostic amount"
          />
          <Input
            type="number"
            min={0}
            value={diagnosticForm.paid_amount}
            onChange={(event) => setDiagnosticForm((current) => ({ ...current, paid_amount: event.target.value }))}
            placeholder="Paid amount"
            aria-label="Lab diagnostic paid amount"
          />
          <Input
            value={diagnosticForm.invoice_no}
            onChange={(event) => setDiagnosticForm((current) => ({ ...current, invoice_no: event.target.value }))}
            placeholder="Invoice no"
            aria-label="Lab diagnostic invoice"
          />
          <Input
            value={diagnosticForm.sample_barcode}
            onChange={(event) => setDiagnosticForm((current) => ({ ...current, sample_barcode: event.target.value }))}
            placeholder="Sample barcode"
            aria-label="Lab sample barcode"
          />
          <Select
            value={diagnosticForm.order_status}
            onChange={(event) => setDiagnosticForm((current) => ({ ...current, order_status: event.target.value }))}
            aria-label="Lab order status"
          >
            <option value="ordered">Ordered</option>
            <option value="sample_collected">Sample Collected</option>
            <option value="processing">Processing</option>
            <option value="reported">Reported</option>
          </Select>
          <Input
            type="datetime-local"
            value={diagnosticForm.collected_at}
            onChange={(event) => setDiagnosticForm((current) => ({ ...current, collected_at: event.target.value }))}
            aria-label="Lab collected at"
          />
          <Input
            type="datetime-local"
            value={diagnosticForm.reported_at}
            onChange={(event) => setDiagnosticForm((current) => ({ ...current, reported_at: event.target.value }))}
            aria-label="Lab reported at"
          />
          <Button type="submit" disabled={savingDiagnostic}>{savingDiagnostic ? "Saving..." : "Create Diagnostic"}</Button>
          {diagnosticForm.id ? (
            <Button type="button" variant="ghost" onClick={() => setDiagnosticForm({ ...DEFAULT_DIAGNOSTIC_FORM })}>Cancel Edit</Button>
          ) : null}
        </form>
      </div>

      <div className="panel">
        <div className="module-panel-head">
          <h3>Recent Diagnostics</h3>
        </div>

        <form className="module-form-grid module-filter-grid" onSubmit={handleFilterSubmit}>
          <Input
            value={filters.patient_id}
            onChange={(event) => setFilters((current) => ({ ...current, patient_id: event.target.value }))}
            placeholder="Filter by patient ID"
            aria-label="Lab filter patient"
          />
          <Input
            value={filters.doctor_name}
            onChange={(event) => setFilters((current) => ({ ...current, doctor_name: event.target.value }))}
            placeholder="Filter by doctor"
            aria-label="Lab filter doctor"
          />
          <Select
            value={filters.vendor_status}
            onChange={(event) => setFilters((current) => ({ ...current, vendor_status: event.target.value }))}
            aria-label="Lab filter vendor status"
          >
            <option value="">All Vendors</option>
            <option value="active">Active Vendors</option>
            <option value="inactive">Inactive Vendors</option>
          </Select>
          <div className="module-inline-actions">
            <Button type="submit">Apply</Button>
            <Button type="button" variant="ghost" onClick={() => void clearFilters()}>Clear</Button>
          </div>
        </form>

        {visibleVendors.length > 0 ? <p className="muted">Matching vendors: {visibleVendors.length}</p> : null}

        {loading ? <p className="muted">Loading lab diagnostics...</p> : null}
        {errorMessage ? <p className="notice error">{errorMessage}</p> : null}
        {!loading && !errorMessage && visibleDiagnostics.length === 0 ? <p className="muted">No diagnostics available for this filter.</p> : null}

        {!loading && !errorMessage && visibleDiagnostics.length > 0 ? (
          <>
            <Table className="module-table module-table-lab" role="table" aria-label="Lab diagnostics table">
              <TableHead>
                <TableCell>Invoice</TableCell>
                <TableCell>Test</TableCell>
                <TableCell>Vendor</TableCell>
                <TableCell>Patient</TableCell>
                <TableCell>Doctor</TableCell>
                <TableCell>Sample</TableCell>
                <TableCell>Order Flow</TableCell>
                <TableCell>Amount</TableCell>
                <TableCell>Due</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Actions</TableCell>
              </TableHead>
              {visibleDiagnostics.slice(0, 12).map((record) => (
                <TableRow key={record.id}>
                  <TableCell>{record.invoice_no || "-"}</TableCell>
                  <TableCell>{record.test_name || "-"}</TableCell>
                  <TableCell>{record.vendor_id ? vendorNameById[String(record.vendor_id)] || `Vendor #${record.vendor_id}` : "-"}</TableCell>
                  <TableCell>{record.patient_id || "-"}</TableCell>
                  <TableCell>{record.doctor_name || "-"}</TableCell>
                  <TableCell>{record.sample_barcode || "-"}</TableCell>
                  <TableCell>{record.order_status || "ordered"}</TableCell>
                  <TableCell>{formatCurrency(record.amount)}</TableCell>
                  <TableCell>{formatCurrency(record.due_amount)}</TableCell>
                  <TableCell>{record.status || "-"}</TableCell>
                  <TableCell>
                    <div className="module-inline-actions">
                      <Button type="button" size="sm" onClick={() => handleEditDiagnostic(record)}>Edit</Button>
                      <Button type="button" size="sm" variant="destructive" onClick={() => void handleDeleteDiagnostic(record)}>Delete</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </Table>

            <div className="module-mobile-list" aria-label="Lab diagnostics cards">
              {visibleDiagnostics.slice(0, 12).map((record) => (
                <article className="module-mobile-card" key={`mobile-${record.id}`}>
                  <h4>{record.test_name || "Diagnostic Test"}</h4>
                  <p><strong>Invoice:</strong> {record.invoice_no || "-"}</p>
                  <p><strong>Vendor:</strong> {record.vendor_id ? vendorNameById[String(record.vendor_id)] || `Vendor #${record.vendor_id}` : "-"}</p>
                  <p><strong>Patient:</strong> {record.patient_id || "-"}</p>
                  <p><strong>Doctor:</strong> {record.doctor_name || "-"}</p>
                  <p><strong>Sample:</strong> {record.sample_barcode || "-"}</p>
                  <p><strong>Order:</strong> {record.order_status || "ordered"}</p>
                  <p><strong>Amount:</strong> {formatCurrency(record.amount)}</p>
                  <p><strong>Due:</strong> {formatCurrency(record.due_amount)}</p>
                  <p><strong>Status:</strong> {record.status || "-"}</p>
                  <div className="module-card-actions">
                    <Button type="button" size="sm" onClick={() => handleEditDiagnostic(record)}>Edit</Button>
                    <Button type="button" size="sm" variant="destructive" onClick={() => void handleDeleteDiagnostic(record)}>Delete</Button>
                  </div>
                  <p className="muted"><strong>Created:</strong> {formatDateTime(record.created_at)}</p>
                </article>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <div className="split">
        <div className="panel">
          <div className="module-panel-head">
            <h3>Doctor-wise Income</h3>
          </div>
          {doctorIncome.length === 0 ? (
            <p className="muted">No doctor-linked diagnostics yet.</p>
          ) : (
            <div className="bar-chart">
              {doctorIncome.map((row) => (
                <div className="bar-row" key={row.label}>
                  <span>{row.label}</span>
                  <div className="bar">
                    <div style={{ width: `${Math.max(8, (row.total / Math.max(...doctorIncome.map((entry) => entry.total), 1)) * 100)}%` }} />
                  </div>
                  <span>{formatCurrency(row.total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="panel">
          <div className="module-panel-head">
            <h3>Invoice-wise Diagnostics</h3>
          </div>
          {invoiceBreakdown.length === 0 ? (
            <p className="muted">No invoice-linked diagnostics yet.</p>
          ) : (
            <div className="bar-chart">
              {invoiceBreakdown.map((row) => (
                <div className="bar-row" key={row.label}>
                  <span>{row.label}</span>
                  <div className="bar">
                    <div style={{ width: `${Math.max(8, (row.total / Math.max(...invoiceBreakdown.map((entry) => entry.total), 1)) * 100)}%` }} />
                  </div>
                  <span>{formatCurrency(row.total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
