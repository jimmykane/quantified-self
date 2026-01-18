# Quantified Self

[![Gitpod ready-to-code](https://img.shields.io/badge/Gitpod-ready--to--code-blue?logo=gitpod)](https://gitpod.io/#https://github.com/jimmykane/quantified-self)
![Testing](https://github.com/jimmykane/quantified-self/workflows/Testing/badge.svg)

**Quantified Self** is a powerful platform for aggregating, analyzing, and visualizing your fitness data. It supports importing activity files (TCX, FIT, JSON) and synchronizing directly with major fitness services like Garmin, Suunto, Polar, and COROS.

Built on **Firebase** and **Angular**, it aims to provide real-time dashboards and deep activity analysis.

Check it out live at [quantified-self.io](https://www.quantified-self.io/).

---

## 🚀 Features

- **Multi-Source Import**: Import `.fit`, `.tcx`, and `.gpx` files manually.
- **Auto-Sync**: Seamless integration with Garmin Connect, Suunto App, and COROS.
- **Advanced Analysis**: Deep dive into heart rate zones, power curves, and intensity distribution.
- **Interactive Maps**: Visualize routes using Leaflet.
- **Financial & Usage Tracking**: Monitor cloud function usage and costs (Admin only).

## 🛠 Tech Stack

- **Frontend**: Angular v20+, Angular Material, RxJS.
- **Backend**: Firebase (Functions, Firestore, Hosting, Storage, Auth).
- **Visualization**: AmCharts 4, Chart.js, Leaflet.
- **Parsing**: [Quantified Self Lib](https://github.com/jimmykane/quantified-self-lib) (Custom parser for FIT/TCX/GPX).
- **Testing**: Vitest.

## 📋 Prerequisites

Ensure you have the following installed:

1.  **Node.js**: v20 or higher.
2.  **npm**: Comes with Node.js.
3.  **Firebase CLI**: `npm install -g firebase-tools`
4.  **Java**: Required for running Firebase Emulators locally.

## ⚡️ Quick Start

### 1. Clone the Repository
```bash
git clone https://github.com/jimmykane/quantified-self.git
cd quantified-self
```

### 2. Install Dependencies
**Root (Frontend):**
```bash
npm install
```

**Functions (Backend):**
```bash
cd functions
npm install
cd ..
```

### 3. Run Locally (Frontend)
Starts the Angular development server.
```bash
npm start
# Access at http://localhost:4200/
```

### 4. Run Locally (Backend Environment)
To run Cloud Functions and other Firebase services locally:
```bash
firebase emulators:start
```

## 🧪 Testing

We use **Vitest** for unit testing.

**Run all tests:**
```bash
npm test
```

**Run tests with coverage:**
```bash
npm run test-coverage
```

**Run specific Firestore Rules tests:**
```bash
npm run test:rules
```

## 📦 Deployment

Deployment is handled via Firebase CLI. Common scripts:

- **Deploy Beta (Hosting only):**
  ```bash
  npm run firebase-hosting-beta
  ```
- **Deploy Production (Build & Deploy):**
  ```bash
  npm run build-and-deploy-prod
  ```

## 🔐 Data Retention & policies

To ensure data hygiene and compliance, we enforce Time-To-Live (TTL) policies on specific Firestore collections:

| Collection | TTL Duration | Field | Description |
| :--- | :--- | :--- | :--- |
| `mail` | ~90 days | `expireAt` | Transactional emails logs |
| `failed_jobs` | 7 days | `expireAt` | Logs for failed background jobs |
| `*Queue` | 7 days | `expireAt` | Temporary queue items for processing |

## 🤝 Contribution

Contributions are welcome! Please follow the code of conduct and submitting PRs.
This project uses `eslint` and `prettier` for code formatting.

**Core Libraries:**
This project relies heavily on [Quantified Self Lib](https://github.com/jimmykane/quantified-self-lib) for file parsing logics.

## 📄 License

See [LICENSE](LICENSE) for more details.

---
*Icons by Alessandro*
