# PRISM — Frontend & User Interface Forensic Audit

**Audit Date**: September 16, 2026  
**Target Files**: `prism-platform/public/index.html`, `style.css`, `app.js`  
**Specification Reference**: `07-FRONTEND/DESIGN-SYSTEM.md`

---

## 1. Specification Baseline

`07-FRONTEND/DESIGN-SYSTEM.md` establishes:
- Priorities: Clear information hierarchy, evidence visibility, investigation timeline, hypothesis comparison, explicit uncertainty, accessible contrast, and useful empty/loading/error/blocked states.
- Core screens required: Dashboard, Projects, Investigation Workspace, Evidence, Hypotheses, Experiments, Root Cause, Impact, Recommendations, Verification, Report, Settings.

---

## 2. Screen-by-Screen Implementation Reality

| Screen / View | In Codebase? | Backed by Live API? | Handles Empty State? | Handles Error State? | Status | Notes |
|---|---|---|---|---|---|---|
| **Investigation Stepper** | Yes | Yes (`status` field) | N/A | Basic toast | **WORKING PROTOTYPE** | Visualizes 11 steps; updates active step based on API. |
| **Evidence Vault** | Yes | Yes (`GET /evidence`) | Yes | Yes (toast) | **WORKING PROTOTYPE** | Cards display real DB items; SHA-256 verify button calls API. |
| **Hypotheses Matrix** | Yes | Yes (`GET /hypotheses`) | Yes | Yes (toast) | **WORKING PROTOTYPE** | Confidence meters reflect DB confidence values. |
| **Verification Sandbox** | Yes | Yes (`GET /experiments`) | Yes | Yes (toast) | **MOCKED BEHAVIOR** | "Execute Sandbox Run" triggers fake string generator in backend. |
| **Root Cause & Blast Radius** | Yes | Yes (`GET /root-cause`) | Yes | Yes (toast) | **WORKING PROTOTYPE** | Displays DB root cause and affected component chips. |
| **Recommendations** | Yes | Yes (`GET /recommendations`)| Yes | Yes (toast) | **WORKING PROTOTYPE** | Displays DB recommendations and priority badges. |
| **Report Export Menu** | Yes | Yes (`GET /report`) | N/A | Yes | **WORKING PROTOTYPE** | Triggers browser download of Markdown, JSON, HTML. |
| **Memory Bank Modal** | Yes | Yes (`GET /memories`) | Yes | Yes | **WORKING PROTOTYPE** | Submits query string to API; renders matching memories. |
| **Audit Trail Modal** | Yes | Yes (`GET /audit`) | Yes | Yes | **WORKING PROTOTYPE** | Renders recent audit log entries from DB. |
| **Projects Switcher** | Partial | Partial | No | No | **PARTIALLY_IMPLEMENTED**| Dropdown populated from API, but switching does not filter investigations. |
| **Settings / Admin Screen** | No | No | No | No | **MISSING** | Defined in `DESIGN-SYSTEM.md`, completely absent in UI. |
| **User Onboarding / Auth Screen** | No | No | No | No | **MISSING** | No login screen; user identity is hardcoded to "Alex Chen". |

---

## 3. False-Completion & Simulation Detection in UI

1. **Hardcoded User Profile**:
   - `index.html:84-91`:
     ```html
     <div class="user-profile">
       <div class="avatar">AC</div>
       <div class="user-meta">
         <span class="user-name">Alex Chen</span>
         <span class="user-role">Lead SRE</span>
       </div>
     </div>
     ```
   - The user profile is hardcoded HTML; it does not reflect any authenticated user session.

2. **Fake System Status Pill**:
   - `index.html:47-50`:
     ```html
     <span class="status-dot pulsing"></span>
     <span class="status-text">SYSTEM OPERATIONAL • VERIFICATION ENGINE ACTIVE</span>
     ```
   - The status is hardcoded text. It does not check sandbox worker availability, queue depth, or DB health.

3. **Project Selector Does Not Filter**:
   - In `app.js`, changing `<select id="project-selector">` triggers no event listener. It does not reload or filter the investigations sidebar.

4. **Missing Loading Skeletons**:
   - While empty states have basic fallback messages, there are no skeleton loaders during network latency.
