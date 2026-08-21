# Geo-fenced attendence system

Build a modern, professional, responsive web application UI for a college staff attendance system called:

"CampusAttend"

The system is designed for college staff attendance. Staff can eventually mark attendance only when they are physically present inside the college campus, but for now I ONLY want the complete frontend UI/UX. Do not implement real GPS, face recognition, Bluetooth, Wi-Fi, authentication, database, or backend functionality yet. Use realistic mock data and clearly structured components so the backend can be connected later.

TECH STACK:

- React

- Vite

- TypeScript

- Tailwind CSS

- Lucide React icons

- Use clean reusable components

- Responsive for desktop, tablet and mobile

- No unnecessary external dependencies

DESIGN STYLE:

- Professional college/enterprise dashboard

- Clean and modern

- White cards

- Very light gray background

- Deep blue primary color

- Green for verified/success

- Amber for warning

- Red for errors

- Rounded corners

- Subtle shadows

- Good spacing

- Strong typography hierarchy

- Avoid excessive gradients

- Avoid flashy animations

- Make the interface look trustworthy and suitable for an actual college administration system

APPLICATION STRUCTURE:

1. LOGIN PAGE

Create a professional login screen.

Layout:

- College logo placeholder

- "CampusAttend"

- Subtitle: "Secure Staff Attendance System"

- Staff ID input

- Password input

- Show/hide password icon

- "Remember me"

- "Sign In" button

- "Forgot password?"

- Small footer text:

  "Secure • Location Verified • Institution Managed"

Use a split-screen layout on desktop:

Left side: branding and a simple illustration/visual

Right side: login form

On mobile use a single centered card.

2. STAFF DASHBOARD

After login, create a staff dashboard with:

Top navbar:

- College logo

- CampusAttend

- Notification icon

- Staff profile

- Profile dropdown

- Logout

Sidebar on desktop:

- Dashboard

- Mark Attendance

- Attendance History

- Profile

- Settings

Mobile should use a mobile navigation/bottom navigation.

Dashboard content:

Header:

"Good Morning, [Staff Name]"

"Here's your attendance overview for today."

Stats cards:

- Today's Status

- Today's Marking Time

- Monthly Attendance

- Current Location Status

Example mock data:

Today's Status: "Present"

Time: "09:03 AM"

Monthly Attendance: "96%"

Location: "Inside Campus"

Main attendance card:

Large status indicator

"Attendance Ready"

Display:

- Location: Inside Campus

- GPS Accuracy: 11 m

- Verification Status: Ready

- Attendance Window: 8:45 AM – 9:10 AM

Large primary button:

"Mark Attendance"

Recent attendance table:

Date

Time

Status

Location

Verification

Use realistic mock attendance records.

3. MARK ATTENDANCE PAGE

This is the main feature UI.

Title:

"Mark Attendance"

Create a large verification panel.

Show four verification cards:

Location

- GPS icon

- "Inside Campus"

- "Verified"

- Accuracy: 11 m

Wi-Fi

- Wi-Fi icon

- "College Network"

- "Connected"

- "Verified"

Bluetooth

- Bluetooth icon

- "Campus Beacon"

- "Detected"

- "Verified"

Identity

- Face icon

- "Identity Verification"

- "Ready"

Below this, show a campus map placeholder.

The map should visually display an irregular polygon representing the college campus.

Use a stylized map mockup if no real map service is connected.

Show:

- Campus boundary

- Current staff location marker

- Small legend

- "You are inside the campus"

Add a large button:

"Verify & Mark Attendance"

When clicked, simulate a verification process with a short loading animation and then show a successful state.

SUCCESS STATE:

Large green check icon

"Attendance Recorded"

"09:03 AM"

"19 August 2026"

Show:

- Location verified

- Identity verified

- Device verified

- Attendance successfully recorded

Also include:

"Attendance ID: ATT-20260819-001"

4. ATTENDANCE HISTORY PAGE

Title:

"Attendance History"

Add:

- Month selector

- Date filter

- Status filter

- Search

Summary cards:

- Working Days

- Present

- Absent

- Attendance Rate

Attendance table:

Date

Day

Check-in Time

Location

Status

Use statuses:

Present

Late

Absent

Use green, amber and red visual indicators.

Also create a mobile-friendly card layout instead of forcing a wide table on small screens.

5. PROFILE PAGE

Show staff profile:

Profile photo placeholder

Staff name

Staff ID

Department

Designation

Email

Phone

Device information:

Registered Device

Device status: Active

Verification:

Face verification: Enabled

Location verification: Enabled

Add an "Edit Profile" button.

