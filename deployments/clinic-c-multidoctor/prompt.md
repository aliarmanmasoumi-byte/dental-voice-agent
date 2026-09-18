# Mission: Build a Production-Grade Medical Voice Agent System

## Your Role
You are an expert AI systems architect. Your job is to design and build 
a complete, production-ready voice agent system from scratch for a large 
medical/dental clinic in Spain.

---

## Step 1: Read & Analyze First
Before doing ANYTHING, read all files in this folder:
- Any .json files (n8n workflow exports)
- Any .txt or .md files (Retell AI prompts)
- The .env file (for API credentials)
- Any other config files

Understand the current system deeply. Identify every weakness.
Then present your analysis. WAIT FOR MY APPROVAL before proceeding.

---

## Context: What Exists (and What's Wrong With It)
The current system (built for a small clinic) has these known problems:
- Single doctor only (one Google Calendar)
- No patient confirmation messages
- No cancel or reschedule flow
- Race conditions (double bookings possible)
- Hardcoded timezone offset
- Webhook URLs still pointing to test endpoints
- Empty HTTP response bodies on webhook nodes
- No error recovery or fallback flows
- No logging or audit trail
- GDPR non-compliant (patient data not handled properly)
- Google Calendar used as a database (wrong approach for scale)

---

## New System Requirements

### Clinic Profile
- Large medical/dental clinic in Spain
- Multiple doctors, multiple specialties
- High call volume
- Bilingual: Spanish (primary) + English (auto-detect)
- Appointment duration: 45 minutes per slot

### Voice Agent (Retell AI)
Build a new Retell AI agent with:

Core Flows:
1. Greeting → language auto-detection (Spanish/English)
2. New appointment booking
3. Cancel existing appointment
4. Reschedule existing appointment
5. General clinic information (hours, location, services)
6. Human handoff (if caller gets frustrated or asks for human)
7. After-hours message (clinic closed → take callback request)
8. Emergency detection (if patient describes emergency → redirect)

Booking Flow Logic:
- Ask for patient name + phone number FIRST (commitment bias)
- Ask for preferred specialty / reason for visit
- Route to the correct doctor based on specialty
- Offer 3 available time slots (not just one)
- Confirm full details before booking
- Send confirmation immediately after booking

Custom Functions (Retell → n8n webhooks):
- check_availability(specialty, doctor_preference, date_preference)
- book_appointment(patient_name, patient_phone, doctor_id, datetime, specialty, notes)
- cancel_appointment(patient_phone, appointment_id_or_name)
- reschedule_appointment(appointment_id, new_datetime)
- get_doctors_by_specialty(specialty)
- get_clinic_info(info_type)
- create_callback_request(patient_name, patient_phone, reason)
- detect_emergency(patient_description)

Agent Personality:
- Warm, professional, calm
- Spanish name (suggest a good one)
- Never robotic — natural conversation
- Handles interruptions gracefully
- If uncertain → always offer human handoff

