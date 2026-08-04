import { useEffect, useMemo, useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import StatCard from "../components/StatCard";
import {
  Button,
  Input,
  Label,
  Select,
  Table,
  TableCell,
  TableHead,
  TableRow,
} from "../components/ui";
import { apiFetch, reportError } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { openRazorpayCheckout } from "../lib/razorpay";
import type { Notice, PatientWallet, Refund } from "../types";

export type BillingView =
  | "aging"
  | "reconciliation"
  | "create-invoice"
  | "record-payment"
  | "insurance-claims"
  | "invoices"
  | "payment-mode-breakdown"
  | "collections-by-module"
  | "consolidated-bill"
  | "wallet-refunds";

type Props = {
  setNotice: Dispatch<SetStateAction<Notice | null>>;
  view?: BillingView;
};

type BillingSummary = {
  total_billed: number;
  total_collected: number;
  total_due: number;
  total_advance: number;
  total_refunded: number;
  payment_mode_breakdown: { label: string; count: number }[];
  collections_by_module: { label: string; count: number }[];
  aging_buckets: {
    bucket_0_30: number;
    bucket_31_60: number;
    bucket_61_90: number;
    bucket_91_plus: number;
  };
  reconciliation_summary: {
    gateway_collected: number;
    converted_total: number;
  };
  conversion_breakdown: { label: string; count: number }[];
};

type Invoice = {
  id: number;
  invoice_no?: string;
  patient_id?: string;
  module?: string;
  total_amount?: number;
  paid_amount?: number;
  advance_amount?: number;
  refunded_amount?: number;
  due_amount?: number;
  payment_status?: string;
  created_at?: string;
};

type InsuranceClaim = {
  id: number;
  invoice_id: number;
  patient_id?: string | null;
  insurer_name: string;
  claim_amount?: number;
  approved_amount?: number;
  claim_status?: string;
  external_ref?: string | null;
  submitted_at?: string;
};

const EMPTY_SUMMARY: BillingSummary = {
  total_billed: 0,
  total_collected: 0,
  total_due: 0,
  total_advance: 0,
  total_refunded: 0,
  payment_mode_breakdown: [],
  collections_by_module: [],
  aging_buckets: {
    bucket_0_30: 0,
    bucket_31_60: 0,
    bucket_61_90: 0,
    bucket_91_plus: 0,
  },
  reconciliation_summary: {
    gateway_collected: 0,
    converted_total: 0,
  },
  conversion_breakdown: [],
};

type InvoiceForm = {
  id: string;
  patient_id: string;
  module: string;
  total_amount: string;
  paid_amount: string;
  advance_amount: string;
  refunded_amount: string;
  doctor_name: string;
};

type PaymentForm = {
  invoice_id: string;
  amount: string;
  payment_mode: string;
  gateway_ref: string;
  converted_from_mode: string;
  converted_to_mode: string;
};

type BillingFilters = {
  patient_id: string;
  module: string;
  status: string;
};

type ClaimForm = {
  id: string;
  invoice_id: string;
  patient_id: string;
  insurer_name: string;
  claim_amount: string;
  approved_amount: string;
  claim_status: string;
  external_ref: string;
};

const DEFAULT_INVOICE_FORM: InvoiceForm = {
  id: "",
  patient_id: "",
  module: "OP",
  total_amount: "0",
  paid_amount: "0",
  advance_amount: "0",
  refunded_amount: "0",
  doctor_name: "",
};

const DEFAULT_PAYMENT_FORM: PaymentForm = {
  invoice_id: "",
  amount: "0",
  payment_mode: "cash",
  gateway_ref: "",
  converted_from_mode: "",
  converted_to_mode: "",
};

const DEFAULT_BILLING_FILTERS: BillingFilters = {
  patient_id: "",
  module: "",
  status: "",
};

const DEFAULT_CLAIM_FORM: ClaimForm = {
  id: "",
  invoice_id: "",
  patient_id: "",
  insurer_name: "",
  claim_amount: "0",
  approved_amount: "0",
  claim_status: "submitted",
  external_ref: "",
};

const BILLING_VIEW_CONFIG: Record<
  BillingView,
  { title: string; subtitle: string }
> = {
  aging: {
    title: "Receivable Aging",
    subtitle: "Track due balances across aging buckets.",
  },
  reconciliation: {
    title: "Payment Reconciliation",
    subtitle: "Compare gateway collections and converted amounts.",
  },
  "create-invoice": {
    title: "Create Invoice",
    subtitle: "Create and update patient billing invoices.",
  },
  "record-payment": {
    title: "Record Payment",
    subtitle: "Capture direct and Razorpay-backed invoice collections.",
  },
  "insurance-claims": {
    title: "Insurance Claims",
    subtitle: "Create, track, and update insurance claim records.",
  },
  invoices: {
    title: "Invoices",
    subtitle: "Review invoice list with quick filtering and actions.",
  },
  "payment-mode-breakdown": {
    title: "Payment Mode Breakdown",
    subtitle: "Understand collection mix by payment method.",
  },
  "collections-by-module": {
    title: "Collections by Module",
    subtitle: "Monitor amount collected per billing module.",
  },
  "consolidated-bill": {
    title: "Consolidated Bill & Payment",
    subtitle: "Process master payments against patient due balances.",
  },
  "wallet-refunds": {
    title: "Patient Wallet & Refunds",
    subtitle: "Manage advance deposits and issue secure refunds.",
  },
};

function formatCurrency(amount?: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

export default function BillingPage({
  setNotice,
  view = "record-payment",
}: Props) {
  const [summary, setSummary] = useState<BillingSummary>(EMPTY_SUMMARY);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [claims, setClaims] = useState<InsuranceClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [invoiceForm, setInvoiceForm] =
    useState<InvoiceForm>(DEFAULT_INVOICE_FORM);
  const [paymentForm, setPaymentForm] =
    useState<PaymentForm>(DEFAULT_PAYMENT_FORM);
  const [claimForm, setClaimForm] = useState<ClaimForm>(DEFAULT_CLAIM_FORM);
  const [filters, setFilters] = useState<BillingFilters>(
    DEFAULT_BILLING_FILTERS,
  );
  const [savingInvoice, setSavingInvoice] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [savingClaim, setSavingClaim] = useState(false);
  const [isRazorpayReady, setIsRazorpayReady] = useState(true);
  const maxBreakdownValue = Math.max(
    1,
    ...summary.payment_mode_breakdown.map((row) => row.count || 0),
  );
  const maxModuleCollectionValue = Math.max(
    1,
    ...summary.collections_by_module.map((row) => row.count || 0),
  );
  const needsInvoices =
    view === "create-invoice" ||
    view === "record-payment" ||
    view === "insurance-claims" ||
    view === "invoices" ||
    view === "consolidated-bill";
  const needsClaims = view === "insurance-claims";

  const [walletSearchId, setWalletSearchId] = useState("");
  const [walletData, setWalletData] = useState<PatientWallet | null>(null);
  const [refundsList, setRefundsList] = useState<Refund[]>([]);
  const [walletForm, setWalletForm] = useState({ amount: "", reason: "" });
  const [refundForm, setRefundForm] = useState({
    invoice_id: "",
    amount: "",
    reason: "",
  });
  const [masterPaymentForm, setMasterPaymentForm] = useState({
    patient_id: "",
    amount: "",
    payment_mode: "cash",
    use_wallet: false,
  });

  const buildInvoicePath = (nextFilters: BillingFilters) => {
    const params = new URLSearchParams();
    if (nextFilters.patient_id.trim())
      params.set("patient_id", nextFilters.patient_id.trim());
    if (nextFilters.module) params.set("module", nextFilters.module);
    const query = params.toString();
    return query ? `/api/billing/invoices?${query}` : "/api/billing/invoices";
  };

  const loadBilling = async (nextFilters: BillingFilters = filters) => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const summaryRequest = apiFetch<BillingSummary>(
        "/api/billing/revenue-summary",
      );
      const invoiceRequest = needsInvoices
        ? apiFetch<{ invoices?: Invoice[] }>(buildInvoicePath(nextFilters))
        : Promise.resolve({ invoices: [] as Invoice[] });
      const claimsRequest = needsClaims
        ? apiFetch<{ claims?: InsuranceClaim[] }>("/api/billing/claims")
        : Promise.resolve({ claims: [] as InsuranceClaim[] });

      const [summaryData, invoiceData, claimsData] = await Promise.all([
        summaryRequest,
        invoiceRequest,
        claimsRequest,
      ]);
      const fetchedInvoices = invoiceData.invoices || [];
      const fetchedClaims = claimsData.claims || [];
      setInvoices(fetchedInvoices);
      setClaims(fetchedClaims);
      setSummary({
        ...EMPTY_SUMMARY,
        ...summaryData,
        payment_mode_breakdown: summaryData.payment_mode_breakdown || [],
        collections_by_module: summaryData.collections_by_module || [],
        conversion_breakdown: summaryData.conversion_breakdown || [],
        aging_buckets: {
          ...EMPTY_SUMMARY.aging_buckets,
          ...(summaryData.aging_buckets || {}),
        },
        reconciliation_summary: {
          ...EMPTY_SUMMARY.reconciliation_summary,
          ...(summaryData.reconciliation_summary || {}),
        },
      });
      setPaymentForm((current) => {
        if (current.invoice_id) return current;
        return {
          ...current,
          invoice_id: fetchedInvoices[0] ? String(fetchedInvoices[0].id) : "",
        };
      });
      setClaimForm((current) => {
        if (current.invoice_id) return current;
        return {
          ...current,
          invoice_id: fetchedInvoices[0] ? String(fetchedInvoices[0].id) : "",
          patient_id: fetchedInvoices[0]?.patient_id || "",
        };
      });
    } catch (error) {
      const typedError = error as { message?: string; status?: number };
      setErrorMessage(typedError.message || "Unable to load billing data.");
      reportError(setNotice, typedError, "Unable to load billing data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBilling();
  }, [view]);

  useEffect(() => {
    apiFetch<{ configured?: boolean }>("/api/payments/razorpay/config")
      .then((data) => setIsRazorpayReady(data.configured !== false))
      .catch(() => setIsRazorpayReady(true));
  }, []);

  const ensureRazorpayConfigured = async () => {
    try {
      const config = await apiFetch<{ configured?: boolean }>(
        "/api/payments/razorpay/config",
      );
      const configured = config.configured !== false;
      setIsRazorpayReady(configured);
      if (!configured) {
        setNotice({
          type: "error",
          message: "Razorpay is not configured. Add keys in backend .env.",
        });
        return false;
      }
      return true;
    } catch {
      return true;
    }
  };

  const visibleInvoices = useMemo(() => {
    if (!filters.status) return invoices;
    return invoices.filter(
      (invoice) => (invoice.payment_status || "due") === filters.status,
    );
  }, [invoices, filters.status]);

  const handleFilterSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await loadBilling(filters);
  };

  const clearFilters = async () => {
    setFilters({ ...DEFAULT_BILLING_FILTERS });
    await loadBilling({ ...DEFAULT_BILLING_FILTERS });
  };

  const handleCreateInvoice = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const totalAmount = Number(invoiceForm.total_amount) || 0;
    const paidAmount = Number(invoiceForm.paid_amount) || 0;
    const advanceAmount = Number(invoiceForm.advance_amount) || 0;
    const refundedAmount = Number(invoiceForm.refunded_amount) || 0;
    if (totalAmount <= 0) {
      setNotice({
        type: "error",
        message: "Invoice total amount must be greater than zero.",
      });
      return;
    }

    setSavingInvoice(true);
    try {
      const editingInvoiceId = Number(invoiceForm.id);
      const path = editingInvoiceId
        ? `/api/billing/invoices/${editingInvoiceId}`
        : "/api/billing/invoices";
      await apiFetch(path, {
        method: editingInvoiceId ? "PUT" : "POST",
        body: JSON.stringify({
          patient_id: invoiceForm.patient_id.trim() || undefined,
          module: invoiceForm.module,
          doctor_name: invoiceForm.doctor_name.trim() || undefined,
          total_amount: totalAmount,
          paid_amount: paidAmount,
          advance_amount: advanceAmount,
          refunded_amount: refundedAmount,
          payment_status:
            Math.max(paidAmount + advanceAmount - refundedAmount, 0) >=
            totalAmount
              ? "paid"
              : paidAmount > 0 || advanceAmount > 0
                ? "partial"
                : "due",
        }),
      });
      setInvoiceForm({ ...DEFAULT_INVOICE_FORM });
      setNotice({
        type: "success",
        message: editingInvoiceId
          ? "Invoice updated successfully."
          : "Invoice created successfully.",
      });
      await loadBilling(filters);
    } catch (error) {
      reportError(
        setNotice,
        error as { message?: string; status?: number },
        "Unable to create invoice.",
      );
    } finally {
      setSavingInvoice(false);
    }
  };

  const handleEditInvoice = (invoice: Invoice) => {
    setInvoiceForm({
      id: String(invoice.id),
      patient_id: invoice.patient_id || "",
      module: invoice.module || "OP",
      total_amount: String(invoice.total_amount || 0),
      paid_amount: String(invoice.paid_amount || 0),
      advance_amount: String(invoice.advance_amount || 0),
      refunded_amount: String(invoice.refunded_amount || 0),
      doctor_name: "",
    });
  };

  const handleDeleteInvoice = async (invoice: Invoice) => {
    if (!window.confirm(`Delete ${invoice.invoice_no || `INV-${invoice.id}`}?`))
      return;
    try {
      await apiFetch(`/api/billing/invoices/${invoice.id}`, {
        method: "DELETE",
      });
      setNotice({ type: "success", message: "Invoice deleted." });
      await loadBilling(filters);
    } catch (error) {
      reportError(
        setNotice,
        error as { message?: string; status?: number },
        "Unable to delete invoice.",
      );
    }
  };

  const handleRecordPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const invoiceId = Number(paymentForm.invoice_id);
    const amount = Number(paymentForm.amount) || 0;
    if (!invoiceId) {
      setNotice({ type: "error", message: "Select a valid invoice." });
      return;
    }
    if (amount <= 0) {
      setNotice({
        type: "error",
        message: "Payment amount must be greater than zero.",
      });
      return;
    }

    setSavingPayment(true);
    try {
      await apiFetch(`/api/billing/invoices/${invoiceId}/payments`, {
        method: "POST",
        body: JSON.stringify({
          amount,
          payment_mode: paymentForm.payment_mode,
          gateway_ref: paymentForm.gateway_ref.trim() || undefined,
          converted_from_mode: paymentForm.converted_from_mode || undefined,
          converted_to_mode: paymentForm.converted_to_mode || undefined,
        }),
      });
      setPaymentForm((current) => ({
        ...DEFAULT_PAYMENT_FORM,
        invoice_id: current.invoice_id,
      }));
      setNotice({ type: "success", message: "Payment recorded successfully." });
      await loadBilling(filters);
    } catch (error) {
      reportError(
        setNotice,
        error as { message?: string; status?: number },
        "Unable to record payment.",
      );
    } finally {
      setSavingPayment(false);
    }
  };

  const loadWalletAndRefunds = async (patientId: string) => {
    if (!patientId.trim()) return;
    try {
      const wData = await apiFetch<{
        wallet: import("../types").PatientWallet;
      }>(`/api/billing/wallet/${patientId}`);
      setWalletData(wData.wallet);
      const rData = await apiFetch<{ refunds: import("../types").Refund[] }>(
        `/api/billing/refunds`,
      );
      setRefundsList(rData.refunds || []);
    } catch (e) {
      reportError(
        setNotice,
        e as { message?: string },
        "Failed to load wallet data.",
      );
    }
  };

  const handleAddWallet = async (e: FormEvent) => {
    e.preventDefault();
    if (!walletSearchId || !walletForm.amount || !walletForm.reason) {
      setNotice({ type: "error", message: "All fields are required" });
      return;
    }
    try {
      await apiFetch("/api/billing/wallet", {
        method: "POST",
        body: JSON.stringify({
          patient_id: walletSearchId,
          amount: Number(walletForm.amount),
          reason: walletForm.reason,
        }),
      });
      setNotice({ type: "success", message: "Wallet updated" });
      setWalletForm({ amount: "", reason: "" });
      void loadWalletAndRefunds(walletSearchId);
    } catch (e) {
      reportError(
        setNotice,
        e as { message?: string },
        "Failed to add to wallet.",
      );
    }
  };

  const handleCreateRefund = async (e: FormEvent) => {
    e.preventDefault();
    if (!refundForm.invoice_id || !refundForm.amount || !refundForm.reason) {
      setNotice({ type: "error", message: "All fields are required" });
      return;
    }
    try {
      await apiFetch("/api/billing/refunds", {
        method: "POST",
        body: JSON.stringify({
          invoice_id: Number(refundForm.invoice_id),
          amount: Number(refundForm.amount),
          reason: refundForm.reason,
        }),
      });
      setNotice({ type: "success", message: "Refund created" });
      setRefundForm({ invoice_id: "", amount: "", reason: "" });
      void loadWalletAndRefunds(walletSearchId);
    } catch (e) {
      reportError(
        setNotice,
        e as { message?: string },
        "Failed to create refund.",
      );
    }
  };

  const handleMasterPayment = async (e: FormEvent) => {
    e.preventDefault();
    const patientInvoices = invoices.filter(
      (inv) =>
        inv.patient_id === masterPaymentForm.patient_id &&
        (inv.due_amount || 0) > 0,
    );
    if (patientInvoices.length === 0) {
      setNotice({
        type: "error",
        message: "No pending invoices found for this patient",
      });
      return;
    }

    const allocations = patientInvoices.map((inv) => ({
      invoice_id: inv.id,
      amount: inv.due_amount,
    }));
    try {
      await apiFetch("/api/billing/master-payment", {
        method: "POST",
        body: JSON.stringify({
          patient_id: masterPaymentForm.patient_id,
          total_amount: Number(masterPaymentForm.amount),
          payment_mode: masterPaymentForm.payment_mode,
          use_wallet: masterPaymentForm.use_wallet,
          allocations,
        }),
      });
      setNotice({ type: "success", message: "Master payment applied" });
      setMasterPaymentForm({
        patient_id: "",
        amount: "",
        payment_mode: "cash",
        use_wallet: false,
      });
      void loadBilling();
    } catch (err) {
      reportError(
        setNotice,
        err as { message?: string },
        "Master payment failed.",
      );
    }
  };

  const handleRazorpayBillingPayment = async () => {
    if (!(await ensureRazorpayConfigured())) {
      return;
    }
    const invoiceId = Number(paymentForm.invoice_id);
    const amount = Number(paymentForm.amount) || 0;
    if (!invoiceId) {
      setNotice({ type: "error", message: "Select a valid invoice." });
      return;
    }
    if (amount <= 0) {
      setNotice({
        type: "error",
        message: "Payment amount must be greater than zero.",
      });
      return;
    }

    const linkedInvoice = invoices.find((invoice) => invoice.id === invoiceId);
    setSavingPayment(true);
    try {
      const order = await apiFetch<{
        key_id: string;
        order_id: string;
        amount: number;
        currency: string;
      }>("/api/billing/razorpay/order", {
        method: "POST",
        body: JSON.stringify({
          invoice_id: invoiceId,
          amount,
          notes: {
            invoice_no: linkedInvoice?.invoice_no || `INV-${invoiceId}`,
            patient_id: linkedInvoice?.patient_id || "",
          },
        }),
      });

      const paymentResult = await openRazorpayCheckout({
        key: order.key_id,
        amount: order.amount,
        currency: order.currency || "INR",
        name: "HospAI Billing",
        description: `Invoice ${linkedInvoice?.invoice_no || `INV-${invoiceId}`}`,
        order_id: order.order_id,
        prefill: {
          name: linkedInvoice?.patient_id || "",
        },
        notes: {
          invoice_id: String(invoiceId),
        },
        theme: {
          color: "#0f766e",
        },
      });

      await apiFetch("/api/billing/razorpay/verify", {
        method: "POST",
        body: JSON.stringify({
          invoice_id: invoiceId,
          amount,
          payment_mode: paymentForm.payment_mode,
          converted_from_mode: paymentForm.converted_from_mode || undefined,
          converted_to_mode: paymentForm.converted_to_mode || undefined,
          razorpay_order_id: paymentResult.razorpay_order_id,
          razorpay_payment_id: paymentResult.razorpay_payment_id,
          razorpay_signature: paymentResult.razorpay_signature,
        }),
      });

      setPaymentForm((current) => ({
        ...DEFAULT_PAYMENT_FORM,
        invoice_id: current.invoice_id,
      }));
      setNotice({
        type: "success",
        message: "Razorpay payment recorded successfully.",
      });
      await loadBilling(filters);
    } catch (error) {
      reportError(
        setNotice,
        error as { message?: string; status?: number },
        "Unable to complete Razorpay payment.",
      );
    } finally {
      setSavingPayment(false);
    }
  };

  const handleClaimSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const invoiceId = Number(claimForm.invoice_id);
    const claimAmount = Number(claimForm.claim_amount) || 0;
    if (!invoiceId || !claimForm.insurer_name.trim() || claimAmount <= 0) {
      setNotice({
        type: "error",
        message: "Invoice, insurer, and claim amount are required.",
      });
      return;
    }

    setSavingClaim(true);
    try {
      const claimId = Number(claimForm.id);
      const path = claimId
        ? `/api/billing/claims/${claimId}`
        : "/api/billing/claims";
      await apiFetch(path, {
        method: claimId ? "PUT" : "POST",
        body: JSON.stringify({
          invoice_id: invoiceId,
          patient_id: claimForm.patient_id.trim() || undefined,
          insurer_name: claimForm.insurer_name.trim(),
          claim_amount: claimAmount,
          approved_amount: Number(claimForm.approved_amount) || 0,
          claim_status: claimForm.claim_status,
          external_ref: claimForm.external_ref.trim() || undefined,
        }),
      });
      setClaimForm((current) => ({
        ...DEFAULT_CLAIM_FORM,
        invoice_id: current.invoice_id,
        patient_id: current.patient_id,
      }));
      setNotice({
        type: "success",
        message: claimId
          ? "Insurance claim updated."
          : "Insurance claim created.",
      });
      await loadBilling(filters);
    } catch (error) {
      reportError(
        setNotice,
        error as { message?: string; status?: number },
        "Unable to save insurance claim.",
      );
    } finally {
      setSavingClaim(false);
    }
  };

  const handleEditClaim = (claim: InsuranceClaim) => {
    setClaimForm({
      id: String(claim.id),
      invoice_id: String(claim.invoice_id),
      patient_id: claim.patient_id || "",
      insurer_name: claim.insurer_name,
      claim_amount: String(claim.claim_amount || 0),
      approved_amount: String(claim.approved_amount || 0),
      claim_status: claim.claim_status || "submitted",
      external_ref: claim.external_ref || "",
    });
  };

  const handleDeleteClaim = async (claim: InsuranceClaim) => {
    if (!window.confirm(`Delete claim ${claim.id}?`)) return;
    try {
      await apiFetch(`/api/billing/claims/${claim.id}`, { method: "DELETE" });
      setNotice({ type: "success", message: "Insurance claim deleted." });
      await loadBilling(filters);
    } catch (error) {
      reportError(
        setNotice,
        error as { message?: string; status?: number },
        "Unable to delete insurance claim.",
      );
    }
  };

  const viewContent = (() => {
    if (view === "aging") {
      return (
        <div className="panel">
          <div className="module-panel-head">
            <h3>Receivable Aging</h3>
          </div>
          <div className="bar-chart">
            <div className="bar-row">
              <span>0-30 days</span>
              <div className="bar">
                <div
                  style={{
                    width: `${Math.max(8, (summary.aging_buckets.bucket_0_30 / Math.max(summary.total_due, 1)) * 100)}%`,
                  }}
                />
              </div>
              <span>{formatCurrency(summary.aging_buckets.bucket_0_30)}</span>
            </div>
            <div className="bar-row">
              <span>31-60 days</span>
              <div className="bar">
                <div
                  style={{
                    width: `${Math.max(8, (summary.aging_buckets.bucket_31_60 / Math.max(summary.total_due, 1)) * 100)}%`,
                  }}
                />
              </div>
              <span>{formatCurrency(summary.aging_buckets.bucket_31_60)}</span>
            </div>
            <div className="bar-row">
              <span>61-90 days</span>
              <div className="bar">
                <div
                  style={{
                    width: `${Math.max(8, (summary.aging_buckets.bucket_61_90 / Math.max(summary.total_due, 1)) * 100)}%`,
                  }}
                />
              </div>
              <span>{formatCurrency(summary.aging_buckets.bucket_61_90)}</span>
            </div>
            <div className="bar-row">
              <span>91+ days</span>
              <div className="bar">
                <div
                  style={{
                    width: `${Math.max(8, (summary.aging_buckets.bucket_91_plus / Math.max(summary.total_due, 1)) * 100)}%`,
                  }}
                />
              </div>
              <span>
                {formatCurrency(summary.aging_buckets.bucket_91_plus)}
              </span>
            </div>
          </div>
        </div>
      );
    }

    if (view === "reconciliation") {
      return (
        <div className="panel">
          <div className="module-panel-head">
            <h3>Payment Reconciliation</h3>
          </div>
          <div className="care-note-list">
            <div className="care-note-card">
              <strong>Gateway Collected</strong>
              <p>
                {formatCurrency(
                  summary.reconciliation_summary.gateway_collected,
                )}
              </p>
            </div>
            <div className="care-note-card">
              <strong>Converted Payments</strong>
              <p>
                {formatCurrency(summary.reconciliation_summary.converted_total)}
              </p>
            </div>
          </div>
          {summary.conversion_breakdown.length === 0 ? (
            <p className="muted">No converted payment entries yet.</p>
          ) : (
            <div className="bar-chart">
              {summary.conversion_breakdown.map((row) => (
                <div className="bar-row" key={row.label}>
                  <span>{row.label}</span>
                  <div className="bar">
                    <div
                      style={{
                        width: `${Math.max(8, (row.count / Math.max(summary.reconciliation_summary.converted_total, 1)) * 100)}%`,
                      }}
                    />
                  </div>
                  <span>{formatCurrency(row.count)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (view === "create-invoice") {
      return (
        <div className="panel">
          <div className="module-panel-head">
            <h3>Create Invoice</h3>
          </div>
          <form
            className="module-form-grid module-sales-grid"
            onSubmit={handleCreateInvoice}
          >
            <Label>
              Patient ID (optional)
              <Input
                value={invoiceForm.patient_id}
                onChange={(event) =>
                  setInvoiceForm((current) => ({
                    ...current,
                    patient_id: event.target.value,
                  }))
                }
                placeholder="Patient ID"
                aria-label="Billing patient id"
              />
            </Label>
            <Label>
              Billing Module
              <Select
                value={invoiceForm.module}
                onChange={(event) =>
                  setInvoiceForm((current) => ({
                    ...current,
                    module: event.target.value,
                  }))
                }
                aria-label="Billing module"
              >
                <option value="OP">OP</option>
                <option value="IP">IP</option>
                <option value="LAB">Lab</option>
                <option value="PHARMACY">Pharmacy</option>
              </Select>
            </Label>
            <Label>
              Total Amount
              <Input
                type="number"
                min={0}
                value={invoiceForm.total_amount}
                onChange={(event) =>
                  setInvoiceForm((current) => ({
                    ...current,
                    total_amount: event.target.value,
                  }))
                }
                placeholder="Total amount"
                aria-label="Billing total amount"
              />
            </Label>
            <Label>
              Initial Paid Amount
              <Input
                type="number"
                min={0}
                value={invoiceForm.paid_amount}
                onChange={(event) =>
                  setInvoiceForm((current) => ({
                    ...current,
                    paid_amount: event.target.value,
                  }))
                }
                placeholder="Initial paid amount"
                aria-label="Billing paid amount"
              />
            </Label>
            <Label>
              Advance Amount
              <Input
                type="number"
                min={0}
                value={invoiceForm.advance_amount}
                onChange={(event) =>
                  setInvoiceForm((current) => ({
                    ...current,
                    advance_amount: event.target.value,
                  }))
                }
                placeholder="Advance amount"
                aria-label="Billing advance amount"
              />
            </Label>
            <Label>
              Refund Amount
              <Input
                type="number"
                min={0}
                value={invoiceForm.refunded_amount}
                onChange={(event) =>
                  setInvoiceForm((current) => ({
                    ...current,
                    refunded_amount: event.target.value,
                  }))
                }
                placeholder="Refund amount"
                aria-label="Billing refund amount"
              />
            </Label>
            <Label>
              Doctor Name
              <Input
                value={invoiceForm.doctor_name}
                onChange={(event) =>
                  setInvoiceForm((current) => ({
                    ...current,
                    doctor_name: event.target.value,
                  }))
                }
                placeholder="Doctor name"
                aria-label="Billing doctor name"
              />
            </Label>
            <Button type="submit" disabled={savingInvoice}>
              {savingInvoice ? "Saving..." : "Create Invoice"}
            </Button>
            {invoiceForm.id ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setInvoiceForm({ ...DEFAULT_INVOICE_FORM })}
              >
                Cancel Edit
              </Button>
            ) : null}
          </form>
        </div>
      );
    }

    if (view === "record-payment") {
      return (
        <div className="panel">
          <div className="module-panel-head">
            <h3>Record Payment</h3>
          </div>
          <form
            className="module-form-grid module-sales-grid"
            onSubmit={handleRecordPayment}
          >
            <Label>
              Invoice
              <Select
                value={paymentForm.invoice_id}
                onChange={(event) =>
                  setPaymentForm((current) => ({
                    ...current,
                    invoice_id: event.target.value,
                  }))
                }
                aria-label="Billing payment invoice"
              >
                <option value="">Select invoice</option>
                {invoices.map((invoice) => (
                  <option
                    key={`payment-invoice-${invoice.id}`}
                    value={invoice.id}
                  >
                    {(invoice.invoice_no || `INV-${invoice.id}`) +
                      ` (${formatCurrency(invoice.due_amount)})`}
                  </option>
                ))}
              </Select>
            </Label>
            <Label>
              Payment Amount
              <Input
                type="number"
                min={0}
                value={paymentForm.amount}
                onChange={(event) =>
                  setPaymentForm((current) => ({
                    ...current,
                    amount: event.target.value,
                  }))
                }
                placeholder="Payment amount"
                aria-label="Billing payment amount"
              />
            </Label>
            <Label>
              Payment Mode
              <Select
                value={paymentForm.payment_mode}
                onChange={(event) =>
                  setPaymentForm((current) => ({
                    ...current,
                    payment_mode: event.target.value,
                  }))
                }
                aria-label="Billing payment mode"
              >
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="upi">UPI</option>
                <option value="bank">Bank Transfer</option>
              </Select>
            </Label>
            <Label>
              Gateway Reference
              <Input
                value={paymentForm.gateway_ref}
                onChange={(event) =>
                  setPaymentForm((current) => ({
                    ...current,
                    gateway_ref: event.target.value,
                  }))
                }
                placeholder="Gateway reference"
                aria-label="Billing gateway reference"
              />
            </Label>
            <Label>
              Converted From Mode
              <Select
                value={paymentForm.converted_from_mode}
                onChange={(event) =>
                  setPaymentForm((current) => ({
                    ...current,
                    converted_from_mode: event.target.value,
                  }))
                }
                aria-label="Billing converted from mode"
              >
                <option value="">No conversion</option>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="upi">UPI</option>
                <option value="bank">Bank Transfer</option>
              </Select>
            </Label>
            <Label>
              Converted To Mode
              <Select
                value={paymentForm.converted_to_mode}
                onChange={(event) =>
                  setPaymentForm((current) => ({
                    ...current,
                    converted_to_mode: event.target.value,
                  }))
                }
                aria-label="Billing converted to mode"
                disabled={!paymentForm.converted_from_mode}
              >
                <option value="">Converted to</option>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="upi">UPI</option>
                <option value="bank">Bank Transfer</option>
              </Select>
            </Label>
            <Button
              type="submit"
              disabled={savingPayment || invoices.length === 0}
            >
              {savingPayment ? "Saving..." : "Record Payment"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={
                savingPayment || invoices.length === 0 || !isRazorpayReady
              }
              onClick={() => void handleRazorpayBillingPayment()}
            >
              {savingPayment ? "Processing..." : "Pay via Razorpay"}
            </Button>
          </form>
          {invoices.length === 0 ? (
            <p className="muted">
              Create an invoice first before recording payment.
            </p>
          ) : null}
          {!isRazorpayReady ? (
            <p className="muted">
              Razorpay payments are disabled until backend keys are configured.
            </p>
          ) : null}
        </div>
      );
    }

    if (view === "insurance-claims") {
      return (
        <div className="panel">
          <div className="module-panel-head">
            <h3>Insurance Claims</h3>
          </div>
          <form
            className="module-form-grid module-sales-grid"
            onSubmit={handleClaimSubmit}
          >
            <Label>
              Invoice
              <Select
                value={claimForm.invoice_id}
                onChange={(event) => {
                  const nextInvoiceId = event.target.value;
                  const linked = invoices.find(
                    (invoice) => String(invoice.id) === nextInvoiceId,
                  );
                  setClaimForm((current) => ({
                    ...current,
                    invoice_id: nextInvoiceId,
                    patient_id: linked?.patient_id || current.patient_id,
                  }));
                }}
                aria-label="Billing claim invoice"
              >
                <option value="">Select invoice</option>
                {invoices.map((invoice) => (
                  <option
                    key={`claim-invoice-${invoice.id}`}
                    value={invoice.id}
                  >
                    {invoice.invoice_no || `INV-${invoice.id}`}
                  </option>
                ))}
              </Select>
            </Label>
            <Label>
              Insurer
              <Input
                value={claimForm.insurer_name}
                onChange={(event) =>
                  setClaimForm((current) => ({
                    ...current,
                    insurer_name: event.target.value,
                  }))
                }
                placeholder="Insurer"
                aria-label="Billing insurer"
              />
            </Label>
            <Label>
              Claim Amount
              <Input
                type="number"
                min={0}
                value={claimForm.claim_amount}
                onChange={(event) =>
                  setClaimForm((current) => ({
                    ...current,
                    claim_amount: event.target.value,
                  }))
                }
                placeholder="Claim amount"
                aria-label="Billing claim amount"
              />
            </Label>
            <Label>
              Approved Amount
              <Input
                type="number"
                min={0}
                value={claimForm.approved_amount}
                onChange={(event) =>
                  setClaimForm((current) => ({
                    ...current,
                    approved_amount: event.target.value,
                  }))
                }
                placeholder="Approved amount"
                aria-label="Billing approved amount"
              />
            </Label>
            <Label>
              Claim Status
              <Select
                value={claimForm.claim_status}
                onChange={(event) =>
                  setClaimForm((current) => ({
                    ...current,
                    claim_status: event.target.value,
                  }))
                }
                aria-label="Billing claim status"
              >
                <option value="submitted">Submitted</option>
                <option value="under_review">Under Review</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="settled">Settled</option>
              </Select>
            </Label>
            <Label>
              Claim Reference
              <Input
                value={claimForm.external_ref}
                onChange={(event) =>
                  setClaimForm((current) => ({
                    ...current,
                    external_ref: event.target.value,
                  }))
                }
                placeholder="Claim reference"
                aria-label="Billing claim reference"
              />
            </Label>
            <Button
              type="submit"
              disabled={savingClaim || invoices.length === 0}
            >
              {savingClaim
                ? "Saving..."
                : claimForm.id
                  ? "Update Claim"
                  : "Create Claim"}
            </Button>
            {claimForm.id ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setClaimForm({ ...DEFAULT_CLAIM_FORM })}
              >
                Cancel Edit
              </Button>
            ) : null}
          </form>

          {claims.length === 0 ? (
            <p className="muted">No insurance claims recorded yet.</p>
          ) : (
            <>
              <Table
                className="module-table"
                role="table"
                aria-label="Billing insurance claims table"
              >
                <TableHead>
                  <TableCell>Invoice</TableCell>
                  <TableCell>Insurer</TableCell>
                  <TableCell>Claimed</TableCell>
                  <TableCell>Approved</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Actions</TableCell>
                </TableHead>
                {claims.slice(0, 10).map((claim) => (
                  <TableRow key={claim.id}>
                    <TableCell>
                      {invoices.find(
                        (invoice) => invoice.id === claim.invoice_id,
                      )?.invoice_no || `INV-${claim.invoice_id}`}
                    </TableCell>
                    <TableCell>{claim.insurer_name}</TableCell>
                    <TableCell>{formatCurrency(claim.claim_amount)}</TableCell>
                    <TableCell>
                      {formatCurrency(claim.approved_amount)}
                    </TableCell>
                    <TableCell>{claim.claim_status || "-"}</TableCell>
                    <TableCell>
                      <div className="module-inline-actions">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleEditClaim(claim)}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={() => void handleDeleteClaim(claim)}
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </Table>
            </>
          )}
        </div>
      );
    }

    if (view === "invoices") {
      return (
        <div className="panel">
          <div className="module-panel-head">
            <h3>Invoices</h3>
          </div>

          <form
            className="module-form-grid module-filter-grid"
            onSubmit={handleFilterSubmit}
          >
            <Label>
              Filter by Patient ID
              <Input
                value={filters.patient_id}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    patient_id: event.target.value,
                  }))
                }
                placeholder="Patient ID"
                aria-label="Billing filter patient"
              />
            </Label>
            <Label>
              Module
              <Select
                value={filters.module}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    module: event.target.value,
                  }))
                }
                aria-label="Billing filter module"
              >
                <option value="">All Modules</option>
                <option value="OP">OP</option>
                <option value="IP">IP</option>
                <option value="LAB">Lab</option>
                <option value="PHARMACY">Pharmacy</option>
              </Select>
            </Label>
            <Label>
              Payment Status
              <Select
                value={filters.status}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    status: event.target.value,
                  }))
                }
                aria-label="Billing filter status"
              >
                <option value="">All Statuses</option>
                <option value="due">Due</option>
                <option value="partial">Partial</option>
                <option value="paid">Paid</option>
              </Select>
            </Label>
            <div className="module-inline-actions">
              <Button type="submit">Apply</Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void clearFilters()}
              >
                Clear
              </Button>
            </div>
          </form>

          {loading ? <p className="muted">Loading billing records...</p> : null}
          {errorMessage ? <p className="notice error">{errorMessage}</p> : null}
          {!loading && !errorMessage && visibleInvoices.length === 0 ? (
            <p className="muted">No invoices available for this filter.</p>
          ) : null}

          {!loading && !errorMessage && visibleInvoices.length > 0 ? (
            <>
              <Table
                className="module-table module-table-billing"
                role="table"
                aria-label="Billing invoices table"
              >
                <TableHead>
                  <TableCell>Invoice</TableCell>
                  <TableCell>Patient</TableCell>
                  <TableCell>Module</TableCell>
                  <TableCell>Total</TableCell>
                  <TableCell>Advance</TableCell>
                  <TableCell>Refund</TableCell>
                  <TableCell>Due</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Actions</TableCell>
                </TableHead>
                {visibleInvoices.slice(0, 12).map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell>
                      {invoice.invoice_no || `INV-${invoice.id}`}
                    </TableCell>
                    <TableCell>{invoice.patient_id || "-"}</TableCell>
                    <TableCell>{invoice.module || "-"}</TableCell>
                    <TableCell>
                      {formatCurrency(invoice.total_amount)}
                    </TableCell>
                    <TableCell>
                      {formatCurrency(invoice.advance_amount)}
                    </TableCell>
                    <TableCell>
                      {formatCurrency(invoice.refunded_amount)}
                    </TableCell>
                    <TableCell>{formatCurrency(invoice.due_amount)}</TableCell>
                    <TableCell>{invoice.payment_status || "-"}</TableCell>
                    <TableCell>
                      <div className="module-inline-actions">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleEditInvoice(invoice)}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={() => void handleDeleteInvoice(invoice)}
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </Table>

              <div
                className="module-mobile-list"
                aria-label="Billing invoices cards"
              >
                {visibleInvoices.slice(0, 12).map((invoice) => (
                  <article
                    className="module-mobile-card"
                    key={`mobile-${invoice.id}`}
                  >
                    <h4>{invoice.invoice_no || `INV-${invoice.id}`}</h4>
                    <p>
                      <strong>Patient:</strong> {invoice.patient_id || "-"}
                    </p>
                    <p>
                      <strong>Module:</strong> {invoice.module || "-"}
                    </p>
                    <p>
                      <strong>Total:</strong>{" "}
                      {formatCurrency(invoice.total_amount)}
                    </p>
                    <p>
                      <strong>Advance:</strong>{" "}
                      {formatCurrency(invoice.advance_amount)}
                    </p>
                    <p>
                      <strong>Refund:</strong>{" "}
                      {formatCurrency(invoice.refunded_amount)}
                    </p>
                    <p>
                      <strong>Due:</strong> {formatCurrency(invoice.due_amount)}
                    </p>
                    <p>
                      <strong>Status:</strong> {invoice.payment_status || "-"}
                    </p>
                    <div className="module-card-actions">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleEditInvoice(invoice)}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => void handleDeleteInvoice(invoice)}
                      >
                        Delete
                      </Button>
                    </div>
                    <p className="muted">
                      <strong>Created:</strong>{" "}
                      {formatDateTime(invoice.created_at)}
                    </p>
                  </article>
                ))}
              </div>
            </>
          ) : null}
        </div>
      );
    }

    if (view === "consolidated-bill") {
      const patientInvoices = invoices.filter(
        (inv) =>
          inv.patient_id === masterPaymentForm.patient_id &&
          (inv.due_amount || 0) > 0,
      );
      return (
        <div className="panel">
          <div className="module-panel-head">
            <h3>Consolidated Bill & Payment</h3>
          </div>
          <form
            className="module-filters"
            onSubmit={(e) => {
              e.preventDefault();
            }}
          >
            <Label title="Patient ID">
              <Input
                type="text"
                placeholder="Patient ID"
                value={masterPaymentForm.patient_id}
                onChange={(e) =>
                  setMasterPaymentForm({
                    ...masterPaymentForm,
                    patient_id: e.target.value,
                  })
                }
                required
              />
            </Label>
          </form>
          {masterPaymentForm.patient_id && (
            <>
              {patientInvoices.length > 0 ? (
                <>
                  <Table
                    className="module-table"
                    role="table"
                    aria-label="Pending Invoices"
                  >
                    <TableHead>
                      <TableCell>Invoice</TableCell>
                      <TableCell>Module</TableCell>
                      <TableCell>Total</TableCell>
                      <TableCell>Due</TableCell>
                    </TableHead>
                    {patientInvoices.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell>
                          {inv.invoice_no || `INV-${inv.id}`}
                        </TableCell>
                        <TableCell>{inv.module || "-"}</TableCell>
                        <TableCell>
                          {formatCurrency(inv.total_amount)}
                        </TableCell>
                        <TableCell>{formatCurrency(inv.due_amount)}</TableCell>
                      </TableRow>
                    ))}
                  </Table>
                  <form
                    className="module-form"
                    onSubmit={handleMasterPayment}
                    style={{ marginTop: "1rem" }}
                  >
                    <div className="form-grid">
                      <Label title="Master Payment Amount">
                        <Input
                          type="number"
                          step="0.01"
                          min="0.01"
                          value={masterPaymentForm.amount}
                          onChange={(e) =>
                            setMasterPaymentForm({
                              ...masterPaymentForm,
                              amount: e.target.value,
                            })
                          }
                          required
                        />
                      </Label>
                      <Label title="Payment Mode">
                        <Select
                          value={masterPaymentForm.payment_mode}
                          onChange={(e) =>
                            setMasterPaymentForm({
                              ...masterPaymentForm,
                              payment_mode: e.target.value,
                            })
                          }
                        >
                          <option value="cash">Cash</option>
                          <option value="card">Card</option>
                          <option value="upi">UPI</option>
                          <option value="bank_transfer">Bank Transfer</option>
                        </Select>
                      </Label>
                      <Label title="Deduct from Wallet?">
                        <input
                          type="checkbox"
                          checked={masterPaymentForm.use_wallet}
                          onChange={(e) =>
                            setMasterPaymentForm({
                              ...masterPaymentForm,
                              use_wallet: e.target.checked,
                            })
                          }
                          style={{ marginLeft: "0.5rem" }}
                        />
                      </Label>
                    </div>
                    <Button type="submit">Apply Master Payment</Button>
                  </form>
                </>
              ) : (
                <p className="muted" style={{ marginTop: "1rem" }}>
                  No pending invoices for this patient.
                </p>
              )}
            </>
          )}
        </div>
      );
    }

    if (view === "wallet-refunds") {
      return (
        <div className="panel">
          <div className="module-panel-head">
            <h3>Patient Wallet & Refunds</h3>
          </div>
          <form
            className="module-filters"
            onSubmit={(e) => {
              e.preventDefault();
              void loadWalletAndRefunds(walletSearchId);
            }}
          >
            <Label title="Patient ID">
              <Input
                type="text"
                placeholder="Patient ID"
                value={walletSearchId}
                onChange={(e) => setWalletSearchId(e.target.value)}
                required
              />
            </Label>
            <Button type="submit">Search</Button>
          </form>

          {walletData && (
            <div
              className="stat-grid module-stat-grid"
              style={{ marginTop: "1rem" }}
            >
              <StatCard
                label="Current Wallet Balance"
                value={formatCurrency(walletData.balance)}
              />
            </div>
          )}

          {walletData && (
            <form
              className="module-form"
              onSubmit={handleAddWallet}
              style={{ marginTop: "1rem" }}
            >
              <h4>Add Funds to Wallet</h4>
              <div className="form-grid">
                <Label title="Amount">
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={walletForm.amount}
                    onChange={(e) =>
                      setWalletForm({ ...walletForm, amount: e.target.value })
                    }
                    required
                  />
                </Label>
                <Label title="Reason">
                  <Input
                    type="text"
                    placeholder="e.g. Advance deposit"
                    value={walletForm.reason}
                    onChange={(e) =>
                      setWalletForm({ ...walletForm, reason: e.target.value })
                    }
                    required
                  />
                </Label>
              </div>
              <Button type="submit">Add Funds</Button>
            </form>
          )}

          <hr style={{ margin: "2rem 0" }} />

          <form className="module-form" onSubmit={handleCreateRefund}>
            <h4>Issue Refund against Invoice</h4>
            <div className="form-grid">
              <Label title="Invoice ID">
                <Input
                  type="number"
                  value={refundForm.invoice_id}
                  onChange={(e) =>
                    setRefundForm({ ...refundForm, invoice_id: e.target.value })
                  }
                  required
                />
              </Label>
              <Label title="Refund Amount">
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={refundForm.amount}
                  onChange={(e) =>
                    setRefundForm({ ...refundForm, amount: e.target.value })
                  }
                  required
                />
              </Label>
              <Label title="Reason">
                <Input
                  type="text"
                  placeholder="Refund reason"
                  value={refundForm.reason}
                  onChange={(e) =>
                    setRefundForm({ ...refundForm, reason: e.target.value })
                  }
                  required
                />
              </Label>
            </div>
            <Button type="submit" variant="destructive">
              Issue Refund
            </Button>
          </form>

          <hr style={{ margin: "2rem 0" }} />

          <h4>Recent Refunds</h4>
          {refundsList.length === 0 ? (
            <p className="muted" style={{ marginTop: "1rem" }}>
              No recent refunds found.
            </p>
          ) : (
            <Table
              className="module-table"
              role="table"
              aria-label="Refunds List"
              style={{ marginTop: "1rem" }}
            >
              <TableHead>
                <TableCell>Invoice</TableCell>
                <TableCell>Amount</TableCell>
                <TableCell>Reason</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Date</TableCell>
              </TableHead>
              {refundsList.map((ref) => (
                <TableRow key={ref.id}>
                  <TableCell>{ref.invoice_id}</TableCell>
                  <TableCell>{formatCurrency(ref.amount)}</TableCell>
                  <TableCell>{ref.reason}</TableCell>
                  <TableCell>{ref.status}</TableCell>
                  <TableCell>{formatDateTime(ref.created_at)}</TableCell>
                </TableRow>
              ))}
            </Table>
          )}
        </div>
      );
    }

    if (view === "payment-mode-breakdown") {
      return (
        <div className="panel">
          <div className="module-panel-head">
            <h3>Payment Mode Breakdown</h3>
          </div>
          {summary.payment_mode_breakdown.length === 0 ? (
            <p className="muted">No payment mode records available.</p>
          ) : (
            <div className="bar-chart">
              {summary.payment_mode_breakdown.map((row) => (
                <div className="bar-row" key={row.label}>
                  <span>{row.label}</span>
                  <div className="bar">
                    <div
                      style={{
                        width: `${Math.max(8, (row.count / maxBreakdownValue) * 100)}%`,
                      }}
                    />
                  </div>
                  <span>{formatCurrency(row.count)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="panel">
        <div className="module-panel-head">
          <h3>Collections by Module</h3>
        </div>
        {summary.collections_by_module.length === 0 ? (
          <p className="muted">No collection data available.</p>
        ) : (
          <div className="bar-chart">
            {summary.collections_by_module.map((row) => (
              <div className="bar-row" key={row.label}>
                <span>{row.label}</span>
                <div className="bar">
                  <div
                    style={{
                      width: `${Math.max(8, (row.count / maxModuleCollectionValue) * 100)}%`,
                    }}
                  />
                </div>
                <span>{formatCurrency(row.count)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  })();

  const meta = BILLING_VIEW_CONFIG[view];

  return (
    <section className="module-page billing-page">
      <div className="module-panel-head">
        <div>
          <h3>{meta.title}</h3>
          <p className="muted">{meta.subtitle}</p>
        </div>
      </div>

      <div className="stat-grid module-stat-grid">
        <StatCard
          label="Total Billed"
          value={formatCurrency(summary.total_billed)}
        />
        <StatCard
          label="Collected"
          value={formatCurrency(summary.total_collected)}
        />
        <StatCard
          label="Pending Due"
          value={formatCurrency(summary.total_due)}
        />
        <StatCard
          label="Advances"
          value={formatCurrency(summary.total_advance)}
        />
        <StatCard
          label="Refunds"
          value={formatCurrency(summary.total_refunded)}
        />
      </div>

      {viewContent}
    </section>
  );
}
