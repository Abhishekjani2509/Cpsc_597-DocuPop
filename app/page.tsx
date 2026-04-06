"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import LinedPaper from "@/components/LinedPaper";
import LoginForm from "@/components/auth/LoginForm";
import SignUpForm from "@/components/auth/SignUpForm";
import { useAuth } from "@/components/AuthProvider";
import {
  FileText,
  Image,
  FileType,
  File,
  Upload,
  Search,
  Table,
  Play,
  FolderOpen,
  BarChart3,
  ArrowRight,
} from "lucide-react";

/* ── Supported document types ── */
const SUPPORTED_DOCUMENTS = [
  { icon: FileText, label: "PDF", ext: ".pdf", description: "Invoices, receipts, reports" },
  { icon: Image, label: "JPEG", ext: ".jpg / .jpeg", description: "Scanned documents, photos" },
  { icon: Image, label: "PNG", ext: ".png", description: "Screenshots, scanned pages" },
  { icon: FileType, label: "DOCX", ext: ".doc / .docx", description: "Word documents" },
  { icon: File, label: "TXT", ext: ".txt", description: "Plain text files" },
  { icon: Image, label: "GIF", ext: ".gif", description: "Animated or static images" },
];

/* ── Feature sections (Documents, Processing, Data) ── */
const FEATURES = [
  {
    id: "documents",
    title: "Documents",
    icon: FolderOpen,
    color: "bg-blue-50 border-blue-200",
    iconColor: "text-blue-600",
    tagColor: "bg-blue-100 text-blue-700",
    description:
      "Upload, organize, and manage all your documents in one place. Supports drag-and-drop batch uploads with secure cloud storage.",
    highlights: [
      "Drag & drop file uploads",
      "Secure S3 cloud storage",
      "Download & preview via presigned URLs",
      "Batch upload support",
    ],
  },
  {
    id: "processing",
    title: "Processing Center",
    icon: Play,
    color: "bg-purple-50 border-purple-200",
    iconColor: "text-purple-600",
    tagColor: "bg-purple-100 text-purple-700",
    description:
      "Queue documents for intelligent OCR processing powered by AWS Textract. Track job progress in real-time.",
    highlights: [
      "AWS Textract OCR engine",
      "Custom queries & adapters",
      "Real-time job status tracking",
      "Automatic field extraction",
    ],
  },
  {
    id: "data",
    title: "Data Hub",
    icon: BarChart3,
    color: "bg-emerald-50 border-emerald-200",
    iconColor: "text-emerald-600",
    tagColor: "bg-emerald-100 text-emerald-700",
    description:
      "View extracted data in a powerful spreadsheet interface. Create custom tables, map fields, and export to CSV.",
    highlights: [
      "AG Grid spreadsheet view",
      "Per-field confidence scores",
      "Custom field mappings",
      "CSV import & export",
    ],
  },
];

