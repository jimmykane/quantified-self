# Release: Hardware Benchmarks, UI Polish & Stability

This PR introduces the new **Hardware Benchmark** feature, allowing users to scientifically compare device accuracy. It also includes significant UI refinements (Typography, Glassmorphism), a "What's New" announcement system, and performance improvements.

## 🚀 New Features

### 📊 Hardware Benchmarks
A comprehensive tool to compare a "Test" activity against a "Reference" activity to evaluate device performance.
- **GNSS Analysis:** Calculates precision metrics including **CEP50**, **CEP95**, **RMSE**, and **Max Deviation** to grade GPS accuracy.
- **Stream Correlation:** Uses Pearson Correlation, RMSE, and MAE to compare sensor streams (Heart Rate, Power, Cadence, Elevation) point-by-point.
- **Quality Assurance:** Automatic detection of signal **dropouts**, **stuck sensors**, and **cadence lock** artifacts.
- **Auto-Alignment:** Intelligent time-shifting to perfectly align activities before comparison based on Altitude or Speed signatures.
- **Visual Reports:** Detailed report cards with "Excellent/Good/Fair/Poor" grading and actionable insights.

### 🔔 What's New System
- Implemented a `What's New` service to display changelogs and feature announcements directly within the app (`feature: add whats new`).

### 📂 File Management
- **Fit File Caching:** Added caching for parsed FIT files to improve performance (`feature: cache fit files`).
- **Upload Improvements:** Better handling and reporting of files that fail to upload (`feature: get files that cannot be uploaded`).
- **Bulk Download Limit:** Restricted bulk downloads to 20 files to prevent performance issues (`chore: disable downloads for more than 20 files`).

## 🎨 UI/UX Enhancements

- **Typography & Design:**
    - Switched to **Barlow** font for better readability (`chore: change font`).
    - Standardized typography and applied new text styles (`chore: add typography`).
    - **Glassmorphism:** Updated shared styles for modern glass-like effects (`src/styles/_glass.scss`).
- **Components:**
    - **Bottom Sheets:** Refactored for better mobile experience (`chore: refactor bottom sheets`).
    - **Loading States:** Added visual loading indicators (`chore: add loading state`).
    - **Maps:** Updated map styles for better visibility (`chore: map styles`).
    - **Table:** Improved data table UI (`chore: improve ui for table`).

## 🛠 Fixes & Improvements

- **Charts:** Fixed issues with double-loading and improved disposal logic (`chore: fix charts double loading`, `chore: fix not disposed charts`).
- **Uploads:** Added robust error handling for debug uploads (`fix: add try catch for uploads of debug`).
- **Stability:**
    - Fixed race conditions (`fix: race condition`).
    - Fixed autofocus issues (`fix: for autofocus`).
    - Addressed various test failures (`fix: tests`).
- **Backend:**
    - Reconciled user claims and roles (`chore: reconcile claims as well`).

## 📦 Dependencies
- Bumped `sports-lib` version.
- Downgraded Firebase (v11) to resolve compatibility issues.
