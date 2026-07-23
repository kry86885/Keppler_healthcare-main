import { useEffect, useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import StatCard from "../components/StatCard";
import { Button, Input, Label, Select, Table, TableCell, TableHead, TableRow } from "../components/ui";
import { apiFetch, reportError } from "../lib/api";
import { formatDate } from "../lib/format";
import type { Notice } from "../types";

export type AccountsView = "overview" | "ledger" | "vendor-payments" | "doctor-payouts";

type Props = {
  setNotice: Dispatch<SetStateAction<Notice | null>>;
  view?: AccountsView;
};

type AccountsSummary = {
  ledger_income: number;
  ledger_expense: number;
  net_position: number;
  vendor_paid_total: number;
  doctor_paid_total: number;
  doctor_due_total: number;
};

type LedgerEntry = {
  id: number;
  entry_date: string;
  entry_type: string;
  category: string;
  reference_no?: string | null;
  counterparty_name?: string | null;
  amount: number;
  notes?: string | null;
};

type VendorPayment = {
  id: number;
  vendor_name: string;
  invoice_ref?: string | null;
  amount: number;
  payment_date: string;
  payment_mode?: string | null;
  status?: string | null;
  notes?: string | null;
};

type DoctorPayout = {
  id: number;
  doctor_name: string;
  payout_month: string;
  amount: number;
  paid_amount: number;
  due_amount: number;
  status?: string | null;
  paid_date?: string | null;
  notes?: string | null;
};

type LedgerForm = {
  id: string;
  entry_date: string;
  entry_type: string;
  category: string;
  reference_no: string;
  counterparty_name: string;
  amount: string;
  notes: string;
};

type VendorForm = {
  id: string;
  vendor_name: string;
  invoice_ref: string;
  amount: string;
  payment_date: string;
  payment_mode: string;
  status: string;
  notes: string;
};

type DoctorForm = {
  id: string;
  doctor_name: string;
  payout_month: string;
  amount: string;
  paid_amount: string;
  paid_date: string;
  status: string;
  notes: string;
};

const EMPTY_SUMMARY: AccountsSummary = {
  ledger_income: 0,
  ledger_expense: 0,
  net_position: 0,
  vendor_paid_total: 0,
  doctor_paid_total: 0,
  doctor_due_total: 0,
};

const DEFAULT_LEDGER_FORM: LedgerForm = {
  id: "",
  entry_date: "",
  entry_type: "expense",
  category: "",
  reference_no: "",
  counterparty_name: "",
  amount: "0",
  notes: "",
};

const DEFAULT_VENDOR_FORM: VendorForm = {
  id: "",
  vendor_name: "",
  invoice_ref: "",
  amount: "0",
  payment_date: "",
  payment_mode: "bank",
  status: "paid",
  notes: "",
};

const DEFAULT_DOCTOR_FORM: DoctorForm = {
  id: "",
  doctor_name: "",
  payout_month: "",
  amount: "0",
  paid_amount: "0",
  paid_date: "",
  status: "pending",
  notes: "",
};

const ACCOUNTS_VIEW_CONFIG: Record<AccountsView, { title: string; subtitle: string }> = {
  overview: {
    title: "Accounts Overview",
    subtitle: "Track core account balances and latest financial records.",
  },
  ledger: {
    title: "General Ledger",
    subtitle: "Create and manage journal entries.",
  },
  "vendor-payments": {
    title: "Vendor Payments",
    subtitle: "Record and reconcile supplier settlements.",
  },
  "doctor-payouts": {
    title: "Doctor Payouts",
    subtitle: "Manage monthly payouts and due balances.",
  },
};

function formatCurrency(amount?: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount || 0);
}