/* ── Example documents ── */
const EXAMPLE_DOCUMENTS = [
  {
    category: "Invoices",
    color: "border-red-200 bg-red-50",
    headerColor: "bg-red-500",
    items: [
      { name: "invoice_2024_001.pdf", size: "245 KB", fields: "Invoice #, Date, Total, Vendor" },
      { name: "supplier_bill_march.pdf", size: "312 KB", fields: "PO Number, Line Items, Tax, Amount Due" },
    ],
  },
  {
    category: "Receipts",
    color: "border-amber-200 bg-amber-50",
    headerColor: "bg-amber-500",
    items: [
      { name: "store_receipt_03152024.jpg", size: "1.2 MB", fields: "Store Name, Items, Subtotal, Tax" },
      { name: "restaurant_receipt.png", size: "890 KB", fields: "Date, Items, Tip, Total" },
    ],
  },
  {
    category: "Medical Forms",
    color: "border-teal-200 bg-teal-50",
    headerColor: "bg-teal-500",
    items: [
      { name: "patient_intake_form.pdf", size: "156 KB", fields: "Name, DOB, Insurance, Provider" },
      { name: "lab_results_panel.pdf", size: "203 KB", fields: "Patient ID, Test Name, Result, Date" },
    ],
  },
  {
    category: "Tax Documents",
    color: "border-indigo-200 bg-indigo-50",
    headerColor: "bg-indigo-500",
    items: [
      { name: "w2_form_2024.pdf", size: "98 KB", fields: "Employer, Wages, Federal Tax, SSN" },
      { name: "1099_freelance.pdf", size: "87 KB", fields: "Payer, Income, TIN, Tax Year" },
    ],
  },
  {
    category: "Contracts",
    color: "border-sky-200 bg-sky-50",
    headerColor: "bg-sky-500",
    items: [
      { name: "lease_agreement.pdf", size: "420 KB", fields: "Tenant, Landlord, Rent, Term" },
      { name: "service_contract.docx", size: "185 KB", fields: "Parties, Scope, Duration, Fees" },
    ],
  },
  {
    category: "ID & KYC",
    color: "border-pink-200 bg-pink-50",
    headerColor: "bg-pink-500",
    items: [
      { name: "drivers_license_scan.jpg", size: "2.1 MB", fields: "Name, DOB, License #, Expiry" },
      { name: "passport_photo_page.png", size: "1.8 MB", fields: "Name, Nationality, Passport #, DOB" },
    ],
  },
];