System Prompt Quality:
- Clear sections with headers
- Explicit state machine (what to do in each situation)
- Exact phrasing for key moments (greeting, confirmation, goodbye)
- Edge case handling (patient doesn't know which doctor, vague symptoms)
- Do NOT collect more data than needed (GDPR)

### n8n Workflows
Build these separate workflows:

Workflow 1: Check Availability
- Input: specialty, doctor preference, date preference
- Query Google Calendar for each matching doctor
- Return: list of available 45-minute slots with doctor names
- Anti-double-booking: lock slot for 90 seconds during booking

Workflow 2: Book Appointment
- Input: all patient + appointment details
- Create Google Calendar event (45 minutes duration)
- Generate unique appointment ID
- Trigger confirmation sender
- Log to Google Sheets (audit trail)
- Return: appointment ID + confirmation details

Workflow 3: Cancel Appointment
- Find appointment by phone number or appointment ID
- Delete from Google Calendar
- Send cancellation confirmation to patient via SMS
- Log cancellation with reason

Workflow 4: Reschedule Appointment
- Find existing appointment
- Check new slot availability
- Delete old event, create new event (45 minutes)
- Send reschedule confirmation via SMS

Workflow 5: Confirmation Sender
- Triggered by booking/cancel/reschedule
- Send SMS via Twilio (primary)
- Fallback: Email if SMS fails
- WhatsApp: NOT configured yet — skip for now

Workflow 6: After-Hours Handler
- Detect if clinic is closed (Spanish public holidays + custom hours)
- Log callback request to Google Sheets
- Send internal notification to clinic admin (email)

Workflow 7: Error Handler
- Catch all failures from other workflows
- Log error with full context to Google Sheets
- Return graceful error message to Retell agent
- Alert admin for critical failures

### Data Architecture
- One Google Calendar per doctor (named: "Dr. [Name] - [Specialty]")
- Master Google Sheet with tabs:
  - Appointments (log of all bookings)
  - Cancellations
  - Errors
  - Callback Requests
  - Doctors (name, specialty, calendar ID, working hours)
- Appointment ID format: CLN-YYYYMMDD-XXXX

### Confirmation Message Templates

Spanish:✅ Cita confirmada
Paciente: Ali García
Doctor: Dr. Martínez
Especialidad: Ortodoncia
📅 12 junio a las 10:30
📍 Calle Gran Vía 45, Madrid
Para cancelar responde CANCELAR al +34 91 xxx xxxx
English:✅ Appointment Confirmed
Patient: {name}
Doctor: {doctor_name}
Specialty: {specialty}
📅 {date} at {time}
📍 {clinic_address}
To cancel reply CANCEL to {clinic_phone}
### Security & Compliance
- Never log full patient data in n8n execution logs
- Appointment IDs instead of names in webhook URLs
- API keys only from .env file (never hardcoded)
- Webhook endpoints authenticated (header token check)
- Patient phone numbers: store only last 4 digits in logs

---

## How to Build (Step by Step)

### Phase 1 — Architecture (do this first)
1. Read all existing files
2. Present full analysis of current system
3. Present proposed architecture for new system
4. List all API keys / credentials you will need from me
5. STOP — wait for my approval

### Phase 2 — Data Setup
1. Define Google Sheets structure (give me exact sheet/tab names)
2. Define Google Calendar naming convention
3. Create setup checklist for me to follow manually
4. STOP — wait for my confirmation that setup is done

### Phase 3 — n8n Workflows
1. Build all 7 workflows as JSON files
2. Test each webhook endpoint with sample data
3. Verify Google Calendar read/write works
4. Verify Twilio SMS works
5. STOP — wait for my approval before touching Retell

### Phase 4 — Retell AI Agent
1. Write complete system prompt
2. Define all custom functions with exact JSON schemas
3. Create the agent via Retell API
4. Link all webhook URLs to n8n production endpoints
5. Run test call and analyze transcript
6. STOP — present test results, wait for approval

### Phase 5 — Polish & Harden
1. Add error handling to every webhook
2. Add rate limiting (max 3 concurrent calls per webhook)
3. Test edge cases (double booking attempt, invalid phone, no availability)
4. Test cancel and reschedule flows end-to-end
5. Final audit: check all webhook URLs are production (not test)
6. Final audit: verify all response bodies are populated
7. Deliver final documentation

---

## Important Rules
- NEVER move to next phase without my explicit approval
- NEVER hardcode any API key, phone number, or ID
- NEVER use test/staging webhook URLs in production config
- ALWAYS check that HTTP response bodies are populated
- ALWAYS handle the case where Google Calendar has no availability
- ALWAYS provide a human handoff option in the agent
- If you are unsure about anything → ASK before building

---

## Credentials Needed (already in .env file)
- RETELL_API_KEY
- N8N_API_KEY
- N8N_BASE_URL
- TWILIO_ACCOUNT_SID
- TWILIO_AUTH_TOKEN
- TWILIO_PHONE_NUMBER
- GOOGLE_SERVICE_ACCOUNT_JSON
- CLINIC_NAME
- CLINIC_ADDRESS
- CLINIC_PHONE
- CLINIC_WORKING_HOURS

Begin with Phase 1. Read all files now and present your analysis.