export default function AccountsPage({ setNotice, view = "ledger" }: Props) {
  const [summary, setSummary] = useState<AccountsSummary>(EMPTY_SUMMARY);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [vendorPayments, setVendorPayments] = useState<VendorPayment[]>([]);
  const [doctorPayouts, setDoctorPayouts] = useState<DoctorPayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [ledgerForm, setLedgerForm] = useState<LedgerForm>(DEFAULT_LEDGER_FORM);
  const [vendorForm, setVendorForm] = useState<VendorForm>(DEFAULT_VENDOR_FORM);
  const [doctorForm, setDoctorForm] = useState<DoctorForm>(DEFAULT_DOCTOR_FORM);
  const [savingLedger, setSavingLedger] = useState(false);
  const [savingVendor, setSavingVendor] = useState(false);
  const [savingDoctor, setSavingDoctor] = useState(false);

  const needsLedger = view === "overview" || view === "ledger";
  const needsVendors = view === "overview" || view === "vendor-payments";
  const needsDoctors = view === "overview" || view === "doctor-payouts";

  const loadAccounts = async () => {
    setLoading(true);
    try {
      const summaryRequest = apiFetch<AccountsSummary>("/api/accounts/summary");
      const ledgerRequest = needsLedger
        ? apiFetch<{ entries?: LedgerEntry[] }>("/api/accounts/ledger")
        : Promise.resolve({ entries: [] as LedgerEntry[] });
      const vendorRequest = needsVendors
        ? apiFetch<{ payments?: VendorPayment[] }>("/api/accounts/vendors")
        : Promise.resolve({ payments: [] as VendorPayment[] });
      const doctorRequest = needsDoctors
        ? apiFetch<{ payouts?: DoctorPayout[] }>("/api/accounts/doctors")
        : Promise.resolve({ payouts: [] as DoctorPayout[] });

      const [summaryData, ledgerData, vendorData, doctorData] = await Promise.all([
        summaryRequest,
        ledgerRequest,
        vendorRequest,
        doctorRequest,
      ]);
      setSummary({ ...EMPTY_SUMMARY, ...summaryData });
      setLedgerEntries(ledgerData.entries || []);
      setVendorPayments(vendorData.payments || []);
      setDoctorPayouts(doctorData.payouts || []);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to load accounts data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAccounts();
  }, [view]);

  const handleLedgerSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ledgerForm.entry_date || !ledgerForm.category.trim() || (Number(ledgerForm.amount) || 0) <= 0) {
      setNotice({ type: "error", message: "Entry date, category, and amount are required." });
      return;
    }
    setSavingLedger(true);
    try {
      const entryId = Number(ledgerForm.id);
      const path = entryId ? `/api/accounts/ledger/${entryId}` : "/api/accounts/ledger";
      await apiFetch(path, {
        method: entryId ? "PUT" : "POST",
        body: JSON.stringify({
          entry_date: ledgerForm.entry_date,
          entry_type: ledgerForm.entry_type,
          category: ledgerForm.category.trim(),
          reference_no: ledgerForm.reference_no.trim() || undefined,
          counterparty_name: ledgerForm.counterparty_name.trim() || undefined,
          amount: Number(ledgerForm.amount) || 0,
          notes: ledgerForm.notes.trim() || undefined,
        }),
      });
      setLedgerForm({ ...DEFAULT_LEDGER_FORM });
      setNotice({ type: "success", message: entryId ? "Ledger entry updated." : "Ledger entry recorded." });
      await loadAccounts();
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to save ledger entry.");
    } finally {
      setSavingLedger(false);
    }
  };

  const handleVendorSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!vendorForm.vendor_name.trim() || !vendorForm.payment_date || (Number(vendorForm.amount) || 0) <= 0) {
      setNotice({ type: "error", message: "Vendor, payment date, and amount are required." });
      return;
    }
    setSavingVendor(true);
    try {
      const paymentId = Number(vendorForm.id);
      const path = paymentId ? `/api/accounts/vendors/${paymentId}` : "/api/accounts/vendors";
      await apiFetch(path, {
        method: paymentId ? "PUT" : "POST",
        body: JSON.stringify({
          vendor_name: vendorForm.vendor_name.trim(),
          invoice_ref: vendorForm.invoice_ref.trim() || undefined,
          amount: Number(vendorForm.amount) || 0,
          payment_date: vendorForm.payment_date,
          payment_mode: vendorForm.payment_mode,
          status: vendorForm.status,
          notes: vendorForm.notes.trim() || undefined,
        }),
      });
      setVendorForm({ ...DEFAULT_VENDOR_FORM });
      setNotice({ type: "success", message: paymentId ? "Vendor payment updated." : "Vendor payment recorded." });
      await loadAccounts();
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to save vendor payment.");
    } finally {
      setSavingVendor(false);
    }
  };

  const handleDoctorSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!doctorForm.doctor_name.trim() || !doctorForm.payout_month || (Number(doctorForm.amount) || 0) <= 0) {
      setNotice({ type: "error", message: "Doctor, payout month, and amount are required." });
      return;
    }
    setSavingDoctor(true);
    try {
      const payoutId = Number(doctorForm.id);
      const path = payoutId ? `/api/accounts/doctors/${payoutId}` : "/api/accounts/doctors";
      await apiFetch(path, {
        method: payoutId ? "PUT" : "POST",
        body: JSON.stringify({
          doctor_name: doctorForm.doctor_name.trim(),
          payout_month: doctorForm.payout_month,
          amount: Number(doctorForm.amount) || 0,
          paid_amount: Number(doctorForm.paid_amount) || 0,
          paid_date: doctorForm.paid_date || undefined,
          status: doctorForm.status,
          notes: doctorForm.notes.trim() || undefined,
        }),
      });
      setDoctorForm({ ...DEFAULT_DOCTOR_FORM });
      setNotice({ type: "success", message: payoutId ? "Doctor payout updated." : "Doctor payout recorded." });
      await loadAccounts();
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to save doctor payout.");
    } finally {
      setSavingDoctor(false);
    }
  };

  const deleteRecord = async (path: string, label: string) => {
    if (!window.confirm(`Delete ${label}?`)) return;
    try {
      await apiFetch(path, { method: "DELETE" });
      setNotice({ type: "success", message: `${label} deleted.` });
      await loadAccounts();
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, `Unable to delete ${label.toLowerCase()}.`);
    }
  };

  const renderOverview = () => (
    <div className="split">
      <div className="panel">
        <div className="module-panel-head">
          <h3>Recent Ledger Entries</h3>
        </div>
        {ledgerEntries.length === 0 ? (
          <p className="muted">No ledger entries yet.</p>
        ) : (
          <Table className="module-table module-table-accounts-ledger" aria-label="Accounts ledger table">
            <TableHead>
              <TableCell>Date</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Category</TableCell>
              <TableCell>Reference</TableCell>
              <TableCell>Amount</TableCell>
            </TableHead>
            {ledgerEntries.slice(0, 8).map((entry) => (
              <TableRow key={entry.id}>
                <TableCell>{formatDate(entry.entry_date)}</TableCell>
                <TableCell>{entry.entry_type}</TableCell>
                <TableCell>{entry.category}</TableCell>
                <TableCell>{entry.reference_no || "-"}</TableCell>
                <TableCell>{formatCurrency(entry.amount)}</TableCell>
              </TableRow>
            ))}
          </Table>
        )}
      </div>

      <div className="panel">
        <div className="module-panel-head">
          <h3>Recent Vendor Payments</h3>
        </div>
        {vendorPayments.length === 0 ? (
          <p className="muted">No vendor payments yet.</p>
        ) : (
          <Table className="module-table module-table-accounts-vendors" aria-label="Vendor payments table">
            <TableHead>
              <TableCell>Vendor</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>Amount</TableCell>
              <TableCell>Mode</TableCell>
              <TableCell>Status</TableCell>
            </TableHead>
            {vendorPayments.slice(0, 8).map((payment) => (
              <TableRow key={payment.id}>
                <TableCell>{payment.vendor_name}</TableCell>
                <TableCell>{formatDate(payment.payment_date)}</TableCell>
                <TableCell>{formatCurrency(payment.amount)}</TableCell>
                <TableCell>{payment.payment_mode || "bank"}</TableCell>
                <TableCell>{payment.status || "paid"}</TableCell>
              </TableRow>
            ))}
          </Table>
        )}
      </div>
    </div>
  );

  const renderLedger = () => (
    <div className="panel">
      <div className="module-panel-head">
        <h3>General Ledger</h3>
      </div>
      <form className="module-form-grid module-sales-grid" onSubmit={handleLedgerSubmit}>
        <Label>
          Entry Date
          <Input type="date" value={ledgerForm.entry_date} onChange={(event) => setLedgerForm((current) => ({ ...current, entry_date: event.target.value }))} aria-label="Ledger date" />
        </Label>
        <Label>
          Entry Type
          <Select value={ledgerForm.entry_type} onChange={(event) => setLedgerForm((current) => ({ ...current, entry_type: event.target.value }))} aria-label="Ledger type">
            <option value="income">Income</option>
            <option value="expense">Expense</option>
            <option value="adjustment">Adjustment</option>
          </Select>
        </Label>
        <Label>
          Category
          <Input value={ledgerForm.category} onChange={(event) => setLedgerForm((current) => ({ ...current, category: event.target.value }))} placeholder="Category" aria-label="Ledger category" />
        </Label>
        <Label>
          Reference
          <Input value={ledgerForm.reference_no} onChange={(event) => setLedgerForm((current) => ({ ...current, reference_no: event.target.value }))} placeholder="Reference" aria-label="Ledger reference" />
        </Label>
        <Label>
          Amount
          <Input type="number" min={0} value={ledgerForm.amount} onChange={(event) => setLedgerForm((current) => ({ ...current, amount: event.target.value }))} placeholder="Amount" aria-label="Ledger amount" />
        </Label>
        <Label>
          Counterparty
          <Input value={ledgerForm.counterparty_name} onChange={(event) => setLedgerForm((current) => ({ ...current, counterparty_name: event.target.value }))} placeholder="Counterparty" aria-label="Ledger counterparty" />
        </Label>
        <Label>
          Notes
          <Input value={ledgerForm.notes} onChange={(event) => setLedgerForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Notes" aria-label="Ledger notes" />
        </Label>
        <Button type="submit" variant="primary" disabled={savingLedger}>
          {savingLedger ? "Saving..." : ledgerForm.id ? "Update Entry" : "Add Entry"}
        </Button>
      </form>

      {ledgerEntries.length === 0 ? (
        <p className="muted">No ledger entries yet.</p>
      ) : (
        <Table className="module-table module-table-accounts-ledger" aria-label="Accounts ledger table">
          <TableHead>
            <TableCell>Date</TableCell>
            <TableCell>Type</TableCell>
            <TableCell>Category</TableCell>
            <TableCell>Reference</TableCell>
            <TableCell>Amount</TableCell>
            <TableCell>Actions</TableCell>
          </TableHead>
          {ledgerEntries.slice(0, 12).map((entry) => (
            <TableRow key={entry.id}>
              <TableCell>{formatDate(entry.entry_date)}</TableCell>
              <TableCell>{entry.entry_type}</TableCell>
              <TableCell>{entry.category}</TableCell>
              <TableCell>{entry.reference_no || "-"}</TableCell>
              <TableCell>{formatCurrency(entry.amount)}</TableCell>
              <TableCell>
                <div className="module-inline-actions">
                  <Button
                    type="button"
                    onClick={() =>
                      setLedgerForm({
                        id: String(entry.id),
                        entry_date: entry.entry_date,
                        entry_type: entry.entry_type,
                        category: entry.category,
                        reference_no: entry.reference_no || "",
                        counterparty_name: entry.counterparty_name || "",
                        amount: String(entry.amount || 0),
                        notes: entry.notes || "",
                      })
                    }
                  >
                    Edit
                  </Button>
                  <Button type="button" variant="destructive" onClick={() => void deleteRecord(`/api/accounts/ledger/${entry.id}`, "ledger entry")}>
                    Delete
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </Table>
      )}
    </div>
  );

  const renderVendors = () => (
    <div className="panel">
      <div className="module-panel-head">
        <h3>Vendor Payments</h3>
      </div>
      <form className="module-form-grid module-sales-grid" onSubmit={handleVendorSubmit}>
        <Label>
          Vendor Name
          <Input value={vendorForm.vendor_name} onChange={(event) => setVendorForm((current) => ({ ...current, vendor_name: event.target.value }))} placeholder="Vendor" aria-label="Vendor name" />
        </Label>
        <Label>
          Invoice Reference
          <Input value={vendorForm.invoice_ref} onChange={(event) => setVendorForm((current) => ({ ...current, invoice_ref: event.target.value }))} placeholder="Invoice ref" aria-label="Vendor invoice reference" />
        </Label>
        <Label>
          Amount
          <Input type="number" min={0} value={vendorForm.amount} onChange={(event) => setVendorForm((current) => ({ ...current, amount: event.target.value }))} placeholder="Amount" aria-label="Vendor payment amount" />
        </Label>
        <Label>
          Payment Date
          <Input type="date" value={vendorForm.payment_date} onChange={(event) => setVendorForm((current) => ({ ...current, payment_date: event.target.value }))} aria-label="Vendor payment date" />
        </Label>
        <Label>
          Payment Mode
          <Select value={vendorForm.payment_mode} onChange={(event) => setVendorForm((current) => ({ ...current, payment_mode: event.target.value }))} aria-label="Vendor payment mode">
            <option value="bank">Bank</option>
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="card">Card</option>
          </Select>
        </Label>
        <Label>
          Status
          <Select value={vendorForm.status} onChange={(event) => setVendorForm((current) => ({ ...current, status: event.target.value }))} aria-label="Vendor payment status">
            <option value="paid">Paid</option>
            <option value="partial">Partial</option>
            <option value="pending">Pending</option>
          </Select>
        </Label>
        <Label>
          Notes
          <Input value={vendorForm.notes} onChange={(event) => setVendorForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Notes" aria-label="Vendor payment notes" />
        </Label>
        <Button type="submit" variant="primary" disabled={savingVendor}>
          {savingVendor ? "Saving..." : vendorForm.id ? "Update Payment" : "Record Payment"}
        </Button>
      </form>

      {vendorPayments.length === 0 ? (
        <p className="muted">No vendor payments yet.</p>
      ) : (
        <Table className="module-table module-table-accounts-vendors" aria-label="Vendor payments table">
          <TableHead>
            <TableCell>Vendor</TableCell>
            <TableCell>Date</TableCell>
            <TableCell>Amount</TableCell>
            <TableCell>Mode</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Actions</TableCell>
          </TableHead>
          {vendorPayments.slice(0, 10).map((payment) => (
            <TableRow key={payment.id}>
              <TableCell>{payment.vendor_name}</TableCell>
              <TableCell>{formatDate(payment.payment_date)}</TableCell>
              <TableCell>{formatCurrency(payment.amount)}</TableCell>
              <TableCell>{payment.payment_mode || "bank"}</TableCell>
              <TableCell>{payment.status || "paid"}</TableCell>
              <TableCell>
                <div className="module-inline-actions">
                  <Button
                    type="button"
                    onClick={() =>
                      setVendorForm({
                        id: String(payment.id),
                        vendor_name: payment.vendor_name,
                        invoice_ref: payment.invoice_ref || "",
                        amount: String(payment.amount || 0),
                        payment_date: payment.payment_date,
                        payment_mode: payment.payment_mode || "bank",
                        status: payment.status || "paid",
                        notes: payment.notes || "",
                      })
                    }
                  >
                    Edit
                  </Button>
                  <Button type="button" variant="destructive" onClick={() => void deleteRecord(`/api/accounts/vendors/${payment.id}`, "vendor payment")}>
                    Delete
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </Table>
      )}
    </div>
  );

  const renderDoctors = () => (
    <div className="panel">
      <div className="module-panel-head">
        <h3>Doctor Payouts</h3>
      </div>
      <form className="module-form-grid module-sales-grid" onSubmit={handleDoctorSubmit}>
        <Label>
          Doctor Name
          <Input value={doctorForm.doctor_name} onChange={(event) => setDoctorForm((current) => ({ ...current, doctor_name: event.target.value }))} placeholder="Doctor" aria-label="Doctor name" />
        </Label>
        <Label>
          Payout Month
          <Input type="month" value={doctorForm.payout_month} onChange={(event) => setDoctorForm((current) => ({ ...current, payout_month: event.target.value }))} aria-label="Doctor payout month" />
        </Label>
        <Label>
          Total Amount
          <Input type="number" min={0} value={doctorForm.amount} onChange={(event) => setDoctorForm((current) => ({ ...current, amount: event.target.value }))} placeholder="Total amount" aria-label="Doctor payout amount" />
        </Label>
        <Label>
          Paid Amount
          <Input type="number" min={0} value={doctorForm.paid_amount} onChange={(event) => setDoctorForm((current) => ({ ...current, paid_amount: event.target.value }))} placeholder="Paid amount" aria-label="Doctor payout paid amount" />
        </Label>
        <Label>
          Paid Date
          <Input type="date" value={doctorForm.paid_date} onChange={(event) => setDoctorForm((current) => ({ ...current, paid_date: event.target.value }))} aria-label="Doctor paid date" />
        </Label>
        <Label>
          Status
          <Select value={doctorForm.status} onChange={(event) => setDoctorForm((current) => ({ ...current, status: event.target.value }))} aria-label="Doctor payout status">
            <option value="pending">Pending</option>
            <option value="partial">Partial</option>
            <option value="paid">Paid</option>
          </Select>
        </Label>
        <Label>
          Notes
          <Input value={doctorForm.notes} onChange={(event) => setDoctorForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Notes" aria-label="Doctor payout notes" />
        </Label>
        <Button type="submit" variant="primary" disabled={savingDoctor}>
          {savingDoctor ? "Saving..." : doctorForm.id ? "Update Payout" : "Record Payout"}
        </Button>
      </form>

      {doctorPayouts.length === 0 ? (
        <p className="muted">No doctor payouts yet.</p>
      ) : (
        <Table className="module-table module-table-accounts-doctors" aria-label="Doctor payouts table">
          <TableHead>
            <TableCell>Doctor</TableCell>
            <TableCell>Month</TableCell>
            <TableCell>Total</TableCell>
            <TableCell>Paid</TableCell>
            <TableCell>Due</TableCell>
            <TableCell>Actions</TableCell>
          </TableHead>
          {doctorPayouts.slice(0, 10).map((payout) => (
            <TableRow key={payout.id}>
              <TableCell>{payout.doctor_name}</TableCell>
              <TableCell>{payout.payout_month}</TableCell>
              <TableCell>{formatCurrency(payout.amount)}</TableCell>
              <TableCell>{formatCurrency(payout.paid_amount)}</TableCell>
              <TableCell>{formatCurrency(payout.due_amount)}</TableCell>
              <TableCell>
                <div className="module-inline-actions">
                  <Button
                    type="button"
                    onClick={() =>
                      setDoctorForm({
                        id: String(payout.id),
                        doctor_name: payout.doctor_name,
                        payout_month: payout.payout_month,
                        amount: String(payout.amount || 0),
                        paid_amount: String(payout.paid_amount || 0),
                        paid_date: payout.paid_date || "",
                        status: payout.status || "pending",
                        notes: payout.notes || "",
                      })
                    }
                  >
                    Edit
                  </Button>
                  <Button type="button" variant="destructive" onClick={() => void deleteRecord(`/api/accounts/doctors/${payout.id}`, "doctor payout")}>
                    Delete
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </Table>
      )}
    </div>
  );

  const meta = ACCOUNTS_VIEW_CONFIG[view];

  return (
    <section className="module-page">
      <div className="module-panel-head">
        <div>
          <h3>{meta.title}</h3>
          <p className="muted">{meta.subtitle}</p>
        </div>
      </div>

      <div className="stat-grid module-stat-grid">
        <StatCard label="Ledger Income" value={formatCurrency(summary.ledger_income)} />
        <StatCard label="Ledger Expense" value={formatCurrency(summary.ledger_expense)} />
        <StatCard label="Net Position" value={formatCurrency(summary.net_position)} />
        <StatCard label="Vendor Paid" value={formatCurrency(summary.vendor_paid_total)} />
        <StatCard label="Doctor Paid" value={formatCurrency(summary.doctor_paid_total)} />
        <StatCard label="Doctor Due" value={formatCurrency(summary.doctor_due_total)} />
      </div>

      {loading ? <p className="muted">Loading accounts...</p> : null}
      {view === "overview" ? renderOverview() : null}
      {view === "ledger" ? renderLedger() : null}
      {view === "vendor-payments" ? renderVendors() : null}
      {view === "doctor-payouts" ? renderDoctors() : null}
    </section>
  );
}
