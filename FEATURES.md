# Keppler | Hosp AI - Feature Documentation

This document lists the functional features implemented to match the Streamlit app.

## Authentication & Access
- Login with username and password.
- Signup (employee registration) with personal and employment info.
- Role-based access: employee accounts can access Employee Management.
- Account status enforcement (inactive accounts cannot log in).
- Default demo account: employee / employee123.

## Navigation & Layout
- Sidebar with brand, user summary, role badge, OCR language selector, and navigation.
- Pages: Dashboard, Add Patient, View Patients, Search, Re-admit, Employee Management, Settings.
- Logout action clears session.

## Dashboard
- Stat cards: Total Patients, New Today, Active Admissions, Documents.
- Recent patients (latest 5) with quick access.
- Quick actions: Register Patient, Search Patient, Re-admit Patient.

## Patient Registration
- Auto-generated Patient ID preview.
- Personal information: first/middle/last name, DOB, age, weight, height, gender, pregnant flag, phone.
- Medical information: up to three allergy fields and symptoms.
- Duplicate detection (warns on potential matches by name/DOB/phone).
- Clears form and resets patient ID.

## Document Upload & OCR
- Separate upload areas for Test Documents, X-Ray/MRI, and Prescriptions.
- OCR processing per document with language selection.
- Editable OCR output prior to saving.
- Save OCR results to patient record and admission context.
- Prepare/download PDF or Word exports per document.
- Clear OCR results per document.

## Patient Records
- View all patients in a table with key details.
- Patient detail view with:
  - Personal information (age, gender, DOB, phone, weight, height, pregnancy status).
  - Medical information (allergies, symptoms).
  - Admission history with active/discharged status.
  - Document history with OCR language and export actions.
- Delete patient with confirmation (employee-only).

## Search
- Search by name, phone, or patient ID.
- Results list with direct access to patient details.

## Re-admit Patient
- Search existing patients for re-admission.
- Add admission notes and update current symptoms.
- Creates new admission record and sets current patient context.

## Employee Management
- Tabs: All Employees, Add New Employee, Statistics.
- All Employees:
  - Search by name, email, phone, or employee ID.
  - Expandable detail cards with personal and employment info.
  - Edit employee details (including job role, status, contact info).
  - Activate/deactivate employee status.
  - Delete employee with confirmation.
- Add New Employee:
  - Account and personal details, job role, department, address, emergency contact.
- Statistics:
  - Total/active/inactive counts.
  - Department distribution.
  - Status distribution.
  - Table view including date joined.

## Settings
- Database statistics snapshot.
- Current user profile data.