6. SETTINGS PAGE

Sections:

Account

Security

Notifications

Attendance Preferences

Create clean toggle controls for:

- Email notifications

- Attendance reminders

- Security alerts

Do not implement actual functionality yet.

7. ADMIN DASHBOARD

Create a separate admin dashboard UI.

Use a sidebar:

Dashboard

Staff

Attendance

Campus Map

Devices

Security

Reports

Audit Logs

Settings

Top bar:

Search

Notifications

Admin profile

Dashboard cards:

- Total Staff: 184

- Present Today: 172

- Absent Today: 12

- Late: 7

Main sections:

A. Today's Attendance

Table:

Staff ID

Name

Department

Time

Location

Status

Verification

B. Attendance Overview

Create a clean chart showing attendance over the past 7 days.

C. Department Summary

Show attendance by department.

D. Live Campus Status

Display:

- Staff currently inside campus

- Staff outside campus

- Verification warnings

8. ADMIN CAMPUS MAP PAGE

Create an attractive campus map interface.

Display a large irregular polygon representing the campus boundary.

The polygon represents:

- Sona College of Technology

- Sona Incubation Foundation

- Sona College of Arts and Science

- Thiagarajar Polytechnic College

Inside the map display mock staff markers.

Use:

Green marker = Inside campus

Red marker = Outside campus

Amber marker = Verification issue

Add:

- Total staff inside

- Total outside

- Boundary status

- Last updated time

Include controls:

Zoom in

Zoom out

Center campus

Toggle staff visibility

This is only a UI mockup for now.

9. ADMIN STAFF PAGE

Create a staff management interface.

Table:

Staff ID

Name

Department

Designation

Device

Status

Last Attendance

Actions:

View

Edit

Deactivate

Add:

"Add Staff"

10. SECURITY DASHBOARD

Create a professional security monitoring page.

Cards:

- Verified Devices

- Suspicious Attempts

- Mock Location Attempts

- Failed Face Verification

- Unauthorized Requests

Create a "Recent Security Events" table:

Time

Staff

Event

Device

Location

Result

Use appropriate severity indicators:

Low

Medium

High

11. AUDIT LOG PAGE

Create a detailed audit log interface.

Columns:

Timestamp

User

Action

IP Address

Device

Location

Result

Add search and filters.

12. REPORTS PAGE

Create a reporting dashboard.

Filters:

Date range

Department

Status

Summary:

Total Attendance

Present

Absent

Late

Include charts:

- Attendance trend

- Department comparison

- Monthly attendance

Add buttons:

"Export CSV"

"Generate Report"

These buttons can be mock UI actions for now.

NAVIGATION:

Staff:

Dashboard

Mark Attendance

Attendance History

Profile

Settings

Admin:

Dashboard

Staff

Attendance

Campus Map

Devices

Security

Audit Logs

Reports

Settings

Use React Router.

Use reusable:

- Sidebar

- Navbar

- StatCard

- StatusBadge

- VerificationCard

- AttendanceTable

- MapPanel

- EmptyState

- LoadingState

- Modal

- Toast

- ConfirmDialog

IMPORTANT UI STATES:

Implement polished UI states for:

- Loading

- Success

- Error

- Empty data

- Outside campus

- GPS unavailable

- Low GPS accuracy

- Wi-Fi unavailable

- Bluetooth unavailable

- Face verification failed

- Attendance already marked

- Attendance window closed

For example, when outside campus:

Red alert:

"Attendance unavailable"

"You appear to be outside the authorized campus boundary."

When GPS accuracy is poor:

Amber alert:

"Location accuracy is too low"

"Move to an open area and try again."

Do not implement real hardware/location functionality.

MOCK DATA:

Create realistic mock data for:

- Staff

- Attendance

- Departments

- Security events

- Devices

- Campus locations

Use Indian/college-style sample data but do not use real personal information.

ACCESSIBILITY:

- Proper labels

- Keyboard navigation

- Good color contrast

- Tooltips for unfamiliar icons

- Responsive layouts

IMPORTANT:

Do not build backend APIs.

Do not connect to a real database.

Do not implement real authentication.

Do not implement real GPS.

Do not implement real face recognition.

Do not implement Bluetooth.

Do not implement Wi-Fi scanning.

Build the frontend as if these services will be connected later.

The code must be clean, modular and production-style, with mock services separated from UI components.

Start by creating the complete frontend application, routing, layout, reusable components, pages and mock data. Make the Staff Dashboard and Mark Attendance pages especially polished because they are the main user experience.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/ad42a849-dd1e-4ab2-be56-9774413810ce).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