export default function Home() {
  const router = useRouter();
  const [showSignUp, setShowSignUp] = useState(false);
  const { user, loading, signOut } = useAuth();

  const handleAuthSuccess = () => {};

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  /* ── Unauthenticated landing page ── */
  if (!user) {
    return (
      <div className="relative flex min-h-screen flex-col">
        {/* Header */}
        <header className="fixed top-0 right-0 left-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 sm:px-6 lg:px-8">
          <div className="text-lg font-bold text-gray-900">DOCUPOP</div>
          <nav className="hidden gap-6 text-sm font-medium text-gray-500 sm:flex">
            <a href="#features" className="transition-colors hover:text-gray-900">Features</a>
            <a href="#documents" className="transition-colors hover:text-gray-900">Document Types</a>
            <a href="#examples" className="transition-colors hover:text-gray-900">Examples</a>
          </nav>
        </header>

        {/* ─── Hero Section ─── */}
        <section className="relative flex flex-col items-center justify-center px-4 pt-32 pb-20 text-center">
          <LinedPaper className="absolute inset-x-0 bottom-0 z-[-1] h-5/6 opacity-60" />
          <h1 className="text-6xl font-bold tracking-tight text-gray-900 sm:text-8xl">
            DOCUPOP
          </h1>
          <p className="mt-4 max-w-2xl text-xl text-gray-600 sm:text-2xl">
            Parse and organize your documents effortlessly and efficiently.
          </p>
          <div className="mt-10 w-full max-w-md">
            {showSignUp ? (
              <SignUpForm
                onSuccess={handleAuthSuccess}
                onSwitchToLogin={() => setShowSignUp(false)}
              />
            ) : (
              <LoginForm
                onSuccess={handleAuthSuccess}
                onSwitchToSignUp={() => setShowSignUp(true)}
              />
            )}
          </div>
        </section>

        {/* ─── Features Section ─── */}
        <section id="features" className="bg-white px-4 py-20 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">
            <h2 className="text-center text-3xl font-bold text-gray-900">
              How It Works
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-center text-gray-500">
              Three powerful modules that take your documents from upload to structured data.
            </p>

            <div className="mt-14 grid gap-8 md:grid-cols-3">
              {FEATURES.map((feature, idx) => (
                <div
                  key={feature.id}
                  className={`relative rounded-2xl border p-6 ${feature.color}`}
                >
                  <div className="mb-4 flex items-center gap-3">
                    <div className={`rounded-lg p-2 ${feature.tagColor}`}>
                      <feature.icon className={`h-6 w-6 ${feature.iconColor}`} />
                    </div>
                    <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
                      Step {idx + 1}
                    </span>
                  </div>
                  <h3 className="text-xl font-bold text-gray-900">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-gray-600">
                    {feature.description}
                  </p>
                  <ul className="mt-4 space-y-2">
                    {feature.highlights.map((h) => (
                      <li key={h} className="flex items-start gap-2 text-sm text-gray-700">
                        <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
                        {h}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Supported Document Types Section ─── */}
        <section id="documents" className="bg-gray-50 px-4 py-20 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-center text-3xl font-bold text-gray-900">
              Supported Document Types
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-center text-gray-500">
              Upload any of these file formats. Max file size is 10 MB per document.
            </p>

            <div className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-6">
              {SUPPORTED_DOCUMENTS.map((doc) => (
                <div
                  key={doc.label}
                  className="group flex flex-col items-center gap-2.5 rounded-2xl border border-gray-200 bg-white px-4 py-5 shadow-sm transition-all hover:-translate-y-1 hover:shadow-md"
                >
                  <div className="rounded-xl bg-blue-50 p-3 transition-colors group-hover:bg-blue-100">
                    <doc.icon className="h-7 w-7 text-blue-600" />
                  </div>
                  <span className="text-sm font-bold text-gray-800">{doc.label}</span>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                    {doc.ext}
                  </span>
                  <span className="text-center text-xs leading-tight text-gray-500">
                    {doc.description}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Example Documents Section ─── */}
        <section id="examples" className="bg-white px-4 py-20 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">
            <h2 className="text-center text-3xl font-bold text-gray-900">
              Example Documents
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-center text-gray-500">
              DocuPop can extract structured data from a wide range of real-world documents.
              Here are some examples of what you can process.
            </p>

            <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {EXAMPLE_DOCUMENTS.map((group) => (
                <div
                  key={group.category}
                  className={`overflow-hidden rounded-2xl border ${group.color}`}
                >
                  {/* Card Header */}
                  <div
                    className={`${group.headerColor} px-5 py-3 text-sm font-bold tracking-wide text-white`}
                  >
                    {group.category}
                  </div>

                  {/* Card Body */}
                  <div className="divide-y divide-gray-200/60 px-5 py-3">
                    {group.items.map((item) => (
                      <div key={item.name} className="py-3">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 shrink-0 text-gray-400" />
                          <span className="truncate text-sm font-semibold text-gray-800">
                            {item.name}
                          </span>
                          <span className="ml-auto shrink-0 text-[10px] font-medium text-gray-400">
                            {item.size}
                          </span>
                        </div>
                        <p className="mt-1.5 pl-6 text-xs text-gray-500">
                          <span className="font-medium text-gray-600">Extracted fields: </span>
                          {item.fields}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Visual: Example OCR extraction preview */}
            <div className="mt-16 overflow-hidden rounded-2xl border border-gray-200 bg-gray-50">
              <div className="border-b border-gray-200 bg-white px-6 py-4">
                <h3 className="text-lg font-bold text-gray-900">
                  Demo: Invoice OCR Extraction
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  See how DocuPop extracts structured data from a PDF invoice
                </p>
              </div>
              <div className="grid md:grid-cols-2">
                {/* Left: Simulated PDF preview */}
                <div className="border-r border-gray-200 p-6">
                  <div className="rounded-lg border border-gray-300 bg-white p-6 shadow-inner">
                    <div className="mb-4 flex items-center justify-between border-b border-gray-100 pb-4">
                      <div>
                        <div className="text-xs font-bold uppercase tracking-wider text-gray-400">
                          Invoice
                        </div>
                        <div className="mt-1 text-lg font-bold text-gray-900">
                          INV-2024-00847
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-gray-400">Date</div>
                        <div className="text-sm font-semibold text-gray-700">Mar 15, 2024</div>
                      </div>
                    </div>
                    <div className="space-y-3 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">From:</span>
                        <span className="font-medium text-gray-700">Acme Supplies Inc.</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">To:</span>
                        <span className="font-medium text-gray-700">TechCorp LLC</span>
                      </div>
                      <div className="my-3 border-t border-dashed border-gray-200" />
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>Description</span>
                        <span>Amount</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Office Supplies (Q1)</span>
                        <span className="font-medium text-gray-700">$1,250.00</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">IT Equipment Rental</span>
                        <span className="font-medium text-gray-700">$3,400.00</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Maintenance Service</span>
                        <span className="font-medium text-gray-700">$850.00</span>
                      </div>
                      <div className="my-2 border-t border-gray-200" />
                      <div className="flex justify-between">
                        <span className="text-gray-500">Subtotal</span>
                        <span className="font-medium text-gray-700">$5,500.00</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Tax (8%)</span>
                        <span className="font-medium text-gray-700">$440.00</span>
                      </div>
                      <div className="flex justify-between border-t border-gray-300 pt-2">
                        <span className="font-bold text-gray-900">Total Due</span>
                        <span className="font-bold text-gray-900">$5,940.00</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-center gap-2 text-xs text-gray-400">
                    <FileText className="h-3.5 w-3.5" />
                    invoice_acme_q1_2024.pdf — 245 KB
                  </div>
                </div>

                {/* Right: Extracted data */}
                <div className="p-6">
                  <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-700">
                    <Search className="h-4 w-4" />
                    Extracted Data
                  </div>
                  <div className="space-y-2.5">
                    {[
                      { field: "Invoice Number", value: "INV-2024-00847", confidence: 99 },
                      { field: "Date", value: "Mar 15, 2024", confidence: 97 },
                      { field: "Vendor", value: "Acme Supplies Inc.", confidence: 95 },
                      { field: "Customer", value: "TechCorp LLC", confidence: 94 },
                      { field: "Subtotal", value: "$5,500.00", confidence: 98 },
                      { field: "Tax", value: "$440.00", confidence: 96 },
                      { field: "Total", value: "$5,940.00", confidence: 99 },
                    ].map((row) => (
                      <div
                        key={row.field}
                        className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-medium uppercase tracking-wider text-gray-400">
                            {row.field}
                          </div>
                          <div className="truncate text-sm font-semibold text-gray-800">
                            {row.value}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-100">
                            <div
                              className={`h-full rounded-full ${
                                row.confidence >= 95
                                  ? "bg-green-500"
                                  : row.confidence >= 80
                                    ? "bg-amber-500"
                                    : "bg-red-500"
                              }`}
                              style={{ width: `${row.confidence}%` }}
                            />
                          </div>
                          <span className="w-8 text-right text-[11px] font-semibold text-green-600">
                            {row.confidence}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-4 text-center text-xs text-gray-400">
                    Confidence scores powered by AWS Textract
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Footer ─── */}
        <footer className="border-t border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-400">
          DocuPop — Intelligent Document Processing
        </footer>
      </div>
    );
  }

  /* ── Authenticated home page ── */
  return (
    <div className="relative flex min-h-screen flex-col">
      <LinedPaper className="absolute inset-x-0 bottom-0 z-[-1] h-5/6 opacity-60" />
      <header className="fixed top-0 right-0 left-0 z-10 flex items-center justify-between bg-white px-4 py-3 shadow-sm sm:px-6 lg:px-8">
        <div className="text-lg font-bold text-gray-900">DOCUPOP</div>
        <div className="flex items-center gap-4">
          <button
            onClick={handleSignOut}
            className="rounded-md bg-red-500 px-4 py-2 text-white hover:bg-red-600"
          >
            Sign Out
          </button>
        </div>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center text-center">
        <h1 className="text-8xl font-bold text-gray-900">Welcome to DOCUPOP</h1>
        <p className="mt-4 max-w-2xl text-2xl text-gray-600">
          You are successfully authenticated! Ready to manage your documents.
        </p>
        <div className="mt-8">
          <button
            onClick={() => router.push("/documents")}
            className="rounded-md bg-blue-500 px-6 py-3 text-lg text-white hover:bg-blue-600"
          >
            Manage Documents
          </button>
        </div>
      </main>
    </div>
  );
}
